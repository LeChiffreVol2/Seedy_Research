import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire("typescript");
const source = "oai:he01.tci-thaijo.org:article/279467";

class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(field, value) { this.filters.push([field, value]); return this; }
  neq() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  then(resolve, reject) {
    const matches = this.table === "civil_source_catalog"
      && this.filters.some(([field, value]) => field === "provider_record_id" && value === source);
    const data = matches ? [{
      id: "tci_thaijo:db-native",
      provider: "tci_thaijo",
      provider_record_id: source,
      collection: "tci_journal",
      source_type: "journal_article",
      title_local: null,
      title_en: "A database-backed BSCM paper",
      authors: ["Researcher One"],
      keywords: [],
      doi: null,
      canonical_url: "https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/279467",
      journal_title: "Biomedical Sciences and Clinical Medicine",
      publisher: "Faculty of Medicine, Chiang Mai University",
      published_at: "2026-05-25",
      language: "en",
      discipline: "medical_and_health_sciences",
      license: "CC-BY-4.0",
      rights_status: "open_license_verified",
      access_level: "full_text_licensed",
      evidence_status: "extracted",
      document_id: null,
      updated_at: "2026-09-01T23:00:00Z",
    }] : [];
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

function loadModule() {
  const filename = join(directory, "research-feed.ts");
  const transpiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const requireForTest = (specifier) => {
    if (specifier === "@supabase/supabase-js") return { createClient: () => ({ from: (table) => new Query(table) }) };
    if (specifier === "./paper-summary-overrides") return { PAPER_SUMMARY_OVERRIDES: {} };
    if (specifier === "./paper-title-overrides") return { PAPER_TITLE_OVERRIDES: {} };
    if (specifier === "./rights-reviewed-reader-papers") {
      return { findRightsReviewedReaderPaper: () => null, listRightsReviewedReaderPapers: () => [] };
    }
    if (specifier === "./paper-reader") {
      return { getPaperReader: async () => ({
        access: { mode: "native_verified" },
        asset: { pageCount: 7 },
        pages: [{
          id: "page-1",
          pageNumber: 1,
          pageLabel: "1",
          sectionTitle: "Abstract",
          text: "Exact database-backed page text.",
          anchor: "asset:db-native:page:1",
        }],
        pagination: { totalPages: 7 },
      }) };
    }
    return nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", transpiled)(
    requireForTest, module, module.exports, filename, directory,
  );
  return module.exports;
}

test("paper detail resolves a Supabase-only native catalog record", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-test-key";
  try {
    const feed = loadModule();
    const detail = await feed.getPaperDetail(source, false);
    assert.equal(detail.document.source, source);
    assert.equal(detail.document.citable, true);
    assert.equal(detail.document.pages, 7);
    assert.equal(detail.sections[0].pageStart, 1);
    assert.equal(detail.evidence[0].readerAnchor, "asset:db-native:page:1");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});
