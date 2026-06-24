import { NextResponse } from "next/server";

import { listCommandLog } from "@/lib/command-audit";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "read.ops");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  const url = new URL(request.url);
  const objectId = url.searchParams.get("object_id");
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const commands = await listCommandLog({ objectId, limit: Number.isFinite(limit) ? limit : 100 });
  return NextResponse.json({ actor, commands }, { headers: { "Cache-Control": "no-store" } });
}
