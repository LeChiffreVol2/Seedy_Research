import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota, ensureChatUser } from "@/lib/chat-store";
import { getRequestIp, rateLimitHeaders, readBoundedJson, safeTraceId } from "@/lib/server-guards";
import { createVisibilityCorrectionSuggestion, listVisibilityCorrectionSuggestions } from "@/lib/visibility-corrections";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const schema = z.object({
  source: z.string().trim().min(1).max(320),
  kind: z.enum(["match", "metadata_correction", "review_request"]).default("review_request"),
  proposedExternalWorkId: z.string().trim().max(180).nullable().optional(),
  proposedDoi: z.string().trim().max(180).nullable().optional(),
  note: z.string().trim().max(1500).default(""),
});

async function identityOrResponse(request: NextRequest) {
  try {
    return { resolved: await resolveChatIdentity(request), response: null };
  } catch (error) {
    return { resolved: null, response: chatIdentityErrorResponse(error, request) };
  }
}

export async function GET(request: NextRequest) {
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  try {
    const source = request.nextUrl.searchParams.get("source")?.trim() ?? "";
    if (source.length > 320) return finalize(NextResponse.json({ error: "Source is too long." }, { status: 422 }));
    const suggestions = await listVisibilityCorrectionSuggestions(identity.userId, source || undefined);
    return finalize(NextResponse.json({ suggestions }, { headers: { "Cache-Control": "private, no-store" } }));
  } catch (error) {
    const traceId = safeTraceId();
    console.error("seed_visibility_correction_list_failed", { traceId, error: error instanceof Error ? error.message : String(error) });
    return finalize(NextResponse.json({ error: "Visibility suggestions are temporarily unavailable.", traceId }, { status: 503 }));
  }
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await readBoundedJson(request, 8_192).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid visibility suggestion." }, { status: 422 });
  const result = await identityOrResponse(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  try {
    const quota = await consumeChatQuota({
      scope: "visibility_correction",
      userId: identity.userId,
      ipAddress: getRequestIp(request),
      isAuthenticated: identity.isAuthenticated,
      guestMinuteLimit: 2,
      guestHourLimit: 12,
      authenticatedMinuteLimit: 6,
      authenticatedHourLimit: 60,
    });
    if (!quota.allowed) return finalize(NextResponse.json(
      { error: "Visibility suggestion limit reached. Please retry later." },
      { status: 429, headers: { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" } },
    ));
    await ensureChatUser(identity.userId, {
      displayName: identity.user.displayName,
      email: identity.user.email,
      isGuest: !identity.isAuthenticated,
    });
    const suggestion = await createVisibilityCorrectionSuggestion({ ownerId: identity.userId, ...parsed.data });
    return finalize(NextResponse.json(
      { suggestion, boundary: "Stored for Seedy steward review. No external index is modified or contacted." },
      { status: 201, headers: { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" } },
    ));
  } catch (error) {
    const traceId = safeTraceId();
    console.error("seed_visibility_correction_create_failed", { traceId, error: error instanceof Error ? error.message : String(error) });
    return finalize(NextResponse.json({ error: "Visibility suggestion could not be saved.", traceId }, { status: 503 }));
  }
}
