import { Buffer } from "node:buffer";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { PAPER_SUMMARY_OVERRIDES } from "./paper-summary-overrides";
import { PAPER_TITLE_OVERRIDES } from "./paper-title-overrides";
import { getPaperReader } from "./paper-reader";
import { filterResearchCardsByRelevance } from "./research-relevance.mjs";
import {
  getVisibilityReceipts,
  getVisibilitySummary,
  type VisibilityReceipt,
  type VisibilitySummary,
} from "./visibility-audit";
import {
  findRightsReviewedReaderPaper,
  listRightsReviewedReaderPapers,
  type RightsReviewedReaderPage,
  type RightsReviewedReaderPaper,
} from "./rights-reviewed-reader-papers";

export type FeedFilter = "hot" | "recent" | "evidence" | "thai" | "tci" | "ncce" | "ce_project";
export type CollectionFilter = "" | "ce_project" | "ncce";
export type PreviewVariant = "beam" | "flood" | "seismic" | "traffic";

export type ResearchFeedCard = {
  id: string;
  source: string;
  sourcePdf?: string | null;
  collection: CollectionFilter;
  sourceType?: string | null;
  parentSourcePdf?: string | null;
  paperCode?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  proceedingNo?: number | null;
  proceedingYear?: number | null;
  discipline?: string | null;
  language?: string | null;
  publishedAt?: string | null;
  title: string;
  date: string;
  sourceLabel: string;
  summary: string;
  tags: string[];
  filters: FeedFilter[];
  evidenceCount: number;
  pages: number;
  pageLabel: string;
  preview: PreviewVariant;
  previewUrl?: string;
  prompt: string;
  indexedAt?: string | null;
  provider?: string | null;
  evidenceStatus?: "metadata_only" | "extracted" | "indexed" | "quarantined" | "removed";
  citable?: boolean;
  canonicalUrl?: string | null;
  journalTitle?: string | null;
  authors?: string[];
  doi?: string | null;
  rightsStatus?: string | null;
  accessLevel?: string | null;
  licenseExpression?: string | null;
  licenseUrl?: string | null;
  discoveryLayer?: "evidence" | "thai_discovery";
  publicationCountry?: string | null;
  thaiPublished?: boolean | null;
  thailandContext?: boolean | null;
  thaiLanguage?: boolean | null;
  thaiAffiliated?: boolean | null;
  visibility?: VisibilityReceipt;
};

export type ResearchFeedResponse = {
  cards: ResearchFeedCard[];
  facets: {
    total: number;
    totalSections: number;
    totalChunks: number;
    catalogTotal: number;
    citableTotal: number;
    metadataOnlyTotal: number;
    providers: Array<{ provider: string; records: number; citable: number; metadataOnly: number }>;
    coverage: ResearchCoverageProvider[];
    collections: Array<{ collection: string; documents: number }>;
    filters: Record<FeedFilter, number>;
    visibility: VisibilitySummary;
  };
  nextCursor: string | null;
  generatedAt: string;
};

const EMPTY_VISIBILITY_SUMMARY: VisibilitySummary = {
  auditRunId: null,
  provider: "tci_thaijo",
  externalIndex: "openalex",
  snapshotDate: null,
  runStatus: "not_started",
  strategy: null,
  denominator: 0,
  attempted: 0,
  audited: 0,
  globallyIndexed: 0,
  underIndexed: 0,
  candidateReview: 0,
  notFoundInAudit: 0,
  unavailable: 0,
  methodVersion: null,
  complete: false,
};

export type ResearchCoverageProvider = {
  provider: string;
  label: string;
  state: "connected" | "import_validated" | "partner_required" | "planned" | "blocked";
  records: number;
  metadataOnly: number;
  pageCitable: number;
  nativeFullPaper: number;
  sourceHostedFullPaper: number | null;
  endpointObserved: number | null;
  endpointKnown: number | null;
  rights: "article_specific" | "manifest_reviewed" | "agreement_required" | "not_assessed";
  freshness: string;
  filter: string | null;
};

export type ResearchCoverageSnapshot = {
  provider: string;
  records: number;
  metadataOnly: number;
  pageCitable: number;
  nativeFullPaper: number;
  sourceHostedFullPaper: number;
  endpointObserved: number;
  freshness: string;
};

export type PaperSection = {
  id: string;
  sectionIndex: number | null;
  title: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  snippet: string;
};

export type PaperEvidence = {
  id: string;
  sectionIndex: number | null;
  chunkIndex: number | null;
  sectionTitle?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  snippet: string;
  /** Physical page index used by the native reader; source page labels remain in pageStart/pageEnd. */
  readerPageNumber?: number | null;
  /** Stable native-reader anchor. Present only for a rights-verified reader page. */
  readerAnchor?: string | null;
};

export type PaperDetailResponse = {
  document: ResearchFeedCard;
  sections: PaperSection[];
  evidence: PaperEvidence[];
  counts: {
    sections: number;
    chunks: number;
  };
  related: ResearchFeedCard[];
  generatedAt: string;
};

type DocumentRow = {
  id: string;
  source: string;
  source_pdf?: string | null;
  collection?: string | null;
  source_type?: string | null;
  parent_source_pdf?: string | null;
  paper_code?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  proceeding_no?: number | null;
  proceeding_year?: number | null;
  discipline?: string | null;
  section_count?: number | null;
  chunk_count?: number | null;
  indexed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SectionRow = {
  id: string;
  document_id?: string | null;
  source?: string | null;
  collection?: string | null;
  paper_code?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  discipline?: string | null;
  section_index?: number | null;
  section_title?: string | null;
  content?: string | null;
};

type ChunkRow = {
  id: string;
  document_id?: string | null;
  section_id?: string | null;
  source?: string | null;
  collection?: string | null;
  paper_code?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  section_index?: number | null;
  section_title?: string | null;
  chunk_index?: number | null;
  content?: string | null;
};

type CatalogRow = {
  id: string;
  provider: string;
  provider_record_id: string;
  collection: string;
  source_type: string;
  title_local?: string | null;
  title_en?: string | null;
  authors?: unknown;
  keywords?: unknown;
  doi?: string | null;
  canonical_url?: string | null;
  journal_title?: string | null;
  publisher?: string | null;
  published_at?: string | null;
  language?: string | null;
  discipline?: string | null;
  license?: string | null;
  rights_status: string;
  access_level: string;
  evidence_status: "metadata_only" | "extracted" | "indexed" | "quarantined" | "removed";
  document_id?: string | null;
  source_updated_at?: string | null;
  updated_at?: string | null;
  publication_country?: string | null;
  thai_published?: boolean | null;
  thailand_context?: boolean | null;
  thai_language?: boolean | null;
  thai_affiliated?: boolean | null;
  research_facets_basis?: unknown;
};

type ListFeedParams = {
  filter?: string | null;
  collection?: string | null;
  provider?: string | null;
  q?: string | null;
  limit?: string | number | null;
  cursor?: string | null;
  thailandContext?: boolean | null;
  thaiLanguage?: boolean | null;
  thaiAffiliated?: boolean | null;
  includeFacets?: boolean;
};

const DOCUMENT_SELECT =
  "id, source, source_pdf, collection, source_type, parent_source_pdf, paper_code, page_start, page_end, proceeding_no, proceeding_year, discipline, section_count, chunk_count, indexed_at, created_at, updated_at";
const SECTION_SELECT = "id, document_id, source, collection, paper_code, page_start, page_end, discipline, section_index, section_title, content";
const CHUNK_SELECT = "id, document_id, section_id, source, collection, paper_code, page_start, page_end, section_index, section_title, chunk_index, content";
// Public discovery is deliberately metadata-only. Abstracts may be retained for
// permitted server-side indexing, but are never selected into a public card.
const CATALOG_SELECT = "id, provider, provider_record_id, collection, source_type, title_local, title_en, authors, keywords, doi, canonical_url, journal_title, publisher, published_at, language, discipline, license, rights_status, access_level, evidence_status, document_id, source_updated_at, updated_at, publication_country, thai_published, thailand_context, thai_language, thai_affiliated, research_facets_basis";
const MAX_QUERY_MATCHES = 500;
const FACET_CACHE_TTL_MS = 5 * 60 * 1_000;
let facetCache: { expiresAt: number; value: ResearchFeedResponse["facets"] } | null = null;
let facetRequest: Promise<ResearchFeedResponse["facets"]> | null = null;
const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "beyond", "by", "can", "conference", "current", "do", "does", "evidence", "for", "from", "how", "in", "into", "is", "it", "journal", "known", "of", "on", "or", "paper", "papers", "published", "report", "reported", "reports", "repository", "research", "should", "show", "shows", "studies", "study", "test", "testing", "thai", "thailand", "the", "this", "to", "use", "using", "what", "which", "with",
  "การ", "ของ", "จาก", "ด้วย", "ที่", "และ", "ใน", "เป็น", "เพื่อ", "ศึกษา", "การศึกษา", "งานวิจัย", "วิจัย", "ประเทศไทย", "อย่างไร",
]);
const SEARCH_THAI_FRAGMENTS = [
  "ปัญญาประดิษฐ์", "ภาษาอังกฤษ", "การเรียนรู้", "การสอน", "อุบัติเหตุ", "ความปลอดภัย", "ถนน", "จราจร", "ขนส่ง", "น้ำท่วม", "ระบายน้ำ", "ชลศาสตร์", "ก่อสร้าง", "คอนกรีต", "ซีเมนต์", "วัสดุ", "สะพาน", "แผ่นดินไหว", "สิ่งแวดล้อม", "การแพทย์", "สาธารณสุข", "เกษตร", "พลังงาน",
];

let supabaseAdminSingleton: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for research feed.");
  }

  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
  return supabaseAdminSingleton;
}

export function normalizeFeedFilter(value: string | null | undefined): FeedFilter {
  if (value === "tci") return "thai";
  return value === "recent" || value === "evidence" || value === "thai" || value === "ncce" || value === "ce_project" ? value : "hot";
}

export function normalizeCollection(value: string | null | undefined): CollectionFilter {
  return value === "ce_project" || value === "ncce" ? value : "";
}

export function normalizeLimit(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(30, parsed));
}

