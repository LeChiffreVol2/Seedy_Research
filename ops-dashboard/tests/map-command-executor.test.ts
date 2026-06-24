import assert from "node:assert/strict";
import test from "node:test";

import { envelopeMapCommands, executeMapCommand, type OpsMapCommandState } from "../lib/map-command-executor";
import type { OpsMapCommand } from "../lib/types";

const emptyState: OpsMapCommandState = { layers: {}, styleOverrides: {} };

test("map command executor applies layer, view, object, evidence, filter, and style commands", () => {
  const commands: OpsMapCommand[] = [
    { type: "toggle_layer", layerId: "rail", enabled: true, reason: "show rail" },
    { type: "set_view", center: [100.55, 13.75], zoom: 12, reason: "focus object" },
    { type: "select_object", objectId: "rail_crossing:drt:1", reason: "select object" },
    { type: "open_evidence_panel", objectId: "rail_crossing:drt:1", evidenceIds: ["mcp:paper-1"], reason: "show evidence" },
    { type: "apply_spatial_filter", bbox: [100.3, 13.5, 100.9, 14], reason: "limit viewport" },
    { type: "style_layer", layerId: "rail", style: { "circle-opacity": 0.9 }, reason: "highlight rail" },
  ];
  let state = emptyState;
  const envelopes = envelopeMapCommands(commands, { researchRunId: "research:1", now: "2026-06-11T00:00:00.000Z" });
  const applied = envelopes.map((envelope) => {
    const result = executeMapCommand(state, envelope);
    state = result.state;
    return result.envelope;
  });

  assert.equal(applied.every((item) => item.status === "applied"), true);
  assert.equal(state.layers.rail, true);
  assert.deepEqual(state.center, [100.55, 13.75]);
  assert.equal(state.zoom, 12);
  assert.equal(state.selectedObjectId, "rail_crossing:drt:1");
  assert.deepEqual(state.evidencePanel?.evidenceIds, ["mcp:paper-1"]);
  assert.deepEqual(state.spatialFilter?.bbox, [100.3, 13.5, 100.9, 14]);
  assert.equal(state.styleOverrides.rail?.["circle-opacity"], 0.9);
});

test("run_research_gate command requires explicit acknowledgement", () => {
  const [envelope] = envelopeMapCommands([
    { type: "run_research_gate", objectIds: ["incident:real:1"], insightId: "insight:1", reason: "operator asks MCP" },
  ]);

  const rejected = executeMapCommand(emptyState, envelope);
  assert.equal(rejected.envelope.status, "rejected");
  assert.match(rejected.envelope.error ?? "", /Missing acknowledgement/);

  const applied = executeMapCommand(emptyState, envelope, ["operator_approved_research_call"]);
  assert.equal(applied.envelope.status, "applied");
  assert.deepEqual(applied.state.queuedResearchGate?.objectIds, ["incident:real:1"]);
});

test("invalid spatial filters fail without mutating state", () => {
  const [envelope] = envelopeMapCommands([
    { type: "apply_spatial_filter", bbox: [101, 14, 100, 13], reason: "bad bbox" },
  ]);
  const result = executeMapCommand(emptyState, envelope);
  assert.equal(result.envelope.status, "failed");
  assert.equal(result.state.spatialFilter, undefined);
});
