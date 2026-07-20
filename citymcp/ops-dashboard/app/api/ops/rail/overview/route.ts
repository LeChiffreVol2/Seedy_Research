import { NextResponse } from "next/server";

import { getReadModelRailOverview } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const overview = await getReadModelRailOverview();
  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
