import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota, saveChatFeedback } from "@/lib/chat-store";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const feedbackPayloadSchema = z.object({
  traceId: z.string().trim().min(1).max(120),
  sessionId: z.string().trim().max(120).optional(),
  messageId: z.string().trim().max(160).optional(),
  rating: z.enum(["up", "down"]),
  categories: z
    .array(z.enum(["wrong_citation", "irrelevant_evidence", "too_slow", "ocr_noise", "incomplete", "other"]))
    .max(6)
    .default([]),
  correction: z.string().trim().max(2000).optional(),
  questionSnapshot: z.string().trim().max(12_000).optional(),
  answerSnapshot: z.string().trim().max(40_000).optional(),
});

export async function POST(request: NextRequest) {
  const limit = Number.parseInt(process.env.FEEDBACK_RATE_LIMIT_MAX_CALLS ?? "30", 10);
  const parsed = feedbackPayloadSchema.safeParse(await readBoundedJson(request, 64_000).catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feedback payload." }, { status: 400 });
  }

  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  let rate: Awaited<ReturnType<typeof consumeChatQuota>>;
  try {
    rate = await consumeChatQuota({
      scope: "feedback_write",
      userId: identity.userId,
      ipAddress: getRequestIp(request),
      isAuthenticated: identity.isAuthenticated,
      guestMinuteLimit: limit,
      guestHourLimit: limit * 10,
      authenticatedMinuteLimit: limit,
      authenticatedHourLimit: limit * 10,
    });
  } catch {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Feedback quota service is temporarily unavailable." }, { status: 503 }),
      identity,
      applyAuthCookies,
    );
  }
  if (!rate.allowed) {
    return applyChatIdentityCookies(
      NextResponse.json(
        { error: "Too many feedback submissions. Please retry later." },
        { status: 429, headers: rateLimitHeaders(rate) },
      ),
      identity,
      applyAuthCookies,
    );
  }
  try {
    const feedback = await saveChatFeedback({
      ...parsed.data,
      userId: identity.userId,
      sessionId: parsed.data.sessionId || null,
    });
    const response = NextResponse.json({ ok: true, feedbackId: feedback.feedbackId }, { headers: rateLimitHeaders(rate) });
    return applyChatIdentityCookies(response, identity, applyAuthCookies);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save feedback.";
    const ownershipError = /not found for this user|does not match/i.test(message);
    return applyChatIdentityCookies(
      NextResponse.json(
        { error: ownershipError ? "Feedback target was not found." : "Failed to save feedback." },
        { status: ownershipError ? 404 : 500, headers: rateLimitHeaders(rate) },
      ),
      identity,
      applyAuthCookies,
    );
  }
}
