import assert from "node:assert/strict";
import test from "node:test";

import { GET as getActionLog } from "../app/api/ops/actions/log/route";
import { POST as recordAction } from "../app/api/ops/actions/record/route";
import { POST as executeCommand } from "../app/api/ops/commands/execute/route";
import { GET as getLayers } from "../app/api/ops/layers/route";
import { GET as getRailActions, POST as executeRailAction } from "../app/api/ops/rail/execute/route";
import { POST as researchRail } from "../app/api/ops/rail/research/route";
import { POST as researchHotspot } from "../app/api/ops/research/route";
import { GET as getTile } from "../app/api/ops/tiles/[z]/[x]/[y]/route";
import { resolveOpsBasicAuth } from "../lib/ops-auth-shared";

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function withLocalOpsAuth<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OPS_DASHBOARD_AUTH_DISABLED;
  process.env.OPS_DASHBOARD_AUTH_DISABLED = "true";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.OPS_DASHBOARD_AUTH_DISABLED;
    else process.env.OPS_DASHBOARD_AUTH_DISABLED = previous;
  }
}

test("ops RBAC policy authenticates distinct named operators", () => {
  const previous = process.env.OPS_RBAC_POLICY_JSON;
  process.env.OPS_RBAC_POLICY_JSON = JSON.stringify({
    users: {
      analyst_a: { password: "pw-a", role: "analyst" },
      operator_b: { password: "pw-b", role: "operator" },
    },
  });
  try {
    const analyst = resolveOpsBasicAuth("analyst_a", "pw-a");
    const operator = resolveOpsBasicAuth("operator_b", "pw-b");
    assert.equal(analyst?.role, "analyst");
    assert.equal(analyst?.permissions.includes("record.action"), false);
    assert.equal(operator?.role, "operator");
    assert.equal(operator?.permissions.includes("record.action"), true);
    assert.equal(resolveOpsBasicAuth("operator_b", "wrong"), null);
  } finally {
    if (previous === undefined) delete process.env.OPS_RBAC_POLICY_JSON;
    else process.env.OPS_RBAC_POLICY_JSON = previous;
  }
});

test("legacy dashboard credential is read-only unless RBAC explicitly grants a stronger role", () => {
  const previousPolicy = process.env.OPS_RBAC_POLICY_JSON;
  const previousUser = process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
  const previousPassword = process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
  process.env.OPS_DASHBOARD_BASIC_AUTH_USER = "legacy";
  process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD = "pw";
  process.env.OPS_RBAC_POLICY_JSON = JSON.stringify({
    users: {
      analyst_a: { password: "pw-a", role: "analyst" },
    },
  });
  try {
    const legacy = resolveOpsBasicAuth("legacy", "pw");
    assert.equal(legacy?.role, "viewer");
    assert.deepEqual(legacy?.permissions, ["read.ops"]);
  } finally {
    if (previousPolicy === undefined) delete process.env.OPS_RBAC_POLICY_JSON;
    else process.env.OPS_RBAC_POLICY_JSON = previousPolicy;
    if (previousUser === undefined) delete process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
    else process.env.OPS_DASHBOARD_BASIC_AUTH_USER = previousUser;
    if (previousPassword === undefined) delete process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
    else process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD = previousPassword;
  }
});

test("legacy dashboard credential can be elevated only through explicit defaultRole", () => {
  const previousPolicy = process.env.OPS_RBAC_POLICY_JSON;
  const previousUser = process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
  const previousPassword = process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
  process.env.OPS_DASHBOARD_BASIC_AUTH_USER = "legacy";
  process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD = "pw";
  process.env.OPS_RBAC_POLICY_JSON = JSON.stringify({ defaultRole: "operator" });
  try {
    const legacy = resolveOpsBasicAuth("legacy", "pw");
    assert.equal(legacy?.role, "operator");
    assert.equal(legacy?.permissions.includes("record.action"), true);
    assert.equal(legacy?.permissions.includes("approve.action"), false);
  } finally {
    if (previousPolicy === undefined) delete process.env.OPS_RBAC_POLICY_JSON;
    else process.env.OPS_RBAC_POLICY_JSON = previousPolicy;
    if (previousUser === undefined) delete process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
    else process.env.OPS_DASHBOARD_BASIC_AUTH_USER = previousUser;
    if (previousPassword === undefined) delete process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
    else process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD = previousPassword;
  }
});

test("legacy dashboard credential can use user-specific RBAC role entries", () => {
  const previousPolicy = process.env.OPS_RBAC_POLICY_JSON;
  const previousUser = process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
  const previousPassword = process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
  process.env.OPS_DASHBOARD_BASIC_AUTH_USER = "ops";
  process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD = "pw";
  process.env.OPS_RBAC_POLICY_JSON = JSON.stringify({ users: { ops: "operator" } });
  try {
    const actor = resolveOpsBasicAuth("ops", "pw");
    assert.equal(actor?.role, "operator");
    assert.equal(actor?.permissions.includes("record.action"), true);
    assert.equal(resolveOpsBasicAuth("ops", "wrong"), null);
  } finally {
    if (previousPolicy === undefined) delete process.env.OPS_RBAC_POLICY_JSON;
    else process.env.OPS_RBAC_POLICY_JSON = previousPolicy;
    if (previousUser === undefined) delete process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
    else process.env.OPS_DASHBOARD_BASIC_AUTH_USER = previousUser;
    if (previousPassword === undefined) delete process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
    else process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD = previousPassword;
  }
});

