import { listResearchFeed } from "@/lib/research-feed";
import { safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const payload = await listResearchFeed({
      filter: url.searchParams.get("filter"),
      collection: url.searchParams.get("collection"),
      q: url.searchParams.get("q"),
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    });

    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const traceId = safeTraceId();
    console.error("civilmcp_research_feed_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      {
        error: "Failed to load research feed.",
        traceId,
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
