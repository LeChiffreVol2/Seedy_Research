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
  authorships?: unknown;
  referenced_works?: unknown;
  related_works?: unknown;
};

export type OpenAlexConnectionInput = {
  doi?: unknown;
  title?: unknown;
  year?: unknown;
};

export type OpenAlexMatch = {
  status: "verified" | "candidate" | "unmatched";
  basis: "doi" | "title_year" | "title" | "none";
  requiresHumanReview: boolean;
  titleSimilarity: number | null;
  yearDelta: number | null;
  matchedOpenAlexId: string | null;
};

export type OpenAlexCitationNode = {
  id: string;
  title: string;
  year: number | null;
  citedByCount: number;
  url: string;
  relation: "seed" | "cites" | "cited_by" | "related";
  topic: string | null;
  authors: string[];
  institutions: string[];
  citable: false;
};

export type OpenAlexCitationMap = {
  status: OpenAlexDiscoveryStatus;
  relationsStatus: "complete" | "partial" | "unavailable" | "not_requested";
  searchUrl: string;
  match: OpenAlexMatch;
  seed: OpenAlexCitationNode | null;
  nodes: OpenAlexCitationNode[];
};

const MAX_QUERY_LENGTH = 280;
const MAX_RESULTS = 6;
const OPENALEX_TIMEOUT_MS = 8_000;
const CONNECTION_SELECT = "id,doi,display_name,publication_year,cited_by_count,primary_topic,authorships,referenced_works,related_works";
const EMPTY_MATCH: OpenAlexMatch = {
  status: "unmatched",
  basis: "none",
  requiresHumanReview: true,
  titleSimilarity: null,
  yearDelta: null,
  matchedOpenAlexId: null,
};

function openAlexAccess(): { allowed: boolean; apiKey: string } {
  const apiKey = process.env.OPENALEX_API_KEY?.trim() ?? "";
  const anonymousAllowed = process.env.OPENALEX_ALLOW_ANONYMOUS?.trim() === "true";
  return { allowed: Boolean(apiKey) || anonymousAllowed, apiKey };
}

function addOpenAlexAccess(url: URL, apiKey: string): void {
  if (apiKey) url.searchParams.set("api_key", apiKey);
}

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
  const cleaned = text(value, 320)
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/[\S]+$/i.test(cleaned) ? `https://doi.org/${cleaned}` : null;
}

function normalizeConnectionInput(rawInput: unknown): { doi: string | null; title: string; year: number | null } {
  if (typeof rawInput === "string") {
    const doi = normalizeDoi(rawInput);
    return { doi, title: doi ? "" : normalizeOpenAlexQuery(rawInput), year: null };
  }
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return { doi: null, title: "", year: null };
  const input = rawInput as OpenAlexConnectionInput;
  const parsedYear = integer(input.year, 1);
  return {
    doi: normalizeDoi(input.doi),
    title: normalizeOpenAlexQuery(input.title),
    year: parsedYear && parsedYear <= 3_000 ? parsedYear : null,
  };
}

const TITLE_STOPWORDS = new Set(["a", "an", "and", "associated", "across", "for", "in", "of", "on", "or", "study", "the", "with"]);

