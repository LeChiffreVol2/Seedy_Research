import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  convertToCoreMessages,
  createDataStreamResponse,
  formatDataStreamPart,
  generateObject,
  generateText,
  streamText,
  StreamData,
} from "ai";
import type { UIMessage } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { assertGuestCookieConfigured } from "@/lib/chat-cookies";
import { consumeChatQuota, ensureChatUser, getChatSessionForOwner, isValidSessionId, saveChatTrace } from "@/lib/chat-store";
import { getBillingState, refundAnswerCredits, reserveAnswerCredits } from "@/lib/billing";
import {
  DEFAULT_CHAT_MODEL,
  isDeepSeekChatModel,
  isOpenAIChatModel,
  normalizeChatModel,
  type ChatModel,
} from "@/lib/chat-models";
import {
  assertRequiredServerEnv,
  clampEnvNumber,
  isPlaceholderSecret,
  getRequestIp,
  rateLimitHeaders,
  readBoundedJson,
  safeTraceId,
} from "@/lib/server-guards";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = ["sin1"];

const MCP_URL = (process.env.MCP_URL ?? process.env.NEXT_PUBLIC_MCP_URL ?? "").replace(/\/+$/, "");
const MCP_SERVER_API_KEY = process.env.MCP_SERVER_API_KEY ?? "";
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");

const AGENTIC_CONTEXT_ENABLED = process.env.AGENTIC_CONTEXT_ENABLED !== "false";
const SIMPLE_RAG_FALLBACK = process.env.SIMPLE_RAG_FALLBACK !== "false";
const ROUTER_MODEL = process.env.ROUTER_MODEL ?? DEFAULT_CHAT_MODEL;
const ROUTER_PROVIDER = normalizeRouterProvider(process.env.ROUTER_PROVIDER, ROUTER_MODEL);
const MAX_AGENT_STEPS = clampNumber(process.env.MAX_AGENT_STEPS, 1, 5, 3);
const MAX_TOOL_CALLS = clampNumber(process.env.MAX_TOOL_CALLS, 1, 8, 4);
const MAX_CONTEXT_CHUNKS = clampNumber(process.env.MAX_CONTEXT_CHUNKS, 1, 16, 8);
const MAX_CONTEXT_TOKENS = clampNumber(process.env.MAX_CONTEXT_TOKENS, 1000, 20000, 8000);
const MAX_EVIDENCE_ITEMS = 6;
const MAX_EVIDENCE_PER_SOURCE = 2;
const RERANK_CANDIDATE_LIMIT = 24;
const EVIDENCE_SNIPPET_CHARS = 420;
const MCP_CHUNK_CANDIDATE_LIMIT = 20;
const AUTO_COMPACT_ENABLED = process.env.AUTO_COMPACT_ENABLED !== "false";
const MEMORY_COMPACT_TRIGGER_RATIO = clampNumber(process.env.MEMORY_COMPACT_TRIGGER_PERCENT, 50, 90, 75) / 100;
const MEMORY_MIN_MESSAGES = clampNumber(process.env.MEMORY_MIN_MESSAGES, 6, 80, 12);
const MEMORY_RECENT_MESSAGES = clampNumber(process.env.MEMORY_RECENT_MESSAGES, 4, 24, 8);
const MEMORY_MAX_SUMMARY_CHARS = clampNumber(process.env.MEMORY_MAX_SUMMARY_CHARS, 800, 8000, 2600);
const MEMORY_MAX_COMPACTION_INPUT_TOKENS = clampNumber(
  process.env.MEMORY_MAX_COMPACTION_INPUT_TOKENS,
  4000,
  40000,
  16000,
);
const CHAT_MAX_BODY_BYTES = clampEnvNumber(process.env.CHAT_MAX_BODY_BYTES, 8_192, 2_000_000, 180_000);
const CHAT_MAX_MESSAGES = clampEnvNumber(process.env.CHAT_MAX_MESSAGES, 2, 200, 80);
const CHAT_MAX_MESSAGE_CHARS = clampEnvNumber(process.env.CHAT_MAX_MESSAGE_CHARS, 500, 80_000, 12_000);
const CHAT_GUEST_REQUESTS_PER_MINUTE = clampEnvNumber(process.env.CHAT_GUEST_REQUESTS_PER_MINUTE, 1, 60, 3);
const CHAT_GUEST_REQUESTS_PER_HOUR = clampEnvNumber(process.env.CHAT_GUEST_REQUESTS_PER_HOUR, 1, 500, 30);
const CHAT_AUTH_REQUESTS_PER_MINUTE = clampEnvNumber(process.env.CHAT_AUTH_REQUESTS_PER_MINUTE, 1, 120, 10);
const CHAT_AUTH_REQUESTS_PER_HOUR = clampEnvNumber(process.env.CHAT_AUTH_REQUESTS_PER_HOUR, 1, 2000, 60);
const ANSWER_MAX_TOKENS = clampEnvNumber(process.env.ANSWER_MAX_TOKENS, 400, 4000, 1500);
const OPENAI_ANSWER_MIN_TOKENS = 2400;

type Intent = "simple_lookup" | "compare" | "summarize" | "methodology" | "citation_search";
type CollectionFilter = "" | "ce_project" | "ncce";
type ChatExperience = "answer" | "mission" | "learn" | "research" | "automated";
type ChatBody = {
  messages: UIMessage[];
  mode?: "baseline" | "mcp";
  experience?: ChatExperience;
  model?: string;
  collection?: string;
  sessionId?: string;
  paperAnchor?: PaperAnchor;
  debug?: boolean;
  contextOnly?: boolean;
  forceCompact?: boolean;
  routerProvider?: string;
  routerModel?: string;
};

type PaperAnchor = {
  source?: string;
  collection?: string;
  paperCode?: string | null;
};

type McpToolPayload = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
};

type SectionResult = {
  id?: string;
  document_id?: string;
  source?: string;
  collection?: string;
  source_type?: string;
  parent_source_pdf?: string;
  paper_code?: string;
  page_start?: number | null;
  page_end?: number | null;
  proceeding_no?: number | null;
  proceeding_year?: number | null;
  discipline?: string;
  section_index?: number;
  section_title?: string;
  similarity?: number;
  content?: string;
};

type ChunkResult = {
  id?: string;
  document_id?: string;
  section_id?: string;
  source?: string;
  collection?: string;
  source_type?: string;
  parent_source_pdf?: string;
  paper_code?: string;
  page_start?: number | null;
  page_end?: number | null;
  proceeding_no?: number | null;
  proceeding_year?: number | null;
  discipline?: string;
  section_index?: number;
  section_title?: string;
  chunk_index?: number;
  similarity?: number | null;
  content?: string;
};

type EvidenceItem = {
  evidenceId: string;
  kind: "section" | "chunk";
  id?: string;
  documentId?: string;
  sectionId?: string;
  sectionIndex?: number | null;
  citation: string;
  source: string;
  collection?: string;
  sourceType?: string;
  parentSourcePdf?: string;
  paperCode?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  sectionTitle?: string;
  chunkIndex?: number | null;
  similarity?: number | null;
  rerankScore?: number;
  snippet: string;
};

type ContextPlan = {
  intent: Intent;
  searchQuery: string;
  discipline: string;
  needsNeighbors: boolean;
  reason: string;
};

type ConversationAnchor = {
  type: "explicit_evidence" | "implicit_followup";
  referencedEvidenceId?: string;
  evidence?: EvidenceItem;
  previousUserText?: string;
  previousAssistantText?: string;
};

type ConversationContext = {
  latestUserText: string;
  retrievalQuestion: string;
  collection: CollectionFilter;
  anchor?: ConversationAnchor;
};

type ActiveEvidenceMemoryItem = {
  evidenceId: string;
  source: string;
  collection?: string;
  paperCode?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  sectionTitle?: string;
  snippet?: string;
};

type MemorySnapshot = {
  type: "civilmcp_memory";
  state: "active" | "compacted";
  runningSummary: string;
  activeEvidenceMap: ActiveEvidenceMemoryItem[];
  generatedAt: string;
  estimatedTokensBefore: number;
  contextWindowTokens: number;
  triggerRatio: number;
  contextFillRatio: number;
  compactedMessageCount: number;
  recentMessageCount: number;
};

type MemoryPreparation = {
  memory: MemorySnapshot | null;
  messagesForModel: UIMessage[];
};

type RouterProvider = "openai" | "deepseek";
type RouterSource = "deterministic" | "llm" | "heuristic_fallback" | "not_used";

type RouterInfo = {
  provider: RouterProvider;
  model: string;
  source: RouterSource;
  latencyMs: number;
};

type RouterPlanResult = {
  plan: ContextPlan;
  source: RouterSource;
  latencyMs: number;
};

type BuiltContext = {
  context: string;
  mode: "agentic_context" | "simple_rag";
  plan?: ContextPlan;
  router: RouterInfo;
  collection: CollectionFilter;
  toolCalls: number;
  chunksSent: number;
  sectionsSent: number;
  estimatedTokens: number;
  evidenceItems: EvidenceItem[];
  contextLatencyMs?: number;
};

type TraceTimings = {
  contextLatencyMs?: number | null;
  answerLatencyMs?: number | null;
  totalLatencyMs?: number | null;
};

const MissionArtifactSchema = z.object({
  title: z.string().min(1).max(120),
  executiveSummary: z.string().min(1).max(900),
  verdict: z.object({
    status: z.enum(["supported", "mixed", "conflicting", "insufficient"]),
    rationale: z.string().min(1).max(600),
  }),
  matrix: z
    .array(
      z.object({
        finding: z.string().min(1).max(360),
        interpretation: z.string().min(1).max(360),
        methodOrContext: z.string().min(1).max(260),
        limitation: z.string().min(1).max(260),
        evidenceIds: z.array(z.string().regex(/^E\d+$/)).min(1).max(4),
      }),
    )
    .min(1)
    .max(6),
  worldBridge: z.object({
    transferableSignals: z.array(z.string().min(1).max(240)).min(1).max(4),
    thaiContext: z.array(z.string().min(1).max(240)).min(1).max(4),
    validateNext: z.array(z.string().min(1).max(240)).min(1).max(4),
  }),
  learning: z.object({
    objective: z.string().min(1).max(320),
    checkpoints: z
      .array(
        z.object({
          question: z.string().min(1).max(280),
          hint: z.string().min(1).max(280),
          evidenceIds: z.array(z.string().regex(/^E\d+$/)).min(1).max(3),
        }),
      )
      .min(2)
      .max(4),
  }),
  automation: z.object({
    objective: z.string().min(1).max(420),
    subquestions: z.array(z.string().min(1).max(260)).min(2).max(5),
    tasks: z.array(z.object({
      name: z.string().min(1).max(80),
      objective: z.string().min(1).max(280),
      status: z.enum(["complete", "limited"]),
      evidenceIds: z.array(z.string().regex(/^E\d+$/)).max(4),
    })).min(3).max(5),
    deliverables: z.array(z.string().min(1).max(160)).min(3).max(6),
  }).optional(),
});

type MissionArtifactCore = z.infer<typeof MissionArtifactSchema>;
type MissionArtifact = MissionArtifactCore & {
  version: "civilmcp-evidence-brief-v1";
  question: string;
  experience: Exclude<ChatExperience, "answer">;
  trust: {
    evidenceCount: number;
    sourceCount: number;
    exactPageCount: number;
    pageCoveragePercent: number;
  };
  agentRun: {
    bounded: true;
    toolCalls: number;
    toolCallLimit: number;
    stepLimit: number;
    stages: Array<{ name: string; detail: string; status: "complete" | "limited" }>;
  };
};

const RouterPlanSchema = z.object({
  intent: z.enum(["simple_lookup", "compare", "summarize", "methodology", "citation_search"]),
  searchQuery: z.string().min(1).max(500),
  discipline: z.enum([
    "",
    "transport",
    "structural",
    "geotechnical",
    "construction_mgmt",
    "water_resources",
    "surveying_gis",
    "environmental",
    "infrastructure",
    "civil_education",
    "ai_engineering",
  ]),
  needsNeighbors: z.boolean(),
  reason: z.string().max(240),
});

const ROUTER_RULES =
  "Intent rules: " +
  "methodology takes precedence over compare when the request mentions methodology, method, survey, simulation, statistical analysis, experiment, models, or data analysis. " +
  "compare = compare across papers, factors, or alternatives only when methodology precedence does not apply. " +
  "citation_search = exact citation/source/quote/where-in-document/limitations evidence requests; generic 'พร้อมหลักฐาน' alone is not enough. " +
  "summarize = broad overview/theme/ภาพรวม synthesis only, not short summary, list, or search requests. " +
  "simple_lookup = direct lookup/search/list/paper ใด/short summary requests. ";

