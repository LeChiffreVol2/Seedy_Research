import { NextResponse } from "next/server";

import { transitionActionRecord } from "@/lib/action-lifecycle";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";
import type { SmartCityActionRecordStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<SmartCityActionRecordStatus>([
  "proposed",
  "acknowledged",
  "recorded",
  "pending_approval",
  "approved",
  "assigned",
  "in_progress",
  "verified",
  "closed",
  "rejected",
  "cancelled",
  "expired",
  "superseded",
  "failed",
]);

type TransitionRequest = {
  toStatus?: SmartCityActionRecordStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "transition.action");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  const body = (await request.json()) as TransitionRequest;
  if (!body.toStatus || !VALID_STATUSES.has(body.toStatus)) {
    return NextResponse.json({ error: "A valid toStatus is required." }, { status: 422 });
  }
  if (body.toStatus === "approved") {
    try {
      requireOpsPermission(actor, "approve.action");
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
    }
  }

  try {
    const { id } = await context.params;
    const event = await transitionActionRecord({
      actionId: decodeURIComponent(id),
      actor,
      toStatus: body.toStatus,
      reason: body.reason ?? null,
      metadata: body.metadata ?? {},
    });
    return NextResponse.json({ actor, event }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not transition action record" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
