import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createActionRecord } from "../lib/action-log";
import { listActionEvents, transitionActionRecord } from "../lib/action-lifecycle";
import { executeAndPersistMapCommands, listCommandLog } from "../lib/command-audit";
import type { OpsActor } from "../lib/types";

const actor: OpsActor = {
  id: "ops:unit",
  username: "unit-operator",
  role: "admin",
  permissions: ["read.ops", "run.research_gate", "apply.ui_command", "record.action", "approve.action", "transition.action", "refresh.ingest"],
  authSource: "local_dev",
};

async function withTempLogs() {
  const dir = await mkdtemp(join(tmpdir(), "smart-city-agentic-"));
  process.env.OPS_ACTION_LOG_PATH = join(dir, "records.json");
  process.env.OPS_ACTION_EVENT_LOG_PATH = join(dir, "action-events.json");
  process.env.OPS_COMMAND_LOG_PATH = join(dir, "commands.json");
  process.env.OPS_COMMAND_EVENT_LOG_PATH = join(dir, "command-events.json");
}

test("command audit persists applied and rejected command envelopes", async () => {
  await withTempLogs();
  const commands = await executeAndPersistMapCommands({
    actor,
    commands: [
      { type: "toggle_layer", layerId: "rail", enabled: true, reason: "Show rail layer for unit test." },
      { type: "run_research_gate", objectIds: ["rail_crossing:real"], reason: "Requires explicit operator acknowledgement." },
    ],
    objectIds: ["rail_crossing:real"],
    acknowledgements: [],
  });

  assert.equal(commands.length, 2);
  assert.equal(commands[0].status, "applied");
  assert.equal(commands[1].status, "rejected");
  assert.match(commands[1].error ?? "", /Missing acknowledgement/);

  const log = await listCommandLog({ objectId: "rail_crossing:real" });
  assert.equal(log.length, 2);
  assert.equal(log[0].actor, "unit-operator");
});

test("command audit rejects unknown command shapes before persistence", async () => {
  await withTempLogs();
  await assert.rejects(
    () =>
      executeAndPersistMapCommands({
        actor,
        commands: [{ type: "unknown_command", reason: "Should not be accepted." } as never],
      }),
    /Unsupported map command type/,
  );
  const log = await listCommandLog();
  assert.equal(log.length, 0);
});

test("action lifecycle records valid transitions and rejects invalid skips", async () => {
  await withTempLogs();
  const record = await createActionRecord({
    actionType: "audit_signal",
    title: "Record lifecycle signal audit",
    actor: "unit-operator",
    sourceObjectIds: ["rail_crossing:real-lifecycle"],
    evidenceIds: ["mcp:real-citation-lifecycle"],
    riskBefore: 82,
    expectedRiskAfter: 74,
  });

  await assert.rejects(
    () => transitionActionRecord({ actionId: record.id, actor, toStatus: "closed", reason: "Cannot close directly." }),
    /Invalid action transition/,
  );

  const pending = await transitionActionRecord({ actionId: record.id, actor, toStatus: "pending_approval", reason: "Needs approval." });
  assert.equal(pending.fromStatus, "recorded");
  assert.equal(pending.toStatus, "pending_approval");

  const approved = await transitionActionRecord({ actionId: record.id, actor, toStatus: "approved", reason: "Evidence accepted." });
  assert.equal(approved.fromStatus, "pending_approval");
  assert.equal(approved.toStatus, "approved");

  const events = await listActionEvents(record.id);
  assert.equal(events.length, 2);
});
