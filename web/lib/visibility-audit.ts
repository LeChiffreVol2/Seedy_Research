import "server-only";

import { createClient } from "@supabase/supabase-js";

export type GlobalVisibilityState =
  | "globally_indexed"
  | "under_indexed"
  | "candidate_match"
  | "not_found_in_audit"
  | "not_audited"
  | "audit_unavailable";

export type VisibilityMatchBasis =
  | "exact_doi"
  | "exact_title_year"
  | "title_author_year"
  | "fuzzy_title"
  | "reviewed_identity"
  | "none"
  | "provider_unavailable";

export type VisibilityReceipt = {
  source: string;
  provider: string | null;
  externalIndex: "openalex";
  state: GlobalVisibilityState;
  matchBasis: VisibilityMatchBasis;
  externalWorkId: string | null;
  externalUrl: string | null;
  confidence: number | null;
  requiresHumanReview: boolean;
  metadataGaps: string[];
  checkedAt: string | null;
  snapshotDate: string | null;
  methodVersion: string | null;
};

export type VisibilitySummary = {
  auditRunId: string | null;
  provider: string;
  externalIndex: "openalex";
  snapshotDate: string | null;
  runStatus: "not_started" | "running" | "partial" | "complete" | "failed";
  strategy: "identifiers" | "full" | null;
  denominator: number;
  attempted: number;
  audited: number;
  globallyIndexed: number;
  underIndexed: number;
  candidateReview: number;
  notFoundInAudit: number;
  unavailable: number;
  methodVersion: string | null;
  complete: boolean;
};

type ReceiptRow = {
  source?: unknown;
  provider?: unknown;
  external_index?: unknown;
  visibility_state?: unknown;
  match_basis?: unknown;
  external_work_id?: unknown;
  external_url?: unknown;
  confidence?: unknown;
  requires_human_review?: unknown;
  metadata_gaps?: unknown;
  checked_at?: unknown;
  audit_snapshot_date?: unknown;
  method_version?: unknown;
};

type SummaryRow = {
  audit_run_id?: unknown;
  provider?: unknown;
  external_index?: unknown;
  audit_snapshot_date?: unknown;
  run_status?: unknown;
  strategy?: unknown;
  denominator?: unknown;
  attempted_count?: unknown;
  globally_indexed_count?: unknown;
  under_indexed_count?: unknown;
  candidate_count?: unknown;
  not_found_count?: unknown;
  unavailable_count?: unknown;
  method_version?: unknown;
};

const VISIBILITY_STATES = new Set<GlobalVisibilityState>([
  "globally_indexed", "under_indexed", "candidate_match", "not_found_in_audit", "not_audited", "audit_unavailable",
]);
const MATCH_BASES = new Set<VisibilityMatchBasis>([
  "exact_doi", "exact_title_year", "title_author_year", "fuzzy_title", "reviewed_identity", "none", "provider_unavailable",
]);

let supabaseAdminSingleton: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !serviceKey) throw new Error("Supabase server credentials are required for visibility audit reads.");
  supabaseAdminSingleton = createClient(url, serviceKey, { auth: { persistSession: false } });
  return supabaseAdminSingleton;
}

function stringValue(value: unknown, max = 320): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, max);
  return normalized || null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function missingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = (error?.code ?? "").toUpperCase();
  const message = (error?.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42883" || message.includes("function missing") || message.includes("does not exist");
}

function emptyReceipt(source: string, state: "not_audited" | "audit_unavailable" = "not_audited"): VisibilityReceipt {
  return {
    source,
    provider: null,
    externalIndex: "openalex",
    state,
    matchBasis: state === "audit_unavailable" ? "provider_unavailable" : "none",
    externalWorkId: null,
    externalUrl: null,
    confidence: null,
    requiresHumanReview: false,
    metadataGaps: [],
    checkedAt: null,
    snapshotDate: null,
    methodVersion: null,
  };
}

function receiptFromRow(normalizedSource: string, row: ReceiptRow): VisibilityReceipt {
  const rawState = stringValue(row.visibility_state, 40) as GlobalVisibilityState | null;
  const rawBasis = stringValue(row.match_basis, 40) as VisibilityMatchBasis | null;
  const state = rawState && VISIBILITY_STATES.has(rawState) ? rawState : "audit_unavailable";
  const matchBasis = rawBasis && MATCH_BASES.has(rawBasis) ? rawBasis : state === "audit_unavailable" ? "provider_unavailable" : "none";
  return {
    source: stringValue(row.source, 512) ?? normalizedSource,
    provider: stringValue(row.provider, 80),
    externalIndex: "openalex",
    state,
    matchBasis,
    externalWorkId: stringValue(row.external_work_id),
    externalUrl: stringValue(row.external_url, 700),
    confidence: row.confidence == null ? null : numberValue(row.confidence),
    requiresHumanReview: row.requires_human_review === true,
    metadataGaps: Array.isArray(row.metadata_gaps) ? row.metadata_gaps.map((item) => stringValue(item, 80)).filter((item): item is string => Boolean(item)).slice(0, 12) : [],
    checkedAt: stringValue(row.checked_at, 80),
    snapshotDate: stringValue(row.audit_snapshot_date, 40),
    methodVersion: stringValue(row.method_version, 100),
  };
}

