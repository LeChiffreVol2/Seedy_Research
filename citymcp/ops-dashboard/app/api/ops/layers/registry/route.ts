import { NextResponse } from "next/server";

import { getLayerRegistry } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const registry = await getLayerRegistry();
    return NextResponse.json(registry, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Layer registry read failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
