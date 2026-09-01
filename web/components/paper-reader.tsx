"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Copy,
  ExternalLink,
  FileLock2,
  Highlighter,
  Library,
  LoaderCircle,
  MessageSquarePlus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "./paper-reader.module.css";

type ReaderAccessMode =
  | "native_verified"
  | "source_hosted"
  | "restricted"
  | "metadata_only"
  | "unavailable";

type ReaderAccess = {
  mode?: string | null;
  statusLabel?: string | null;
  reason?: string | null;
  sourceUrl?: string | null;
  instructions?: string | null;
  institution?: string | null;
  licenseExpression?: string | null;
  rightsVerifiedAt?: string | null;
  // Backward-compatible aliases for pre-contract fixtures.
  license?: string | null;
  verifiedAt?: string | null;
};

type ReaderAsset = {
  id?: string | null;
  assetId?: string | null;
  originUrl?: string | null;
  sourceUrl?: string | null;
  downloadUrl?: string | null;
  pageCount?: number | null;
  readerAccessMode?: string | null;
};

export type PaperReaderPage = {
  id?: string | null;
  pageNumber: number;
  pageLabel?: string | null;
  anchor?: string | null;
  sectionTitle?: string | null;
  text: string;
  textSha256?: string | null;
  // Backward-compatible aliases for pre-contract fixtures.
  label?: string | null;
  stableAnchor?: string | null;
  citationLabel?: string | null;
};

export type PaperReaderOutlineItem = {
  id?: string | null;
  title: string;
  pageStart: number;
  pageEnd?: number | null;
  pageLabelStart?: string | null;
  pageLabelEnd?: string | null;
};

type PaperReaderApiOutlineItem = {
  id?: string | null;
  title: string;
  pageNumber: number;
  pageLabel?: string | null;
  anchor?: string | null;
};

export type PaperReaderPayload = {
  version?: string | null;
  source?: string | null;
  access?: ReaderAccess | null;
  accessMode?: string | null;
  asset?: ReaderAsset | null;
  assets?: ReaderAsset[] | null;
  pages?: PaperReaderPage[] | null;
  outline?: Array<PaperReaderOutlineItem | PaperReaderApiOutlineItem> | null;
  capabilities?: {
    search?: boolean;
    annotation?: boolean;
    citation?: boolean;
    download?: boolean;
    translation?: boolean;
  } | null;
  citation?: {
    plainText?: string | null;
    bibtex?: string | null;
    risUrl?: string | null;
    exportUrl?: string | null;
  } | null;
  pagination?: {
    totalPages?: number | null;
    page?: number | null;
    limit?: number | null;
    returned?: number | null;
    hasMore?: boolean;
  } | null;
};

type PaperReaderProps = {
  source: string;
  paperTitle: string;
  sourceLabel: string;
  canonicalUrl?: string | null;
  openInAppUrl: string;
  fallbackOutline?: PaperReaderOutlineItem[];
  fallbackCitation?: string;
  reviewReceipt?: {
    passportId: string;
    evidenceId: string;
    source: string;
    pageStart: number | null;
    readerPageNumber: number | null;
  } | null;
};

type NormalizedPage = {
  id: string;
  pageNumber: number;
  pageLabel: string;
  anchor: string;
  sectionTitle: string | null;
  text: string;
  citationLabel: string | null;
};

type SelectionState = {
  pageNumber: number;
  quote: string;
};

type ReaderAnnotation = {
  id: string;
  pageNumber: number;
  quote: string;
  note: string;
  createdAt: string;
};

const MAX_SELECTION_LENGTH = 1_200;
const READER_REVIEW_RECEIPT_KEY = "seed-research-reader-review-receipt-v1";

function normalizeMode(value?: string | null): ReaderAccessMode {
  switch ((value || "").toLowerCase()) {
    case "native_verified":
      return "native_verified";
    case "source_hosted":
    case "publisher_hosted":
    case "external_access":
    case "publisher_embed":
      return "source_hosted";
    case "restricted":
    case "institution_mediated":
      return "restricted";
    case "metadata_only":
      return "metadata_only";
    case "removed":
    case "unavailable":
    default:
      return "unavailable";
  }
}

