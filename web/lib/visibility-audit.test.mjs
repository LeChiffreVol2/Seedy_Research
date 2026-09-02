import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire("typescript");

function loadModule(rpc) {
  const filename = join(directory, "visibility-audit.ts");
  const transpiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const requireForTest = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@supabase/supabase-js") return { createClient: () => ({ rpc }) };
    return nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", transpiled)(requireForTest, module, module.exports, filename, directory);
  return module.exports;
}

async function withServerEnv(run) {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-test-key";
  try { await run(); }
  finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = oldKey;
  }
}

test("work receipt preserves a dated exact identity decision", async () => withServerEnv(async () => {
  const visibility = loadModule(async (name, params) => {
    assert.equal(name, "civil_visibility_receipt_v1");
    assert.deepEqual(params, { source_identifier: "oai:thai:1", index_name: "openalex" });
    return { data: [{
      source: "oai:thai:1",
      provider: "tci_thaijo",
      external_index: "openalex",
      visibility_state: "under_indexed",
      match_basis: "exact_doi",
      external_work_id: "https://openalex.org/W123",
      external_url: "https://openalex.org/W123",
      confidence: 1,
      requires_human_review: false,
      metadata_gaps: ["thai_title_not_represented"],
      checked_at: "2026-09-02T00:00:00Z",
      audit_snapshot_date: "2026-09-02",
      method_version: "seedy-openalex-visibility-v1",
    }], error: null };
  });
  const receipt = await visibility.getVisibilityReceipt("oai:thai:1");
  assert.equal(receipt.state, "under_indexed");
  assert.equal(receipt.matchBasis, "exact_doi");
  assert.equal(receipt.externalWorkId, "https://openalex.org/W123");
  assert.deepEqual(receipt.metadataGaps, ["thai_title_not_represented"]);
  assert.equal(receipt.checkedAt, "2026-09-02T00:00:00Z");
}));

test("an unavailable audit RPC never becomes a not-found claim", async () => withServerEnv(async () => {
  const visibility = loadModule(async () => ({ data: null, error: { code: "PGRST202", message: "function missing" } }));
  const receipt = await visibility.getVisibilityReceipt("oai:thai:2");
  assert.equal(receipt.state, "not_audited");
  assert.equal(receipt.externalWorkId, null);
  assert.equal(receipt.checkedAt, null);
}));

test("summary exposes a dated denominator and keeps unavailable records separate", async () => withServerEnv(async () => {
  const visibility = loadModule(async (name) => {
    assert.equal(name, "civil_visibility_summary_v1");
    return { data: [{
      audit_run_id: "11111111-1111-1111-1111-111111111111",
      provider: "tci_thaijo",
      external_index: "openalex",
      audit_snapshot_date: "2026-09-02",
      run_status: "partial",
      strategy: "identifiers",
      denominator: 2681,
      attempted_count: 833,
      globally_indexed_count: 310,
      under_indexed_count: 420,
      candidate_count: 20,
      not_found_count: 70,
      unavailable_count: 13,
      method_version: "seedy-openalex-visibility-v1",
    }], error: null };
  });
  const summary = await visibility.getVisibilitySummary("tci_thaijo");
  assert.equal(summary.denominator, 2681);
  assert.equal(summary.audited, 820);
  assert.equal(summary.unavailable, 13);
  assert.equal(summary.notFoundInAudit, 70);
  assert.equal(summary.complete, false);
}));

test("batch receipts use one bounded RPC and default missing sources to not audited", async () => withServerEnv(async () => {
  let calls = 0;
  const visibility = loadModule(async (name, params) => {
    calls += 1;
    assert.equal(name, "civil_visibility_receipts_v1");
    assert.deepEqual(params, { source_identifiers: ["thai:1", "thai:2"], index_name: "openalex" });
    return { data: [{
      source: "thai:1",
      provider: "tci_thaijo",
      external_index: "openalex",
      visibility_state: "candidate_match",
      match_basis: "title_author_year",
      external_work_id: "https://openalex.org/W456",
      external_url: "https://openalex.org/W456",
      confidence: 0.91,
      requires_human_review: true,
      metadata_gaps: [],
      checked_at: "2026-09-02T00:00:00Z",
      audit_snapshot_date: "2026-09-02",
      method_version: "seedy-openalex-visibility-v1",
    }], error: null };
  });
  const receipts = await visibility.getVisibilityReceipts(["thai:1", "thai:2", "thai:1"]);
  assert.equal(calls, 1);
  assert.equal(receipts["thai:1"].state, "candidate_match");
  assert.equal(receipts["thai:2"].state, "not_audited");
}));
