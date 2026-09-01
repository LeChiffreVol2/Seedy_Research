import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire("typescript");
const source = "oai:he01.tci-thaijo.org:article/279251";
const workId = "bfeea312-b855-4f56-8624-c351c0de2373";
const assetId = "9db8b2dd-3db5-4a56-badc-d49b9218fba5";
const pageText = "Abstract\nA database-only biomedical research page with a stable exact-page citation.";
const pageHash = createHash("sha256").update(pageText, "utf8").digest("hex");
const assetHash = "a".repeat(64);
let databaseQueries = 0;

const rows = {
  civil_documents_v2: [],
  civil_source_catalog: [{
    id: "tci_thaijo:fixture-db-only",
    work_id: workId,
    provider: "tci_thaijo",
    provider_record_id: source,
    title_local: null,
    title_en: "A database-only biomedical paper",
    canonical_url: "https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/279251",
    pdf_url: "https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/download/279251/192183",
    publisher: "Faculty of Medicine, Chiang Mai University",
    journal_title: "Biomedical Sciences and Clinical Medicine",
    license: "CC-BY-4.0",
    rights_status: "open_license_verified",
    access_level: "full_text_licensed",
    evidence_status: "extracted",
    document_id: null,
    updated_at: "2026-09-01T23:00:00Z",
  }],
  civil_works: [{
    work_id: workId,
    canonical_key: `provider:tci_thaijo:${source}`,
    title_local: null,
    title_en: "A database-only biomedical paper",
  }],
  civil_work_assets: [{
    asset_id: assetId,
    work_id: workId,
    source_catalog_id: "tci_thaijo:fixture-db-only",
    provider: "tci_thaijo",
    provider_asset_id: "thaijo-bscm-279251-pdf",
    asset_kind: "fulltext_pdf",
    version_kind: "version_of_record",
    origin_url: "https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/download/279251/192183",
    storage_object_path: null,
    mime_type: "application/pdf",
    language: "en",
    content_sha256: assetHash,
    page_count: 1,
    license_expression: "CC-BY-4.0",
    rights_status: "open_license_verified",
    rights_actions: {
      asset_storage: true,
      text_extraction: true,
      native_fulltext_display: true,
      annotation: true,
      user_download: true,
      translation: true,
    },
    rights_provenance: {
      basis: "item_level_license_and_official_publisher_pdf",
      source: "https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/279251",
    },
    rights_checked_at: "2026-09-01T23:00:00Z",
    rights_verified_at: "2026-09-01T23:00:00Z",
    reader_access_mode: "native_verified",
    access_notes: "Biomedical content is provided for research and evidence review, not clinical advice.",
    asset_status: "active",
    updated_at: "2026-09-01T23:00:00Z",
  }],
  civil_fulltext_pages: [{
    page_id: "db-page-1",
    asset_id: assetId,
    page_number: 1,
    page_label: "1",
    source_text: pageText,
    source_text_sha256: pageHash,
    source_locator: { section_title: "Abstract" },
    extraction_provenance: { method: "pdftotext-layout", source_asset_sha256: assetHash },
    ocr_confidence: null,
  }],
};

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.minimums = [];
    this.maximum = Infinity;
  }
  select() { return this; }
  eq(field, value) { this.filters.push([field, value]); return this; }
  neq(field, value) { this.filters.push([field, value, true]); return this; }
  gte(field, value) { this.minimums.push([field, value]); return this; }
  order() { return this; }
  limit(value) { this.maximum = value; return this; }
  then(resolve, reject) {
    databaseQueries += 1;
    const data = (rows[this.table] ?? [])
      .filter((row) => this.filters.every(([field, value, inverse]) => inverse ? row[field] !== value : row[field] === value))
      .filter((row) => this.minimums.every(([field, value]) => row[field] >= value))
      .slice(0, this.maximum);
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

function loadModule() {
  const filename = join(testDirectory, "paper-reader.ts");
  const transpiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const testRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@supabase/supabase-js") {
      return { createClient: () => ({ from: (table) => new Query(table) }) };
    }
    if (specifier === "./rights-reviewed-reader-papers") {
      return { findRightsReviewedReaderPaper: () => null };
    }
    return nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", transpiled)(
    testRequire,
    module,
    module.exports,
    filename,
    testDirectory,
  );
  return module.exports;
}

test("paper reader serves a Supabase-only native paper with exact-page evidence", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "server-only-test-key";
  try {
    const reader = loadModule();
    const payload = await reader.getPaperReader({ source, provider: "tci_thaijo", page: 1, limit: 2 });
    assert.ok(databaseQueries > 0);
    assert.equal(payload.access.mode, "native_verified");
    assert.equal(payload.pages.length, 1);
    assert.equal(payload.pages[0].textSha256, pageHash);
    assert.equal(payload.pages[0].anchor, `asset:${assetId}:page:1`);
    assert.equal(payload.citation.evidenceBoundary, "exact_page_verified");
    assert.match(payload.access.instructions, /not clinical advice/i);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});
