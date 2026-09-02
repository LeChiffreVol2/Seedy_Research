import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire("typescript");

function catalogRow(index, provider = "tci_thaijo") {
  return {
    id: `catalog-${index}`,
    provider,
    provider_record_id: provider === "pmc_oa" ? `PMC${280000 + index}.1` : `oai:he01.tci-thaijo.org:article/${280000 + index}`,
    collection: provider === "pmc_oa" ? "thai_affiliated_global_oa" : "tci_journal",
    source_type: "journal_article",
    title_local: null,
    title_en: `Native paper ${index}`,
    authors: ["Scale Researcher"],
    keywords: [],
    doi: null,
    canonical_url: provider === "pmc_oa" ? `https://pmc.ncbi.nlm.nih.gov/articles/PMC${280000 + index}/` : `https://he01.tci-thaijo.org/article/view/${280000 + index}`,
    journal_title: "Scale Journal",
    publisher: "Scale University",
    published_at: "2026-01-01",
    language: "en",
    discipline: "medical_and_health_sciences",
    license: provider === "pmc_oa" ? "CC-BY-3.0" : "CC-BY-4.0",
    rights_status: "open_license_verified",
    access_level: "full_text_licensed",
    evidence_status: "extracted",
    document_id: null,
    updated_at: "2026-09-02T00:00:00Z",
    total_count: 7_578,
  };
}

function loadModule(rpcCalls, options = {}) {
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
      if (name === "civil_source_catalog_facets_v1") return { data: [{ provider: "tci_thaijo", records: 7_578, citable: 5_000, metadata_only: 2_578 }], error: null };
      if (name === "civil_research_coverage_v1") return { data: [{ provider: "tci_thaijo", records: 7_578, metadata_only: 2_578, page_citable: 5_000, native_full_paper: 5_000, source_hosted_full_paper: 0, endpoint_observed: 10, freshness: "2026-09-02" }], error: null };
      if (name === "civil_evidence_feed_previews_v1" && options.evidenceDocument) {
        return {
          data: [
            {
              preview_kind: "section",
              document_id: options.evidenceDocument.id,
              payload: options.evidenceSection,
            },
          ],
          error: null,
        };
      }
      if (name === "search_civil_source_catalog_public_v2") {
        return {
          data: options.catalogRows ?? Array.from({ length: 30 }, (_, index) => catalogRow(4_990 + index, params.filter_provider ?? "tci_thaijo")),
          error: null,
        };
      }
      return { data: null, error: { code: "PGRST202", message: `Unexpected RPC ${name}` } };
    },
    from: (table) => {
      if (!options.evidenceDocument && !options.allowEmptyEvidence) throw new Error("scale feed must not fall back to a catalog-wide table read");
      const state = { hasOr: false, ids: [] };
      const query = {
        select: () => query,
        or: () => { state.hasOr = true; return query; },
        eq: () => query,
        in: (_column, ids) => { state.ids = ids; return query; },
        limit: async () => {
          if (table === "civil_sections_v2" && state.hasOr && options.evidenceDocument) {
            return { data: [{ ...options.evidenceSection, document_id: options.evidenceDocument.id }], error: null };
          }
          if (table === "civil_documents_v2" && state.hasOr && options.evidenceDocument) {
            return { data: [options.evidenceDocument], error: null };
          }
          if (table === "civil_documents_v2" && options.evidenceDocument && state.ids.includes(options.evidenceDocument.id)) {
            return { data: [options.evidenceDocument], error: null };
          }
          return { data: [], error: null };
        },
      };
      return query;
    },
  };
  const requireForTest = (specifier) => {
    if (specifier === "@supabase/supabase-js") return { createClient: () => client };
    if (specifier === "./paper-summary-overrides") return { PAPER_SUMMARY_OVERRIDES: {} };
    if (specifier === "./paper-title-overrides") return { PAPER_TITLE_OVERRIDES: {} };
    if (specifier === "./rights-reviewed-reader-papers") return { findRightsReviewedReaderPaper: () => null, listRightsReviewedReaderPapers: () => [] };
    if (specifier === "./paper-reader") return { getPaperReader: async () => null };
    if (specifier === "./research-relevance.mjs") return {
      filterResearchCardsByRelevance: options.relevanceFilter ?? ((_query, cards) => cards),
    };
    if (specifier === "./visibility-audit") return {
      getVisibilitySummary: async () => ({
        auditRunId: null, provider: "tci_thaijo", externalIndex: "openalex", snapshotDate: null,
        runStatus: "not_started", strategy: null, denominator: 0, attempted: 0, audited: 0,
        globallyIndexed: 0, underIndexed: 0, candidateReview: 0, notFoundInAudit: 0,
        unavailable: 0, methodVersion: null, complete: false,
      }),
      getVisibilityReceipts: async (sources) => Object.fromEntries(sources.map((source) => [source, {
        source, provider: "tci_thaijo", externalIndex: "openalex", state: "not_audited", matchBasis: "none",
        externalWorkId: null, externalUrl: null, confidence: null, requiresHumanReview: false,
        metadataGaps: [], checkedAt: null, snapshotDate: null, methodVersion: null,
      }])),
    };
    return nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", transpiled)(requireForTest, module, module.exports, filename, directory);
  return module.exports;
}

