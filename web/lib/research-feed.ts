import { Buffer } from "node:buffer";

import { createClient } from "@supabase/supabase-js";

import { PAPER_SUMMARY_OVERRIDES } from "./paper-summary-overrides";
import { PAPER_TITLE_OVERRIDES } from "./paper-title-overrides";

export type FeedFilter = "hot" | "recent" | "evidence" | "ncce" | "ce_project";
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
};

export type ResearchFeedResponse = {
  cards: ResearchFeedCard[];
  facets: {
    total: number;
    collections: Array<{ collection: string; documents: number }>;
    filters: Record<FeedFilter, number>;
  };
  nextCursor: string | null;
  generatedAt: string;
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
};

export type PaperDetailResponse = {
  document: ResearchFeedCard;
  sections: PaperSection[];
  evidence: PaperEvidence[];
  counts: {
    sections: number;
    chunks: number;
  };
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

type ListFeedParams = {
  filter?: string | null;
  collection?: string | null;
  q?: string | null;
  limit?: string | number | null;
  cursor?: string | null;
};

const DOCUMENT_SELECT =
  "id, source, source_pdf, collection, source_type, parent_source_pdf, paper_code, page_start, page_end, proceeding_no, proceeding_year, discipline, section_count, chunk_count, indexed_at, created_at, updated_at";
const SECTION_SELECT = "id, document_id, source, collection, paper_code, page_start, page_end, discipline, section_index, section_title, content";
const CHUNK_SELECT = "id, document_id, section_id, source, collection, paper_code, page_start, page_end, section_index, section_title, chunk_index, content";
const MAX_DOCS_FOR_FEED = 1200;
const MAX_QUERY_MATCHES = 500;

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
  return value === "recent" || value === "evidence" || value === "ncce" || value === "ce_project" ? value : "hot";
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
  if (/^(keywords?|key words?|ค[ํำ]าส[ํำ]าคัญ|คำสำคัญ|บทคัดยอ|บพคัดย่อ)\b/i.test(title)) return true;
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
    if (/^(keywords?|คำสำคัญ|1\s*บท|บทนำ|introduction)\b/i.test(cleaned)) break;
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
  const summary = cleanText(candidate ?? "", 520);
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
  if (!value) return "ไม่ระบุวันที่";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ไม่ระบุวันที่";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function collectionLabel(value: CollectionFilter): string {
  if (value === "ncce") return "NCCE";
  if (value === "ce_project") return "CE Project";
  return "All";
}

function disciplineLabel(value: string | null | undefined): string {
  const cleaned = (value ?? "").trim();
  const labels: Record<string, string> = {
    transport: "Transport",
    structural: "Structural",
    geotechnical: "Geotechnical",
    construction_mgmt: "Construction Mgmt",
  };
  return labels[cleaned] ?? cleaned;
}

