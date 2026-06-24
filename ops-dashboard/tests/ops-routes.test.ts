import assert from "node:assert/strict";
import test from "node:test";

import { POST as recordAction } from "../app/api/ops/actions/record/route";
import { POST as executeCommand } from "../app/api/ops/commands/execute/route";
import { GET as getLayers } from "../app/api/ops/layers/route";
import { POST as executeRailAction } from "../app/api/ops/rail/execute/route";
import { GET as getTile } from "../app/api/ops/tiles/[z]/[x]/[y]/route";

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

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
  const empty = await recordAction(new Request("http://localhost/api/ops/actions/record", { method: "POST", body: "{}" }));
  assert.equal(empty.status, 422);
  assert.match(String((await json(empty)).error), /researchRunId/);

  const synthetic = await recordAction(
    new Request("http://localhost/api/ops/actions/record", {
      method: "POST",
      body: JSON.stringify({
        actor: "ops-dashboard",
        researchRunId: "synthetic:run",
        proposalId: "proposal:1",
      }),
    }),
  );
  assert.equal(synthetic.status, 422);
  assert.match(String((await json(synthetic)).error), /actor is derived/);
});

test("rail execute route rejects client-supplied proposal bypass without persisted Research Gate identity", async () => {
  const response = await executeRailAction(
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
  );
  assert.equal(response.status, 422);
  assert.match(String((await json(response)).error), /persisted Research Gate/);
});

test("command execute route rejects unknown command types", async () => {
  const response = await executeCommand(
    new Request("http://localhost/api/ops/commands/execute", {
      method: "POST",
      body: JSON.stringify({
        commands: [{ type: "unknown_command", reason: "Forged command should fail." }],
      }),
    }),
  );
  assert.equal(response.status, 422);
  assert.match(String((await json(response)).error), /Unsupported map command type/);
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