test("Thai discovery page 167 stays one bounded native-first database page at 5,000 native papers", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-test-key";
  try {
    const rpcCalls = [];
    const feed = loadModule(rpcCalls);
    const cursor = Buffer.from(JSON.stringify({ offset: 4_990 }), "utf8").toString("base64url");
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
      match_offset: 4_990,
    });
    assert.ok(result.nextCursor);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});

test("Thai-published discovery removes unrelated one-token matches before returning a natural-query page", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-test-key";
  try {
    const relevant = { ...catalogRow(1), title_en: "AI learning outcomes in higher education in Thailand", total_count: 4 };
    const rows = [
      relevant,
      { ...catalogRow(2), title_en: "Entrepreneurial activity in Ukrainian higher education", total_count: 4 },
      { ...catalogRow(3), title_en: "Digital transformation in global higher education", total_count: 4 },
      { ...catalogRow(4), title_en: "International education in the Philippines", total_count: 4 },
    ];
    const rpcCalls = [];
    const feed = loadModule(rpcCalls, {
      catalogRows: rows,
      allowEmptyEvidence: true,
      relevanceFilter: (_query, cards) => cards.filter((card) => card.source === relevant.provider_record_id),
    });
    const result = await feed.listResearchFeed({
      filter: "thai",
      q: "AI learning outcomes in Thai higher education",
      limit: 2,
    });

    assert.deepEqual(result.cards.map((card) => card.source), [relevant.provider_record_id]);
    const searchCall = rpcCalls.find((call) => call.name === "search_civil_source_catalog_public_v2");
    assert.ok(searchCall);
    assert.equal(searchCall.params.match_count, 8, "natural queries need a bounded candidate window before relevance filtering");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});

test("Thai-published natural-query discovery joins local conference evidence with ThaiJO catalog results", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-test-key";
  try {
    const evidenceDocument = {
      id: "doc-road",
      source: "NCCE29_TRL42.md",
      source_pdf: "NCCE29_TRL42.pdf",
      collection: "ncce",
      source_type: "conference_paper",
      paper_code: "TRL42",
      proceeding_no: 29,
      proceeding_year: 2024,
      discipline: "transport",
      section_count: 8,
      chunk_count: 12,
      indexed_at: "2026-09-02T00:00:00Z",
    };
    const evidenceSection = {
      id: "section-road",
      source: evidenceDocument.source,
      paper_code: evidenceDocument.paper_code,
      discipline: evidenceDocument.discipline,
      section_title: "Road safety intervention for Thai highways",
      content: "This Thai conference study evaluates road safety interventions and traffic crash outcomes in Thailand.",
    };
    const rpcCalls = [];
    const feed = loadModule(rpcCalls, {
      evidenceDocument,
      evidenceSection,
      catalogRows: [{ ...catalogRow(2), title_en: "Unrelated language teaching paper", total_count: 1 }],
    });
    const result = await feed.listResearchFeed({
      filter: "thai",
      q: "road safety interventions in Thailand",
      limit: 6,
    });

    assert.ok(result.cards.some((card) => card.source === "NCCE29_TRL42.md"));
    const local = result.cards.find((card) => card.source === "NCCE29_TRL42.md");
    assert.equal(local.provider, "ncce");
    assert.equal(local.thaiPublished, true);
    assert.ok(local.filters.includes("thai"));
    assert.ok(!result.cards.some((card) => card.provider === "pmc_oa"));
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});

test("PMC cards use the exact item license and do not masquerade as TCI records", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-test-key";
  try {
    const rpcCalls = [];
    const feed = loadModule(rpcCalls);
    const result = await feed.listResearchFeed({ filter: "thai", provider: "pmc_oa", limit: 1 });
    const card = result.cards[0];
    assert.equal(card.provider, "pmc_oa");
    assert.ok(card.sourceLabel.includes("PMC · Thai-affiliated global OA"));
    assert.ok(card.tags.includes("CC BY 3.0"));
    assert.ok(!card.tags.includes("ThaiJO"));
    assert.ok(!card.filters.includes("tci"));
    assert.ok(card.summary.includes("not clinical advice"));
    assert.equal(card.licenseUrl, "https://creativecommons.org/licenses/by/3.0/");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});
