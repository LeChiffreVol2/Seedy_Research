import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import "server-only";

import {
  findRightsReviewedReaderPaper,
  type RightsReviewedReaderPaper,
} from "./rights-reviewed-reader-papers";

export const PAPER_READER_VERSION = "civilmcp.reader.v1" as const;

export type ReaderMode =
  | "native_verified"
  | "source_hosted"
  | "restricted"
  | "metadata_only"
  | "unavailable";

export type ReaderCapabilities = {
  search: boolean;
  annotation: boolean;
  citation: boolean;
  download: boolean;
  translation: boolean;
};

export type ReaderPage = {
  id: string;
  assetId: string;
  pageNumber: number;
  pageLabel: string;
  anchor: string;
  sectionTitle: string | null;
  text: string;
  textSha256: string;
  sourceLocator: Record<string, unknown>;
  ocrConfidence: number | null;
};

export type ReaderAsset = {
  id: string;
  kind: string;
  version: string;
  mode: ReaderMode;
  accessMethod: "native" | "link_out" | "institution" | "metadata" | "unavailable";
  sourceUrl: string | null;
  mimeType: string | null;
  language: string | null;
  pageCount: number | null;
  rights: {
    status: string;
    licenseExpression: string | null;
    verifiedAt: string | null;
    provenance: {
      basis: string | null;
      source: string | null;
    };
  };
  capabilities: ReaderCapabilities;
  pageContentAvailable: boolean;
  reason: string;
};

export type PaperReaderResponse = {
  version: typeof PAPER_READER_VERSION;
  source: string;
  paper: {
    id: string;
    workId: string | null;
    source: string;
    provider: string;
    title: string;
    sourceUrl: string | null;
  };
  access: {
    mode: ReaderMode;
    statusLabel: string;
    reason: string;
    sourceUrl: string | null;
    licenseExpression: string | null;
    rightsVerifiedAt: string | null;
    instructions: string;
    institution: string | null;
  };
  asset: ReaderAsset | null;
  assets: ReaderAsset[];
  pages: ReaderPage[];
  outline: Array<{
    id: string;
    title: string;
    pageNumber: number;
    pageLabel: string;
    anchor: string;
  }>;
  capabilities: ReaderCapabilities;
  citation: {
    workId: string | null;
    title: string;
    provider: string;
    assetId: string | null;
    sourceUrl: string | null;
    evidenceBoundary: "exact_page_verified" | "metadata_only";
  };
  pagination: {
    assetId: string | null;
    page: number;
    limit: number;
    returned: number;
    hasMore: boolean;
    totalPages: number | null;
  };
  generatedAt: string;
};

export type PaperReaderRequest = {
  source: string;
  provider?: string | null;
  assetId?: string | null;
  page?: number;
  limit?: number;
};

type DocumentRow = {
  id: string;
  source: string;
  source_pdf?: string | null;
  paper_code?: string | null;
  collection?: string | null;
};

type CatalogRow = {
  id: string;
  work_id?: string | null;
  provider: string;
  provider_record_id: string;
  title_local?: string | null;
  title_en?: string | null;
  canonical_url?: string | null;
  pdf_url?: string | null;
  publisher?: string | null;
  journal_title?: string | null;
  license?: string | null;
  rights_status: string;
  access_level: string;
  evidence_status: string;
  document_id?: string | null;
  updated_at?: string | null;
};

type WorkRow = {
  work_id: string;
  canonical_key: string;
  title_local?: string | null;
  title_en?: string | null;
};

type AssetRow = {
  asset_id: string;
  work_id: string;
  source_catalog_id?: string | null;
  provider: string;
  provider_asset_id: string;
  asset_kind: string;
  version_kind: string;
  origin_url?: string | null;
  mime_type?: string | null;
  language?: string | null;
  content_sha256?: string | null;
  page_count?: number | null;
  license_expression?: string | null;
  rights_status: string;
  rights_actions?: unknown;
  rights_provenance?: unknown;
  rights_checked_at?: string | null;
  rights_verified_at?: string | null;
  reader_access_mode: string;
  access_notes?: string | null;
  asset_status: string;
  storage_object_path?: string | null;
  updated_at?: string | null;
};

type FulltextPageRow = {
  page_id: string;
  asset_id: string;
  page_number: number;
  page_label?: string | null;
  source_text: string;
  source_text_sha256: string;
  source_locator?: unknown;
  extraction_provenance?: unknown;
  ocr_confidence?: number | string | null;
};

