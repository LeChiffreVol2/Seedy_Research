import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire("typescript");

function catalogRow(index) {
  return {
    id: `catalog-${index}`,
    provider: "tci_thaijo",
    provider_record_id: `oai:he01.tci-thaijo.org:article/${280000 + index}`,
    collection: "tci_journal",
    source_type: "journal_article",
    title_local: null,
    title_en: `Native paper ${index}`,
    authors: ["Scale Researcher"],
    keywords: [],
    doi: null,
    canonical_url: `https://he01.tci-thaijo.org/article/view/${280000 + index}`,
    journal_title: "Scale Journal",
    publisher: "Scale University",
    published_at: "2026-01-01",
    language: "en",
    discipline: "medical_and_health_sciences",
    license: "CC-BY-4.0",
    rights_status: "open_license_verified",
    access_level: "full_text_licensed",
    evidence_status: "extracted",
    document_id: null,
    updated_at: "2026-09-02T00:00:00Z",
    total_count: 3_578,
  };
}

function loadModule(rpcCalls) {
  const filename = join(directory, "research-feed.ts");
  const transpiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const client = {
    rpc: async (name, params = {}) => {
      rpcCalls.push({ name, params });
      if (name === "civil_evidence_feed_facets_v1") return { data: [{ total: 1_297, total_sections: 11_523, total_chunks: 68_614, recent: 0, evidence: 1_297, ncce: 1_230, ce_project: 67 }], error: null };
      if (name === "civil_source_catalog_facets_v1") return { data: [{ provider: "tci_thaijo", records: 3_578, citable: 1_000, metadata_only: 2_578 }], error: null };
      if (name === "civil_research_coverage_v1") return { data: [{ provider: "tci_thaijo", records: 3_578, metadata_only: 2_578, page_citable: 1_000, native_full_paper: 1_000, source_hosted_full_paper: 0, endpoint_observed: 10, freshness: "2026-09-02" }], error: null };
      if (name === "search_civil_source_catalog_public_v2") {
        return { data: Array.from({ length: 30 }, (_, index) => catalogRow(990 + index)), error: null };
      }
      return { data: null, error: { code: "PGRST202", message: `Unexpected RPC ${name}` } };
    },
    from: () => { throw new Error("scale feed must not fall back to a catalog-wide table read"); },
  };
  const requireForTest = (specifier) => {
    if (specifier === "@supabase/supabase-js") return { createClient: () => client };
    if (specifier === "./paper-summary-overrides") return { PAPER_SUMMARY_OVERRIDES: {} };
    if (specifier === "./paper-title-overrides") return { PAPER_TITLE_OVERRIDES: {} };
    if (specifier === "./rights-reviewed-reader-papers") return { findRightsReviewedReaderPaper: () => null, listRightsReviewedReaderPapers: () => [] };
    if (specifier === "./paper-reader") return { getPaperReader: async () => null };
    if (specifier === "./research-relevance.mjs") return { filterResearchCardsByRelevance: (_query, cards) => cards };
    return nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", transpiled)(requireForTest, module, module.exports, filename, directory);
  return module.exports;
}

test("Thai discovery page 34 stays one bounded native-first database page at 1,000 native papers", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-test-key";
  try {
    const rpcCalls = [];
    const feed = loadModule(rpcCalls);
    const cursor = Buffer.from(JSON.stringify({ offset: 990 }), "utf8").toString("base64url");
    const result = await feed.listResearchFeed({ filter: "thai", provider: "tci_thaijo", limit: 30, cursor });
    assert.equal(result.cards.length, 30);
    assert.ok(result.cards.every((card) => card.evidenceStatus === "extracted"));
    const pageCalls = rpcCalls.filter((call) => call.name === "search_civil_source_catalog_public_v2");
    assert.equal(pageCalls.length, 1);
    assert.deepEqual(pageCalls[0].params, {
      search_query: "",
      filter_provider: "tci_thaijo",
      filter_discipline: null,
      filter_evidence_status: null,
      native_first: true,
      match_count: 30,
      match_offset: 990,
    });
    assert.ok(result.nextCursor);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});