function safeAnchor(value: string | null | undefined, pageNumber: number): string {
  const normalized = (value || "")
    .replace(/^#/, "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `reader-page-${pageNumber}`;
}

function normalizePages(payload: PaperReaderPayload | null): NormalizedPage[] {
  return (payload?.pages || [])
    .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0 && typeof page.text === "string")
    .map((page) => ({
      id: page.id || `${payload?.source || "paper"}-page-${page.pageNumber}`,
      pageNumber: page.pageNumber,
      pageLabel: page.pageLabel || page.label || `Page ${page.pageNumber}`,
      anchor: safeAnchor(page.anchor || page.stableAnchor, page.pageNumber),
      sectionTitle: page.sectionTitle || null,
      text: page.text,
      citationLabel: page.citationLabel || null,
    }))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

function outlineFromPages(pages: NormalizedPage[]): PaperReaderOutlineItem[] {
  const items: PaperReaderOutlineItem[] = [];
  for (const page of pages) {
    const title = page.sectionTitle?.trim();
    if (!title) continue;
    const previous = items.at(-1);
    if (previous?.title === title) {
      previous.pageEnd = page.pageNumber;
      previous.pageLabelEnd = page.pageLabel;
      continue;
    }
    items.push({
      id: `derived-${items.length + 1}`,
      title,
      pageStart: page.pageNumber,
      pageEnd: page.pageNumber,
      pageLabelStart: page.pageLabel,
      pageLabelEnd: page.pageLabel,
    });
  }
  return items;
}

function normalizeOutline(items?: Array<PaperReaderOutlineItem | PaperReaderApiOutlineItem> | null): PaperReaderOutlineItem[] {
  return (items || []).flatMap((item) => {
    const pageStart = "pageStart" in item ? item.pageStart : item.pageNumber;
    if (!Number.isInteger(pageStart) || pageStart < 1) return [];
    return [{
      id: item.id,
      title: item.title,
      pageStart,
      pageEnd: "pageEnd" in item ? item.pageEnd : pageStart,
      pageLabelStart: "pageStart" in item ? item.pageLabelStart : item.pageLabel,
      pageLabelEnd: "pageStart" in item ? item.pageLabelEnd : item.pageLabel,
    }];
  });
}

function humanizeReason(value?: string | null): string | null {
  if (!value) return null;
  if (!value.includes("_")) return value;
  const sentence = value.replace(/_/g, " ").trim();
  return sentence ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` : null;
}

function formatVerifiedDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)
  );
}

function highlightText(text: string, excerpts: string[]): Array<{ text: string; highlighted: boolean }> {
  const intervals = excerpts
    .map((excerpt) => {
      const start = text.indexOf(excerpt);
      return start >= 0 ? { start, end: start + excerpt.length } : null;
    })
    .filter((interval): interval is { start: number; end: number } => interval !== null)
    .sort((a, b) => a.start - b.start);

  if (!intervals.length) return [{ text, highlighted: false }];
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }

  const parts: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start > cursor) parts.push({ text: text.slice(cursor, interval.start), highlighted: false });
    parts.push({ text: text.slice(interval.start, interval.end), highlighted: true });
    cursor = interval.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}

function AccessFallback({
  mode,
  access,
  sourceUrl,
  openInAppUrl,
}: {
  mode: Exclude<ReaderAccessMode, "native_verified">;
  access: ReaderAccess;
  sourceUrl: string | null;
  openInAppUrl: string;
}) {
  const content = {
    source_hosted: {
      icon: <ExternalLink size={22} aria-hidden />,
      title: access.statusLabel || "Full text is hosted by the official source",
      body: humanizeReason(access.reason) || "Seedy Research keeps your research context here while the publisher or repository delivers the paper under its own access terms.",
    },
    restricted: {
      icon: <FileLock2 size={22} aria-hidden />,
      title: access.statusLabel || "Institutional access required",
      body: access.instructions || humanizeReason(access.reason) || "Use the official resolver or your institution’s library access. Seedy Research never proxies credentials or bypasses authentication.",
    },
    metadata_only: {
      icon: <Library size={22} aria-hidden />,
      title: access.statusLabel || "Metadata and evidence only",
      body: humanizeReason(access.reason) || "No asset has verified permission for native full-text display. You can still inspect the indexed evidence and source record.",
    },
    unavailable: {
      icon: <BookOpenText size={22} aria-hidden />,
      title: access.statusLabel || "Full text unavailable",
      body: humanizeReason(access.reason) || "Seedy Research could not verify a readable full-text asset for this record. Availability and reuse rights are checked separately.",
    },
  }[mode];
  const sourceActionLabel = mode === "source_hosted"
    ? "Open official full text"
    : mode === "restricted"
      ? "Open institutional resolver"
      : "Open source record";

  return (
    <div className={styles.fallback} data-testid="reader-access-state">
      <div className={styles.fallbackIcon}>{content.icon}</div>
      <div>
        <p className={styles.accessKicker}>Rights-aware access</p>
        <h3>{content.title}</h3>
        <p>{content.body}</p>
        {access.institution ? <p className={styles.accessMeta}>Holding institution · {access.institution}</p> : null}
        <div className={styles.fallbackActions}>
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer" className={styles.darkAction}>
              {sourceActionLabel} <ExternalLink size={15} aria-hidden />
            </a>
          ) : null}
          <a href={openInAppUrl} className={styles.lightAction}>Inspect exact-page evidence</a>
        </div>
      </div>
    </div>
  );
}

export function PaperReader({
  source,
  paperTitle,
  sourceLabel,
  canonicalUrl,
  openInAppUrl,
  fallbackOutline = [],
  fallbackCitation,
  reviewReceipt = null,
}: PaperReaderProps) {
  const [payload, setPayload] = useState<PaperReaderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [noteDraft, setNoteDraft] = useState<SelectionState | null>(null);
  const [noteText, setNoteText] = useState("");
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [status, setStatus] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    const requestedPage = reviewReceipt?.readerPageNumber;
    const readerQuery = requestedPage && requestedPage > 0 ? `?page=${requestedPage}&limit=10` : "";
    fetch(`/api/papers/${encodeURIComponent(source)}/reader${readerQuery}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "No reader manifest is available yet." : "The reader manifest could not be loaded.");
        return response.json() as Promise<PaperReaderPayload>;
      })
      .then((data) => setPayload(data))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "The reader manifest could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reviewReceipt?.readerPageNumber, source]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`civilmcp-reader-annotations:${source}`);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) setAnnotations(parsed.filter((item): item is ReaderAnnotation => (
        typeof item?.id === "string"
        && typeof item?.pageNumber === "number"
        && typeof item?.quote === "string"
        && typeof item?.note === "string"
        && typeof item?.createdAt === "string"
      )));
    } catch {
      // Corrupt local notes should not block access to the paper.
    }
  }, [source]);

  const pages = useMemo(() => normalizePages(payload), [payload]);
  const access = payload?.access || {};
  const asset = payload?.asset || payload?.assets?.[0] || null;
  const rawMode = access.mode || payload?.accessMode || asset?.readerAccessMode;
  const declaredMode = normalizeMode(rawMode);
  const mode: ReaderAccessMode = declaredMode === "native_verified" && pages.length === 0 ? "unavailable" : declaredMode;
  const sourceUrl = access.sourceUrl || asset?.sourceUrl || asset?.originUrl || canonicalUrl || null;
  const outline = useMemo(() => {
    const supplied = normalizeOutline(payload?.outline);
    if (supplied.length) return supplied;
    const derived = outlineFromPages(pages);
    return derived.length ? derived : fallbackOutline;
  }, [fallbackOutline, pages, payload?.outline]);
  const capabilities = {
    search: payload?.capabilities?.search ?? mode === "native_verified",
    annotation: payload?.capabilities?.annotation ?? mode === "native_verified",
    citation: payload?.capabilities?.citation ?? mode === "native_verified",
    download: payload?.capabilities?.download ?? false,
  };
  const verifiedDate = formatVerifiedDate(access.rightsVerifiedAt || access.verifiedAt);
  const license = access.licenseExpression || access.license;
  const hasMorePages = payload?.pagination?.hasMore === true;
  const totalPages = payload?.pagination?.totalPages || asset?.pageCount || pages.length;

  useEffect(() => {
    if (!reviewReceipt || mode !== "native_verified" || !pages.length) return;
    const reviewedPage = reviewReceipt.readerPageNumber
      ? pages.find((page) => page.pageNumber === reviewReceipt.readerPageNumber)
      : pages[0];
    if (!reviewedPage) return;
    try {
      window.localStorage.setItem(READER_REVIEW_RECEIPT_KEY, JSON.stringify({
        ...reviewReceipt,
        readerPageNumber: reviewedPage.pageNumber,
        readerAnchor: reviewedPage.anchor,
        accessMode: "native_verified",
        visitedAt: new Date().toISOString(),
      }));
    } catch {
      // The paper remains readable when local storage is unavailable; the
      // originating Passport simply stays locked until another review path is used.
    }
  }, [mode, pages, reviewReceipt]);

  useEffect(() => {
    if (pages.length && currentPage == null) setCurrentPage(pages[0].pageNumber);
  }, [currentPage, pages]);

  useEffect(() => {
    const root = pagesRef.current;
    if (!root || mode !== "native_verified") return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-reader-page]"));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const pageNumber = Number((visible?.target as HTMLElement | undefined)?.dataset.readerPage);
      if (Number.isInteger(pageNumber)) setCurrentPage(pageNumber);
    }, { root, rootMargin: "-18% 0px -58%", threshold: [0, 0.25, 0.55] });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [mode, pages]);

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("th");
    if (!normalized) return [];
    return pages.flatMap((page) => {
      const lower = page.text.toLocaleLowerCase("th");
      const index = lower.indexOf(normalized);
      if (index < 0) return [];
      const start = Math.max(0, index - 44);
      const end = Math.min(page.text.length, index + normalized.length + 72);
      return [{ page, excerpt: `${start ? "…" : ""}${page.text.slice(start, end).replace(/\s+/g, " ")}${end < page.text.length ? "…" : ""}` }];
    });
  }, [pages, query]);

  const goToPage = useCallback((pageNumber: number) => {
    const page = pagesRef.current?.querySelector<HTMLElement>(`[data-reader-page="${pageNumber}"]`);
    if (!page) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    page.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    setCurrentPage(pageNumber);
  }, []);

  const captureSelection = useCallback(() => {
    const browserSelection = window.getSelection();
    const quote = browserSelection?.toString().replace(/\s+/g, " ").trim() || "";
    if (!quote || quote.length > MAX_SELECTION_LENGTH || !browserSelection?.anchorNode) {
      setSelection(null);
      return;
    }
    const element = browserSelection.anchorNode instanceof Element
      ? browserSelection.anchorNode
      : browserSelection.anchorNode.parentElement;
    const pageElement = element?.closest<HTMLElement>("[data-reader-page]");
    if (!pageElement || !pagesRef.current?.contains(pageElement)) {
      setSelection(null);
      return;
    }
    const pageNumber = Number(pageElement.dataset.readerPage);
    if (Number.isInteger(pageNumber)) setSelection({ pageNumber, quote });
  }, []);

  const persistAnnotations = useCallback((next: ReaderAnnotation[]) => {
    setAnnotations(next);
    try {
      window.localStorage.setItem(`civilmcp-reader-annotations:${source}`, JSON.stringify(next));
    } catch {
      setStatus("The annotation is visible for this session but could not be saved locally.");
    }
  }, [source]);

  const addHighlight = useCallback((selected: SelectionState, note = "") => {
    const annotation: ReaderAnnotation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNumber: selected.pageNumber,
      quote: selected.quote,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };
    persistAnnotations([...annotations, annotation]);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setNoteDraft(null);
    setNoteText("");
    setStatus(note.trim() ? `Note saved on page ${selected.pageNumber}.` : `Highlight saved on page ${selected.pageNumber}.`);
  }, [annotations, persistAnnotations]);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(successMessage);
    } catch {
      setStatus("Clipboard access is unavailable. Select and copy the citation manually.");
    }
  }, []);

  const loadMorePages = useCallback(async (): Promise<number | null> => {
    const nextPage = (pages.at(-1)?.pageNumber || 0) + 1;
    if (!hasMorePages || loadingMore || nextPage < 1) return null;
    setLoadingMore(true);
    setStatus(`Loading pages from page ${nextPage}…`);
    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(source)}/reader?page=${nextPage}&limit=10`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Additional pages could not be loaded.");
      const next = await response.json() as PaperReaderPayload;
      const nextPages = normalizePages(next);
      setPayload((current) => {
        if (!current) return next;
        const pageMap = new Map<number, PaperReaderPage>();
        [...(current.pages || []), ...(next.pages || [])].forEach((page) => pageMap.set(page.pageNumber, page));
        const outlineMap = new Map<string, PaperReaderOutlineItem | PaperReaderApiOutlineItem>();
        [...(current.outline || []), ...(next.outline || [])].forEach((item) => {
          const pageNumber = "pageStart" in item ? item.pageStart : item.pageNumber;
          outlineMap.set(`${item.title}:${pageNumber}`, item);
        });
        return {
          ...current,
          access: next.access || current.access,
          asset: next.asset || current.asset,
          assets: next.assets || current.assets,
          pages: [...pageMap.values()].sort((a, b) => a.pageNumber - b.pageNumber),
          outline: [...outlineMap.values()],
          capabilities: next.capabilities || current.capabilities,
          pagination: next.pagination || current.pagination,
        };
      });
      setStatus(`${next.pages?.length || 0} additional pages loaded.`);
      return nextPages[0]?.pageNumber ?? null;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Additional pages could not be loaded.");
      return null;
    } finally {
      setLoadingMore(false);
    }
  }, [hasMorePages, loadingMore, pages, source]);

  const citationForPage = useCallback((page: NormalizedPage) => (
    page.citationLabel
    || `${payload?.citation?.plainText || fallbackCitation || `${paperTitle}. ${sourceLabel}.`} ${page.pageLabel}. ${canonicalUrl || ""}`.trim()
  ), [canonicalUrl, fallbackCitation, paperTitle, payload?.citation?.plainText, sourceLabel]);

  const onReaderKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "/" && !isEditableTarget(event.target) && capabilities.search) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      setNoteDraft(null);
      setNoteText("");
    }
  }, [capabilities.search]);

  if (loading) {
    return (
      <section className={styles.readerShell} data-testid="paper-reader" aria-labelledby="paper-reader-title">
        <div className={styles.loading} role="status" aria-live="polite">
          <LoaderCircle size={22} className={styles.spinner} aria-hidden />
          <div><h2 id="paper-reader-title">Full-paper access</h2><p>Checking verified access and page provenance…</p></div>
        </div>
      </section>
    );
  }

  if (mode !== "native_verified") {
    const fallbackAccess = loadError
      ? { ...access, reason: loadError, statusLabel: "Reader access has not been verified" }
      : declaredMode === "native_verified"
        ? { ...access, statusLabel: "Verified pages are not available", reason: access.reason || "The native asset did not return page content." }
      : access;
    return (
      <section className={styles.readerShell} data-testid="paper-reader" aria-labelledby="paper-reader-title">
        <div className={styles.readerHeading}>
          <div><p className={styles.accessKicker}>Full-paper access</p><h2 id="paper-reader-title">Read from the best lawful source</h2></div>
        </div>
        <AccessFallback mode={mode} access={fallbackAccess} sourceUrl={sourceUrl} openInAppUrl={openInAppUrl} />
      </section>
    );
  }

  const currentIndex = Math.max(0, pages.findIndex((page) => page.pageNumber === currentPage));
  const current = pages[currentIndex] || pages[0];
  const goToNextPage = async () => {
    const loadedNext = pages[currentIndex + 1];
    if (loadedNext) {
      goToPage(loadedNext.pageNumber);
      return;
    }
    const firstNewPage = await loadMorePages();
    if (firstNewPage == null) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => goToPage(firstNewPage)));
  };
  const citationText = payload?.citation?.plainText || fallbackCitation || `${paperTitle}. ${sourceLabel}. ${canonicalUrl || ""}`.trim();
  const suppliedExportUrl = payload?.citation?.exportUrl || payload?.citation?.risUrl || null;
  const exportUrl = suppliedExportUrl || `data:text/plain;charset=utf-8,${encodeURIComponent(citationText)}`;
  const permittedDownloadUrl = asset?.downloadUrl || asset?.originUrl || asset?.sourceUrl || null;

  return (
    <section
      className={styles.readerShell}
      data-testid="paper-reader"
      aria-labelledby="paper-reader-title"
      aria-keyshortcuts="/"
      tabIndex={0}
      onKeyDown={onReaderKeyDown}
    >
      <div className={styles.readerHeading}>
        <div>
          <p className={styles.accessKicker}>Verified native reader</p>
          <h2 id="paper-reader-title">Read and anchor evidence to the page</h2>
        </div>
        <div className={styles.verifiedState} data-testid="reader-access-state">
          <ShieldCheck size={17} aria-hidden />
          <span>Native full text verified</span>
        </div>
      </div>

      <div className={styles.rightsLine}>
        <span>{license || "Display permission verified"}</span>
        {verifiedDate ? <span>Rights checked {verifiedDate}</span> : null}
        <span>{hasMorePages ? `${pages.length.toLocaleString("en-US")} of ${totalPages.toLocaleString("en-US")} pages loaded` : `${pages.length.toLocaleString("en-US")} readable pages`}</span>
      </div>

      <div className={styles.readerToolbar}>
        <div className={styles.searchWrap}>
          <Search size={16} aria-hidden />
          <input
            ref={searchRef}
            data-testid="reader-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this paper"
            aria-label="Search within paper"
            disabled={!capabilities.search}
          />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear paper search"><X size={15} aria-hidden /></button> : null}
          <kbd aria-hidden>/</kbd>
          {query ? (
            <div className={styles.searchResults} role="region" aria-label="Paper search results">
              <p>{searchResults.length ? `${searchResults.length} matching loaded pages` : "No matching pages"}</p>
              {searchResults.slice(0, 8).map(({ page, excerpt }) => (
                <button key={page.id} type="button" onClick={() => { goToPage(page.pageNumber); setQuery(""); }}>
                  <strong>{page.pageLabel}</strong><span>{excerpt}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.pageControls} aria-label="Page navigation">
          <button type="button" onClick={() => goToPage(pages[Math.max(0, currentIndex - 1)].pageNumber)} disabled={currentIndex === 0} aria-label="Previous page">
            <ArrowLeft size={16} aria-hidden />
          </button>
          <label>
            <span className={styles.srOnly}>Page number</span>
            <select value={current.pageNumber} onChange={(event) => goToPage(Number(event.target.value))} aria-label="Page number">
              {pages.map((page) => <option key={page.id} value={page.pageNumber}>{page.pageLabel}</option>)}
            </select>
          </label>
          <span aria-live="polite">of {totalPages}{hasMorePages ? ` · ${pages.length} loaded` : ""}</span>
          <button type="button" onClick={() => void goToNextPage()} disabled={(currentIndex === pages.length - 1 && !hasMorePages) || loadingMore} aria-label="Next page">
            {loadingMore ? <LoaderCircle size={16} className={styles.spinner} aria-hidden /> : <ArrowRight size={16} aria-hidden />}
          </button>
        </div>

        <a className={styles.exportAction} href={exportUrl} download={suppliedExportUrl ? undefined : "seed-research-citation.txt"}>
          Export citation <ExternalLink size={14} aria-hidden />
        </a>
        {capabilities.download && permittedDownloadUrl ? (
          <a className={styles.exportAction} href={permittedDownloadUrl} target="_blank" rel="noreferrer">Download permitted copy</a>
        ) : null}
      </div>

      {selection ? (
        <div className={styles.selectionToolbar} data-testid="reader-selection-toolbar" role="toolbar" aria-label="Selected text actions">
          <span>Page {selection.pageNumber} · {selection.quote.length.toLocaleString("en-US")} characters</span>
          {capabilities.annotation ? (
            <>
              <button type="button" onClick={() => addHighlight(selection)}><Highlighter size={15} aria-hidden /> Save highlight</button>
              <button type="button" onClick={() => { setNoteDraft(selection); setNoteText(""); }}><MessageSquarePlus size={15} aria-hidden /> Add note</button>
            </>
          ) : null}
          <button type="button" onClick={() => { window.getSelection()?.removeAllRanges(); setSelection(null); }} aria-label="Dismiss selected text actions"><X size={15} aria-hidden /></button>
        </div>
      ) : null}

      <div className={styles.readerGrid}>
        <nav className={styles.outlinePanel} data-testid="reader-outline" aria-label="Paper outline">
          <p className={styles.panelLabel}>Outline</p>
          {outline.length ? (
            <ol>
              {outline.map((item) => (
                <li key={item.id || `${item.title}-${item.pageStart}`}>
                  <button type="button" onClick={() => goToPage(item.pageStart)} aria-current={currentPage != null && currentPage >= item.pageStart && currentPage <= (item.pageEnd || item.pageStart) ? "location" : undefined}>
                    <span>{item.title}</span><small>{
                      item.pageEnd && item.pageEnd !== item.pageStart
                        ? `pp.${item.pageLabelStart || item.pageStart}–${item.pageLabelEnd || item.pageEnd}`
                        : `p.${item.pageLabelStart || item.pageStart}`
                    }</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className={styles.emptyPanel}>No section outline was supplied for this asset.</p>}
        </nav>

        <div
          ref={pagesRef}
          className={styles.pagesViewport}
          onPointerUp={captureSelection}
          onKeyUp={captureSelection}
          aria-label={`Full text of ${paperTitle}`}
        >
          {pages.map((page) => {
            const excerpts = annotations.filter((item) => item.pageNumber === page.pageNumber).map((item) => item.quote);
            return (
              <article
                key={page.id}
                id={page.anchor}
                className={styles.paperPage}
                data-reader-page={page.pageNumber}
                data-testid={`reader-page-${page.pageNumber}`}
                aria-labelledby={`${page.anchor}-label`}
              >
                <header>
                  <div>
                    <span id={`${page.anchor}-label`}>{page.pageLabel}</span>
                    {page.sectionTitle ? <strong>{page.sectionTitle}</strong> : null}
                  </div>
                  {capabilities.citation ? (
                    <button type="button" onClick={() => void copyText(citationForPage(page), `${page.pageLabel} citation copied.`)} aria-label="Copy page citation">
                      <Copy size={15} aria-hidden /> Copy citation
                    </button>
                  ) : null}
                </header>
                <p className={styles.pageText}>
                  {highlightText(page.text, excerpts).map((part, index) => part.highlighted
                    ? <mark key={`${page.id}-${index}`}>{part.text}</mark>
                    : <span key={`${page.id}-${index}`}>{part.text}</span>)}
                </p>
                <footer>
                  <a href={`#${page.anchor}`}>#{page.anchor}</a>
                  <span>Verify this page before using it in a claim.</span>
                </footer>
              </article>
            );
          })}
          {hasMorePages ? (
            <div className={styles.loadMorePages}>
              <button type="button" onClick={() => void loadMorePages()} disabled={loadingMore}>
                {loadingMore ? <LoaderCircle size={16} className={styles.spinner} aria-hidden /> : <ArrowRight size={16} aria-hidden />}
                {loadingMore ? "Loading pages…" : "Load next pages"}
              </button>
              <span>Reader pages are loaded in verified, bounded batches.</span>
            </div>
          ) : null}
        </div>

        <aside className={styles.notesPanel} data-testid="reader-note-panel" aria-label="Paper notes and highlights">
          <div className={styles.notesHeading}>
            <div><p className={styles.panelLabel}>Private notes</p><small>Stored in this browser</small></div>
            <span>{annotations.length}</span>
          </div>

          {noteDraft ? (
            <form className={styles.noteForm} onSubmit={(event) => { event.preventDefault(); addHighlight(noteDraft, noteText); }}>
              <blockquote>“{noteDraft.quote}”</blockquote>
              <label htmlFor="reader-note">Note on page {noteDraft.pageNumber}</label>
              <textarea id="reader-note" value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={4} autoFocus placeholder="Why does this passage matter?" />
              <div><button type="submit" className={styles.noteSave}><Check size={14} aria-hidden /> Save note</button><button type="button" onClick={() => { setNoteDraft(null); setNoteText(""); }}>Cancel</button></div>
            </form>
          ) : null}

          {annotations.length ? (
            <ol className={styles.annotationList}>
              {annotations.slice().reverse().map((annotation) => (
                <li key={annotation.id}>
                  <button type="button" onClick={() => goToPage(annotation.pageNumber)}>Page {annotation.pageNumber}</button>
                  <blockquote>“{annotation.quote}”</blockquote>
                  {annotation.note ? <p>{annotation.note}</p> : <small>Highlight</small>}
                  <button type="button" className={styles.deleteNote} onClick={() => persistAnnotations(annotations.filter((item) => item.id !== annotation.id))} aria-label={`Delete annotation on page ${annotation.pageNumber}`}><X size={13} aria-hidden /></button>
                </li>
              ))}
            </ol>
          ) : <p className={styles.emptyPanel}>Select text in a page to save a highlight or note.</p>}
        </aside>
      </div>

      <p className={styles.liveStatus} role="status" aria-live="polite">{status}</p>
    </section>
  );
}
