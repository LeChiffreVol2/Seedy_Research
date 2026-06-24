import { NextResponse } from "next/server";

import { parseBbox } from "@/lib/ontology";
import { getReadModelInsights } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  const bbox = parseBbox(url.searchParams.get("bbox"));
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.max(0, Math.min(200, Math.round(rawLimit))) : 50;

  const result = await getReadModelInsights({ domain, bbox, limit });

  return NextResponse.json(
    {
      generatedAt: result.generatedAt,
      domain: "transport",
      count: result.insights.length,
      insights: result.insights,
      hotPath: "read_model_only_no_mcp",
      readModel: result.readModel,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
