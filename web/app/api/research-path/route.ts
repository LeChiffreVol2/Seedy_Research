import { NextRequest, NextResponse } from "next/server";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { discoverOpenAlex, normalizeOpenAlexQuery } from "@/lib/openalex";
import { listResearchFeed, type ResearchFeedCard } from "@/lib/research-feed";
import { getRequestIp, rateLimitHeaders, readBoundedJson, safeTraceId } from "@/lib/server-guards";

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

const LEVELS = new Set<PathLevel>(["foundation", "applied", "research"]);
const OUTCOMES = new Set<PathOutcome>(["literature_review", "study_plan", "decision_brief"]);
const STAGE_TITLES = ["Map the field", "Inspect the methods", "Compare the evidence", "Build your position"];

function compactGoal(value: unknown): string {
  return normalizeOpenAlexQuery(value);
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

export async function POST(request: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);

  let body: PathRequest;
  try {
    body = await readBoundedJson<PathRequest>(request, 8_192);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode === 413 ? 413 : 400;
    return finalize(NextResponse.json({ error: status === 413 ? "Research path request is too large." : "Invalid research path request." }, { status }));
  }

  const goal = compactGoal(body.goal);
  const level = LEVELS.has(body.level as PathLevel) ? (body.level as PathLevel) : "applied";
  const outcome = OUTCOMES.has(body.outcome as PathOutcome) ? (body.outcome as PathOutcome) : "literature_review";
  const collection = body.collection === "ncce" || body.collection === "ce_project" ? body.collection : "";
  if (goal.length < 8) return finalize(NextResponse.json({ error: "Describe a research goal in at least 8 characters." }, { status: 422 }));

  const quota = await consumeChatQuota({
    scope: "research_path",
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 2,
    guestHourLimit: 12,
    authenticatedMinuteLimit: 5,
    authenticatedHourLimit: 40,
  }).catch(() => null);
  if (!quota) {
    return finalize(NextResponse.json(
      { error: "Research Path quota service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    ));
  }
  const quotaHeaders = { ...rateLimitHeaders(quota), "Cache-Control": "private, no-store" };
  if (!quota.allowed) {
    return finalize(NextResponse.json(
      { error: "Research Path limit reached.", resetAt: new Date(quota.resetAt).toISOString() },
      { status: 429, headers: quotaHeaders },
    ));
  }

  try {
    const matched = await listResearchFeed({ filter: "evidence", collection, q: goal, limit: 12 });
    const cards = uniqueCards(matched.cards);
    if (cards.length < 4) {
      return finalize(NextResponse.json(
        { error: "CivilMCP found too few strong matches. Make the topic more specific or try a related engineering term." },
        { status: 422, headers: quotaHeaders },
      ));
    }
    const sourceCodes = cards.map((card) => card.paperCode || card.source.replace(/\.md$/i, ""));
    const openAlexResult = await discoverOpenAlex(goal, { maxResults: 4 });
    const openAlex = {
      status: openAlexResult.status === "disabled" || openAlexResult.status === "rate_limited"
        ? "unavailable" as const
        : openAlexResult.status,
      searchUrl: openAlexResult.searchUrl,
      works: openAlexResult.works.map(({ citable: _citable, doi: _doi, ...work }) => work),
    };

    const levelInstruction = {
      foundation: "Build vocabulary first and explain each method in plain language.",
      applied: "Connect methods to practical engineering decisions and implementation limits.",
      research: "Interrogate methods, validity, contradictions, and unanswered questions.",
    }[level];
    const outcomeInstruction = {
      literature_review: "End with a defensible literature map and research gap.",
      study_plan: "End with a concise study sequence and self-check questions.",
      decision_brief: [
        "End with a research-to-project brief covering the Thai problem context, supporting evidence,",
        "a proposed method, capability needed, uncertainty, and the next bounded experiment.",
        "Do not infer technology readiness, intellectual-property freedom, or commercial viability.",
      ].join(" "),
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

    return finalize(NextResponse.json({
      version: "civilmcp-research-path-v2",
      goal,
      level,
      outcome,
      sourceCodes,
      stages,
      openAlex,
      generatedAt: new Date().toISOString(),
    }, { headers: quotaHeaders }));
  } catch (error) {
    const traceId = safeTraceId();
    console.error("civilmcp_research_path_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return finalize(NextResponse.json(
      { error: "CivilMCP could not build this research path.", traceId },
      { status: 503, headers: quotaHeaders },
    ));
  }
}
