import { NextResponse } from "next/server";

import { getRailSafetyOverview } from "@/lib/rail-adapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const overview = await getRailSafetyOverview();
  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
