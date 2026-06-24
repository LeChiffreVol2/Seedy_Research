import { NextResponse } from "next/server";

import { getSourceSla } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getSourceSla();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source SLA read failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
