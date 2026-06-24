import { NextResponse } from "next/server";

import { searchCivilEvidence } from "@/lib/mcp";
import { simulateRailImprovement } from "@/lib/rail-adapters";
import type {
  McpEvidence,
  RailActionProposal,
  RailEvidenceKind,
  RailResearchFinding,
  RailResearchWorkflowResponse,
  RailSafetyCase,
  ResearchQuestion,
  SmartCityAsset,
  SmartCityEvent,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RailResearchRequest = {
  railCase?: RailSafetyCase;
  events?: SmartCityEvent[];
  crossings?: SmartCityAsset[];
};

function caseName(railCase?: RailSafetyCase) {
  return railCase?.name ?? "Selected SRT level crossing";
}

function buildQuestions(railCase?: RailSafetyCase, events: SmartCityEvent[] = []): ResearchQuestion[] {
  const name = caseName(railCase);
  const signalTypes = [...new Set(events.map((event) => event.eventType.replaceAll("_", " ")))].join(", ") || "rail crossing risk";
  return [
    {
      id: "mechanism",
      question: `What crash mechanisms should analysts investigate for ${name}, especially barrier timing, queue spillback, bus or road vehicle exposure, and driver compliance at a level crossing?`,
      reason: "Classify the failure mechanism before recommending an intervention.",
    },
    {
      id: "intervention",
      question: `Which reversible interventions are supported for ${signalTypes} at urban railway level crossings: camera verification, flashing warning lights, barrier/signal audit, queue clearance, or traffic signal coordination?`,
      reason: "Keep v1 actions operational and reversible before permanent infrastructure treatment.",
    },
    {
      id: "effect",
      question: `What measurable before-after indicators should be used to evaluate expected risk reduction after railway level crossing improvements?`,
      reason: "Turn research into a bounded simulation delta rather than claiming measured outcome.",
    },
  ];
}

function findingAnswer(kind: RailEvidenceKind, evidence: McpEvidence[]): string {
  if (evidence.length === 0) {
    return "CivilMCP did not return direct evidence. Keep this finding as an analyst assumption until more indexed research or field data is connected.";
  }
  if (kind === "mcp_research") {
    return `CivilMCP returned ${evidence.length} cited transport-safety evidence packet(s) for supported interventions.`;
  }
  if (kind === "baseline_historical") {
    return `Use ${evidence.length} cited evidence packet(s) to define before/after indicators and baseline limits.`;
  }
  return `CivilMCP returned ${evidence.length} evidence packet(s) that help bound the inference.`;
}

function proposal(
  railCase: RailSafetyCase,
  id: string,
  title: string,
  intervention: "verify" | "signal_audit" | "queue_control" | "warning_review",
  evidence: McpEvidence[],
  rationale: string,
): RailActionProposal {
  const basis = evidence.length > 0 ? evidence.slice(0, 3).map((item) => item.citation) : ["no direct CivilMCP citation"];
  return {
    id,
    title,
    actionType: intervention === "verify" ? "verify" : "operate",
    confidence: Math.min(0.9, evidence.length > 0 ? 0.56 + Math.min(evidence.length, 6) * 0.055 : 0.38),
    rationale,
    executionScope: "controlled_action_record",
    simulation: simulateRailImprovement({
      proposalId: id,
      beforeRisk: railCase.riskScore,
      intervention,
      evidenceCount: evidence.length,
      basis,
    }),
  };
}

function buildProposals(railCase: RailSafetyCase, evidence: McpEvidence[]): RailActionProposal[] {
  if (evidence.length === 0) return [];
  return [
    proposal(
      railCase,
      "rail-camera-field-verify",
      "Open camera and field verification packet",
      "verify",
      evidence,
      "Confirm whether vehicles are entering the crossing envelope during train approach before changing operations.",
    ),
    proposal(
      railCase,
      "rail-signal-barrier-audit",
      "Barrier and warning-signal timing audit",
      "signal_audit",
      evidence,
      "Check barrier closure timing, flashing warning visibility, and driver compliance at the crossing.",
    ),
    proposal(
      railCase,
      "rail-queue-clearance-control",
      "Road queue clearance control",
      "queue_control",
      evidence,
      "Coordinate road signal timing and enforcement to prevent queue spillback into the rail crossing envelope.",
    ),
    proposal(
      railCase,
      "rail-warning-review",
      "Signage and flashing-warning review",
      "warning_review",
      evidence,
      "Prioritize reversible warning treatments while field evidence and baseline statistics are improved.",
    ),
  ];
}

function fallbackResponse(railCase: RailSafetyCase, body: RailResearchRequest, reason: string): RailResearchWorkflowResponse {
  const questions = buildQuestions(railCase, body.events ?? []);
  return {
    generatedAt: new Date().toISOString(),
    mode: "offline_fallback",
    caseId: railCase.id,
    caseName: railCase.name,
    questions,
    findings: questions.map((question) => ({
      questionId: question.id,
      question: question.question,
      kind: "inference",
      answer: "CivilMCP unavailable or returned no direct evidence. No intervention action is generated from unavailable evidence.",
      evidence: [],
    })),
    proposals: [],
    limitations: [
      reason,
      "No synthetic rail case or mock coordinate was created.",
      "No writes were made to CivilMCP, civil_* tables, smart_city_* tables, or external field systems.",
      "Simulation deltas are expected risk changes only, not measured outcomes.",
    ],
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as RailResearchRequest;
  const railCase = body.railCase;
  if (!railCase) {
    return NextResponse.json(
      { error: "A real rail case is required. Real-data-only mode will not create a synthetic fallback case." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const questions = buildQuestions(railCase, body.events ?? []);

  try {
    const mechanismEvidence = await searchCivilEvidence(
      `${questions[0].question} railway level crossing accident crash mechanism train road vehicle bus Thailand`,
      "transport",
      5,
    );
    const interventionEvidence = await searchCivilEvidence(
      `${questions[1].question} advanced warning flashing light pedestrian vehicle crossing signal timing barrier safety`,
      "transport",
      5,
    );
    const effectEvidence = await searchCivilEvidence(
      `${questions[2].question} before after safety improvement crossing accident reduction traffic warning signal`,
      "transport",
      5,
    );

    const findings: RailResearchFinding[] = [
      {
        questionId: "mechanism",
        question: questions[0].question,
        kind: "live_news_signal",
        answer: findingAnswer("live_news_signal", mechanismEvidence),
        evidence: mechanismEvidence.slice(0, 3),
      },
      {
        questionId: "intervention",
        question: questions[1].question,
        kind: "mcp_research",
        answer: findingAnswer("mcp_research", interventionEvidence),
        evidence: interventionEvidence.slice(0, 3),
      },
      {
        questionId: "effect",
        question: questions[2].question,
        kind: "baseline_historical",
        answer: findingAnswer("baseline_historical", effectEvidence),
        evidence: effectEvidence.slice(0, 3),
      },
      {
        questionId: "inference",
        question: "What should the analyst infer before field execution?",
        kind: "inference",
        answer:
          "Prioritize reversible operations first: verify camera/field state, audit barrier and warning timing, then simulate queue clearance before proposing permanent treatment.",
        evidence: [],
      },
    ];

    const allEvidence = [...mechanismEvidence, ...interventionEvidence, ...effectEvidence];
    const response: RailResearchWorkflowResponse = {
      generatedAt: new Date().toISOString(),
      mode: "mcp_read_only",
      caseId: railCase.id,
      caseName: railCase.name,
      questions,
      findings,
      proposals: buildProposals(railCase, allEvidence),
      limitations: [
        "CivilMCP was used through read-only retrieval only.",
        allEvidence.length > 0
          ? "Recommended actions are generated only because CivilMCP returned cited evidence."
          : "No direct CivilMCP evidence was returned, so no action was generated.",
        "Execute records an ops action only and does not mutate field systems.",
        "Before/after values are simulation deltas, not measured post-improvement outcomes.",
      ],
    };

    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      fallbackResponse(railCase, body, error instanceof Error ? error.message : "CivilMCP rail research failed."),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
