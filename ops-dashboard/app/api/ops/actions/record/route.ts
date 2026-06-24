import { NextResponse } from "next/server";

import { ActionRecordGateError, recordPersistedResearchAction } from "@/lib/action-recording-gate";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActionRecordRequest = {
  actor?: string;
  researchRunId?: string;
  proposalId?: string;
  acknowledgements?: string[];
};

export async function POST(request: Request) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "record.action");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  const body = (await request.json()) as ActionRecordRequest;
  if (body.actor) {
    return NextResponse.json({ error: "actor is derived server-side and must not be supplied by the client." }, { status: 422 });
  }

  try {
    const record = await recordPersistedResearchAction({
      actor,
      researchRunId: body.researchRunId ?? "",
      proposalId: body.proposalId ?? "",
      acknowledgements: body.acknowledgements ?? [],
    });

    return NextResponse.json(
      {
        record,
        limitations: record.limitations,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not create action record",
        ...(error instanceof ActionRecordGateError ? error.details : {}),
      },
      { status: 422 },
    );
  }
}
