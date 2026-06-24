import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadOpsEnv } from "./env";
import type { ResearchGateEvidenceStrength, SmartCityActionRecord, SmartCityActionRecordStatus, SmartCityActionType } from "./types";

export type CreateActionRecordInput = {
  actionType: SmartCityActionType;
  title: string;
  actor: string;
  sourceObjectIds: string[];
  evidenceIds: string[];
  riskBefore: number;
  expectedRiskAfter: number;
  status?: SmartCityActionRecordStatus;
  limitations?: string[];
  researchRunId?: string | null;
  proposalId?: string | null;
  insightId?: string | null;
  evidenceStrengths?: Record<string, ResearchGateEvidenceStrength>;
  evidenceSnapshot?: Array<Record<string, unknown>>;
  permissionState?: "operator_acknowledged" | "requires_ack" | "blocked";
  acknowledgements?: string[];
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  assignedTo?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  closedAt?: string | null;
  outcomeSummary?: string | null;
};

const SYNTHETIC_MARKER = /\b(mock|seed|synthetic|pilot|static|fallback)\b/i;
const DEFAULT_LIMITATIONS = [
  "Controlled action record only.",
  "No webhook, field dispatch, CivilMCP write, civil_* write, or external system action was executed.",
  "Risk-after value is an expected simulation until measured against follow-up observations.",
];

type ActionLogBackend = "file" | "supabase";

type SupabaseActionRecordRow = {
  id: string;
  action_type: SmartCityActionType;
  title: string;
  actor: string;
  source_object_ids: string[];
  evidence_ids: string[];
  risk_before: number | string;
  expected_risk_after: number | string;
  status: SmartCityActionRecordStatus;
  execution_scope: "controlled_action_record";
  limitations: string[];
  created_at: string;
  updated_at: string;
  research_run_id?: string | null;
  proposal_id?: string | null;
  insight_id?: string | null;
  evidence_strengths?: Record<string, ResearchGateEvidenceStrength>;
  evidence_snapshot?: Array<Record<string, unknown>>;
  permission_state?: "operator_acknowledged" | "requires_ack" | "blocked";
  acknowledgements?: string[];
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  assigned_to?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  closed_at?: string | null;
  outcome_summary?: string | null;
};

function actionLogPath(): string {
  return process.env.OPS_ACTION_LOG_PATH || join(process.cwd(), ".local", "smart-city-action-log.json");
}

function actionLogBackend(): ActionLogBackend {
  loadOpsEnv();
  if (process.env.OPS_ACTION_LOG_BACKEND === "file" || process.env.OPS_ACTION_LOG_PATH) return "file";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return "supabase";
  if (process.env.VERCEL) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for ops action records on Vercel.");
  }
  return "file";
}

function containsSyntheticMarker(values: string[]): boolean {
  return values.some((value) => SYNTHETIC_MARKER.test(value));
}

function assertFiniteRisk(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a finite risk score from 0 to 100`);
  }
}

export function validateActionRecordInput(input: CreateActionRecordInput): void {
  if (!input.actor.trim()) throw new Error("actor is required");
  if (!input.title.trim()) throw new Error("title is required");
  if (input.sourceObjectIds.length === 0) throw new Error("sourceObjectIds are required");
  if (input.evidenceIds.length === 0) throw new Error("evidenceIds are required");
  if (containsSyntheticMarker([input.title, input.actor, ...input.sourceObjectIds, ...input.evidenceIds])) {
    throw new Error("Synthetic/mock/seed/static/fallback objects are not executable in real-data-only mode.");
  }
  assertFiniteRisk(input.riskBefore, "riskBefore");
  assertFiniteRisk(input.expectedRiskAfter, "expectedRiskAfter");
}

async function readFileRecords(): Promise<SmartCityActionRecord[]> {
  try {
    const raw = await readFile(actionLogPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isActionRecord);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function isActionRecord(value: unknown): value is SmartCityActionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SmartCityActionRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.actor === "string" &&
    Array.isArray(record.sourceObjectIds) &&
    Array.isArray(record.evidenceIds) &&
    typeof record.createdAt === "string"
  );
}

async function writeFileRecords(records: SmartCityActionRecord[]): Promise<void> {
  const target = actionLogPath();
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(records, null, 2), "utf8");
  await rename(temp, target);
}

function supabaseRestUrl(path: string): string {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("SUPABASE_URL is required");
  return `${baseUrl}/rest/v1/${path.replace(/^\/+/, "")}`;
}

function supabaseHeaders(prefer?: string): HeadersInit {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_KEY is required");
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function toSupabaseRow(record: SmartCityActionRecord): SupabaseActionRecordRow {
  return {
    id: record.id,
    action_type: record.actionType,
    title: record.title,
    actor: record.actor,
    source_object_ids: record.sourceObjectIds,
    evidence_ids: record.evidenceIds,
    risk_before: record.riskBefore,
    expected_risk_after: record.expectedRiskAfter,
    status: record.status,
    execution_scope: record.executionScope,
    limitations: record.limitations,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    research_run_id: record.researchRunId ?? null,
    proposal_id: record.proposalId ?? null,
    insight_id: record.insightId ?? null,
    evidence_strengths: record.evidenceStrengths ?? {},
    evidence_snapshot: record.evidenceSnapshot ?? [],
    permission_state: record.permissionState ?? "operator_acknowledged",
    acknowledgements: record.acknowledgements ?? [],
    acknowledged_by: record.acknowledgedBy ?? null,
    acknowledged_at: record.acknowledgedAt ?? null,
    assigned_to: record.assignedTo ?? null,
    approved_by: record.approvedBy ?? null,
    approved_at: record.approvedAt ?? null,
    closed_at: record.closedAt ?? null,
    outcome_summary: record.outcomeSummary ?? null,
  };
}

function fromSupabaseRow(row: SupabaseActionRecordRow): SmartCityActionRecord {
  return {
    id: row.id,
    actionType: row.action_type,
    title: row.title,
    actor: row.actor,
    sourceObjectIds: Array.isArray(row.source_object_ids) ? row.source_object_ids : [],
    evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids : [],
    riskBefore: Math.round(Number(row.risk_before)),
    expectedRiskAfter: Math.round(Number(row.expected_risk_after)),
    status: row.status,
    executionScope: row.execution_scope,
    limitations: Array.isArray(row.limitations) ? row.limitations : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    researchRunId: row.research_run_id ?? null,
    proposalId: row.proposal_id ?? null,
    insightId: row.insight_id ?? null,
    evidenceStrengths: row.evidence_strengths ?? {},
    evidenceSnapshot: row.evidence_snapshot ?? [],
    permissionState: row.permission_state ?? "operator_acknowledged",
    acknowledgements: row.acknowledgements ?? [],
    acknowledgedBy: row.acknowledged_by ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    assignedTo: row.assigned_to ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    closedAt: row.closed_at ?? null,
    outcomeSummary: row.outcome_summary ?? null,
  };
}

async function insertSupabaseRecord(record: SmartCityActionRecord): Promise<SmartCityActionRecord> {
  const response = await fetch(supabaseRestUrl("smart_city_action_records"), {
    method: "POST",
    headers: supabaseHeaders("return=representation"),
    body: JSON.stringify(toSupabaseRow(record)),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase action record insert failed (${response.status}): ${body.slice(0, 240)}`);
  }
  const rows = (await response.json()) as SupabaseActionRecordRow[];
  return rows[0] ? fromSupabaseRow(rows[0]) : record;
}