type NormalizedAsset = {
  public: ReaderAsset;
  row: AssetRow | null;
  nativeGatePassed: boolean;
  nativeGateReason: string;
  accessNotes: string | null;
};

type ResolvedPaper = {
  document: DocumentRow | null;
  catalog: CatalogRow | null;
  work: WorkRow | null;
  assets: AssetRow[];
  fixture: RightsReviewedReaderPaper | null;
};

const DOCUMENT_SELECT = "id,source,source_pdf,paper_code,collection";
const CATALOG_SELECT = "id,work_id,provider,provider_record_id,title_local,title_en,canonical_url,pdf_url,publisher,journal_title,license,rights_status,access_level,evidence_status,document_id,updated_at";
const CATALOG_SELECT_LEGACY = "id,provider,provider_record_id,title_local,title_en,canonical_url,pdf_url,publisher,journal_title,license,rights_status,access_level,evidence_status,document_id,updated_at";
const WORK_SELECT = "work_id,canonical_key,title_local,title_en";
const ASSET_SELECT = "asset_id,work_id,source_catalog_id,provider,provider_asset_id,asset_kind,version_kind,origin_url,mime_type,language,content_sha256,page_count,license_expression,rights_status,rights_actions,rights_provenance,rights_checked_at,rights_verified_at,reader_access_mode,access_notes,asset_status,storage_object_path,updated_at";
const PAGE_SELECT = "page_id,asset_id,page_number,page_label,source_text,source_text_sha256,source_locator,extraction_provenance,ocr_confidence";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_ASSET_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_PATTERN = /^[a-z0-9_:-]{1,100}$/;
const MAX_SOURCE_CHARS = 2_048;
const MAX_PAGE_TEXT_CHARS = 250_000;
const MAX_RESPONSE_TEXT_CHARS = 1_500_000;
const NATIVE_ASSET_KINDS = new Set(["fulltext_html", "fulltext_pdf", "accepted_manuscript", "preprint"]);
const VERIFIED_RIGHTS_STATUSES = new Set(["open_license_verified", "permission_granted"]);

let supabaseAdminSingleton: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for the paper reader.");
  }
  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
  return supabaseAdminSingleton;
}

export class PaperReaderRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PaperReaderRequestError";
    this.status = status;
    this.code = code;
  }
}

function missingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = (error?.code ?? "").toUpperCase();
  const message = (error?.message ?? "").toLowerCase();
  return code === "PGRST204" || code === "PGRST205" || code === "42P01" || code === "42703"
    || message.includes("schema cache")
    || message.includes("does not exist");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedText(value: unknown, maxChars = 500): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxChars) : null;
}

function publicHttpUrl(value: unknown): string | null {
  const text = boundedText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function decodeSource(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new PaperReaderRequestError(400, "invalid_source", "Paper source is not valid URL encoding.");
  }
  const cleaned = decoded.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!cleaned || cleaned.length > MAX_SOURCE_CHARS) {
    throw new PaperReaderRequestError(400, "invalid_source", "Paper source must be between 1 and 2048 characters.");
  }
  return cleaned;
}

function validateProvider(value: string | null | undefined): string | null {
  const provider = value?.trim() ?? "";
  if (!provider) return null;
  if (!PROVIDER_PATTERN.test(provider)) {
    throw new PaperReaderRequestError(400, "invalid_provider", "Provider is not valid.");
  }
  return provider;
}

function action(actions: unknown, name: string): boolean {
  return asRecord(actions)[name] === true;
}

function provenanceFields(value: unknown): { basis: string | null; source: string | null; gateSource: string | null } {
  const provenance = asRecord(value);
  const basis = boundedText(provenance.basis, 300);
  const rawSource = boundedText(provenance.source, 2_048);
  return {
    basis,
    source: publicHttpUrl(rawSource),
    gateSource: rawSource,
  };
}

function validVerificationWindow(asset: AssetRow): boolean {
  if (!asset.rights_checked_at || !asset.rights_verified_at) return false;
  const checkedAt = new Date(asset.rights_checked_at).getTime();
  const verifiedAt = new Date(asset.rights_verified_at).getTime();
  return Number.isFinite(checkedAt) && Number.isFinite(verifiedAt) && verifiedAt >= checkedAt;
}

