export type OpenAlexDiscoveryStatus = "connected" | "link_only" | "unavailable" | "rate_limited" | "disabled";

export type OpenAlexDiscoveryWork = {
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedByCount: number;
  topic: string | null;
  url: string;
  citable: false;
};

export type OpenAlexDiscoveryResult = {
  status: OpenAlexDiscoveryStatus;
  searchUrl: string;
  works: OpenAlexDiscoveryWork[];
};

type OpenAlexApiWork = {
  id?: unknown;
  doi?: unknown;
  display_name?: unknown;
  publication_year?: unknown;
  cited_by_count?: unknown;
  primary_topic?: { display_name?: unknown } | null;
  referenced_works?: unknown;
  related_works?: unknown;
};

export type OpenAlexCitationNode = {
  id: string;
  title: string;
  year: number | null;
  citedByCount: number;
  url: string;
  relation: "seed" | "cites" | "cited_by" | "related";
  citable: false;
};

export type OpenAlexCitationMap = {
  status: OpenAlexDiscoveryStatus;
  searchUrl: string;
  seed: OpenAlexCitationNode | null;
  nodes: OpenAlexCitationNode[];
};

const MAX_QUERY_LENGTH = 280;
const MAX_RESULTS = 6;
const OPENALEX_TIMEOUT_MS = 8_000;

export function normalizeOpenAlexQuery(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_QUERY_LENGTH)
    : "";
}

function boundedResultCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(value ?? 4)));
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function integer(value: unknown, min = 0): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : null;
}

function normalizeDoi(value: unknown): string | null {
  const cleaned = text(value, 320).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  return cleaned ? `https://doi.org/${cleaned}` : null;
}

function searchUrlFor(query: string): string {
  return `https://openalex.org/works?search=${encodeURIComponent(query)}`;
}

export async function discoverOpenAlex(
  rawQuery: unknown,
  options: { maxResults?: number; timeoutMs?: number } = {},
): Promise<OpenAlexDiscoveryResult> {
  const query = normalizeOpenAlexQuery(rawQuery);
  const searchUrl = searchUrlFor(query);
  const enabled = process.env.FEDERATED_DISCOVERY_ENABLED?.trim() !== "false";
  if (!enabled) return { status: "disabled", searchUrl, works: [] };

  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (!apiKey) return { status: "link_only", searchUrl, works: [] };

  try {
    const limit = boundedResultCount(options.maxResults);
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1_000, Math.min(OPENALEX_TIMEOUT_MS, Math.floor(options.timeoutMs ?? OPENALEX_TIMEOUT_MS)))
      : OPENALEX_TIMEOUT_MS;
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", String(limit));
    url.searchParams.set("select", "id,doi,display_name,publication_year,cited_by_count,primary_topic");
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 429) return { status: "rate_limited", searchUrl, works: [] };
    if (!response.ok) return { status: "unavailable", searchUrl, works: [] };

    const payload = (await response.json()) as { results?: unknown };
    const works = (Array.isArray(payload.results) ? payload.results : [])
      .slice(0, limit)
      .map((item): OpenAlexDiscoveryWork | null => {
        if (!item || typeof item !== "object") return null;
        const work = item as OpenAlexApiWork;
        const id = text(work.id, 320);
        const doi = normalizeDoi(work.doi);
        const title = text(work.display_name, 220) || "Untitled research work";
        const citedByCount = integer(work.cited_by_count) ?? 0;
        return {
          id,
          doi,
          title,
          year: integer(work.publication_year, 1),
          citedByCount,
          topic: text(work.primary_topic?.display_name, 120) || null,
          url: doi || id || searchUrl,
          citable: false,
        };
      })
      .filter((work): work is OpenAlexDiscoveryWork => work !== null);

    return { status: "connected", searchUrl, works };
  } catch {
    return { status: "unavailable", searchUrl, works: [] };
  }
}

