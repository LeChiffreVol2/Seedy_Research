import { createHash } from "node:crypto";

import "server-only";

import pages291543Data from "../data/reader-papers/291543.pages.json";
import pages291567Data from "../data/reader-papers/291567.pages.json";
import pages291631Data from "../data/reader-papers/291631.pages.json";
import manifestData from "../data/reader-papers/manifest.json";

export type RightsReviewedReaderPage = Readonly<{
  id: string;
  pageNumber: number;
  pageLabel: string;
  anchor: string;
  sectionTitle: string;
  text: string;
  textSha256: string;
}>;

export type RightsReviewedReaderPaper = Readonly<{
  source: string;
  aliases: readonly string[];
  provider: string;
  providerRecordId: string;
  title: string;
  authors: readonly string[];
  doi: string;
  publishedAt: string;
  journalTitle: string;
  publisher: string;
  sourceUrl: string;
  asset: Readonly<{
    id: string;
    kind: string;
    version: string;
    mimeType: string;
    language: string;
    pageCount: number;
    contentSha256: string;
    originUrl: string;
    licenseExpression: string;
    licenseUrl: string;
    rightsStatus: string;
    rightsActions: Readonly<Record<string, boolean>>;
    rightsProvenance: Readonly<Record<string, string>>;
    rightsCheckedAt: string;
    rightsVerifiedAt: string;
    readerAccessMode: string;
  }>;
  pagesFile: string;
  pages: readonly RightsReviewedReaderPage[];
}>;

type PagesFile = {
  version: string;
  source: string;
  pages: RightsReviewedReaderPage[];
};

const EXPECTED_MANIFEST_VERSION = "civilmcp-rights-reviewed-reader-pack-v1";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_PATTERN = /^[A-Za-z0-9_.:-]{3,255}$/;
const pagesByFile: Record<string, PagesFile> = {
  "291543.pages.json": pages291543Data as PagesFile,
  "291567.pages.json": pages291567Data as PagesFile,
  "291631.pages.json": pages291631Data as PagesFile,
};

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function verifiedDates(checkedValue: string, verifiedValue: string): boolean {
  const checkedAt = new Date(checkedValue).getTime();
  const verifiedAt = new Date(verifiedValue).getTime();
  return Number.isFinite(checkedAt) && Number.isFinite(verifiedAt) && verifiedAt >= checkedAt;
}

function assertFixturePaper(raw: (typeof manifestData.papers)[number]): RightsReviewedReaderPaper {
  const pagesFile = pagesByFile[raw.pagesFile];
  if (!SOURCE_PATTERN.test(raw.source) || !pagesFile || pagesFile.source !== raw.source) {
    throw new Error(`Reader fixture identity is invalid for ${raw.source}.`);
  }
  if (!raw.aliases.includes(raw.providerRecordId) || !validHttpUrl(raw.sourceUrl) || !validHttpUrl(raw.asset.originUrl)) {
    throw new Error(`Reader fixture provenance is invalid for ${raw.source}.`);
  }
  if (
    raw.asset.readerAccessMode !== "native_verified"
    || raw.asset.rightsStatus !== "open_license_verified"
    || !raw.asset.licenseExpression
    || !validHttpUrl(raw.asset.licenseUrl)
    || !validHttpUrl(raw.asset.rightsProvenance.source)
    || !raw.asset.rightsProvenance.basis
    || !verifiedDates(raw.asset.rightsCheckedAt, raw.asset.rightsVerifiedAt)
    || !SHA256_PATTERN.test(raw.asset.contentSha256)
    || raw.asset.rightsActions.asset_storage !== true
    || raw.asset.rightsActions.text_extraction !== true
    || raw.asset.rightsActions.native_fulltext_display !== true
  ) {
    throw new Error(`Reader fixture rights gate failed for ${raw.source}.`);
  }
  if (pagesFile.pages.length !== raw.asset.pageCount || pagesFile.pages.length < 1) {
    throw new Error(`Reader fixture page count is invalid for ${raw.source}.`);
  }
  const seenNumbers = new Set<number>();
  for (const page of pagesFile.pages) {
    const actualHash = createHash("sha256").update(page.text, "utf8").digest("hex");
    if (
      !page.id
      || !Number.isInteger(page.pageNumber)
      || page.pageNumber < 1
      || seenNumbers.has(page.pageNumber)
      || !page.text
      || !SHA256_PATTERN.test(page.textSha256)
      || actualHash !== page.textSha256
    ) {
      throw new Error(`Reader fixture page integrity failed for ${raw.source} page ${page.pageNumber}.`);
    }
    seenNumbers.add(page.pageNumber);
  }
  return Object.freeze({
    ...raw,
    aliases: Object.freeze([...raw.aliases]),
    authors: Object.freeze([...raw.authors]),
    asset: Object.freeze({
      ...raw.asset,
      rightsActions: Object.freeze({ ...raw.asset.rightsActions }),
      rightsProvenance: Object.freeze({ ...raw.asset.rightsProvenance }),
    }),
    pages: Object.freeze(pagesFile.pages.map((page) => Object.freeze({ ...page }))),
  });
}

if (manifestData.version !== EXPECTED_MANIFEST_VERSION) {
  throw new Error("Reader fixture manifest version is not supported.");
}

const RIGHTS_REVIEWED_READER_PAPERS = Object.freeze(manifestData.papers.map(assertFixturePaper));
const readerPaperIndex = new Map<string, RightsReviewedReaderPaper>();
for (const paper of RIGHTS_REVIEWED_READER_PAPERS) {
  const identities = [
    paper.source,
    paper.providerRecordId,
    paper.asset.id,
    paper.sourceUrl,
    paper.asset.originUrl,
    paper.doi,
    `doi:${paper.doi}`,
    ...paper.aliases,
  ];
  for (const identity of identities) {
    readerPaperIndex.set(identity.trim(), paper);
    readerPaperIndex.set(identity.trim().toLocaleLowerCase("en"), paper);
  }
}

/**
 * Returns the committed rights-reviewed pack without requiring database or
 * network credentials. Objects are frozen after manifest and page-hash checks.
 */
export function listRightsReviewedReaderPapers(): readonly RightsReviewedReaderPaper[] {
  return RIGHTS_REVIEWED_READER_PAPERS;
}

/** Resolves canonical IDs, provider IDs, DOI forms, article URLs and PDF URLs. */
export function findRightsReviewedReaderPaper(source: string): RightsReviewedReaderPaper | null {
  const identity = source.trim();
  if (!identity) return null;
  return readerPaperIndex.get(identity) ?? readerPaperIndex.get(identity.toLocaleLowerCase("en")) ?? null;
}