export function nativeRightsGate(asset: AssetRow): { passed: boolean; reason: string } {
  const failures: string[] = [];
  const provenance = provenanceFields(asset.rights_provenance);
  if (asset.asset_status !== "active") failures.push("asset_not_active");
  if (asset.reader_access_mode !== "native_verified") failures.push("mode_not_native_verified");
  if (!NATIVE_ASSET_KINDS.has(asset.asset_kind)) failures.push("asset_kind_not_fulltext");
  if (!VERIFIED_RIGHTS_STATUSES.has(asset.rights_status)) failures.push("rights_not_verified");
  if (asset.rights_status === "open_license_verified" && !boundedText(asset.license_expression, 255)) {
    failures.push("license_expression_missing");
  }
  if (!validVerificationWindow(asset)) failures.push("rights_dates_invalid");
  if (!provenance.basis || !provenance.gateSource) failures.push("rights_provenance_missing");
  if (!action(asset.rights_actions, "asset_storage")) failures.push("asset_storage_denied");
  if (!action(asset.rights_actions, "text_extraction")) failures.push("text_extraction_denied");
  if (!action(asset.rights_actions, "native_fulltext_display")) failures.push("native_display_denied");
  if (!SHA256_PATTERN.test(asset.content_sha256 ?? "")) failures.push("asset_checksum_missing");
  if (!asset.origin_url && !asset.storage_object_path) failures.push("asset_location_missing");
  return {
    passed: failures.length === 0,
    reason: failures.length ? `native_gate_failed:${failures.join(",")}` : "asset_rights_and_integrity_verified",
  };
}

function emptyCapabilities(): ReaderCapabilities {
  return { search: false, annotation: false, citation: false, download: false, translation: false };
}

function capabilitiesForAsset(asset: AssetRow, nativeGatePassed: boolean): ReaderCapabilities {
  if (!nativeGatePassed) return emptyCapabilities();
  return {
    search: true,
    annotation: action(asset.rights_actions, "annotation"),
    citation: true,
    download: action(asset.rights_actions, "user_download"),
    translation: action(asset.rights_actions, "translation"),
  };
}

function effectiveMode(asset: AssetRow, gate: { passed: boolean; reason: string }): { mode: ReaderMode; reason: string } {
  const sourceUrl = publicHttpUrl(asset.origin_url);
  if (asset.asset_status === "removed" || asset.rights_status === "withdrawn" || asset.reader_access_mode === "removed") {
    return { mode: "unavailable", reason: "asset_removed_or_rights_withdrawn" };
  }
  if (asset.asset_status === "unavailable") return { mode: "unavailable", reason: "asset_reported_unavailable" };
  if (gate.passed) return { mode: "native_verified", reason: gate.reason };
  if (asset.reader_access_mode === "restricted" || asset.rights_status === "restricted_verified") {
    return { mode: "restricted", reason: "official_access_requires_institution_or_account" };
  }
  if ((asset.reader_access_mode === "external_access" || asset.reader_access_mode === "publisher_embed") && sourceUrl) {
    return {
      mode: "source_hosted",
      reason: asset.reader_access_mode === "publisher_embed"
        ? "publisher_link_available_native_gate_not_used"
        : "full_text_remains_at_official_source",
    };
  }
  if (asset.reader_access_mode === "native_verified") {
    return { mode: sourceUrl ? "source_hosted" : "metadata_only", reason: gate.reason };
  }
  return { mode: "metadata_only", reason: "no_verified_fulltext_display_mode" };
}

