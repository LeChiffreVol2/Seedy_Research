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
