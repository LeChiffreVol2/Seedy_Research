import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";

import {
  DEFAULT_CHAT_MODEL,
  normalizeChatModel,
  normalizeStoredChatModel,
  type ChatModel,
} from "@/lib/chat-models";

export const SESSION_COOKIE_NAME = "civilmcp_session";
export const USER_COOKIE_NAME = "civilmcp_user";

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
};

export type ChatFeedbackInput = {
  traceId: string;
  sessionId?: string | null;
  userId?: string | null;
  messageId?: string | null;
  rating: "up" | "down";
  categories?: string[];
  correction?: string | null;
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

export function createUserId(): string {
  return randomUUID();
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
  return "session_id, share_id, owner_id, title, mode, model, collection, transcript, archived, last_message_at, created_at, updated_at";
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
  return ensureChatSession(createSessionId(), ownerId);
}

export async function listChatSessions(ownerId: string, limit = 30): Promise<ChatSessionSummary[]> {
  const supabase = getSupabaseAdmin();
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("civil_chat_sessions")
    .select(sessionSelect())
    .eq("owner_id", ownerId)
    .eq("archived", false)
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


export async function saveChatTrace(trace: ChatTraceInput): Promise<void> {
  const supabase = getSupabaseAdmin();
  const payload = {
    trace_id: trace.traceId,
    request_id: trace.requestId ?? null,
    session_id: trace.sessionId ?? null,
    user_id: trace.userId ?? null,
    message_id: trace.messageId ?? null,
    mode: normalizeChatMode(trace.mode),
    model: trace.model,
    collection: normalizeCollectionFilter(trace.collection),
    question: trace.question ?? null,
    answer: trace.answer ?? null,
    context_stats: trace.contextStats ?? {},
    evidence_items: trace.evidenceItems ?? [],
    tool_trace: trace.toolTrace ?? [],
    plan: trace.plan ?? null,
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
  const feedbackId = randomUUID();
  const categories = [...new Set((feedback.categories ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  const { error } = await supabase.from("civil_chat_feedback").insert({
    feedback_id: feedbackId,
    trace_id: feedback.traceId,
    session_id: feedback.sessionId ?? null,
    user_id: feedback.userId ?? null,
    message_id: feedback.messageId ?? null,
    rating: feedback.rating,
    categories,
    correction: feedback.correction?.trim() || null,
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
      "feedback_id, trace_id, session_id, user_id, message_id, rating, categories, correction, citation_issue, created_at, civil_chat_traces(question, answer, model, collection, context_stats, evidence_items, usage, timings)",
    )
    .order("created_at", { ascending: false })
    .limit(boundedLimit);

  if (error) {
    throw new Error(`Failed to export feedback eval rows: ${error.message}`);
  }
  return data ?? [];
}

export async function ensureShareableSession(sessionId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("civil_chat_sessions")
    .select("share_id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to inspect share state: ${error.message}`);
  }

  const existingShareId = typeof data?.share_id === "string" ? data.share_id : "";
  if (existingShareId) {
    return existingShareId;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareId = createShareId();
    const { error: updateError } = await supabase
      .from("civil_chat_sessions")
      .update({ share_id: shareId, updated_at: new Date().toISOString() })
      .eq("session_id", sessionId);

    if (!updateError) {
      return shareId;
    }

    if (!updateError.message.toLowerCase().includes("duplicate")) {
      throw new Error(`Failed to create share link: ${updateError.message}`);
    }
  }

  throw new Error("Failed to create unique share link after multiple attempts.");
}