function normalizeAsset(asset: AssetRow): NormalizedAsset {
  const gate = nativeRightsGate(asset);
  const effective = effectiveMode(asset, gate);
  const rightsProvenance = provenanceFields(asset.rights_provenance);
  const capabilities = capabilitiesForAsset(asset, gate.passed);
  const sourceUrl = publicHttpUrl(asset.origin_url);
  const accessMethod: ReaderAsset["accessMethod"] = effective.mode === "native_verified"
    ? "native"
    : effective.mode === "source_hosted"
      ? "link_out"
      : effective.mode === "restricted"
        ? "institution"
        : effective.mode === "unavailable"
          ? "unavailable"
          : "metadata";
  return {
    public: {
      id: asset.asset_id,
      kind: asset.asset_kind,
      version: asset.version_kind,
      mode: effective.mode,
      accessMethod,
      sourceUrl,
      mimeType: boundedText(asset.mime_type, 120),
      language: boundedText(asset.language, 35),
      pageCount: Number.isInteger(asset.page_count) && Number(asset.page_count) > 0 ? Number(asset.page_count) : null,
      rights: {
        status: asset.rights_status,
        licenseExpression: boundedText(asset.license_expression, 255),
        verifiedAt: validVerificationWindow(asset) ? asset.rights_verified_at ?? null : null,
        provenance: {
          basis: rightsProvenance.basis,
          source: rightsProvenance.source,
        },
      },
      capabilities,
      pageContentAvailable: gate.passed,
      reason: effective.reason,
    },
    row: asset,
    nativeGatePassed: gate.passed,
    nativeGateReason: gate.reason,
    accessNotes: boundedText(asset.access_notes, 1_000),
  };
}

function legacyAsset(catalog: CatalogRow | null, document: DocumentRow | null): NormalizedAsset {
  const sourceUrl = publicHttpUrl(catalog?.canonical_url) ?? publicHttpUrl(catalog?.pdf_url);
  let mode: ReaderMode = "metadata_only";
  let reason = "asset_level_rights_not_yet_resolved";
  if (catalog?.rights_status === "removed" || catalog?.evidence_status === "removed") {
    mode = "unavailable";
    reason = "source_record_removed";
  } else if (catalog?.rights_status === "restricted" || catalog?.access_level === "restricted") {
    mode = "restricted";
    reason = "official_access_requires_institution_or_account";
  } else if (sourceUrl) {
    mode = "source_hosted";
    reason = "official_source_link_only_asset_rights_unresolved";
  }
  const provider = catalog?.provider ?? (document?.collection === "ce_project" ? "student_transport_projects" : "ncce");
  const id = `catalog:${catalog?.id ?? `${provider}:${document?.id ?? "unknown"}`}`;
  return {
    public: {
      id,
      kind: "metadata_record",
      version: "unknown",
      mode,
      accessMethod: mode === "source_hosted" ? "link_out" : mode === "restricted" ? "institution" : mode === "unavailable" ? "unavailable" : "metadata",
      sourceUrl,
      mimeType: null,
      language: null,
      pageCount: null,
      rights: {
        status: catalog?.rights_status ?? "unverified",
        licenseExpression: boundedText(catalog?.license, 255),
        verifiedAt: null,
        provenance: { basis: "legacy_catalog_record_only", source: sourceUrl },
      },
      capabilities: emptyCapabilities(),
      pageContentAvailable: false,
      reason,
    },
    row: null,
    nativeGatePassed: false,
    nativeGateReason: "no_asset_level_rights_manifest",
    accessNotes: null,
  };
}

async function findDocument(source: string): Promise<DocumentRow | null> {
  const supabase = getSupabaseAdmin() as any;
  for (const field of ["source", "source_pdf", "paper_code"] as const) {
    const result = await supabase.from("civil_documents_v2").select(DOCUMENT_SELECT).eq(field, source).limit(1);
    if (result.error) throw new Error(`Failed to resolve reader document: ${result.error.message}`);
    if (result.data?.[0]) return result.data[0] as DocumentRow;
  }
  return null;
}

async function catalogQuery(field: "id" | "provider_record_id" | "document_id" | "canonical_url", value: string, provider: string | null): Promise<CatalogRow[]> {
  const supabase = getSupabaseAdmin() as any;
  const run = async (select: string) => {
    let query = supabase.from("civil_source_catalog").select(select).eq(field, value).neq("evidence_status", "removed");
    if (provider) query = query.eq("provider", provider);
    return query.order("updated_at", { ascending: false, nullsFirst: false }).limit(2);
  };
  let result = await run(CATALOG_SELECT);
  if (result.error && missingSchema(result.error)) result = await run(CATALOG_SELECT_LEGACY);
  if (result.error) throw new Error(`Failed to resolve reader catalog record: ${result.error.message}`);
  return (result.data ?? []) as CatalogRow[];
}

