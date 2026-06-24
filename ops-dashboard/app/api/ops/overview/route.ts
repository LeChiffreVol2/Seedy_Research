import { NextResponse } from "next/server";

import { ensureFreshSpatialCoreReadModel, getReadModelOverview } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const refresh = await ensureFreshSpatialCoreReadModel();
  const overview = await getReadModelOverview();
  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "no-store",
      "X-Smart-City-Refresh": `${refresh.reason}; refreshed=${refresh.refreshed}`,
    },
  });
}
