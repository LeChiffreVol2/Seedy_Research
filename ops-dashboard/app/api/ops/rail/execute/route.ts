import { NextResponse } from "next/server";

import { listActionRecords } from "@/lib/action-log";
import { ActionRecordGateError, recordPersistedResearchAction } from "@/lib/action-recording-gate";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";
import type { RailActionProposal, RailActionRecord, RailSafetyCase } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExecuteRailRequest = {
  railCase?: RailSafetyCase;
  proposal?: RailActionProposal;
  researchRunId?: string;
  proposalId?: string;
  acknowledgements?: string[];
};

export async function GET() {
  const records = await listActionRecords();
  return NextResponse.json(
    {
      records: records
        .filter((record) => record.sourceObjectIds.some((id) => id.startsWith("hotspot:rail-case")))
        .map((record) => ({
          id: record.id,
          proposalId: record.evidenceIds[0] ?? record.id,
          caseId: record.sourceObjectIds.find((id) => id.startsWith("hotspot:rail-case"))?.replace("hotspot:", "") ?? "unknown",
          title: record.title,
          createdAt: record.createdAt,
          executionScope: record.executionScope,
          simulation: {
            proposalId: record.evidenceIds[0] ?? record.id,
            beforeRisk: record.riskBefore,
            afterExpectedRisk: record.expectedRiskAfter,
            delta: record.expectedRiskAfter - record.riskBefore,
            confidence: 0.5,
            evidenceBasis: record.evidenceIds,
            caveat: "Persisted action record replay; see action log for full audit fields.",
          },
        })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "record.action");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  const body = (await request.json()) as ExecuteRailRequest;
  const researchRunId = body.researchRunId?.trim();
  const proposalId = body.proposalId?.trim();
  if (!researchRunId || !proposalId) {
    return NextResponse.json(
      {
        error:
          "Rail action recording requires persisted Research Gate researchRunId and proposalId. Client-supplied railCase/proposal payloads are not trusted.",
      },
      { status: 422 },
    );
  }

  try {
    const actionRecord = await recordPersistedResearchAction({
      actor,
      researchRunId,
      proposalId,
      acknowledgements: body.acknowledgements ?? [],
    });
    const caseObjectId = actionRecord.sourceObjectIds.find((id) => /rail|crossing|hotspot/i.test(id)) ?? actionRecord.sourceObjectIds[0] ?? "unknown";
    const record: RailActionRecord = {
      id: actionRecord.id,
      proposalId,
      caseId: caseObjectId.replace(/^hotspot:/, ""),
      title: actionRecord.title,
      createdAt: actionRecord.createdAt,
      executionScope: actionRecord.executionScope,
      simulation: {
        proposalId,
        beforeRisk: actionRecord.riskBefore,
        afterExpectedRisk: actionRecord.expectedRiskAfter,
        delta: actionRecord.expectedRiskAfter - actionRecord.riskBefore,
        confidence: 0.5,
        evidenceBasis: actionRecord.evidenceIds,
        caveat: "Persisted Research Gate action record; expected risk delta is not a measured outcome.",
      },
    };

    return NextResponse.json(
      {
        record,
        limitations: [
          "Ops action record only.",
          "Action accepted only through persisted CivilMCP Research Gate evidence.",
          "No writes were made to CivilMCP, civil_* tables, or external field systems.",
        ],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not record rail action",
        ...(error instanceof ActionRecordGateError ? error.details : {}),
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