async function findCatalog(source: string, provider: string | null, document: DocumentRow | null): Promise<CatalogRow | null> {
  const attempts: Array<["id" | "provider_record_id" | "document_id" | "canonical_url", string]> = [
    ["id", source],
    ["provider_record_id", source],
  ];
  if (document?.id) attempts.push(["document_id", document.id]);
  if (publicHttpUrl(source)) attempts.push(["canonical_url", source]);
  for (const [field, value] of attempts) {
    const rows = await catalogQuery(field, value, provider);
    if (rows.length > 1 && !provider) {
      throw new PaperReaderRequestError(409, "ambiguous_source", "Paper source matches more than one provider; pass the provider query parameter.");
    }
    if (rows[0]) return rows[0];
  }
  return null;
}

async function findWork(workId: string | null, source: string): Promise<WorkRow | null> {
  const supabase = getSupabaseAdmin() as any;
  let result = workId
    ? await supabase.from("civil_works").select(WORK_SELECT).eq("work_id", workId).limit(1)
    : await supabase.from("civil_works").select(WORK_SELECT).eq("canonical_key", source).limit(1);
  if (result.error && missingSchema(result.error)) return null;
  if (result.error) throw new Error(`Failed to resolve canonical work: ${result.error.message}`);
  return (result.data?.[0] ?? null) as WorkRow | null;
}

async function queryAssets(field: "work_id" | "source_catalog_id" | "provider_asset_id" | "asset_id", value: string, provider: string | null): Promise<AssetRow[]> {
  const supabase = getSupabaseAdmin() as any;
  let query = supabase.from("civil_work_assets").select(ASSET_SELECT).eq(field, value).order("updated_at", { ascending: false }).limit(50);
  if (provider) query = query.eq("provider", provider);
  const result = await query;
  if (result.error && missingSchema(result.error)) return [];
  if (result.error) throw new Error(`Failed to resolve reader assets: ${result.error.message}`);
  return (result.data ?? []) as AssetRow[];
}

async function findAssets(workId: string | null, catalogId: string | null, source: string, provider: string | null): Promise<AssetRow[]> {
  const groups: AssetRow[][] = [];
  if (workId) groups.push(await queryAssets("work_id", workId, provider));
  if (catalogId) groups.push(await queryAssets("source_catalog_id", catalogId, provider));
  if (!groups.some((rows) => rows.length)) groups.push(await queryAssets("provider_asset_id", source, provider));
  if (UUID_PATTERN.test(source)) groups.push(await queryAssets("asset_id", source, provider));
  const seen = new Set<string>();
  return groups.flat().filter((asset) => {
    if (seen.has(asset.asset_id)) return false;
    seen.add(asset.asset_id);
    return true;
  });
}

async function resolvePaper(source: string, provider: string | null): Promise<ResolvedPaper | null> {
  const fixture = findRightsReviewedReaderPaper(source);
  if (fixture) {
    if (provider && fixture.provider !== provider) return null;
    const asset: AssetRow = {
      asset_id: fixture.asset.id,
      work_id: `reader-pack:${fixture.source}`,
      source_catalog_id: null,
      provider: fixture.provider,
      provider_asset_id: fixture.providerRecordId,
      asset_kind: fixture.asset.kind,
      version_kind: fixture.asset.version,
      origin_url: fixture.asset.originUrl,
      mime_type: fixture.asset.mimeType,
      language: fixture.asset.language,
      content_sha256: fixture.asset.contentSha256,
      page_count: fixture.asset.pageCount,
      license_expression: fixture.asset.licenseExpression,
      rights_status: fixture.asset.rightsStatus,
      rights_actions: fixture.asset.rightsActions,
      rights_provenance: fixture.asset.rightsProvenance,
      rights_checked_at: fixture.asset.rightsCheckedAt,
      rights_verified_at: fixture.asset.rightsVerifiedAt,
      reader_access_mode: fixture.asset.readerAccessMode,
      access_notes: null,
      asset_status: "active",
      storage_object_path: `committed-reader-pack/${fixture.pagesFile}`,
      updated_at: fixture.asset.rightsVerifiedAt,
    };
    return {
      document: null,
      catalog: {
        id: `reader-pack:${fixture.source}`,
        work_id: asset.work_id,
        provider: fixture.provider,
        provider_record_id: fixture.providerRecordId,
        title_local: null,
        title_en: fixture.title,
        canonical_url: fixture.sourceUrl,
        pdf_url: fixture.asset.originUrl,
        publisher: fixture.publisher,
        journal_title: fixture.journalTitle,
        license: fixture.asset.licenseExpression,
        rights_status: fixture.asset.rightsStatus,
        access_level: "full_text_licensed",
        evidence_status: "indexed",
        document_id: null,
        updated_at: fixture.asset.rightsVerifiedAt,
      },
      work: {
        work_id: asset.work_id,
        canonical_key: fixture.source,
        title_local: null,
        title_en: fixture.title,
      },
      assets: [asset],
      fixture,
    };
  }
  const document = await findDocument(source);
  const catalog = await findCatalog(source, provider, document);
  let work = await findWork(catalog?.work_id ?? null, source);
  let assets = await findAssets(work?.work_id ?? catalog?.work_id ?? null, catalog?.id ?? null, source, provider);
  if (!work && assets[0]?.work_id) work = await findWork(assets[0].work_id, source);
  if (!assets.length && work?.work_id) assets = await findAssets(work.work_id, catalog?.id ?? null, source, provider);
  if (!document && !catalog && !work && !assets.length) return null;
  return { document, catalog, work, assets, fixture: null };
}

