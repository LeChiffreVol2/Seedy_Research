import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import {
  createLivingReviewWatch, deleteLivingReviewWatch, getLivingReviewWatch,
  listLivingReviewWatches, updateLivingReviewWatch,
} from "@/lib/living-reviews";
import { discoverOpenAlex, normalizeOpenAlexQuery } from "@/lib/openalex";
import { listResearchFeed } from "@/lib/research-feed";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), query: z.string().trim().min(3).max(280), collection: z.enum(["", "ce_project", "ncce"]).default("") }),
  z.object({ action: z.literal("check"), watchId: z.string().uuid() }),
]);

async function identityOrResponse(request: NextRequest) {
  try { return { resolved: await resolveChatIdentity(request), response: null }; }
  catch (error) { return { resolved: null, response: chatIdentityErrorResponse(error, request) }; }
}

async function resultKeys(query: string, collection: "" | "ce_project" | "ncce") {
  const [local, global] = await Promise.all([
    listResearchFeed({ filter: "hot", collection, q: query, limit: 50 }),
    discoverOpenAlex(query, { maxResults: 6 }),
  ]);
  return [...new Set([
    ...local.cards.map((card) => `civil:${card.source}`),
    ...global.works.map((work) => `openalex:${work.id || work.doi || work.title}`),
  ])];
}

export async function GET(request: NextRequest) {
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ watches: [] }));
  try { return finalize(NextResponse.json({ watches: await listLivingReviewWatches(identity.userId) })); }
  catch { return finalize(NextResponse.json({ error: "Living Reviews are temporarily unavailable." }, { status: 503 })); }
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await readBoundedJson(request, 8_192).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Living Review request." }, { status: 422 });
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to watch a research topic." }, { status: 401 }));
  const quota = await consumeChatQuota({
    scope: "living_review_check", userId: identity.userId, ipAddress: getRequestIp(request), isAuthenticated: true,
    guestMinuteLimit: 1, guestHourLimit: 1, authenticatedMinuteLimit: 3, authenticatedHourLimit: 30,
  }).catch(() => null);
  if (!quota) return finalize(NextResponse.json({ error: "Living Review quota is temporarily unavailable." }, { status: 503 }));
  if (!quota.allowed) return finalize(NextResponse.json({ error: "Living Review check limit reached." }, { status: 429, headers: rateLimitHeaders(quota) }));
  try {
    if (parsed.data.action === "create") {
      const query = normalizeOpenAlexQuery(parsed.data.query);
      const watch = await createLivingReviewWatch({ ownerId: identity.userId, query, collection: parsed.data.collection, resultKeys: await resultKeys(query, parsed.data.collection) });
      return finalize(NextResponse.json({ watch }, { status: 201, headers: rateLimitHeaders(quota) }));
    }
    const existing = await getLivingReviewWatch(identity.userId, parsed.data.watchId);
    if (!existing) return finalize(NextResponse.json({ error: "Living Review not found." }, { status: 404 }));
    const previousKeys = Array.isArray(existing.result_keys) ? existing.result_keys.map(String) : [];
    const collection = existing.collection === "ncce" || existing.collection === "ce_project" ? existing.collection : "";
    const watch = await updateLivingReviewWatch({ ownerId: identity.userId, watchId: existing.watch_id, previousKeys, resultKeys: await resultKeys(existing.query, collection) });
    return finalize(NextResponse.json({ watch }, { headers: rateLimitHeaders(quota) }));
  } catch {
    return finalize(NextResponse.json({ error: "Living Review could not be updated." }, { status: 503 }));
  }
}

export async function DELETE(request: NextRequest) {
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to edit Living Reviews." }, { status: 401 }));
  const watchId = request.nextUrl.searchParams.get("watchId")?.trim();
  if (!watchId) return finalize(NextResponse.json({ error: "watchId is required." }, { status: 400 }));
  try { await deleteLivingReviewWatch(identity.userId, watchId); return finalize(NextResponse.json({ ok: true })); }
  catch { return finalize(NextResponse.json({ error: "Living Review could not be removed." }, { status: 503 })); }
}
