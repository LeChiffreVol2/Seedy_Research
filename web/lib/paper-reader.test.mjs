import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
let activeFixture = fixturePapers[0];

function loadPaperReaderModule() {
  const filename = join(testDirectory, "paper-reader.ts");
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
      return { createClient: () => { throw new Error("database access is forbidden in fixture unit tests"); } };
    }
    if (specifier === "server-only") return {};
    if (specifier === "./rights-reviewed-reader-papers") {
      return {
        findRightsReviewedReaderPaper: (source) => {
          const normalized = source.trim().toLowerCase();
          const identities = [
            activeFixture.source,
            activeFixture.providerRecordId,
            activeFixture.asset.id,
            activeFixture.sourceUrl,
            activeFixture.asset.originUrl,
            activeFixture.doi,
            `doi:${activeFixture.doi}`,
            ...activeFixture.aliases,
          ].map((value) => value.toLowerCase());
          return identities.includes(normalized) ? activeFixture : null;
        },
      };
    }
    return nodeRequire(specifier);
  };
  const execute = new Function("require", "module", "exports", "__filename", "__dirname", transpiled);
  execute(testRequire, module, module.exports, filename, testDirectory);
  return module.exports;
}

const reader = loadPaperReaderModule();

function assetRow(paper, overrides = {}) {
  return {
    asset_id: paper.asset.id,
    work_id: `reader-pack:${paper.source}`,
    source_catalog_id: null,
    provider: paper.provider,
    provider_asset_id: paper.providerRecordId,
    asset_kind: paper.asset.kind,
    version_kind: paper.asset.version,
    origin_url: paper.asset.originUrl,
    mime_type: paper.asset.mimeType,
    language: paper.asset.language,
    content_sha256: paper.asset.contentSha256,
    page_count: paper.asset.pageCount,
    license_expression: paper.asset.licenseExpression,
    rights_status: paper.asset.rightsStatus,
    rights_actions: { ...paper.asset.rightsActions },
    rights_provenance: { ...paper.asset.rightsProvenance },
    rights_checked_at: paper.asset.rightsCheckedAt,
    rights_verified_at: paper.asset.rightsVerifiedAt,
    reader_access_mode: paper.asset.readerAccessMode,
    access_notes: null,
    asset_status: "active",
    storage_object_path: `committed-reader-pack/${paper.pagesFile}`,
    ...overrides,
  };
}

test("rights-reviewed reader pack has verified actions and exact page hashes", () => {
  assert.equal(manifest.version, "civilmcp-rights-reviewed-reader-pack-v1");
  assert.equal(fixturePapers.length, 3);
  for (const paper of fixturePapers) {
    assert.equal(paper.asset.rightsStatus, "open_license_verified");
    assert.equal(paper.asset.readerAccessMode, "native_verified");
    assert.equal(paper.asset.rightsActions.asset_storage, true);
    assert.equal(paper.asset.rightsActions.text_extraction, true);
    assert.equal(paper.asset.rightsActions.native_fulltext_display, true);
    assert.equal(paper.pages.length, paper.asset.pageCount);
    for (const page of paper.pages) {
      assert.equal(createHash("sha256").update(page.text, "utf8").digest("hex"), page.textSha256);
    }
  }
});

test("nativeRightsGate requires every display, extraction, provenance and integrity field", () => {
  const paper = fixturePapers[0];
  assert.deepEqual(reader.nativeRightsGate(assetRow(paper)), {
    passed: true,
    reason: "asset_rights_and_integrity_verified",
  });

  for (const deniedAction of ["asset_storage", "text_extraction", "native_fulltext_display"]) {
    const denied = assetRow(paper, {
      rights_actions: { ...paper.asset.rightsActions, [deniedAction]: false },
    });
    assert.equal(reader.nativeRightsGate(denied).passed, false, `${deniedAction} must fail closed`);
  }
  assert.equal(reader.nativeRightsGate(assetRow(paper, { rights_provenance: {} })).passed, false);
  assert.equal(reader.nativeRightsGate(assetRow(paper, { rights_verified_at: "invalid" })).passed, false);
  assert.equal(reader.nativeRightsGate(assetRow(paper, { content_sha256: null })).passed, false);
  assert.equal(reader.nativeRightsGate(assetRow(paper, { license_expression: null })).passed, false);
});

test("fixture reader returns stable native page anchors without database credentials", async () => {
  activeFixture = fixturePapers[0];
  const payload = await reader.getPaperReader({ source: activeFixture.source, page: 1, limit: 2 });
  assert.equal(payload.version, "civilmcp.reader.v1");
  assert.equal(payload.access.mode, "native_verified");
  assert.equal(payload.pages.length, 2);
  assert.equal(payload.pages[0].anchor, `asset:${activeFixture.asset.id}:page:1`);
  assert.equal(payload.pages[0].textSha256, activeFixture.pages[0].textSha256);
  assert.equal(payload.capabilities.search, true);
  assert.equal(payload.capabilities.citation, true);
  assert.equal(payload.citation.evidenceBoundary, "exact_page_verified");
  assert.equal(payload.pagination.hasMore, true);
});

test("a fixture with revoked native display returns no page text", async () => {
  const valid = fixturePapers[0];
  activeFixture = {
    ...valid,
    asset: {
      ...valid.asset,
      rightsActions: { ...valid.asset.rightsActions, native_fulltext_display: false },
    },
  };
  const payload = await reader.getPaperReader({ source: activeFixture.source, page: 1, limit: 2 });
  assert.equal(payload.access.mode, "source_hosted");
  assert.deepEqual(payload.pages, []);
  assert.equal(payload.capabilities.search, false);
  assert.equal(payload.capabilities.citation, false);
  assert.equal(payload.citation.evidenceBoundary, "metadata_only");
});

test("non-native reader modes never expose committed page text", async () => {
  const valid = fixturePapers[0];
  const cases = [
    {
      expected: "restricted",
      asset: {
        ...valid.asset,
        readerAccessMode: "restricted",
        rightsStatus: "restricted_verified",
        rightsActions: Object.fromEntries(Object.keys(valid.asset.rightsActions).map((key) => [key, false])),
      },
    },
    {
      expected: "metadata_only",
      asset: {
        ...valid.asset,
        readerAccessMode: "metadata_only",
        rightsStatus: "unverified",
        rightsActions: Object.fromEntries(Object.keys(valid.asset.rightsActions).map((key) => [key, false])),
      },
    },
    {
      expected: "unavailable",
      asset: {
        ...valid.asset,
        readerAccessMode: "removed",
        rightsStatus: "withdrawn",
        rightsActions: Object.fromEntries(Object.keys(valid.asset.rightsActions).map((key) => [key, false])),
      },
    },
  ];
  for (const scenario of cases) {
    activeFixture = { ...valid, asset: scenario.asset };
    const payload = await reader.getPaperReader({ source: activeFixture.source, page: 1, limit: 2 });
    assert.equal(payload.access.mode, scenario.expected);
    assert.deepEqual(payload.pages, []);
    assert.equal(payload.citation.evidenceBoundary, "metadata_only");
  }
});
