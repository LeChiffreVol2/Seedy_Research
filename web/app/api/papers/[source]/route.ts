import { getPaperDetail, type PaperEvidenceTarget } from "@/lib/research-feed";
import { safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";
export const dynamicParams = true;

type RouteContext = {
  params: Promise<{ source: string }>;
};

function boundedIndex(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : null;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const source = params.source?.trim();
    if (!source) {
      return Response.json({ error: "Paper source is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const url = new URL(request.url);
    const evidenceTarget: PaperEvidenceTarget = {
      id: url.searchParams.get("evidence")?.trim().slice(0, 120) || null,
      sectionIndex: boundedIndex(url.searchParams.get("section")),
      chunkIndex: boundedIndex(url.searchParams.get("chunk")),
      pageStart: boundedIndex(url.searchParams.get("page")),
    };
    const payload = await getPaperDetail(source, true, evidenceTarget);
    if (!payload) {
      return Response.json({ error: "Paper not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const traceId = safeTraceId();
    console.error("civilmcp_paper_detail_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      {
        error: "Failed to load paper detail.",
        traceId,
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
