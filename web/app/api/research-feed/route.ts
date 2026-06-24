import { listResearchFeed } from "@/lib/research-feed";

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
        "Cache-Control": "private, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: "Failed to load research feed.",
        detail: error instanceof Error ? error.message : "Unknown error",
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
