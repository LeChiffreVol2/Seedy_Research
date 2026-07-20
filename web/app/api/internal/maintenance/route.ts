import { NextRequest, NextResponse } from "next/server";

import { pruneCivilOperationalData } from "@/lib/chat-store";
import { isPlaceholderSecret, isStrictProductionRuntime } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || isPlaceholderSecret(secret)) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: isStrictProductionRuntime() ? "Unauthorized." : "CRON_SECRET is missing or invalid." },
      { status: isStrictProductionRuntime() ? 401 : 503 },
    );
  }
  try {
    const result = await pruneCivilOperationalData();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("civilmcp_retention_cleanup_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Retention cleanup failed." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