test("layers route rejects missing and invalid viewport contracts", async () => {
  const missing = await getLayers(new Request("http://localhost/api/ops/layers"));
  assert.equal(missing.status, 400);
  assert.match(String((await json(missing)).error), /bbox is required/);

  const invalid = await getLayers(new Request("http://localhost/api/ops/layers?bbox=100,14,99,13"));
  assert.equal(invalid.status, 400);
  assert.match(String((await json(invalid)).error), /Invalid bbox/);

  const unknownType = await getLayers(new Request("http://localhost/api/ops/layers?bbox=100,13,101,14&types=rail,unknown"));
  assert.equal(unknownType.status, 400);
  assert.deepEqual((await json(unknownType)).invalidTypes, ["unknown"]);

  const badSince = await getLayers(new Request("http://localhost/api/ops/layers?bbox=100,13,101,14&since=not-a-date"));
  assert.equal(badSince.status, 400);
  assert.match(String((await json(badSince)).error), /Invalid since/);
});

test("action record route rejects requests without persisted research proposal identity", async () => {
  const empty = await withLocalOpsAuth(() =>
    recordAction(new Request("http://localhost/api/ops/actions/record", { method: "POST", body: "{}" })),
  );
  assert.equal(empty.status, 422);
  assert.match(String((await json(empty)).error), /researchRunId/);

  const synthetic = await withLocalOpsAuth(() =>
    recordAction(
      new Request("http://localhost/api/ops/actions/record", {
        method: "POST",
        body: JSON.stringify({
          actor: "ops-dashboard",
          researchRunId: "synthetic:run",
          proposalId: "proposal:1",
        }),
      }),
    ),
  );
  assert.equal(synthetic.status, 422);
  assert.match(String((await json(synthetic)).error), /actor is derived/);
});

test("rail execute route rejects client-supplied proposal bypass without persisted Research Gate identity", async () => {
  const response = await withLocalOpsAuth(() =>
    executeRailAction(
      new Request("http://localhost/api/ops/rail/execute", {
        method: "POST",
        body: JSON.stringify({
          railCase: { id: "rail-case:real", name: "Real rail case" },
          proposal: {
            id: "rail-signal-barrier-audit",
            title: "Forged rail action",
            simulation: {
              beforeRisk: 80,
              afterExpectedRisk: 60,
              delta: -20,
              confidence: 0.9,
              evidenceBasis: ["forged citation"],
              caveat: "forged",
            },
          },
        }),
      }),
    ),
  );
  assert.equal(response.status, 422);
  assert.match(String((await json(response)).error), /persisted Research Gate/);
});

test("advisory research routes reject synthetic client-supplied objects", async () => {
  const hotspot = await withLocalOpsAuth(() =>
    researchHotspot(
      new Request("http://localhost/api/ops/research", {
        method: "POST",
        body: JSON.stringify({
          hotspot: {
            id: "synthetic:hotspot",
            name: "Synthetic hotspot",
            corridor: "Synthetic corridor",
          },
          events: [],
        }),
      }),
    ),
  );
  assert.equal(hotspot.status, 422);
  assert.match(String((await json(hotspot)).error), /Synthetic/);

  const rail = await withLocalOpsAuth(() =>
    researchRail(
      new Request("http://localhost/api/ops/rail/research", {
        method: "POST",
        body: JSON.stringify({
          railCase: {
            id: "synthetic:rail-case",
            name: "Synthetic rail case",
            crossingAssetId: "synthetic:asset",
          },
          events: [],
        }),
      }),
    ),
  );
  assert.equal(rail.status, 422);
  assert.match(String((await json(rail)).error), /Synthetic/);
});

test("command execute route rejects unknown command types", async () => {
  const response = await withLocalOpsAuth(() =>
    executeCommand(
      new Request("http://localhost/api/ops/commands/execute", {
        method: "POST",
        body: JSON.stringify({
          commands: [{ type: "unknown_command", reason: "Forged command should fail." }],
        }),
      }),
    ),
  );
  assert.equal(response.status, 422);
  assert.match(String((await json(response)).error), /Unsupported map command type/);
});

test("action-read routes reject direct handler calls without read permission", async () => {
  const actionLog = await getActionLog(new Request("http://localhost/api/ops/actions/log"));
  assert.equal(actionLog.status, 403);

  const railLog = await getRailActions(new Request("http://localhost/api/ops/rail/execute"));
  assert.equal(railLog.status, 403);
});

test("layers route validates pagination contracts before PostGIS reads", async () => {
  const badLimit = await getLayers(new Request("http://localhost/api/ops/layers?bbox=100,13,101,14&limit=0"));
  assert.equal(badLimit.status, 400);
  assert.match(String((await json(badLimit)).error), /Invalid limit/);

  const badCursor = await getLayers(new Request("http://localhost/api/ops/layers?bbox=100,13,101,14&cursor=not-base64"));
  assert.equal(badCursor.status, 400);
  assert.match(String((await json(badCursor)).error), /Invalid cursor/);
});

test("MVT tile route validates tile coordinates before RPC reads", async () => {
  const invalidZoom = await getTile(new Request("http://localhost/api/ops/tiles/99/0/0.mvt"), {
    params: Promise.resolve({ z: "99", x: "0", y: "0.mvt" }),
  });
  assert.equal(invalidZoom.status, 400);
  assert.match(String((await json(invalidZoom)).error), /Invalid tile coordinate/);

  const invalidLayer = await getTile(new Request("http://localhost/api/ops/tiles/10/512/512.mvt?types=unknown"), {
    params: Promise.resolve({ z: "10", x: "512", y: "512.mvt" }),
  });
  assert.equal(invalidLayer.status, 400);
  assert.deepEqual((await json(invalidLayer)).invalidTypes, ["unknown"]);
});
