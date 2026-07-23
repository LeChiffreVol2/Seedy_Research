import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota, ensureChatUser } from "@/lib/chat-store";
import { deleteWorkspaceItem, listWorkspaceItems, upsertWorkspaceItem } from "@/lib/paper-workspace";
import { getResearchCardsBySources } from "@/lib/research-feed";
import { checkRateLimit, getRequestIp, rateLimitHeaders, readBoundedJson, requestIdentityKey } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const workspacePayloadSchema = z.object({
  documentId: z.string().trim().max(160).optional().nullable(),
  source: z.string().trim().min(1).max(320),
  collection: z.string().trim().max(40).optional().nullable(),
  paperCode: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  labels: z.array(z.string().trim().max(60)).max(20).optional(),
});

function checkWorkspaceRate(request: NextRequest) {
  return checkRateLimit(requestIdentityKey(request, "paper_workspace"), 60, 60);
}

async function resolveIdentityOrResponse(request: NextRequest) {
  try {
    return { resolved: await resolveChatIdentity(request), response: null };
  } catch (error) {
    return { resolved: null, response: chatIdentityErrorResponse(error, request) };
  }
}

async function consumeWorkspaceWriteQuota(request: NextRequest, identity: Awaited<ReturnType<typeof resolveChatIdentity>>["identity"]) {
  return consumeChatQuota({
    scope: "workspace_write",
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 30,
    guestHourLimit: 300,
    authenticatedMinuteLimit: 60,
    authenticatedHourLimit: 600,
  });
}

export async function GET(request: NextRequest) {
  const rate = checkWorkspaceRate(request);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many workspace requests." }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  const result = await resolveIdentityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const items = await listWorkspaceItems(identity.userId);
  const cards = await getResearchCardsBySources(items.map((item) => item.source));
  return applyChatIdentityCookies(
    NextResponse.json({ items, cards }, { headers: rateLimitHeaders(rate) }),
    identity,
    applyAuthCookies,
  );
}

export async function POST(request: NextRequest) {
  const parsed = workspacePayloadSchema.safeParse(await readBoundedJson(request, 16_000).catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
  }
  const result = await resolveIdentityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const rate = await consumeWorkspaceWriteQuota(request, identity).catch(() => null);
  if (!rate) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Workspace quota service is temporarily unavailable." }, { status: 503 }),
      identity,
      applyAuthCookies,
    );
  }
  if (!rate.allowed) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Too many workspace requests." }, { status: 429, headers: rateLimitHeaders(rate) }),
      identity,
      applyAuthCookies,
    );
  }
  if (!identity.isAuthenticated) await ensureChatUser(identity.userId, { isGuest: true });
  const item = await upsertWorkspaceItem({ ownerId: identity.userId, ...parsed.data });
  return applyChatIdentityCookies(
    NextResponse.json({ item }, { headers: rateLimitHeaders(rate) }),
    identity,
    applyAuthCookies,
  );
}

export async function DELETE(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source")?.trim();
  if (!source) {
    return NextResponse.json({ error: "source is required." }, { status: 400 });
  }
  const result = await resolveIdentityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const rate = await consumeWorkspaceWriteQuota(request, identity).catch(() => null);
  if (!rate) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Workspace quota service is temporarily unavailable." }, { status: 503 }),
      identity,
      applyAuthCookies,
    );
  }
  if (!rate.allowed) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Too many workspace requests." }, { status: 429, headers: rateLimitHeaders(rate) }),
      identity,
      applyAuthCookies,
    );
  }
  await deleteWorkspaceItem(identity.userId, source);
  return applyChatIdentityCookies(
    NextResponse.json({ ok: true }, { headers: rateLimitHeaders(rate) }),
    identity,
    applyAuthCookies,
  );
}
