import { createActionRecord } from "./action-log";
import { getPersistedResearchProposal, readActionSourceObjects } from "./spatial-read-model";
import type { OpsActor, SmartCityActionRecord } from "./types";

export class ActionRecordGateError extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ActionRecordGateError";
    this.details = details;
  }
}

const SYNTHETIC_MARKER = /\b(mock|seed|synthetic|pilot|static|fallback)\b/i;

function hasSyntheticMarker(values: string[]): boolean {
  return values.some((value) => SYNTHETIC_MARKER.test(value));
}

export async function recordPersistedResearchAction(input: {
  actor: OpsActor;
  researchRunId: string;
  proposalId: string;
  acknowledgements?: string[];
}): Promise<SmartCityActionRecord> {
  const researchRunId = input.researchRunId.trim();
  const proposalId = input.proposalId.trim();
  const acknowledgements = [...new Set(input.acknowledgements ?? [])];

  if (!researchRunId || !proposalId) {
    throw new ActionRecordGateError("researchRunId and proposalId are required");
  }
  if (hasSyntheticMarker([input.actor.username, researchRunId, proposalId, ...acknowledgements])) {
    throw new ActionRecordGateError("Synthetic/mock/seed/static/fallback payloads are not allowed in action records.");
  }

  const persisted = await getPersistedResearchProposal({ researchRunId, proposalId });
  if (!persisted) {
    throw new ActionRecordGateError("A persisted Research Gate proposal is required before recording an action.");
  }
  if (persisted.run.mode !== "mcp_read_only") {
    throw new ActionRecordGateError("Action records require a persisted mcp_read_only Research Gate run.");
  }

  const evidenceIds = [...new Set(persisted.proposal.evidence_ids)];
  if (evidenceIds.length === 0 || !evidenceIds.every((id) => id.startsWith("mcp:"))) {
    throw new ActionRecordGateError("Action record requires cited mcp:* evidence from the persisted Research Gate run.");
  }
  const evidenceById = new Map(persisted.evidence.map((item) => [item.evidence_id, item]));
  const unsupportedEvidence = evidenceIds.filter((id) => evidenceById.get(id)?.evidence_strength === "context_only" || !evidenceById.has(id));
  if (unsupportedEvidence.length > 0) {
    throw new ActionRecordGateError("All action evidence must be direct or indirect evidence persisted on the same Research Gate run.", {
      unsupportedEvidence,
    });
  }

  const requiredAcknowledgements = persisted.proposal.required_acknowledgements ?? [];
  const missingAcknowledgements = requiredAcknowledgements.filter((item) => !acknowledgements.includes(item));
  if (missingAcknowledgements.length > 0) {
    throw new ActionRecordGateError("Required action acknowledgements are missing.", { missingAcknowledgements });
  }

  const sourceObjectIds = [...new Set(persisted.proposal.source_object_ids)];
  if (sourceObjectIds.length === 0) {
    throw new ActionRecordGateError("Persisted proposal has no source objects.");
  }
  if (hasSyntheticMarker([persisted.proposal.title, ...sourceObjectIds, ...evidenceIds])) {
    throw new ActionRecordGateError("Synthetic/mock/seed/static/fallback objects are not executable in real-data-only mode.");
  }
  const objects = await readActionSourceObjects(sourceObjectIds);
  const objectIds = new Set(objects.map((object) => object.id));
  const missingObjects = sourceObjectIds.filter((id) => !objectIds.has(id));
  if (missingObjects.length > 0) {
    throw new ActionRecordGateError("All sourceObjectIds must exist in the current real-data ontology read model.", { missingObjects });
  }
  const staleObjects = objects.filter((object) => object.is_stale);
  if (staleObjects.length > 0) {
    throw new ActionRecordGateError("Action records cannot be created from stale source objects.", { staleObjects });
  }

  return createActionRecord({
    actionType: persisted.proposal.action_type,
    title: persisted.proposal.title,
    actor: input.actor.username,
    sourceObjectIds,
    evidenceIds,
    riskBefore: Number(persisted.proposal.risk_before),
    expectedRiskAfter: Number(persisted.proposal.expected_risk_after),
    researchRunId,
    proposalId,
    insightId: persisted.proposal.insight_id,
    evidenceStrengths: persisted.proposal.evidence_strengths,
    evidenceSnapshot: persisted.evidence.map((item) => ({
      evidenceId: item.evidence_id,
      citation: item.citation,
      source: item.source,
      sectionTitle: item.section_title,
      strength: item.evidence_strength,
      actionImplication: item.action_implication,
      operatorCheck: item.operator_check,
    })),
    permissionState: "operator_acknowledged",
    acknowledgements,
    acknowledgedBy: input.actor.username,
    acknowledgedAt: new Date().toISOString(),
  });
}
