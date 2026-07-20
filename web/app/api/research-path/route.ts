import { NextRequest } from "next/server";

import { listResearchFeed, type ResearchFeedCard } from "@/lib/research-feed";
import { readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

type PathLevel = "foundation" | "applied" | "research";
type PathOutcome = "literature_review" | "study_plan" | "decision_brief";

type PathRequest = {
  goal?: unknown;
  level?: unknown;
  outcome?: unknown;
  collection?: unknown;
};

type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  display_name?: string;
  publication_year?: number | null;
  cited_by_count?: number | null;
  primary_topic?: { display_name?: string } | null;
};

const LEVELS = new Set<PathLevel>(["foundation", "applied", "research"]);
const OUTCOMES = new Set<PathOutcome>(["literature_review", "study_plan", "decision_brief"]);
const STAGE_TITLES = ["Map the field", "Inspect the methods", "Compare the evidence", "Build your position"];

function compactGoal(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280)
    : "";
}

function pathPaper(card: ResearchFeedCard) {
  return {
    id: card.id,
    source: card.source,
    paperCode: card.paperCode ?? null,
    collection: card.collection,
    title: card.title,
    summary: card.summary,
    discipline: card.discipline ?? null,
    pageLabel: card.pageLabel,
    evidenceCount: card.evidenceCount,
  };
}

function uniqueCards(cards: ResearchFeedCard[], limit = 8): ResearchFeedCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = card.source || card.id;
    if (!key || seen.has(key) || seen.size >= limit) return false;
    seen.add(key);
    return true;
  });
}

async function openAlexBridge(goal: string) {
  const searchUrl = `https://openalex.org/works?search=${encodeURIComponent(goal)}`;
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (!apiKey) return { status: "link_only" as const, searchUrl, works: [] };

  try {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", goal);
    url.searchParams.set("per-page", "4");
    url.searchParams.set("select", "id,doi,display_name,publication_year,cited_by_count,primary_topic");
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { status: "unavailable" as const, searchUrl, works: [] };
    const payload = (await response.json()) as { results?: OpenAlexWork[] };
    const works = (payload.results ?? []).slice(0, 4).map((work) => ({
      id: work.id ?? "",
      title: (work.display_name ?? "Untitled research work").slice(0, 220),
      year: work.publication_year ?? null,
      citedByCount: work.cited_by_count ?? 0,
      topic: work.primary_topic?.display_name?.slice(0, 120) ?? null,
      url: work.doi || work.id || searchUrl,
    }));
    return { status: "connected" as const, searchUrl, works };
  } catch {
    return { status: "unavailable" as const, searchUrl, works: [] };
  }
}

export async function POST(request: NextRequest) {
  let body: PathRequest;
  try {
    body = await readBoundedJson<PathRequest>(request, 8_192);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  const goal = compactGoal(body.goal);
  const level = LEVELS.has(body.level as PathLevel) ? (body.level as PathLevel) : "applied";
  const outcome = OUTCOMES.has(body.outcome as PathOutcome) ? (body.outcome as PathOutcome) : "literature_review";
  const collection = body.collection === "ncce" || body.collection === "ce_project" ? body.collection : "";
  if (goal.length < 8) return Response.json({ error: "Describe a research goal in at least 8 characters." }, { status: 422 });

  try {
    const matched = await listResearchFeed({ filter: "evidence", collection, q: goal, limit: 12 });
    const cards = uniqueCards(matched.cards);
    if (cards.length < 4) {
      return Response.json(
        { error: "CivilMCP found too few strong matches. Make the topic more specific or try a related engineering term." },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    const sourceCodes = cards.map((card) => card.paperCode || card.source.replace(/\.md$/i, ""));
    const openAlex = await openAlexBridge(goal);

    const levelInstruction = {
      foundation: "Build vocabulary first and explain each method in plain language.",
      applied: "Connect methods to practical engineering decisions and implementation limits.",
      research: "Interrogate methods, validity, contradictions, and unanswered questions.",
    }[level];
    const outcomeInstruction = {
      literature_review: "End with a defensible literature map and research gap.",
      study_plan: "End with a concise study sequence and self-check questions.",
      decision_brief: "End with a decision-ready brief that separates evidence from inference.",
    }[outcome];

    const stagePapers = Array.from({ length: STAGE_TITLES.length }, () => [] as ResearchFeedCard[]);
    cards.forEach((card, index) => stagePapers[index % STAGE_TITLES.length].push(card));
    const stages = STAGE_TITLES.map((title, index) => {
      const papers = stagePapers[index].slice(0, 2);
      const codes = papers.map((paper) => paper.paperCode || paper.source.replace(/\.md$/i, ""));
      const objectives = [
        `Define the field around ${goal} and identify the main Thai research themes.`,
        "Examine how the selected studies collected data, measured outcomes, and handled limitations.",
        "Compare findings across papers, looking for agreement, conflict, and context-specific results.",
        `Synthesize a position for your ${outcome.replace(/_/g, " ")} and name what evidence is still missing.`,
      ];
      return {
        id: `stage-${index + 1}`,
        title,
        objective: objectives[index],
        papers: papers.map(pathPaper),
        prompt: [
          `Research goal: ${goal}`,
          `Learning stage: ${title}. ${objectives[index]}`,
          levelInstruction,
          outcomeInstruction,
          codes.length ? `Prioritize these papers: ${codes.join(", ")}.` : "Search the strongest matching CivilMCP papers.",
          "Use exact-page evidence, distinguish findings from inference, and finish with one checkpoint question.",
        ].join(" "),
      };
    });

    return Response.json({
      version: "civilmcp-research-path-v2",
      goal,
      level,
      outcome,
      sourceCodes,
      stages,
      openAlex,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: "CivilMCP could not build this research path.", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
