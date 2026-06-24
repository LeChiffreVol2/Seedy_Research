import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedIngestRequest } from "../lib/ingest-auth";
import {
  bindResearchGateResponseForPersistence,
  buildEvidenceProvenance,
  buildResearchGateMapCommands,
  buildResearchGateWorkflow,
  normalizedResearchProposalHash,
} from "../lib/spatial-read-model";
import type { ResearchGateResponse, SmartCityInsight } from "../lib/types";

const insight: SmartCityInsight = {
  id: "insight:rail_crossing:drt-crossing-1",
  domain: "transport",
  objectId: "rail_crossing:drt-crossing-csv:drt-crossing-1",
  objectType: "rail_crossing",
  title: "DRT crossing 1",
  whyNow: "Official crossing geometry and real incident context are linked.",
  evidence: [
    {
      id: "live:rail_crossing:drt-crossing-csv:drt-crossing-1",
      kind: "live_data",
      label: "rail crossing",
      value: "DRT crossing 1",
      objectId: "rail_crossing:drt-crossing-csv:drt-crossing-1",
      sourceUrl: "https://data.go.th/",
    },
  ],
  recommendedAction: "Ask CivilMCP for a signal audit evidence gate.",
  nextVerificationStep: "Verify crossing signal state and queue spillback before recording.",
  severity: "high",
  confidence: 0.82,
  riskBefore: 82,
  expectedRiskAfter: 82,
  delta: 0,
  sourceObjectIds: ["rail_crossing:drt-crossing-csv:drt-crossing-1"],
  evidenceIds: ["live:rail_crossing:drt-crossing-csv:drt-crossing-1"],
  caveat: "Expected risk only.",
  requiresResearch: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
};

const response: ResearchGateResponse = {
  generatedAt: "2026-06-11T00:01:00.000Z",
  mode: "mcp_read_only",
  objectIds: insight.sourceObjectIds,
  insightId: insight.id,
  findings: [],
  recommendedActions: [
    {
      id: "proposal:audit_signal:1",
      actionType: "audit_signal",
      title: "Signal audit",
      rationale: "Cited evidence supports a signal audit.",
      confidence: 0.74,
      riskBefore: 82,
      expectedRiskAfter: 74,
      delta: -8,
      evidenceIds: ["mcp:paper-1"],
      caveat: "Expected risk reduction only.",
    },
  ],
  evidenceUse: [
    {
      evidenceId: "mcp:paper-1",
      citation: "Paper.md · Crossing controls",
      source: "Paper.md",
      sectionTitle: "Crossing controls",
      relatedSources: ["drt-crossing-1"],
      relevance: "Queue spillback and crossing warning visibility are relevant.",
      actionUse: "Use for audit signal review.",
      caveat: "Expected only.",
      excerpt: "Warning visibility and queue spillback increase crossing exposure.",
      mechanism: "Signal, warning, barrier, or crossing-control failure mode",
      objectLink: "Applies to selected rail crossing.",
      operatorCheck: "Verify signal state.",
      actionImplication: "Supports a signal audit.",
      evidenceStrength: "direct",
      matchedTerms: ["crossing", "signal"],
      operationalSources: ["drt-crossing-1"],
      researchCitation: "Paper.md · Crossing controls",
    },
  ],
  limitations: ["read-only"],
};

test("ingest refresh rejects missing or wrong secret", () => {
  const previous = process.env.OPS_INGEST_SECRET;
  const previousCron = process.env.CRON_SECRET;
  process.env.OPS_INGEST_SECRET = "unit-secret";
  delete process.env.CRON_SECRET;
  assert.equal(isAuthorizedIngestRequest(new Request("http://localhost/api/ops/ingest/refresh")), false);
  assert.equal(
    isAuthorizedIngestRequest(new Request("http://localhost/api/ops/ingest/refresh", { headers: { authorization: "Bearer wrong" } })),
    false,
  );
  assert.equal(
    isAuthorizedIngestRequest(new Request("http://localhost/api/ops/ingest/refresh", { headers: { authorization: "Bearer unit-secret" } })),
    true,
  );
  delete process.env.OPS_INGEST_SECRET;
  process.env.CRON_SECRET = "cron-secret";
  assert.equal(
    isAuthorizedIngestRequest(new Request("http://localhost/api/ops/ingest/refresh", { headers: { authorization: "Bearer cron-secret" } })),
    true,
  );
  if (previous === undefined) delete process.env.OPS_INGEST_SECRET;
  else process.env.OPS_INGEST_SECRET = previous;
  if (previousCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCron;
});

test("research response produces typed map commands and workflow trace", () => {
  const commands = buildResearchGateMapCommands(response, insight);
  assert.equal(commands[0].type, "toggle_layer");
  assert.equal(commands[0].layerId, "rail");
  assert.equal(commands.some((command) => command.type === "select_object" && command.objectId === insight.objectId), true);

  const trace = buildResearchGateWorkflow(response, insight);
  assert.deepEqual(
    trace.map((step) => step.status),
    ["complete", "complete", "complete", "pending"],
  );
});

test("evidence provenance keeps citation strength bound to object IDs", () => {
  const provenance = buildEvidenceProvenance(response);
  assert.equal(provenance.length, 1);
  assert.equal(provenance[0].evidenceId, "mcp:paper-1");
  assert.equal(provenance[0].strength, "direct");
  assert.deepEqual(provenance[0].objectIds, insight.sourceObjectIds);
});

test("research response binding adds persisted run and server-normalized proposal fields", () => {
  const prepared = bindResearchGateResponseForPersistence(response);
  const proposal = prepared.recommendedActions[0];
  assert.ok(prepared.researchRunId?.startsWith("research:"));
  assert.equal(proposal.researchRunId, prepared.researchRunId);
  assert.equal(proposal.proposalId, "proposal:audit_signal:1");
  assert.deepEqual(proposal.sourceObjectIds, insight.sourceObjectIds);
  assert.equal(proposal.evidenceStrengths?.["mcp:paper-1"], "direct");
  assert.deepEqual(proposal.requiredAcknowledgements, [
    "read_only_civilmcp_evidence",
    "local_action_record_only",
    "expected_delta_not_measured",
  ]);
  assert.equal(proposal.normalizedHash, normalizedResearchProposalHash(proposal));
});

test("research response binding removes context-only evidence from recordable proposals", () => {
  const contextOnly = bindResearchGateResponseForPersistence({
    ...response,
    evidenceUse: response.evidenceUse.map((item) => ({ ...item, evidenceStrength: "context_only" })),
  });
  assert.equal(contextOnly.recommendedActions.length, 0);
});
