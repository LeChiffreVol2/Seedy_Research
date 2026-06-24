import { getPaperDetail } from "@/lib/research-feed";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";
export const dynamicParams = true;

type RouteContext = {
  params: Promise<{ source: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const source = params.source?.trim();
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
