import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const supportSchema = z.object({
  email: z.string().trim().email().max(254),
  category: z.enum(["product_support", "data_request", "account_deletion", "source_takedown", "copyright"]),
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(4_000),
  sourceUrl: z.string().trim().url().max(1_000).optional().or(z.literal("")),
}).superRefine((value, context) => {
  if (["source_takedown", "copyright"].includes(value.category) && !value.sourceUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceUrl"], message: "Source URL is required." });
  }
});

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Support storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);

  let payload: unknown;
  try {
    payload = await readBoundedJson(request, 8_192);
  } catch (error) {
    const status = Number((error as { statusCode?: unknown }).statusCode) || 400;
    return finalize(NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status }));
  }
  const parsed = supportSchema.safeParse(payload);
  if (!parsed.success) {
    return finalize(NextResponse.json({ error: "Check the email, category, subject, and request details." }, { status: 422 }));
  }

  const quota = await consumeChatQuota({
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    scope: "support_request",
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 2,
    guestHourLimit: 5,
    authenticatedMinuteLimit: 3,
    authenticatedHourLimit: 10,
  }).catch(() => null);
  if (!quota) {
    return finalize(NextResponse.json({ error: "Support requests are temporarily unavailable." }, { status: 503 }));
  }
  if (!quota.allowed) {
    return finalize(NextResponse.json(
      { error: "Too many requests. Please wait before sending another." },
      { status: 429, headers: rateLimitHeaders(quota) },
    ));
  }

  const requestId = randomUUID();
  const { error } = await getSupabaseAdmin().from("civil_support_requests").insert({
    request_id: requestId,
    user_id: identity.userId,
    email: parsed.data.email,
    category: parsed.data.category,
    subject: parsed.data.subject,
    message: parsed.data.message,
    source_url: parsed.data.sourceUrl || null,
  });
  if (error) {
    console.error(JSON.stringify({ event: "civilmcp_support_write_failed", requestId, error: error.code }));
    return finalize(NextResponse.json({ error: "Your request could not be saved. Please retry." }, { status: 503 }));
  }

  console.info(JSON.stringify({ event: "civilmcp_support_request_created", requestId, category: parsed.data.category }));
  return finalize(NextResponse.json(
    { ok: true, requestId, message: "Request received. Keep this reference for follow-up." },
    { headers: rateLimitHeaders(quota) },
  ));
}
