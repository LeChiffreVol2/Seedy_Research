import { createOpenAI, openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { getBillingState, refundAnswerCredits, reserveAnswerCredits } from "@/lib/billing";
import { consumeChatQuota } from "@/lib/chat-store";
import {
  DEFAULT_CHAT_MODEL,
  isDeepSeekChatModel,
  isOpenAIChatModel,
  type ChatModel,
} from "@/lib/chat-models";
import { getPaperDetail } from "@/lib/research-feed";
import { getPrivateLibraryItem } from "@/lib/private-library";
import {
  deleteResearchWorkspace,
  listResearchWorkspaces,
  upsertResearchWorkspace,
} from "@/lib/research-workspaces";
import { clampEnvNumber, getRequestIp, rateLimitHeaders, readBoundedJson, safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";
const WORKSPACE_GENERATION_TIMEOUT_MS = clampEnvNumber(process.env.WORKSPACE_GENERATION_TIMEOUT_MS, 5_000, 50_000, 40_000);

const modelSchema = z.enum(["deepseek-v4-flash", "deepseek-v4-pro", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
const deepseek = createOpenAI({
  name: "deepseek",
  baseURL: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
  apiKey: process.env.DEEPSEEK_API_KEY,
  compatibility: "compatible",
  fetch: async (input, init) => {
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (typeof body.model === "string" && body.model.startsWith("deepseek-v4-")) {
          body.thinking = { type: "disabled" };
          return fetch(input, { ...init, body: JSON.stringify(body) });
        }
      } catch {
        // Fall through to the unmodified request body.
      }
    }
    return fetch(input, init);
  },
});
const workspaceRowSchema = z.object({
  source: z.string().trim().min(1).max(320),
  title: z.string().trim().min(1).max(320),
  paperCode: z.string().trim().max(80).optional().nullable(),
  collection: z.enum(["", "ce_project", "ncce"]),
});
const workspaceColumnSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_-]{1,48}$/),
  label: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(8).max(500),
});
const saveSchema = z.object({
  action: z.literal("save"),
  workspaceId: z.string().trim().min(8).max(96),
  title: z.string().trim().min(1).max(160),
  collection: z.enum(["", "ce_project", "ncce"]).default(""),
  paperSources: z.array(z.string().trim().min(1).max(320)).max(50),
  state: z.record(z.unknown()),
});
const runSchema = z.object({
  action: z.literal("run"),
  workspaceId: z.string().trim().min(8).max(96),
  runId: z.string().trim().min(8).max(96),
  title: z.string().trim().min(1).max(160),
  model: modelSchema.default(DEFAULT_CHAT_MODEL),
  rows: z.array(workspaceRowSchema).min(1).max(6),
  columns: z.array(workspaceColumnSchema).min(1).max(6),
});
const requestSchema = z.discriminatedUnion("action", [saveSchema, runSchema]);

const generatedWorkspaceSchema = z.object({
  rows: z.array(z.object({
    source: z.string().min(1).max(320),
    cells: z.array(z.object({
      columnId: z.string().min(1).max(48),
      value: z.string().min(1).max(900),
      confidence: z.enum(["high", "medium", "low"]),
      evidenceIds: z.array(z.string().regex(/^P\d+E\d+$/)).max(4),
    })).max(6),
  })).max(6),
});

type RunRequest = z.infer<typeof runSchema>;

function pageLabel(item: { pageStart?: number | null; pageEnd?: number | null }): string {
  if (item.pageStart == null || item.pageEnd == null) return "page unavailable";
  return item.pageStart === item.pageEnd ? `p.${item.pageStart}` : `p.${item.pageStart}-${item.pageEnd}`;
}

