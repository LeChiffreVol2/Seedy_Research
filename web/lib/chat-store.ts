import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";

import {
  DEFAULT_CHAT_MODEL,
  normalizeChatModel,
  normalizeStoredChatModel,
  type ChatModel,
} from "@/lib/chat-models";
import { deriveCivilSecurityKey, GUEST_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/chat-cookies";

export { SESSION_COOKIE_NAME };
export const USER_COOKIE_NAME = GUEST_COOKIE_NAME;

export type ChatMode = "baseline" | "mcp";
export type CollectionFilter = "" | "ce_project" | "ncce";

export const DEFAULT_CHAT_MODE: ChatMode = "mcp";
export const DEFAULT_COLLECTION_FILTER: CollectionFilter = "";

export type ChatSessionSnapshot = {
  sessionId: string;
  title: string;
  mode: ChatMode;
  model: ChatModel;
  collection: CollectionFilter;
  messages: UIMessage[];
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string | null;
};

export type ChatUserProfile = {
  userId: string;
  displayName: string;
  email?: string | null;
  isGuest: boolean;
};

export type ChatTraceInput = {
  traceId: string;
  requestId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  messageId?: string | null;
  mode: ChatMode;
  model: string;
  collection: CollectionFilter;
  question?: string | null;
  answer?: string | null;
  contextStats?: Record<string, unknown> | null;
  evidenceItems?: unknown[] | null;
  toolTrace?: unknown[] | null;
  plan?: Record<string, unknown> | null;
  usage?: Record<string, unknown> | null;
  timings?: Record<string, unknown> | null;
  costUsd?: number | null;
  status?: "ok" | "error";
  errorClass?: string | null;
  includeContent?: boolean;
};

export type ChatFeedbackInput = {
  traceId: string;
  sessionId?: string | null;
  userId?: string | null;
  messageId?: string | null;
  rating: "up" | "down";
  categories?: string[];
  correction?: string | null;
  questionSnapshot?: string | null;
  answerSnapshot?: string | null;
};

export type ChatFeedbackRecord = {
  feedbackId: string;
};

export type ChatSessionSummary = {
  sessionId: string;
  title: string;
  mode: ChatMode;
  model: ChatModel;
  collection: CollectionFilter;
  messageCount: number;
  lastUserMessage: string;
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string | null;
};

type ChatSessionRow = {
  session_id: string;
  share_id: string | null;
  share_expires_at?: string | null;
  share_revoked_at?: string | null;
  owner_id?: string | null;
  title?: string | null;
  mode: string;
  model: string;
  collection?: string | null;
  transcript: unknown;
  archived?: boolean | null;
  last_message_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ChatUserRow = {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
  is_guest?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

let supabaseAdminSingleton: any = null;

function getSupabaseAdmin(): any {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for chat history.");
  }

  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  }) as any;
  return supabaseAdminSingleton;
}

export function normalizeChatMode(value: string | undefined): ChatMode {
  return value === "baseline" ? "baseline" : DEFAULT_CHAT_MODE;
}

export function normalizeCollectionFilter(value: string | undefined | null): CollectionFilter {
  return value === "ce_project" || value === "ncce" ? value : DEFAULT_COLLECTION_FILTER;
}

export function normalizeMessages(value: unknown): UIMessage[] {
  return Array.isArray(value) ? (value as UIMessage[]) : [];
}

function normalizeSessionRow(row: ChatSessionRow | null): ChatSessionSnapshot {
  const messages = normalizeMessages(row?.transcript);
  return {
    sessionId: row?.session_id ?? "",
    title: normalizeSessionTitle(row?.title, messages),
    mode: normalizeChatMode(row?.mode),
    model: normalizeStoredChatModel(row?.model),
    collection: normalizeCollectionFilter(row?.collection),
    messages,
    createdAt: row?.created_at,
    updatedAt: row?.updated_at,
    lastMessageAt: row?.last_message_at ?? null,
  };
}

export function createSessionId(): string {
  return randomUUID();
}

