import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { envelopeMapCommands, executeMapCommand, type OpsMapCommandState } from "./map-command-executor";
import { loadOpsEnv } from "./env";
import type { OpsActor, OpsCommandEvent, OpsMapCommand, OpsMapCommandEnvelope } from "./types";

type CommandBackend = "file" | "supabase";

type CommandRow = {
  id: string;
  batch_id: string;
  actor: string;
  role: string;
  research_run_id: string | null;
  proposal_id: string | null;
  insight_id: string | null;
  object_ids: string[];
  command_type: string;
  command_payload: OpsMapCommand;
  reason: string;
  permission: OpsMapCommandEnvelope["permission"];
  ack_state: OpsMapCommandEnvelope["ackState"];
  required_acknowledgements: string[];
  status: OpsMapCommandEnvelope["status"];
  idempotency_hash: string;
  error: string | null;
  created_at: string;
  applied_at: string | null;
};

type CommandEventRow = {
  id: string;
  command_id: string;
  actor: string;
  role: string;
  event_type: string;
  from_status: OpsMapCommandEnvelope["status"] | null;
  to_status: OpsMapCommandEnvelope["status"];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type PersistCommandBatchInput = {
  actor: OpsActor;
  commands: OpsMapCommand[];
  researchRunId?: string | null;
  proposalId?: string | null;
  insightId?: string | null;
  objectIds?: string[];
  acknowledgements?: string[];
};

function commandLogPath(): string {
  return process.env.OPS_COMMAND_LOG_PATH || join(process.cwd(), ".local", "smart-city-command-log.json");
}

function commandEventLogPath(): string {
  return process.env.OPS_COMMAND_EVENT_LOG_PATH || join(process.cwd(), ".local", "smart-city-command-events.json");
}

function commandBackend(): CommandBackend {
  loadOpsEnv();
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return "supabase";
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for ops command audit on Vercel.");
  }
  if (process.env.OPS_COMMAND_LOG_BACKEND === "file" || process.env.OPS_COMMAND_LOG_PATH) return "file";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return "supabase";
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function idempotencyHash(input: {
  batchId: string;
  commandId: string;
  actor: string;
  command: OpsMapCommand;
  researchRunId?: string | null;
}): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function postgresArrayContains(value: string): string {
  return `cs.{"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`;
}

function objectIdsFromCommand(command: OpsMapCommand): string[] {
  if (command.type === "select_object" || command.type === "open_evidence_panel") return [command.objectId];
  if (command.type === "run_research_gate") return command.objectIds;
  if (command.type === "apply_spatial_filter") return command.objectIds ?? [];
  return [];
}

function toRow(envelope: OpsMapCommandEnvelope): CommandRow {
  return {
    id: envelope.commandId,
    batch_id: envelope.batchId,
    actor: envelope.actor ?? "unknown",
    role: envelope.role ?? "viewer",
    research_run_id: envelope.researchRunId ?? null,
    proposal_id: envelope.proposalId ?? null,
    insight_id: envelope.insightId ?? null,
    object_ids: envelope.objectIds ?? [],
    command_type: envelope.command.type,
    command_payload: envelope.command,
    reason: envelope.command.reason,
    permission: envelope.permission,
    ack_state: envelope.ackState,
    required_acknowledgements: envelope.requiredAcknowledgements,
    status: envelope.status,
    idempotency_hash: envelope.idempotencyHash ?? "",
    error: envelope.error ?? null,
    created_at: envelope.createdAt,
    applied_at: envelope.appliedAt ?? null,
  };
}

function fromRow(row: CommandRow): OpsMapCommandEnvelope {
  return {
    commandId: row.id,
    batchId: row.batch_id,
    actor: row.actor,
    role: row.role as OpsMapCommandEnvelope["role"],
    researchRunId: row.research_run_id ?? undefined,
    proposalId: row.proposal_id,
    insightId: row.insight_id,
    objectIds: row.object_ids,
    command: row.command_payload,
    permission: row.permission,
    ackState: row.ack_state,
    requiredAcknowledgements: row.required_acknowledgements,
    status: row.status,
    idempotencyHash: row.idempotency_hash,
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? undefined,
    error: row.error ?? undefined,
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

async function persistFile(envelopes: OpsMapCommandEnvelope[]): Promise<void> {
  const rows = await readJsonFile<CommandRow[]>(commandLogPath(), []);
  const next = [...envelopes.map(toRow), ...rows].slice(0, 1000);
  await writeJsonFile(commandLogPath(), next);

  const events = await readJsonFile<CommandEventRow[]>(commandEventLogPath(), []);
  const nextEvents = [
    ...envelopes.map<CommandEventRow>((item) => ({
      id: `event:${item.commandId}:${item.status}`,
      command_id: item.commandId,
      actor: item.actor ?? "unknown",
      role: item.role ?? "viewer",
      event_type: item.status === "applied" ? "applied" : "rejected",
      from_status: "pending",
      to_status: item.status,
      metadata: { reason: item.command.reason, error: item.error ?? null },
      created_at: item.appliedAt ?? item.createdAt,
    })),
    ...events,
  ].slice(0, 2000);
  await writeJsonFile(commandEventLogPath(), nextEvents);
}

async function persistSupabase(envelopes: OpsMapCommandEnvelope[], actor: OpsActor): Promise<void> {
  if (envelopes.length === 0) return;
  const first = envelopes[0];
  const batchResponse = await fetch(supabaseRestUrl("smart_city_command_batches?on_conflict=id"), {
    method: "POST",
    headers: supabaseHeaders("resolution=merge-duplicates"),
    cache: "no-store",
    body: JSON.stringify([
      {
        id: first.batchId,
        actor: actor.username,
        role: actor.role,
        research_run_id: first.researchRunId ?? null,
        proposal_id: first.proposalId ?? null,
        insight_id: first.insightId ?? null,
        object_ids: [...new Set(envelopes.flatMap((item) => item.objectIds ?? []))],
        metadata: { authSource: actor.authSource },
      },
    ]),
  });
  if (!batchResponse.ok) throw new Error(`Command batch persist failed (${batchResponse.status}): ${(await batchResponse.text()).slice(0, 240)}`);

  const commandResponse = await fetch(supabaseRestUrl("smart_city_commands?on_conflict=id"), {
    method: "POST",
    headers: supabaseHeaders("resolution=merge-duplicates"),
    cache: "no-store",
    body: JSON.stringify(envelopes.map(toRow)),
  });
  if (!commandResponse.ok) throw new Error(`Command persist failed (${commandResponse.status}): ${(await commandResponse.text()).slice(0, 240)}`);

  const eventResponse = await fetch(supabaseRestUrl("smart_city_command_events"), {
    method: "POST",
    headers: supabaseHeaders(),
    cache: "no-store",
    body: JSON.stringify(
      envelopes.map((item) => ({
        command_id: item.commandId,
        actor: actor.username,
        role: actor.role,
        event_type: item.status === "applied" ? "applied" : "rejected",
        from_status: "pending",
        to_status: item.status,
        metadata: { reason: item.command.reason, error: item.error ?? null },
        created_at: item.appliedAt ?? item.createdAt,
      })),
    ),
  });
  if (!eventResponse.ok) throw new Error(`Command event persist failed (${eventResponse.status}): ${(await eventResponse.text()).slice(0, 240)}`);
}

export async function executeAndPersistMapCommands(input: PersistCommandBatchInput): Promise<OpsMapCommandEnvelope[]> {
  const batchId = `cmd-batch:${new Date().toISOString()}:${input.actor.username}`.replace(/[^a-zA-Z0-9:_-]+/g, "-");
  const base = envelopeMapCommands(input.commands, { researchRunId: input.researchRunId ?? undefined, batchId });
  let state: OpsMapCommandState = { layers: {}, styleOverrides: {} };
  const envelopes = base.map((item) => {
    const objectIds = [...new Set([...(input.objectIds ?? []), ...objectIdsFromCommand(item.command)])];
    const result = executeMapCommand(state, item, input.acknowledgements ?? []);
    state = result.state;
    const envelope: OpsMapCommandEnvelope = {
      ...result.envelope,
      actor: input.actor.username,
      role: input.actor.role,
      proposalId: input.proposalId ?? null,
      insightId: input.insightId ?? null,
      objectIds,
    };
    return {
      ...envelope,
      idempotencyHash: idempotencyHash({
        batchId: envelope.batchId,
        commandId: envelope.commandId,
        actor: input.actor.username,
        command: envelope.command,
        researchRunId: envelope.researchRunId,
      }),
    };
  });

  if (commandBackend() === "supabase") await persistSupabase(envelopes, input.actor);
  else await persistFile(envelopes);
  return envelopes;
}

export async function listCommandLog(filter: { objectId?: string | null; limit?: number } = {}): Promise<OpsMapCommandEnvelope[]> {
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  if (commandBackend() === "supabase") {
    const params = new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(limit) });
    if (filter.objectId) params.set("object_ids", postgresArrayContains(filter.objectId));
    const response = await fetch(supabaseRestUrl(`smart_city_commands?${params.toString()}`), {
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Command log read failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    return ((await response.json()) as CommandRow[]).map(fromRow);
  }
  const rows = (await readJsonFile<CommandRow[]>(commandLogPath(), [])).map(fromRow);
  const filtered = filter.objectId ? rows.filter((row) => row.objectIds?.includes(filter.objectId as string)) : rows;
  return filtered.slice(0, limit);
}

export async function getCommandDetail(commandId: string): Promise<{ command: OpsMapCommandEnvelope | null; events: OpsCommandEvent[] }> {
  if (commandBackend() === "supabase") {
    const [commandResponse, eventResponse] = await Promise.all([
      fetch(supabaseRestUrl(`smart_city_commands?${new URLSearchParams({ select: "*", id: `eq.${commandId}`, limit: "1" }).toString()}`), {
        headers: supabaseHeaders(),
        cache: "no-store",
      }),
      fetch(supabaseRestUrl(`smart_city_command_events?${new URLSearchParams({ select: "*", command_id: `eq.${commandId}`, order: "created_at.desc", limit: "100" }).toString()}`), {
        headers: supabaseHeaders(),
        cache: "no-store",
      }),
    ]);
    if (!commandResponse.ok) throw new Error(`Command read failed (${commandResponse.status})`);
    if (!eventResponse.ok) throw new Error(`Command event read failed (${eventResponse.status})`);
    const command = ((await commandResponse.json()) as CommandRow[]).map(fromRow)[0] ?? null;
    const events = ((await eventResponse.json()) as CommandEventRow[]).map((row) => ({
      id: row.id,
      commandId: row.command_id,
      actor: row.actor,
      role: row.role as OpsCommandEvent["role"],
      eventType: row.event_type,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    }));
    return { command, events };
  }
  const command = (await readJsonFile<CommandRow[]>(commandLogPath(), [])).map(fromRow).find((item) => item.commandId === commandId) ?? null;
  const events = (await readJsonFile<CommandEventRow[]>(commandEventLogPath(), [])).map((row) => ({
    id: row.id,
    commandId: row.command_id,
    actor: row.actor,
    role: row.role as OpsCommandEvent["role"],
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }));
  return { command, events: events.filter((item) => item.commandId === commandId) };
}
