import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const eventSchema = z.object({
  event: z.enum([
    "explore_search",
    "paper_open",
    "evidence_open",
    "paper_save",
    "research_path_created",
    "session_export",
    "evidence_export",
  ]),
  properties: z.record(z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])).optional(),
}).superRefine((value, context) => {
  if (Object.keys(value.properties ?? {}).length > 12) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Too many event properties." });
  }
});

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Product event storage is not configured.");
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

  const parsed = eventSchema.safeParse(await readBoundedJson(request, 4_096).catch(() => null));
  if (!parsed.success) return finalize(NextResponse.json({ error: "Invalid product event." }, { status: 422 }));

  const quota = await consumeChatQuota({
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    scope: "product_event",
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 30,
    guestHourLimit: 500,
    authenticatedMinuteLimit: 60,
    authenticatedHourLimit: 1_000,
  }).catch(() => null);
  if (!quota) return finalize(NextResponse.json({ error: "Event service unavailable." }, { status: 503 }));
  if (!quota.allowed) {
    return finalize(NextResponse.json({ error: "Event limit reached." }, { status: 429, headers: rateLimitHeaders(quota) }));
  }

  const { error } = await getSupabaseAdmin().from("civil_product_events").insert({
    event_id: randomUUID(),
    user_id: identity.userId,
    event_name: parsed.data.event,
    properties: parsed.data.properties ?? {},
  });
  if (error) return finalize(NextResponse.json({ error: "Event could not be recorded." }, { status: 503 }));
  return finalize(NextResponse.json({ ok: true }, { headers: rateLimitHeaders(quota) }));
}