function pageSectionTitle(locatorValue: unknown): string | null {
  const locator = asRecord(locatorValue);
  const direct = boundedText(locator.section_title, 240);
  if (direct) return direct;
  if (Array.isArray(locator.section_path)) {
    return locator.section_path.map((part) => boundedText(part, 120)).filter(Boolean).join(" › ") || null;
  }
  return boundedText(locator.section_path, 240);
}

function committedSectionTitle(value: string | null | undefined): string | null {
  const title = boundedText(value, 120);
  if (!title || /^page\s+\d+$/i.test(title)) return null;
  const heading = title.replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim();
  return /^(?:abstract|introduction|background|literature review|related work|research questions?|methodology|methods?|materials and methods|results?|findings?|results? and discussion|discussion|limitations?|conclusions?|conclusion and recommendations?|acknowledgements?|references?|appendix|บทคัดย่อ|บทนำ|ทบทวนวรรณกรรม|ระเบียบวิธีวิจัย|วิธีดำเนินการวิจัย|ผลการวิจัย|ผลการศึกษา|อภิปรายผล|ข้อจำกัด|สรุป|ข้อเสนอแนะ|เอกสารอ้างอิง)$/i.test(heading)
    ? heading
    : null;
}

function validNativePage(row: FulltextPageRow, asset: AssetRow): boolean {
  if (!Number.isInteger(row.page_number) || row.page_number < 1) return false;
  if (!row.source_text || row.source_text.length > MAX_PAGE_TEXT_CHARS) return false;
  if (!SHA256_PATTERN.test(row.source_text_sha256)) return false;
  const actualHash = createHash("sha256").update(row.source_text, "utf8").digest("hex");
  if (actualHash !== row.source_text_sha256) return false;
  const extraction = asRecord(row.extraction_provenance);
  return extraction.source_asset_sha256 === asset.content_sha256 && Boolean(boundedText(extraction.method, 200));
}

async function fetchNativePages(asset: AssetRow, page: number, limit: number): Promise<{ pages: ReaderPage[]; hasMore: boolean; integrityFailed: boolean }> {
  const supabase = getSupabaseAdmin() as any;
  const result = await supabase
    .from("civil_fulltext_pages")
    .select(PAGE_SELECT)
    .eq("asset_id", asset.asset_id)
    .gte("page_number", page)
    .order("page_number", { ascending: true })
    .limit(limit + 1);
  if (result.error && missingSchema(result.error)) return { pages: [], hasMore: false, integrityFailed: false };
  if (result.error) throw new Error(`Failed to read verified paper pages: ${result.error.message}`);
  const rows = (result.data ?? []) as FulltextPageRow[];
  const window = rows.slice(0, limit);
  if (window.some((row) => !validNativePage(row, asset))) {
    return { pages: [], hasMore: rows.length > limit, integrityFailed: true };
  }
  let totalChars = 0;
  const pages: ReaderPage[] = [];
  for (const row of window) {
    if (totalChars + row.source_text.length > MAX_RESPONSE_TEXT_CHARS) break;
    totalChars += row.source_text.length;
    const anchor = `asset:${asset.asset_id}:page:${row.page_number}`;
    pages.push({
      id: row.page_id,
      assetId: row.asset_id,
      pageNumber: row.page_number,
      pageLabel: boundedText(row.page_label, 100) ?? `p.${row.page_number}`,
      anchor,
      sectionTitle: pageSectionTitle(row.source_locator),
      text: row.source_text,
      textSha256: row.source_text_sha256,
      sourceLocator: asRecord(row.source_locator),
      ocrConfidence: row.ocr_confidence == null || !Number.isFinite(Number(row.ocr_confidence))
        ? null
        : Number(row.ocr_confidence),
    });
  }
  return {
    pages,
    hasMore: rows.length > limit || pages.length < window.length,
    integrityFailed: false,
  };
}

