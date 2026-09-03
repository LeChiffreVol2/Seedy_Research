import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const directory = dirname(fileURLToPath(import.meta.url));
const kinds = ["source_guide", "evidence_brief", "evidence_matrix", "literature_synthesis", "candidate_gap", "next_study_protocol", "manuscript_package"];

// Exercise the real POST -> retrieval -> generation -> persistence handoff.
// Only identity, storage and the model boundary are fixtures, never the guard.
function routeFixture(generated) {
  let saved;
  const source = "thaijo:fixture:1";
  const mocks = {
    "ai": { generateObject: async () => ({ object: generated }) },
    "@/lib/chat-auth": {
      resolveChatIdentity: async () => ({ identity: { userId: "owner", isAuthenticated: true, user: {} } }),
      featureAccessDeniedResponse: () => null,
      applyChatIdentityCookies: (response) => response,
    },
    "@/lib/chat-store": { ensureChatUser: async () => {}, consumeChatQuota: async () => ({ allowed: true }) },
    "@/lib/chat-models": { DEFAULT_CHAT_MODEL: "gpt-5.6-luna", isOpenAIChatModel: () => true, isDeepSeekChatModel: () => false },
    "@/lib/openrag-adapter": { getOpenRagAdapterStatus: () => ({ active: false }) },
    "@/lib/private-library": {},
    "@/lib/research-cases": { getResearchCase: async () => ({ caseId: "case_fixture01", selectedSources: [source] }) },
    "@/lib/research-feed": { getPaperDetail: async () => ({
      document: { source, citable: true, discoveryLayer: "evidence" },
      evidence: [{ id: "page-one", pageStart: 1, pageEnd: 1, snippet: "Evidence from a Thai paper." }],
    }) },
    "@/lib/research-notebooks": {
      NOTEBOOK_ARTIFACT_KINDS: kinds,
      ensureResearchNotebook: async () => ({ notebook_id: "notebook" }),
      getResearchNotebookSnapshot: async () => ({ messages: [], workspacePacks: [] }),
      saveNotebookArtifact: async (input) => { saved = input; return input; },
      appendNotebookExchange: async (input) => { saved = input; return { message: input }; },
    },
    "@/lib/research-workspaces": {},
    "@/lib/server-guards": {
      clampEnvNumber: (_value, _min, _max, fallback) => fallback,
      readBoundedJson: (request) => request.json(),
      getRequestIp: () => "127.0.0.1", rateLimitHeaders: () => ({}), safeTraceId: () => "fixture",
    },
  };
  const filename = join(directory, "../app/api/research-notebooks/route.ts");
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error(`Unmocked dependency: ${name}`);
    return require(name);
  }, module, module.exports);
  return {
    saved: () => saved,
    async post(action, kind = "evidence_brief") {
      const previous = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "fixture-no-network";
      try {
        return await module.exports.POST(new Request("http://localhost/api/research-notebooks", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, caseId: "case_fixture01", sources: [source], kind,
            question: "What does this paper support?", threadId: "11111111-1111-4111-8111-111111111111" }),
        }));
      } finally {
        if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
      }
    },
  };
}

test("every Studio kind removes off-packet inline citations before persistence", async () => {
  for (const kind of kinds) {
    const fixture = routeFixture({ title: "Draft", content: "Supported [N1]. Invalid [N99] [N1234].", citationIds: ["N1"] });
    assert.equal((await fixture.post("artifact", kind)).status, 200);
    assert.equal(fixture.saved().content, "Supported [N1]. Invalid [citation removed] [citation removed].");
    assert.deepEqual(fixture.saved().provenance.citations.map((item) => item.id), ["N1"]);
  }
});

test("Studio resolves valid inline citations even when the model omits its side list", async () => {
  const fixture = routeFixture({ title: "Draft", content: "Supported [N1].", citationIds: [] });
  assert.equal((await fixture.post("artifact")).status, 200);
  assert.deepEqual(fixture.saved().provenance.citations.map((item) => item.id), ["N1"]);
});

test("Studio does not persist an artifact without any resolvable citation", async () => {
  const fixture = routeFixture({ title: "Draft", content: "Unsupported [N99].", citationIds: [] });
  assert.equal((await fixture.post("artifact")).status, 503);
  assert.equal(fixture.saved(), undefined);
});

test("Notebook Chat retains valid provenance while removing unknown inline markers", async () => {
  const fixture = routeFixture({ answer: "Supported [N1]. Invalid [N99].", citationIds: [], insufficient: false });
  assert.equal((await fixture.post("ask")).status, 200);
  assert.equal(fixture.saved().answer, "Supported [N1]. Invalid [citation removed].");
  assert.deepEqual(fixture.saved().citations.map((item) => item.id), ["N1"]);
});