export function isValidSessionId(value: string | undefined | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export function createUserId(): string {
  return randomUUID();
}

export function createEmptyChatSession(sessionId = createSessionId()): ChatSessionSnapshot {
  return {
    sessionId,
    title: "Untitled chat",
    mode: DEFAULT_CHAT_MODE,
    model: DEFAULT_CHAT_MODEL,
    collection: DEFAULT_COLLECTION_FILTER,
    messages: [],
    lastMessageAt: null,
  };
}

function createShareId(): string {
  return randomBytes(9).toString("base64url");
}

function textFromMessage(message: UIMessage | undefined): string {
  if (!message) return "";
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") return content;
  const parts = (message as unknown as { parts?: Array<{ type?: string; text?: string }> }).parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join(" ");
  }
  return "";
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[#*_`[\]]/g, "")
    .trim()
    .slice(0, 86);
}

function normalizeSessionTitle(value: string | null | undefined, messages: UIMessage[]): string {
  const stored = cleanTitle(value ?? "");
  if (stored && stored !== "Untitled chat") return stored;
  const firstUser = messages.find((message) => message.role === "user");
  const title = cleanTitle(textFromMessage(firstUser));
  return title || "Untitled chat";
}

function lastUserMessage(messages: UIMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "user");
  return cleanTitle(textFromMessage(message)).slice(0, 120);
}

function normalizeUserRow(row: ChatUserRow, fallbackUserId: string): ChatUserProfile {
  return {
    userId: row.user_id || fallbackUserId,
    displayName: cleanTitle(row.display_name ?? "") || "Guest researcher",
    email: row.email ?? null,
    isGuest: row.is_guest !== false,
  };
}

export async function ensureChatUser(
  userId: string,
  profile?: { displayName?: string; email?: string | null; isGuest?: boolean },
): Promise<ChatUserProfile> {
  const supabase = getSupabaseAdmin();
  if (!profile) {
    const existing = await getChatUser(userId);
    if (existing) return existing;
  }

  const displayName = cleanTitle(profile?.displayName ?? "") || "Guest researcher";
  const email = profile?.email?.trim().toLowerCase() || null;
  const isGuest = profile?.isGuest ?? !email;

  const { data, error } = await supabase
    .from("civil_chat_users")
    .upsert(
      {
        user_id: userId,
        display_name: displayName,
        email,
        is_guest: isGuest,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("user_id, display_name, email, is_guest, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`Failed to save chat user: ${error.message}`);
  }

  return normalizeUserRow(data as ChatUserRow, userId);
}

export async function getChatUser(userId: string): Promise<ChatUserProfile | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("civil_chat_users")
    .select("user_id, display_name, email, is_guest, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read chat user: ${error.message}`);
  }

  return data ? normalizeUserRow(data as ChatUserRow, userId) : null;
}

function sessionSelect(): string {
  return "session_id, share_id, share_expires_at, share_revoked_at, owner_id, title, mode, model, collection, transcript, archived, last_message_at, created_at, updated_at";
}

export async function ensureChatSession(sessionId: string, ownerId?: string): Promise<ChatSessionSnapshot> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("civil_chat_sessions")
    .select(sessionSelect())
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read chat session: ${error.message}`);
  }

  if (data) {
    const row = data as ChatSessionRow;
    if (ownerId && row.owner_id && row.owner_id !== ownerId) {
      throw new Error("Chat session belongs to another owner.");
    }
    if (ownerId && !row.owner_id) {
      await supabase
        .from("civil_chat_sessions")
        .update({ owner_id: ownerId, updated_at: new Date().toISOString() })
        .eq("session_id", sessionId);
    }
    return normalizeSessionRow(row);
  }

  const insertPayload = {
    session_id: sessionId,
    owner_id: ownerId ?? null,
    title: "Untitled chat",
    mode: DEFAULT_CHAT_MODE,
    model: DEFAULT_CHAT_MODEL,
    collection: DEFAULT_COLLECTION_FILTER,
    transcript: [],
    archived: false,
    updated_at: new Date().toISOString(),
  };
  const { data: inserted, error: insertError } = await supabase
    .from("civil_chat_sessions")
    .insert(insertPayload)
    .select(sessionSelect())
    .single();

  if (insertError) {
    throw new Error(`Failed to create chat session: ${insertError.message}`);
  }

  return normalizeSessionRow(inserted as ChatSessionRow);
}

export async function getChatSessionByShareId(shareId: string): Promise<ChatSessionSnapshot | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("civil_chat_sessions")
    .select(sessionSelect())
    .eq("share_id", shareId)
    .is("share_revoked_at", null)
    .gt("share_expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load shared session: ${error.message}`);
  }

  return data ? normalizeSessionRow(data as ChatSessionRow) : null;
}

