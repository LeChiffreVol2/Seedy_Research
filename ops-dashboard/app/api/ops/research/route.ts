import { NextResponse } from "next/server";

import { searchTransportEvidence } from "@/lib/mcp";
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

function fallbackResponse(hotspotName: string, questions: ResearchQuestion[], reason: string): ResearchWorkflowResponse {
  return {
    generatedAt: new Date().toISOString(),
    mode: "offline_fallback",
    hotspotName,
    questions,
    findings: questions.map((question) => ({
      questionId: question.id,
      question: question.question,
      answer: "Research service unavailable. Treat this as an analyst question until evidence is available.",
      evidence: [],
    })),
    proposals: [],
    limitations: [
      reason,
      "No external operation was executed. Recommended actions remain ops action records only.",
      "CivilMCP must be reachable to convert questions into evidence-backed findings.",
    ],
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as ResearchRequest;
  const hotspotName = body.hotspot?.name ?? "Selected transport hotspot";
  const questions = buildQuestions(body.hotspot, body.events ?? []);

  try {
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
      fallbackResponse(hotspotName, questions, error instanceof Error ? error.message : "CivilMCP research failed."),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
