import { NextResponse } from "next/server";

import { executeAndPersistMapCommands } from "@/lib/command-audit";
import { getOpsActor, requireOpsPermission } from "@/lib/ops-auth";
import type { OpsMapCommand } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CommandExecuteRequest = {
  commands?: OpsMapCommand[];
  researchRunId?: string | null;
  proposalId?: string | null;
  insightId?: string | null;
  objectIds?: string[];
  acknowledgements?: string[];
};

export async function POST(request: Request) {
  const actor = getOpsActor(request);
  try {
    requireOpsPermission(actor, "apply.ui_command");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
  }

  const body = (await request.json()) as CommandExecuteRequest;
  if (!Array.isArray(body.commands) || body.commands.length === 0) {
    return NextResponse.json({ error: "commands are required" }, { status: 422 });
  }
  if (body.commands.length > 25) {
    return NextResponse.json({ error: "Too many commands in one batch." }, { status: 422 });
  }
  if (body.commands.some((command) => command.type === "run_research_gate")) {
    try {
      requireOpsPermission(actor, "run.research_gate");
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Permission denied" }, { status: 403 });
    }
  }

  try {
    const commands = await executeAndPersistMapCommands({
      actor,
      commands: body.commands,
      researchRunId: body.researchRunId ?? null,
      proposalId: body.proposalId ?? null,
      insightId: body.insightId ?? null,
      objectIds: body.objectIds ?? [],
      acknowledgements: body.acknowledgements ?? [],
    });
    return NextResponse.json({ actor, commands }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not execute map commands" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
