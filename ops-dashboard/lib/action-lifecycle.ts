import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadOpsEnv } from "./env";
import type { OpsActor, SmartCityActionEvent, SmartCityActionRecord, SmartCityActionRecordStatus } from "./types";

type ActionBackend = "file" | "supabase";

type ActionEventRow = {
  id: string;
  action_record_id: string;
  from_status: SmartCityActionRecordStatus | null;
  to_status: SmartCityActionRecordStatus;
  actor: string;
  role: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const TRANSITIONS: Record<SmartCityActionRecordStatus, SmartCityActionRecordStatus[]> = {
  proposed: ["acknowledged", "rejected", "cancelled"],
  acknowledged: ["recorded", "rejected", "cancelled"],
  recorded: ["pending_approval", "approved", "cancelled", "expired", "superseded"],
  pending_approval: ["approved", "rejected", "cancelled", "expired"],
  approved: ["assigned", "in_progress", "closed", "superseded"],
  assigned: ["in_progress", "cancelled", "superseded"],
  in_progress: ["verified", "failed", "cancelled", "superseded"],
  verified: ["closed", "failed", "superseded"],
  closed: [],
  rejected: [],
  cancelled: [],
  expired: [],
  superseded: [],
  failed: [],
};

function actionLogPath(): string {
  return process.env.OPS_ACTION_LOG_PATH || join(process.cwd(), ".local", "smart-city-action-log.json");
}

function actionEventPath(): string {
  return process.env.OPS_ACTION_EVENT_LOG_PATH || join(process.cwd(), ".local", "smart-city-action-events.json");
}

function actionBackend(): ActionBackend {
  loadOpsEnv();
  if (process.env.OPS_ACTION_LOG_BACKEND === "file" || process.env.OPS_ACTION_LOG_PATH) return "file";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return "supabase";
  if (process.env.VERCEL) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for ops action lifecycle on Vercel.");
  }
  return "file";
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

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(payload, null, 2), "utf8");
  await rename(temp, path);
}

function assertTransition(from: SmartCityActionRecordStatus, to: SmartCityActionRecordStatus) {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid action transition from ${from} to ${to}.`);
  }
}

function toEvent(row: ActionEventRow): SmartCityActionEvent {
  return {
    id: row.id,
    actionRecordId: row.action_record_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actor: row.actor,
    role: row.role as SmartCityActionEvent["role"],
    reason: row.reason,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

async function rpcTransitionActionRecord(input: {
  actionId: string;
  actor: OpsActor;
  toStatus: SmartCityActionRecordStatus;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<SmartCityActionEvent> {
  const response = await fetch(supabaseRestUrl("rpc/smart_city_transition_action_record"), {
    method: "POST",
    headers: supabaseHeaders(),
    cache: "no-store",
    body: JSON.stringify({
      p_action_id: input.actionId,
      p_to_status: input.toStatus,
      p_actor: input.actor.username,
      p_role: input.actor.role,
      p_reason: input.reason ?? null,
      p_metadata: input.metadata ?? {},
    }),
  });
  if (!response.ok) {
    throw new Error(`Action transition failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  return toEvent(((await response.json()) as ActionEventRow[])[0]);
}

export async function transitionActionRecord(input: {
  actionId: string;
  actor: OpsActor;
  toStatus: SmartCityActionRecordStatus;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<SmartCityActionEvent> {
  if (actionBackend() === "supabase") {
    return rpcTransitionActionRecord(input);
  }
  const now = new Date().toISOString();

  const records = await readJsonFile<SmartCityActionRecord[]>(actionLogPath(), []);
  const index = records.findIndex((record) => record.id === input.actionId);
  if (index === -1) throw new Error("Action record not found.");
  const fromStatus = records[index].status;
  assertTransition(fromStatus, input.toStatus);
  records[index] = {
    ...records[index],
    status: input.toStatus,
    updatedAt: now,
    approvedBy: input.toStatus === "approved" ? input.actor.username : records[index].approvedBy,
    approvedAt: input.toStatus === "approved" ? now : records[index].approvedAt,
    closedAt: input.toStatus === "closed" ? now : records[index].closedAt,
    outcomeSummary: input.toStatus === "closed" ? input.reason ?? null : records[index].outcomeSummary,
  };
  await writeJsonFile(actionLogPath(), records);

  const event: SmartCityActionEvent = {
    id: `action-event:${input.actionId}:${now}`.replace(/[^a-zA-Z0-9:_-]+/g, "-"),
    actionRecordId: input.actionId,
    fromStatus,
    toStatus: input.toStatus,
    actor: input.actor.username,
    role: input.actor.role,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
    createdAt: now,
  };
  const events = await readJsonFile<SmartCityActionEvent[]>(actionEventPath(), []);
  await writeJsonFile(actionEventPath(), [event, ...events].slice(0, 2000));
  return event;
}

export async function listActionEvents(actionId: string): Promise<SmartCityActionEvent[]> {
  if (actionBackend() === "supabase") {
    const response = await fetch(
      supabaseRestUrl(`smart_city_action_events?${new URLSearchParams({ select: "*", action_record_id: `eq.${actionId}`, order: "created_at.desc", limit: "100" }).toString()}`),
      { headers: supabaseHeaders(), cache: "no-store" },
    );
    if (!response.ok) throw new Error(`Action event read failed (${response.status})`);
    return ((await response.json()) as ActionEventRow[]).map(toEvent);
  }
  return (await readJsonFile<SmartCityActionEvent[]>(actionEventPath(), [])).filter((event) => event.actionRecordId === actionId);
}