function normalizedTitle(value: unknown): string {
  return text(value, 320)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleToken(value: string): string {
  if (value === "thailand" || value === "thai") return "thai";
  if (value.length > 4 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 4 && value.endsWith("es")) return value.slice(0, -2);
  if (value.length > 3 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function titleTokens(value: unknown): Set<string> {
  return new Set(normalizedTitle(value).split(" ").filter(Boolean).filter((token) => !TITLE_STOPWORDS.has(token)).map(titleToken));
}

function titleSimilarity(left: unknown, right: unknown): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function yearDelta(expected: number | null, actual: unknown): number | null {
  const candidate = integer(actual, 1);
  return expected && candidate ? Math.abs(expected - candidate) : null;
}

function matchCandidate(
  input: { doi: string | null; title: string; year: number | null },
  candidates: OpenAlexApiWork[],
): { work: OpenAlexApiWork | null; match: OpenAlexMatch } {
  if (input.doi) {
    const exactDoi = candidates.find((work) => normalizeDoi(work.doi) === input.doi);
    if (exactDoi) {
      return {
        work: exactDoi,
        match: {
          status: "verified",
          basis: "doi",
          requiresHumanReview: false,
          titleSimilarity: input.title ? titleSimilarity(input.title, exactDoi.display_name) : null,
          yearDelta: yearDelta(input.year, exactDoi.publication_year),
          matchedOpenAlexId: text(exactDoi.id, 320) || null,
        },
      };
    }
  }
  if (!input.title) return { work: null, match: EMPTY_MATCH };

  const expectedTitle = normalizedTitle(input.title);
  const ranked = candidates
    .map((work) => ({
      work,
      similarity: titleSimilarity(input.title, work.display_name),
      exactTitle: normalizedTitle(work.display_name) === expectedTitle,
      delta: yearDelta(input.year, work.publication_year),
    }))
    .filter(({ work }) => Boolean(text(work.id, 320) && text(work.display_name, 320)))
    .sort((left, right) => Number(right.exactTitle) - Number(left.exactTitle) || right.similarity - left.similarity || (left.delta ?? 99) - (right.delta ?? 99));
  const best = ranked[0];
  if (!best) return { work: null, match: EMPTY_MATCH };
  const runnerUp = ranked[1];
  const ambiguous = Boolean(
    runnerUp
    && best.exactTitle === runnerUp.exactTitle
    && Math.abs(best.similarity - runnerUp.similarity) < 0.1
    && Math.abs((best.delta ?? 99) - (runnerUp.delta ?? 99)) <= 1,
  );
  if (ambiguous) return { work: null, match: EMPTY_MATCH };

  if (best.exactTitle && input.year != null && best.delta != null && best.delta <= 1) {
    return {
      work: best.work,
      match: {
        status: "candidate",
        basis: "title_year",
        requiresHumanReview: true,
        titleSimilarity: best.similarity,
        yearDelta: best.delta,
        matchedOpenAlexId: text(best.work.id, 320) || null,
      },
    };
  }
  if (best.similarity >= 0.72) {
    return {
      work: best.work,
      match: {
        status: "candidate",
        basis: "title",
        requiresHumanReview: true,
        titleSimilarity: best.similarity,
        yearDelta: best.delta,
        matchedOpenAlexId: text(best.work.id, 320) || null,
      },
    };
  }
  return { work: null, match: EMPTY_MATCH };
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

  const access = openAlexAccess();
  if (!access.allowed) return { status: "link_only", searchUrl, works: [] };

  try {
    const limit = boundedResultCount(options.maxResults);
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1_000, Math.min(OPENALEX_TIMEOUT_MS, Math.floor(options.timeoutMs ?? OPENALEX_TIMEOUT_MS)))
      : OPENALEX_TIMEOUT_MS;
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query);
    url.searchParams.set("per_page", String(limit));
    url.searchParams.set("select", "id,doi,display_name,publication_year,cited_by_count,primary_topic");
    addOpenAlexAccess(url, access.apiKey);
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

function workPeople(work: OpenAlexApiWork): { authors: string[]; institutions: string[] } {
  const authors = new Set<string>();
  const institutions = new Set<string>();
  for (const item of Array.isArray(work.authorships) ? work.authorships : []) {
    if (!item || typeof item !== "object") continue;
    const authorship = item as { author?: { display_name?: unknown } | null; institutions?: unknown };
    const author = text(authorship.author?.display_name, 120);
    if (author && authors.size < 3) authors.add(author);
    for (const rawInstitution of Array.isArray(authorship.institutions) ? authorship.institutions : []) {
      if (!rawInstitution || typeof rawInstitution !== "object") continue;
      const institution = text((rawInstitution as { display_name?: unknown }).display_name, 140);
      if (institution && institutions.size < 3) institutions.add(institution);
    }
  }
  return { authors: [...authors], institutions: [...institutions] };
}

function citationNode(work: OpenAlexApiWork, relation: OpenAlexCitationNode["relation"], fallbackUrl: string): OpenAlexCitationNode | null {
  const id = text(work.id, 320);
  const title = text(work.display_name, 260);
  if (!id || !title) return null;
  const people = workPeople(work);
  return {
    id,
    title,
    year: integer(work.publication_year, 1),
    citedByCount: integer(work.cited_by_count) ?? 0,
    url: normalizeDoi(work.doi) || id || fallbackUrl,
    relation,
    topic: text(work.primary_topic?.display_name, 120) || null,
    authors: people.authors,
    institutions: people.institutions,
    citable: false,
  };
}

export async function citationMapOpenAlex(rawInput: unknown): Promise<OpenAlexCitationMap> {
  const input = normalizeConnectionInput(rawInput);
  const searchQuery = input.title || input.doi || "";
  const searchUrl = searchUrlFor(searchQuery);
  if (process.env.FEDERATED_DISCOVERY_ENABLED?.trim() === "false") {
    return { status: "disabled", relationsStatus: "not_requested", searchUrl, match: EMPTY_MATCH, seed: null, nodes: [] };
  }
  const access = openAlexAccess();
  if (!access.allowed) return { status: "link_only", relationsStatus: "not_requested", searchUrl, match: EMPTY_MATCH, seed: null, nodes: [] };
  const fetchJson = async (url: URL) => {
    addOpenAlexAccess(url, access.apiKey);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(OPENALEX_TIMEOUT_MS) });
    if (response.status === 429) throw new Error("rate_limited");
    if (!response.ok) throw new Error("unavailable");
    return response.json() as Promise<Record<string, unknown>>;
  };
  try {
    const seedUrl = new URL("https://api.openalex.org/works");
    if (input.doi) seedUrl.searchParams.set("filter", `doi:${input.doi}`);
    else seedUrl.searchParams.set("search", input.title);
    seedUrl.searchParams.set("per_page", "5");
    seedUrl.searchParams.set("select", CONNECTION_SELECT);
    let seedPayload = await fetchJson(seedUrl);
    let seedCandidates = (Array.isArray(seedPayload.results) ? seedPayload.results : []) as OpenAlexApiWork[];
    let selected = matchCandidate(input, seedCandidates);
    if (input.doi && selected.match.status !== "verified" && input.title) {
      const titleUrl = new URL("https://api.openalex.org/works");
      titleUrl.searchParams.set("search", input.title);
      titleUrl.searchParams.set("per_page", "5");
      titleUrl.searchParams.set("select", CONNECTION_SELECT);
      seedPayload = await fetchJson(titleUrl);
      seedCandidates = (Array.isArray(seedPayload.results) ? seedPayload.results : []) as OpenAlexApiWork[];
      selected = matchCandidate({ ...input, doi: null }, seedCandidates);
    }
    const seedWork = selected.work;
    if (!seedWork) return { status: "connected", relationsStatus: "not_requested", searchUrl, match: selected.match, seed: null, nodes: [] };
    const seed = citationNode(seedWork, "seed", searchUrl);
    if (!seed) return { status: "connected", relationsStatus: "not_requested", searchUrl, match: EMPTY_MATCH, seed: null, nodes: [] };
    if (selected.match.requiresHumanReview) {
      return { status: "connected", relationsStatus: "not_requested", searchUrl, match: selected.match, seed, nodes: [] };
    }
    const references = (Array.isArray(seedWork.referenced_works) ? seedWork.referenced_works : []).slice(0, 4).map(openAlexWorkId).filter(Boolean);
    const related = (Array.isArray(seedWork.related_works) ? seedWork.related_works : []).slice(0, 4).map(openAlexWorkId).filter(Boolean);
    const incomingUrl = new URL("https://api.openalex.org/works");
    incomingUrl.searchParams.set("filter", `cites:${openAlexWorkId(seed.id)}`);
    incomingUrl.searchParams.set("sort", "cited_by_count:desc");
    incomingUrl.searchParams.set("per_page", "4");
    incomingUrl.searchParams.set("select", CONNECTION_SELECT);
    const relationIds = [...new Set([...references, ...related])];
    const relationRequestNeeded = relationIds.length > 0;
    const relationRequest = relationRequestNeeded ? (() => {
      const relationUrl = new URL("https://api.openalex.org/works");
      relationUrl.searchParams.set("filter", `openalex:${relationIds.join("|")}`);
      relationUrl.searchParams.set("per_page", String(relationIds.length));
      relationUrl.searchParams.set("select", CONNECTION_SELECT);
      return fetchJson(relationUrl);
    })() : Promise.resolve({ results: [] });
    const [incomingResult, relationResult] = await Promise.allSettled([fetchJson(incomingUrl), relationRequest]);
    const incomingPayload = incomingResult.status === "fulfilled" ? incomingResult.value : { results: [] };
    const relationPayload = relationResult.status === "fulfilled" ? relationResult.value : { results: [] };
    const expectedRequests = relationRequestNeeded ? 2 : 1;
    const fulfilledRequests = Number(incomingResult.status === "fulfilled")
      + Number(relationRequestNeeded && relationResult.status === "fulfilled");
    const relationsStatus = fulfilledRequests === expectedRequests
      ? "complete"
      : fulfilledRequests === 0 ? "unavailable" : "partial";
    const incoming = (Array.isArray(incomingPayload.results) ? incomingPayload.results : [])
      .map((work) => citationNode(work as OpenAlexApiWork, "cited_by", searchUrl)).filter((node): node is OpenAlexCitationNode => Boolean(node));
    const referenceSet = new Set(references);
    const outward = (Array.isArray(relationPayload.results) ? relationPayload.results : [])
      .map((work) => citationNode(work as OpenAlexApiWork, referenceSet.has(openAlexWorkId((work as OpenAlexApiWork).id)) ? "cites" : "related", searchUrl))
      .filter((node): node is OpenAlexCitationNode => Boolean(node));
    return { status: "connected", relationsStatus, searchUrl, match: selected.match, seed, nodes: [...incoming, ...outward].slice(0, 12) };
  } catch (error) {
    return {
      status: error instanceof Error && error.message === "rate_limited" ? "rate_limited" : "unavailable",
      relationsStatus: "not_requested",
      searchUrl,
      match: EMPTY_MATCH,
      seed: null,
      nodes: [],
    };
  }
}