function fetchFixturePages(
  fixture: RightsReviewedReaderPaper,
  asset: AssetRow,
  page: number,
  limit: number,
): { pages: ReaderPage[]; hasMore: boolean; integrityFailed: boolean } {
  const rows: FulltextPageRow[] = fixture.pages
    .filter((fixturePage) => fixturePage.pageNumber >= page)
    .slice(0, limit + 1)
    .map((fixturePage) => ({
      page_id: fixturePage.id,
      asset_id: asset.asset_id,
      page_number: fixturePage.pageNumber,
      page_label: fixturePage.pageLabel,
      source_text: fixturePage.text,
      source_text_sha256: fixturePage.textSha256,
      source_locator: {
        section_title: committedSectionTitle(fixturePage.sectionTitle),
        committed_anchor: fixturePage.anchor,
      },
      extraction_provenance: {
        method: "committed_rights_reviewed_page_extraction",
        source_asset_sha256: asset.content_sha256,
      },
      ocr_confidence: null,
    }));
  const window = rows.slice(0, limit);
  if (window.some((row) => !validNativePage(row, asset))) {
    return { pages: [], hasMore: rows.length > limit, integrityFailed: true };
  }
  const pages = window.map((row) => ({
    id: row.page_id,
    assetId: row.asset_id,
    pageNumber: row.page_number,
    pageLabel: boundedText(row.page_label, 100) ?? `p.${row.page_number}`,
    anchor: `asset:${asset.asset_id}:page:${row.page_number}`,
    sectionTitle: pageSectionTitle(row.source_locator),
    text: row.source_text,
    textSha256: row.source_text_sha256,
    sourceLocator: asRecord(row.source_locator),
    ocrConfidence: null,
  }));
  return { pages, hasMore: rows.length > limit, integrityFailed: false };
}

function preferredAsset(assets: NormalizedAsset[], requestedAssetId: string | null): NormalizedAsset | null {
  if (requestedAssetId) {
    const requested = assets.find((asset) => asset.public.id === requestedAssetId);
    if (!requested) throw new PaperReaderRequestError(404, "asset_not_found", "Requested reader asset was not found for this paper.");
    return requested;
  }
  const priority: Record<ReaderMode, number> = {
    native_verified: 0,
    source_hosted: 1,
    restricted: 2,
    metadata_only: 3,
    unavailable: 4,
  };
  return [...assets].sort((left, right) => priority[left.public.mode] - priority[right.public.mode])[0] ?? null;
}

function statusLabel(mode: ReaderMode): string {
  if (mode === "native_verified") return "Read in CivilMCP";
  if (mode === "source_hosted") return "Open at official source";
  if (mode === "restricted") return "Institutional access required";
  if (mode === "metadata_only") return "Metadata only";
  return "Full text unavailable";
}

function accessInstructions(mode: ReaderMode, custom: string | null): string {
  if (custom) return custom;
  if (mode === "native_verified") return "Read the rights-verified page text in CivilMCP and retain the page anchor with every citation.";
  if (mode === "source_hosted") return "Open the official source record. CivilMCP does not proxy or copy this full text.";
  if (mode === "restricted") return "Use the official institutional or account access path. CivilMCP does not bypass authentication or retain credentials.";
  if (mode === "metadata_only") return "No asset-level display and extraction permission has been verified. This record is a discovery lead, not page-citable evidence.";
  return "No active verified full-text asset is available. Use the source resolver or library request workflow.";
}

function outlineFromPages(pages: ReaderPage[]): PaperReaderResponse["outline"] {
  const seen = new Set<string>();
  return pages.flatMap((page) => {
    const title = page.sectionTitle ?? `Page ${page.pageLabel}`;
    if (seen.has(title)) return [];
    seen.add(title);
    return [{
      id: `outline:${page.id}`,
      title,
      pageNumber: page.pageNumber,
      pageLabel: page.pageLabel,
      anchor: page.anchor,
    }];
  });
}

