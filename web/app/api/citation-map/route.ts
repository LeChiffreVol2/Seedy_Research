import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { citationMapOpenAlex } from "@/lib/openalex";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const schema = z.object({
  query: z.string().trim().min(3).max(280).optional(),
  doi: z.string().trim().max(320).nullable().optional(),
  title: z.string().trim().max(280).nullable().optional(),
  year: z.number().int().min(1800).max(3000).nullable().optional(),
}).superRefine((value, context) => {
  if (!value.query && !value.doi && !value.title) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A paper title or DOI is required." });
  }
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await readBoundedJson(request, 4_096).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A paper title or DOI is required." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try { resolved = await resolveChatIdentity(request); }
  catch (error) { return chatIdentityErrorResponse(error, request); }
  const { identity, applyAuthCookies } = resolved;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  const quota = await consumeChatQuota({
    scope: "citation_map", userId: identity.userId, ipAddress: getRequestIp(request), isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 2, guestHourLimit: 15, authenticatedMinuteLimit: 5, authenticatedHourLimit: 60,
  }).catch(() => null);
  if (!quota) return finalize(NextResponse.json({ error: "Citation map is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }));
  if (!quota.allowed) return finalize(NextResponse.json({ error: "Citation map limit reached." }, { status: 429, headers: { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" } }));
  const map = await citationMapOpenAlex({
    doi: parsed.data.doi ?? parsed.data.query,
    title: parsed.data.title ?? parsed.data.query,
    year: parsed.data.year,
  });
  return finalize(NextResponse.json(
    { ...map, provider: "openalex", generatedAt: new Date().toISOString() },
    { headers: { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" } },
  ));
}
