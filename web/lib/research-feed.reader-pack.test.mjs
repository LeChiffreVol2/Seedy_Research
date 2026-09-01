import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = join(testDirectory, "..");
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire("typescript");
const manifest = JSON.parse(readFileSync(join(webDirectory, "data/reader-papers/manifest.json"), "utf8"));
const fixturePapers = manifest.papers.map((paper) => ({
  ...paper,
  pages: JSON.parse(readFileSync(join(webDirectory, "data/reader-papers", paper.pagesFile), "utf8")).pages,
}));
let databaseClientAttempts = 0;

function findFixturePaper(source) {
  const normalized = source.trim().toLocaleLowerCase("en");
  return fixturePapers.find((paper) => [
    paper.source,
    paper.providerRecordId,
    paper.asset.id,
    paper.sourceUrl,
    paper.asset.originUrl,
    paper.doi,
    `doi:${paper.doi}`,
    ...paper.aliases,
  ].some((identity) => identity.trim().toLocaleLowerCase("en") === normalized)) ?? null;
}

function loadResearchFeedModule() {
  const filename = join(testDirectory, "research-feed.ts");
  const source = readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const testRequire = (specifier) => {
    if (specifier === "@supabase/supabase-js") {
      return {
        createClient: () => {
          databaseClientAttempts += 1;
          throw new Error("database access is forbidden in committed reader-pack tests");
        },
      };
    }
    if (specifier === "./paper-summary-overrides") return { PAPER_SUMMARY_OVERRIDES: {} };
    if (specifier === "./paper-title-overrides") return { PAPER_TITLE_OVERRIDES: {} };
    if (specifier === "./paper-reader") {
      return { getPaperReader: async () => { throw new Error("database reader is forbidden in committed fixture tests"); } };
    }
    if (specifier === "./rights-reviewed-reader-papers") {
      return {
        findRightsReviewedReaderPaper: findFixturePaper,
        listRightsReviewedReaderPapers: () => fixturePapers,
      };
    }
    return nodeRequire(specifier);
  };
  const execute = new Function("require", "module", "exports", "__filename", "__dirname", transpiled);
  execute(testRequire, module, module.exports, filename, testDirectory);
  return module.exports;
}

const feed = loadResearchFeedModule();

test("catalog titles retain legitimate Thailand wording", () => {
  assert.equal(
    feed.cleanCatalogTitle("AI Literacy, Integration, and Challenges in EFL Education: Perspectives of Higher Education Teachers in Thailand"),
    "AI Literacy, Integration, and Challenges in EFL Education: Perspectives of Higher Education Teachers in Thailand",
  );
});

test("reader-pack detail resolves DOI aliases without Supabase and preserves source page labels", async () => {
  const paper = fixturePapers.find((candidate) => candidate.source === "thaijo:learn:291543");
  assert.ok(paper);
  const before = databaseClientAttempts;
  const detail = await feed.getPaperDetail(`doi:${paper.doi.toLocaleLowerCase("en")}`, true, { pageStart: 181 });

  assert.equal(databaseClientAttempts, before, "fixture detail must resolve before constructing a database client");
  assert.equal(detail.document.source, paper.source);
  assert.deepEqual([detail.document.pageStart, detail.document.pageEnd], [156, 181]);
  assert.equal(detail.counts.sections, 26);
  assert.equal(detail.counts.chunks, 26);
  assert.equal(detail.evidence[0].pageStart, 181, "a source-page target should be promoted to the first evidence item");
  assert.equal(detail.evidence[0].readerPageNumber, 26, "reader navigation must retain the separate physical page index");
  assert.equal(detail.evidence[0].readerAnchor, `asset:${paper.asset.id}:page:26`);
  assert.equal(detail.related.length, fixturePapers.length - 1);
});

test("saved reader-pack aliases return canonical cards in request order without Supabase", async () => {
  const first = fixturePapers[0];
  const second = fixturePapers[1];
  const before = databaseClientAttempts;
  const cards = await feed.getResearchCardsBySources([second.asset.originUrl, first.providerRecordId]);

  assert.equal(databaseClientAttempts, before);
  assert.deepEqual(cards.map((card) => card.source), [second.source, first.source]);
  assert.ok(cards.every((card) => card.citable && card.evidenceStatus === "extracted"));
});

test("sitemap keeps canonical reader-pack records when Supabase is unavailable", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  try {
    const records = await feed.listPublicPaperRecordsForSitemap();
    assert.deepEqual(records.map((record) => record.source), fixturePapers.map((paper) => paper.source));
    assert.ok(records.every((record) => typeof record.updatedAt === "string" && record.updatedAt.length > 0));
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});

test("coverage ledger uses authoritative database counts instead of the three-paper fixture", () => {
  const base = {
    total: 1300,
    totalSections: 100,
    totalChunks: 100,
    catalogTotal: 2681,
    citableTotal: 1300,
    metadataOnlyTotal: 2578,
    providers: [{ provider: "tci_thaijo", records: 2681, citable: 103, metadataOnly: 2578 }],
    collections: [],
    filters: { hot: 1300, recent: 0, evidence: 0, thai: 2578, tci: 2578, ncce: 1200, ce_project: 100 },
  };
  const coverage = feed.buildCoverageLedger(base, [{
    provider: "tci_thaijo",
    records: 2681,
    metadataOnly: 2578,
    pageCitable: 103,
    nativeFullPaper: 103,
    sourceHostedFullPaper: 0,
    endpointObserved: 3,
    freshness: "2026-09-02",
  }]);
  const thaiJo = coverage.find((row) => row.provider === "tci_thaijo");
  assert.equal(thaiJo.records, 2681);
  assert.equal(thaiJo.metadataOnly, 2578);
  assert.equal(thaiJo.pageCitable, 103);
  assert.equal(thaiJo.nativeFullPaper, 103);
  assert.equal(thaiJo.endpointObserved, 3);
  assert.equal(thaiJo.endpointKnown, null);
  assert.equal(thaiJo.freshness, "2026-09-02");
});
