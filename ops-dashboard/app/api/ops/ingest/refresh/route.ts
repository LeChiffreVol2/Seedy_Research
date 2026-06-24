import { NextResponse } from "next/server";

import { configuredIngestSecret, isAuthorizedIngestRequest } from "@/lib/ingest-auth";
import { refreshSpatialCoreReadModel } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runIngestRefresh(request: Request, method: "GET" | "POST") {
  if (!configuredIngestSecret()) {
    return NextResponse.json({ error: "OPS_INGEST_SECRET or CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!isAuthorizedIngestRequest(request)) {
    return NextResponse.json({ error: "Unauthorized ingest refresh" }, { status: 401 });
  }

  try {
    const result = await refreshSpatialCoreReadModel();
    return NextResponse.json(
      {
        ...result,
        invokedBy: method === "GET" ? "cron_or_authenticated_get" : "authenticated_post",
        cronSchedule: request.headers.get("x-vercel-cron-schedule"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Spatial ingest refresh failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  return runIngestRefresh(request, "POST");
}

export async function GET(request: Request) {
  return runIngestRefresh(request, "GET");
}
