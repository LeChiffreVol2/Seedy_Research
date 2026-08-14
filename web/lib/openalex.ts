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
  options: { maxResults?: number } = {},
): Promise<OpenAlexDiscoveryResult> {
  const query = normalizeOpenAlexQuery(rawQuery);
  const searchUrl = searchUrlFor(query);
  const enabled = process.env.FEDERATED_DISCOVERY_ENABLED?.trim() !== "false";
  if (!enabled) return { status: "disabled", searchUrl, works: [] };

  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (!apiKey) return { status: "link_only", searchUrl, works: [] };

  try {
    const limit = boundedResultCount(options.maxResults);
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", String(limit));
    url.searchParams.set("select", "id,doi,display_name,publication_year,cited_by_count,primary_topic");
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(OPENALEX_TIMEOUT_MS),
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
