import { NextResponse } from "next/server";

import { getLayerMvtTile, tileMaxZoom } from "@/lib/spatial-read-model";
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

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

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

export async function GET(request: Request, context: { params: Promise<{ z: string; x: string; y: string }> }) {
  const params = await context.params;
  const z = parseInteger(params.z);
  const x = parseInteger(params.x);
  const y = parseInteger(params.y.replace(/\.mvt$/i, ""));
  const maxZoom = tileMaxZoom();

  if (z === null || x === null || y === null || z > maxZoom) {
    return NextResponse.json({ error: `Invalid tile coordinate. z/x/y must be integers and z <= ${maxZoom}.` }, { status: 400 });
  }
  const maxCoord = 2 ** z;
  if (x < 0 || y < 0 || x >= maxCoord || y >= maxCoord) {
    return NextResponse.json({ error: "Invalid tile coordinate outside zoom bounds." }, { status: 400 });
  }

  const url = new URL(request.url);
  const parsedTypes = parseTypes(url.searchParams.get("types"));
  if (parsedTypes.invalid.length > 0) {
    return NextResponse.json({ error: "Unknown layer type", invalidTypes: parsedTypes.invalid }, { status: 400 });
  }
  const since = url.searchParams.get("since");
  if (since && Number.isNaN(new Date(since).getTime())) {
    return NextResponse.json({ error: "Invalid since timestamp." }, { status: 400 });
  }

  try {
    const result = await getLayerMvtTile({ z, x, y, types: parsedTypes.types, since });
    if (result.tile.length === 0) {
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "X-CityMCP-Feature-Count": "0",
          "X-CityMCP-Truncated": "false",
        },
      });
    }
    return new Response(new Uint8Array(result.tile), {
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": "no-store",
        "X-CityMCP-Feature-Count": String(result.featureCount),
        "X-CityMCP-Truncated": String(result.truncated),
        "X-CityMCP-Generated-At": result.generatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MVT tile read failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
