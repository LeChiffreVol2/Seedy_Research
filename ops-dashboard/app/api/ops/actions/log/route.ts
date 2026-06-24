import { NextResponse } from "next/server";

import { listActionRecords } from "@/lib/action-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const objectId = url.searchParams.get("object_id");
  const records = await listActionRecords({ objectId });

  return NextResponse.json({ records }, { headers: { "Cache-Control": "no-store" } });
}