export async function getChatSessionForOwner(sessionId: string, ownerId: string): Promise<ChatSessionSnapshot | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("civil_chat_sessions")
    .select(sessionSelect())
    .eq("session_id", sessionId)
    .eq("owner_id", ownerId)
    .eq("archived", false)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load chat session: ${error.message}`);
  }

  return data ? normalizeSessionRow(data as ChatSessionRow) : null;
}

export async function createChatSession(ownerId: string): Promise<ChatSessionSnapshot> {
  void ownerId;
  return createEmptyChatSession();
}

export async function listChatSessions(ownerId: string, limit = 30): Promise<ChatSessionSummary[]> {
  const supabase = getSupabaseAdmin();
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("civil_chat_sessions")
    .select(sessionSelect())
    .eq("owner_id", ownerId)
    .eq("archived", false)
    .not("last_message_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(boundedLimit);

  if (error) {
    throw new Error(`Failed to list chat sessions: ${error.message}`);
  }

  return ((data ?? []) as ChatSessionRow[]).map((row) => {
    const messages = normalizeMessages(row.transcript);
    return {
      sessionId: row.session_id,
      title: normalizeSessionTitle(row.title, messages),
      mode: normalizeChatMode(row.mode),
      model: normalizeStoredChatModel(row.model),
      collection: normalizeCollectionFilter(row.collection),
      messageCount: messages.length,
      lastUserMessage: lastUserMessage(messages),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at ?? null,
    };
  });
}

export async function archiveChatSession(sessionId: string, ownerId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("civil_chat_sessions")
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("owner_id", ownerId);

  if (error) {
    throw new Error(`Failed to archive chat session: ${error.message}`);
  }
}

export async function transferChatSessions(fromOwnerId: string | null | undefined, toOwnerId: string): Promise<void> {
  const from = fromOwnerId?.trim();
  const to = toOwnerId.trim();
  if (!from || !to || from === to) return;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("civil_chat_sessions")
    .update({ owner_id: to, updated_at: new Date().toISOString() })
    .eq("owner_id", from);

  if (error) {
    throw new Error(`Failed to transfer chat sessions: ${error.message}`);
  }
}

export async function saveChatSession(sessionId: string, snapshot: ChatSessionSnapshot, ownerId?: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const messages = normalizeMessages(snapshot.messages);
  const title = normalizeSessionTitle(snapshot.title, messages);
  const hasMessages = messages.length > 0;
  const payload = {
    session_id: sessionId,
    owner_id: ownerId ?? undefined,
    title,
    mode: normalizeChatMode(snapshot.mode),
    model: normalizeChatModel(snapshot.model),
    collection: normalizeCollectionFilter(snapshot.collection),
    transcript: messages,
    archived: false,
    last_message_at: hasMessages ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("civil_chat_sessions")
    .upsert(payload, { onConflict: "session_id" });

  if (error) {
    throw new Error(`Failed to save chat session: ${error.message}`);
  }
}


function metadataOnlyTraceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(metadataOnlyTraceValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(question|answer|query|snippet|content|prompt|reason|argument|input)/i.test(key))
      .map(([key, item]) => [key, metadataOnlyTraceValue(item)]),
  );
}

export async function saveChatTrace(trace: ChatTraceInput): Promise<void> {
  const supabase = getSupabaseAdmin();
  const traceMode = (process.env.TRACE_CONTENT_MODE ?? (process.env.NODE_ENV === "production" ? "metadata" : "debug")).toLowerCase();
  const retainContent = traceMode === "debug" && trace.includeContent === true;
  const hashKey = process.env.TRACE_HASH_KEY?.trim() || process.env.GUEST_SESSION_HMAC_KEY?.trim() || "civilmcp-local-trace-hash";
  const questionHash = trace.question
    ? createHmac("sha256", hashKey).update(trace.question.trim()).digest("hex")
    : null;
  const retentionDays = Math.max(1, Math.min(365, Number.parseInt(process.env.TRACE_RETENTION_DAYS ?? "30", 10) || 30));
  const retentionExpiresAt = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  const payload = {
    trace_id: trace.traceId,
    request_id: trace.requestId ?? null,
    session_id: trace.sessionId ?? null,
    user_id: trace.userId ?? null,
    message_id: trace.messageId ?? null,
    mode: normalizeChatMode(trace.mode),
    model: trace.model,
    collection: normalizeCollectionFilter(trace.collection),
    question: retainContent ? trace.question ?? null : null,
    answer: retainContent ? trace.answer ?? null : null,
    question_hash: questionHash,
    content_mode: retainContent ? "debug" : "metadata",
    retention_expires_at: retentionExpiresAt,
    context_stats: retainContent ? trace.contextStats ?? {} : metadataOnlyTraceValue(trace.contextStats ?? {}),
    evidence_items: retainContent ? trace.evidenceItems ?? [] : metadataOnlyTraceValue(trace.evidenceItems ?? []),
    tool_trace: retainContent ? trace.toolTrace ?? [] : metadataOnlyTraceValue(trace.toolTrace ?? []),
    plan: retainContent ? trace.plan ?? null : metadataOnlyTraceValue(trace.plan ?? null),
    usage: trace.usage ?? null,
    timings: trace.timings ?? {},
    cost_usd: trace.costUsd ?? null,
    status: trace.status ?? "ok",
    error_class: trace.errorClass ?? null,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("civil_chat_traces").upsert(payload, { onConflict: "trace_id" });
  if (error) {
    throw new Error(`Failed to save chat trace: ${error.message}`);
  }
}

export async function saveChatFeedback(feedback: ChatFeedbackInput): Promise<ChatFeedbackRecord> {
  const supabase = getSupabaseAdmin();
  if (!feedback.userId) throw new Error("Feedback requires an authenticated or signed guest identity.");
  const { data: traceRow, error: traceError } = await supabase
    .from("civil_chat_traces")
    .select("trace_id, session_id")
    .eq("trace_id", feedback.traceId)
    .eq("user_id", feedback.userId)
    .maybeSingle();
  if (traceError) throw new Error(`Failed to validate feedback trace: ${traceError.message}`);
  if (!traceRow) throw new Error("Feedback trace was not found for this user.");
  if (feedback.sessionId && traceRow.session_id && feedback.sessionId !== traceRow.session_id) {
    throw new Error("Feedback session does not match its trace.");
  }
  const feedbackId = randomUUID();
  const categories = [...new Set((feedback.categories ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  const keepSnapshot = feedback.rating === "down";
  const contentRetentionDays = Math.max(
    1,
    Math.min(365, Number.parseInt(process.env.FEEDBACK_CONTENT_RETENTION_DAYS ?? "30", 10) || 30),
  );
  const { error } = await supabase.from("civil_chat_feedback").insert({
    feedback_id: feedbackId,
    trace_id: feedback.traceId,
    session_id: traceRow.session_id ?? null,
    user_id: feedback.userId ?? null,
    message_id: feedback.messageId ?? null,
    rating: feedback.rating,
    categories,
    correction: feedback.correction?.trim() || null,
    question_snapshot: keepSnapshot ? feedback.questionSnapshot?.trim().slice(0, 12_000) || null : null,
    answer_snapshot: keepSnapshot ? feedback.answerSnapshot?.trim().slice(0, 40_000) || null : null,
    content_expires_at: keepSnapshot
      ? new Date(Date.now() + contentRetentionDays * 86_400_000).toISOString()
      : null,
    citation_issue: categories.includes("wrong_citation"),
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to save chat feedback: ${error.message}`);
  }
  return { feedbackId };
}

