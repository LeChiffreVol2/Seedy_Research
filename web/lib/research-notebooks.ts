import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { SavedResearchCase } from "./research-cases";

export type NotebookCitation = {
  id: string;
  evidenceId: string;
  source: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  snippet: string;
  shareable: boolean;
};

export type NotebookThread = {
  threadId: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NotebookMessage = {
  messageId: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  citations: NotebookCitation[];
  sourceSnapshot: string[];
  insufficient: boolean;
  createdAt: string;
};

export type NotebookNote = {
  noteId: string;
  title: string;
  content: string;
  sourceSnapshot: string[];
  provenance: Record<string, unknown>;
  pinned: boolean;
  stale: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const NOTEBOOK_ARTIFACT_KINDS = [
  "source_guide",
  "evidence_brief",
  "evidence_matrix",
  "literature_synthesis",
  "candidate_gap",
  "next_study_protocol",
  "manuscript_package",
] as const;

export type NotebookArtifactKind = (typeof NOTEBOOK_ARTIFACT_KINDS)[number];

export type NotebookArtifact = {
  artifactId: string;
  kind: NotebookArtifactKind;
  title: string;
  content: string;
  sourceSnapshot: string[];
  provenance: Record<string, unknown>;
  stale: boolean;
  version: number;
  createdAt: string;
};

export type WorkspaceEvidencePack = {
  packId: string;
  workspaceId: string;
  version: number;
  sourceSnapshot: string[];
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ResearchNotebookSnapshot = {
  notebookId: string;
  caseId: string;
  title: string;
  caseQuestion: string;
  caseSources: string[];
  sourceFingerprint: string;
  threads: NotebookThread[];
  activeThreadId: string;
  messages: NotebookMessage[];
  notes: NotebookNote[];
  artifacts: NotebookArtifact[];
  workspacePacks: WorkspaceEvidencePack[];
  updatedAt: string;
};

type NotebookRow = {
  notebook_id: string;
  case_id: string;
  title: string;
  source_fingerprint: string;
  updated_at: string;
};

let supabaseAdminSingleton: any = null;

function getSupabaseAdmin(): any {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase is required for Research Notebook sync.");
  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } }) as any;
  return supabaseAdminSingleton;
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function compactJsonObject(value: unknown, maximum = 40_000): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > maximum) throw new Error("Notebook provenance is too large.");
  return JSON.parse(serialized) as Record<string, unknown>;
}

function compactJsonArray<T>(value: unknown, maximum = 40_000): T[] {
  if (!Array.isArray(value)) return [];
  const serialized = JSON.stringify(value);
  if (serialized.length > maximum) return [];
  return JSON.parse(serialized) as T[];
}

function sourceFingerprint(sources: string[]): string {
  return createHash("sha256").update([...new Set(sources)].sort().join("\n")).digest("hex").slice(0, 24);
}