function safeText(value: string, limit = 900): string {
  return value.replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

async function resolveIdentityOrResponse(request: NextRequest) {
  try {
    return { resolved: await resolveChatIdentity(request), response: null };
  } catch (error) {
    return { resolved: null, response: chatIdentityErrorResponse(error, request) };
  }
}

async function consumeWorkspaceRunQuota(request: NextRequest, userId: string) {
  return consumeChatQuota({
    scope: "research_workspace_run",
    userId,
    ipAddress: getRequestIp(request),
    isAuthenticated: true,
    guestMinuteLimit: 1,
    guestHourLimit: 1,
    authenticatedMinuteLimit: 3,
    authenticatedHourLimit: 20,
  });
}

async function buildWorkspaceRun(input: RunRequest, ownerId: string) {
  if (isDeepSeekChatModel(input.model) && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek is not configured.");
  }
  const details = (await Promise.all(input.rows.map(async (row) => {
    if (row.source.startsWith("private:")) {
      const item = await getPrivateLibraryItem(ownerId, row.source);
      return item ? {
        row,
        packets: (item.pages ?? []).slice(0, 6).map((page) => ({
          pageStart: page.page,
          pageEnd: page.page,
          sectionTitle: "Private PDF",
          snippet: page.text,
        })),
      } : null;
    }
    const detail = await getPaperDetail(row.source);
    return detail ? { row, packets: detail.evidence.slice(0, 6) } : null;
  }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!details.length) throw new Error("None of the selected papers could be loaded.");

  const evidence = new Map<string, {
    id: string;
    source: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    sectionTitle?: string | null;
    snippet: string;
  }>();
  const paperContexts = details.map(({ row, packets: sourcePackets }, paperIndex) => {
    const packets = sourcePackets.map((item, evidenceIndex) => {
      const id = `P${paperIndex + 1}E${evidenceIndex + 1}`;
      evidence.set(id, {
        id,
        source: row.source,
        pageStart: item.pageStart,
        pageEnd: item.pageEnd,
        sectionTitle: item.sectionTitle,
        snippet: safeText(item.snippet, 420),
      });
      return `[${id}] ${pageLabel(item)} · ${item.sectionTitle || "Indexed evidence"}\n${safeText(item.snippet, 420)}`;
    });
    return [
      `PAPER ${paperIndex + 1}`,
      `Source: ${row.source}`,
      `Title: ${row.title}`,
      `Paper code: ${row.paperCode || "unknown"}`,
      `Collection: ${row.collection || "all"}`,
      packets.join("\n\n"),
    ].join("\n");
  });

  const columnInstructions = input.columns.map((column) => `- ${column.id} (${column.label}): ${column.prompt}`).join("\n");
  const result = await generateObject({
    model: isOpenAIChatModel(input.model) ? openai(input.model) : deepseek(input.model),
    abortSignal: AbortSignal.timeout(WORKSPACE_GENERATION_TIMEOUT_MS),
    schema: generatedWorkspaceSchema,
    system: [
      "You are CivilMCP's bounded batch research agent.",
      "Populate a research matrix using only the supplied page-linked evidence packets.",
      "Return one row per supplied source and one cell per requested column.",
      "Every factual cell must cite 1-4 evidence IDs from its own paper. Never cite another paper's packet in that row.",
      "If evidence is insufficient, say so plainly, use low confidence, and return no evidence IDs.",
      "Do not invent methods, samples, findings, limitations, page numbers, or identifiers.",
      "Write concise Thai unless the requested column explicitly asks for another language.",
    ].join("\n"),
    prompt: [
      `Workspace: ${input.title}`,
      "Requested AI columns:",
      columnInstructions,
      "Research papers and allow-listed evidence:",
      paperContexts.join("\n\n---\n\n"),
    ].join("\n\n"),
    maxTokens: 6_000,
    ...(isOpenAIChatModel(input.model) ? { providerOptions: { openai: { reasoningEffort: "low" } } } : {}),
  });

  const generatedBySource = new Map(result.object.rows.map((row) => [row.source, row]));
  const rows = details.map(({ row }, paperIndex) => {
    const generated = generatedBySource.get(row.source);
    const prefix = `P${paperIndex + 1}E`;
    return {
      source: row.source,
      cells: input.columns.map((column) => {
        const cell = generated?.cells.find((item) => item.columnId === column.id);
        const evidenceIds = [...new Set((cell?.evidenceIds ?? []).filter((id) => id.startsWith(prefix) && evidence.has(id)))].slice(0, 4);
        const packets = evidenceIds.map((id) => evidence.get(id)!).filter(Boolean);
        const supported = packets.length > 0;
        return {
          columnId: column.id,
          value: supported ? safeText(cell?.value ?? "", 900) : "หลักฐานที่เลือกยังไม่เพียงพอสำหรับช่องนี้",
          confidence: supported ? cell?.confidence ?? "low" : "low",
          status: supported ? "ready" : "needs_review",
          evidence: packets,
        };
      }),
    };
  });
  return { rows, usage: result.usage ?? null };
}

type WorkspaceCreditReservation = { requestId: string; charged: number };

async function restoreWorkspaceCredits(
  userId: string,
  reservations: WorkspaceCreditReservation[],
  traceId: string,
): Promise<boolean> {
  const results = await Promise.allSettled(
    reservations.map((item) => refundAnswerCredits(userId, item.requestId, item.charged)),
  );
  const failedRequestIds = results.flatMap((result, index) => result.status === "rejected"
    ? [reservations[index].requestId]
    : []);
  if (failedRequestIds.length > 0) {
    console.error(JSON.stringify({
      event: "civilmcp_workspace_credit_refund_pending",
      traceId,
      failedRequestIds,
    }));
    return false;
  }
  return true;
}

function workspaceCreditRecovery(
  reservations: WorkspaceCreditReservation[],
  restored: boolean,
  traceId: string,
) {
  const charged = reservations.reduce((total, item) => total + item.charged, 0);
  if (charged <= 0) return { state: "not_charged", message: "No credits were charged." };
  if (restored) return { state: "restored", message: "Reserved credits were restored." };
  return {
    state: "pending",
    message: `Credit restoration is pending. Contact support with trace ${traceId}.`,
  };
}

export async function GET(request: NextRequest) {
  const identityResult = await resolveIdentityOrResponse(request);
  if (identityResult.response) return identityResult.response;
  const { identity, applyAuthCookies } = identityResult.resolved!;
  if (!identity.isAuthenticated) {
    return applyChatIdentityCookies(NextResponse.json({ workspaces: [] }), identity, applyAuthCookies);
  }
  try {
    const workspaces = await listResearchWorkspaces(identity.userId);
    return applyChatIdentityCookies(NextResponse.json({ workspaces }), identity, applyAuthCookies);
  } catch {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Saved research workspaces are temporarily unavailable." }, { status: 503 }),
      identity,
      applyAuthCookies,
    );
  }
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await readBoundedJson(request, 600_000).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid research workspace request." }, { status: 400 });
  const identityResult = await resolveIdentityOrResponse(request);
  if (identityResult.response) return identityResult.response;
  const { identity, applyAuthCookies } = identityResult.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) {
    return finalize(NextResponse.json({ error: "Research Workspace Pro requires sign in and Founder Pro.", code: "pro_required" }, { status: 402 }));
  }

  let billing;
  try {
    billing = await getBillingState(identity.userId);
  } catch {
    return finalize(NextResponse.json({ error: "Research Workspace access is temporarily unavailable." }, { status: 503 }));
  }
  if (billing.plan !== "founder_pro" || !billing.premiumModels) {
    return finalize(NextResponse.json({ error: "Research Workspace is included in Founder Pro. Upgrade to continue.", code: "pro_required" }, { status: 402 }));
  }

  if (parsed.data.action === "save") {
    try {
      const workspace = await upsertResearchWorkspace({
        workspaceId: parsed.data.workspaceId,
        ownerId: identity.userId,
        title: parsed.data.title,
        collection: parsed.data.collection,
        paperSources: parsed.data.paperSources,
        state: parsed.data.state,
      });
      return finalize(NextResponse.json({ workspace }));
    } catch {
      return finalize(NextResponse.json({ error: "Research workspace could not be saved." }, { status: 503 }));
    }
  }

  const rate = await consumeWorkspaceRunQuota(request, identity.userId).catch(() => null);
  if (!rate) return finalize(NextResponse.json({ error: "Workspace quota service is temporarily unavailable." }, { status: 503 }));
  if (!rate.allowed) return finalize(NextResponse.json({ error: "Too many research workspace runs." }, { status: 429, headers: rateLimitHeaders(rate) }));

  // The run id is client-visible correlation only. Billing ids are random per
  // execution so replaying a run cannot reuse or refund an earlier reservation.
  const billingExecutionId = safeTraceId();
  const reservations: WorkspaceCreditReservation[] = [];
  for (let index = 0; index < parsed.data.rows.length; index += 1) {
    const requestId = `${billingExecutionId}:paper:${index + 1}`;
    const reservation = await reserveAnswerCredits({
      userId: identity.userId,
      isAuthenticated: true,
      model: parsed.data.model as ChatModel,
      requestId,
    }).catch(() => null);
    if (!reservation?.allowed) {
      const restored = await restoreWorkspaceCredits(identity.userId, reservations, billingExecutionId);
      const recovery = workspaceCreditRecovery(reservations, restored, billingExecutionId);
      return finalize(NextResponse.json({
        error: `${reservation?.reason === "credits_exhausted" ? "Not enough credits for this batch run." : "Workspace credits are temporarily unavailable."} ${recovery.message}`,
        code: reservation?.reason ?? "credit_error",
        traceId: billingExecutionId,
        creditRecovery: recovery.state,
      }, { status: reservation?.reason === "credits_exhausted" ? 402 : 503 }));
    }
    reservations.push({ requestId, charged: reservation.charged });
  }

  try {
    const result = await buildWorkspaceRun(parsed.data, identity.userId);
    return finalize(NextResponse.json({
      version: "civilmcp-research-workspace-run-v1",
      workspaceId: parsed.data.workspaceId,
      runId: parsed.data.runId,
      model: parsed.data.model,
      chargedCredits: reservations.reduce((total, item) => total + item.charged, 0),
      rows: result.rows,
      generatedAt: new Date().toISOString(),
    }, { headers: rateLimitHeaders(rate) }));
  } catch (error) {
    const restored = await restoreWorkspaceCredits(identity.userId, reservations, billingExecutionId);
    const recovery = workspaceCreditRecovery(reservations, restored, billingExecutionId);
    console.error(JSON.stringify({
      event: "civilmcp_workspace_run_failed",
      traceId: billingExecutionId,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return finalize(NextResponse.json({
      error: `The automated research run failed. ${recovery.message}`,
      traceId: billingExecutionId,
      creditRecovery: recovery.state,
    }, { status: 503 }));
  }
}

export async function DELETE(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  const identityResult = await resolveIdentityOrResponse(request);
  if (identityResult.response) return identityResult.response;
  const { identity, applyAuthCookies } = identityResult.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to delete a saved workspace." }, { status: 401 }));
  try {
    await deleteResearchWorkspace(identity.userId, workspaceId);
    return finalize(NextResponse.json({ ok: true }));
  } catch {
    return finalize(NextResponse.json({ error: "Research workspace could not be deleted." }, { status: 503 }));
  }
}
