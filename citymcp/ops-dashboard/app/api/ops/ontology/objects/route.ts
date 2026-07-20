import { NextResponse } from "next/server";

import { parseBbox } from "@/lib/ontology";
import { getReadModelOntology } from "@/lib/spatial-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const bbox = parseBbox(url.searchParams.get("bbox"));
  const updatedSince = url.searchParams.get("updated_since");

  const filtered = await getReadModelOntology({ type, bbox, updatedSince });

  return NextResponse.json(filtered, { headers: { "Cache-Control": "no-store" } });
}
