import assert from "node:assert/strict";
import test from "node:test";

import { actionableEvidenceIds, buildEvidenceUseRows, evidenceUseSummary } from "../lib/research-gate-evidence";
import type { McpEvidence, SmartCityInsight } from "../lib/types";

const insight: SmartCityInsight = {
  id: "insight-real-1",
  domain: "transport",
  objectId: "rail-crossing-1",
  objectType: "rail_crossing",
  title: "Asok-Din Daeng level crossing",
  whyNow: "SRT incident and official crossing baseline are linked to the selected object.",
  evidence: [],
  recommendedAction: "Audit crossing signal and queue spillback exposure.",
  nextVerificationStep: "Check the live source and official crossing record before recording an action.",
  severity: "high",
  confidence: 0.82,
  riskBefore: 84,
  expectedRiskAfter: 84,
  delta: 0,
  sourceObjectIds: ["rail-crossing-1"],
  evidenceIds: ["drt-crossing-1"],
  caveat: "Expected risk only.",
  requiresResearch: true,
  generatedAt: "2026-05-30T00:00:00.000Z",
};

function evidence(overrides: Partial<McpEvidence> = {}): McpEvidence {
  return {
    id: "evidence-1",
    source: "NCCE26_TRL-10.md",
    sectionTitle: "Level crossing queue risk",
    pageStart: 4,
    pageEnd: 4,
    similarity: 0.81,
    content:
      "Level crossing safety studies identify queue spillback and warning signal visibility as mechanisms that increase collision exposure when road traffic blocks the crossing approach.",
    citation: "NCCE26_TRL-10.md · Level crossing queue risk p.4",
    ...overrides,
  };
}

test("buildEvidenceUseRows explains actionable citation content without generic template copy", () => {
  const [row] = buildEvidenceUseRows({
    citations: [evidence()],
    insight,
    actionType: "audit_signal",
    objectNames: ["ถ.เข้าชุมชนวัดสังฆราชา"],
  });

  assert.equal(row.evidenceStrength, "direct");
  assert.equal(row.mechanism, "Signal, warning, barrier, or crossing-control failure mode");
  assert.match(row.excerpt, /queue spillback|warning signal visibility/i);
  assert.match(row.objectLink, /Asok-Din Daeng level crossing/);
  assert.match(row.operatorCheck, /warning visibility|signal timing/i);
  assert.match(row.actionImplication, /signal or crossing audit/i);
  assert.equal(row.operationalSources[0], "ถ.เข้าชุมชนวัดสังฆราชา");
  assert.ok(row.matchedTerms.includes("crossing"));
  assert.equal(row.relevance.includes(["Connects", "the", "selected", "object"].join(" ")), false);
  assert.equal(row.actionUse.includes(["How", "it", "becomes", "action"].join(" ")), false);
});

test("context-only citation cannot support an actionable evidence ID", () => {
  const rows = buildEvidenceUseRows({
    citations: [
      evidence({
        id: "background-only",
        sectionTitle: "Procurement appendix",
        content: "This appendix describes contract packaging and administrative document control for a project archive.",
        citation: "Admin.md · Procurement appendix",
      }),
    ],
    insight,
    actionType: "audit_signal",
    objectNames: ["Asok-Din Daeng level crossing"],
  });

  assert.equal(rows[0].evidenceStrength, "context_only");
  assert.equal(rows[0].actionImplication, "No operational action is supported by this citation alone.");
  assert.equal(actionableEvidenceIds(rows).size, 0);
  assert.match(evidenceUseSummary(1, rows), /0 direct\/indirect and 1 context-only/);
});