function normalizeQuery(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001F]/g, " ").replace(/[%_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function normalizeProvider(value: string | null | undefined): string {
  const provider = (value ?? "").trim().toLocaleLowerCase("en");
  return /^[a-z0-9_:-]{1,64}$/.test(provider) ? provider : "";
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    const offset = typeof decoded.offset === "number" ? decoded.offset : 0;
    return Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function collectionFromFilter(filter: FeedFilter, explicitCollection: CollectionFilter): CollectionFilter {
  if (filter === "ncce" || filter === "ce_project") return filter;
  return explicitCollection;
}

function repairThaiText(value: string): string {
  const legacyThaiGlyphMap: Record<string, string> = {
    "\uf701": "ิ",
    "\uf702": "ี",
    "\uf703": "ึ",
    "\uf704": "ื",
    "\uf705": "่",
    "\uf706": "้",
    "\uf707": "๊",
    "\uf708": "๋",
    "\uf709": "์",
    "\uf70a": "่",
    "\uf70b": "้",
    "\uf70c": "๊",
    "\uf70e": "์",
    "\uf710": "ั",
    "\uf712": "็",
    "\uf713": "่",
    "\uf714": "้",
    "\uf715": "๊",
    "\uf71b": "ำ",
  };
  let text = value
    .normalize("NFC")
    .replace(/[\uf701-\uf715\uf71b]/g, (char) => legacyThaiGlyphMap[char] ?? "")
    .replace(/(?<=[\u0E00-\u0E7F])0(?=[\u0E00-\u0E7F])/g, "ั")
    .replace(/(?<=[\u0E00-\u0E7F])E(?=[\u0E00-\u0E7F])/g, "ั")
    .replace(/ปF(?=จ)/g, "ปั")
    .replace(/(?<=[\u0E00-\u0E7F])F(?=[\u0E00-\u0E7F])/g, "่")
    .replace(/(?<=ร)=(?=[\u0E00-\u0E7F]|\s|$)/g, "์")
    .replace(/(?<=[\u0E00-\u0E7F])=(?=[\u0E00-\u0E7F])/g, "้")
    .replace(/(?<=[\u0E00-\u0E7F])[eI3Tg6M](?=[\u0E00-\u0E7F]|\s|:|\/|$)/g, "์")
    .replace(/(?<=[\u0E00-\u0E7F])8(?=\s|:|\/|$)/g, "์")
    .replace(/(?<=[\u0E00-\u0E7F])[l;4HPO>](?=[\u0E00-\u0E7F])/g, "้")
    .replace(/(?<=[\u0E00-\u0E7F])L(?=[\u0E00-\u0E7F])/g, "่")
    .replace(/(?<=[\u0E00-\u0E7F])[2A8@'<](?=[\u0E00-\u0E7F])/g, "่")
    .replace(/ปEจจัย/g, "ปัจจัย")
    .replace(/แผLน/g, "แผ่น")
    .replace(/แผL น/g, "แผ่น")
    .replace(/กลุLม/g, "กลุ่ม")
    .replace(/กลุL ม/g, "กลุ่ม")
    .replace(/ทL า/g, "ท่า")
    .replace(/ด์วย/g, "ด้วย")
    .replace(/ใช์งาน/g, "ใช้งาน")
    .replace(/ใช์/g, "ใช้")
    .replace(/รีดร์อน/g, "รีดร้อน")
    .replace(/วิเคราะห่/g, "วิเคราะห์")
    .replace(/วัตถุประสงค่/g, "วัตถุประสงค์")
    .replace(/กLอสร์าง/g, "ก่อสร้าง")
    .replace(/กLอสราง/g, "ก่อสร้าง")
    .replace(/ก่อสร์าง/g, "ก่อสร้าง")
    .replace(/สร์าง/g, "สร้าง")
    .replace(/เส์น/g, "เส้น")
    .replace(/ผลิตภัณฑ8/g, "ผลิตภัณฑ์")
    .replace(/แผ\/น/g, "แผ่น")
    .replace(/ขี\//g, "ขี่")
    .replace(/ภัยแล\/ง/g, "ภัยแล้ง")
    .replace(/โดยใช\//g, "โดยใช้")
    .replace(/ใช\//g, "ใช้")
    .replace(/ข\/อมูล/g, "ข้อมูล")
    .replace(/สถาป�ตยกรรม/g, "สถาปัตยกรรม")
    .replace(/แอสฟ�ลท์/g, "แอสฟัลท์")
    .replace(/ป�จจัย/g, "ปัจจัย")
    .replace(/ครั้งที�/g, "ครั้งที่")
    .replace(/วันที�/g, "วันที่")
    .replace(/ที่�/g, "ที่")
    .replace(/[\uf8eb-\uf8fe]/g, "")
    .replace(/\s+([\u0E31\u0E33-\u0E3A\u0E47-\u0E4E])/g, "$1")
    .replace(/([\u0E40-\u0E44])\s+([\u0E01-\u0E2E])/g, "$1$2")
    .replace(/([\u0E01-\u0E2E])\s+(\u0E33)/g, "$1$2")
    .replace(/([\u0E01-\u0E2E])\s+([\u0E30-\u0E32])/g, "$1$2");

  for (let i = 0; i < 8; i += 1) {
    const next = text.replace(/([\u0E00-\u0E7F])\s+([\u0E00-\u0E7F])/g, "$1$2");
    if (next === text) break;
    text = next;
  }

  return text;
}

function cleanText(value: string | null | undefined, maxChars = 600): string {
  const text = repairThaiText(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/^#{1,6}\s*Page\s+\d+\s*$/gim, "")
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/การประชุมวิชาการวิศวกรรมโยธาแห่งชาติ/i.test(line)) return false;
      if (/National Convention on Civil Engineering/i.test(line)) return false;
      if (/Online Conference|การประชุมรูปแบบออนไลน์/i.test(line)) return false;
      if (/วันที่\s+\d{1,2}|\bTHAILAND\b|จ\.ชลบุรี|จ\.เชียงใหม่|จ\.ภูเก็ต/i.test(line)) return false;
      if (/^\d{1,2}-\d{1,2}\s+(May|June|July)\s+\d{4}/i.test(line)) return false;
      if (/ภาควิชา|คณะวิศวกรรม|สาขาวิชา|Corresponding author|E-mail address/i.test(line)) return false;
      if (/^[A-Z]{2,5}-?\d{1,3}-\d+\s+\d+\b/.test(line)) return false;
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\b(Abstract)\s+\1\b/gi, "$1")
    .replace(/(บทคัดย่อ|บทคัดยอ|บพคัดย่อ)\s+\1/g, "$1")
    .replace(/^(?:abstract\s*)+/i, "")
    .replace(/^(?:(?:บทคัดย่อ|บทคัดยอ|บพคัดย่อ)\s*)+/, "")
    .replace(/\b[A-Z]{2,5}-?\d{1,3}-\d+\s+\d+\b/g, "")
    .replace(/ด้วยเมือง\s*\(Urbanization\).*$/i, "")
    .trim();

  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}

function cleanTitleCandidate(value: string | null | undefined, maxChars = 190): string {
  const text = repairThaiText(value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .filter(Boolean)
    .join(" ");

  const cleaned = text
    .replace(/^document\s*/i, "")
    .replace(/^\d{6,7}\s*Civil Engineering Project\s*/i, "")
    .replace(/\bthe\s+Civil Engineering Project\b/gi, "")
    .replace(/\bCIVIL ENGINEERING PROJECT\b/g, "")
    .replace(/[!¡*•●○]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\\/:;,.|&\-\s]+|[\\/:;,.|&\-\s]+$/g, "")
    .trim();
  const withoutAuthorSuffix = removeAuthorSuffix(cleaned);
  return withoutAuthorSuffix.length > maxChars ? withoutAuthorSuffix.slice(0, maxChars).trim() : withoutAuthorSuffix;
}

export function cleanCatalogTitle(value: string | null | undefined): string {
  return cleanTitleCandidate(value, 320) || cleanText(value, 320);
}

function removeAuthorSuffix(value: string): string {
  if (!value.includes(" / ")) return value;
  const parts = value.split(" / ");
  const tail = parts[parts.length - 1] ?? "";
  const head = parts.slice(0, -1).join(" / ");
  const looksLikeAuthorTail = /\d[.,*]?/.test(tail) && (tail.includes(",") || tail.includes("และ"));
  const looksLikeTitleTail =
    /การศึกษา|การวิเคราะห์|การพัฒนา|การประเมิน|กรณีศึกษา|พื้นที่ศึกษา|study|analysis|assessment|evaluation|case|model|DPT|ITRF|TGM|GIS|RTK/i.test(
      tail,
    );
  return looksLikeAuthorTail && !looksLikeTitleTail ? head.trim() : value;
}

function isNoisyTitle(value: string | null | undefined): boolean {
  const title = cleanTitleCandidate(value);
  const compactTitle = title.replace(/\s+/g, "");
  if (!title) return true;
  if (/^document$/i.test(title)) return true;
  if (/^(page|หน้า|abstract|บทคัดย่อ|references?|เอกสารอ้างอิง|introduction|บทนำ)$/i.test(title)) return true;
  if (/^(?:keywords?|key words?|ค[ํำ]าส[ํำ]าคัญ|คำสำคัญ|บทคัดยอ|บพคัดย่อ)(?:\s*[:：]|\s+|$)/i.test(title)) return true;
  if (/การประชุมวิชาการวิศวกรรมโยธาแห่งชาติ|National Convention on Civil Engineering|Online Conference/i.test(title)) return true;
  if (/^วันที่\b|^\d{1,2}-\d{1,2}\s+(May|June|July)\s+\d{4}/i.test(title)) return true;
  if (/^(table|figure)\s*\d+/i.test(title)) return true;
  if (/^(ตาราง|รูป)\s*ที่\s*\d+/i.test(title)) return true;
  if (/^2101499\b.*(civil engineering project|ปีการศึกษา|โครงงานทางวิศวกรรมโยธา)/i.test(title)) return true;
  if (/^2101499\s*(civil engineering project)?$/i.test(title)) return true;
  if (/^2101499\s*โครงงานทางวิศวกรรมโยธา/i.test(compactTitle)) return true;
  if (/^(บทความวิจัย|ปการศึกษา|ปีการศึกษา)/i.test(title)) return true;
  if (/\.(pdf|md)$/i.test(title)) return true;
  if (/^(Y\d{4}|NCCE\d{2})[_-]/i.test(title)) return true;
  if (/โครงงานทางวิศวกรรมโยธา|บทความวิจัย\s*ปีการศึกษา/i.test(title)) return true;
  if (/ภาควิชา|คณะวิศวกรรม|สาขาวิชา|อาจารย|author|email/i.test(title)) return true;
  if (/^\d+$/.test(title)) return true;
  if (title.length < 6) return true;
  return false;
}

function titleQualityScore(value: string): number {
  const title = cleanTitleCandidate(value);
  if (isNoisyTitle(title)) return -1_000;
  if (title.length < 12 || title.length > 190) return -900;
  if (/วัตถุประสงค์|ผลการวิจัย|ผลการศึกษา|จากการศึกษา|การศึกษานี้|งานวิจัยนี้|โครงงานวิจัย|ในขั้นตอน|ปัจจุบัน|พบว่า|the objective|this study|results?|research findings|findings suggest|project aims|aims to|aimed to|conducted|covers|nowadays|keywords?|key words?/i.test(title)) {
    return -500;
  }
  if (/[,;:]\s*[,;:]|_{2,}|[{}<>]/.test(title)) return -250;

  let score = 0;
  const thaiChars = (title.match(/[\u0E00-\u0E7F]/g) ?? []).length;
  const latinChars = (title.match(/[A-Za-z]/g) ?? []).length;
  const words = title.split(/\s+/).filter(Boolean).length;

  score += Math.min(title.length, 120);
  if (thaiChars >= 12) score += 35;
  if (latinChars >= 12 && words >= 4) score += 28;
  if (/การศึกษา|การวิเคราะห์|การพัฒนา|การพยากรณ์|ปัจจัย|ผลกระทบ|ประสิทธิภาพ|ความเป็นไปได้|พฤติกรรม|แบบจำลอง|study|analysis|evaluation|model|platform|feasibility|behavior|performance|forecast/i.test(title)) {
    score += 70;
  }
  if (/road|traffic|transport|concrete|construction|flood|geotechnical|accident|mobility|travel/i.test(title)) score += 25;
  if (/^การ|^A\s|^An\s|^The\s/i.test(title)) score += 12;
  if (title.includes("/") || title.includes(":")) score += 8;
  if (/^[A-Z][A-Za-z0-9 ,:;()/-]+$/.test(title)) score += 8;
  if (title.length > 150) score -= 18;
  if (latinChars > 0 && thaiChars > 0 && title.length > 130) score -= 20;
  return score;
}

function titleCandidatesFromSectionContent(content: string | null | undefined): string[] {
  const candidates: string[] = [];
  const lines = (content ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => cleanTitleCandidate(line))
    .filter(Boolean);

  for (const line of lines) {
    if (/^(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ)$/i.test(line)) break;
    if (isNoisyTitle(line)) continue;
    if (titleQualityScore(line) > 0) candidates.push(line);
  }

  return candidates;
}

function titleFromContent(content: string | null | undefined): string {
  const candidates = titleCandidatesFromSectionContent(content);
  if (candidates.length) {
    return candidates.sort((a, b) => titleQualityScore(b) - titleQualityScore(a))[0];
  }

  const cleaned = cleanText(content, 220);
  const line = cleaned
    .split(/(?<=[.!?。])\s+|\s{2,}/)
    .map((item) => item.trim())
    .find((item) => item.length >= 12 && item.length <= 180);
  return line ?? cleaned.slice(0, 160);
}

function deriveTitle(doc: DocumentRow, sections: SectionRow[]): string {
  const firstSection = [...sections].sort(
    (left, right) => (left.section_index ?? Number.MAX_SAFE_INTEGER) - (right.section_index ?? Number.MAX_SAFE_INTEGER),
  )[0];
  const declaredTitle = cleanTitleCandidate(firstSection?.section_title);
  if (declaredTitle && titleQualityScore(declaredTitle) > 0) {
    return declaredTitle;
  }

  const titleZone = sections.slice(0, 6);
  const candidates = titleZone.flatMap((section) => {
    const items: string[] = [];
    if (section.section_title) items.push(cleanTitleCandidate(section.section_title));
    items.push(...titleCandidatesFromSectionContent(section.content));
    return items;
  });

  const scored = candidates
    .map((title) => ({ title, score: titleQualityScore(title) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored[0]) return scored[0].title;

  const contentTitle = titleZone.map((section) => titleFromContent(section.content)).find((title) => title.length >= 12 && !isNoisyTitle(title));
  if (contentTitle) return cleanTitleCandidate(contentTitle);

  return doc.paper_code || doc.source_pdf || doc.source;
}

function extractAbstractSnippet(value: string | null | undefined, maxChars = 520): string {
  const lines = (value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  const start = lines.findIndex((line) => /^(#{1,6}\s*)?(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ)\s*$/i.test(repairThaiText(line).trim()));
  if (start < 0) return "";

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const cleaned = repairThaiText(line).replace(/^#{1,6}\s*/, "").trim();
    if (!cleaned) continue;
    if (/^(?:keywords?|คำสำคัญ)(?:\s*[:：]|\s+|$)|^(?:1\s*บท|บทนำ|introduction)\b/i.test(cleaned)) break;
    if (/^(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ)$/i.test(cleaned)) continue;
    body.push(line);
  }

  return cleanText(body.join("\n"), maxChars);
}

function deriveSummary(sections: SectionRow[], chunks: ChunkRow[] = []): string {
  const abstractSection = sections.find((section) =>
    /abstract|บทคัดย่อ|บทคัด|summary|สรุป/i.test(`${section.section_title ?? ""} ${section.content ?? ""}`) &&
    cleanText(section.content, 180).length >= 80,
  );
  const abstractSnippet = abstractSection ? extractAbstractSnippet(abstractSection.content, 520) : "";
  if (abstractSnippet.length >= 80) return abstractSnippet;

  const sectionCandidate = sections.find((section) => cleanText(section.content, 180).length >= 90);
  const chunkCandidate = chunks.find((chunk) => cleanText(chunk.content, 220).length >= 120);
  const candidate = abstractSection?.content ?? sectionCandidate?.content ?? chunkCandidate?.content ?? sections[0]?.content;
  const lines = (candidate ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => repairThaiText(line).replace(/^#{1,6}\s*/, "").trim())
    .filter((line) => {
      if (line.length < 24) return false;
      if (/^(?:page|หน้า)\s*\d+|^(?:doi|e-?mail|email|corresponding author)\b/i.test(line)) return false;
      if (/^(?:the )?\d+(?:st|nd|rd|th)?\s+(?:national|international).*conference/i.test(line)) return false;
      if (/^(?:มหาวิทยาลัย|คณะ|ภาควิชา|สาขาวิชา|department|faculty|university)\b/i.test(line)) return false;
      if (/^[\d\s*†‡,.;()\-–—A-Z.]{24,}$/.test(line)) return false;
      return true;
    });
  const summary = cleanText(lines.slice(0, 4).join(" ") || candidate || "", 520);
  return summary || "ยังไม่มี summary ที่อ่านได้จากเอกสารนี้ แต่สามารถเปิดรายละเอียดเพื่อดู outline และ evidence ที่ index แล้วได้";
}

function pageCount(doc: DocumentRow): number {
  if (doc.page_start != null && doc.page_end != null && doc.page_end >= doc.page_start) {
    return doc.page_end - doc.page_start + 1;
  }
  return 0;
}

function previewPageLabel(doc: DocumentRow): string {
  if (normalizeCollection(doc.collection) === "ncce") return "PDF preview";
  if (doc.page_start != null && doc.page_end != null && doc.page_end >= doc.page_start) {
    return doc.page_start === doc.page_end ? `PDF | p.${doc.page_start}` : `PDF | p.${doc.page_start}-${doc.page_end}`;
  }
  return "PDF preview";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function collectionLabel(value: CollectionFilter): string {
  if (value === "ncce") return "NCCE";
  if (value === "ce_project") return "Student Transport";
  return "All";
}

function providerLabel(value: string): string {
  if (value === "tci_thaijo") return "ThaiJO";
  if (value === "pmc_oa") return "PMC · Thai-affiliated global OA";
  if (value === "tci_citation") return "TCI Citation Index";
  if (value === "tnrr") return "TNRR";
  if (value === "thailis_tdc") return "ThaiLIS / TDC";
  if (value === "thai_conference") return "Thai Conferences";
  if (value === "thai_ir") return "Thai Institutional Repositories";
  if (value === "student_transport_projects") return "Student Transport";
  if (value === "ncce") return "NCCE";
  return value;
}

function disciplineLabel(value: string | null | undefined): string {
  const cleaned = (value ?? "").trim();
  const labels: Record<string, string> = {
    unknown: "General Engineering",
    science: "Science",
    life_sciences: "Life Sciences",
    physical_sciences: "Physical Sciences",
    health_sciences: "Health Sciences",
    medical_and_health_sciences: "Medical & Health Sciences",
    medical_and_life_sciences: "Medical & Life Sciences",
    social_sciences: "Social Sciences",
    transport: "Transport",
    structural: "Structural",
    geotechnical: "Geotechnical",
    construction_mgmt: "Construction Mgmt",
    water_resources: "Water Resources",
    surveying_gis: "Surveying, GIS & Geospatial",
    environmental: "Environmental",
    infrastructure: "Infrastructure",
    civil_education: "Civil Education",
    ai_engineering: "AI Engineering",
  };
  return labels[cleaned] ?? cleaned;
}

function deriveTags(doc: DocumentRow, title: string, summary: string): string[] {
  const terms = new Set<string>();
  const collection = normalizeCollection(doc.collection);
  if (doc.discipline) terms.add(disciplineLabel(doc.discipline));
  if (collection) terms.add(collectionLabel(collection));
  if (doc.paper_code) terms.add(doc.paper_code);
  if (doc.proceeding_no) terms.add(`NCCE${doc.proceeding_no}`);
  if (doc.proceeding_year) terms.add(`Year ${doc.proceeding_year}`);

  const titleHaystack = title;
  const summaryHaystack = summary;
  const keywordMap: Array<[RegExp, string]> = [
    [/คอนกรีต|concrete|cement|reinforced/i, "Concrete"],
    [/แผ่นดินไหว|earthquake|seismic|liquefaction|การเหลว/i, "Earthquake risk"],
    [/น้ำท่วม|flood|drainage|ระบายน้ำ/i, "Flood resilience"],
    [/อุบัติเหตุ|accident|crash|road safety/i, "Road safety"],
    [/วิธี|method|experiment|model|แบบจำลอง/i, "Method"],
  ];
  for (const [pattern, tag] of keywordMap) {
    if (pattern.test(titleHaystack) || pattern.test(summaryHaystack)) terms.add(tag);
  }

  return [...terms].filter(Boolean).slice(0, 6);
}

function derivePreview(doc: DocumentRow, title: string): PreviewVariant {
  const text = `${doc.discipline ?? ""} ${title} ${doc.source ?? ""}`.toLowerCase();
  if (/transport|traffic|road|intersection|ขนส่ง|จราจร|ทางแยก/.test(text)) return "traffic";
  if (/flood|water|drainage|hydraulic|น้ำท่วม|ระบายน้ำ|อุทก/.test(text)) return "flood";
  if (/seismic|earthquake|geotech|soil|slope|ดิน|แผ่นดินไหว/.test(text)) return "seismic";
  return "beam";
}

function previewSlug(source: string): string {
  return source
    .replace(/\.(md|pdf)$/i, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^[._]+|[._]+$/g, "") || "paper";
}

const PAPER_PREVIEW_FILES = (() => {
  try {
    return new Set(readdirSync(join(process.cwd(), "public", "paper-previews")));
  } catch {
    return new Set<string>();
  }
})();

function previewUrlForSource(source: string): string | undefined {
  const filename = `${previewSlug(source)}.jpg`;
  return PAPER_PREVIEW_FILES.has(filename) ? `/paper-previews/${filename}` : undefined;
}

function hotScore(doc: DocumentRow): number {
  const indexed = doc.indexed_at ? new Date(doc.indexed_at).getTime() : 0;
  const ageDays = indexed ? Math.max(0, (Date.now() - indexed) / 86_400_000) : 365;
  const recencyBoost = Math.max(0, 45 - Math.min(ageDays, 45));
  return (doc.chunk_count ?? 0) * 2 + (doc.section_count ?? 0) * 1.2 + recencyBoost;
}

function filtersForDoc(doc: DocumentRow): FeedFilter[] {
  // The evidence corpus currently consists of Thai conference and Thai
  // university deposits. Keep this independent from language, topic, and
  // author affiliation: "thai" means published/deposited in Thailand.
  const filters: FeedFilter[] = ["hot", "thai"];
  const ageDays = doc.indexed_at ? Math.max(0, (Date.now() - new Date(doc.indexed_at).getTime()) / 86_400_000) : 365;
  if (ageDays <= 45) filters.push("recent");
  if ((doc.chunk_count ?? 0) >= 6) filters.push("evidence");
  const collection = normalizeCollection(doc.collection);
  if (collection) filters.push(collection);
  return [...new Set(filters)];
}

function buildPrompt(card: Pick<ResearchFeedCard, "title" | "source" | "collection" | "paperCode">): string {
  const collection = card.collection ? `from the ${collectionLabel(card.collection)} collection` : "";
  const paper = card.paperCode ? ` (${card.paperCode})` : "";
  return `Summarize this paper${paper}: ${card.title} ${collection}. Create a concise Research Brief and cite evidence from ${card.source}.`.trim();
}

function titleOverrideForDocument(doc: DocumentRow): string | null {
  const direct = PAPER_TITLE_OVERRIDES[doc.source];
  if (direct) {
    const cleaned = cleanTitleCandidate(direct);
    return cleaned || null;
  }
  const sourcePdf = doc.source_pdf ? PAPER_TITLE_OVERRIDES[doc.source_pdf.replace(/\.pdf$/i, ".md")] : null;
  if (!sourcePdf) return null;
  const cleaned = cleanTitleCandidate(sourcePdf);
  return cleaned || null;
}

function summaryOverrideForDocument(doc: DocumentRow): string | null {
  const direct = PAPER_SUMMARY_OVERRIDES[doc.source];
  if (direct) {
    const cleaned = cleanText(direct, 520);
    return cleaned.length >= 80 ? cleaned : null;
  }
  const sourcePdf = doc.source_pdf ? PAPER_SUMMARY_OVERRIDES[doc.source_pdf.replace(/\.pdf$/i, ".md")] : null;
  if (!sourcePdf) return null;
  const cleaned = cleanText(sourcePdf, 520);
  return cleaned.length >= 80 ? cleaned : null;
}

function cardFromDocument(doc: DocumentRow, sections: SectionRow[], chunks: ChunkRow[] = []): ResearchFeedCard {
  const collection = normalizeCollection(doc.collection);
  const title = titleOverrideForDocument(doc) ?? deriveTitle(doc, sections);
  const summary = summaryOverrideForDocument(doc) ?? deriveSummary(sections, chunks);
  const card: ResearchFeedCard = {
    id: doc.id,
    source: doc.source,
    sourcePdf: doc.source_pdf,
    collection,
    sourceType: doc.source_type,
    parentSourcePdf: doc.parent_source_pdf,
    paperCode: doc.paper_code,
    pageStart: doc.page_start,
    pageEnd: doc.page_end,
    proceedingNo: doc.proceeding_no,
    proceedingYear: doc.proceeding_year,
    discipline: doc.discipline,
    title,
    date: `Indexed ${formatDate(doc.indexed_at ?? doc.updated_at ?? doc.created_at)}`,
    sourceLabel: [collectionLabel(collection), disciplineLabel(doc.discipline), doc.source_type].filter(Boolean).join(" · "),
    summary,
    tags: deriveTags(doc, title, summary),
    filters: filtersForDoc(doc),
    evidenceCount: doc.chunk_count ?? 0,
    pages: pageCount(doc),
    pageLabel: previewPageLabel(doc),
    preview: derivePreview(doc, title),
    previewUrl: previewUrlForSource(doc.source),
    prompt: "",
    indexedAt: doc.indexed_at,
    provider: collection === "ce_project" ? "student_transport_projects" : "ncce",
    evidenceStatus: "indexed",
    citable: true,
    discoveryLayer: "evidence",
    publicationCountry: "TH",
    thaiPublished: true,
    thailandContext: null,
    thaiLanguage: null,
    thaiAffiliated: null,
  };
  return { ...card, prompt: buildPrompt(card) };
}

function stringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return String(record.name ?? record.display_name ?? record.full_name ?? "");
    })
    .map((item) => cleanText(item, 120))
    .filter(Boolean)
    .slice(0, limit);
}

function cardFromCatalog(row: CatalogRow): ResearchFeedCard {
  const title = cleanCatalogTitle(row.title_local || row.title_en || row.provider_record_id);
  const authors = stringArray(row.authors);
  const journalTitle = cleanText((row.journal_title || "").split(/\s*[;|]\s*/)[0] || row.publisher || "", 120);
  const keywordTags = stringArray(row.keywords, 12)
    .flatMap((value) => value.split(/\s*[,;]\s*/))
    .map((value) => cleanText(value, 42))
    .filter(Boolean)
    .slice(0, 4);
  const isNativeCitable = row.evidence_status === "extracted"
    && row.rights_status === "open_license_verified"
    && row.access_level === "full_text_licensed";
  const isMedicalResearch = row.discipline === "medical_and_health_sciences"
    || row.discipline === "medical_and_life_sciences";
  const normalizedLicense = cleanText(row.license || "", 40);
  const ccByVersion = normalizedLicense.match(/^CC[- ]BY[- ](\d+(?:\.\d+)?)$/i)?.[1] ?? null;
  const licenseLabel = ccByVersion ? `CC BY ${ccByVersion}` : normalizedLicense;
  const isThaiJo = row.provider === "tci_thaijo";
  const providerIsThaiPublished = [
    "tci_thaijo", "tci_citation", "tnrr", "thailis_tdc", "thai_conference",
    "thai_ir", "ncce", "student_transport_projects",
  ].includes(row.provider);
  const thaiPublished = row.thai_published ?? providerIsThaiPublished;
  const tags = [
    ...(isNativeCitable ? ["Native reader", licenseLabel] : []),
    ...(thaiPublished ? ["Published in Thailand"] : []),
    ...(row.thailand_context === true ? ["Thailand context"] : []),
    ...(row.thai_language === true ? ["Thai language"] : []),
    ...(row.thai_affiliated === true ? ["Thai affiliated"] : []),
    disciplineLabel(row.discipline),
    providerLabel(row.provider),
    ...keywordTags,
  ].filter(Boolean).slice(0, 6);
  const summary = [
    journalTitle,
    authors.length ? `By ${authors.slice(0, 3).join(", ")}` : "",
    isNativeCitable
      ? `Rights-verified full paper. Open the native reader to inspect and cite exact pages.${isMedicalResearch ? " Research evidence only; biomedical content is not clinical advice." : ""}`
      : "Discovery metadata. Open the source record to verify full-text access and reuse terms.",
  ].filter(Boolean).join(" · ");
  const previewDoc: DocumentRow = {
    id: row.id,
    source: row.provider_record_id,
    collection: null,
    discipline: row.discipline,
  };

  return {
    id: row.id,
    source: row.provider_record_id,
    collection: "",
    sourceType: row.source_type,
    paperCode: null,
    discipline: row.discipline,
    language: row.language,
    publishedAt: row.published_at,
    title,
    date: formatDate(row.published_at ?? row.source_updated_at ?? row.updated_at),
    sourceLabel: [providerLabel(row.provider), journalTitle, disciplineLabel(row.discipline)].filter(Boolean).join(" · "),
    summary,
    tags,
    filters: [
      ...(isNativeCitable ? ["hot", "evidence"] as FeedFilter[] : []),
      "thai",
      ...(isThaiJo ? ["tci"] as FeedFilter[] : []),
    ],
    evidenceCount: isNativeCitable ? 1 : 0,
    pages: 0,
    pageLabel: isNativeCitable ? "Native full paper" : "Metadata only",
    preview: derivePreview(previewDoc, title),
    prompt: "",
    indexedAt: row.updated_at,
    provider: row.provider,
    evidenceStatus: row.evidence_status,
    citable: isNativeCitable,
    canonicalUrl: row.canonical_url,
    journalTitle,
    authors,
    doi: row.doi,
    rightsStatus: row.rights_status,
    accessLevel: row.access_level,
    licenseExpression: row.license,
    licenseUrl: ccByVersion ? `https://creativecommons.org/licenses/by/${ccByVersion}/` : null,
    discoveryLayer: isNativeCitable ? "evidence" : "thai_discovery",
    publicationCountry: row.publication_country ?? (thaiPublished ? "TH" : null),
    thaiPublished,
    thailandContext: row.thailand_context ?? null,
    thaiLanguage: row.thai_language ?? (row.language ? /^th(?:a|ai)?$/i.test(row.language) : null),
    thaiAffiliated: row.thai_affiliated ?? (row.provider === "pmc_oa" ? true : null),
  };
}

function readerSourcePageNumber(page: RightsReviewedReaderPage): number {
  const parsed = Number.parseInt(page.pageLabel, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : page.pageNumber;
}

function readerStableAnchor(paper: RightsReviewedReaderPaper, page: RightsReviewedReaderPage): string {
  return `asset:${paper.asset.id}:page:${page.pageNumber}`;
}

function cardFromRightsReviewedReaderPaper(paper: RightsReviewedReaderPaper): ResearchFeedCard {
  const firstPage = paper.pages[0];
  const lastPage = paper.pages[paper.pages.length - 1];
  const pageStart = firstPage ? readerSourcePageNumber(firstPage) : null;
  const pageEnd = lastPage ? readerSourcePageNumber(lastPage) : null;
  const indexedAt = paper.asset.rightsVerifiedAt;
  const ageDays = Math.max(0, (Date.now() - new Date(indexedAt).getTime()) / 86_400_000);
  const filters: FeedFilter[] = ["hot", "evidence", "thai", "tci"];
  // Match the database-backed `recent` facet instead of pinning the committed
  // reader pack in that tab forever after its review date ages past 45 days.
  if (ageDays <= 45) filters.splice(1, 0, "recent");
  const card: ResearchFeedCard = {
    id: `reader-pack:${paper.source}`,
    source: paper.source,
    collection: "",
    sourceType: "journal_article",
    paperCode: paper.doi,
    pageStart,
    pageEnd,
    discipline: "education",
    language: paper.asset.language,
    publishedAt: paper.publishedAt,
    title: paper.title,
    date: formatDate(paper.publishedAt),
    sourceLabel: `ThaiJO · ${paper.journalTitle} · Native reader`,
    summary: `Rights-verified ${paper.asset.licenseExpression} full paper with ${paper.asset.pageCount} page-addressable pages. Read, search, annotate, and reopen every citation against the official version of record.`,
    tags: ["Native reader", "CC BY 4.0", "ThaiJO"],
    filters,
    evidenceCount: paper.pages.length,
    pages: paper.asset.pageCount,
    pageLabel: `${paper.asset.pageCount} verified pages`,
    preview: derivePreview({ id: paper.source, source: paper.source, discipline: "education" }, paper.title),
    prompt: "",
    indexedAt,
    provider: paper.provider,
    evidenceStatus: "extracted",
    citable: true,
    canonicalUrl: paper.sourceUrl,
    journalTitle: paper.journalTitle,
    authors: [...paper.authors],
    doi: paper.doi,
    rightsStatus: paper.asset.rightsStatus,
    accessLevel: "full_text_licensed",
    licenseExpression: paper.asset.licenseExpression,
    licenseUrl: paper.asset.licenseUrl,
    discoveryLayer: "evidence",
    publicationCountry: "TH",
    thaiPublished: true,
    thailandContext: null,
    thaiLanguage: paper.asset.language ? /^th(?:a|ai)?$/i.test(paper.asset.language) : null,
    thaiAffiliated: null,
  };
  return { ...card, prompt: buildPrompt(card) };
}

function rightsReviewedReaderCards(filter: FeedFilter, collection: CollectionFilter, q: string): ResearchFeedCard[] {
  if (collection || filter === "ncce" || filter === "ce_project") return [];
  const cards = listRightsReviewedReaderPapers()
    .map(cardFromRightsReviewedReaderPaper)
    .filter((card) => card.filters.includes(filter));
  return filterResearchCardsByRelevance(q, cards)
    .sort((left, right) => {
      if (filter === "evidence") return right.evidenceCount - left.evidenceCount;
      return new Date(right.indexedAt ?? right.date).getTime() - new Date(left.indexedAt ?? left.date).getTime();
    });
}

function addReaderPackFacets(
  facets: ResearchFeedResponse["facets"],
  snapshots: ResearchCoverageSnapshot[] = [],
): ResearchFeedResponse["facets"] {
  if (snapshots.length) {
    const snapshotMap = new Map(snapshots.map((row) => [row.provider, row]));
    const providerCounts = new Map(facets.providers.map((item) => [item.provider, { ...item }]));
    for (const snapshot of snapshots) {
      const current = providerCounts.get(snapshot.provider);
      providerCounts.set(snapshot.provider, {
        provider: snapshot.provider,
        records: snapshot.records,
        citable: snapshot.provider === "tci_thaijo" ? snapshot.pageCitable : current?.citable ?? 0,
        metadataOnly: snapshot.metadataOnly,
      });
    }
    const providers = [...providerCounts.values()];
    const catalogTotal = providers.reduce((sum, item) => sum + item.records, 0);
    const catalogCitable = providers.reduce((sum, item) => sum + item.citable, 0);
    const metadataOnlyTotal = providers.reduce((sum, item) => sum + item.metadataOnly, 0);
    const authoritative = {
      ...facets,
      total: catalogTotal,
      catalogTotal,
      citableTotal: catalogCitable,
      metadataOnlyTotal,
      providers,
    };
    return { ...authoritative, coverage: buildCoverageLedger(authoritative, [...snapshotMap.values()]) };
  }
  const cards = listRightsReviewedReaderPapers().map(cardFromRightsReviewedReaderPaper);
  const providerCounts = new Map(facets.providers.map((item) => [item.provider, { ...item }]));
  for (const card of cards) {
    const provider = card.provider ?? "unknown";
    const current = providerCounts.get(provider);
    if (current) {
      current.records += 1;
      current.citable += 1;
    } else providerCounts.set(provider, { provider, records: 1, citable: 1, metadataOnly: 0 });
  }
  const filters = { ...facets.filters };
  for (const card of cards) {
    for (const filter of card.filters) filters[filter] += 1;
  }
  return {
    ...facets,
    total: facets.total + cards.length,
    totalSections: facets.totalSections + cards.reduce((sum, card) => sum + card.pages, 0),
    totalChunks: facets.totalChunks + cards.reduce((sum, card) => sum + card.evidenceCount, 0),
    citableTotal: facets.citableTotal + cards.length,
    providers: [...providerCounts.values()],
    coverage: buildCoverageLedger({ ...facets, providers: [...providerCounts.values()] }),
    filters,
  };
}

export function buildCoverageLedger(
  facets: Omit<ResearchFeedResponse["facets"], "coverage"> & { coverage?: ResearchCoverageProvider[] },
  snapshots: ResearchCoverageSnapshot[] = [],
): ResearchCoverageProvider[] {
  const providers = new Map(facets.providers.map((item) => [item.provider, item]));
  const snapshotMap = new Map(snapshots.map((row) => [row.provider, row]));
  const thaiJo = providers.get("tci_thaijo");
  const snapshot = snapshotMap.get("tci_thaijo");
  const pmc = providers.get("pmc_oa");
  const pmcSnapshot = snapshotMap.get("pmc_oa");
  const ncceSnapshot = snapshotMap.get("ncce");
  const studentSnapshot = snapshotMap.get("student_transport_projects");
  const thaiJoMetadataOnly = snapshot?.metadataOnly ?? thaiJo?.metadataOnly ?? 0;
  const thaiJoPageCitable = snapshot?.pageCitable ?? thaiJo?.citable ?? 0;
  const rows: ResearchCoverageProvider[] = [
    {
      provider: "tci_thaijo",
      label: "ThaiJO",
      state: "connected",
      records: snapshot?.records ?? thaiJo?.records ?? thaiJoMetadataOnly + thaiJoPageCitable,
      metadataOnly: thaiJoMetadataOnly,
      pageCitable: thaiJoPageCitable,
      nativeFullPaper: snapshot?.nativeFullPaper ?? 0,
      sourceHostedFullPaper: snapshot?.sourceHostedFullPaper ?? null,
      endpointObserved: snapshot?.endpointObserved ?? null,
      endpointKnown: null,
      rights: "article_specific",
      freshness: snapshot?.freshness ?? "",
      filter: "tci_thaijo",
    },
    ...((pmc || pmcSnapshot) ? [{
      provider: "pmc_oa",
      label: "PMC · Thai-affiliated global OA",
      state: "connected" as const,
      records: pmcSnapshot?.records ?? pmc?.records ?? 0,
      metadataOnly: pmcSnapshot?.metadataOnly ?? pmc?.metadataOnly ?? 0,
      pageCitable: pmcSnapshot?.pageCitable ?? pmc?.citable ?? 0,
      nativeFullPaper: pmcSnapshot?.nativeFullPaper ?? 0,
      sourceHostedFullPaper: pmcSnapshot?.sourceHostedFullPaper ?? null,
      // The coverage RPC counts legacy OAI endpoint families and therefore
      // reports zero for PMC. This cohort has one explicit, fixed NLM Article
      // Datasets source slice, so keep the UI denominator truthful.
      endpointObserved: Math.max(1, pmcSnapshot?.endpointObserved ?? 0),
      endpointKnown: 1,
      rights: "article_specific" as const,
      freshness: pmcSnapshot?.freshness ?? "",
      filter: "pmc_oa",
    }] : []),
    {
      provider: "ncce",
      label: "NCCE",
      state: "connected",
      records: ncceSnapshot?.records ?? facets.filters.ncce,
      metadataOnly: 0,
      pageCitable: facets.filters.ncce,
      nativeFullPaper: 0,
      sourceHostedFullPaper: ncceSnapshot?.sourceHostedFullPaper ?? null,
      endpointObserved: ncceSnapshot?.endpointObserved ?? null,
      endpointKnown: null,
      rights: "manifest_reviewed",
      freshness: ncceSnapshot?.freshness ?? "",
      filter: "ncce",
    },
    {
      provider: "student_transport_projects",
      label: "Chula transport collection",
      state: "import_validated",
      records: studentSnapshot?.records ?? facets.filters.ce_project,
      metadataOnly: 0,
      pageCitable: facets.filters.ce_project,
      nativeFullPaper: 0,
      sourceHostedFullPaper: studentSnapshot?.sourceHostedFullPaper ?? null,
      endpointObserved: studentSnapshot?.endpointObserved ?? null,
      endpointKnown: null,
      rights: "manifest_reviewed",
      freshness: studentSnapshot?.freshness ?? "",
      filter: "ce_project",
    },
  ];
  for (const [provider, label] of [
    ["tci_citation", "TCI Citation Index"],
    ["tnrr", "TNRR"],
    ["thailis_tdc", "ThaiLIS TDC"],
    ["thai_conference", "Thai conferences"],
    ["thai_ir", "Institutional repositories"],
  ] as const) {
    rows.push({
      provider,
      label,
      state: provider === "tci_citation" || provider === "tnrr" || provider === "thailis_tdc"
        ? "partner_required"
        : "planned",
      records: 0,
      metadataOnly: 0,
      pageCitable: 0,
      nativeFullPaper: 0,
      sourceHostedFullPaper: null,
      endpointObserved: 0,
      endpointKnown: provider === "tci_citation" ? null : null,
      rights: provider === "tnrr" || provider === "thailis_tdc" || provider === "tci_citation" ? "agreement_required" : "not_assessed",
      freshness: "",
      filter: null,
    });
  }
  return rows;
}

function sortDocuments(docs: DocumentRow[], filter: FeedFilter): DocumentRow[] {
  const copy = [...docs];
  if (filter === "recent") {
    return copy.sort((a, b) => new Date(b.indexed_at ?? b.updated_at ?? 0).getTime() - new Date(a.indexed_at ?? a.updated_at ?? 0).getTime());
  }
  if (filter === "evidence") {
    return copy.sort((a, b) => (b.chunk_count ?? 0) - (a.chunk_count ?? 0));
  }
  return copy.sort((a, b) => hotScore(b) - hotScore(a));
}

function rpcUnavailable(error: { code?: string; message?: string } | null | undefined, functionName: string): boolean {
  const code = (error?.code ?? "").toUpperCase();
  const message = (error?.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42883" || (
    message.includes(functionName.toLowerCase())
    && (message.includes("could not find") || message.includes("does not exist") || message.includes("schema cache"))
  );
}

async function fetchDocumentPage(
  collection: CollectionFilter,
  filter: FeedFilter,
  offset: number,
  limit: number,
): Promise<{ rows: DocumentRow[]; total: number }> {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase.rpc("list_civil_evidence_feed_v1", {
    filter_name: filter === "recent" || filter === "evidence" ? filter : "hot",
    filter_collection: collection || null,
    match_count: limit,
    match_offset: offset,
  });
  if (!error) {
    const rows = (data ?? []) as Array<DocumentRow & { total_count?: number | string }>;
    return { rows, total: Number(rows[0]?.total_count ?? 0) };
  }
  if (!rpcUnavailable(error, "list_civil_evidence_feed_v1")) {
    throw new Error(`Failed to read evidence feed: ${error.message}`);
  }

  // Compatibility for a deployment rolling forward before the additive RPC.
  let query = supabase
    .from("civil_documents_v2")
    .select(DOCUMENT_SELECT, { count: "exact" });
  if (collection) query = query.eq("collection", collection);
  if (filter === "recent") {
    query = query
      .gte("indexed_at", new Date(Date.now() - 45 * 86_400_000).toISOString())
      .order("indexed_at", { ascending: false, nullsFirst: false });
  } else if (filter === "evidence") {
    query = query
      .gte("chunk_count", 6)
      .order("chunk_count", { ascending: false })
      .order("section_count", { ascending: false });
  } else {
    query = query
      .order("chunk_count", { ascending: false })
      .order("section_count", { ascending: false })
      .order("indexed_at", { ascending: false, nullsFirst: false });
  }
  const fallback = await query.range(offset, offset + limit - 1);
  if (fallback.error) throw new Error(`Failed to read evidence feed fallback: ${fallback.error.message}`);
  return { rows: (fallback.data ?? []) as DocumentRow[], total: fallback.count ?? 0 };
}

async function fetchDocumentsByIds(documentIds: string[]): Promise<DocumentRow[]> {
  const ids = [...new Set(documentIds)].slice(0, MAX_QUERY_MATCHES);
  if (!ids.length) return [];
  const supabase = getSupabaseAdmin() as any;
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
  const results = await Promise.all(batches.map((batch) =>
    supabase.from("civil_documents_v2").select(DOCUMENT_SELECT).in("id", batch).limit(batch.length),
  ));
  const rows: DocumentRow[] = [];
  for (const result of results) {
    if (result.error) throw new Error(`Failed to read matched documents: ${result.error.message}`);
    rows.push(...((result.data ?? []) as DocumentRow[]));
  }
  return rows;
}

async function fetchDocumentsBySources(sources: string[]): Promise<DocumentRow[]> {
  const normalized = [...new Set(sources.map((source) => source.trim()).filter(Boolean))].slice(0, 100);
  if (!normalized.length) return [];
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase
    .from("civil_documents_v2")
    .select(DOCUMENT_SELECT)
    .in("source", normalized)
    .limit(normalized.length);
  if (error) throw new Error(`Failed to read matched evidence manifests: ${error.message}`);
  return (data ?? []) as DocumentRow[];
}

type CatalogFacetRow = {
  provider: string;
  records: number | string;
  citable: number | string;
  metadata_only: number | string;
};

type EvidenceFacetRow = {
  total: number | string;
  total_sections: number | string;
  total_chunks: number | string;
  recent: number | string;
  evidence: number | string;
  ncce: number | string;
  ce_project: number | string;
};

type CoverageSnapshotRow = {
  provider: string;
  records: number | string;
  metadata_only: number | string;
  page_citable: number | string;
  native_full_paper: number | string;
  source_hosted_full_paper: number | string;
  endpoint_observed: number | string;
  freshness: string;
};

async function fetchEvidenceFacets(): Promise<EvidenceFacetRow> {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase.rpc("civil_evidence_feed_facets_v1");
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as EvidenceFacetRow | null;
    if (row) return row;
    throw new Error("Evidence facet RPC returned no state.");
  }
  if (!rpcUnavailable(error, "civil_evidence_feed_facets_v1")) {
    throw new Error(`Failed to read evidence facets: ${error.message}`);
  }
  const { data: rows, error: fallbackError } = await supabase
    .from("civil_documents_v2")
    .select("collection,section_count,chunk_count,indexed_at")
    .limit(5000);
  if (fallbackError) throw new Error(`Failed to read evidence facets fallback: ${fallbackError.message}`);
  const threshold = Date.now() - 45 * 86_400_000;
  return (rows ?? []).reduce((totals: EvidenceFacetRow, row: DocumentRow) => {
    totals.total = Number(totals.total) + 1;
    totals.total_sections = Number(totals.total_sections) + Number(row.section_count ?? 0);
    totals.total_chunks = Number(totals.total_chunks) + Number(row.chunk_count ?? 0);
    if (row.indexed_at && new Date(row.indexed_at).getTime() >= threshold) totals.recent = Number(totals.recent) + 1;
    if (Number(row.chunk_count ?? 0) >= 6) totals.evidence = Number(totals.evidence) + 1;
    if (row.collection === "ncce") totals.ncce = Number(totals.ncce) + 1;
    if (row.collection === "ce_project") totals.ce_project = Number(totals.ce_project) + 1;
    return totals;
  }, { total: 0, total_sections: 0, total_chunks: 0, recent: 0, evidence: 0, ncce: 0, ce_project: 0 });
}

async function searchCatalog({
  q,
  provider = "",
  evidenceStatus,
  nativeFirst = false,
  thailandContext = null,
  thaiLanguage = null,
  thaiAffiliated = null,
  limit,
  offset,
}: {
  q: string;
  provider?: string;
  evidenceStatus?: CatalogRow["evidence_status"];
  nativeFirst?: boolean;
  thailandContext?: boolean | null;
  thaiLanguage?: boolean | null;
  thaiAffiliated?: boolean | null;
  limit: number;
  offset: number;
}): Promise<{ rows: CatalogRow[]; total: number }> {
  const supabase = getSupabaseAdmin() as any;
  const v3 = await supabase.rpc("search_civil_source_catalog_public_v3", {
    search_query: q,
    filter_provider: provider || null,
    filter_discipline: null,
    filter_evidence_status: evidenceStatus ?? null,
    filter_thailand_context: thailandContext,
    filter_thai_language: thaiLanguage,
    filter_thai_affiliated: thaiAffiliated,
    native_first: nativeFirst,
    match_count: limit,
    match_offset: offset,
  });
  if (!v3.error) {
    const rows = (v3.data ?? []) as Array<CatalogRow & { total_count?: number | string }>;
    return { rows, total: Number(rows[0]?.total_count ?? 0) };
  }
  if (!rpcUnavailable(v3.error, "search_civil_source_catalog_public_v3")) {
    throw new Error(`Failed to search source catalog: ${v3.error.message}`);
  }
  if (thailandContext != null || thaiLanguage != null || thaiAffiliated != null) {
    throw new Error("Thai research facet filters are unavailable until the v3 catalog migration completes.");
  }
  const v2 = await supabase.rpc("search_civil_source_catalog_public_v2", {
    search_query: q,
    filter_provider: provider || null,
    filter_discipline: null,
    filter_evidence_status: evidenceStatus ?? null,
    native_first: nativeFirst,
    match_count: limit,
    match_offset: offset,
  });
  if (!v2.error) {
    const rows = (v2.data ?? []) as Array<CatalogRow & { total_count?: number | string }>;
    return { rows, total: Number(rows[0]?.total_count ?? 0) };
  }
  if (!rpcUnavailable(v2.error, "search_civil_source_catalog_public_v2")) {
    throw new Error(`Failed to search source catalog: ${v2.error.message}`);
  }
  if (!evidenceStatus && !nativeFirst) {
    const { data, error } = await supabase.rpc("search_civil_source_catalog_public_v1", {
      search_query: q,
      filter_provider: provider || null,
      filter_discipline: null,
      match_count: limit,
      match_offset: offset,
    });
    if (!error) {
      const rows = (data ?? []) as Array<CatalogRow & { total_count?: number | string }>;
      return { rows, total: Number(rows[0]?.total_count ?? 0) };
    }
    if (!rpcUnavailable(error, "search_civil_source_catalog_public_v1")) {
      throw new Error(`Failed to search source catalog: ${error.message}`);
    }
  }
  // Compatibility fallback for environments that have not applied the additive
  // public catalog RPC yet. It remains bounded and never selects abstracts or
  // changes citable status.
  let query = supabase
    .from("civil_source_catalog")
    .select(CATALOG_SELECT, { count: "exact" })
    .neq("evidence_status", "removed")
    .range(offset, offset + limit - 1);
  if (provider) query = query.eq("provider", provider);
  if (evidenceStatus) query = query.eq("evidence_status", evidenceStatus);
  if (nativeFirst) {
    query = query
      .in("evidence_status", ["extracted", "indexed", "metadata_only"])
      .order("evidence_status", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("published_at", { ascending: false, nullsFirst: false });
  }
  if (q) {
    const term = searchContext(q).baseTerms[0] ?? q;
    query = query.or([
      `title_local.ilike.%${term}%`,
      `title_en.ilike.%${term}%`,
      `abstract_local.ilike.%${term}%`,
      `abstract_en.ilike.%${term}%`,
      `journal_title.ilike.%${term}%`,
    ].join(","));
  }
  const fallback = await query;
  if (fallback.error) throw new Error(`Failed to search source catalog: ${fallback.error.message}`);
  return { rows: (fallback.data ?? []) as CatalogRow[], total: fallback.count ?? 0 };
}

async function fetchCatalogFacets(): Promise<CatalogFacetRow[]> {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase.rpc("civil_source_catalog_facets_v1");
  if (!error) return (data ?? []) as CatalogFacetRow[];

  // Source catalog is small in legacy environments. This fallback disappears
  // once the additive RPC reaches every deployment.
  const { data: rows, error: fallbackError } = await supabase
    .from("civil_source_catalog")
    .select("provider,evidence_status,document_id")
    .neq("evidence_status", "removed")
    .limit(5000);
  if (fallbackError) throw new Error(`Failed to read source catalog facets: ${fallbackError.message}`);
  const summary = new Map<string, { records: number; citable: number; metadata_only: number }>();
  for (const row of rows ?? []) {
    const current = summary.get(row.provider) ?? { records: 0, citable: 0, metadata_only: 0 };
    current.records += 1;
    if (row.evidence_status === "indexed" && row.document_id) current.citable += 1;
    if (row.evidence_status === "metadata_only") current.metadata_only += 1;
    summary.set(row.provider, current);
  }
  return [...summary.entries()].map(([provider, counts]) => ({ provider, ...counts }));
}

async function fetchCoverageSnapshots(): Promise<ResearchCoverageSnapshot[]> {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase.rpc("civil_research_coverage_v1");
  if (error && rpcUnavailable(error, "civil_research_coverage_v1")) return [];
  if (error) throw new Error(`Failed to read authoritative research coverage: ${error.message}`);
  return ((data ?? []) as CoverageSnapshotRow[]).map((row) => ({
    provider: row.provider,
    records: Number(row.records ?? 0),
    metadataOnly: Number(row.metadata_only ?? 0),
    pageCitable: Number(row.page_citable ?? 0),
    nativeFullPaper: Number(row.native_full_paper ?? 0),
    sourceHostedFullPaper: Number(row.source_hosted_full_paper ?? 0),
    endpointObserved: Number(row.endpoint_observed ?? 0),
    freshness: row.freshness,
  }));
}

async function fetchDocumentPreviews(
  documentIds: string[],
  sectionsPerDocument = 8,
  chunksPerDocument = 3,
): Promise<{ sections: Map<string, SectionRow[]>; chunks: Map<string, ChunkRow[]> }> {
  const ids = [...new Set(documentIds)].slice(0, 100);
  const sections = new Map<string, SectionRow[]>(ids.map((id) => [id, []]));
  const chunks = new Map<string, ChunkRow[]>(ids.map((id) => [id, []]));
  if (!ids.length) return { sections, chunks };

  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase.rpc("civil_evidence_feed_previews_v1", {
    document_ids: ids,
    sections_per_document: sectionsPerDocument,
    chunks_per_document: chunksPerDocument,
  });
  if (!error) {
    for (const row of (data ?? []) as Array<{ preview_kind?: string; document_id?: string; payload?: unknown }>) {
      if (!row.document_id || !row.payload || typeof row.payload !== "object") continue;
      if (row.preview_kind === "section") sections.get(row.document_id)?.push(row.payload as SectionRow);
      if (row.preview_kind === "chunk") chunks.get(row.document_id)?.push(row.payload as ChunkRow);
    }
    return { sections, chunks };
  }
  if (!rpcUnavailable(error, "civil_evidence_feed_previews_v1")) {
    throw new Error(`Failed to read evidence previews: ${error.message}`);
  }

  // Rolling-deploy fallback: two bounded set queries, never one query per card.
  const [sectionResult, chunkResult] = await Promise.all([
    supabase
      .from("civil_sections_v2")
      .select(SECTION_SELECT)
      .in("document_id", ids)
      .eq("is_stale", false)
      .order("document_id", { ascending: true })
      .order("section_index", { ascending: true }),
    supabase
      .from("civil_chunks_v2")
      .select(CHUNK_SELECT)
      .in("document_id", ids)
      .eq("is_stale", false)
      .order("document_id", { ascending: true })
      .order("section_index", { ascending: true })
      .order("chunk_index", { ascending: true }),
  ]);
  if (sectionResult.error) throw new Error(`Failed to read section previews fallback: ${sectionResult.error.message}`);
  if (chunkResult.error) throw new Error(`Failed to read chunk previews fallback: ${chunkResult.error.message}`);
  for (const row of (sectionResult.data ?? []) as SectionRow[]) {
    const grouped = row.document_id ? sections.get(row.document_id) : null;
    if (grouped && grouped.length < sectionsPerDocument) grouped.push(row);
  }
  for (const row of (chunkResult.data ?? []) as ChunkRow[]) {
    const grouped = row.document_id ? chunks.get(row.document_id) : null;
    if (grouped && grouped.length < chunksPerDocument) grouped.push(row);
  }
  return { sections, chunks };
}

type SearchMatchRow = {
  id?: string;
  document_id?: string;
  section_title?: string | null;
  source?: string | null;
  source_pdf?: string | null;
  paper_code?: string | null;
  discipline?: string | null;
};

type SearchContext = {
  phrase: string;
  baseTerms: string[];
  expandedTerms: string[];
  disciplines: string[];
};

function searchContext(q: string): SearchContext {
  const phrase = q.toLocaleLowerCase("en").replace(/[^\p{L}\p{M}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const lexicalTerms = (phrase.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .filter((term) => term.length >= 2 && !QUERY_STOP_WORDS.has(term));
  const thaiFragments = SEARCH_THAI_FRAGMENTS.filter((term) => phrase.includes(term));
  const baseTerms = [...new Set([...lexicalTerms, ...thaiFragments])]
    .slice(0, 16);
  const expansions: string[] = [];
  const disciplines: string[] = [];

  const addConcept = (terms: string[], discipline?: string) => {
    expansions.push(...terms);
    if (discipline) disciplines.push(discipline);
  };

  if (/road|traffic|transport|mobility|crash|accident|collision|truck|vehicle|ถนน|จราจร|ขนส่ง|อุบัติเหตุ|รถ/.test(phrase)) {
    addConcept(["road", "traffic", "transport", "accident", "crash", "ถนน", "จราจร", "ขนส่ง", "อุบัติเหตุ"], "transport");
  }
  if (/flood|drainage|water|hydraulic|resilien|น้ำท่วม|ระบายน้ำ|อุทก|ชลศาสตร์/.test(phrase)) {
    addConcept(["flood", "drainage", "water", "hydraulic", "น้ำท่วม", "ระบายน้ำ", "อุทก"], "water_resources");
  }
  if (/construction|project|delay|schedule|cost|ก่อสร้าง|โครงการ|ล่าช้า|ระยะเวลา|ต้นทุน/.test(phrase)) {
    addConcept(["construction", "project", "delay", "schedule", "cost", "ก่อสร้าง", "โครงการ", "ล่าช้า", "ต้นทุน"], "construction_mgmt");
  }
  if (/concrete|cement|material|คอนกรีต|ซีเมนต์|วัสดุ/.test(phrase)) {
    addConcept(["concrete", "cement", "material", "คอนกรีต", "ซีเมนต์", "วัสดุ"], "structural");
  }
  if (/(?:^|\s)ai(?:\s|$)|artificial intelligence|ปัญญาประดิษฐ์/.test(phrase)) {
    addConcept(["ai", "artificial", "intelligence", "ปัญญาประดิษฐ์"], "ai_engineering");
  }
  if (/(?:^|\s)(?:elt|efl)(?:\s|$)|english language teaching|ภาษาอังกฤษ/.test(phrase)) {
    addConcept(["elt", "efl", "english", "language", "teaching", "ภาษาอังกฤษ"], "education");
  }
  if (/education|learning|teaching|teacher|student|literacy|classroom|university|school|การศึกษา|การเรียน|การสอน|ครู|นักเรียน/.test(phrase)) {
    addConcept(["education", "learning", "teaching", "teacher", "student", "การศึกษา", "การเรียน", "การสอน"], "education");
  }
  if (/clinical|hospital|patient|health|disease|injur|stroke|birth|therapy|medical|melioidosis|โรงพยาบาล|ผู้ป่วย|สุขภาพ|โรค|การแพทย์/.test(phrase)) {
    addConcept(["clinical", "hospital", "patient", "health", "medical", "โรงพยาบาล", "ผู้ป่วย", "สุขภาพ", "การแพทย์"], "medical_and_health_sciences");
  }
  if (/earthquake|seismic|แผ่นดินไหว/.test(phrase)) {
    addConcept(["earthquake", "seismic", "แผ่นดินไหว"], "structural");
  }

  const baseSet = new Set(baseTerms);
  return {
    phrase,
    baseTerms,
    expandedTerms: [...new Set(expansions)].filter((term) => !baseSet.has(term)).slice(0, 12),
    disciplines: [...new Set(disciplines)],
  };
}

function searchOrFilter(columns: string[], terms: string[]): string {
  return terms.flatMap((term) => columns.map((column) => `${column}.ilike.%${term}%`)).join(",");
}

function fieldIncludesTerm(value: string, term: string): boolean {
  if (/^[a-z0-9]+$/u.test(term)) {
    return new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "u").test(value);
  }
  return value.includes(term);
}

function fieldMatchScore(row: SearchMatchRow, context: SearchContext): number {
  const title = (row.section_title ?? "").toLocaleLowerCase("en");
  const identity = `${row.source ?? ""} ${row.source_pdf ?? ""} ${row.paper_code ?? ""}`.toLocaleLowerCase("en");
  const discipline = (row.discipline ?? "").toLocaleLowerCase("en");
  let score = context.phrase && title.includes(context.phrase) ? 12 : 0;
  score += context.baseTerms.filter((term) => fieldIncludesTerm(title, term)).length * 4;
  score += context.expandedTerms.filter((term) => fieldIncludesTerm(title, term)).length * 1.5;
  score += context.baseTerms.filter((term) => fieldIncludesTerm(identity, term)).length * 4;
  if (context.disciplines.some((candidate) => discipline.includes(candidate))) score += 6;
  return score;
}

async function matchingDocumentScores(q: string, collection: CollectionFilter): Promise<Map<string, number>> {
  const context = searchContext(q);
  if (!context.baseTerms.length) return new Map();

  const supabase = getSupabaseAdmin() as any;
  // Explore stays metadata-fast; semantic full-text retrieval belongs to Chat/MCP.
  const sectionColumns = ["section_title", "source", "paper_code", "discipline"];
  const documentColumns = ["source", "source_pdf", "paper_code", "discipline"];
  // Expanded bilingual concepts must not search `discipline`: a token such as
  // "transport" would otherwise fill the bounded window with every transport
  // paper before a Thai title containing ถนน/อุบัติเหตุ can be seen.
  const expandedSectionColumns = ["section_title", "source", "paper_code"];
  const emptyResult = Promise.resolve({ data: [], error: null });
  const searchSections = (terms: string[]) => {
    if (!terms.length) return emptyResult;
    let query = supabase
      .from("civil_sections_v2")
      .select("document_id,section_title,source,paper_code,discipline")
      .or(searchOrFilter(sectionColumns, terms))
      .eq("is_stale", false)
      .limit(MAX_QUERY_MATCHES);
    if (collection) query = query.eq("collection", collection);
    return query;
  };
  const searchExpandedSections = (terms: string[]) => {
    if (!terms.length) return emptyResult;
    let query = supabase
      .from("civil_sections_v2")
      .select("document_id,section_title,source,paper_code,discipline")
      .or(searchOrFilter(expandedSectionColumns, terms))
      .eq("is_stale", false)
      .limit(MAX_QUERY_MATCHES);
    if (collection) query = query.eq("collection", collection);
    return query;
  };
  const searchDocuments = (terms: string[]) => {
    if (!terms.length) return emptyResult;
    let query = supabase
      .from("civil_documents_v2")
      .select("id,source,source_pdf,paper_code,discipline")
      .or(searchOrFilter(documentColumns, terms))
      .limit(MAX_QUERY_MATCHES);
    if (collection) query = query.eq("collection", collection);
    return query;
  };

  const [baseSections, baseDocuments, expandedSections] = await Promise.all([
    searchSections(context.baseTerms),
    searchDocuments(context.baseTerms),
    searchExpandedSections(context.expandedTerms),
  ]);
  const results = [baseSections, baseDocuments, expandedSections];
  for (const result of results) {
    if (result.error) throw new Error(`Failed to search feed: ${result.error.message}`);
  }

  const aggregates = new Map<string, { baseHits: number; expandedHits: number; fieldScore: number }>();
  const addRows = (rows: SearchMatchRow[], base: boolean) => {
    for (const row of rows) {
      const id = row.document_id ?? row.id;
      if (!id) continue;
      const current = aggregates.get(id) ?? { baseHits: 0, expandedHits: 0, fieldScore: 0 };
      if (base) current.baseHits += 1;
      else current.expandedHits += 1;
      current.fieldScore = Math.max(current.fieldScore, fieldMatchScore(row, context));
      aggregates.set(id, current);
    }
  };
  addRows((baseSections.data ?? []) as SearchMatchRow[], true);
  addRows((baseDocuments.data ?? []) as SearchMatchRow[], true);
  addRows((expandedSections.data ?? []) as SearchMatchRow[], false);

  return new Map(
    [...aggregates.entries()]
      .filter(([, match]) => (match.baseHits > 0 || match.expandedHits > 0)
        && match.fieldScore >= (context.baseTerms.length >= 4 ? 7 : 4))
      .map(([id, match]) => [
        id,
        match.fieldScore + Math.min(match.baseHits, 10) * 0.9 + Math.min(match.expandedHits, 6) * 0.25,
      ]),
  );
}

function facetsFromCounts(
  evidence: EvidenceFacetRow,
  catalogFacets: CatalogFacetRow[],
  visibility: VisibilitySummary = EMPTY_VISIBILITY_SUMMARY,
): ResearchFeedResponse["facets"] {
  const providerCounts = new Map<string, { records: number; citable: number; metadataOnly: number }>();
  const evidenceTotal = Number(evidence.total ?? 0);
  const filters: Record<FeedFilter, number> = {
    hot: evidenceTotal,
    recent: Number(evidence.recent ?? 0),
    evidence: Number(evidence.evidence ?? 0),
    thai: evidenceTotal,
    tci: 0,
    ncce: Number(evidence.ncce ?? 0),
    ce_project: Number(evidence.ce_project ?? 0),
  };

  let catalogTotal = 0;
  let metadataOnlyTotal = 0;
  for (const row of catalogFacets) {
    const records = Number(row.records ?? 0);
    const citable = Number(row.citable ?? 0);
    const metadataOnly = Number(row.metadata_only ?? 0);
    providerCounts.set(row.provider, { records, citable, metadataOnly });
    catalogTotal += records;
    metadataOnlyTotal += metadataOnly;
    if (row.provider === "tci_thaijo") {
      filters.thai += records;
      // Compatibility alias for saved URLs and older clients.
      filters.tci += records;
    }
  }

  const base = {
    total: evidenceTotal,
    totalSections: Number(evidence.total_sections ?? 0),
    totalChunks: Number(evidence.total_chunks ?? 0),
    catalogTotal,
    citableTotal: evidenceTotal,
    metadataOnlyTotal,
    providers: [...providerCounts.entries()].map(([provider, counts]) => ({ provider, ...counts })),
    collections: [
      { collection: "ncce", documents: Number(evidence.ncce ?? 0) },
      { collection: "ce_project", documents: Number(evidence.ce_project ?? 0) },
    ].filter((item) => item.documents > 0),
    filters,
    visibility,
  };
  return { ...base, coverage: buildCoverageLedger(base) };
}

function emptyFacets(): ResearchFeedResponse["facets"] {
  const base = {
    total: 0,
    totalSections: 0,
    totalChunks: 0,
    catalogTotal: 0,
    citableTotal: 0,
    metadataOnlyTotal: 0,
    providers: [],
    collections: [],
    filters: { hot: 0, recent: 0, evidence: 0, thai: 0, tci: 0, ncce: 0, ce_project: 0 },
    visibility: EMPTY_VISIBILITY_SUMMARY,
  };
  return { ...base, coverage: buildCoverageLedger(base) };
}

async function currentFacets(): Promise<ResearchFeedResponse["facets"]> {
  const now = Date.now();
  if (facetCache && facetCache.expiresAt > now) return facetCache.value;
  if (facetRequest) return facetRequest;
  facetRequest = Promise.all([fetchEvidenceFacets(), fetchCatalogFacets(), fetchCoverageSnapshots(), getVisibilitySummary()])
    .then(([evidenceFacets, catalogFacets, snapshots, visibility]) => addReaderPackFacets(
      facetsFromCounts(evidenceFacets, catalogFacets, visibility),
      snapshots,
    ))
    .then((value) => {
      facetCache = { expiresAt: Date.now() + FACET_CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      facetRequest = null;
    });
  return facetRequest;
}

async function attachVisibilityReceipts(cards: ResearchFeedCard[]): Promise<ResearchFeedCard[]> {
  const sources = cards
    .filter((card) => card.provider === "tci_thaijo")
    .map((card) => card.source);
  if (!sources.length) return cards;
  const receipts = await getVisibilityReceipts(sources);
  return cards.map((card) => card.provider === "tci_thaijo"
    ? { ...card, visibility: receipts[card.source] }
    : card);
}

async function searchLocalThaiEvidenceCards(
  q: string,
  collection: CollectionFilter,
  filter: FeedFilter,
  limit: number,
): Promise<ResearchFeedCard[]> {
  if (!q) return [];
  const context = searchContext(q);
  const localCivilDisciplines = new Set(["transport", "water_resources", "construction_mgmt", "structural"]);
  if (context.disciplines.length && !context.disciplines.some((discipline) => localCivilDisciplines.has(discipline))) {
    return [];
  }
  // The checked-in metadata manifests are the fastest trustworthy index for
  // the current local evidence corpus and preserve bilingual titles that are
  // not present on `civil_documents_v2`. Resolve a bounded source list first;
  // use the database lexical path only for newly ingested records that have not
  // reached the generated manifests yet.
  const manifestSources = filterResearchCardsByRelevance(q, Object.entries(PAPER_TITLE_OVERRIDES).map(([source, title]) => ({
    source,
    title,
    summary: PAPER_SUMMARY_OVERRIDES[source] ?? "",
    tags: [],
    authors: [],
  }))).slice(0, Math.min(100, Math.max(limit, limit * 4))).map((card) => card.source);
  if (manifestSources.length) {
    const manifestOrder = new Map(manifestSources.map((source, index) => [source, index]));
    const docs = (await fetchDocumentsBySources(manifestSources))
      .sort((left, right) => (manifestOrder.get(left.source) ?? 1_000) - (manifestOrder.get(right.source) ?? 1_000));
    const previews = await fetchDocumentPreviews(docs.map((doc) => doc.id));
    return filterResearchCardsByRelevance(q, docs.map((doc) => cardFromDocument(
      doc,
      previews.sections.get(doc.id) ?? [],
      previews.chunks.get(doc.id) ?? [],
    ))).slice(0, limit);
  }
  const relevanceScores = await matchingDocumentScores(q, collection);
  const candidateIds = [...relevanceScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.min(MAX_QUERY_MATCHES, Math.max(limit, limit * 4)))
    .map(([id]) => id);
  const docs = await fetchDocumentsByIds(candidateIds);
  const fallbackOrder = new Map(sortDocuments(docs, filter).map((doc, index) => [doc.id, index]));
  const sorted = [...docs].sort((a, b) =>
    (relevanceScores.get(b.id) ?? 0) - (relevanceScores.get(a.id) ?? 0)
    || (fallbackOrder.get(a.id) ?? 0) - (fallbackOrder.get(b.id) ?? 0));
  const previews = await fetchDocumentPreviews(sorted.map((doc) => doc.id));
  return filterResearchCardsByRelevance(q, sorted.map((doc) => cardFromDocument(
    doc,
    previews.sections.get(doc.id) ?? [],
    previews.chunks.get(doc.id) ?? [],
  ))).slice(0, limit);
}

function uniqueCardsBySource(cards: ResearchFeedCard[]): ResearchFeedCard[] {
  const seenSources = new Set<string>();
  const seenWorks = new Set<string>();
  return cards.filter((card) => {
    const workKey = card.doi
      ? `doi:${card.doi.trim().toLocaleLowerCase("en").replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")}`
      : `title:${card.title.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()}`;
    if (seenSources.has(card.source) || seenWorks.has(workKey)) return false;
    seenSources.add(card.source);
    seenWorks.add(workKey);
    return true;
  });
}

export async function listResearchFeed(params: ListFeedParams): Promise<ResearchFeedResponse> {
  const filter = normalizeFeedFilter(params.filter);
  const explicitCollection = normalizeCollection(params.collection === "all" ? "" : params.collection);
  const collection = collectionFromFilter(filter, explicitCollection);
  const provider = normalizeProvider(params.provider);
  const q = normalizeQuery(params.q);
  const limit = normalizeLimit(params.limit);
  const offset = decodeCursor(params.cursor);

  const facetsPromise = params.includeFacets === false
    ? Promise.resolve(emptyFacets())
    : currentFacets();
  const readerCards = rightsReviewedReaderCards(filter, collection, q)
    .filter((card) => !provider || card.provider === provider);
  if (filter === "thai" || filter === "tci") {
    const catalogProvider = provider || "tci_thaijo";
    const catalogMatchLimit = q ? Math.min(30, Math.max(limit, limit * 4)) : limit;
    // A Thai-published query is broader than ThaiJO. Search the bounded local
    // evidence corpus in parallel so Thai conference and university deposits
    // can win on relevance without admitting the PMC global-comparison cohort.
    // Provider-specific and paginated calls retain their stable catalog page.
    const localEvidenceCardsPromise = filter === "thai" && !provider && offset === 0
      ? searchLocalThaiEvidenceCards(q, collection, filter, catalogMatchLimit)
      : Promise.resolve([]);
    const catalogPagePromise = searchCatalog({
      q,
      provider: catalogProvider,
      nativeFirst: true,
      thailandContext: params.thailandContext,
      thaiLanguage: params.thaiLanguage,
      thaiAffiliated: params.thaiAffiliated,
      limit: catalogMatchLimit,
      offset,
    });
    // Start per-card receipts as soon as the bounded catalog page resolves.
    // This keeps the trust layer without adding a serial database round trip
    // after the slower aggregate facets have completed.
    const visibleCatalogCardsPromise = catalogPagePromise.then((page) =>
      filterResearchCardsByRelevance(q, page.rows.map(cardFromCatalog)),
    );
    const [facets, catalogPage, visibleCatalogCards, localEvidenceCards] = await Promise.all([
      facetsPromise,
      catalogPagePromise,
      visibleCatalogCardsPromise,
      localEvidenceCardsPromise,
    ]);
    const hasAuthoritativeNative = facets.coverage.some((row) => row.nativeFullPaper > 0);
    if (hasAuthoritativeNative) {
      const nextOffset = offset + catalogPage.rows.length;
      const cards = filterResearchCardsByRelevance(
        q,
        uniqueCardsBySource([...readerCards, ...localEvidenceCards, ...visibleCatalogCards]),
      ).slice(0, limit);
      return {
        cards: await attachVisibilityReceipts(cards),
        facets,
        nextCursor: nextOffset < catalogPage.total ? encodeCursor(nextOffset) : null,
        generatedAt: new Date().toISOString(),
      };
    }
    const readerSlice = readerCards.slice(offset, offset + limit);
    const catalogOffset = Math.max(0, offset - readerCards.length);
    const remaining = Math.max(0, limit - readerSlice.length);
    const fallbackCatalogPage = catalogOffset === offset && remaining === limit
      ? catalogPage
      : await searchCatalog({ q, provider: catalogProvider, evidenceStatus: undefined, limit: Math.max(1, remaining), offset: catalogOffset });
    const cards = [
      ...readerSlice,
      ...fallbackCatalogPage.rows.slice(0, remaining).map(cardFromCatalog),
    ];
    const nextOffset = offset + limit;
    return {
      cards: await attachVisibilityReceipts(cards),
      facets,
      nextCursor: nextOffset < readerCards.length + fallbackCatalogPage.total ? encodeCursor(nextOffset) : null,
      generatedAt: new Date().toISOString(),
    };
  }

  if (!q) {
    const readerSlice = readerCards.slice(offset, offset + limit);
    const documentOffset = Math.max(0, offset - readerCards.length);
    const remaining = Math.max(0, limit - readerSlice.length);
    const [facets, page] = await Promise.all([
      facetsPromise,
      fetchDocumentPage(collection, filter, documentOffset, Math.max(1, remaining)),
    ]);
    const previews = await fetchDocumentPreviews(page.rows.map((doc) => doc.id));
    const cards = [
      ...readerSlice,
      ...page.rows.slice(0, remaining).map((doc) => cardFromDocument(
        doc,
        previews.sections.get(doc.id) ?? [],
        previews.chunks.get(doc.id) ?? [],
      )),
    ];
    const nextOffset = offset + limit;
    return {
      cards: await attachVisibilityReceipts(cards),
      facets,
      nextCursor: nextOffset < readerCards.length + page.total ? encodeCursor(nextOffset) : null,
      generatedAt: new Date().toISOString(),
    };
  }

  const [facets, relevanceScores] = await Promise.all([facetsPromise, matchingDocumentScores(q, collection)]);
  const candidateIds = [...relevanceScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_QUERY_MATCHES)
    .map(([id]) => id);
  const docs = await fetchDocumentsByIds(candidateIds);
  const fallbackOrder = new Map(sortDocuments(docs, filter).map((doc, index) => [doc.id, index]));
  const sorted = [...docs].sort((a, b) =>
    (relevanceScores.get(b.id) ?? 0) - (relevanceScores.get(a.id) ?? 0)
    || (fallbackOrder.get(a.id) ?? 0) - (fallbackOrder.get(b.id) ?? 0));
  const catalogMatches = !collection && (filter === "hot" || filter === "evidence")
    ? (await searchCatalog({
      q,
      provider,
      evidenceStatus: filter === "evidence" ? "extracted" : undefined,
      limit: Math.min(30, limit * 2),
      offset: 0,
    })).rows
    : [];
  const combined: Array<
    { kind: "reader"; card: ResearchFeedCard }
    | { kind: "evidence"; document: DocumentRow }
    | { kind: "catalog"; record: CatalogRow }
  > = readerCards.map((card) => ({ kind: "reader", card }));
  let catalogIndex = 0;
  sorted.forEach((document, index) => {
    combined.push({ kind: "evidence", document });
    if ((index + 1) % 3 === 0 && catalogIndex < catalogMatches.length) {
      combined.push({ kind: "catalog", record: catalogMatches[catalogIndex] });
      catalogIndex += 1;
    }
  });
  while (catalogIndex < catalogMatches.length) {
    combined.push({ kind: "catalog", record: catalogMatches[catalogIndex] });
    catalogIndex += 1;
  }

  // Natural-language research goals carry several constraints. Scan a bounded
  // candidate window so the first page is not filled with one-token matches
  // (for example any civil paper that merely mentions “AI”), then return only
  // cards that satisfy multiple independent topic signals. Short keyword
  // searches keep ordinary cursor density.
  const querySignalCount = searchContext(q).baseTerms.length;
  const candidateWindowSize = querySignalCount >= 4 ? Math.min(60, limit * 4) : limit;
  const page = combined.slice(offset, offset + candidateWindowSize);
  const pageDocumentIds = page
    .filter((item): item is { kind: "evidence"; document: DocumentRow } => item.kind === "evidence")
    .map((item) => item.document.id);
  const previews = await fetchDocumentPreviews(pageDocumentIds);
  const candidateCards = page.map((item) =>
    item.kind === "reader"
      ? item.card
      : item.kind === "catalog"
      ? cardFromCatalog(item.record)
      : cardFromDocument(
        item.document,
        previews.sections.get(item.document.id) ?? [],
        previews.chunks.get(item.document.id) ?? [],
      ));
  const cards = filterResearchCardsByRelevance(q, candidateCards).slice(0, limit);
  const nextOffset = offset + page.length;

  return {
    cards: await attachVisibilityReceipts(cards),
    facets,
    nextCursor: nextOffset < combined.length ? encodeCursor(nextOffset) : null,
    generatedAt: new Date().toISOString(),
  };
}

async function findDocumentBySource(source: string): Promise<DocumentRow | null> {
  const supabase = getSupabaseAdmin() as any;
  const trimmed = source.trim();
  if (!trimmed) return null;

  const queries = [
    supabase.from("civil_documents_v2").select(DOCUMENT_SELECT).eq("source", trimmed).maybeSingle(),
    supabase.from("civil_documents_v2").select(DOCUMENT_SELECT).eq("source_pdf", trimmed).maybeSingle(),
    supabase.from("civil_documents_v2").select(DOCUMENT_SELECT).eq("paper_code", trimmed).maybeSingle(),
  ];

  for (const query of queries) {
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read paper detail: ${error.message}`);
    if (data) return data as DocumentRow;
  }

  return null;
}

export async function getResearchCardsBySources(sources: string[]): Promise<ResearchFeedCard[]> {
  const normalized = [...new Set(sources.map((source) => source.trim()).filter(Boolean))].slice(0, 100);
  if (!normalized.length) return [];
  const readerCards = new Map<string, ResearchFeedCard>();
  const databaseSources: string[] = [];
  for (const source of normalized) {
    const paper = findRightsReviewedReaderPaper(source);
    if (paper) readerCards.set(source, cardFromRightsReviewedReaderPaper(paper));
    else databaseSources.push(source);
  }
  if (!databaseSources.length) {
    return normalized.map((source) => readerCards.get(source)).filter((card): card is ResearchFeedCard => Boolean(card));
  }
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase
    .from("civil_documents_v2")
    .select(DOCUMENT_SELECT)
    .in("source", databaseSources)
    .limit(databaseSources.length);
  if (error) throw new Error(`Failed to read saved papers: ${error.message}`);
  const docs = (data ?? []) as DocumentRow[];
  const documentIds = docs.map((doc) => doc.id);
  const previews = await fetchDocumentPreviews(documentIds, 4, 2);
  const cards = new Map<string, ResearchFeedCard>(
    docs.map((doc) => [
      doc.source,
      cardFromDocument(doc, previews.sections.get(doc.id) ?? [], previews.chunks.get(doc.id) ?? []),
    ]),
  );
  for (const [source, card] of readerCards) cards.set(source, card);
  return normalized.map((source) => cards.get(source)).filter((card): card is ResearchFeedCard => Boolean(card));
}

async function relatedResearchCards(doc: DocumentRow, limit = 4): Promise<ResearchFeedCard[]> {
  const discipline = doc.discipline?.trim();
  if (!discipline) return [];
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase
    .from("civil_documents_v2")
    .select(DOCUMENT_SELECT)
    .eq("discipline", discipline)
    .neq("id", doc.id)
    .order("chunk_count", { ascending: false })
    .order("section_count", { ascending: false })
    .order("indexed_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(limit, 8)));
  if (error) throw new Error(`Failed to read related papers: ${error.message}`);
  const docs = (data ?? []) as DocumentRow[];
  const documentIds = docs.map((candidate) => candidate.id);
  const previews = await fetchDocumentPreviews(documentIds, 3, 1);
  return docs.map((candidate) =>
    cardFromDocument(candidate, previews.sections.get(candidate.id) ?? [], previews.chunks.get(candidate.id) ?? []));
}

export type PaperEvidenceTarget = {
  id?: string | null;
  sectionIndex?: number | null;
  chunkIndex?: number | null;
  pageStart?: number | null;
};

function readerSectionTitle(page: RightsReviewedReaderPage): string {
  const candidate = cleanText(page.sectionTitle, 120);
  const heading = candidate.replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim();
  if (/^(?:abstract|introduction|background|literature review|related work|research questions?|methodology|methods?|materials and methods|results?|findings?|results? and discussion|discussion|limitations?|conclusions?|conclusion and recommendations?|acknowledgements?|references?|appendix|บทคัดย่อ|บทนำ|ทบทวนวรรณกรรม|ระเบียบวิธีวิจัย|วิธีดำเนินการวิจัย|ผลการวิจัย|ผลการศึกษา|อภิปรายผล|ข้อจำกัด|สรุป|ข้อเสนอแนะ|เอกสารอ้างอิง)$/i.test(heading)) return heading;
  return `Page ${page.pageLabel}`;
}

function paperDetailFromRightsReviewedReaderPaper(
  paper: RightsReviewedReaderPaper,
  includeRelated: boolean,
  evidenceTarget?: PaperEvidenceTarget,
): PaperDetailResponse {
  const document = cardFromRightsReviewedReaderPaper(paper);
  const sections: PaperSection[] = paper.pages.map((page) => {
    const sourcePage = readerSourcePageNumber(page);
    return {
      id: `section:${page.id}`,
      sectionIndex: page.pageNumber - 1,
      title: readerSectionTitle(page),
      pageStart: sourcePage,
      pageEnd: sourcePage,
      snippet: cleanText(page.text, 280),
    };
  });
  const evidence = paper.pages.map((page): PaperEvidence => {
    const sourcePage = readerSourcePageNumber(page);
    return {
      id: page.id,
      sectionIndex: page.pageNumber - 1,
      chunkIndex: 0,
      sectionTitle: readerSectionTitle(page),
      pageStart: sourcePage,
      pageEnd: sourcePage,
      snippet: cleanText(page.text, 360),
      readerPageNumber: page.pageNumber,
      readerAnchor: readerStableAnchor(paper, page),
    };
  });
  const targetIndex = evidence.findIndex((item) =>
    (evidenceTarget?.id && item.id === evidenceTarget.id)
    || (evidenceTarget?.pageStart != null && item.pageStart === evidenceTarget.pageStart)
    || (
      evidenceTarget?.sectionIndex != null
      && item.sectionIndex === evidenceTarget.sectionIndex
      && (evidenceTarget.chunkIndex == null || item.chunkIndex === evidenceTarget.chunkIndex)
    ));
  if (targetIndex > 0) evidence.unshift(...evidence.splice(targetIndex, 1));
  const related = includeRelated
    ? listRightsReviewedReaderPapers()
      .filter((candidate) => candidate.source !== paper.source)
      .map(cardFromRightsReviewedReaderPaper)
    : [];
  return {
    document,
    sections,
    evidence,
    counts: { sections: sections.length, chunks: evidence.length },
    related,
    generatedAt: new Date().toISOString(),
  };
}

export async function getPaperDetail(
  source: string,
  includeRelated = false,
  evidenceTarget?: PaperEvidenceTarget,
): Promise<PaperDetailResponse | null> {
  const decodedSource = decodeURIComponent(source);
  const readerPaper = findRightsReviewedReaderPaper(decodedSource);
  if (readerPaper) return paperDetailFromRightsReviewedReaderPaper(readerPaper, includeRelated, evidenceTarget);
  const doc = await findDocumentBySource(decodedSource);
  if (!doc) {
    const supabase = getSupabaseAdmin() as any;
    const attempts: Array<["id" | "provider_record_id" | "canonical_url", string]> = [
      ["id", decodedSource],
      ["provider_record_id", decodedSource],
    ];
    if (/^https:\/\//i.test(decodedSource)) attempts.push(["canonical_url", decodedSource]);
    let catalog: CatalogRow | null = null;
    for (const [field, value] of attempts) {
      const result = await supabase
        .from("civil_source_catalog")
        .select(CATALOG_SELECT)
        .eq(field, value)
        .neq("evidence_status", "removed")
        .limit(1);
      if (result.error) throw new Error(`Failed to resolve catalog paper detail: ${result.error.message}`);
      if (result.data?.[0]) {
        catalog = result.data[0] as CatalogRow;
        break;
      }
    }
    if (!catalog) return null;
    const reader = await getPaperReader({
      source: decodedSource,
      provider: catalog.provider,
      page: 1,
      limit: 10,
    });
    const document = cardFromCatalog(catalog);
    const nativePages = reader?.access.mode === "native_verified" ? reader.pages : [];
    const totalPages = reader?.pagination.totalPages ?? reader?.asset?.pageCount ?? nativePages.length;
    if (reader?.access.mode === "native_verified") {
      document.pages = totalPages ?? nativePages.length;
      document.evidenceCount = totalPages ?? nativePages.length;
      document.pageLabel = `${totalPages ?? nativePages.length} verified pages`;
      document.pageStart = nativePages[0]?.pageNumber ?? 1;
      document.pageEnd = totalPages ?? nativePages.at(-1)?.pageNumber ?? null;
    }
    const pageNumber = (label: string, fallback: number) => {
      const parsed = Number.parseInt(label, 10);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const sections: PaperSection[] = nativePages.map((page) => ({
      id: `section:${page.id}`,
      sectionIndex: page.pageNumber - 1,
      title: page.sectionTitle || `Page ${page.pageLabel}`,
      pageStart: pageNumber(page.pageLabel, page.pageNumber),
      pageEnd: pageNumber(page.pageLabel, page.pageNumber),
      snippet: cleanText(page.text, 280),
    }));
    const evidence: PaperEvidence[] = nativePages.map((page) => ({
      id: page.id,
      sectionIndex: page.pageNumber - 1,
      chunkIndex: 0,
      sectionTitle: page.sectionTitle || `Page ${page.pageLabel}`,
      pageStart: pageNumber(page.pageLabel, page.pageNumber),
      pageEnd: pageNumber(page.pageLabel, page.pageNumber),
      snippet: cleanText(page.text, 360),
      readerPageNumber: page.pageNumber,
      readerAnchor: page.anchor,
    }));
    const targetIndex = evidence.findIndex((item) =>
      (evidenceTarget?.id && item.id === evidenceTarget.id)
      || (evidenceTarget?.pageStart != null && item.pageStart === evidenceTarget.pageStart)
      || (
        evidenceTarget?.sectionIndex != null
        && item.sectionIndex === evidenceTarget.sectionIndex
        && (evidenceTarget.chunkIndex == null || item.chunkIndex === evidenceTarget.chunkIndex)
      ));
    if (targetIndex > 0) evidence.unshift(...evidence.splice(targetIndex, 1));
    return {
      document,
      sections,
      evidence,
      counts: {
        sections: reader?.access.mode === "native_verified" ? totalPages ?? sections.length : 0,
        chunks: reader?.access.mode === "native_verified" ? totalPages ?? evidence.length : 0,
      },
      related: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const supabase = getSupabaseAdmin() as any;
  const emptyTarget = Promise.resolve({ data: [], error: null });
  const targetById = evidenceTarget?.id
    ? supabase
      .from("civil_chunks_v2")
      .select(CHUNK_SELECT)
      .eq("document_id", doc.id)
      .eq("is_stale", false)
      .eq("id", evidenceTarget.id)
      .limit(1)
    : emptyTarget;
  const hasPositionTarget = Boolean(
    evidenceTarget?.sectionIndex != null
    || evidenceTarget?.chunkIndex != null
    || evidenceTarget?.pageStart != null,
  );
  let targetByPosition = supabase
    .from("civil_chunks_v2")
    .select(CHUNK_SELECT)
    .eq("document_id", doc.id)
    .eq("is_stale", false);
  if (evidenceTarget?.sectionIndex != null) targetByPosition = targetByPosition.eq("section_index", evidenceTarget.sectionIndex);
  if (evidenceTarget?.chunkIndex != null) targetByPosition = targetByPosition.eq("chunk_index", evidenceTarget.chunkIndex);
  if (evidenceTarget?.pageStart != null) targetByPosition = targetByPosition.eq("page_start", evidenceTarget.pageStart);

  const [sectionsResult, chunksResult, targetIdResult, targetPositionResult, related] = await Promise.all([
    supabase
      .from("civil_sections_v2")
      .select(SECTION_SELECT)
      .eq("document_id", doc.id)
      .eq("is_stale", false)
      .order("section_index", { ascending: true })
      .limit(80),
    supabase
      .from("civil_chunks_v2")
      .select(CHUNK_SELECT)
      .eq("document_id", doc.id)
      .eq("is_stale", false)
      .order("section_index", { ascending: true })
      .order("chunk_index", { ascending: true })
      .limit(16),
    targetById,
    hasPositionTarget ? targetByPosition.limit(1) : emptyTarget,
    includeRelated ? relatedResearchCards(doc) : Promise.resolve([]),
  ]);

  if (sectionsResult.error) throw new Error(`Failed to read paper sections: ${sectionsResult.error.message}`);
  if (chunksResult.error) throw new Error(`Failed to read paper evidence: ${chunksResult.error.message}`);
  if (targetIdResult.error) throw new Error(`Failed to read cited evidence: ${targetIdResult.error.message}`);
  if (targetPositionResult.error) throw new Error(`Failed to read cited evidence fallback: ${targetPositionResult.error.message}`);

  const sections = (sectionsResult.data ?? []) as SectionRow[];
  const seenChunkIds = new Set<string>();
  const chunks = ([
    ...(targetIdResult.data ?? []),
    ...(targetPositionResult.data ?? []),
    ...(chunksResult.data ?? []),
  ] as ChunkRow[]).filter((chunk) => {
    if (seenChunkIds.has(chunk.id)) return false;
    seenChunkIds.add(chunk.id);
    return true;
  });
  const document = cardFromDocument(doc, sections.slice(0, 10), chunks.slice(0, 5));

  return {
    document,
    sections: sections.map((section) => ({
      id: section.id,
      sectionIndex: section.section_index ?? null,
      title: section.section_title && !isNoisyTitle(section.section_title) ? cleanText(section.section_title, 180) : `Section ${section.section_index ?? "?"}`,
      pageStart: section.page_start,
      pageEnd: section.page_end,
      snippet: cleanText(section.content, 280),
    })),
    evidence: chunks.map((chunk) => ({
      id: chunk.id,
      sectionIndex: chunk.section_index ?? null,
      chunkIndex: chunk.chunk_index ?? null,
      sectionTitle: chunk.section_title ? cleanText(chunk.section_title, 180) : null,
      pageStart: chunk.page_start,
      pageEnd: chunk.page_end,
      snippet: cleanText(chunk.content, 360),
    })),
    counts: {
      sections: doc.section_count ?? sections.length,
      chunks: doc.chunk_count ?? chunks.length,
    },
    related,
    generatedAt: new Date().toISOString(),
  };
}

export async function listPublicPaperRecordsForSitemap(): Promise<Array<{ source: string; updatedAt: string | null }>> {
  const records: Array<{ source: string; updatedAt: string | null }> = listRightsReviewedReaderPapers().map((paper) => ({
    source: paper.source,
    updatedAt: paper.asset.rightsVerifiedAt,
  }));
  let supabase: any;
  try {
    supabase = getSupabaseAdmin() as any;
  } catch {
    // The committed, rights-reviewed reader pack is still a valid public
    // sitemap surface in preview/build environments without database secrets.
    return records;
  }
  for (let offset = 0; offset < 2_000; offset += 1_000) {
    const { data, error } = await supabase
      .from("civil_documents_v2")
      .select("source,updated_at")
      .order("source", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Failed to build public paper sitemap: ${error.message}`);
    const rows = (data ?? []) as Array<{ source?: unknown; updated_at?: unknown }>;
    records.push(...rows.flatMap((row) => typeof row.source === "string" && row.source.trim()
      ? [{ source: row.source, updatedAt: typeof row.updated_at === "string" ? row.updated_at : null }]
      : []));
    if (rows.length < 1_000) break;
  }
  return [...new Map(records.map((record) => [record.source, record])).values()];
}
