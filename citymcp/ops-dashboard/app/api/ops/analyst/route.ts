import { NextResponse } from "next/server";

import { searchTransportEvidence } from "@/lib/mcp";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";
import type { AnalystBrief, SmartCityEvent, SmartCityHotspot, SourceHealth } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalystRequest = {
  question?: string;
  hotspot?: SmartCityHotspot;
  events?: SmartCityEvent[];
  sourceHealth?: SourceHealth[];
};

function eventLine(event: SmartCityEvent): string {
  return `${event.title} (${event.severity}, confidence ${Math.round(event.confidence * 100)}%)`;
}

export async function POST(request: Request) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "run.research_gate");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  const body = (await request.json()) as AnalystRequest;
  const hotspot = body.hotspot;
  const question =
    body.question?.trim() ||
    `Transport safety guidance for ${hotspot?.name ?? "selected real-data hotspot"} with live incident context`;
  const liveSignals = (body.events ?? []).slice(0, 4).map(eventLine);
  const sourceWarnings = (body.sourceHealth ?? [])
    .filter((source) => source.status !== "ok")
    .slice(0, 3)
    .map((source) => `${source.name}: ${source.status}`);

  try {
    const evidence = await searchTransportEvidence(
      `${question}. road safety accident hotspot traffic signal pedestrian motorcycle Bangkok Thailand`,
    );
    const hotspotName = hotspot?.name ?? "Selected transport hotspot";
    const summary =
      evidence.length > 0
        ? `${hotspotName} has live operational signals and relevant transport-safety research context. Treat the risk as actionable, but keep the recommendation evidence-bounded.`
        : `${hotspotName} has live operational signals, but CivilMCP did not return transport evidence for this query.`;

    const brief: AnalystBrief = {
      generatedAt: new Date().toISOString(),
      mode: "mcp_read_only",
      question,
      hotspotName,
      summary,
      liveSignals,
      guidance: [
        "Confirm the live signal with camera coverage or field staff before intervention.",
        "Rank measures by reversibility: warning, signal timing, queue management, then infrastructure treatment.",
        "Record whether each claim comes from live data, historical pattern, inference, or CivilMCP research evidence.",
      ],
      evidence,
      limitations: [
        "CivilMCP was called through read-only tool retrieval only.",
        sourceWarnings.length > 0
          ? `Source-health caveat: ${sourceWarnings.join("; ")}.`
          : "All configured source-health rows are available for this dashboard response.",
      ],
    };

    return NextResponse.json(brief, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: "CivilMCP evidence is unavailable; analyst guidance is locked until read-only retrieval succeeds.",
        details: error instanceof Error ? error.message : "CivilMCP read-only retrieval failed.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
