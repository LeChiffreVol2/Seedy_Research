import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  applyChatIdentityCookies,
  chatIdentityErrorResponse,
  resolveChatIdentity,
} from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { discoverOpenAlex } from "@/lib/openalex";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  query: z.string().trim().min(2).max(280),
});

export async function POST(request: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);

  const parsed = requestSchema.safeParse(await readBoundedJson(request, 2_048).catch(() => null));
  if (!parsed.success) {
    return finalize(NextResponse.json({ error: "Enter a research topic between 2 and 280 characters." }, { status: 422 }));
  }

  const quota = await consumeChatQuota({
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    scope: "global_discovery",
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 5,
    guestHourLimit: 50,
    authenticatedMinuteLimit: 10,
    authenticatedHourLimit: 100,
  }).catch(() => null);
  if (!quota) {
    return finalize(NextResponse.json(
      { error: "Global discovery is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    ));
  }
  if (!quota.allowed) {
    return finalize(NextResponse.json(
      { error: "Global discovery limit reached.", resetAt: new Date(quota.resetAt).toISOString() },
      { status: 429, headers: { ...rateLimitHeaders(quota), "Cache-Control": "no-store" } },
    ));
  }

  const result = await discoverOpenAlex(parsed.data.query, { maxResults: 6 });
  return finalize(NextResponse.json(
    { ...result, provider: "openalex", generatedAt: new Date().toISOString() },
    { headers: { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" } },
  ));
}