export async function getVisibilityReceipt(source: string): Promise<VisibilityReceipt> {
  const normalizedSource = source.replace(/[\u0000-\u001F]/g, "").trim().slice(0, 512);
  if (!normalizedSource) return emptyReceipt("");
  const { data, error } = await (getSupabaseAdmin() as any).rpc("civil_visibility_receipt_v1", {
    source_identifier: normalizedSource,
    index_name: "openalex",
  });
  if (error) return emptyReceipt(normalizedSource, missingRpc(error) ? "not_audited" : "audit_unavailable");
  const row = (Array.isArray(data) ? data[0] : null) as ReceiptRow | null;
  if (!row) return emptyReceipt(normalizedSource);
  return receiptFromRow(normalizedSource, row);
}

export async function getVisibilityReceipts(sources: string[]): Promise<Record<string, VisibilityReceipt>> {
  const normalizedSources = [...new Set(sources
    .map((source) => source.replace(/[\u0000-\u001F]/g, "").trim().slice(0, 512))
    .filter(Boolean))].slice(0, 30);
  const defaults = Object.fromEntries(normalizedSources.map((source) => [source, emptyReceipt(source)]));
  if (!normalizedSources.length) return defaults;
  const { data, error } = await (getSupabaseAdmin() as any).rpc("civil_visibility_receipts_v1", {
    source_identifiers: normalizedSources,
    index_name: "openalex",
  });
  if (error) {
    const state = missingRpc(error) ? "not_audited" : "audit_unavailable";
    return Object.fromEntries(normalizedSources.map((source) => [source, emptyReceipt(source, state)]));
  }
  const receipts = { ...defaults };
  for (const rawRow of Array.isArray(data) ? data : []) {
    const row = rawRow as ReceiptRow;
    const source = stringValue(row.source, 512);
    if (source && source in receipts) receipts[source] = receiptFromRow(source, row);
  }
  return receipts;
}

export async function getVisibilitySummary(provider = "tci_thaijo"): Promise<VisibilitySummary> {
  const normalizedProvider = /^[a-z0-9_:-]{1,64}$/.test(provider) ? provider : "tci_thaijo";
  const { data, error } = await (getSupabaseAdmin() as any).rpc("civil_visibility_summary_v1", {
    provider_name: normalizedProvider,
    index_name: "openalex",
  });
  const empty: VisibilitySummary = {
    auditRunId: null,
    provider: normalizedProvider,
    externalIndex: "openalex",
    snapshotDate: null,
    runStatus: error && !missingRpc(error) ? "failed" : "not_started",
    strategy: null,
    denominator: 0,
    attempted: 0,
    audited: 0,
    globallyIndexed: 0,
    underIndexed: 0,
    candidateReview: 0,
    notFoundInAudit: 0,
    unavailable: 0,
    methodVersion: null,
    complete: false,
  };
  if (error) return empty;
  const row = (Array.isArray(data) ? data[0] : null) as SummaryRow | null;
  if (!row) return empty;
  const attempted = numberValue(row.attempted_count);
  const unavailable = numberValue(row.unavailable_count);
  const denominator = numberValue(row.denominator);
  const runStatus = stringValue(row.run_status, 20);
  const strategy = stringValue(row.strategy, 20);
  return {
    auditRunId: stringValue(row.audit_run_id, 80),
    provider: stringValue(row.provider, 80) ?? normalizedProvider,
    externalIndex: "openalex",
    snapshotDate: stringValue(row.audit_snapshot_date, 40),
    runStatus: runStatus === "running" || runStatus === "partial" || runStatus === "complete" || runStatus === "failed" ? runStatus : "not_started",
    strategy: strategy === "identifiers" || strategy === "full" ? strategy : null,
    denominator,
    attempted,
    audited: Math.max(0, attempted - unavailable),
    globallyIndexed: numberValue(row.globally_indexed_count),
    underIndexed: numberValue(row.under_indexed_count),
    candidateReview: numberValue(row.candidate_count),
    notFoundInAudit: numberValue(row.not_found_count),
    unavailable,
    methodVersion: stringValue(row.method_version, 100),
    complete: runStatus === "complete" && attempted === denominator && unavailable === 0,
  };
}