function normalizeThread(row: any): NotebookThread {
  return {
    threadId: String(row.thread_id),
    title: cleanText(row.title, 160) || "New research thread",
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeMessage(row: any): NotebookMessage {
  return {
    messageId: String(row.message_id),
    threadId: String(row.thread_id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: cleanText(row.content, 6_000),
    citations: compactJsonArray<NotebookCitation>(row.citations),
    sourceSnapshot: Array.isArray(row.source_snapshot) ? row.source_snapshot.map(String).slice(0, 12) : [],
    insufficient: Boolean(row.insufficient),
    createdAt: String(row.created_at),
  };
}

function normalizeNote(row: any): NotebookNote {
  return {
    noteId: String(row.note_id),
    title: cleanText(row.title, 160),
    content: cleanText(row.content, 12_000),
    sourceSnapshot: Array.isArray(row.source_snapshot) ? row.source_snapshot.map(String).slice(0, 12) : [],
    provenance: compactJsonObject(row.provenance),
    pinned: Boolean(row.pinned),
    stale: Boolean(row.stale),
    version: Number(row.version) || 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeArtifact(row: any): NotebookArtifact {
  return {
    artifactId: String(row.artifact_id),
    kind: row.kind as NotebookArtifactKind,
    title: cleanText(row.title, 160),
    content: typeof row.content === "string" ? row.content.slice(0, 30_000) : "",
    sourceSnapshot: Array.isArray(row.source_snapshot) ? row.source_snapshot.map(String).slice(0, 12) : [],
    provenance: compactJsonObject(row.provenance),
    stale: Boolean(row.stale),
    version: Number(row.version) || 1,
    createdAt: String(row.created_at),
  };
}

function normalizePack(row: any): WorkspaceEvidencePack {
  return {
    packId: String(row.pack_id),
    workspaceId: String(row.workspace_id),
    version: Number(row.version) || 1,
    sourceSnapshot: Array.isArray(row.source_snapshot) ? row.source_snapshot.map(String).slice(0, 12) : [],
    payload: compactJsonObject(row.payload, 120_000),
    createdAt: String(row.created_at),
  };
}

export async function ensureResearchNotebook(ownerId: string, researchCase: SavedResearchCase): Promise<NotebookRow> {
  const client = getSupabaseAdmin();
  const fingerprint = sourceFingerprint(researchCase.selectedSources);
  const { data: current, error: readError } = await client
    .from("civil_research_notebooks")
    .select("notebook_id, case_id, title, source_fingerprint, updated_at")
    .eq("case_id", researchCase.caseId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (readError) throw new Error(`Failed to read Research Notebook: ${readError.message}`);

  let notebook = current as NotebookRow | null;
  if (!notebook) {
    const notebookId = `notebook_${randomUUID().replaceAll("-", "")}`;
    const { data, error } = await client.from("civil_research_notebooks").insert({
      notebook_id: notebookId,
      case_id: researchCase.caseId,
      owner_id: ownerId,
      title: cleanText(researchCase.question, 160) || "Research Notebook",
      source_fingerprint: fingerprint,
    }).select("notebook_id, case_id, title, source_fingerprint, updated_at").single();
    if (error) throw new Error(`Failed to create Research Notebook: ${error.message}`);
    notebook = data as NotebookRow;
  } else if (notebook.source_fingerprint !== fingerprint) {
    const now = new Date().toISOString();
    const [{ data, error }, noteResult, artifactResult] = await Promise.all([
      client.from("civil_research_notebooks").update({ source_fingerprint: fingerprint, updated_at: now })
        .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId)
        .select("notebook_id, case_id, title, source_fingerprint, updated_at").single(),
      client.from("civil_research_notebook_notes").update({ stale: true, updated_at: now })
        .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId).eq("stale", false),
      client.from("civil_research_notebook_artifacts").update({ stale: true })
        .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId).eq("stale", false),
    ]);
    if (error) throw new Error(`Failed to synchronize Research Notebook: ${error.message}`);
    if (noteResult.error || artifactResult.error) throw new Error("Failed to mark source-dependent Notebook outputs stale.");
    notebook = data as NotebookRow;
  }

  const { count, error: threadCountError } = await client.from("civil_research_notebook_threads")
    .select("thread_id", { count: "exact", head: true })
    .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId).eq("archived", false);
  if (threadCountError) throw new Error(`Failed to inspect Notebook threads: ${threadCountError.message}`);
  if (!count) {
    const { error } = await client.from("civil_research_notebook_threads").insert({
      notebook_id: notebook.notebook_id,
      owner_id: ownerId,
      title: "Research question",
    });
    if (error) throw new Error(`Failed to create the first Notebook thread: ${error.message}`);
  }
  return notebook;
}

export async function getResearchNotebookSnapshot(
  ownerId: string,
  researchCase: SavedResearchCase,
  requestedThreadId?: string | null,
  synchronizedNotebook?: NotebookRow,
): Promise<ResearchNotebookSnapshot> {
  const notebook = synchronizedNotebook ?? await ensureResearchNotebook(ownerId, researchCase);
  const client = getSupabaseAdmin();
  const { data: threadRows, error: threadError } = await client.from("civil_research_notebook_threads")
    .select("thread_id, title, archived, created_at, updated_at")
    .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId).eq("archived", false)
    .order("updated_at", { ascending: false }).limit(8);
  if (threadError) throw new Error(`Failed to read Notebook threads: ${threadError.message}`);
  const threads: NotebookThread[] = ((threadRows ?? []) as any[]).map(normalizeThread);
  const activeThreadId = threads.some((thread) => thread.threadId === requestedThreadId)
    ? String(requestedThreadId)
    : threads[0]?.threadId ?? "";
  const [messageResult, noteResult, artifactResult, packResult] = await Promise.all([
    activeThreadId
      ? client.from("civil_research_notebook_messages")
        .select("message_id, thread_id, role, content, citations, source_snapshot, insufficient, created_at")
        .eq("thread_id", activeThreadId).eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [], error: null }),
    client.from("civil_research_notebook_notes")
      .select("note_id, title, content, source_snapshot, provenance, pinned, stale, version, created_at, updated_at")
      .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId)
      .order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(12),
    client.from("civil_research_notebook_artifacts")
      .select("artifact_id, kind, title, content, source_snapshot, provenance, stale, version, created_at")
      .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId)
      .order("created_at", { ascending: false }).limit(12),
    client.from("civil_workspace_evidence_packs")
      .select("pack_id, workspace_id, version, source_snapshot, payload, created_at")
      .eq("notebook_id", notebook.notebook_id).eq("owner_id", ownerId)
      .order("created_at", { ascending: false }).limit(12),
  ]);
  if (messageResult.error || noteResult.error || artifactResult.error || packResult.error) {
    throw new Error("Failed to load the complete Research Notebook.");
  }
  return {
    notebookId: notebook.notebook_id,
    caseId: researchCase.caseId,
    title: notebook.title,
    caseQuestion: researchCase.question,
    caseSources: researchCase.selectedSources.slice(0, 50),
    sourceFingerprint: notebook.source_fingerprint,
    threads,
    activeThreadId,
    messages: ((messageResult.data ?? []) as any[]).map(normalizeMessage).reverse(),
    notes: ((noteResult.data ?? []) as any[]).map(normalizeNote),
    artifacts: ((artifactResult.data ?? []) as any[]).map(normalizeArtifact),
    workspacePacks: ((packResult.data ?? []) as any[]).map(normalizePack),
    updatedAt: notebook.updated_at,
  };
}

