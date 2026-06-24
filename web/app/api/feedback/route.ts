import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveChatIdentity } from "@/lib/chat-auth";
import { saveChatFeedback } from "@/lib/chat-store";
import { checkRateLimit, rateLimitHeaders, requestIdentityKey } from "@/lib/server-guards";

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
});

export async function POST(request: NextRequest) {
  const limit = Number.parseInt(process.env.FEEDBACK_RATE_LIMIT_MAX_CALLS ?? "30", 10);
  const windowSeconds = Number.parseInt(process.env.FEEDBACK_RATE_LIMIT_WINDOW_SECONDS ?? "60", 10);
  const rate = checkRateLimit(requestIdentityKey(request, "feedback"), limit, windowSeconds);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many feedback submissions. Please retry later." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  const parsed = feedbackPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feedback payload." }, { status: 400, headers: rateLimitHeaders(rate) });
  }

  const { identity, applyAuthCookies } = await resolveChatIdentity(request);
  try {
    const feedback = await saveChatFeedback({
      ...parsed.data,
      userId: identity.userId,
      sessionId: parsed.data.sessionId || null,
    });
    const response = NextResponse.json({ ok: true, feedbackId: feedback.feedbackId }, { headers: rateLimitHeaders(rate) });
    return applyAuthCookies(response);
  } catch (error) {
    return applyAuthCookies(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to save feedback." },
        { status: 500, headers: rateLimitHeaders(rate) },
      ),
    );
  }
}