async function readSupabaseRecords(filter: { objectId?: string | null } = {}): Promise<SmartCityActionRecord[]> {
  const params = new URLSearchParams({
    select: "*",
    order: "created_at.desc",
    limit: "1000",
  });
  const response = await fetch(supabaseRestUrl(`smart_city_action_records?${params.toString()}`), {
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase action record read failed (${response.status}): ${body.slice(0, 240)}`);
  }
  const rows = (await response.json()) as SupabaseActionRecordRow[];
  const records = rows.map(fromSupabaseRow);
  if (!filter.objectId) return records;
  return records.filter((record) => record.sourceObjectIds.includes(filter.objectId as string));
}

function actionRecordId(input: CreateActionRecordInput, createdAt: string): string {
  const normalized = [input.actionType, input.actor, input.sourceObjectIds.join(","), input.evidenceIds.join(","), createdAt]
    .join("|")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  return `action:${normalized}`;
}

export async function createActionRecord(input: CreateActionRecordInput): Promise<SmartCityActionRecord> {
  validateActionRecordInput(input);
  const now = new Date().toISOString();
  const record: SmartCityActionRecord = {
    id: actionRecordId(input, now),
    actionType: input.actionType,
    title: input.title,
    actor: input.actor,
    sourceObjectIds: [...new Set(input.sourceObjectIds)],
    evidenceIds: [...new Set(input.evidenceIds)],
    riskBefore: Math.round(input.riskBefore),
    expectedRiskAfter: Math.round(input.expectedRiskAfter),
    status: input.status ?? "recorded",
    createdAt: now,
    updatedAt: now,
    executionScope: "controlled_action_record",
    limitations: input.limitations?.length ? input.limitations : DEFAULT_LIMITATIONS,
    researchRunId: input.researchRunId ?? null,
    proposalId: input.proposalId ?? null,
    insightId: input.insightId ?? null,
    evidenceStrengths: input.evidenceStrengths ?? {},
    evidenceSnapshot: input.evidenceSnapshot ?? [],
    permissionState: input.permissionState ?? "operator_acknowledged",
    acknowledgements: input.acknowledgements ?? [],
    acknowledgedBy: input.acknowledgedBy ?? null,
    acknowledgedAt: input.acknowledgedAt ?? null,
    assignedTo: input.assignedTo ?? null,
    approvedBy: input.approvedBy ?? null,
    approvedAt: input.approvedAt ?? null,
    closedAt: input.closedAt ?? null,
    outcomeSummary: input.outcomeSummary ?? null,
  };

  if (actionLogBackend() === "supabase") return insertSupabaseRecord(record);

  const records = await readFileRecords();
  await writeFileRecords([record, ...records].slice(0, 1000));
  return record;
}

export async function listActionRecords(filter: { objectId?: string | null } = {}): Promise<SmartCityActionRecord[]> {
  if (actionLogBackend() === "supabase") return readSupabaseRecords(filter);

  const records = await readFileRecords();
  const sorted = records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (!filter.objectId) return sorted;
  return sorted.filter((record) => record.sourceObjectIds.includes(filter.objectId as string));
}