export async function createNotebookThread(ownerId: string, notebookId: string, title: string): Promise<NotebookThread> {
  const client = getSupabaseAdmin();
  const { count, error: countError } = await client.from("civil_research_notebook_threads")
    .select("thread_id", { count: "exact", head: true }).eq("notebook_id", notebookId).eq("owner_id", ownerId).eq("archived", false);
  if (countError) throw new Error(`Failed to count Notebook threads: ${countError.message}`);
  if ((count ?? 0) >= 8) throw new Error("Light Mode supports up to eight active threads per Research Case.");
  const { data, error } = await client.from("civil_research_notebook_threads").insert({
    notebook_id: notebookId,
    owner_id: ownerId,
    title: cleanText(title, 160) || "New research thread",
  }).select("thread_id, title, archived, created_at, updated_at").single();
  if (error) throw new Error(`Failed to create Notebook thread: ${error.message}`);
  return normalizeThread(data);
}

export async function appendNotebookExchange(input: {
  ownerId: string;
  notebookId: string;
  threadId: string;
  question: string;
  answer: string;
  citations: NotebookCitation[];
  sources: string[];
  insufficient: boolean;
}): Promise<{ userMessage: NotebookMessage; message: NotebookMessage }> {
  const client = getSupabaseAdmin();
  const [{ data: thread, error: threadError }, { count, error: countError }] = await Promise.all([
    client.from("civil_research_notebook_threads").select("thread_id")
      .eq("thread_id", input.threadId).eq("notebook_id", input.notebookId).eq("owner_id", input.ownerId).maybeSingle(),
    client.from("civil_research_notebook_messages").select("message_id", { count: "exact", head: true })
      .eq("thread_id", input.threadId).eq("owner_id", input.ownerId),
  ]);
  if (threadError || !thread) throw new Error("Notebook thread does not belong to this Research Case.");
  if (countError) throw new Error(`Failed to inspect Notebook history: ${countError.message}`);
  if ((count ?? 0) > 78) throw new Error("This Light Mode thread is full. Start a new thread to continue without slowing the Notebook.");
  const sourceSnapshot = [...new Set(input.sources)].slice(0, 12);
  const { data, error } = await client.from("civil_research_notebook_messages").insert([
    {
      thread_id: input.threadId,
      owner_id: input.ownerId,
      role: "user",
      content: cleanText(input.question, 6_000),
      citations: [],
      source_snapshot: sourceSnapshot,
      insufficient: false,
    },
    {
      thread_id: input.threadId,
      owner_id: input.ownerId,
      role: "assistant",
      content: cleanText(input.answer, 6_000),
      citations: compactJsonArray<NotebookCitation>(input.citations, 40_000),
      source_snapshot: sourceSnapshot,
      insufficient: input.insufficient,
    },
  ]).select("message_id, thread_id, role, content, citations, source_snapshot, insufficient, created_at");
  if (error || !data || data.length !== 2) throw new Error(`Failed to save Notebook exchange: ${error?.message ?? "incomplete write"}`);
  const now = new Date().toISOString();
  await Promise.all([
    client.from("civil_research_notebook_threads").update({ updated_at: now }).eq("thread_id", input.threadId).eq("owner_id", input.ownerId),
    client.from("civil_research_notebooks").update({ updated_at: now }).eq("notebook_id", input.notebookId).eq("owner_id", input.ownerId),
  ]);
  const normalized = (data as any[]).map(normalizeMessage);
  const userMessage = normalized.find((item) => item.role === "user");
  const message = normalized.find((item) => item.role === "assistant");
  if (!userMessage || !message) throw new Error("Notebook exchange roles were not preserved.");
  return { userMessage, message };
}

