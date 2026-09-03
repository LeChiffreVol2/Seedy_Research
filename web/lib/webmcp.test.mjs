import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const module = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync(new URL("./webmcp.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(module, module.exports);
const { registerSeedResearchWebMcpTools, SEED_RESEARCH_WEBMCP_TOOL_NAMES, waitForResearchSurface } = module.exports;

test("Notebook tool schemas reject unsafe inputs before invoking application handlers", async () => {
  const tools = new Map();
  const calls = [];
  globalThis.document = { modelContext: { registerTool: async (tool) => tools.set(tool.name, tool) } };
  const handlers = new Proxy({}, { get: (_target, name) => async (...args) => { calls.push({ name, args }); return {}; } });
  const registration = await registerSeedResearchWebMcpTools(handlers);
  try {
    assert.deepEqual([...tools.keys()].sort(), [...SEED_RESEARCH_WEBMCP_TOOL_NAMES].sort());
    assert.equal(tools.size, 12);
    for (const name of ["open_research_notebook", "send_reviewed_to_notebook", "ask_research_notebook", "draft_notebook_artifact"]) {
      const tool = tools.get(name);
      assert.equal(tool.annotations.readOnlyHint, false);
      assert.equal(tool.annotations.untrustedContentHint, true);
      await assert.rejects(() => tool.execute({ acceptAll: true }));
    }
    for (const sources of [[], ["private:secret"], [" private:secret"], ["paper", "paper"], Array.from({ length: 13 }, (_, i) => `paper${i}`)]) {
      await assert.rejects(() => tools.get("ask_research_notebook").execute({ question: "Compare the public papers", sources }));
    }
    await assert.rejects(() => tools.get("draft_notebook_artifact").execute({ kind: "approve_publication", sources: ["paper"] }));
    assert.equal(calls.length, 0);
    const controller = new AbortController();
    await tools.get("ask_research_notebook").execute({ question: "Compare these public papers", sources: ["paper"] }, { signal: controller.signal });
    assert.equal(calls[0].name, "askResearchNotebook");
    assert.equal(calls[0].args[1], controller.signal);
  } finally { registration.abort(); delete globalThis.document; }
});

test("lazy research surface waits are abortable and never return stale context", async () => {
  const controller = new AbortController();
  const waiting = waitForResearchSurface(() => null, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  await assert.rejects(waitForResearchSurface(() => { throw new Error("Case changed"); }, new AbortController().signal), /Case changed/);
  const ready = { caseId: "current-case" };
  assert.equal(await waitForResearchSurface(() => ready, new AbortController().signal), ready);
});