export async function exportFeedbackEvalRows(limit = 100): Promise<unknown[]> {
  const supabase = getSupabaseAdmin();
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const { data, error } = await supabase
    .from("civil_chat_feedback")
    .select(
      "feedback_id, trace_id, session_id, user_id, message_id, rating, categories, correction, citation_issue, question_snapshot, answer_snapshot, content_expires_at, created_at, civil_chat_traces(question, answer, question_hash, model, collection, context_stats, evidence_items, usage, timings)",
    )
    .order("created_at", { ascending: false })
    .limit(boundedLimit);

  if (error) {
    throw new Error(`Failed to export feedback eval rows: ${error.message}`);
  }
  return data ?? [];
}

export async function ensureShareableSession(sessionId: string, ownerId: string): Promise<{ shareId: string; expiresAt: string }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("civil_chat_sessions")
    .select("share_id, share_expires_at, share_revoked_at")
    .eq("session_id", sessionId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to inspect share state: ${error.message}`);
  }
  if (!data) {
    throw new Error("Chat session not found for owner.");
  }

  const existingShareId = typeof data?.share_id === "string" ? data.share_id : "";
  const existingExpiresAt = typeof data?.share_expires_at === "string" ? data.share_expires_at : "";
  if (existingShareId && !data?.share_revoked_at && existingExpiresAt && Date.parse(existingExpiresAt) > Date.now()) {
    return { shareId: existingShareId, expiresAt: existingExpiresAt };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareId = createShareId();
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("civil_chat_sessions")
      .update({
        share_id: shareId,
        share_expires_at: expiresAt,
        share_revoked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId)
      .eq("owner_id", ownerId)
      .select("session_id")
      .maybeSingle();

    if (!updateError && updated) {
      return { shareId, expiresAt };
    }

    if (!updateError) throw new Error("Chat session owner changed while creating the share link.");

    if (!updateError.message.toLowerCase().includes("duplicate")) {
      throw new Error(`Failed to create share link: ${updateError.message}`);
    }
  }

  throw new Error("Failed to create unique share link after multiple attempts.");
}

export async function revokeShareableSession(sessionId: string, ownerId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("civil_chat_sessions")
    .update({ share_revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("owner_id", ownerId);
  if (error) throw new Error(`Failed to revoke share link: ${error.message}`);
}

export type DistributedQuotaResult = {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  policy: string;
};

type QuotaRpcRow = {
  allowed?: boolean;
  remaining?: number;
  reset_at?: string;
  request_count?: number;
};

export async function consumeChatQuota(input: {
  userId: string;
  ipAddress?: string;
  scope?: string;
  isAuthenticated: boolean;
  guestMinuteLimit: number;
  guestHourLimit: number;
  authenticatedMinuteLimit: number;
  authenticatedHourLimit: number;
}): Promise<DistributedQuotaResult> {
  const minuteLimit = input.isAuthenticated ? input.authenticatedMinuteLimit : input.guestMinuteLimit;
  const hourLimit = input.isAuthenticated ? input.authenticatedHourLimit : input.guestHourLimit;
  const hashKey =
    process.env.RATE_LIMIT_HASH_KEY?.trim() ||
    process.env.GUEST_SESSION_HMAC_KEY?.trim() ||
    deriveCivilSecurityKey("quota");
  if (!hashKey) throw new Error("RATE_LIMIT_HASH_KEY or GUEST_SESSION_HMAC_KEY is required for distributed quota.");
  const hashIdentity = (value: string) => createHmac("sha256", hashKey).update(value).digest("hex");
  const identityHash = hashIdentity(`${input.isAuthenticated ? "authenticated" : "guest"}:${input.userId}`);
  const scope = input.scope && /^[a-z0-9_:-]{1,70}$/.test(input.scope) ? input.scope : "web_chat";
  const supabase = getSupabaseAdmin();

  const consume = async (scope: string, quotaIdentityHash: string, limit: number, windowSeconds: number) => {
    const { data, error } = await supabase.rpc("consume_civil_quota", {
      p_identity_hash: quotaIdentityHash,
      p_scope: scope,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error(`Distributed quota failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as QuotaRpcRow | null;
    if (!row || typeof row.allowed !== "boolean" || typeof row.reset_at !== "string") {
      throw new Error("Distributed quota returned an invalid response.");
    }
    return {
      allowed: row.allowed,
      remaining: Number(row.remaining ?? 0),
      reset_at: row.reset_at,
      request_count: Number(row.request_count ?? 0),
      limit,
      windowSeconds,
    };
  };

  const requests = [
    consume(scope, identityHash, minuteLimit, 60),
    consume(scope, identityHash, hourLimit, 3600),
  ];
  const ipAddress = input.ipAddress?.trim();
  if (ipAddress && ipAddress !== "unknown-ip") {
    const ipHash = hashIdentity(`ip:${ipAddress}`);
    requests.push(
      consume(`${scope}_ip`, ipHash, Math.min(10_000, minuteLimit * 10), 60),
      consume(`${scope}_ip`, ipHash, Math.min(10_000, hourLimit * 10), 3600),
    );
  }
  const results = await Promise.all(requests);
  const selected = results.find((result) => !result.allowed) ?? results[0];
  const resetAt = Date.parse(selected.reset_at);
  return {
    allowed: results.every((result) => result.allowed),
    key: `${scope}:${identityHash.slice(0, 16)}`,
    limit: selected.limit,
    remaining: Math.max(0, Number(selected.remaining ?? 0)),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    policy: `${minuteLimit};w=60, ${hourLimit};w=3600, ip-aggregate=10x`,
  };
}

export async function pruneCivilOperationalData(): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("prune_civil_operational_data");
  if (error) throw new Error(`Operational retention cleanup failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    deletedRateBuckets: Number(row?.deleted_rate_buckets ?? 0),
    deletedTraces: Number(row?.deleted_traces ?? 0),
    clearedFeedbackSnapshots: Number(row?.cleared_feedback_snapshots ?? 0),
  };
}