export async function getPaperReader(request: PaperReaderRequest): Promise<PaperReaderResponse | null> {
  const source = decodeSource(request.source);
  const provider = validateProvider(request.provider);
  const requestedAssetId = request.assetId?.trim() || null;
  if (requestedAssetId && !UUID_PATTERN.test(requestedAssetId) && !PUBLIC_ASSET_ID_PATTERN.test(requestedAssetId)) {
    throw new PaperReaderRequestError(400, "invalid_asset", "Reader asset ID is not valid.");
  }
  const page = Number.isInteger(request.page) ? Math.max(1, Math.min(100_000, Number(request.page))) : 1;
  const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(10, Number(request.limit))) : 10;
  const resolved = await resolvePaper(source, provider);
  if (!resolved) return null;

  const normalizedAssets = resolved.assets.length
    ? resolved.assets.map(normalizeAsset)
    : [legacyAsset(resolved.catalog, resolved.document)];
  const selected = preferredAsset(normalizedAssets, requestedAssetId);
  let pageResult = { pages: [] as ReaderPage[], hasMore: false, integrityFailed: false };
  if (selected?.row && selected.nativeGatePassed) {
    pageResult = resolved.fixture
      ? fetchFixturePages(resolved.fixture, selected.row, page, limit)
      : await fetchNativePages(selected.row, page, limit);
  }

  const selectedPublic = selected?.public ?? null;
  const selectedCapabilities = selectedPublic
    ? { ...selectedPublic.capabilities, search: selectedPublic.capabilities.search && pageResult.pages.length > 0, citation: pageResult.pages.length > 0 }
    : emptyCapabilities();
  const title = boundedText(resolved.work?.title_local, 500)
    ?? boundedText(resolved.work?.title_en, 500)
    ?? boundedText(resolved.catalog?.title_local, 500)
    ?? boundedText(resolved.catalog?.title_en, 500)
    ?? boundedText(resolved.document?.paper_code, 500)
    ?? boundedText(resolved.document?.source, 500)
    ?? source;
  const resolvedProvider = resolved.catalog?.provider ?? resolved.assets[0]?.provider
    ?? (resolved.document?.collection === "ce_project" ? "student_transport_projects" : "ncce");
  const sourceUrl = selectedPublic?.sourceUrl ?? publicHttpUrl(resolved.catalog?.canonical_url);
  const workId = resolved.work?.work_id ?? resolved.catalog?.work_id ?? resolved.assets[0]?.work_id ?? null;
  const paperId = workId ?? resolved.catalog?.id ?? resolved.document?.id ?? source;
  const mode = selectedPublic?.mode ?? "unavailable";
  const accessReason = pageResult.integrityFailed
    ? "native_page_integrity_check_failed_content_suppressed"
    : selectedPublic?.reason ?? "no_reader_asset";

  return {
    version: PAPER_READER_VERSION,
    source,
    paper: {
      id: paperId,
      workId,
      source,
      provider: resolvedProvider,
      title,
      sourceUrl,
    },
    access: {
      mode,
      statusLabel: statusLabel(mode),
      reason: accessReason,
      sourceUrl,
      licenseExpression: selectedPublic?.rights.licenseExpression ?? null,
      rightsVerifiedAt: selectedPublic?.rights.verifiedAt ?? null,
      instructions: accessInstructions(mode, selected?.accessNotes ?? null),
      institution: mode === "restricted"
        ? boundedText(resolved.catalog?.publisher, 240) ?? boundedText(resolved.catalog?.journal_title, 240)
        : null,
    },
    asset: selectedPublic,
    assets: normalizedAssets.map((asset) => asset.public),
    pages: pageResult.pages,
    outline: outlineFromPages(pageResult.pages),
    capabilities: selectedCapabilities,
    citation: {
      workId,
      title,
      provider: resolvedProvider,
      assetId: selectedPublic?.id ?? null,
      sourceUrl,
      evidenceBoundary: pageResult.pages.length > 0 ? "exact_page_verified" : "metadata_only",
    },
    pagination: {
      assetId: selectedPublic?.id ?? null,
      page,
      limit,
      returned: pageResult.pages.length,
      hasMore: pageResult.hasMore,
      totalPages: selectedPublic?.pageCount ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
}