export async function saveNotebookNote(input: {
  ownerId: string;
  notebookId: string;
  title: string;
  content: string;
  sources: string[];
  provenance?: Record<string, unknown>;
}): Promise<NotebookNote> {
  const client = getSupabaseAdmin();
  const { count, error: countError } = await client.from("civil_research_notebook_notes")
    .select("note_id", { count: "exact", head: true }).eq("notebook_id", input.notebookId).eq("owner_id", input.ownerId);
  if (countError) throw new Error(`Failed to inspect Notebook notes: ${countError.message}`);
  if ((count ?? 0) >= 40) throw new Error("Light Mode supports up to forty notes per Research Case.");
  const { data, error } = await client.from("civil_research_notebook_notes").insert({
    notebook_id: input.notebookId,
    owner_id: input.ownerId,
    title: cleanText(input.title, 160) || "Research note",
    content: cleanText(input.content, 12_000),
    source_snapshot: [...new Set(input.sources)].slice(0, 12),
    provenance: compactJsonObject(input.provenance ?? {}),
  }).select("note_id, title, content, source_snapshot, provenance, pinned, stale, version, created_at, updated_at").single();
  if (error) throw new Error(`Failed to save Notebook note: ${error.message}`);
  return normalizeNote(data);
}

export async function saveNotebookArtifact(input: {
  ownerId: string;
  notebookId: string;
  kind: NotebookArtifactKind;
  title: string;
  content: string;
  sources: string[];
  provenance?: Record<string, unknown>;
}): Promise<NotebookArtifact> {
  const client = getSupabaseAdmin();
  const [{ count, error: countError }, { data: latest, error: latestError }] = await Promise.all([
    client.from("civil_research_notebook_artifacts").select("artifact_id", { count: "exact", head: true })
      .eq("notebook_id", input.notebookId).eq("owner_id", input.ownerId),
    client.from("civil_research_notebook_artifacts").select("version")
      .eq("notebook_id", input.notebookId).eq("owner_id", input.ownerId).eq("kind", input.kind)
      .order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (countError || latestError) throw new Error("Failed to inspect Notebook artifact versions.");
  if ((count ?? 0) >= 40) throw new Error("Light Mode supports up to forty Studio artifact versions per Research Case.");
  const version = Math.min(1000, Number(latest?.version ?? 0) + 1);
  const { data, error } = await client.from("civil_research_notebook_artifacts").insert({
    notebook_id: input.notebookId,
    owner_id: input.ownerId,
    kind: input.kind,
    title: cleanText(input.title, 160),
    content: input.content.trim().slice(0, 30_000),
    source_snapshot: [...new Set(input.sources)].slice(0, 12),
    provenance: compactJsonObject(input.provenance ?? {}),
    version,
  }).select("artifact_id, kind, title, content, source_snapshot, provenance, stale, version, created_at").single();
  if (error) throw new Error(`Failed to save Notebook artifact: ${error.message}`);
  return normalizeArtifact(data);
}

export async function saveWorkspaceEvidencePack(input: {
  ownerId: string;
  notebookId: string;
  caseId: string;
  workspaceId: string;
  sources: string[];
  payload: Record<string, unknown>;
}): Promise<WorkspaceEvidencePack> {
  const client = getSupabaseAdmin();
  const [{ count, error: countError }, { data: latest, error: latestError }] = await Promise.all([
    client.from("civil_workspace_evidence_packs").select("pack_id", { count: "exact", head: true })
      .eq("notebook_id", input.notebookId).eq("owner_id", input.ownerId),
    client.from("civil_workspace_evidence_packs").select("version")
      .eq("workspace_id", input.workspaceId).eq("notebook_id", input.notebookId).eq("owner_id", input.ownerId)
      .order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (countError || latestError) throw new Error("Failed to inspect Workspace Evidence Pack versions.");
  if ((count ?? 0) >= 12) throw new Error("Light Mode supports up to twelve Workspace Evidence Pack versions per Research Case.");
  const version = Math.min(1000, Number(latest?.version ?? 0) + 1);
  const payload = compactJsonObject(input.payload, 120_000);
  const { data, error } = await client.from("civil_workspace_evidence_packs").insert({
    workspace_id: input.workspaceId,
    notebook_id: input.notebookId,
    case_id: input.caseId,
    owner_id: input.ownerId,
    version,
    source_snapshot: [...new Set(input.sources)].slice(0, 12),
    payload,
  }).select("pack_id, workspace_id, version, source_snapshot, payload, created_at").single();
  if (error) throw new Error(`Failed to save Workspace Evidence Pack: ${error.message}`);
  await client.from("civil_paper_workspaces").update({ case_id: input.caseId, updated_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId).eq("owner_id", input.ownerId);
  return normalizePack(data);
}

export function notebookSourceFingerprint(sources: string[]): string {
  return sourceFingerprint(sources);
}
