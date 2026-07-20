import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createActionRecord, listActionRecords } from "../lib/action-log";

async function withTempActionLog() {
  const dir = await mkdtemp(join(tmpdir(), "smart-city-action-log-"));
  process.env.OPS_ACTION_LOG_PATH = join(dir, "records.json");
}

test("createActionRecord persists a local ops record", async () => {
  await withTempActionLog();
  const record = await createActionRecord({
    actionType: "audit_signal",
    title: "Record signal audit for real crossing",
    actor: "analyst@example.test",
    sourceObjectIds: ["hotspot:rail-case-real-crossing"],
    evidenceIds: ["mcp:real-citation-1"],
    riskBefore: 82,
    expectedRiskAfter: 72,
  });

  const records = await listActionRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, record.id);
  assert.equal(records[0].executionScope, "controlled_action_record");
});

test("createActionRecord rejects synthetic payload markers", async () => {
  await withTempActionLog();
  await assert.rejects(
    () =>
      createActionRecord({
        actionType: "monitor_watchlist",
        title: "Record from mock object",
        actor: "analyst@example.test",
        sourceObjectIds: ["hotspot:mock-object"],
        evidenceIds: ["mcp:real-citation-1"],
        riskBefore: 70,
        expectedRiskAfter: 70,
      }),
    /not executable/,
  );
});

test("listActionRecords filters by source object id", async () => {
  await withTempActionLog();
  await createActionRecord({
    actionType: "verify_camera",
    title: "Record camera verification one",
    actor: "analyst@example.test",
    sourceObjectIds: ["incident:real-traffic:one"],
    evidenceIds: ["mcp:real-citation-1"],
    riskBefore: 68,
    expectedRiskAfter: 64,
  });
  await createActionRecord({
    actionType: "queue_control_review",
    title: "Record queue review two",
    actor: "analyst@example.test",
    sourceObjectIds: ["incident:real-traffic:two"],
    evidenceIds: ["mcp:real-citation-2"],
    riskBefore: 76,
    expectedRiskAfter: 69,
  });

  const records = await listActionRecords({ objectId: "incident:real-traffic:two" });
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Record queue review two");
});

