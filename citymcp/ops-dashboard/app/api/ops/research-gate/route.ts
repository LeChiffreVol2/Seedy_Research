import { NextResponse } from "next/server";

import { searchTransportEvidence } from "@/lib/mcp";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";
import {
  actionableEvidenceIds,
  buildEvidenceUseRows,
  evidenceUseSummary,
  proposalRationaleFromEvidence,
} from "@/lib/research-gate-evidence";
import {
  bindResearchGateResponseForPersistence,
  buildEvidenceProvenance,
  buildResearchGateMapCommands,
  buildResearchGateWorkflow,
  getReadModelInsights,
  getReadModelOntology,
  persistResearchGateRun,
} from "@/lib/spatial-read-model";
import type {
  McpEvidence,
  ResearchGateFinding,
  ResearchGateProposal,
  ResearchGateResponse,
  SmartCityActionType,
  SmartCityInsight,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResearchGateRequest = {
  objectIds?: string[];
  insightId?: string;
  insight?: Pick<SmartCityInsight, "id">;
};

const SYNTHETIC_MARKER = /\b(mock|seed|synthetic|pilot|static|fallback)\b/i;

function hasSyntheticMarker(values: string[]): boolean {
  return values.some((value) => SYNTHETIC_MARKER.test(value));
}

function buildQuestions(insight: SmartCityInsight, objectNames: string[]): string[] {
  const target = objectNames.join(", ") || insight.title;
  return [
    `For ${target}, what crash or disruption mechanisms should operators verify first, especially queue spillback, signal compliance, pedestrian exposure, or level-crossing conflicts?`,
    `Which reversible local interventions are supported for ${insight.objectType.replaceAll("_", " ")} transport risk in Thailand or comparable urban traffic contexts?`,
    `What measurable effect should bound expected risk reduction for ${target}, and which indicators should be monitored before and after the action?`,
  ];
}

function uniqueEvidence(evidence: McpEvidence[]): McpEvidence[] {
  const seen = new Set<string>();
  const unique: McpEvidence[] = [];
  for (const item of evidence) {
    const key = `${item.id}:${item.citation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function actionTypeFor(insight: SmartCityInsight): SmartCityActionType {
  if (insight.objectType === "rail_crossing" || /rail|crossing|srt|รถไฟ/i.test(insight.title)) return "audit_signal";
  if (/camera|cctv/i.test(insight.recommendedAction)) return "verify_camera";
  if (/queue|spillback|signal/i.test(insight.recommendedAction)) return "queue_control_review";
  return "monitor_watchlist";
}

function buildProposal(
  insight: SmartCityInsight,
  citations: McpEvidence[],
  evidenceUseRows: ReturnType<typeof buildEvidenceUseRows>,
): ResearchGateProposal[] {
  if (citations.length === 0) return [];
  const actionType = actionTypeFor(insight);
  const evidenceFactor = Math.min(1, citations.length / 6);
  const actionFactor: Record<SmartCityActionType, number> = {
    verify_camera: 0.05,
    audit_signal: 0.14,
    queue_control_review: 0.1,
    dispatch_field_check: 0.07,
    monitor_watchlist: 0.04,
  };
  const reduction = Math.round(insight.riskBefore * actionFactor[actionType] * (0.55 + evidenceFactor * 0.45));
  const expectedRiskAfter = Math.max(1, insight.riskBefore - reduction);

  return [
    {
      id: `proposal:${actionType}:${insight.id}`,
      actionType,
      title:
        actionType === "audit_signal"
          ? `Signal/crossing audit for ${insight.title}`
          : actionType === "queue_control_review"
            ? `Queue spillback review for ${insight.title}`
            : actionType === "verify_camera"
              ? `Camera verification for ${insight.title}`
              : `Monitor ${insight.title} on the transport watchlist`,
      rationale: proposalRationaleFromEvidence(insight, evidenceUseRows, actionType),
      confidence: Math.min(0.9, 0.54 + evidenceFactor * 0.28),
      riskBefore: insight.riskBefore,
      expectedRiskAfter,
      delta: expectedRiskAfter - insight.riskBefore,
      evidenceIds: citations.map((item) => `mcp:${item.id}`),
      caveat: "Expected risk reduction is a rule-based simulation, not a measured field outcome.",
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

  const body = (await request.json()) as ResearchGateRequest;
  const requestedInsightId = body.insightId?.trim() || body.insight?.id?.trim();

  if (!requestedInsightId) {
    return NextResponse.json({ error: "insightId is required" }, { status: 422 });
  }
  const insight = (await getReadModelInsights({ domain: "transport", limit: 200 })).insights.find(
    (item) => item.id === requestedInsightId,
  );
  if (!insight) {
    return NextResponse.json({ error: "Insight must exist in the current read model." }, { status: 422 });
  }
  const allowedObjectIds = new Set([insight.objectId, ...insight.sourceObjectIds]);
  const objectIds = [...new Set(body.objectIds?.length ? body.objectIds : [...allowedObjectIds])];

  if (objectIds.length === 0) {
    return NextResponse.json({ error: "objectIds are required" }, { status: 422 });
  }
  if (objectIds.some((id) => !allowedObjectIds.has(id))) {
    return NextResponse.json({ error: "objectIds must belong to the selected server-side insight." }, { status: 422 });
  }
  if (insight.evidenceIds.length === 0 || insight.sourceObjectIds.length === 0) {
    return NextResponse.json({ error: "CivilMCP Analyst requires a real-source insight with provenance evidence." }, { status: 422 });
  }
  if (hasSyntheticMarker([insight.id, insight.title, ...objectIds, ...insight.evidenceIds])) {
    return NextResponse.json({ error: "Synthetic/mock/seed/static/fallback objects are not allowed in CivilMCP Analyst." }, { status: 422 });
  }

  const model = await getReadModelOntology({});
  const objects = objectIds.map((id) => model.objects.find((object) => object.id === id)).filter(Boolean);
  if (objects.length === 0) {
    return NextResponse.json({ error: "No selected object ID exists in the current real-data ontology read model." }, { status: 422 });
  }

  const names = objects.map((object) => object?.displayName ?? "").filter(Boolean);
  const questions = buildQuestions(insight, names);

  try {
    const researchEvidence = (
      await Promise.all(
        questions.map((question) =>
          searchTransportEvidence(`${question} Thailand transport safety rail crossing crash intervention before after study`),
        ),
      )
    ).flat();
    const citations = uniqueEvidence(
      researchEvidence.filter((item) => item.citation && item.citation !== "CivilMCP source · Untitled section"),
    );
    const actionType = actionTypeFor(insight);
    const evidenceUse = buildEvidenceUseRows({
      citations,
      insight,
      actionType,
      objectNames: names,
    });
    const actionableIds = actionableEvidenceIds(evidenceUse);
    const actionableCitations = citations.filter((item) => actionableIds.has(`mcp:${item.id}`));

    const findings: ResearchGateFinding[] = [
      {
        kind: "live_data",
        title: "Live data",
        summary: `${insight.title}: ${insight.whyNow}`,
        evidence: [],
      },
      {
        kind: "historical_baseline",
        title: "Historical/baseline",
        summary:
          insight.evidence.find((item) => item.kind === "historical_baseline")?.value ??
          "No linked historical baseline object is available in the current read model.",
        evidence: [],
      },
      {
        kind: "mcp_research",
        title: "MCP research",
        summary: evidenceUseSummary(citations.length, evidenceUse),
        evidence: citations.slice(0, 6),
      },
      {
        kind: "inference",
        title: "Inference",
        summary: insight.nextVerificationStep,
        evidence: [],
      },
    ];

    const recommendedActions = buildProposal(insight, actionableCitations, evidenceUse);
    const response: ResearchGateResponse = {
      generatedAt: new Date().toISOString(),
      mode: "mcp_read_only",
      objectIds,
      insightId: insight.id,
      findings,
      recommendedActions,
      evidenceUse,
      limitations: [
        "CivilMCP was called through read-only retrieval only.",
        actionableCitations.length > 0
          ? "Recommended actions are available only from direct/indirect cited MCP evidence."
          : "Citations were context-only or unavailable, so no action is executable.",
        "Recording stores an auditable ops action; it does not call field systems.",
      ],
    };
    response.workflowTrace = buildResearchGateWorkflow(response, insight);
    response.mapCommands = buildResearchGateMapCommands(response, insight);
    response.evidenceProvenance = buildEvidenceProvenance(response);

    const prepared = bindResearchGateResponseForPersistence(response);
    const persistence = await persistResearchGateRun(prepared);
    const recordableResponse: ResearchGateResponse = {
      ...prepared,
      researchRunId: persistence.researchRunId,
      researchPersisted: persistence.persisted,
      recommendedActions: persistence.persisted ? prepared.recommendedActions : [],
      limitations: persistence.persisted
        ? prepared.limitations
        : [...prepared.limitations, "Action recording requires a persisted Research Gate run; this environment is read-only."],
    };

    return NextResponse.json(recordableResponse, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: "CivilMCP research is unavailable; Research Gate did not create a recordable proposal.",
        objectIds,
        insightId: insight.id,
        details: error instanceof Error ? error.message : "CivilMCP research failed.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
