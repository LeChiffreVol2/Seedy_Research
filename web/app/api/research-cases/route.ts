import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota, ensureChatUser } from "@/lib/chat-store";
import {
  countCompletedResearchCases,
  getResearchCase,
  listResearchCases,
  reviewResearchCaseEvidence,
  upsertResearchCase,
} from "@/lib/research-cases";
import { getRequestIp, rateLimitHeaders, readBoundedJson, safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  action: z.literal("upsert"),
  caseId: z.string().trim().regex(/^case_[a-z0-9_-]{8,80}$/).optional(),
  question: z.string().trim().min(8).max(500),
  status: z.enum(["active", "completed", "archived"]).default("active"),
  selectedSources: z.array(z.string().trim().min(1).max(320)).max(50).default([]),
  state: z.record(z.unknown()).default({}),
});

const reviewSchema = z.object({
  action: z.literal("review"),
  caseId: z.string().trim().regex(/^case_[a-z0-9_-]{8,80}$/),
  source: z.string().trim().min(1).max(320),
  evidenceId: z.string().trim().min(1).max(120),
  pageAnchor: z.string().trim().min(1).max(180),
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().trim().max(1000).default(""),
});

const requestSchema = z.discriminatedUnion("action", [upsertSchema, reviewSchema]);

async function identityOrResponse(request: NextRequest) {
  try {
    return { resolved: await resolveChatIdentity(request), response: null };
  } catch (error) {
    return { resolved: null, response: chatIdentityErrorResponse(error, request) };
  }
}

export async function GET(request: NextRequest) {
  const identityResult = await identityOrResponse(request);
  if (identityResult.response) return identityResult.response;
  const { identity, applyAuthCookies } = identityResult.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  try {
    const caseId = request.nextUrl.searchParams.get("caseId")?.trim();
    const [cases, completed] = await Promise.all([
      caseId
        ? Promise.resolve([await getResearchCase(identity.userId, caseId)].filter(Boolean))
        : listResearchCases(identity.userId),
      countCompletedResearchCases(identity.userId),
    ]);
    return finalize(NextResponse.json({ cases, summary: { completed } }, { headers: { "Cache-Control": "private, no-store" } }));
  } catch (error) {
    const traceId = safeTraceId();
    console.error("seed_research_cases_read_failed", { traceId, error: error instanceof Error ? error.message : String(error) });
    return finalize(NextResponse.json({ error: "Research Cases are temporarily unavailable.", traceId }, { status: 503 }));
  }
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await readBoundedJson(request, 300_000).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Research Case request." }, { status: 400 });
  const identityResult = await identityOrResponse(request);
  if (identityResult.response) return identityResult.response;
  const { identity, applyAuthCookies } = identityResult.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  try {
    const quota = await consumeChatQuota({
      scope: "research_case_write",
      userId: identity.userId,
      ipAddress: getRequestIp(request),
      isAuthenticated: identity.isAuthenticated,
      guestMinuteLimit: 12,
      guestHourLimit: 120,
      authenticatedMinuteLimit: 30,
      authenticatedHourLimit: 600,
    });
    if (!quota.allowed) {
      return finalize(NextResponse.json(
        { error: "Research Case save limit reached. Please retry shortly." },
        { status: 429, headers: { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" } },
      ));
    }
    await ensureChatUser(identity.userId, {
      displayName: identity.user.displayName,
      email: identity.user.email,
      isGuest: !identity.isAuthenticated,
    });
    const researchCase = parsed.data.action === "review"
      ? await reviewResearchCaseEvidence({ ownerId: identity.userId, ...parsed.data })
      : await upsertResearchCase({ ownerId: identity.userId, ...parsed.data });
    return finalize(NextResponse.json({ researchCase }, { headers: { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" } }));
  } catch (error) {
    const traceId = safeTraceId();
    const message = error instanceof Error ? error.message : String(error);
    console.error("seed_research_case_write_failed", { traceId, error: message });
    const status = /another researcher|not found|not part of this Research Case|does not belong|does not match/.test(message) ? 403 : 503;
    return finalize(NextResponse.json({ error: status === 403 ? message : "Research Case could not be saved.", traceId }, { status }));
  }
}
