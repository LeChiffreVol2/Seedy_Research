import { NextRequest, NextResponse } from "next/server";

import { getVisibilityReceipt, getVisibilitySummary } from "@/lib/visibility-audit";
import { safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const source = url.searchParams.get("source")?.replace(/[\u0000-\u001F]/g, "").trim() ?? "";
    if (source.length > 512) {
      return NextResponse.json(
        { error: "Source identifier is too long.", code: "invalid_source" },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    const payload = source
      ? { receipt: await getVisibilityReceipt(source) }
      : { summary: await getVisibilitySummary("tci_thaijo") };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=900" },
    });
  } catch (error) {
    const traceId = safeTraceId();
    console.error("seedy_visibility_read_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Visibility audit is temporarily unavailable.", code: "visibility_unavailable", traceId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
