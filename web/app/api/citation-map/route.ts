import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { citationMapOpenAlex } from "@/lib/openalex";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ query: z.string().trim().min(3).max(280) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await readBoundedJson(request, 4_096).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A paper title or DOI is required." }, { status: 422 });
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try { resolved = await resolveChatIdentity(request); }
  catch (error) { return chatIdentityErrorResponse(error, request); }
  const { identity, applyAuthCookies } = resolved;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  const quota = await consumeChatQuota({
    scope: "citation_map", userId: identity.userId, ipAddress: getRequestIp(request), isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 2, guestHourLimit: 15, authenticatedMinuteLimit: 5, authenticatedHourLimit: 60,
  }).catch(() => null);
  if (!quota) return finalize(NextResponse.json({ error: "Citation map is temporarily unavailable." }, { status: 503 }));
  if (!quota.allowed) return finalize(NextResponse.json({ error: "Citation map limit reached." }, { status: 429, headers: rateLimitHeaders(quota) }));
  const map = await citationMapOpenAlex(parsed.data.query);
  return finalize(NextResponse.json({ ...map, provider: "openalex", generatedAt: new Date().toISOString() }, { headers: rateLimitHeaders(quota) }));
}
