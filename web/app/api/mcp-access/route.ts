import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ label: z.string().trim().min(1).max(80).default("Research client") });

function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("MCP access storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function identityOrResponse(request: NextRequest) {
  try { return { resolved: await resolveChatIdentity(request), response: null }; }
  catch (error) { return { resolved: null, response: chatIdentityErrorResponse(error, request) }; }
}

function endpoint() {
  return (process.env.MCP_URL || process.env.NEXT_PUBLIC_MCP_URL || "").replace(/\/+$/, "");
}

export async function GET(request: NextRequest) {
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ keys: [], endpoint: endpoint() }));
  const { data, error } = await admin().from("civil_mcp_access_keys")
    .select("key_id, token_prefix, label, last_used_at, created_at")
    .eq("owner_id", identity.userId).is("revoked_at", null).order("created_at", { ascending: false }).limit(5);
  if (error) return finalize(NextResponse.json({ error: "MCP access is temporarily unavailable." }, { status: 503 }));
  return finalize(NextResponse.json({ keys: data ?? [], endpoint: endpoint() }));
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await readBoundedJson(request, 2_048).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid MCP key label." }, { status: 422 });
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to create an MCP key." }, { status: 401 }));
  const quota = await consumeChatQuota({
    scope: "mcp_key_create", userId: identity.userId, ipAddress: getRequestIp(request), isAuthenticated: true,
    guestMinuteLimit: 1, guestHourLimit: 1, authenticatedMinuteLimit: 2, authenticatedHourLimit: 5,
  }).catch(() => null);
  if (!quota) return finalize(NextResponse.json({ error: "MCP key service is temporarily unavailable." }, { status: 503 }));
  if (!quota.allowed) return finalize(NextResponse.json({ error: "MCP key creation limit reached." }, { status: 429, headers: rateLimitHeaders(quota) }));
  const client = admin();
  const { count } = await client.from("civil_mcp_access_keys").select("key_id", { count: "exact", head: true })
    .eq("owner_id", identity.userId).is("revoked_at", null);
  if ((count ?? 0) >= 5) return finalize(NextResponse.json({ error: "Revoke an existing key before creating another." }, { status: 409 }));
  const token = `cvmcp_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const keyId = randomUUID();
  const { error } = await client.from("civil_mcp_access_keys").insert({
    key_id: keyId, owner_id: identity.userId, token_hash: tokenHash,
    token_prefix: `${token.slice(0, 12)}…`, label: parsed.data.label,
  });
  if (error) return finalize(NextResponse.json({ error: "MCP key could not be created." }, { status: 503 }));
  return finalize(NextResponse.json({ key: { keyId, label: parsed.data.label, tokenPrefix: `${token.slice(0, 12)}…` }, token, endpoint: endpoint() }, { status: 201, headers: rateLimitHeaders(quota) }));
}

export async function DELETE(request: NextRequest) {
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to revoke an MCP key." }, { status: 401 }));
  const keyId = request.nextUrl.searchParams.get("keyId")?.trim();
  if (!keyId) return finalize(NextResponse.json({ error: "keyId is required." }, { status: 400 }));
  const { error } = await admin().from("civil_mcp_access_keys").update({ revoked_at: new Date().toISOString() })
    .eq("owner_id", identity.userId).eq("key_id", keyId).is("revoked_at", null);
  if (error) return finalize(NextResponse.json({ error: "MCP key could not be revoked." }, { status: 503 }));
  return finalize(NextResponse.json({ ok: true }));
}
