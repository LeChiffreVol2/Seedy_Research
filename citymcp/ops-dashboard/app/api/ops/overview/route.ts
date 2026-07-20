import { NextResponse } from "next/server";

import { getReadModelOverview } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const overview = await getReadModelOverview();
  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "no-store",
      "X-Smart-City-Refresh": "read_only; refreshed=false",
    },
  });
}
