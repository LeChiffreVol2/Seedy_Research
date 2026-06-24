import type { OpsLayerKey, OpsMapCommand, OpsMapCommandEnvelope } from "./types";

export type OpsMapCommandState = {
  center?: [number, number];
  zoom?: number;
  layers: Partial<Record<OpsLayerKey, boolean>>;
  selectedObjectId?: string;
  evidencePanel?: { objectId: string; evidenceIds: string[] };
  spatialFilter?: { bbox?: [number, number, number, number]; objectIds?: string[] };
  styleOverrides: Partial<Record<OpsLayerKey, Record<string, string | number | boolean>>>;
  queuedResearchGate?: { objectIds: string[]; insightId?: string };
};

const ACK_REQUIRED_COMMANDS = new Set<OpsMapCommand["type"]>(["run_research_gate"]);
const OPS_LAYER_KEYS = new Set<OpsLayerKey>([
  "incidents",
  "hotspots",
  "cameras",
  "congestion",
  "weather",
  "roadworks",
  "osiris",
  "rail",
  "assets",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isBboxArray(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isPointArray(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isLayerKey(value: unknown): value is OpsLayerKey {
  return typeof value === "string" && OPS_LAYER_KEYS.has(value as OpsLayerKey);
}

export function validateOpsMapCommand(value: unknown): { valid: true; command: OpsMapCommand } | { valid: false; error: string } {
  if (!isRecord(value)) return { valid: false, error: "Command must be an object." };
  if (typeof value.reason !== "string" || value.reason.trim().length === 0) return { valid: false, error: "Command reason is required." };

  if (value.type === "set_view") {
    if (!isPointArray(value.center)) return { valid: false, error: "set_view.center must be [lng, lat]." };
    if (typeof value.zoom !== "number" || !Number.isFinite(value.zoom)) return { valid: false, error: "set_view.zoom must be a finite number." };
    return { valid: true, command: value as OpsMapCommand };
  }
  if (value.type === "toggle_layer") {
    if (!isLayerKey(value.layerId)) return { valid: false, error: "toggle_layer.layerId is invalid." };
    if (typeof value.enabled !== "boolean") return { valid: false, error: "toggle_layer.enabled must be boolean." };
    return { valid: true, command: value as OpsMapCommand };
  }
  if (value.type === "style_layer") {
    if (!isLayerKey(value.layerId)) return { valid: false, error: "style_layer.layerId is invalid." };
    if (!isRecord(value.style)) return { valid: false, error: "style_layer.style must be an object." };
    const validStyle = Object.values(value.style).every(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
    if (!validStyle) return { valid: false, error: "style_layer.style contains unsupported values." };
    return { valid: true, command: value as OpsMapCommand };
  }
  if (value.type === "apply_spatial_filter") {
    if (value.bbox !== undefined && !isBboxArray(value.bbox)) return { valid: false, error: "apply_spatial_filter.bbox is invalid." };
    if (value.objectIds !== undefined && !isStringArray(value.objectIds)) {
      return { valid: false, error: "apply_spatial_filter.objectIds must be string IDs." };
    }
    return { valid: true, command: value as OpsMapCommand };
  }
  if (value.type === "select_object") {
    if (typeof value.objectId !== "string" || value.objectId.trim().length === 0) return { valid: false, error: "select_object.objectId is required." };
    return { valid: true, command: value as OpsMapCommand };
  }
  if (value.type === "open_evidence_panel") {
    if (typeof value.objectId !== "string" || value.objectId.trim().length === 0) {
      return { valid: false, error: "open_evidence_panel.objectId is required." };
    }
    if (!isStringArray(value.evidenceIds)) return { valid: false, error: "open_evidence_panel.evidenceIds must be string IDs." };
    return { valid: true, command: value as OpsMapCommand };
  }
  if (value.type === "run_research_gate") {
    if (!isStringArray(value.objectIds)) return { valid: false, error: "run_research_gate.objectIds must be string IDs." };
    if (value.insightId !== undefined && typeof value.insightId !== "string") return { valid: false, error: "run_research_gate.insightId must be a string." };
    return { valid: true, command: value as OpsMapCommand };
  }
  return { valid: false, error: `Unsupported map command type: ${String(value.type ?? "missing")}.` };
}

function commandKey(command: OpsMapCommand): string {
  if (command.type === "toggle_layer") return `${command.type}:${command.layerId}:${command.enabled}`;
  if (command.type === "select_object") return `${command.type}:${command.objectId}`;
  if (command.type === "open_evidence_panel") return `${command.type}:${command.objectId}:${command.evidenceIds.join(",")}`;
  if (command.type === "run_research_gate") return `${command.type}:${command.objectIds.join(",")}:${command.insightId ?? ""}`;
  if (command.type === "set_view") return `${command.type}:${command.center.join(",")}:${command.zoom}`;
  if (command.type === "style_layer") return `${command.type}:${command.layerId}`;
  return `${command.type}:${command.bbox?.join(",") ?? ""}:${command.objectIds?.join(",") ?? ""}`;
}

function validBbox(value: [number, number, number, number] | undefined): boolean {
  if (!value) return true;
  const [west, south, east, north] = value;
  return (
    Number.isFinite(west) &&
    Number.isFinite(south) &&
    Number.isFinite(east) &&
    Number.isFinite(north) &&
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west <= east &&
    south <= north
  );
}

export function envelopeMapCommands(
  commands: OpsMapCommand[] | undefined,
  options: { researchRunId?: string; batchId?: string; now?: string } = {},
): OpsMapCommandEnvelope[] {
  const now = options.now ?? new Date().toISOString();
  const batchId = options.batchId ?? `cmd-batch:${now}`;
  return (commands ?? []).map((command, index) => {
    const validation = validateOpsMapCommand(command);
    if (!validation.valid) {
      throw new Error(`Invalid map command at index ${index}: ${validation.error}`);
    }
    const requiresAck = ACK_REQUIRED_COMMANDS.has(command.type);
    return {
      commandId: `cmd:${index}:${commandKey(command)}`.replace(/[^a-zA-Z0-9:_-]+/g, "-"),
      batchId,
      researchRunId: options.researchRunId,
      command,
      permission: requiresAck ? "requires_ack" : "auto",
      ackState: requiresAck ? "pending" : "not_required",
      requiredAcknowledgements: requiresAck ? ["operator_approved_research_call"] : [],
      status: "pending",
      createdAt: now,
    };
  });
}

export function executeMapCommand(
  state: OpsMapCommandState,
  envelope: OpsMapCommandEnvelope,
  acknowledgements: string[] = [],
): { state: OpsMapCommandState; envelope: OpsMapCommandEnvelope } {
  if (envelope.permission === "blocked") {
    return { state, envelope: { ...envelope, status: "rejected", error: envelope.error ?? "Command is blocked." } };
  }
  const missingAck = envelope.requiredAcknowledgements.filter((item) => !acknowledgements.includes(item));
  if (missingAck.length > 0) {
    return {
      state,
      envelope: { ...envelope, status: "rejected", error: `Missing acknowledgement: ${missingAck.join(", ")}` },
    };
  }

  const command = envelope.command;
  const appliedAt = new Date().toISOString();
  if (command.type === "set_view") {
    const [lng, lat] = command.center;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return { state, envelope: { ...envelope, status: "failed", error: "Invalid map center." } };
    }
    return {
      state: { ...state, center: command.center, zoom: Math.max(0, Math.min(24, command.zoom)) },
      envelope: { ...envelope, status: "applied", ackState: "acknowledged", appliedAt },
    };
  }
  if (command.type === "toggle_layer") {
    return {
      state: { ...state, layers: { ...state.layers, [command.layerId]: command.enabled } },
      envelope: { ...envelope, status: "applied", ackState: "acknowledged", appliedAt },
    };
  }
  if (command.type === "style_layer") {
    return {
      state: { ...state, styleOverrides: { ...state.styleOverrides, [command.layerId]: command.style } },
      envelope: { ...envelope, status: "applied", ackState: "acknowledged", appliedAt },
    };
  }
  if (command.type === "apply_spatial_filter") {
    if (!validBbox(command.bbox)) {
      return { state, envelope: { ...envelope, status: "failed", error: "Invalid spatial filter bbox." } };
    }
    return {
      state: { ...state, spatialFilter: { bbox: command.bbox, objectIds: command.objectIds } },
      envelope: { ...envelope, status: "applied", ackState: "acknowledged", appliedAt },
    };
  }
  if (command.type === "select_object") {
    return {
      state: { ...state, selectedObjectId: command.objectId },
      envelope: { ...envelope, status: "applied", ackState: "acknowledged", appliedAt },
    };
  }
  if (command.type === "open_evidence_panel") {
    return {
      state: { ...state, evidencePanel: { objectId: command.objectId, evidenceIds: command.evidenceIds } },
      envelope: { ...envelope, status: "applied", ackState: "acknowledged", appliedAt },
    };
  }
  if (command.type !== "run_research_gate") {
    return { state, envelope: { ...envelope, status: "failed", error: "Unsupported map command type." } };
  }
  return {
    state: { ...state, queuedResearchGate: { objectIds: command.objectIds, insightId: command.insightId } },
    envelope: { ...envelope, status: "applied", ackState: "acknowledged", appliedAt },
  };
}
