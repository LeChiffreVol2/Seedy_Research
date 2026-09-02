import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { getPaperDetail } from "./research-feed";

export type ResearchCaseStatus = "active" | "completed" | "archived";
export type ResearchCaseReviewDecision = "accepted" | "rejected";

export type ResearchCaseReview = {
  reviewId: string;
  caseId: string;
  source: string;
  evidenceId: string;
  pageAnchor: string;
  decision: ResearchCaseReviewDecision;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type SavedResearchCase = {
  caseId: string;
  ownerId: string;
  question: string;
  status: ResearchCaseStatus;
  selectedSources: string[];
  state: Record<string, unknown>;
  reviews: ResearchCaseReview[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type CaseRow = {
  case_id: string;
  owner_id: string;
  question: string;
  status: ResearchCaseStatus;
  selected_sources: unknown;
  state: unknown;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

type ReviewRow = {
  review_id: string;
  case_id: string;
  source: string;
  evidence_id: string;
  page_anchor: string;
  decision: ResearchCaseReviewDecision;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

let supabaseAdminSingleton: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for Research Cases.");
  }
  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
  return supabaseAdminSingleton;
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function normalizeState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 250_000) throw new Error("Research Case state is too large.");
  return JSON.parse(serialized) as Record<string, unknown>;
}

function normalizeReview(row: ReviewRow): ResearchCaseReview {
  return {
    reviewId: row.review_id,
    caseId: row.case_id,
    source: row.source,
    evidenceId: row.evidence_id,
    pageAnchor: row.page_anchor,
    decision: row.decision,
    note: row.note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCase(row: CaseRow, reviews: ReviewRow[] = []): SavedResearchCase {
  return {
    caseId: row.case_id,
    ownerId: row.owner_id,
    question: row.question,
    status: row.status,
    selectedSources: Array.isArray(row.selected_sources)
      ? [...new Set(row.selected_sources.map((source) => text(source, 320)).filter(Boolean))].slice(0, 50)
      : [],
    state: normalizeState(row.state),
    reviews: reviews.map(normalizeReview),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

const CASE_SELECT = "case_id, owner_id, question, status, selected_sources, state, created_at, updated_at, completed_at";
const REVIEW_SELECT = "review_id, case_id, source, evidence_id, page_anchor, decision, note, created_at, updated_at";

async function reviewsForCases(ownerId: string, caseIds: string[]): Promise<Map<string, ReviewRow[]>> {
  const grouped = new Map<string, ReviewRow[]>();
  if (!caseIds.length) return grouped;
  const client = getSupabaseAdmin() as any;
  const { data, error } = await client
    .from("civil_research_case_reviews")
    .select(REVIEW_SELECT)
    .eq("owner_id", ownerId)
    .in("case_id", caseIds)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to read Research Case reviews: ${error.message}`);
  for (const row of (data ?? []) as ReviewRow[]) {
    grouped.set(row.case_id, [...(grouped.get(row.case_id) ?? []), row]);
  }
  return grouped;
}

export async function listResearchCases(ownerId: string, limit = 12): Promise<SavedResearchCase[]> {
  const client = getSupabaseAdmin() as any;
  const { data, error } = await client
    .from("civil_research_cases")
    .select(CASE_SELECT)
    .eq("owner_id", ownerId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 30)));
  if (error) throw new Error(`Failed to list Research Cases: ${error.message}`);
  const rows = (data ?? []) as CaseRow[];
  const reviews = await reviewsForCases(ownerId, rows.map((row) => row.case_id));
  return rows.map((row) => normalizeCase(row, reviews.get(row.case_id) ?? []));
}

export async function countCompletedResearchCases(ownerId: string): Promise<number> {
  const client = getSupabaseAdmin() as any;
  const { count, error } = await client
    .from("civil_research_cases")
    .select("case_id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("status", "completed");
  if (error) throw new Error(`Failed to count completed Research Cases: ${error.message}`);
  return Number(count ?? 0);
}

export async function getResearchCase(ownerId: string, caseId: string): Promise<SavedResearchCase | null> {
  const normalizedId = text(caseId, 96);
  const client = getSupabaseAdmin() as any;
  const { data, error } = await client
    .from("civil_research_cases")
    .select(CASE_SELECT)
    .eq("owner_id", ownerId)
    .eq("case_id", normalizedId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read Research Case: ${error.message}`);
  if (!data) return null;
  const reviews = await reviewsForCases(ownerId, [normalizedId]);
  return normalizeCase(data as CaseRow, reviews.get(normalizedId) ?? []);
}

export async function upsertResearchCase(input: {
  caseId?: string | null;
  ownerId: string;
  question: string;
  status?: ResearchCaseStatus;
  selectedSources?: string[];
  state?: Record<string, unknown>;
}): Promise<SavedResearchCase> {
  const client = getSupabaseAdmin() as any;
  const caseId = text(input.caseId, 96) || `case_${randomUUID()}`;
  const question = text(input.question, 500);
  if (question.length < 8) throw new Error("Research Case question must contain at least eight characters.");
  const now = new Date().toISOString();
  const selectedSources = [...new Set((input.selectedSources ?? []).map((source) => text(source, 320)).filter(Boolean))].slice(0, 50);
  const state = normalizeState(input.state ?? {});
  const { data: existing, error: lookupError } = await client
    .from("civil_research_cases")
    .select("owner_id")
    .eq("case_id", caseId)
    .maybeSingle();
  if (lookupError) throw new Error(`Failed to verify Research Case ownership: ${lookupError.message}`);
  const existingOwner = (existing as { owner_id?: string } | null)?.owner_id;
  if (existingOwner && existingOwner !== input.ownerId) throw new Error("Research Case belongs to another researcher.");

  const status = input.status ?? "active";
  const values = {
    question,
    status,
    selected_sources: selectedSources,
    state,
    updated_at: now,
    completed_at: status === "completed" ? now : null,
  };
  const query = existing
    ? client.from("civil_research_cases").update(values).eq("case_id", caseId).eq("owner_id", input.ownerId)
    : client.from("civil_research_cases").insert({ ...values, case_id: caseId, owner_id: input.ownerId });
  const { data, error } = await query.select(CASE_SELECT).single();
  if (error) throw new Error(`Failed to save Research Case: ${error.message}`);
  const reviews = await reviewsForCases(input.ownerId, [caseId]);
  return normalizeCase(data as CaseRow, reviews.get(caseId) ?? []);
}

export async function reviewResearchCaseEvidence(input: {
  ownerId: string;
  caseId: string;
  source: string;
  evidenceId: string;
  pageAnchor: string;
  decision: ResearchCaseReviewDecision;
  note?: string;
}): Promise<SavedResearchCase> {
  const current = await getResearchCase(input.ownerId, input.caseId);
  if (!current) throw new Error("Research Case was not found.");
  if (!current.selectedSources.includes(input.source)) throw new Error("Evidence source is not part of this Research Case.");
  const detail = await getPaperDetail(input.source, false, { id: input.evidenceId });
  const evidence = detail?.evidence.find((item) => item.id === input.evidenceId);
  if (!detail || detail.document.source !== input.source || !evidence) {
    throw new Error("Evidence does not belong to the selected Research Case paper.");
  }
  const verifiedPageAnchor = evidence.readerAnchor
    || (evidence.pageStart != null ? `${input.source}:page:${evidence.pageStart}` : "");
  if (!verifiedPageAnchor || verifiedPageAnchor !== input.pageAnchor) {
    throw new Error("Evidence page anchor does not match the selected paper.");
  }
  const now = new Date().toISOString();
  const values = {
    case_id: current.caseId,
    owner_id: input.ownerId,
    source: text(input.source, 320),
    evidence_id: text(input.evidenceId, 120),
    page_anchor: verifiedPageAnchor,
    decision: input.decision,
    note: text(input.note, 1000),
    updated_at: now,
  };
  if (!values.source || !values.evidence_id || !values.page_anchor) throw new Error("A source, evidence ID, and page anchor are required.");
  const client = getSupabaseAdmin() as any;
  const { error } = await client
    .from("civil_research_case_reviews")
    .upsert(values, { onConflict: "case_id,source,evidence_id" });
  if (error) throw new Error(`Failed to save evidence review: ${error.message}`);
  const next = await getResearchCase(input.ownerId, current.caseId);
  if (!next) throw new Error("Research Case disappeared after review.");
  return next;
}