function openAlexWorkId(value: unknown): string {
  return text(value, 320).replace(/^https:\/\/openalex\.org\//i, "");
}

function citationNode(work: OpenAlexApiWork, relation: OpenAlexCitationNode["relation"], fallbackUrl: string): OpenAlexCitationNode | null {
  const id = text(work.id, 320);
  const title = text(work.display_name, 260);
  if (!id || !title) return null;
  return {
    id,
    title,
    year: integer(work.publication_year, 1),
    citedByCount: integer(work.cited_by_count) ?? 0,
    url: normalizeDoi(work.doi) || id || fallbackUrl,
    relation,
    citable: false,
  };
}

export async function citationMapOpenAlex(rawQuery: unknown): Promise<OpenAlexCitationMap> {
  const query = normalizeOpenAlexQuery(rawQuery);
  const searchUrl = searchUrlFor(query);
  if (process.env.FEDERATED_DISCOVERY_ENABLED?.trim() === "false") return { status: "disabled", searchUrl, seed: null, nodes: [] };
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (!apiKey) return { status: "link_only", searchUrl, seed: null, nodes: [] };
  const fetchJson = async (url: URL) => {
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(OPENALEX_TIMEOUT_MS) });
    if (response.status === 429) throw new Error("rate_limited");
    if (!response.ok) throw new Error("unavailable");
    return response.json() as Promise<Record<string, unknown>>;
  };
  try {
    const seedUrl = new URL("https://api.openalex.org/works");
    seedUrl.searchParams.set("search", query);
    seedUrl.searchParams.set("per-page", "1");
    seedUrl.searchParams.set("select", "id,doi,display_name,publication_year,cited_by_count,referenced_works,related_works");
    const seedPayload = await fetchJson(seedUrl);
    const seedWork = (Array.isArray(seedPayload.results) ? seedPayload.results[0] : null) as OpenAlexApiWork | null;
    if (!seedWork) return { status: "connected", searchUrl, seed: null, nodes: [] };
    const seed = citationNode(seedWork, "seed", searchUrl);
    if (!seed) return { status: "connected", searchUrl, seed: null, nodes: [] };
    const references = (Array.isArray(seedWork.referenced_works) ? seedWork.referenced_works : []).slice(0, 4).map(openAlexWorkId).filter(Boolean);
    const related = (Array.isArray(seedWork.related_works) ? seedWork.related_works : []).slice(0, 4).map(openAlexWorkId).filter(Boolean);
    const incomingUrl = new URL("https://api.openalex.org/works");
    incomingUrl.searchParams.set("filter", `cites:${openAlexWorkId(seed.id)}`);
    incomingUrl.searchParams.set("sort", "-cited_by_count");
    incomingUrl.searchParams.set("per-page", "4");
    incomingUrl.searchParams.set("select", "id,doi,display_name,publication_year,cited_by_count");
    const relationIds = [...new Set([...references, ...related])];
    const relationUrl = new URL("https://api.openalex.org/works");
    relationUrl.searchParams.set("filter", `openalex:${relationIds.join("|") || openAlexWorkId(seed.id)}`);
    relationUrl.searchParams.set("per-page", String(Math.max(1, relationIds.length)));
    relationUrl.searchParams.set("select", "id,doi,display_name,publication_year,cited_by_count");
    const [incomingPayload, relationPayload] = await Promise.all([fetchJson(incomingUrl), fetchJson(relationUrl)]);
    const incoming = (Array.isArray(incomingPayload.results) ? incomingPayload.results : [])
      .map((work) => citationNode(work as OpenAlexApiWork, "cited_by", searchUrl)).filter((node): node is OpenAlexCitationNode => Boolean(node));
    const referenceSet = new Set(references);
    const outward = (Array.isArray(relationPayload.results) ? relationPayload.results : [])
      .map((work) => citationNode(work as OpenAlexApiWork, referenceSet.has(openAlexWorkId((work as OpenAlexApiWork).id)) ? "cites" : "related", searchUrl))
      .filter((node): node is OpenAlexCitationNode => Boolean(node));
    return { status: "connected", searchUrl, seed, nodes: [...incoming, ...outward].slice(0, 12) };
  } catch (error) {
    return { status: error instanceof Error && error.message === "rate_limited" ? "rate_limited" : "unavailable", searchUrl, seed: null, nodes: [] };
  }
}
