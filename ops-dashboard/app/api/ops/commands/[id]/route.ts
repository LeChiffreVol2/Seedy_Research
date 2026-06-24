import { NextResponse } from "next/server";

import { getCommandDetail } from "@/lib/command-audit";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "read.ops");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  const { id } = await context.params;
  const detail = await getCommandDetail(decodeURIComponent(id));
  if (!detail.command) {
    return NextResponse.json({ error: "Command not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ actor, ...detail }, { headers: { "Cache-Control": "no-store" } });
}