function deriveTags(doc: DocumentRow, sections: SectionRow[], title: string): string[] {
  const terms = new Set<string>();
  const collection = normalizeCollection(doc.collection);
  if (collection) terms.add(collectionLabel(collection));
  if (doc.discipline) terms.add(disciplineLabel(doc.discipline));
  if (doc.paper_code) terms.add(doc.paper_code);
  if (doc.proceeding_no) terms.add(`NCCE${doc.proceeding_no}`);
  if (doc.proceeding_year) terms.add(`พ.ศ. ${doc.proceeding_year}`);

  const haystack = `${title} ${sections.slice(0, 5).map((section) => `${section.section_title ?? ""} ${section.content ?? ""}`).join(" ")}`;
  const keywordMap: Array<[RegExp, string]> = [
    [/คอนกรีต|concrete|cement|reinforced/i, "Concrete"],
    [/โครงสร้าง|structural|beam|column|seismic/i, "Structural"],
    [/ขนส่ง|traffic|transport|intersection|road/i, "Transport"],
    [/น้ำท่วม|flood|drainage|hydraulic|hec-ras/i, "Water"],
    [/ดิน|soil|geotech|slope|foundation/i, "Geotechnical"],
    [/วิธี|method|experiment|model|แบบจำลอง/i, "Method"],
  ];
  for (const [pattern, tag] of keywordMap) {
    if (pattern.test(haystack)) terms.add(tag);
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

function previewUrlForSource(source: string): string {
  return `/paper-previews/${previewSlug(source)}.jpg`;
}

function hotScore(doc: DocumentRow): number {
  const indexed = doc.indexed_at ? new Date(doc.indexed_at).getTime() : 0;
  const ageDays = indexed ? Math.max(0, (Date.now() - indexed) / 86_400_000) : 365;
  const recencyBoost = Math.max(0, 45 - Math.min(ageDays, 45));
  return (doc.chunk_count ?? 0) * 2 + (doc.section_count ?? 0) * 1.2 + recencyBoost;
}

function filtersForDoc(doc: DocumentRow): FeedFilter[] {
  const filters: FeedFilter[] = ["hot"];
  const ageDays = doc.indexed_at ? Math.max(0, (Date.now() - new Date(doc.indexed_at).getTime()) / 86_400_000) : 365;
  if (ageDays <= 45) filters.push("recent");
  if ((doc.chunk_count ?? 0) >= 6) filters.push("evidence");
  const collection = normalizeCollection(doc.collection);
  if (collection) filters.push(collection);
  return [...new Set(filters)];
}

function buildPrompt(card: Pick<ResearchFeedCard, "title" | "source" | "collection" | "paperCode">): string {
  const collection = card.collection ? `ในชุด ${collectionLabel(card.collection)}` : "";
  const paper = card.paperCode ? ` (${card.paperCode})` : "";
  return `สรุป paper นี้${paper}: ${card.title} ${collection} พร้อมทำ Research Brief และอ้างหลักฐานจากเอกสาร ${card.source}`.trim();
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
    date: formatDate(doc.indexed_at ?? doc.updated_at ?? doc.created_at),
    sourceLabel: [collectionLabel(collection), disciplineLabel(doc.discipline), doc.source_type].filter(Boolean).join(" · "),
    summary,
    tags: deriveTags(doc, sections, title),
    filters: filtersForDoc(doc),
    evidenceCount: doc.chunk_count ?? 0,
    pages: pageCount(doc),
    pageLabel: previewPageLabel(doc),
    preview: derivePreview(doc, title),
    previewUrl: previewUrlForSource(doc.source),
    prompt: "",
    indexedAt: doc.indexed_at,
  };
  return { ...card, prompt: buildPrompt(card) };
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

async function fetchDocuments(collection: CollectionFilter): Promise<DocumentRow[]> {
  const supabase = getSupabaseAdmin() as any;
  let query = supabase
    .from("civil_documents_v2")
    .select(DOCUMENT_SELECT)
    .order("indexed_at", { ascending: false, nullsFirst: false })
    .limit(MAX_DOCS_FOR_FEED);

  if (collection) query = query.eq("collection", collection);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to read documents: ${error.message}`);
  return (data ?? []) as DocumentRow[];
}

async function fetchSectionsForDocuments(documentIds: string[], perDocument = 8): Promise<Map<string, SectionRow[]>> {
  const grouped = new Map<string, SectionRow[]>();
  if (!documentIds.length) return grouped;

  const supabase = getSupabaseAdmin() as any;
  const results = await Promise.all(
    documentIds.map((documentId) =>
      supabase
        .from("civil_sections_v2")
        .select(SECTION_SELECT)
        .eq("document_id", documentId)
        .eq("is_stale", false)
        .order("section_index", { ascending: true })
        .limit(perDocument),
    ),
  );

  results.forEach((result, index) => {
    if (result.error) throw new Error(`Failed to read sections: ${result.error.message}`);
    grouped.set(documentIds[index], (result.data ?? []) as SectionRow[]);
  });
  return grouped;
}

async function fetchChunksForDocuments(documentIds: string[], perDocument = 3): Promise<Map<string, ChunkRow[]>> {
  const grouped = new Map<string, ChunkRow[]>();
  if (!documentIds.length) return grouped;

  const supabase = getSupabaseAdmin() as any;
  const results = await Promise.all(
    documentIds.map((documentId) =>
      supabase
        .from("civil_chunks_v2")
        .select(CHUNK_SELECT)
        .eq("document_id", documentId)
        .eq("is_stale", false)
        .order("section_index", { ascending: true })
        .order("chunk_index", { ascending: true })
        .limit(perDocument),
    ),
  );

  results.forEach((result, index) => {
    if (result.error) throw new Error(`Failed to read chunk previews: ${result.error.message}`);
    grouped.set(documentIds[index], (result.data ?? []) as ChunkRow[]);
  });
  return grouped;
}

async function matchingDocumentIds(q: string, collection: CollectionFilter): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!q) return ids;

  const supabase = getSupabaseAdmin() as any;
  const pattern = `%${q}%`;
  const sectionQueries = ["section_title", "content", "source", "paper_code"].map((column) => {
    let query = supabase
      .from("civil_sections_v2")
      .select("document_id")
      .ilike(column, pattern)
      .eq("is_stale", false)
      .limit(MAX_QUERY_MATCHES);
    if (collection) query = query.eq("collection", collection);
    return query;
  });
  const docQueries = ["source", "source_pdf", "paper_code", "discipline"].map((column) => {
    let query = supabase.from("civil_documents_v2").select("id").ilike(column, pattern).limit(MAX_QUERY_MATCHES);
    if (collection) query = query.eq("collection", collection);
    return query;
  });

  const results = await Promise.all([...sectionQueries, ...docQueries]);
  for (const result of results) {
    if (result.error) throw new Error(`Failed to search feed: ${result.error.message}`);
    for (const row of result.data ?? []) {
      const id = (row as { document_id?: string; id?: string }).document_id ?? (row as { id?: string }).id;
      if (id) ids.add(id);
    }
  }
  return ids;
}

function facetsFromDocuments(docs: DocumentRow[]): ResearchFeedResponse["facets"] {
  const collections = new Map<string, number>();
  const filters: Record<FeedFilter, number> = {
    hot: docs.length,
    recent: 0,
    evidence: 0,
    ncce: 0,
    ce_project: 0,
  };

  for (const doc of docs) {
    const collection = normalizeCollection(doc.collection) || "unknown";
    collections.set(collection, (collections.get(collection) ?? 0) + 1);
    for (const filter of filtersForDoc(doc)) {
      filters[filter] += filter === "hot" ? 0 : 1;
    }
  }

  return {
    total: docs.length,
    collections: [...collections.entries()].map(([collection, documents]) => ({ collection, documents })),
    filters,
  };
}

export async function listResearchFeed(params: ListFeedParams): Promise<ResearchFeedResponse> {
  const filter = normalizeFeedFilter(params.filter);
  const explicitCollection = normalizeCollection(params.collection === "all" ? "" : params.collection);
  const collection = collectionFromFilter(filter, explicitCollection);
  const q = normalizeQuery(params.q);
  const limit = normalizeLimit(params.limit);
  const offset = decodeCursor(params.cursor);

  let docs = await fetchDocuments(collection);
  if (q) {
    const matches = await matchingDocumentIds(q, collection);
    docs = docs.filter((doc) => matches.has(doc.id));
  }

  const facets = facetsFromDocuments(docs);
  const sorted = sortDocuments(docs, filter);
  const page = sorted.slice(offset, offset + limit);
  const pageDocumentIds = page.map((doc) => doc.id);
  const [sectionsByDoc, chunksByDoc] = await Promise.all([
    fetchSectionsForDocuments(pageDocumentIds),
    fetchChunksForDocuments(pageDocumentIds),
  ]);
  const cards = page.map((doc) => cardFromDocument(doc, sectionsByDoc.get(doc.id) ?? [], chunksByDoc.get(doc.id) ?? []));
  const nextOffset = offset + limit;

  return {
    cards,
    facets,
    nextCursor: nextOffset < sorted.length ? encodeCursor(nextOffset) : null,
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

export async function getPaperDetail(source: string): Promise<PaperDetailResponse | null> {
  const doc = await findDocumentBySource(decodeURIComponent(source));
  if (!doc) return null;

  const supabase = getSupabaseAdmin() as any;
  const [sectionsResult, chunksResult] = await Promise.all([
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
  ]);

  if (sectionsResult.error) throw new Error(`Failed to read paper sections: ${sectionsResult.error.message}`);
  if (chunksResult.error) throw new Error(`Failed to read paper evidence: ${chunksResult.error.message}`);

  const sections = (sectionsResult.data ?? []) as SectionRow[];
  const chunks = (chunksResult.data ?? []) as ChunkRow[];
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
    generatedAt: new Date().toISOString(),
  };
}
