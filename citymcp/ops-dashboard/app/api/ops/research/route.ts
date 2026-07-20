import { NextResponse } from "next/server";

import { searchTransportEvidence } from "@/lib/mcp";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";
import { getReadModelOverview } from "@/lib/spatial-read-model";
import type {
  ActionProposal,
  ResearchFinding,
  ResearchQuestion,
  ResearchWorkflowResponse,
  SmartCityEvent,
  SmartCityHotspot,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResearchRequest = {
  hotspot?: SmartCityHotspot;
  events?: SmartCityEvent[];
};

const SYNTHETIC_MARKER = /\b(mock|seed|synthetic|static|fallback)\b/i;

function containsSyntheticMarker(values: string[]): boolean {
  return values.some((value) => SYNTHETIC_MARKER.test(value));
}

function relatedRealEvents(hotspot: SmartCityHotspot, events: SmartCityEvent[]) {
  const corridor = hotspot.corridor.toLowerCase();
  return events
    .filter((event) => {
      const haystack = `${event.title} ${event.description} ${String(event.attributes.corridor ?? "")}`.toLowerCase();
      return haystack.includes(corridor.split(" ")[0] ?? corridor);
    })
    .slice(0, 4);
}

function buildQuestions(hotspot?: SmartCityHotspot, events: SmartCityEvent[] = []): ResearchQuestion[] {
  const name = hotspot?.name ?? "selected hotspot";
  const corridor = hotspot?.corridor ?? "selected corridor";
  const eventTypes = [...new Set(events.map((event) => event.eventType.replace("_", " ")))].join(", ") || "live incident";

  return [
    {
      id: "mechanism",
      question: `What crash mechanisms should operators investigate at ${name} on ${corridor}, especially for motorcycles, pedestrians, and turning conflicts?`,
      reason: "Find the likely safety mechanism before recommending an intervention.",
    },
    {
      id: "intervention",
      question: `Which short-cycle operational interventions are supported for a ${eventTypes} hotspot in Thailand or Southeast Asian traffic conditions?`,
      reason: "Separate fast reversible operations from design-heavy measures.",
    },
    {
      id: "evidence-risk",
      question: `What evidence connects traffic state, weather, speed, or queue spillback to accident severity and hotspot prioritization?`,
      reason: "Check whether the current live signal is strong enough to justify action.",
    },
  ];
}

function evidenceSummary(evidenceCount: number, question: string): string {
  if (evidenceCount === 0) {
    return "CivilMCP did not return direct evidence for this question. Keep this as an analyst assumption until more data is connected.";
  }
  return `CivilMCP returned ${evidenceCount} transport-safety evidence packet(s). Use this question to bound any action: ${question}`;
}

function buildProposals(hotspotName: string, evidenceCount: number): ActionProposal[] {
  if (evidenceCount === 0) return [];
  const baseConfidence = evidenceCount > 0 ? 0.78 : 0.52;
  return [
    {
      id: "verify-camera-field",
      title: "Open camera/field verification packet",
      actionType: "verify",
      confidence: Math.min(0.92, baseConfidence + 0.08),
      rationale: "Verify the live signal before changing operations or issuing public-facing messages.",
      executionScope: "controlled_action_record",
    },
    {
      id: "queue-signal-review",
      title: `Signal and conflict review for ${hotspotName}`,
      actionType: "operate",
      confidence: baseConfidence,
      rationale: "Research and live context point to reversible timing, warning, and queue management checks.",
      executionScope: "controlled_action_record",
    },
    {
      id: "monitor-watchlist",
      title: "Add hotspot to 24h safety watchlist",
      actionType: "monitor",
      confidence: Math.min(0.9, baseConfidence + 0.04),
      rationale: "Keeps the hotspot visible while upstream sources and field validation improve confidence.",
      executionScope: "controlled_action_record",
    },
  ];
}

export async function POST(request: Request) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "run.research_gate");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  let hotspotName = "Selected transport hotspot";
  let questions: ResearchQuestion[] = [];
  try {
    const body = (await request.json()) as ResearchRequest;
    if (!body.hotspot?.id) {
      return NextResponse.json({ error: "A real hotspot id is required." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    const requestedEventIds = new Set((body.events ?? []).map((event) => event.id));
    if (containsSyntheticMarker([body.hotspot.id, body.hotspot.name, body.hotspot.corridor, ...requestedEventIds])) {
      return NextResponse.json({ error: "Synthetic/mock/static/fallback objects are not accepted in real-data-only research." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }

    const overview = await getReadModelOverview();
    const hotspot = overview.hotspots.find((item) => item.id === body.hotspot?.id);
    if (!hotspot) {
      return NextResponse.json({ error: "Selected hotspot is not present in the current real read model." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    const requestedEvents = overview.events.filter((event) => requestedEventIds.has(event.id));
    if (requestedEventIds.size > requestedEvents.length) {
      return NextResponse.json({ error: "One or more selected events are not present in the current real read model." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    const events = requestedEvents.length > 0 ? requestedEvents : relatedRealEvents(hotspot, overview.events);
    hotspotName = hotspot.name;
    questions = buildQuestions(hotspot, events);
    const findings: ResearchFinding[] = [];
    for (const question of questions) {
      const evidence = await searchTransportEvidence(`${question.question} Thailand road safety traffic accident hotspot`);
      findings.push({
        questionId: question.id,
        question: question.question,
        answer: evidenceSummary(evidence.length, question.question),
        evidence: evidence.slice(0, 3),
      });
    }

    const evidenceCount = findings.reduce((sum, finding) => sum + finding.evidence.length, 0);
    const response: ResearchWorkflowResponse = {
      generatedAt: new Date().toISOString(),
      mode: "mcp_read_only",
      hotspotName,
      questions,
      findings,
      proposals: buildProposals(hotspotName, evidenceCount),
      limitations: [
        "CivilMCP was used as read-only research retrieval.",
        evidenceCount > 0
          ? "Recommended actions are generated only because CivilMCP returned cited evidence."
          : "No direct CivilMCP evidence was returned, so no action was generated.",
        "Execute only records an ops action in this dashboard; it does not change field systems.",
      ],
    };

    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: "CivilMCP research is unavailable; no evidence-backed proposal was generated.",
        hotspotName,
        questions,
        details: error instanceof Error ? error.message : "CivilMCP research failed.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