const deepseek = createOpenAI({
  name: "deepseek",
  baseURL: DEEPSEEK_BASE_URL,
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

function clampNumber(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function roundLatencyMs(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

function normalizeRouterProvider(provider: string | undefined, model: string | undefined): RouterProvider {
  const cleanedProvider = (provider ?? "").trim().toLowerCase();
  if (cleanedProvider === "deepseek" || (model ?? "").startsWith("deepseek-")) return "deepseek";
  return "openai";
}

function resolveRouterProvider(providerOverride?: string, modelOverride?: string): RouterProvider {
  return normalizeRouterProvider(providerOverride ?? ROUTER_PROVIDER, modelOverride ?? ROUTER_MODEL);
}

function resolveRouterModel(provider: RouterProvider, modelOverride?: string): string {
  const candidate = (modelOverride ?? ROUTER_MODEL).trim();
  if (provider === "deepseek") {
    return candidate.startsWith("deepseek-") ? candidate : "deepseek-v4-flash";
  }
  return candidate && !candidate.startsWith("deepseek-") ? candidate : "gpt-5.6-luna";
}

function normalizeCollection(value: string | undefined | null): CollectionFilter {
  return value === "ce_project" || value === "ncce" ? value : "";
}

function normalizePaperAnchor(value: PaperAnchor | undefined): PaperAnchor | undefined {
  if (!value) return undefined;
  const source = value.source?.trim();
  if (!source) return undefined;
  return {
    source: source.slice(0, 260),
    collection: normalizeCollection(value.collection),
    paperCode: typeof value.paperCode === "string" ? value.paperCode.trim().slice(0, 80) : undefined,
  };
}

function paperAnchorToConversationAnchor(anchor: PaperAnchor | undefined): ConversationAnchor | undefined {
  const normalized = normalizePaperAnchor(anchor);
  if (!normalized?.source) return undefined;

  return {
    type: "explicit_evidence",
    referencedEvidenceId: "P1",
    evidence: {
      evidenceId: "P1",
      kind: "section",
      source: normalized.source,
      collection: normalizeCollection(normalized.collection),
      paperCode: normalized.paperCode ?? undefined,
      citation: normalized.source,
      snippet:
        "User selected this paper from the dynamic research feed. Retrieval must prioritize this source before broadening.",
    },
  };
}

function inferCollectionFromQuestion(question: string): CollectionFilter {
  const mentionsNCCE = /\bNCCE\b|NCCE25|NCCE26|NCCE29|การประชุมวิชาการ|proceedings?/i.test(question);
  const mentionsCE = /CE Project|TransDoc|CECU|ฐาน\s*CE|(^|[^\p{L}\p{N}])CE($|[^\p{L}\p{N}])/iu.test(question);

  if (mentionsNCCE && mentionsCE) {
    return "";
  }
  if (mentionsNCCE) {
    return "ncce";
  }
  if (mentionsCE) {
    return "ce_project";
  }
  return "";
}

function resolveDefaultModel(): ChatModel {
  return normalizeChatModel(process.env.MODEL ?? DEFAULT_CHAT_MODEL);
}

function resolveModel(requestedModel: string | undefined): ChatModel {
  return normalizeChatModel(requestedModel ?? resolveDefaultModel());
}

function resolveLanguageModel(selectedModel: ChatModel) {
  if (isOpenAIChatModel(selectedModel)) {
    return openai(selectedModel);
  }

  if (isDeepSeekChatModel(selectedModel)) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DeepSeek is not configured: missing DEEPSEEK_API_KEY.");
    }
    return deepseek(selectedModel);
  }

  throw new Error("Unsupported chat model.");
}

function answerGenerationOptions(selectedModel: ChatModel) {
  if (isOpenAIChatModel(selectedModel)) {
    return {
      maxTokens: Math.max(ANSWER_MAX_TOKENS, OPENAI_ANSWER_MIN_TOKENS),
      providerOptions: { openai: { reasoningEffort: "low" } },
    } as const;
  }
  return { maxTokens: ANSWER_MAX_TOKENS } as const;
}

function resolveRouterLanguageModel(provider: RouterProvider, model: string) {
  if (provider === "deepseek") {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DeepSeek router is not configured: missing DEEPSEEK_API_KEY.");
    }
    return deepseek(model);
  }
  return openai(model);
}

function validateChatBody(body: ChatBody): string | null {
  if (!Array.isArray(body.messages)) return "messages must be an array.";
  if (body.messages.length > CHAT_MAX_MESSAGES) {
    return `messages exceeds the limit of ${CHAT_MAX_MESSAGES}.`;
  }

  const latestUserText = getLatestUserText(body.messages);
  if (!latestUserText) return "latest user message is required.";
  if (latestUserText.length > CHAT_MAX_MESSAGE_CHARS) {
    return `latest user message exceeds ${CHAT_MAX_MESSAGE_CHARS} characters.`;
  }

  const totalChars = body.messages.reduce((sum, message) => sum + getMessageText(message).length, 0);
  if (totalChars > CHAT_MAX_MESSAGE_CHARS * Math.max(2, Math.ceil(CHAT_MAX_MESSAGES / 4))) {
    return "conversation payload is too large; start a new chat or wait for memory compaction.";
  }
  if (body.sessionId && !isValidSessionId(body.sessionId)) {
    return "sessionId must be a UUID.";
  }
  if (body.experience && !["answer", "mission", "learn", "research", "automated"].includes(body.experience)) {
    return "experience must be answer, mission, learn, research, or automated.";
  }
  return null;
}

function assertChatRuntimeEnv(mode: ChatBody["mode"], selectedModel: ChatModel, routerProvider: RouterProvider) {
  const requirements: Array<{ name: string; value?: string | null; secret?: boolean }> = [];
  if (isOpenAIChatModel(selectedModel)) {
    requirements.push({ name: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY, secret: true });
  }
  if (isDeepSeekChatModel(selectedModel)) {
    requirements.push({ name: "DEEPSEEK_API_KEY", value: process.env.DEEPSEEK_API_KEY, secret: true });
  }
  if (mode !== "baseline") {
    requirements.push(
      { name: "MCP_URL", value: process.env.MCP_URL },
      { name: "MCP_SERVER_API_KEY", value: MCP_SERVER_API_KEY, secret: true },
    );
    if (routerProvider === "deepseek") {
      requirements.push({ name: "DEEPSEEK_API_KEY", value: process.env.DEEPSEEK_API_KEY, secret: true });
    } else {
      requirements.push({ name: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY, secret: true });
    }
  }
  assertRequiredServerEnv(requirements);
}

function assertChatSecurityEnv() {
  assertRequiredServerEnv([
    { name: "SUPABASE_URL", value: process.env.SUPABASE_URL },
    { name: "SUPABASE_SERVICE_KEY", value: process.env.SUPABASE_SERVICE_KEY, secret: true },
    {
      name: "SUPABASE_ANON_KEY",
      value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
      secret: true,
    },
  ]);
  assertGuestCookieConfigured();
}

function normalizeUsage(usage: unknown): Record<string, unknown> | null {
  return usage && typeof usage === "object" ? (usage as Record<string, unknown>) : null;
}

function usageNumber(usage: Record<string, unknown> | null, keys: string[]): number {
  for (const key of keys) {
    const value = usage?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function estimateCostUsd(model: string, usage: Record<string, unknown> | null): number | null {
  if (!usage) return null;
  const inputTokens = usageNumber(usage, ["promptTokens", "inputTokens", "prompt_tokens", "input_tokens"]);
  const outputTokens = usageNumber(usage, ["completionTokens", "outputTokens", "completion_tokens", "output_tokens"]);
  if (!inputTokens && !outputTokens) return null;
  const openAiRates: Record<string, [number, number]> = {
    "gpt-5.6-luna": [0.001, 0.006],
    "gpt-5.6-terra": [0.0025, 0.015],
    "gpt-5.6-sol": [0.005, 0.03],
  };
  const configuredRates = openAiRates[model];
  const inputPer1k = configuredRates?.[0] ?? Number.parseFloat(process.env.CHAT_COST_INPUT_PER_1K_USD ?? "");
  const outputPer1k = configuredRates?.[1] ?? Number.parseFloat(process.env.CHAT_COST_OUTPUT_PER_1K_USD ?? "");
  if (!Number.isFinite(inputPer1k) || !Number.isFinite(outputPer1k)) return null;
  return Number(((inputTokens / 1000) * inputPer1k + (outputTokens / 1000) * outputPer1k).toFixed(6));
}

function citationMarkers(answer: string): string[] {
  return [...new Set(Array.from(answer.matchAll(/\[(E\d+)\]/g)).map((match) => match[1]))];
}

async function saveChatTraceSafe(trace: Parameters<typeof saveChatTrace>[0]): Promise<boolean> {
  try {
    await saveChatTrace(trace);
    return true;
  } catch (error) {
    console.warn("civilmcp_trace_persist_failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function getLatestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;

    const text = (message.parts ?? [])
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (text) return text;

    const legacyContent = (message as unknown as { content?: unknown }).content;
    if (typeof legacyContent === "string" && legacyContent.trim()) {
      return legacyContent.trim();
    }
  }
  return "";
}

function getMessageText(message: UIMessage | undefined): string {
  if (!message) return "";

  const partsText = (message.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (partsText) return partsText;

  const legacyContent = (message as unknown as { content?: unknown }).content;
  return typeof legacyContent === "string" ? legacyContent.trim() : "";
}

function getCivilMcpAnnotation(message: UIMessage | undefined): { evidenceItems?: EvidenceItem[]; collection?: string } | null {
  const annotations = (message as unknown as { annotations?: unknown } | undefined)?.annotations;
  if (!Array.isArray(annotations)) return null;

  const annotation = annotations.find(
    (item): item is { type: string; evidenceItems?: EvidenceItem[]; collection?: string } =>
      Boolean(item) && typeof item === "object" && (item as { type?: unknown }).type === "civilmcp_context",
  );
  return annotation ?? null;
}

function getCivilMemoryAnnotation(message: UIMessage | undefined): MemorySnapshot | null {
  const annotations = (message as unknown as { annotations?: unknown } | undefined)?.annotations;
  if (!Array.isArray(annotations)) return null;

  const annotation = annotations.find(
    (item): item is MemorySnapshot =>
      Boolean(item) && typeof item === "object" && (item as { type?: unknown }).type === "civilmcp_memory",
  );
  return annotation ?? null;
}

function getLatestMemorySnapshot(messages: UIMessage[]): MemorySnapshot | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const memory = getCivilMemoryAnnotation(messages[i]);
    if (memory?.runningSummary) return memory;
  }
  return null;
}

function evidenceIdFromFollowUp(text: string): string | undefined {
  const explicit = text.match(/\[?\s*E\s*([1-9]\d?)\s*\]?/i);
  if (explicit?.[1]) return `E${Number(explicit[1])}`;

  const thaiOrdinal = text.match(/(?:อัน|ข้อ|ลำดับ|รายการ|ตัว)\s*(?:ที่)?\s*([1-9]\d?)/i);
  if (thaiOrdinal?.[1]) return `E${Number(thaiOrdinal[1])}`;

  return undefined;
}

function isFollowUpText(text: string): boolean {
  return (
    Boolean(evidenceIdFromFollowUp(text)) ||
    /(เพิ่มเติม|ต่อ|ขยาย|ลงลึก|ละเอียด|อันนี้|อันนั้น|ประเด็นนี้|หัวข้อนี้|paper นี้|งานนี้|แหล่งนี้|source นี้|more|detail|elaborate|continue|follow[-\s]?up)/i.test(
      text,
    )
  );
}

function findPreviousUserText(messages: UIMessage[], beforeIndex: number): string | undefined {
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    const text = getMessageText(messages[i]);
    if (text) return text;
  }
  return undefined;
}

function fallbackEvidenceFromAssistantText(
  assistantText: string,
  referencedEvidenceId: string | undefined,
): EvidenceItem | undefined {
  if (!assistantText.trim()) return undefined;

  const lines = assistantText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line =
    referencedEvidenceId != null
      ? lines.find((item) => item.includes(`[${referencedEvidenceId}]`) || item.includes(referencedEvidenceId))
      : lines.find((item) => /\b[A-Z0-9][A-Z0-9_-]+\.md\b/i.test(item));
  if (!line) return undefined;

  const source = line.match(/\b([A-Z0-9][A-Z0-9_-]+\.md)\b/i)?.[1];
  if (!source) return undefined;

  return {
    evidenceId: referencedEvidenceId ?? "E1",
    kind: "section",
    source,
    citation: source,
    snippet: cleanEvidenceText(line, EVIDENCE_SNIPPET_CHARS),
  };
}

function resolveConversationAnchor(messages: UIMessage[], latestUserText: string): ConversationAnchor | undefined {
  if (!isFollowUpText(latestUserText)) return undefined;

  const referencedEvidenceId = evidenceIdFromFollowUp(latestUserText);
  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;

    const annotation = getCivilMcpAnnotation(message);
    const evidenceItems = annotation?.evidenceItems ?? [];
    const evidence =
      referencedEvidenceId != null
        ? evidenceItems.find((item) => item.evidenceId.toLowerCase() === referencedEvidenceId.toLowerCase())
        : evidenceItems[0];

    const assistantText = getMessageText(message);
    const fallbackEvidence = evidence ?? fallbackEvidenceFromAssistantText(assistantText, referencedEvidenceId);
    if (!fallbackEvidence && referencedEvidenceId) continue;

    return {
      type: referencedEvidenceId ? "explicit_evidence" : "implicit_followup",
      referencedEvidenceId,
      evidence: fallbackEvidence,
      previousUserText: findPreviousUserText(messages, i),
      previousAssistantText: assistantText.slice(0, 1200),
    };
  }

  const memory = getLatestMemorySnapshot(messages);
  const memoryEvidence =
    referencedEvidenceId != null
      ? memory?.activeEvidenceMap.find((item) => item.evidenceId.toLowerCase() === referencedEvidenceId.toLowerCase())
      : memory?.activeEvidenceMap[0];

  if (memory && memoryEvidence) {
    return {
      type: referencedEvidenceId ? "explicit_evidence" : "implicit_followup",
      referencedEvidenceId,
      evidence: {
        evidenceId: memoryEvidence.evidenceId,
        kind: "section",
        source: memoryEvidence.source,
        collection: memoryEvidence.collection,
        paperCode: memoryEvidence.paperCode,
        pageStart: memoryEvidence.pageStart,
        pageEnd: memoryEvidence.pageEnd,
        sectionTitle: memoryEvidence.sectionTitle,
        citation: memoryEvidence.source,
        snippet: memoryEvidence.snippet ?? memory.runningSummary,
      },
    };
  }

  return undefined;
}

function buildConversationContext(messages: UIMessage[], latestUserText: string): ConversationContext {
  const anchor = resolveConversationAnchor(messages, latestUserText);
  const evidence = anchor?.evidence;
  const anchorText = evidence
    ? [
        `Previous evidence ${anchor.referencedEvidenceId ?? evidence.evidenceId}:`,
        `source=${evidence.source}`,
        evidence.collection ? `collection=${evidence.collection}` : "",
        evidence.paperCode ? `paper_code=${evidence.paperCode}` : "",
        evidence.sectionTitle ? `section=${evidence.sectionTitle}` : "",
        evidence.pageStart != null ? `page=${pageLabel({ page_start: evidence.pageStart, page_end: evidence.pageEnd })}` : "",
        evidence.snippet ? `snippet=${evidence.snippet}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const retrievalQuestion = anchor
    ? [
        `Current follow-up question: ${latestUserText}`,
        anchor.previousUserText ? `Previous user question: ${anchor.previousUserText}` : "",
        anchorText,
        "Resolve pronouns and evidence markers against the previous evidence above. Keep retrieval anchored to this paper/source unless the user asks to broaden.",
      ]
        .filter(Boolean)
        .join("\n\n")
    : latestUserText;

  return {
    latestUserText,
    retrievalQuestion,
    collection: normalizeCollection(evidence?.collection) || "",
    anchor,
  };
}

function contextWindowTokensForModel(model: ChatModel): number {
  const override = Number.parseInt(process.env.MODEL_CONTEXT_WINDOW_TOKENS ?? "", 10);
  if (Number.isFinite(override) && override >= 8000) return override;
  if (model.startsWith("gpt-5.6")) return 1_050_000;
  if (model.startsWith("deepseek")) return 64000;
  return 64000;
}

function estimateMessagesTokens(messages: UIMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(getMessageText(message)), 0);
}

function compactSnippet(value: string | undefined, maxChars = 220): string {
  const cleaned = cleanEvidenceText(value ?? "", maxChars);
  return cleaned.startsWith("No readable") ? "" : cleaned;
}

function memoryEvidenceKey(item: ActiveEvidenceMemoryItem): string {
  return `${item.source}:${item.sectionTitle ?? ""}:${item.pageStart ?? ""}:${item.pageEnd ?? ""}`;
}

function collectActiveEvidenceMap(messages: UIMessage[], previousMemory: MemorySnapshot | null): ActiveEvidenceMemoryItem[] {
  const results: ActiveEvidenceMemoryItem[] = [];
  const seen = new Set<string>();

  const addItem = (item: ActiveEvidenceMemoryItem) => {
    if (!item.source) return;
    const key = memoryEvidenceKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ ...item, evidenceId: `E${results.length + 1}` });
  };

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const annotation = getCivilMcpAnnotation(messages[i]);
    const evidenceItems = annotation?.evidenceItems ?? [];
    for (let j = 0; j < evidenceItems.length; j += 1) {
      const evidence = evidenceItems[j];
      addItem({
        evidenceId: evidence.evidenceId,
        source: evidence.source,
        collection: evidence.collection,
        paperCode: evidence.paperCode,
        pageStart: evidence.pageStart,
        pageEnd: evidence.pageEnd,
        sectionTitle: evidence.sectionTitle,
        snippet: compactSnippet(evidence.snippet),
      });
      if (results.length >= 12) return results;
    }
  }

  for (const evidence of previousMemory?.activeEvidenceMap ?? []) {
    addItem({
      ...evidence,
      snippet: compactSnippet(evidence.snippet),
    });
    if (results.length >= 12) break;
  }

  return results;
}

function formatMessagesForCompaction(messages: UIMessage[], maxTokens: number): string {
  const formatted: string[] = [];
  let usedTokens = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = getMessageText(messages[i]);
    if (!text) continue;
    const line = `${messages[i].role.toUpperCase()}: ${text.slice(0, 4000)}`;
    const tokens = estimateTokens(line);
    if (formatted.length > 0 && usedTokens + tokens > maxTokens) break;
    formatted.unshift(line);
    usedTokens += tokens;
  }

  return formatted.join("\n\n---\n\n");
}

function fallbackRunningSummary(messages: UIMessage[], previousMemory: MemorySnapshot | null): string {
  const userTurns = messages
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => `- ${getMessageText(message).slice(0, 220)}`)
    .filter((line) => line.length > 2)
    .join("\n");

  return [
    previousMemory?.runningSummary ? `Previous summary:\n${previousMemory.runningSummary}` : "",
    userTurns ? `Recent user goals:\n${userTurns}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MEMORY_MAX_SUMMARY_CHARS);
}

async function generateRunningSummary(
  messagesToCompact: UIMessage[],
  previousMemory: MemorySnapshot | null,
  routerProvider: RouterProvider,
  routerModel: string,
): Promise<string> {
  if (!messagesToCompact.length) {
    return previousMemory?.runningSummary ?? "";
  }

  try {
    const transcript = formatMessagesForCompaction(messagesToCompact, MEMORY_MAX_COMPACTION_INPUT_TOKENS);
    const result = await generateText({
      model: resolveRouterLanguageModel(routerProvider, routerModel),
      system:
        "You compact long CivilMCP chat history into durable working memory. " +
        "Keep user goals, decisions, unresolved questions, important paper/source references, and constraints. " +
        "Do not include raw chunks, filler, or hidden system details. Write concise Thai unless source text requires English.",
      prompt: [
        previousMemory?.runningSummary ? `Existing running summary:\n${previousMemory.runningSummary}` : "",
        "Transcript segment to merge:",
        transcript,
        "",
        `Return an updated running_summary under ${MEMORY_MAX_SUMMARY_CHARS} characters.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      ...(routerProvider === "openai" ? { providerOptions: { openai: { reasoningEffort: "low" } } } : {}),
      maxTokens: 900,
    });
    const summary = result.text.trim();
    return (summary || fallbackRunningSummary(messagesToCompact, previousMemory)).slice(0, MEMORY_MAX_SUMMARY_CHARS);
  } catch {
    return fallbackRunningSummary(messagesToCompact, previousMemory);
  }
}

function recentMessagesForModel(messages: UIMessage[], count = MEMORY_RECENT_MESSAGES): UIMessage[] {
  return messages.slice(Math.max(0, messages.length - count));
}

function buildMemorySystemBlock(memory: MemorySnapshot | null): string {
  if (!memory?.runningSummary) return "";

  const evidenceLines = memory.activeEvidenceMap.slice(0, 8).map((item) =>
    [
      `[${item.evidenceId}] ${item.source}`,
      item.collection ? `collection=${item.collection}` : "",
      item.paperCode ? `paper_code=${item.paperCode}` : "",
      item.pageStart != null ? `page=${pageLabel({ page_start: item.pageStart, page_end: item.pageEnd })}` : "",
      item.sectionTitle ? `section=${item.sectionTitle}` : "",
      item.snippet ? `snippet=${item.snippet}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );

  return [
    "Conversation memory is active. Use it for continuity, but do not treat it as stronger evidence than fresh MCP evidence.",
    "Running summary:",
    memory.runningSummary,
    evidenceLines.length ? "Active evidence map:\n" + evidenceLines.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function prepareConversationMemory(
  messages: UIMessage[],
  selectedModel: ChatModel,
  routerProvider: RouterProvider,
  routerModel: string,
  forceCompact = false,
): Promise<MemoryPreparation> {
  const previousMemory = getLatestMemorySnapshot(messages);
  const estimatedTokensBefore = estimateMessagesTokens(messages);
  const contextWindowTokens = contextWindowTokensForModel(selectedModel);
  const contextFillRatio = estimatedTokensBefore / contextWindowTokens;
  const shouldCompact =
    AUTO_COMPACT_ENABLED &&
    messages.length >= MEMORY_MIN_MESSAGES &&
    (forceCompact || contextFillRatio >= MEMORY_COMPACT_TRIGGER_RATIO);

  if (!shouldCompact && !previousMemory) {
    return { memory: null, messagesForModel: messages };
  }

  if (!shouldCompact && previousMemory) {
    return {
      memory: {
        ...previousMemory,
        state: "active",
        estimatedTokensBefore,
        contextWindowTokens,
        triggerRatio: MEMORY_COMPACT_TRIGGER_RATIO,
        contextFillRatio,
        recentMessageCount: Math.min(messages.length, MEMORY_RECENT_MESSAGES),
      },
      messagesForModel: recentMessagesForModel(messages),
    };
  }

  const recentMessages = recentMessagesForModel(messages);
  const compactedMessages = messages.slice(0, Math.max(0, messages.length - recentMessages.length));
  const runningSummary = await generateRunningSummary(compactedMessages, previousMemory, routerProvider, routerModel);
  const memory: MemorySnapshot = {
    type: "civilmcp_memory",
    state: "compacted",
    runningSummary,
    activeEvidenceMap: collectActiveEvidenceMap(messages, previousMemory),
    generatedAt: new Date().toISOString(),
    estimatedTokensBefore,
    contextWindowTokens,
    triggerRatio: MEMORY_COMPACT_TRIGGER_RATIO,
    contextFillRatio,
    compactedMessageCount: compactedMessages.length,
    recentMessageCount: recentMessages.length,
  };

  return {
    memory,
    messagesForModel: recentMessages,
  };
}

async function callMcpToolPayload(name: string, args: Record<string, unknown>): Promise<McpToolPayload> {
  if (!MCP_URL) {
    throw new Error("MCP is not configured: missing MCP_URL (or NEXT_PUBLIC_MCP_URL).");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MCP_SERVER_API_KEY) {
    headers.Authorization = `Bearer ${MCP_SERVER_API_KEY}`;
  }

  const response = await fetch(`${MCP_URL}/tools/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, arguments: args }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MCP call failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as McpToolPayload;
}

function mcpPayloadToText(payload: McpToolPayload): string {
  const text = payload.content?.find((item) => item.type === "text" && item.text)?.text;
  if (text) return text;
  if (payload.structuredContent !== undefined) return JSON.stringify(payload.structuredContent, null, 2);
  return "No result from MCP tool.";
}

function getStructuredResults<T>(payload: McpToolPayload): T[] {
  const structured = payload.structuredContent as { results?: unknown } | undefined;
  return Array.isArray(structured?.results) ? (structured.results as T[]) : [];
}

function cleanEvidenceText(value: string | undefined, maxChars = EVIDENCE_SNIPPET_CHARS): string {
  const text = (value ?? "")
    .replace(/\r/g, "\n")
    .replace(/^#{1,6}\s*Page\s+\d+\s*$/gim, "")
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/การประชุมวิชาการวิศวกรรมโยธาแห่งชาติ/i.test(line)) return false;
      if (/National Convention on Civil Engineering/i.test(line)) return false;
      if (/Online Conference|การประชุมรูปแบบออนไลน์/i.test(line)) return false;
      if (/วันที่\s+\d{1,2}|\bTHAILAND\b|จ\.ชลบุรี|จ\.เชียงใหม่|จ\.ภูเก็ต/i.test(line)) return false;
      if (/^\d{1,2}-\d{1,2}\s+(May|June|July)\s+\d{4}/i.test(line)) return false;
      const referenceMarkers = line.match(/\[\d+\]/g)?.length ?? 0;
      const referenceLike =
        /(Journal|Proceedings?|Conference|ACI|ASTM|JSCE|University|doi|ISBN|pp\.|Materials|Structures)/i.test(line);
      if (referenceMarkers >= 2 && referenceLike) return false;
      if (/^\[\d+\]/.test(line) && referenceLike) return false;
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "No readable evidence snippet was available after OCR cleanup.";
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}

async function callSimpleRagContext(
  query: string,
  routerProvider: RouterProvider = resolveRouterProvider(),
  routerModel: string = resolveRouterModel(resolveRouterProvider()),
  collection: CollectionFilter = "",
): Promise<BuiltContext> {
  try {
    const payload = await callMcpToolPayload("search_civil_knowledge", {
      query: query || "civil engineering",
      discipline: "",
      max_results: Math.min(5, MAX_CONTEXT_CHUNKS),
      collection,
    });
    const fallbackChunks = getStructuredResults<ChunkResult>(payload);
    const rerankedFallbackChunks = rerankChunks(dedupeChunks(fallbackChunks), query, "simple_lookup");
    const evidenceItems = buildEvidenceItems([], rerankedFallbackChunks, query, "simple_lookup");
    const text = evidenceItems.length
      ? buildEvidenceContext(evidenceItems)
      : `Simple RAG fallback context:\n${mcpPayloadToText(payload)}`;
    return {
      context: text,
      mode: "simple_rag",
      router: { provider: routerProvider, model: routerModel, source: "not_used", latencyMs: 0 },
      collection,
      toolCalls: 1,
      chunksSent: evidenceItems.length,
      sectionsSent: 0,
      estimatedTokens: estimateTokens(text),
      evidenceItems,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      context: `MCP call exception: ${message}`,
      mode: "simple_rag",
      router: { provider: routerProvider, model: routerModel, source: "not_used", latencyMs: 0 },
      collection,
      toolCalls: 1,
      chunksSent: 0,
      sectionsSent: 0,
      estimatedTokens: estimateTokens(message),
      evidenceItems: [],
    };
  }
}

function explicitDisciplineForQuestion(question: string): string {
  const q = question.trim();
  if (/construction\s+(?:delay|cost|management|project)|cost\s+overrun|ความล่าช้า[^\n]{0,40}ก่อสร้าง|ต้นทุน[^\n]{0,40}ก่อสร้าง|บริหาร[^\n]{0,40}ก่อสร้าง/iu.test(q)) return "construction_mgmt";
  if (/transport(?:ation)?|traffic|road\s+safety|road\s+accident|จราจร|ขนส่ง|ความปลอดภัย[^\n]{0,30}ถนน|อุบัติเหตุ[^\n]{0,30}(?:ถนน|ทาง)/iu.test(q)) return "transport";
  if (/structural|concrete|beam|column|โครงสร้าง|คอนกรีต/iu.test(q)) return "structural";
  if (/geotechnical|soil|foundation|ปฐพี|ชั้นดิน|ฐานราก/iu.test(q)) return "geotechnical";
  if (/water\s+resources?|hydraulic|flood|ชลศาสตร์|ชัลประทาน|น้ำท่วม/iu.test(q)) return "water_resources";
  if (/survey(?:ing)?|\bgis\b|สำรวจ|ภูมิสารสนเทศ/iu.test(q)) return "surveying_gis";
  if (/environment(?:al)?|pollution|wastewater|สิ่งแวดล้อม|มลพิษ|น้ำเสีย/iu.test(q)) return "environmental";
  if (/infrastructure|โครงสร้างพื้นฐาน/iu.test(q)) return "infrastructure";
  return "";
}

function contextPlanForIntent(question: string, intent: Intent, reason: string): ContextPlan {
  return {
    intent,
    searchQuery: question || "civil engineering",
    discipline: explicitDisciplineForQuestion(question),
    needsNeighbors: intent === "citation_search",
    reason,
  };
}

function explicitPaperSources(question: string): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  const add = (source: string) => {
    if (seen.has(source) || sources.length >= Math.min(MAX_AGENT_STEPS, MAX_TOOL_CALLS)) return;
    seen.add(source);
    sources.push(source);
  };
  for (const match of question.matchAll(/\bNCCE(25|26|29)_([A-Z]{2,4}-?\d{1,3})\b/gi)) {
    add(`NCCE${match[1]}_${match[2].toUpperCase()}.md`);
  }
  for (const match of question.matchAll(/\bY(2019|202[0-4])_TR_Article_G(\d{2})\b/gi)) {
    add(`Y${match[1]}_TR_Article_G${match[2]}.md`);
  }
  return sources;
}

function hasMixedExplicitPaperCollections(question: string): boolean {
  const collections = new Set(
    explicitPaperSources(question).map((source) => (source.startsWith("NCCE") ? "ncce" : "ce_project")),
  );
  return collections.size > 1;
}

function deterministicPlan(question: string): ContextPlan | null {
  const q = question.trim();
  if (!q) return contextPlanForIntent(question, "simple_lookup", "deterministic pre-pass: empty question fallback");

  const exactCitationPattern =
    /citation|cite\b|อ้างอิง|quote|exact|verbatim|\bsources?\b(?!\s*=)|แหล่งที่มา|ตรงไหน|ที่ไหน|where\b|หน้าไหน|\bpage\b|(?:evidence|หลักฐาน)[^\n]{0,80}citation|citation[^\n]{0,80}(?:evidence|หลักฐาน)|(?:limitations?|ข้อจำกัด)[^\n]{0,80}(?:evidence|citation|หลักฐาน|อ้างอิง)|(?:evidence|citation|หลักฐาน|อ้างอิง)[^\n]{0,80}(?:limitations?|ข้อจำกัด)/iu;
  if (exactCitationPattern.test(q)) {
    return contextPlanForIntent(q, "citation_search", "deterministic pre-pass: exact citation/source/quote/where/limitations evidence");
  }

  const methodologyPattern =
    /methodolog(?:y|ies)|\bmethods?\b|วิธี(?:วิจัย|วิเคราะห์|ทดลอง)?|การทดลอง|ทดลอง|experiments?|experimental|survey|simulation|statistical\s+analysis|วิเคราะห์\s*เชิง\s*สถิติ|สถิติ|วิเคราะห์ข้อมูล|data\s+analysis|models?|modeling|โมเดล|แบบจำลอง/iu;
  if (methodologyPattern.test(q)) {
    return contextPlanForIntent(q, "methodology", "deterministic pre-pass: methodology terms override compare");
  }

  const simpleLookupPattern =
    /ค้น|\bsearch\b|\blist\b|ลิสต์|รายชื่อ|paper\s*ใด|papers?\s*(?:ใด|ไหน)|งาน\s*(?:ใด|ไหน)|บทความ\s*(?:ใด|ไหน)|short\s+summar(?:y|ies)|สรุป(?:แบบ)?สั้น|แบบสั้น|สรุปหัวข้อสำคัญ/iu;
  if (simpleLookupPattern.test(q)) {
    return contextPlanForIntent(q, "simple_lookup", "deterministic pre-pass: lookup/list/search/short summary");
  }

  const broadSummaryPattern = /overview|ภาพรวม|research\s+themes?|themes?|thematic|จัดกลุ่ม|synthesis|landscape|แนวโน้ม/iu;
  if (broadSummaryPattern.test(q)) {
    return contextPlanForIntent(q, "summarize", "deterministic pre-pass: broad overview/theme request");
  }

  const comparePattern = /compare|comparison|เทียบ|เปรียบเทียบ|แตกต่าง|ต่างกัน|similar|difference/iu;
  if (comparePattern.test(q)) {
    return contextPlanForIntent(q, "compare", "deterministic pre-pass: comparison request");
  }

  const genericSummaryOrEvidencePattern = /summari[sz]e|summary|สรุป|พร้อมหลักฐาน|with\s+evidence/iu;
  if (genericSummaryOrEvidencePattern.test(q)) {
    return contextPlanForIntent(q, "simple_lookup", "deterministic pre-pass: generic summary/evidence request");
  }

  return null;
}

function heuristicPlan(question: string): ContextPlan {
  const deterministic = deterministicPlan(question);
  if (deterministic) {
    return {
      ...deterministic,
      reason: deterministic.reason.replace("deterministic pre-pass", "heuristic fallback"),
    };
  }

  return contextPlanForIntent(question, "simple_lookup", "heuristic fallback");
}

async function planContext(
  question: string,
  routerProvider: RouterProvider,
  routerModel: string,
): Promise<RouterPlanResult> {
  const started = performance.now();
  const deterministic = deterministicPlan(question);
  if (deterministic) {
    return {
      plan: deterministic,
      source: "deterministic",
      latencyMs: roundLatencyMs(performance.now() - started),
    };
  }

  if (routerProvider === "deepseek") {
    const plan = await planContextWithDeepSeek(question, routerModel);
    return {
      plan: plan ?? heuristicPlan(question),
      source: plan ? "llm" : "heuristic_fallback",
      latencyMs: roundLatencyMs(performance.now() - started),
    };
  }

  try {
    const result = await generateObject({
      model: resolveRouterLanguageModel(routerProvider, routerModel),
      schema: RouterPlanSchema,
      prompt:
        "Classify a Civil Engineering paper QA request into a bounded retrieval plan. " +
        ROUTER_RULES +
        "Prefer cheap retrieval. Use discipline only when the user explicitly gives one. " +
        "Return a concise searchQuery optimized for semantic retrieval.\n\n" +
        `Question: ${question}`,
      ...(routerProvider === "openai" ? { providerOptions: { openai: { reasoningEffort: "low" } } } : {}),
    });
    return {
      plan: result.object,
      source: "llm",
      latencyMs: roundLatencyMs(performance.now() - started),
    };
  } catch {
    return {
      plan: heuristicPlan(question),
      source: "heuristic_fallback",
      latencyMs: roundLatencyMs(performance.now() - started),
    };
  }
}

async function planContextWithDeepSeek(question: string, routerModel: string): Promise<ContextPlan | null> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return null;
  }

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: routerModel,
        messages: [
          {
            role: "system",
            content:
              "You are a bounded retrieval router for CivilMCP. Return json only. " +
              ROUTER_RULES +
              "Use this exact JSON shape: " +
              "{\"intent\":\"simple_lookup|compare|summarize|methodology|citation_search\"," +
              "\"searchQuery\":\"semantic query\",\"discipline\":\"\",\"needsNeighbors\":false," +
              "\"reason\":\"short reason\"}. " +
              "Use discipline only if the user explicitly names one of the supported civil-engineering disciplines.",
          },
          {
            role: "user",
            content: `Question: ${question}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
        thinking: { type: "disabled" },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      return null;
    }

    return RouterPlanSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function uniqueStrings(values: Array<string | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const cleaned = (value ?? "").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    results.push(cleaned);
    if (results.length >= limit) break;
  }
  return results;
}

function dedupeChunks(chunks: ChunkResult[]): ChunkResult[] {
  const seen = new Set<string>();
  const results: ChunkResult[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.source ?? ""}:${chunk.section_index ?? ""}:${chunk.chunk_index ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(chunk);
  }
  return results;
}

function normalizeSearchToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

function queryTokens(query: string): string[] {
  const expanded = query
    .replace(/คอนกรีต/g, "คอนกรีต concrete")
    .replace(/โครงสร้าง/g, "โครงสร้าง structural structure")
    .replace(/เสริมเหล็ก/g, "เสริมเหล็ก reinforced rebar")
    .replace(/วิธี/g, "วิธี methodology method")
    .replace(/การทดลอง/g, "การทดลอง experiment experimental")
    .replace(/ข้อจำกัด/g, "ข้อจำกัด limitation limitations")
    .replace(/ขนส่ง/g, "ขนส่ง transport traffic")
    .replace(/น้ำท่วม/g, "น้ำท่วม flood drainage");

  return uniqueStrings(
    expanded
      .split(/[^\p{L}\p{N}]+/u)
      .map(normalizeSearchToken)
      .filter((token) => token.length >= 3),
    28,
  );
}

function textContainsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function referenceNoiseScore(text: string): number {
  const lower = text.toLowerCase();
  const bracketRefs = text.match(/\[\d+\]/g)?.length ?? 0;
  const referenceTerms = [
    "journal",
    "proceedings",
    "conference",
    "doi",
    "isbn",
    "pp.",
    "vol.",
    "university",
    "aci",
    "astm",
    "jsce",
    "asce",
    "references",
    "เอกสารอ้างอิง",
  ];
  const termHits = referenceTerms.filter((term) => lower.includes(term)).length;
  return bracketRefs * 0.08 + termHits * 0.22;
}

function ocrNoiseScore(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const shortWordRatio = words.filter((word) => word.length <= 2).length / words.length;
  const symbolRatio = (text.match(/[^\p{L}\p{N}\s.,;:()[\]%-]/gu)?.length ?? 0) / Math.max(text.length, 1);
  return shortWordRatio * 0.6 + symbolRatio * 2;
}

function evidenceQualityScore(
  item: ChunkResult | SectionResult,
  kind: "chunk" | "section",
  query: string,
  intent: Intent,
): number {
  const rawContent = item.content ?? "";
  const cleaned = cleanEvidenceText(rawContent, 1000);
  if (!cleaned || cleaned.startsWith("No readable")) return -100;

  const haystack = `${item.section_title ?? ""} ${cleaned}`.toLowerCase();
  const tokens = queryTokens(query);
  const overlap = tokens.filter((token) => haystack.includes(token.toLowerCase())).length;
  const overlapScore = tokens.length ? Math.min(overlap / Math.min(tokens.length, 10), 1) * 2.2 : 0;

  const semanticBoostPatterns = [
    /ผลการ|ผลทดลอง|พบว่า|สรุป|conclusion|results?|discussion|analysis|model|แบบจำลอง|พฤติกรรม|กำลัง|แรง|capacity|strength|performance|finite|opensees|experiment/i,
  ];
  const methodBoostPatterns = [/method|methodology|experiment|setup|specimen|data|model|วิธี|การทดลอง|ตัวอย่าง|แบบจำลอง/i];
  const summaryBoostPatterns = [/abstract|บทคัดย่อ|conclusion|สรุป|overview|introduction|บทนำ/i];
  const titleBoost = textContainsAny(`${item.section_title ?? ""}`, [/abstract|บทคัดย่อ|conclusion|สรุป|method|วิธี|result|ผล/i])
    ? 0.45
    : 0;
  const semanticBoost = textContainsAny(haystack, semanticBoostPatterns) ? 0.65 : 0;
  const intentBoost =
    intent === "methodology" && textContainsAny(haystack, methodBoostPatterns)
      ? 0.75
      : intent === "summarize" && textContainsAny(haystack, summaryBoostPatterns)
        ? 0.5
        : 0;

  const baseSimilarity = Number(item.similarity ?? 0) * 1.7;
  const kindBoost = kind === "chunk" ? 0.35 : 0.15;
  const hasPageBoost = item.page_start != null && item.page_end != null ? 0.18 : 0;
  const lengthPenalty = cleaned.length < 120 ? 0.8 : cleaned.length > 900 ? 0.2 : 0;
  const noisePenalty = Math.min(referenceNoiseScore(rawContent), 2.6) + Math.min(ocrNoiseScore(rawContent), 0.8);
  const asksConcrete = /คอนกรีต|concrete|cement/i.test(query);
  const concreteEvidence = /คอนกรีต|concrete|cement|cementitious|ferrocement|reinforced|เสริมเหล็ก|เส้นใย/i.test(haystack);
  const topicalPenalty = asksConcrete && !concreteEvidence ? 2.4 : 0;

  return (
    baseSimilarity +
    overlapScore +
    semanticBoost +
    intentBoost +
    titleBoost +
    kindBoost +
    hasPageBoost -
    lengthPenalty -
    noisePenalty -
    topicalPenalty
  );
}

function rerankSections(sections: SectionResult[], query: string, intent: Intent): SectionResult[] {
  return [...sections]
    .map((section) => ({
      section,
      score: evidenceQualityScore(section, "section", query, intent),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, RERANK_CANDIDATE_LIMIT)
    .map(({ section }) => section);
}

function rerankChunks(chunks: ChunkResult[], query: string, intent: Intent): ChunkResult[] {
  return [...chunks]
    .map((chunk) => ({
      chunk,
      score: evidenceQualityScore(chunk, "chunk", query, intent),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, RERANK_CANDIDATE_LIMIT)
    .map(({ chunk }) => chunk);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  return text.slice(0, maxTokens * 3) + "\n[Context truncated to budget]";
}

function pageCitationPart(item: { page_start?: number | null; page_end?: number | null }): string {
  if (item.page_start == null || item.page_end == null) return "";
  return item.page_start === item.page_end ? ` · p.${item.page_start}` : ` · p.${item.page_start}-${item.page_end}`;
}

function pageLabel(item: { page_start?: number | null; page_end?: number | null }): string {
  if (item.page_start == null || item.page_end == null) return "";
  return item.page_start === item.page_end ? `p.${item.page_start}` : `p.${item.page_start}-${item.page_end}`;
}

function citationForChunk(chunk: ChunkResult): string {
  return `${chunk.source ?? "unknown-source"} · ${chunk.section_title ?? "Untitled section"} · chunk ${chunk.chunk_index ?? "?"}${pageCitationPart(chunk)}`;
}

function citationForSection(section: SectionResult): string {
  return `${section.source ?? "unknown-source"} · ${section.section_title ?? "Untitled section"}${pageCitationPart(section)}`;
}

function evidenceKey(item: EvidenceItem): string {
  return `${item.source}:${item.sectionTitle ?? ""}:${item.chunkIndex ?? ""}:${item.pageStart ?? ""}:${item.pageEnd ?? ""}`;
}

function compactEvidenceSnippet(text: string, query: string, intent: Intent): string {
  const cleaned = cleanEvidenceText(text, 1200);
  if (cleaned.length <= EVIDENCE_SNIPPET_CHARS) return cleaned;

  const tokens = queryTokens(query);
  const intentTerms =
    intent === "methodology"
      ? ["method", "methodology", "experiment", "specimen", "วิธี", "การทดลอง", "แบบจำลอง"]
      : intent === "citation_search"
        ? ["found", "result", "show", "พบว่า", "ผล", "สรุป", "conclusion"]
        : ["concrete", "structural", "strength", "capacity", "behavior", "คอนกรีต", "โครงสร้าง", "กำลัง", "พฤติกรรม"];
  const scoringTerms = uniqueStrings([...tokens, ...intentTerms].filter(Boolean), 48);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 35) {
    const windows: Array<{ text: string; score: number }> = [];
    const windowSize = Math.min(58, Math.max(34, Math.floor(words.length * 0.3)));
    const step = Math.max(8, Math.floor(windowSize / 3));
    for (let start = 0; start < words.length; start += step) {
      const windowText = words.slice(start, start + windowSize).join(" ");
      if (windowText.length < 120) continue;
      const lower = windowText.toLowerCase();
      const overlap = scoringTerms.filter((term) => lower.includes(term.toLowerCase())).length;
      const resultBoost = /(พบว่า|ผล|กำลัง|พฤติกรรม|แรง|capacity|strength|behavior|performance|conclusion|result|model|finite|opensees)/i.test(
        windowText,
      )
        ? 1.1
        : 0;
      const thaiBoost = /[ก-๙]/.test(windowText) ? 0.25 : 0;
      const refPenalty = referenceNoiseScore(windowText) * 2.2;
      const ocrPenalty = ocrNoiseScore(windowText) * 0.8;
      windows.push({ text: windowText, score: overlap * 1.4 + resultBoost + thaiBoost - refPenalty - ocrPenalty });
      if (start + windowSize >= words.length) break;
    }

    const bestWindow = windows.sort((a, b) => b.score - a.score)[0];
    if (bestWindow) {
      return bestWindow.text.length > EVIDENCE_SNIPPET_CHARS
        ? `${bestWindow.text.slice(0, EVIDENCE_SNIPPET_CHARS).trim()}...`
        : bestWindow.text;
    }
  }

  const sentences = cleaned
    .split(/(?<=[.!?。])\s+|(?<=\))\s+|(?<=\])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 48);

  if (!sentences.length) {
    return `${cleaned.slice(0, EVIDENCE_SNIPPET_CHARS).trim()}...`;
  }

  const ranked = sentences
    .map((sentence, index) => {
      const lower = sentence.toLowerCase();
      const overlap = scoringTerms.filter((term) => lower.includes(term.toLowerCase())).length;
      const refPenalty = referenceNoiseScore(sentence) * 1.5;
      const indexPenalty = index * 0.03;
      return { sentence, score: overlap - refPenalty - indexPenalty };
    })
    .sort((a, b) => b.score - a.score);

  let snippet = ranked[0]?.sentence ?? cleaned;
  if (ranked[1] && snippet.length < 260 && ranked[1].score > -1) {
    snippet = `${snippet} ${ranked[1].sentence}`;
  }
  return snippet.length > EVIDENCE_SNIPPET_CHARS ? `${snippet.slice(0, EVIDENCE_SNIPPET_CHARS).trim()}...` : snippet;
}

function buildEvidenceItems(
  sections: SectionResult[],
  chunks: ChunkResult[],
  query: string,
  intent: Intent,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  const perSourceCount = new Map<string, number>();

  const addItem = (item: Omit<EvidenceItem, "evidenceId">) => {
    if (!item.snippet || item.snippet.startsWith("No readable")) return;
    const sourceCount = perSourceCount.get(item.source) ?? 0;
    if (sourceCount >= MAX_EVIDENCE_PER_SOURCE) return;
    const next = { ...item, evidenceId: `E${items.length + 1}` };
    const key = evidenceKey(next);
    if (seen.has(key)) return;
    seen.add(key);
    perSourceCount.set(item.source, sourceCount + 1);
    items.push(next);
  };

  for (const chunk of chunks) {
    if (items.length >= MAX_EVIDENCE_ITEMS) break;
    const snippet = compactEvidenceSnippet(chunk.content ?? "", query, intent);
    addItem({
      kind: "chunk",
      id: chunk.id,
      documentId: chunk.document_id,
      sectionId: chunk.section_id,
      sectionIndex: chunk.section_index ?? null,
      citation: citationForChunk(chunk),
      source: chunk.source ?? "unknown-source",
      collection: chunk.collection,
      sourceType: chunk.source_type,
      parentSourcePdf: chunk.parent_source_pdf,
      paperCode: chunk.paper_code,
      pageStart: chunk.page_start,
      pageEnd: chunk.page_end,
      sectionTitle: chunk.section_title,
      chunkIndex: chunk.chunk_index ?? null,
      similarity: chunk.similarity ?? null,
      rerankScore: Number(evidenceQualityScore(chunk, "chunk", query, intent).toFixed(3)),
      snippet,
    });
  }

  for (const section of sections) {
    if (items.length >= MAX_EVIDENCE_ITEMS) break;
    const snippet = compactEvidenceSnippet(section.content ?? "", query, intent);
    addItem({
      kind: "section",
      id: section.id,
      documentId: section.document_id,
      sectionId: section.id,
      sectionIndex: section.section_index ?? null,
      citation: citationForSection(section),
      source: section.source ?? "unknown-source",
      collection: section.collection,
      sourceType: section.source_type,
      parentSourcePdf: section.parent_source_pdf,
      paperCode: section.paper_code,
      pageStart: section.page_start,
      pageEnd: section.page_end,
      sectionTitle: section.section_title,
      chunkIndex: null,
      similarity: section.similarity ?? null,
      rerankScore: Number(evidenceQualityScore(section, "section", query, intent).toFixed(3)),
      snippet,
    });
  }

  return items;
}

function normalizeAnchorEvidence(anchor: ConversationAnchor | undefined): EvidenceItem | undefined {
  const evidence = anchor?.evidence;
  if (!evidence?.source || !evidence.snippet) return undefined;
  return {
    ...evidence,
    evidenceId: "E1",
    snippet: cleanEvidenceText(evidence.snippet, EVIDENCE_SNIPPET_CHARS),
    citation:
      evidence.citation ||
      `${evidence.source}${evidence.sectionTitle ? ` · ${evidence.sectionTitle}` : ""}${
        evidence.pageStart != null ? pageCitationPart({ page_start: evidence.pageStart, page_end: evidence.pageEnd }) : ""
      }`,
  };
}

function mergeAnchorEvidence(anchor: ConversationAnchor | undefined, evidenceItems: EvidenceItem[]): EvidenceItem[] {
  const anchorEvidence = normalizeAnchorEvidence(anchor);
  if (!anchorEvidence) return evidenceItems;

  const merged: EvidenceItem[] = [anchorEvidence];
  const seen = new Set<string>([evidenceKey(anchorEvidence)]);
  for (const item of evidenceItems) {
    if (merged.length >= MAX_EVIDENCE_ITEMS) break;
    const key = evidenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...item, evidenceId: `E${merged.length + 1}` });
  }
  return merged;
}

function buildEvidenceContext(evidenceItems: EvidenceItem[]): string {
  if (!evidenceItems.length) {
    return "Evidence packets: none. The answer must state that the current corpus did not provide enough evidence.";
  }

  return [
    "Evidence packets for the answer model:",
    "Use only these packets for grounded claims. Cite packets as [E1], [E2], etc. Do not expose similarity scores.",
    ...evidenceItems.map((item) =>
      [
        `[${item.evidenceId}]`,
        `source: ${item.source}`,
        item.parentSourcePdf ? `parent_pdf: ${item.parentSourcePdf}` : "",
        item.paperCode ? `paper_code: ${item.paperCode}` : "",
        item.collection ? `collection: ${item.collection}` : "",
        item.sectionTitle ? `section: ${item.sectionTitle}` : "",
        pageLabel({ page_start: item.pageStart, page_end: item.pageEnd })
          ? `pages: ${pageLabel({ page_start: item.pageStart, page_end: item.pageEnd })}`
          : "",
        item.kind === "chunk" && item.chunkIndex != null ? `chunk: ${item.chunkIndex}` : "",
        `snippet: ${item.snippet}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}

function intentAnswerGuide(intent: Intent): string {
  const common =
    "Use concise Thai. Write reusable research brief prose, not raw retrieval notes. " +
    "Every substantive claim must cite evidence markers like [E1].";

  const byIntent: Record<Intent, string> = {
    simple_lookup:
      "For a direct lookup, start with the answer in 2-3 sentences, then list key evidence and practical implications.",
    compare:
      "For comparison, include a compact comparison matrix with dimensions, evidence, and a recommended interpretation.",
    summarize:
      "For overview, cluster the papers by theme and cite representative evidence for each theme.",
    methodology:
      "For methodology, include method/design/data/limitations columns and separate what the evidence can and cannot support.",
    citation_search:
      "For citation search, lead with the strongest exact evidence and avoid broad claims that are not directly supported.",
  };

  return `${common} ${byIntent[intent]}`;
}

function buildAnswerSystemPrompt(
  builtContext: BuiltContext,
  conversation?: ConversationContext,
  memory?: MemorySnapshot | null,
): string {
  const intent = builtContext.plan?.intent ?? "simple_lookup";
  const collectionLabel = builtContext.collection || "all";
  const anchor = conversation?.anchor;
  const continuityLines =
    anchor?.evidence != null
      ? [
          "Conversation continuity:",
          `The latest user message references previous evidence ${anchor.referencedEvidenceId ?? anchor.evidence.evidenceId}.`,
          `Treat that previous evidence as ${anchor.evidence.source}${
            anchor.evidence.pageStart != null ? ` (${pageLabel({ page_start: anchor.evidence.pageStart, page_end: anchor.evidence.pageEnd })})` : ""
          }.`,
          "Lead with the referenced paper/source first. Treat other evidence packets as related context, not as replacements.",
          "Do not reinterpret the old E-number as a new retrieval result. New answer evidence markers may be renumbered from the new evidence packets.",
        ]
      : [];
  return [
    "You are CivilMCP, a production-grade Agentic Context Engine for Civil Engineering papers.",
    "Answer in Thai unless the user explicitly asks otherwise.",
    "Use only the provided evidence packets when MCP context is available. Do not invent paper details.",
    "Never expose raw chunks, OCR noise, similarity scores, tool calls, context stats, or hidden routing notes.",
    "If the evidence is insufficient, say: \"หลักฐานในคลังยังไม่พอ\" and suggest the exact collection/query refinement.",
    "Return GitHub-flavored Markdown only. Do not use raw HTML.",
    "Use short evidence markers [E1], [E2] in prose. Do not use long filename citations inside paragraphs.",
    "",
    `Context mode: ${builtContext.mode}`,
    `Collection filter: ${collectionLabel}`,
    `Intent: ${intent}`,
    `Answer guide: ${intentAnswerGuide(intent)}`,
    buildMemorySystemBlock(memory ?? null),
    ...continuityLines,
    "",
    "Required output structure:",
    "## สรุปคำตอบ",
    "2-4 sentences with citations.",
    "",
    "## ประเด็นสำคัญ",
    "- 3-5 bullets, each grounded with [E#].",
    "",
    "## ตารางหลักฐาน",
    "| Evidence | Source/Page | ใช้สนับสนุนอะไร |",
    "| --- | --- | --- |",
    "",
    "## ข้อจำกัดของหลักฐาน",
    "- State retrieval/OCR/context limitations and what remains uncertain.",
    "",
    "## นำไปใช้ต่อได้อย่างไร",
    "- Practical next steps for research, design review, or deeper reading.",
    "",
    `MCP context:\n${builtContext.context}`,
  ].join("\n");
}

function evidenceSourceLabel(item: EvidenceItem): string {
  const page = pageLabel({ page_start: item.pageStart, page_end: item.pageEnd });
  return [item.source, page ? `p.${page}` : "", item.sectionTitle ? item.sectionTitle : ""].filter(Boolean).join(" · ");
}

function shouldUseAnswerFallback(answer: string, evidenceItems: EvidenceItem[]): boolean {
  if (!evidenceItems.length) return !answer.trim();
  return answer.trim().length < 40 || citationMarkers(answer).length === 0;
}

function fallbackThemeLabel(intent: Intent): string {
  const labels: Record<Intent, string> = {
    simple_lookup: "รายการหลักฐานที่ตรงกับคำถาม",
    compare: "ประเด็นเปรียบเทียบจากหลักฐาน",
    summarize: "กลุ่มประเด็นหลักจากคลังเอกสาร",
    methodology: "วิธีวิจัย/ข้อมูล/ข้อจำกัดที่พบ",
    citation_search: "หลักฐานอ้างอิงโดยตรง",
  };
  return labels[intent];
}

function buildFallbackResearchBrief(question: string, builtContext: BuiltContext): string {
  const evidence = builtContext.evidenceItems.slice(0, MAX_EVIDENCE_ITEMS);
  const intent = builtContext.plan?.intent ?? "simple_lookup";
  if (!evidence.length) {
    return [
      "## สรุปคำตอบ",
      "หลักฐานในคลังยังไม่พอสำหรับตอบคำถามนี้อย่างมั่นใจ",
      "",
      "## ประเด็นสำคัญ",
      `- คำถามที่ใช้ค้นคือ: ${question || builtContext.plan?.searchQuery || "ไม่ระบุ"}`,
      `- collection ที่ใช้คือ: ${builtContext.collection || "all"}`,
      "- ควรลองระบุชื่อ paper, discipline, หรือ keyword ไทย/อังกฤษให้แคบลง",
      "",
      "## ตารางหลักฐาน",
      "| Evidence | Source/Page | ใช้สนับสนุนอะไร |",
      "| --- | --- | --- |",
      "| - | - | ยังไม่มี evidence packet ที่เพียงพอ |",
      "",
      "## ข้อจำกัดของหลักฐาน",
      "- ไม่มีหลักฐานที่ผ่านตัวกรอง retrieval ในคำถามนี้ จึงไม่ควรสรุปเชิงวิศวกรรมจากคลังนี้โดยตรง",
      "",
      "## นำไปใช้ต่อได้อย่างไร",
      "- ลองค้นใหม่ด้วยชื่อวัสดุ วิธีวิจัย ชื่อ conference/paper code หรือเลือก collection ให้เฉพาะเจาะจงขึ้น",
    ].join("\n");
  }

  const strongest = evidence[0];
  const bullets = evidence.slice(0, 5).map((item) => {
    const snippet = cleanEvidenceText(item.snippet, 180);
    return `- [${item.evidenceId}] ${snippet}`;
  });
  const rows = evidence.map((item) =>
    `| [${item.evidenceId}] | ${evidenceSourceLabel(item).replaceAll("|", "/")} | ${cleanEvidenceText(item.snippet, 140).replaceAll("|", "/")} |`,
  );

  return [
    "## สรุปคำตอบ",
    `จากหลักฐานที่ค้นได้ ประเด็นที่ตอบคำถามนี้ได้ดีที่สุดคือ ${fallbackThemeLabel(intent)} โดยหลักฐานที่แข็งแรงที่สุดมาจาก ${strongest.source} [${strongest.evidenceId}].`,
    `ควรอ่านผลนี้เป็น research brief เบื้องต้น เพราะคำตอบนี้สร้างจาก evidence packets ที่ระบบเลือกไว้ ไม่ใช่การอ่านเอกสารทุกหน้าทั้งหมด [${strongest.evidenceId}].`,
    "",
    "## ประเด็นสำคัญ",
    ...bullets,
    "",
    "## ตารางหลักฐาน",
    "| Evidence | Source/Page | ใช้สนับสนุนอะไร |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## ข้อจำกัดของหลักฐาน",
    "- คำตอบนี้ใช้เฉพาะ evidence packets ที่ผ่าน retrieval/rerank แล้ว จึงอาจยังไม่ครอบคลุม paper ทั้งฉบับ",
    "- ถ้าเอกสารเป็น OCR หรือ proceedings ยาว อาจมี noise ในข้อความและควรเปิด PDF preview เพื่อตรวจถ้อยคำสำคัญซ้ำ",
    "",
    "## นำไปใช้ต่อได้อย่างไร",
    "- ใช้รายการ [E#] เป็น starting point สำหรับเปิด paper/source ที่เกี่ยวข้อง",
    "- ถ้าต้องการข้อสรุปเชิงออกแบบหรือเชิงนโยบาย ควรถาม follow-up เจาะ paper เดียวหรือ methodology เดียวเพื่อให้ context ไม่ drift",
  ].join("\n");
}

function sanitizeMissionText(value: string, validEvidenceIds: Set<string>): string {
  return value
    .replace(/\[(E\d+)\]/g, (marker, evidenceId: string) => (validEvidenceIds.has(evidenceId) ? marker : ""))
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValidEvidenceIds(values: string[], validEvidenceIds: Set<string>, limit = 4): string[] {
  return [...new Set(values.filter((value) => validEvidenceIds.has(value)))].slice(0, limit);
}

function fallbackMissionCore(question: string, builtContext: BuiltContext): MissionArtifactCore {
  const evidence = builtContext.evidenceItems.slice(0, MAX_EVIDENCE_ITEMS);
  const firstEvidenceId = evidence[0]?.evidenceId;
  const hasCoverage = evidence.length >= 2;
  const fallbackIds = firstEvidenceId ? [firstEvidenceId] : [];
  return {
    title: `Evidence mission: ${cleanEvidenceText(question, 88) || "Civil engineering research"}`,
    executiveSummary: evidence.length
      ? `หลักฐานที่ค้นได้ให้จุดเริ่มต้นสำหรับคำถามนี้ แต่ควรตรวจบริบทและข้อจำกัดของแต่ละ paper ก่อนนำไปใช้${firstEvidenceId ? ` [${firstEvidenceId}]` : ""}`
      : "หลักฐานในคลังยังไม่พอสำหรับสร้าง evidence mission ที่ตรวจสอบได้",
    verdict: {
      status: hasCoverage ? "mixed" : "insufficient",
      rationale: hasCoverage
        ? "ระบบพบหลักฐานมากกว่าหนึ่งรายการ แต่ยังต้องอ่านบริบทของแต่ละ paper เพื่อยืนยันความสอดคล้องของข้อค้นพบ"
        : "จำนวนหลักฐานที่ผ่าน retrieval ยังไม่พอสำหรับข้อสรุปที่มั่นใจ",
    },
    matrix: evidence.length
      ? evidence.slice(0, 4).map((item) => ({
          finding: cleanEvidenceText(item.snippet, 260),
          interpretation: "ใช้เป็นหลักฐานตั้งต้นและตรวจความหมายกับหน้าต้นฉบับก่อนสรุปข้าม paper",
          methodOrContext: item.sectionTitle || item.collection || "Indexed evidence packet",
          limitation: "Evidence packet ไม่แทนการอ่าน paper ทั้งฉบับ",
          evidenceIds: [item.evidenceId],
        }))
      : [
          {
            finding: "ยังไม่มี evidence packet ที่เพียงพอ",
            interpretation: "ยังไม่ควรสรุปเชิงวิศวกรรม",
            methodOrContext: "Bounded retrieval",
            limitation: "ปรับ query, discipline หรือ collection แล้วลองใหม่",
            evidenceIds: [],
          },
        ],
    worldBridge: {
      transferableSignals: ["แยกข้อค้นพบที่อาจทดสอบซ้ำได้ออกจากบริบทเฉพาะพื้นที่"],
      thaiContext: ["ผลจากคลังไทยอาจขึ้นกับมาตรฐาน วัสดุ ภูมิอากาศ พฤติกรรม หรือข้อมูลท้องถิ่น"],
      validateNext: ["ทดสอบกับมาตรฐานและ dataset ของประเทศเป้าหมายก่อนนำไปใช้"],
    },
    learning: {
      objective: "อธิบายได้ว่าหลักฐานใดสนับสนุนคำตอบ และส่วนใดยังเป็นข้อจำกัดหรือ inference",
      checkpoints: [
        {
          question: "หลักฐานชิ้นใดตอบคำถามโดยตรงที่สุด และเพราะอะไร?",
          hint: "ดูความตรงของประเด็น วิธีวิจัย และหน้าที่อ้าง",
          evidenceIds: fallbackIds,
        },
        {
          question: "ต้องตรวจอะไรเพิ่มก่อนนำผลนี้ไปใช้กับบริบทอื่น?",
          hint: "แยกความแตกต่างด้านพื้นที่ มาตรฐาน วัสดุ และข้อมูล",
          evidenceIds: evidence[1]?.evidenceId ? [evidence[1].evidenceId] : fallbackIds,
        },
      ],
    },
  };
}

function fallbackAutomationProgram(
  question: string,
  builtContext: BuiltContext,
): NonNullable<MissionArtifactCore["automation"]> {
  const evidence = builtContext.evidenceItems;
  const evidenceIds = evidence.map((item) => item.evidenceId);
  const sourceCount = new Set(evidence.map((item) => item.source)).size;
  const exactPageIds = evidence
    .filter((item) => item.pageStart != null && item.pageEnd != null)
    .map((item) => item.evidenceId);
  return {
    objective: `Execute a bounded, auditable research program for: ${cleanEvidenceText(question, 260)}`,
    subquestions: [
      "What does the strongest available evidence directly support?",
      "How do methods, samples, and engineering contexts differ across the selected papers?",
      "Where do findings agree, conflict, or remain insufficient?",
      "What is the smallest defensible next study or validation?",
    ],
    tasks: [
      {
        name: "Scope",
        objective: `Translate the question into a ${builtContext.plan?.intent ?? "research"} evidence plan.`,
        status: "complete",
        evidenceIds: [],
      },
      {
        name: "Gather",
        objective: "Retrieve and rank the most relevant page-linked evidence packets.",
        status: evidenceIds.length ? "complete" : "limited",
        evidenceIds: evidenceIds.slice(0, 4),
      },
      {
        name: "Compare",
        objective: "Compare methods, findings, limitations, and context across distinct sources.",
        status: sourceCount >= 2 ? "complete" : "limited",
        evidenceIds: evidenceIds.slice(0, 4),
      },
      {
        name: "Verify",
        objective: "Confirm that every retained evidence packet resolves to an exact source page.",
        status: evidence.length > 0 && exactPageIds.length === evidence.length ? "complete" : "limited",
        evidenceIds: exactPageIds.slice(0, 4),
      },
      {
        name: "Publish",
        objective: "Publish a conservative dossier that separates evidence, inference, gaps, and next validation.",
        status: evidenceIds.length ? "complete" : "limited",
        evidenceIds: evidenceIds.slice(0, 4),
      },
    ],
    deliverables: ["Executive synthesis", "Evidence matrix", "Method comparison", "Research gaps", "Recommended next study"],
  };
}

function finalizeAutomationProgram(
  core: MissionArtifactCore,
  question: string,
  builtContext: BuiltContext,
  validEvidenceIds: Set<string>,
): NonNullable<MissionArtifactCore["automation"]> {
  const fallback = fallbackAutomationProgram(question, builtContext);
  const automation = core.automation ?? fallback;
  const subquestions = automation.subquestions
    .map((item) => sanitizeMissionText(item, validEvidenceIds))
    .filter(Boolean)
    .slice(0, 5);
  const tasks = automation.tasks
    .map((task) => ({
      name: sanitizeMissionText(task.name, validEvidenceIds),
      objective: sanitizeMissionText(task.objective, validEvidenceIds),
      status: task.status,
      evidenceIds: uniqueValidEvidenceIds(task.evidenceIds, validEvidenceIds),
    }))
    .filter((task) => task.name && task.objective)
    .slice(0, 5);
  const deliverables = automation.deliverables
    .map((item) => sanitizeMissionText(item, validEvidenceIds))
    .filter(Boolean)
    .slice(0, 6);
  return {
    objective: sanitizeMissionText(automation.objective, validEvidenceIds) || fallback.objective,
    subquestions: subquestions.length >= 2 ? subquestions : fallback.subquestions,
    tasks: tasks.length >= 3 ? tasks : fallback.tasks,
    deliverables: deliverables.length >= 3 ? deliverables : fallback.deliverables,
  };
}

function finalizeMissionArtifact(
  core: MissionArtifactCore,
  question: string,
  experience: Exclude<ChatExperience, "answer">,
  builtContext: BuiltContext,
): MissionArtifact {
  const evidenceItems = builtContext.evidenceItems;
  const validEvidenceIds = new Set(evidenceItems.map((item) => item.evidenceId));
  const fallback = fallbackMissionCore(question, builtContext);
  const cleanMatrix = core.matrix
    .map((row) => ({
      finding: sanitizeMissionText(row.finding, validEvidenceIds),
      interpretation: sanitizeMissionText(row.interpretation, validEvidenceIds),
      methodOrContext: sanitizeMissionText(row.methodOrContext, validEvidenceIds),
      limitation: sanitizeMissionText(row.limitation, validEvidenceIds),
      evidenceIds: uniqueValidEvidenceIds(row.evidenceIds, validEvidenceIds),
    }))
    .filter((row) => row.finding && row.evidenceIds.length)
    .slice(0, 6);
  const exactPageCount = evidenceItems.filter((item) => item.pageStart != null && item.pageEnd != null).length;
  const sourceCount = new Set(evidenceItems.map((item) => item.source)).size;
  const noEvidence = evidenceItems.length === 0;
  const unsafeConflict = core.verdict.status === "conflicting" && sourceCount < 2;
  const verdictStatus = noEvidence ? "insufficient" : unsafeConflict ? "insufficient" : core.verdict.status;
  const transferableSignals = core.worldBridge.transferableSignals
    .map((item) => sanitizeMissionText(item, validEvidenceIds))
    .filter(Boolean)
    .slice(0, 4);
  const thaiContext = core.worldBridge.thaiContext
    .map((item) => sanitizeMissionText(item, validEvidenceIds))
    .filter(Boolean)
    .slice(0, 4);
  const validateNext = core.worldBridge.validateNext
    .map((item) => sanitizeMissionText(item, validEvidenceIds))
    .filter(Boolean)
    .slice(0, 4);
  const learningCheckpoints = core.learning.checkpoints
    .map((checkpoint) => ({
      question: sanitizeMissionText(checkpoint.question, validEvidenceIds),
      hint: sanitizeMissionText(checkpoint.hint, validEvidenceIds),
      evidenceIds: uniqueValidEvidenceIds(checkpoint.evidenceIds, validEvidenceIds, 3),
    }))
    .filter((checkpoint) => checkpoint.question && checkpoint.evidenceIds.length)
    .slice(0, 4);

  return {
    version: "civilmcp-evidence-brief-v1",
    question: cleanEvidenceText(question, 600),
    experience,
    title: sanitizeMissionText(core.title, validEvidenceIds) || fallback.title,
    executiveSummary: sanitizeMissionText(core.executiveSummary, validEvidenceIds) || fallback.executiveSummary,
    verdict: {
      status: verdictStatus,
      rationale: sanitizeMissionText(core.verdict.rationale, validEvidenceIds) || fallback.verdict.rationale,
    },
    matrix: cleanMatrix.length ? cleanMatrix : fallback.matrix,
    worldBridge: {
      transferableSignals: transferableSignals.length ? transferableSignals : fallback.worldBridge.transferableSignals,
      thaiContext: thaiContext.length ? thaiContext : fallback.worldBridge.thaiContext,
      validateNext: validateNext.length ? validateNext : fallback.worldBridge.validateNext,
    },
    learning: {
      objective: sanitizeMissionText(core.learning.objective, validEvidenceIds) || fallback.learning.objective,
      checkpoints: learningCheckpoints.length >= 2 ? learningCheckpoints : fallback.learning.checkpoints,
    },
    trust: {
      evidenceCount: evidenceItems.length,
      sourceCount,
      exactPageCount,
      pageCoveragePercent: evidenceItems.length ? Math.round((exactPageCount / evidenceItems.length) * 100) : 0,
    },
    agentRun: {
      bounded: true,
      toolCalls: builtContext.toolCalls,
      toolCallLimit: MAX_TOOL_CALLS,
      stepLimit: MAX_AGENT_STEPS,
      stages: [
        {
          name: "Plan",
          detail: `${builtContext.plan?.intent ?? "simple_lookup"} · ${builtContext.router.source} router`,
          status: "complete",
        },
        {
          name: "Search",
          detail: `${builtContext.toolCalls}/${MAX_TOOL_CALLS} tool calls · ${evidenceItems.length} evidence packets`,
          status: evidenceItems.length ? "complete" : "limited",
        },
        {
          name: "Compare",
          detail: `${sourceCount} unique source${sourceCount === 1 ? "" : "s"}`,
          status: sourceCount >= 2 || builtContext.plan?.intent !== "compare" ? "complete" : "limited",
        },
        {
          name: "Verify",
          detail: `${exactPageCount}/${evidenceItems.length} packets have exact pages`,
          status: evidenceItems.length > 0 && exactPageCount === evidenceItems.length ? "complete" : "limited",
        },
        { name: "Publish", detail: "Saved as a linked Evidence Brief", status: "complete" },
      ],
    },
    automation: experience === "automated"
      ? finalizeAutomationProgram(core, question, builtContext, validEvidenceIds)
      : undefined,
  };
}

async function generateMissionArtifact(
  question: string,
  experience: Exclude<ChatExperience, "answer">,
  builtContext: BuiltContext,
  languageModel: ReturnType<typeof resolveLanguageModel>,
  selectedModel: ChatModel,
): Promise<{ artifact: MissionArtifact; usage: Record<string, unknown> | null; usedFallback: boolean }> {
  const fallback = fallbackMissionCore(question, builtContext);
  if (!builtContext.evidenceItems.length) {
    return {
      artifact: finalizeMissionArtifact(fallback, question, experience, builtContext),
      usage: null,
      usedFallback: true,
    };
  }

  try {
    const result = await generateObject({
      model: languageModel,
      schema: MissionArtifactSchema,
      system: [
        "You are CivilMCP's bounded Evidence Mission synthesizer.",
        "Use only the supplied evidence packets for factual claims. Never invent a paper, page, method, result, or E-number.",
        "Write Thai unless the user explicitly requested another language.",
        "Distinguish finding from interpretation. Use 'insufficient' when coverage is too weak.",
        "Use 'conflicting' only when at least two supplied sources materially disagree; otherwise prefer mixed or supported.",
        "World bridge means: identify what may transfer, what is Thai-context-specific, and what must be validated elsewhere. Do not invent international evidence.",
        experience === "learn"
          ? "Make checkpoints Socratic: help the learner inspect evidence before revealing a broad conclusion."
          : experience === "research"
            ? "Act as a senior research analyst. Compare methods and validity, surface contradictions, state research gaps, and propose the smallest defensible next validation. Be conservative and auditable."
            : experience === "automated"
              ? "Execute an end-to-end bounded research program. Decompose the goal into 2-5 subquestions, document 3-5 completed or limited tasks, compare methods and validity, surface contradictions and gaps, and publish an audit-ready dossier. Populate automation and never imply background work beyond this run."
            : "Make the brief decision-useful while keeping every conclusion auditable.",
      ].join("\n"),
      prompt: [
        `Research question: ${question}`,
        `Retrieval intent: ${builtContext.plan?.intent ?? "simple_lookup"}`,
        "Create one linked evidence brief with a compact evidence matrix, conservative verdict, Thailand-to-world transfer checks, and 2-4 learning checkpoints.",
        "Every matrix row and checkpoint must cite only valid evidence IDs from the packets below.",
        buildEvidenceContext(builtContext.evidenceItems),
      ].join("\n\n"),
      ...answerGenerationOptions(selectedModel),
    });
    return {
      artifact: finalizeMissionArtifact(result.object, question, experience, builtContext),
      usage: normalizeUsage(result.usage ?? null),
      usedFallback: false,
    };
  } catch {
    return {
      artifact: finalizeMissionArtifact(fallback, question, experience, builtContext),
      usage: null,
      usedFallback: true,
    };
  }
}

function missionVerdictLabel(status: MissionArtifact["verdict"]["status"]): string {
  return {
    supported: "Supported",
    mixed: "Mixed",
    conflicting: "Conflicting",
    insufficient: "Insufficient",
  }[status];
}

function buildMissionMarkdown(artifact: MissionArtifact): string {
  const firstEvidenceId = artifact.matrix.flatMap((row) => row.evidenceIds)[0];
  const summary = citationMarkers(artifact.executiveSummary).length || !firstEvidenceId
    ? artifact.executiveSummary
    : `${artifact.executiveSummary} [${firstEvidenceId}]`;
  const rationale = citationMarkers(artifact.verdict.rationale).length || !firstEvidenceId
    ? artifact.verdict.rationale
    : `${artifact.verdict.rationale} [${firstEvidenceId}]`;
  return [
    artifact.experience === "automated"
      ? "## Automated Research Dossier"
      : artifact.experience === "research"
        ? "## Deep Research Brief"
        : "## Evidence Review",
    summary,
    "",
    `**Evidence verdict — ${missionVerdictLabel(artifact.verdict.status)}:** ${rationale}`,
    "",
    "CivilMCP วางแผน ค้น เปรียบเทียบ และตรวจ page provenance ภายใต้งบ tool/step ที่จำกัดแล้ว โครงสร้างหลักฐาน, Thailand → World bridge และ learning checkpoints อยู่ใน Evidence Brief ด้านล่าง",
  ].join("\n");
}

function buildContextAnnotation(builtContext: BuiltContext, conversation: ConversationContext | undefined, traceId: string) {
  return {
    type: "civilmcp_context",
    traceId,
    mode: builtContext.mode,
    collection: builtContext.collection,
    intent: builtContext.plan?.intent ?? null,
    routerSource: builtContext.router.source,
    routerLatencyMs: builtContext.router.latencyMs,
    contextLatencyMs: builtContext.contextLatencyMs ?? null,
    toolCalls: builtContext.toolCalls,
    evidenceItems: builtContext.evidenceItems,
    anchor: conversation?.anchor?.evidence
      ? {
          type: conversation.anchor.type,
          referencedEvidenceId: conversation.anchor.referencedEvidenceId ?? null,
          source: conversation.anchor.evidence.source,
          collection: conversation.anchor.evidence.collection ?? null,
          pageStart: conversation.anchor.evidence.pageStart ?? null,
          pageEnd: conversation.anchor.evidence.pageEnd ?? null,
        }
      : null,
  };
}

function buildContextStats(
  builtContext: BuiltContext,
  conversation: ConversationContext,
  memory: MemorySnapshot | null,
) {
  return {
    routerProvider: builtContext.router.provider,
    routerModel: builtContext.router.model,
    routerSource: builtContext.router.source,
    routerLatencyMs: builtContext.router.latencyMs,
    contextLatencyMs: builtContext.contextLatencyMs ?? null,
    collection: builtContext.collection,
    toolCalls: builtContext.toolCalls,
    chunksSent: builtContext.chunksSent,
    sectionsSent: builtContext.sectionsSent,
    estimatedTokens: builtContext.estimatedTokens,
    intent: builtContext.plan?.intent ?? null,
    conversationAnchor: conversation.anchor
      ? {
          type: conversation.anchor.type,
          referencedEvidenceId: conversation.anchor.referencedEvidenceId ?? null,
          source: conversation.anchor.evidence?.source ?? null,
        }
      : null,
    memory: memory
      ? {
          state: memory.state,
          compactedMessageCount: memory.compactedMessageCount,
          recentMessageCount: memory.recentMessageCount,
          estimatedTokensBefore: memory.estimatedTokensBefore,
          contextWindowTokens: memory.contextWindowTokens,
          contextFillRatio: memory.contextFillRatio,
          activeEvidenceCount: memory.activeEvidenceMap.length,
        }
      : null,
  };
}

function buildContextText(
  plan: ContextPlan,
  sections: SectionResult[],
  chunks: ChunkResult[],
  toolCalls: number,
  collection: CollectionFilter,
  anchor?: ConversationAnchor,
): BuiltContext {
  const rerankedSections = rerankSections(sections, plan.searchQuery, plan.intent);
  const rerankedChunks = rerankChunks(dedupeChunks(chunks), plan.searchQuery, plan.intent);
  const selectedSections = rerankedSections.slice(0, plan.intent === "summarize" ? 10 : 6);
  const selectedChunks = rerankedChunks.slice(0, MAX_CONTEXT_CHUNKS);
  const evidenceItems = mergeAnchorEvidence(
    anchor,
    buildEvidenceItems(selectedSections, selectedChunks, plan.searchQuery, plan.intent),
  );

  const rawContext = [
    "CivilMCP Agentic Context Engine",
    `Intent: ${plan.intent}`,
    `Search query: ${plan.searchQuery}`,
    `Collection filter: ${collection || "all"}`,
    `Router reason: ${plan.reason}`,
    anchor?.evidence ? `Conversation anchor: ${anchor.referencedEvidenceId ?? anchor.evidence.evidenceId} -> ${anchor.evidence.source}` : "",
    `Tool calls used: ${toolCalls}/${MAX_TOOL_CALLS}`,
    buildEvidenceContext(evidenceItems),
  ]
    .filter(Boolean)
    .join("\n\n");

  const context = trimToTokenBudget(rawContext, MAX_CONTEXT_TOKENS);
  return {
    context,
    mode: "agentic_context",
    plan,
    router: {
      provider: resolveRouterProvider(),
      model: resolveRouterModel(resolveRouterProvider()),
      source: "not_used",
      latencyMs: 0,
    },
    collection,
    toolCalls,
    chunksSent: selectedChunks.length,
    sectionsSent: selectedSections.length,
    estimatedTokens: estimateTokens(context),
    evidenceItems,
  };
}

async function buildAgenticContext(
  question: string,
  routerProvider: RouterProvider,
  routerModel: string,
  collection: CollectionFilter,
  anchor?: ConversationAnchor,
): Promise<BuiltContext> {
  const routerPlan = await planContext(question, routerProvider, routerModel);
  const plan = routerPlan.plan;
  let toolCalls = 0;
  const callTool = async (name: string, args: Record<string, unknown>) => {
    if (toolCalls >= MAX_TOOL_CALLS) {
      throw new Error(`Tool budget exceeded (${MAX_TOOL_CALLS})`);
    }
    toolCalls += 1;
    return callMcpToolPayload(name, args);
  };

  const sectionTopKByIntent: Record<Intent, number> = {
    simple_lookup: 5,
    compare: 20,
    summarize: 12,
    methodology: 20,
    citation_search: 12,
  };
  const queryByIntent =
    plan.intent === "methodology"
      ? `${plan.searchQuery} methodology method experiment วิธีวิจัย การทดลอง ข้อจำกัด`
      : plan.searchQuery;
  const explicitAnchor = anchor?.type === "explicit_evidence" && Boolean(anchor.evidence);
  const anchorEvidence = anchor?.evidence;
  let sections: SectionResult[] = [];
  let chunks: ChunkResult[] = [];

  if (explicitAnchor && anchorEvidence && toolCalls < Math.min(MAX_TOOL_CALLS, MAX_AGENT_STEPS)) {
    try {
      const neighborArgs =
        anchorEvidence.kind === "chunk" && anchorEvidence.id
          ? { chunk_id: anchorEvidence.id, window: 2 }
          : anchorEvidence.source && anchorEvidence.sectionIndex != null && anchorEvidence.chunkIndex != null
            ? {
                source: anchorEvidence.source,
                section_index: anchorEvidence.sectionIndex,
                chunk_index: anchorEvidence.chunkIndex,
                window: 2,
              }
            : null;

      if (neighborArgs) {
        const neighborsPayload = await callTool("fetch_chunk_neighbors", neighborArgs);
        const structured = neighborsPayload.structuredContent as { neighbors?: unknown } | undefined;
        const neighbors = Array.isArray(structured?.neighbors) ? (structured.neighbors as ChunkResult[]) : [];
        chunks = [...chunks, ...neighbors];
      } else if (anchorEvidence.source) {
        const paperPayload = await callTool("fetch_civil_paper", {
          source: anchorEvidence.source,
          include_sections: true,
          include_chunks: true,
          max_sections: 20,
          max_chunks: 12,
        });
        const structured = paperPayload.structuredContent as {
          document?: {
            id?: string;
            source?: string;
            collection?: string;
            source_type?: string;
            parent_source_pdf?: string;
            paper_code?: string;
            page_start?: number | null;
            page_end?: number | null;
            proceeding_no?: number | null;
            proceeding_year?: number | null;
            discipline?: string;
          };
          sections?: unknown;
          chunks?: unknown;
        };
        const document = structured.document;
        const paperSections = Array.isArray(structured.sections) ? (structured.sections as SectionResult[]) : [];
        const paperChunks = Array.isArray(structured.chunks) ? (structured.chunks as ChunkResult[]) : [];
        sections = [
          ...sections,
          ...paperSections.map((section) => ({
            ...section,
            document_id: section.document_id ?? document?.id,
            source: section.source ?? document?.source ?? anchorEvidence.source,
            collection: section.collection ?? document?.collection ?? anchorEvidence.collection,
            source_type: section.source_type ?? document?.source_type,
            parent_source_pdf: section.parent_source_pdf ?? document?.parent_source_pdf,
            paper_code: section.paper_code ?? document?.paper_code ?? anchorEvidence.paperCode,
            discipline: section.discipline ?? document?.discipline,
          })),
        ];
        chunks = [...chunks, ...paperChunks];
      }
    } catch {
      // The normal section/chunk search below is the fallback path for stale or missing anchors.
    }
  }

  let exactPaperMatches = 0;
  if (!explicitAnchor) {
    for (const source of explicitPaperSources(question)) {
      if (toolCalls >= Math.min(MAX_TOOL_CALLS, MAX_AGENT_STEPS)) break;
      try {
        const paperPayload = await callTool("fetch_civil_paper", {
          source,
          include_sections: true,
          include_chunks: true,
          max_sections: 20,
          max_chunks: 80,
        });
        const structured = paperPayload.structuredContent as {
          found?: boolean;
          document?: {
            id?: string;
            source?: string;
            collection?: string;
            source_type?: string;
            parent_source_pdf?: string;
            paper_code?: string;
            discipline?: string;
          };
          sections?: unknown;
          chunks?: unknown;
        };
        const document = structured.document;
        if (!structured.found || !document || (collection && document.collection !== collection)) continue;
        const paperSections = Array.isArray(structured.sections) ? (structured.sections as SectionResult[]) : [];
        const paperChunks = Array.isArray(structured.chunks) ? (structured.chunks as ChunkResult[]) : [];
        sections = [
          ...sections,
          ...paperSections.map((section) => ({
            ...section,
            document_id: section.document_id ?? document.id,
            source: section.source ?? document.source ?? source,
            collection: section.collection ?? document.collection,
            source_type: section.source_type ?? document.source_type,
            parent_source_pdf: section.parent_source_pdf ?? document.parent_source_pdf,
            paper_code: section.paper_code ?? document.paper_code,
            discipline: section.discipline ?? document.discipline,
          })),
        ];
        chunks = [...chunks, ...paperChunks];
        exactPaperMatches += 1;
      } catch {
        // If an explicit source is stale or missing, bounded semantic retrieval remains the fallback.
      }
    }
  }

  if (exactPaperMatches === 0) {
    const sectionsPayload = await callTool("search_civil_sections", {
      query: queryByIntent,
      discipline: plan.discipline,
      max_results: sectionTopKByIntent[plan.intent],
      collection,
    });
    sections = [...sections, ...getStructuredResults<SectionResult>(sectionsPayload)];
    const sectionIds = uniqueStrings(
      [anchorEvidence?.sectionId, ...sections.map((section) => section.id)].filter(Boolean),
      24,
    );
    const documentIds = explicitAnchor ? uniqueStrings([anchorEvidence?.documentId], 4) : [];

    const shouldFetchChunks =
      plan.intent !== "summarize" || sections.length < 5 || Number(sections[0]?.similarity ?? 0) < 0.2;

    if (shouldFetchChunks && toolCalls < Math.min(MAX_TOOL_CALLS, MAX_AGENT_STEPS)) {
      const chunkTopKByIntent: Record<Intent, number> = {
        simple_lookup: MCP_CHUNK_CANDIDATE_LIMIT,
        compare: MCP_CHUNK_CANDIDATE_LIMIT,
        summarize: 12,
        methodology: MCP_CHUNK_CANDIDATE_LIMIT,
        citation_search: MCP_CHUNK_CANDIDATE_LIMIT,
      };
      const chunksPayload = await callTool("search_civil_chunks", {
        query: queryByIntent,
        discipline: plan.discipline,
        max_results: chunkTopKByIntent[plan.intent],
        section_ids: sectionIds.length ? sectionIds : undefined,
        document_ids: documentIds.length ? documentIds : undefined,
        collection,
      });
      chunks = [...chunks, ...getStructuredResults<ChunkResult>(chunksPayload)];

      if (chunks.length === 0 && plan.intent !== "summarize" && toolCalls < Math.min(MAX_TOOL_CALLS, MAX_AGENT_STEPS)) {
        const fallbackChunksPayload = await callTool("search_civil_chunks", {
          query: queryByIntent,
          discipline: plan.discipline,
          max_results: chunkTopKByIntent[plan.intent],
          collection,
        });
        chunks = getStructuredResults<ChunkResult>(fallbackChunksPayload);
      }
    }
  }

  if (plan.needsNeighbors && chunks[0]?.id && toolCalls < Math.min(MAX_TOOL_CALLS, MAX_AGENT_STEPS)) {
    const neighborsPayload = await callTool("fetch_chunk_neighbors", {
      chunk_id: chunks[0].id,
      window: 1,
    });
    const structured = neighborsPayload.structuredContent as { neighbors?: unknown } | undefined;
    const neighbors = Array.isArray(structured?.neighbors) ? (structured.neighbors as ChunkResult[]) : [];
    chunks = dedupeChunks([...neighbors, ...chunks]);
  }

  const built = buildContextText(plan, sections, chunks, toolCalls, collection, anchor);
  return {
    ...built,
    router: {
      provider: routerProvider,
      model: routerModel,
      source: routerPlan.source,
      latencyMs: routerPlan.latencyMs,
    },
  };
}

async function buildMcpContext(
  question: string,
  routerProvider: RouterProvider,
  routerModel: string,
  collection: CollectionFilter,
  anchor?: ConversationAnchor,
): Promise<BuiltContext> {
  if (!AGENTIC_CONTEXT_ENABLED) {
    return callSimpleRagContext(question, routerProvider, routerModel, collection);
  }

  try {
    return await buildAgenticContext(question || "civil engineering", routerProvider, routerModel, collection, anchor);
  } catch (error) {
    if (!SIMPLE_RAG_FALLBACK) throw error;
    const fallback = await callSimpleRagContext(question || "civil engineering", routerProvider, routerModel, collection);
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...fallback,
      context: `Agentic context failed, using simple RAG fallback. Error: ${message}\n\n${fallback.context}`,
    };
  }
}

export async function POST(request: NextRequest) {
  const totalStarted = performance.now();
  const providedRequestId = request.headers.get("x-request-id")?.trim() ?? "";
  const requestId = /^[a-zA-Z0-9:_-]{8,160}$/.test(providedRequestId) ? providedRequestId : safeTraceId();
  const traceId = safeTraceId();

  let body: ChatBody;
  try {
    body = await readBoundedJson<ChatBody>(request, CHAT_MAX_BODY_BYTES);
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status },
    );
  }

  const validationError = validateChatBody(body);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 422 });
  }

  try {
    assertChatSecurityEnv();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Chat security runtime is not configured." },
      { status: 503 },
    );
  }

  let resolvedIdentity: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolvedIdentity = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolvedIdentity;
  const finalizeResponse = (response: Response): NextResponse => {
    const nextResponse = new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    return applyChatIdentityCookies(nextResponse, identity, applyAuthCookies);
  };

  let rate: Awaited<ReturnType<typeof consumeChatQuota>>;
  try {
    rate = await consumeChatQuota({
      userId: identity.userId,
      ipAddress: getRequestIp(request),
      isAuthenticated: identity.isAuthenticated,
      guestMinuteLimit: CHAT_GUEST_REQUESTS_PER_MINUTE,
      guestHourLimit: CHAT_GUEST_REQUESTS_PER_HOUR,
      authenticatedMinuteLimit: CHAT_AUTH_REQUESTS_PER_MINUTE,
      authenticatedHourLimit: CHAT_AUTH_REQUESTS_PER_HOUR,
    });
  } catch (error) {
    console.error("civilmcp_distributed_quota_failed", error instanceof Error ? error.message : String(error));
    return finalizeResponse(Response.json({ error: "Chat quota service is temporarily unavailable." }, { status: 503 }));
  }
  if (!rate.allowed) {
    return finalizeResponse(
      Response.json(
        { error: `Too many chat requests. Try again after ${new Date(rate.resetAt).toISOString()}.` },
        { status: 429, headers: rateLimitHeaders(rate) },
      ),
    );
  }

  const {
    messages,
    mode = "mcp",
    experience = "answer",
    model,
    collection,
    sessionId,
    paperAnchor,
    debug = false,
    contextOnly = false,
    forceCompact = false,
    routerProvider: requestedRouterProvider,
    routerModel: requestedRouterModel,
  } = body;
  const selectedModel = resolveModel(model);
  const routerProvider = resolveRouterProvider(requestedRouterProvider, requestedRouterModel);
  const routerModel = resolveRouterModel(routerProvider, requestedRouterModel);

  try {
    assertChatRuntimeEnv(mode, selectedModel, routerProvider);
  } catch (error) {
    return finalizeResponse(
      Response.json(
        { error: error instanceof Error ? error.message : "Chat runtime is not configured." },
        { status: 503, headers: rateLimitHeaders(rate) },
      ),
    );
  }

  const languageModel = resolveLanguageModel(selectedModel);
  const userId = identity.userId;
  let traceSessionId: string | null = null;
  try {
    if (!identity.isAuthenticated) await ensureChatUser(userId, { isGuest: true });
    traceSessionId = sessionId && (await getChatSessionForOwner(sessionId, userId)) ? sessionId : null;
  } catch (error) {
    console.error("civilmcp_trace_identity_failed", error instanceof Error ? error.message : String(error));
    return finalizeResponse(
      Response.json({ error: "Chat persistence service is temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(rate) }),
    );
  }

  if (experience === "research" || experience === "automated") {
    const proExperience = experience === "automated" ? "Automated Research" : "Deep Research";
    if (!identity.isAuthenticated) {
      return finalizeResponse(Response.json(
        { error: `${proExperience} is included in Founder Pro. Sign in and upgrade to continue.`, code: "pro_required" },
        { status: 402, headers: rateLimitHeaders(rate) },
      ));
    }
    try {
      const billingState = await getBillingState(userId);
      if (billingState.plan !== "founder_pro" || !billingState.premiumModels) {
        return finalizeResponse(Response.json(
          { error: `${proExperience} is included in Founder Pro. Upgrade to continue.`, code: "pro_required" },
          { status: 402, headers: rateLimitHeaders(rate) },
        ));
      }
    } catch (error) {
      console.error("civilmcp_pro_research_entitlement_failed", error instanceof Error ? error.message : String(error));
      return finalizeResponse(Response.json({ error: `${proExperience} access is temporarily unavailable.` }, { status: 503, headers: rateLimitHeaders(rate) }));
    }
  }

  let creditReservation: Awaited<ReturnType<typeof reserveAnswerCredits>>;
  try {
    creditReservation = await reserveAnswerCredits({
      userId,
      isAuthenticated: identity.isAuthenticated,
      model: selectedModel,
      requestId,
      contextOnly: debug && contextOnly,
    });
  } catch (error) {
    console.error("civilmcp_credit_reservation_failed", error instanceof Error ? error.message : String(error));
    return finalizeResponse(
      Response.json({ error: "Answer credits are temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(rate) }),
    );
  }
  if (!creditReservation.allowed) {
    const proRequired = creditReservation.reason === "pro_required";
    return finalizeResponse(Response.json({
      error: proRequired
        ? `${selectedModel} is included in Founder Pro. Sign in and upgrade to use this model.`
        : `Available answer credits are used up. The next credit refresh is ${creditReservation.resetAt ?? "the next billing period"}.`,
      code: creditReservation.reason,
      plan: creditReservation.plan,
      creditsRemaining: creditReservation.creditsRemaining,
      resetAt: creditReservation.resetAt,
    }, { status: 402, headers: rateLimitHeaders(rate) }));
  }

  let creditRefunded = false;
  const refundCredits = async () => {
    if (creditRefunded) return;
    creditRefunded = true;
    await refundAnswerCredits(userId, requestId, creditReservation.charged);
  };

  try {
  const latestUserForTrace = getLatestUserText(messages ?? []);
  const memoryPreparation = await prepareConversationMemory(
    messages ?? [],
    selectedModel,
    routerProvider,
    routerModel,
    debug && forceCompact,
  );
  const coreMessages = convertToCoreMessages(memoryPreparation.messagesForModel);
  const memoryBlock = buildMemorySystemBlock(memoryPreparation.memory);

  if (mode === "baseline") {
    const system =
      "You are a Civil Engineering assistant. " +
      "Answer from general engineering knowledge. " +
      "Be explicit when uncertain." +
      (memoryBlock ? `\n\n${memoryBlock}` : "");

    if (debug) {
      const answerStarted = performance.now();
      const result = await generateText({
        model: languageModel,
        system,
        messages: coreMessages,
        ...answerGenerationOptions(selectedModel),
      });
      const usage = normalizeUsage(result.usage ?? null);
      const timings: TraceTimings = {
        answerLatencyMs: roundLatencyMs(performance.now() - answerStarted),
        totalLatencyMs: roundLatencyMs(performance.now() - totalStarted),
      };
      const tracePersisted = await saveChatTraceSafe({
        traceId,
        requestId,
        sessionId: traceSessionId,
        userId,
        mode: "baseline",
        model: selectedModel,
        collection: normalizeCollection(collection),
        question: latestUserForTrace,
        answer: result.text,
        usage,
        timings,
        costUsd: estimateCostUsd(selectedModel, usage),
        status: "ok",
        includeContent: true,
      });
      return finalizeResponse(Response.json({
        traceId,
        tracePersisted,
        mode: "baseline",
        model: selectedModel,
        answer: result.text,
        usage,
        timings,
        memory: memoryPreparation.memory,
      }, { headers: rateLimitHeaders(rate) }));
    }

    const baselineData = new StreamData();
    baselineData.appendMessageAnnotation({ type: "civilmcp_trace", traceId, mode: "baseline", model: selectedModel });
    if (memoryPreparation.memory) {
      baselineData.appendMessageAnnotation(memoryPreparation.memory);
    }

    const answerStarted = performance.now();
    const result = streamText({
      model: languageModel,
      system,
      messages: coreMessages,
      ...answerGenerationOptions(selectedModel),
      onError: refundCredits,
      onFinish: async (event) => {
        const answer = typeof event.text === "string" ? event.text : "";
        const usage = normalizeUsage(event.usage ?? null);
        await saveChatTraceSafe({
          traceId,
          requestId,
          sessionId: traceSessionId,
          userId,
          mode: "baseline",
          model: selectedModel,
          collection: normalizeCollection(collection),
          question: latestUserForTrace,
          answer,
          usage,
          timings: {
            answerLatencyMs: roundLatencyMs(performance.now() - answerStarted),
            totalLatencyMs: roundLatencyMs(performance.now() - totalStarted),
          },
          costUsd: estimateCostUsd(selectedModel, usage),
          status: "ok",
        });
        await baselineData.close();
      },
    });
    return finalizeResponse(result.toDataStreamResponse({ data: baselineData, headers: rateLimitHeaders(rate) }));
  }

  const latestUserText = getLatestUserText(messages ?? []);
  const conversationContext = buildConversationContext(messages ?? [], latestUserText);
  const explicitPaperAnchor = paperAnchorToConversationAnchor(paperAnchor);
  const effectiveConversationContext: ConversationContext = explicitPaperAnchor
    ? {
        ...conversationContext,
        collection: normalizeCollection(explicitPaperAnchor.evidence?.collection) || conversationContext.collection,
        anchor: explicitPaperAnchor,
        retrievalQuestion: [
          conversationContext.latestUserText,
          `Selected paper anchor: source=${explicitPaperAnchor.evidence?.source}`,
          explicitPaperAnchor.evidence?.collection ? `collection=${explicitPaperAnchor.evidence.collection}` : "",
          explicitPaperAnchor.evidence?.paperCode ? `paper_code=${explicitPaperAnchor.evidence.paperCode}` : "",
          "Prioritize this exact paper/source first. Only broaden if the selected paper has insufficient evidence.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }
    : conversationContext;
  const requestedCollection = normalizeCollection(collection);
  const mixedExplicitPaperCollections = hasMixedExplicitPaperCollections(effectiveConversationContext.retrievalQuestion);
  const collectionFilter =
    requestedCollection ||
    (mixedExplicitPaperCollections
      ? ""
      : effectiveConversationContext.collection || inferCollectionFromQuestion(effectiveConversationContext.retrievalQuestion));
  const contextStarted = performance.now();
  const rawBuiltContext = await buildMcpContext(
    effectiveConversationContext.retrievalQuestion,
    routerProvider,
    routerModel,
    collectionFilter,
    effectiveConversationContext.anchor,
  );
  const builtContext: BuiltContext = {
    ...rawBuiltContext,
    contextLatencyMs: roundLatencyMs(performance.now() - contextStarted),
  };
  const system = buildAnswerSystemPrompt(builtContext, effectiveConversationContext, memoryPreparation.memory);
  const contextAnnotation = buildContextAnnotation(builtContext, effectiveConversationContext, traceId);
  const contextStats = buildContextStats(builtContext, effectiveConversationContext, memoryPreparation.memory);

  if (debug && contextOnly) {
    const timings: TraceTimings = {
      contextLatencyMs: builtContext.contextLatencyMs ?? null,
      totalLatencyMs: roundLatencyMs(performance.now() - totalStarted),
    };
    const tracePersisted = await saveChatTraceSafe({
      traceId,
      requestId,
      sessionId: traceSessionId,
      userId,
      mode: "mcp",
      model: selectedModel,
      collection: collectionFilter,
      question: latestUserForTrace,
      answer: null,
      contextStats,
      evidenceItems: builtContext.evidenceItems,
      plan: builtContext.plan ? { ...builtContext.plan } : null,
      usage: null,
      timings,
      costUsd: null,
      status: "ok",
      includeContent: true,
    });
    return finalizeResponse(Response.json({
      traceId,
      tracePersisted,
      mode: builtContext.mode,
      model: selectedModel,
      answer: "",
      usage: null,
      contextStats,
      evidenceItems: builtContext.evidenceItems,
      plan: builtContext.plan ?? null,
      timings,
      memory: memoryPreparation.memory,
    }, { headers: rateLimitHeaders(rate) }));
  }

  if (experience !== "answer") {
    const answerStarted = performance.now();
    const missionResult = await generateMissionArtifact(
      latestUserForTrace,
      experience,
      builtContext,
      languageModel,
      selectedModel,
    );
    const answer = buildMissionMarkdown(missionResult.artifact);
    const usage = missionResult.usage;
    const timings: TraceTimings = {
      contextLatencyMs: builtContext.contextLatencyMs ?? null,
      answerLatencyMs: roundLatencyMs(performance.now() - answerStarted),
      totalLatencyMs: roundLatencyMs(performance.now() - totalStarted),
    };
    const missionStats = {
      ...contextStats,
      experience,
      artifactVersion: missionResult.artifact.version,
      artifactVerdict: missionResult.artifact.verdict.status,
      artifactFallback: missionResult.usedFallback,
      citationMarkers: citationMarkers(answer),
    };
    const tracePersisted = await saveChatTraceSafe({
      traceId,
      requestId,
      sessionId: traceSessionId,
      userId,
      mode: "mcp",
      model: selectedModel,
      collection: collectionFilter,
      question: latestUserForTrace,
      answer,
      contextStats: missionStats,
      evidenceItems: builtContext.evidenceItems,
      plan: builtContext.plan ? { ...builtContext.plan } : null,
      usage,
      timings,
      costUsd: estimateCostUsd(selectedModel, usage),
      status: "ok",
      includeContent: debug,
    });

    if (debug) {
      return finalizeResponse(Response.json({
        traceId,
        tracePersisted,
        mode: builtContext.mode,
        experience,
        model: selectedModel,
        answer,
        artifact: missionResult.artifact,
        usage,
        contextStats: missionStats,
        evidenceItems: builtContext.evidenceItems,
        plan: builtContext.plan ?? null,
        timings,
        memory: memoryPreparation.memory,
      }, { headers: rateLimitHeaders(rate) }));
    }

    const response = createDataStreamResponse({
      headers: rateLimitHeaders(rate),
      execute: (writer) => {
        writer.writeMessageAnnotation(contextAnnotation);
        if (memoryPreparation.memory) writer.writeMessageAnnotation(memoryPreparation.memory);
        writer.writeMessageAnnotation({
          type: "civilmcp_mission",
          traceId,
          artifact: missionResult.artifact,
        });
        writer.write(formatDataStreamPart("text", answer));
        writer.write(
          formatDataStreamPart("finish_message", {
            finishReason: "stop",
            usage: {
              promptTokens: usageNumber(usage, ["promptTokens", "inputTokens", "prompt_tokens", "input_tokens"]),
              completionTokens: usageNumber(usage, ["completionTokens", "outputTokens", "completion_tokens", "output_tokens"]),
            },
          }),
        );
      },
      onError: () => "CivilMCP could not publish the Evidence Brief.",
    });
    return finalizeResponse(response);
  }

  if (debug) {
    const answerStarted = performance.now();
    const result = await generateText({
      model: languageModel,
      system,
      messages: coreMessages,
      ...answerGenerationOptions(selectedModel),
    });
    const generatedAnswer = result.text ?? "";
    const answer = shouldUseAnswerFallback(generatedAnswer, builtContext.evidenceItems)
      ? buildFallbackResearchBrief(latestUserForTrace, builtContext)
      : generatedAnswer;
    const usage = normalizeUsage(result.usage ?? null);
    const timings: TraceTimings = {
      contextLatencyMs: builtContext.contextLatencyMs ?? null,
      answerLatencyMs: roundLatencyMs(performance.now() - answerStarted),
      totalLatencyMs: roundLatencyMs(performance.now() - totalStarted),
    };
    const tracePersisted = await saveChatTraceSafe({
      traceId,
      requestId,
      sessionId: traceSessionId,
      userId,
      mode: "mcp",
      model: selectedModel,
      collection: collectionFilter,
      question: latestUserForTrace,
      answer,
      contextStats: { ...contextStats, citationMarkers: citationMarkers(answer), answerFallback: answer !== generatedAnswer },
      evidenceItems: builtContext.evidenceItems,
      plan: builtContext.plan ? { ...builtContext.plan } : null,
      usage,
      timings,
      costUsd: estimateCostUsd(selectedModel, usage),
      status: "ok",
      includeContent: true,
    });
    return finalizeResponse(Response.json({
      traceId,
      tracePersisted,
      mode: builtContext.mode,
      model: selectedModel,
      answer,
      usage,
      contextStats: { ...contextStats, citationMarkers: citationMarkers(answer), answerFallback: answer !== generatedAnswer },
      evidenceItems: builtContext.evidenceItems,
      plan: builtContext.plan ?? null,
      timings,
      memory: memoryPreparation.memory,
    }, { headers: rateLimitHeaders(rate) }));
  }

  const data = new StreamData();
  data.appendMessageAnnotation(contextAnnotation);
  if (memoryPreparation.memory) {
    data.appendMessageAnnotation(memoryPreparation.memory);
  }

  const answerStarted = performance.now();
  const result = streamText({
    model: languageModel,
    system,
    messages: coreMessages,
    ...answerGenerationOptions(selectedModel),
    onError: refundCredits,
    onFinish: async (event) => {
      const generatedAnswer = typeof event.text === "string" ? event.text : "";
      const answer = shouldUseAnswerFallback(generatedAnswer, builtContext.evidenceItems)
        ? buildFallbackResearchBrief(latestUserForTrace, builtContext)
        : generatedAnswer;
      const usage = normalizeUsage(event.usage ?? null);
      await saveChatTraceSafe({
        traceId,
        requestId,
        sessionId: traceSessionId,
        userId,
        mode: "mcp",
        model: selectedModel,
        collection: collectionFilter,
        question: latestUserForTrace,
        answer,
        contextStats: { ...contextStats, citationMarkers: citationMarkers(answer), answerFallback: answer !== generatedAnswer },
        evidenceItems: builtContext.evidenceItems,
        plan: builtContext.plan ? { ...builtContext.plan } : null,
        usage,
        timings: {
          contextLatencyMs: builtContext.contextLatencyMs ?? null,
          answerLatencyMs: roundLatencyMs(performance.now() - answerStarted),
          totalLatencyMs: roundLatencyMs(performance.now() - totalStarted),
        },
        costUsd: estimateCostUsd(selectedModel, usage),
        status: "ok",
      });
      await data.close();
    },
  });

  return finalizeResponse(result.toDataStreamResponse({ data, headers: rateLimitHeaders(rate) }));
  } catch (error) {
    await refundCredits();
    console.error("civilmcp_chat_generation_failed", error instanceof Error ? error.message : String(error));
    return finalizeResponse(Response.json(
      { error: "CivilMCP could not generate this answer. Your credits were restored." },
      { status: 503, headers: rateLimitHeaders(rate) },
    ));
  }
}
