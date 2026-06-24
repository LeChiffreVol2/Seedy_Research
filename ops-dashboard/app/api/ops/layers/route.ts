import { NextResponse } from "next/server";

import { parseBbox } from "@/lib/ontology";
import { decodeLayerCursor, getLayerFeatures, layerMaxFeatures } from "@/lib/spatial-read-model";
import type { OpsLayerKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LAYER_IDS = new Set<OpsLayerKey>([
  "incidents",
  "hotspots",
  "cameras",
  "congestion",
  "weather",
  "roadworks",
  "osiris",
  "rail",
  "assets",
]);

function parseTypes(value: string | null): { types?: OpsLayerKey[]; invalid: string[] } {
  if (!value) return { invalid: [] };
  const raw = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = raw.filter((item) => !LAYER_IDS.has(item as OpsLayerKey));
  const types = raw.filter((item): item is OpsLayerKey => LAYER_IDS.has(item as OpsLayerKey));
  return { types: types.length ? [...new Set(types)] : undefined, invalid };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawBbox = url.searchParams.get("bbox");
  const bbox = parseBbox(rawBbox);
  if (rawBbox && !bbox) {
    return NextResponse.json({ error: "Invalid bbox. Expected west,south,east,north within WGS84 bounds." }, { status: 400 });
  }
  if (!bbox) {
    return NextResponse.json({ error: "bbox is required for viewport-driven ops layer reads." }, { status: 400 });
  }
  const rawZoom = Number(url.searchParams.get("zoom"));
  const zoom = Number.isFinite(rawZoom) ? Math.max(0, Math.min(24, rawZoom)) : null;
  const parsedTypes = parseTypes(url.searchParams.get("types"));
  if (parsedTypes.invalid.length > 0) {
    return NextResponse.json({ error: "Unknown layer type", invalidTypes: parsedTypes.invalid }, { status: 400 });
  }
  const since = url.searchParams.get("since");
  if (since && Number.isNaN(new Date(since).getTime())) {
    return NextResponse.json({ error: "Invalid since timestamp." }, { status: 400 });
  }
  const rawLimit = url.searchParams.get("limit");
  let parsedLimit: number | null = null;
  if (rawLimit !== null) {
    const value = Number(rawLimit);
    if (!Number.isFinite(value) || value <= 0) {
      return NextResponse.json({ error: "Invalid limit." }, { status: 400 });
    }
    parsedLimit = value;
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeLayerCursor(rawCursor);
  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }
  const effectiveLimit = parsedLimit == null ? null : Math.min(parsedLimit, layerMaxFeatures());

  try {
    const features = await getLayerFeatures({
      bbox,
      zoom,
      types: parsedTypes.types,
      since,
      limit: effectiveLimit,
      cursor,
    });
    return NextResponse.json(features, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PostGIS layer read failed";
    if (/cursor/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
      { error: message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
