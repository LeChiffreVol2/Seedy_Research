import { NextResponse } from "next/server";

import { searchTransportEvidence } from "@/lib/mcp";
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

function fallbackBrief(body: AnalystRequest, reason: string): AnalystBrief {
  const hotspotName = body.hotspot?.name ?? "Selected transport hotspot";
  const liveSignals = (body.events ?? []).slice(0, 4).map(eventLine);
  return {
    generatedAt: new Date().toISOString(),
    mode: "offline_fallback",
    question: body.question ?? "What should operators review?",
    hotspotName,
    summary: `${hotspotName} should be treated as a transport-safety monitoring priority until live source confidence improves.`,
    liveSignals,
    guidance: [
      "Verify the hotspot with camera or field observation before issuing operational changes.",
      "Separate live incident signals from historical crash patterns in the operations note.",
      "Prioritize short-cycle interventions: signal timing review, temporary warning, enforcement, and pedestrian conflict audit.",
    ],
    evidence: [],
    limitations: [
      reason,
      "No writes were made to CivilMCP or smart-city tables.",
      "Research-backed guidance is limited until the read-only MCP service is reachable.",
    ],
  };
}

export async function POST(request: Request) {
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
      fallbackBrief(body, error instanceof Error ? error.message : "CivilMCP read-only retrieval failed."),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
