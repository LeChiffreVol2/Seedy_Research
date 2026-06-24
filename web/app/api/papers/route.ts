import { getPaperDetail } from "@/lib/research-feed";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sourceFromPath = url.pathname.startsWith("/api/papers/")
      ? decodeURIComponent(url.pathname.slice("/api/papers/".length))
      : "";
    const source = (url.searchParams.get("source") || sourceFromPath).trim();
    if (!source) {
      return Response.json({ error: "Paper source is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const payload = await getPaperDetail(source);
    if (!payload) {
      return Response.json({ error: "Paper not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    return Response.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: "Failed to load paper detail.",
        detail: error instanceof Error ? error.message : "Unknown error",
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
