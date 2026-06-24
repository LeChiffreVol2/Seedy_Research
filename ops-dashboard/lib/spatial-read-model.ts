import type { Feature, FeatureCollection, Point } from "geojson";
import { createHash, randomUUID } from "node:crypto";

import { loadOpsEnv } from "./env";
import {
  buildActionableInsights,
  buildOntologyReadModel,
  filterOntologyReadModel,
  type Bbox,
  type InsightFilter,
} from "./ontology";
import { getRailSafetyOverview } from "./rail-adapters";
import { getThailandTransportOverview } from "./source-adapters";
import type {
  GeoPoint,
  HotspotEvidence,
  OntologyEvidenceKind,
  OntologyLinkType,
  OntologyReadModel,
  OpsEvidenceProvenance,
  OpsLayerKey,
  OpsLayerRegistryItem,
  OpsLayerRegistryResponse,
  OpsMapCommand,
  OpsSourceSla,
  OpsSourceSlaResponse,
  ResearchGateEvidenceStrength,
  ResearchGateProposal,
  OpsOverview,
  OpsWorkflowTraceStep,
  RailOverview,
  ResearchGateResponse,
  Severity,
  SmartCityAsset,
  SmartCityEvent,
  SmartCityHotspot,
  SmartCityInsight,
  SmartCityInsightEvidence,
  SmartCityOntologyLink,
  SmartCityOntologyObject,
  SmartCitySource,
  SourceDataClass,
  SourceHealth,
  SourceStatus,
  TimelineBucket,
} from "./types";

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

type SourceRow = {
  id: string;
  name: string;
  provider: string;
  category: string;
  region: string;
  source_url: string | null;
  refresh_seconds: number | null;
  data_class: SourceDataClass | null;
  refresh_policy: string | null;
  upstream_cadence: string | null;
  updated_at?: string;
};

type SourceHealthRow = {
  source_id: string;
  status: SourceStatus;
  last_success_at: string | null;
  last_attempt_at: string | null;
  latency_ms: number | null;
  record_count: number | null;
  freshness_seconds: number | null;
  message: string | null;
  data_class: SourceDataClass | null;
  refresh_policy: string | null;
  last_modified: string | null;
  upstream_cadence: string | null;
  updated_at?: string;
  is_eligible_for_layers?: boolean | null;
  is_eligible_for_insights?: boolean | null;
  ineligible_reason?: string | null;
};

type EventRow = {
  id: string;
  source_id: string | null;
  event_type: SmartCityEvent["eventType"];
  severity: Severity;
  confidence: number | string;
  observed_at: string;
  expires_at: string | null;
  region: string;
  title: string;
  description: string;
  source_url: string | null;
  attributes: JsonRecord;
  updated_at?: string;
  last_seen_ingest_run_id?: string | null;
  last_seen_at?: string;
  is_stale?: boolean;
  stale_reason?: string | null;
};

type AssetRow = {
  id: string;
  source_id: string | null;
  asset_type: SmartCityAsset["assetType"];
  name: string;
  region: string;
  attributes: JsonRecord;
  updated_at?: string;
  last_seen_ingest_run_id?: string | null;
  last_seen_at?: string;
  is_stale?: boolean;
  stale_reason?: string | null;
};

type HotspotRow = {
  id: string;
  region: string;
  name: string;
  corridor: string;
  risk_score: number;
  trend: SmartCityHotspot["trend"];
  severity: Severity;
  confidence: number | string;
  attributes: JsonRecord;
  evidence: HotspotEvidence[];
  recommended_action: string;
  source_object_ids?: string[];
  source_ids?: string[];
  updated_at: string;
  last_seen_ingest_run_id?: string | null;
  last_seen_at?: string;
  is_stale?: boolean;
  stale_reason?: string | null;
};

type ObjectRow = {
  id: string;
  object_type: SmartCityOntologyObject["objectType"];
  display_name: string;
  source_id: string | null;
  region: string;
  severity: Severity | null;
  confidence: number | string | null;
  observed_at: string | null;
  updated_at: string;
  source_url: string | null;
  properties: JsonRecord;
  provenance: string[];
  last_seen_ingest_run_id?: string | null;
  last_seen_at?: string;
  is_stale?: boolean;
  stale_reason?: string | null;
};

type LinkRow = {
  id: string;
  link_type: OntologyLinkType;
  from_object_id: string;
  to_object_id: string;
  confidence: number | string;
  reason: string;
  distance_meters: number | null;
  last_seen_ingest_run_id?: string | null;
  last_seen_at?: string;
  is_stale?: boolean;
  stale_reason?: string | null;
};

type InsightRow = {
  id: string;
  domain: "transport";
  object_id: string;
  object_type: SmartCityInsight["objectType"];
  title: string;
  why_now: string;
  evidence: SmartCityInsightEvidence[];
  recommended_action: string;
  next_verification_step: string;
  severity: Severity;
  confidence: number | string;
  risk_before: number;
  expected_risk_after: number;
  delta: number;
  source_object_ids: string[];
  evidence_ids: string[];
  caveat: string;
  requires_research: boolean;
  generated_at: string;
  last_seen_ingest_run_id?: string | null;
  last_seen_at?: string;
  is_stale?: boolean;
  stale_reason?: string | null;
};

type IngestRunRow = {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  counts: JsonRecord;
};

type LayerRegistryRow = {
  layer_id: OpsLayerKey;
  active_count: number | string;
  stale_count: number | string;
  total_count: number | string;
  source_ids: string[];
  status: SourceStatus | null;
  data_class: SourceDataClass | null;
  freshness_seconds: number | string | null;
  last_refresh_at: string | null;
  geometry_types: Array<"Point" | "LineString" | "Polygon" | string>;
};

type LayerFeatureRpcRow = {
  id: string;
  row_kind: string;
  layer_id: OpsLayerKey;
  object_type: string;
  source_id: string | null;
  source_ids: string[];
  title: string;
  severity: Severity | null;
  confidence: number | string | null;
  observed_at: string | null;
  updated_at: string | null;
  source_url: string | null;
  data_class: SourceDataClass | null;
  status: SourceStatus | null;
  freshness_seconds: number | string | null;
  eligibility_reason: string | null;
  is_stale: boolean | null;
  stale_reason: string | null;
  last_seen_at: string | null;
  provenance: string[];
  geometry: GeoPoint;
};

type LayerFeaturePageRpcRow = LayerFeatureRpcRow & {
  cursor_rank: number | string;
  cursor_updated_at: string;
  cursor_id: string;
};

type LayerFeatureStatsRow = {
  total_count: number | string;
  active_count: number | string;
  stale_excluded_count: number | string;
  freshness_excluded_count: number | string;
};

type LayerMvtRpcRow = {
  tile_base64: string | null;
  feature_count: number | string;
  truncated: boolean | null;
  generated_at: string;
};

type SourceSlaRow = {
  source_id: string;
  name: string;
  provider: string;
  category: string;
  region: string;
  status: SourceStatus;
  data_class: SourceDataClass | null;
  sla_state: OpsSourceSla["slaState"];
  breach_reasons: string[] | null;
  seconds_until_breach: number | string | null;
  success_rate_24h: number | string | null;
  p95_latency_ms_24h: number | string | null;
  failures_24h: number | string;
  attempts_24h: number | string;
  record_count: number | string;
  freshness_seconds: number | string | null;
  sla_freshness_seconds: number | string;
  sla_latency_ms: number | string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  message: string | null;
};

type ResearchProposalRow = {
  id: string;
  run_id: string;
  proposal_id: string;
  insight_id: string | null;
  action_type: ResearchGateProposal["actionType"];
  title: string;
  rationale: string;
  confidence: number | string;
  risk_before: number | string;
  expected_risk_after: number | string;
  delta: number | string;
  evidence_ids: string[];
  source_object_ids: string[];
  evidence_strengths: Record<string, ResearchGateEvidenceStrength>;
  required_acknowledgements: string[];
  normalized_hash: string;
  caveat: string;
  created_at: string;
};

type ResearchEvidenceRow = {
  evidence_id: string;
  citation: string;
  source: string;
  section_title: string | null;
  evidence_strength: ResearchGateEvidenceStrength;
  matched_terms: string[];
  object_ids: string[];
  action_implication: string | null;
  operator_check: string | null;
};

type SpatialSnapshot = {
  overview: OpsOverview;
  railOverview: RailOverview;
  ontology: OntologyReadModel;
  insights: SmartCityInsight[];
};

type LayerFeatureProperties = {
  id: string;
  layerId: OpsLayerKey;
  objectType: string;
  sourceId: string;
  sourceIds?: string[];
  severity?: Severity;
  title: string;
  dataClass: SourceDataClass;
  status: SourceStatus;
  updatedAt: string | null;
  sourceUrl?: string;
  provenance: string[];
  isStale?: boolean;
  staleReason?: string | null;
  lastSeenAt?: string | null;
  freshnessSeconds?: number | null;
  eligibilityReason?: string | null;
};

const DEFAULT_BATCH_LIMIT = 500;
const DEFAULT_LAYER_MAX_FEATURES = 1200;
const BANGKOK_VIEWPORT = {
  center: [100.548, 13.7563] as [number, number],
  zoom: 10.6,
};

const EMPTY_RAIL_OVERVIEW: RailOverview = {
  generatedAt: new Date(0).toISOString(),
  region: "thailand",
  sources: [],
  sourceHealth: [],
  crossings: [],
  events: [],
  cases: [],
  simulations: [],
};

const LAYER_RENDER: Record<OpsLayerKey, OpsLayerRegistryItem["render"]> = {
  incidents: { color: "#ff5f57", icon: "alert-triangle", minZoom: 8, maxFeatures: 700 },
  hotspots: { color: "#ff9f0a", icon: "radar", minZoom: 8, maxFeatures: 500 },
  cameras: { color: "#30d158", icon: "camera", minZoom: 10, maxFeatures: 800 },
  congestion: { color: "#ff9f0a", icon: "traffic-cone", minZoom: 9, maxFeatures: 700 },
  weather: { color: "#40c8ff", icon: "cloud-rain", minZoom: 7, maxFeatures: 500 },
  roadworks: { color: "#ffd60a", icon: "construction", minZoom: 10, maxFeatures: 500 },
  osiris: { color: "#bf5af2", icon: "satellite", minZoom: 3, maxFeatures: 600 },
  rail: { color: "#ff453a", icon: "train-front", minZoom: 7, maxFeatures: 1200 },
  assets: { color: "#64d2ff", icon: "boxes", minZoom: 9, maxFeatures: 1000 },
};

function envNumber(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  loadOpsEnv();
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function ingestBatchLimit(): number {
  return envNumber("SMART_CITY_INGEST_BATCH_LIMIT", DEFAULT_BATCH_LIMIT, 1, 2000);
}

export function layerMaxFeatures(): number {
  return envNumber("SMART_CITY_LAYER_MAX_FEATURES", DEFAULT_LAYER_MAX_FEATURES, 1, 5000);
}

export function tileMaxFeatures(): number {
  return envNumber("SMART_CITY_TILE_MAX_FEATURES", 5000, 1, 20000);
}

export function tileMaxZoom(): number {
  return envNumber("SMART_CITY_TILE_MAX_ZOOM", 16, 0, 24);
}

function autoRefreshSeconds(): number {
  return envNumber("SMART_CITY_AUTO_REFRESH_SECONDS", 300, 60, 86400);
}

export function spatialReadModelConfigured(): boolean {
  loadOpsEnv();
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

function supabaseRestUrl(path: string): string {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("SUPABASE_URL is required");
  return `${baseUrl}/rest/v1/${path.replace(/^\/+/, "")}`;
}

function supabaseHeaders(prefer?: string): HeadersInit {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_KEY is required");
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function readRows<T>(table: string, params: URLSearchParams): Promise<T[]> {
  const response = await fetch(supabaseRestUrl(`${table}?${params.toString()}`), {
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase read failed for ${table} (${response.status}): ${body.slice(0, 240)}`);
  }
  return (await response.json()) as T[];
}

async function rpcRows<T>(name: string, body: Record<string, unknown>): Promise<T[]> {
  const response = await fetch(supabaseRestUrl(`rpc/${name}`), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase RPC failed for ${name} (${response.status}): ${text.slice(0, 240)}`);
  }
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? (payload as T[]) : ([payload] as T[]);
}

async function rpcValue<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(supabaseRestUrl(`rpc/${name}`), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase RPC failed for ${name} (${response.status}): ${text.slice(0, 240)}`);
  }
  return (await response.json()) as T;
}

async function upsertRows<T extends Record<string, unknown>>(table: string, rows: T[], conflictKey = "id"): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  const batchLimit = ingestBatchLimit();
  for (let index = 0; index < rows.length; index += batchLimit) {
    const batch = rows.slice(index, index + batchLimit);
    const response = await fetch(supabaseRestUrl(`${table}?on_conflict=${encodeURIComponent(conflictKey)}`), {
      method: "POST",
      headers: supabaseHeaders("resolution=merge-duplicates"),
      body: JSON.stringify(batch),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase upsert failed for ${table} (${response.status}): ${body.slice(0, 240)}`);
    }
    written += batch.length;
  }
  return written;
}

function shouldUseAdapterFallback(): boolean {
  loadOpsEnv();
  return !spatialReadModelConfigured() || process.env.SMART_CITY_ALLOW_ADAPTER_FALLBACK === "1";
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFinitePoint(point: GeoPoint | null | undefined): point is GeoPoint {
  if (!point || point.type !== "Point") return false;
  const [lng, lat] = point.coordinates;
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function pointFromAttributes(attributes: JsonRecord): GeoPoint | null {
  const lat = numberValue(attributes.latitude ?? attributes.lat);
  const lng = numberValue(attributes.longitude ?? attributes.lng ?? attributes.lon);
  if (lat === null || lng === null) return null;
  const point: GeoPoint = { type: "Point", coordinates: [lng, lat] };
  return isFinitePoint(point) ? point : null;
}

function pointInBbox(point: GeoPoint, bbox: Bbox | null | undefined): boolean {
  if (!bbox) return true;
  const [lng, lat] = point.coordinates;
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

function ewkt(point: GeoPoint): string {
  const [lng, lat] = point.coordinates;
  return `SRID=4326;POINT(${lng} ${lat})`;
}

function withPointAttributes<T extends Record<string, unknown>>(attributes: T, point: GeoPoint): T & { latitude: number; longitude: number } {
  const [lng, lat] = point.coordinates;
  return { ...attributes, latitude: lat, longitude: lng };
}

function scalarRecord(value: Record<string, unknown>): Record<string, JsonScalar> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonScalar] => {
      const item = entry[1];
      return item === null || ["string", "number", "boolean"].includes(typeof item);
    }),
  );
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function uniqueBySourceId<T extends { sourceId: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.sourceId, row])).values()];
}

function dataClassFor(sourceId: string, health: Map<string, SourceHealth>): SourceDataClass {
  return health.get(sourceId)?.dataClass ?? "needs_config";
}

function sourceStatusFor(sourceId: string, health: Map<string, SourceHealth>): SourceStatus {
  return health.get(sourceId)?.status ?? "needs_config";
}

function sourceCategoryFor(source: SmartCitySource): string {
  return source.category || source.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

function toSourceRow(source: SmartCitySource): SourceRow {
  return {
    id: source.id,
    name: source.name,
    provider: source.provider,
    category: sourceCategoryFor(source),
    region: source.region || "thailand",
    source_url: source.sourceUrl || null,
    refresh_seconds: source.refreshSeconds,
    data_class: source.dataClass ?? null,
    refresh_policy: source.refreshPolicy ?? null,
    upstream_cadence: source.upstreamCadence ?? null,
  };
}

function fromSourceRow(row: SourceRow): SmartCitySource {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    category: row.category,
    region: row.region || "thailand",
    sourceUrl: row.source_url ?? "",
    refreshSeconds: row.refresh_seconds ?? 300,
    dataClass: row.data_class ?? undefined,
    refreshPolicy: row.refresh_policy ?? undefined,
    upstreamCadence: row.upstream_cadence ?? undefined,
  };
}

function toHealthRow(health: SourceHealth): SourceHealthRow {
  return {
    source_id: health.sourceId,
    status: health.status,
    last_success_at: health.lastSuccessAt,
    last_attempt_at: health.lastAttemptAt,
    latency_ms: health.latencyMs,
    record_count: health.recordCount,
    freshness_seconds: health.freshnessSeconds,
    message: health.message,
    data_class: health.dataClass ?? null,
    refresh_policy: health.refreshPolicy ?? null,
    last_modified: health.lastModified ?? null,
    upstream_cadence: health.upstreamCadence ?? null,
  };
}

function lifecycleFields(runId: string | null | undefined, seenAt: string): Record<string, unknown> {
  if (!runId) return {};
  return {
    last_seen_ingest_run_id: runId,
    last_seen_at: seenAt,
    is_stale: false,
    stale_at: null,
    stale_reason: null,
  };
}

function fromHealthRow(row: SourceHealthRow, sourceById: Map<string, SmartCitySource>): SourceHealth {
  const source = sourceById.get(row.source_id);
  return {
    sourceId: row.source_id,
    name: source?.name ?? row.source_id,
    provider: source?.provider ?? "Unknown",
    status: row.status,
    lastSuccessAt: row.last_success_at,
    lastAttemptAt: row.last_attempt_at ?? row.updated_at ?? new Date(0).toISOString(),
    latencyMs: row.latency_ms,
    recordCount: row.record_count ?? 0,
    freshnessSeconds: row.freshness_seconds,
    message: row.message ?? "Source health loaded from spatial read model.",
    dataClass: row.data_class ?? source?.dataClass,
    refreshPolicy: row.refresh_policy ?? source?.refreshPolicy,
    lastModified: row.last_modified,
    upstreamCadence: row.upstream_cadence ?? source?.upstreamCadence,
    isEligibleForLayers: row.is_eligible_for_layers ?? undefined,
    isEligibleForInsights: row.is_eligible_for_insights ?? undefined,
    eligibilityReason: row.ineligible_reason ?? undefined,
  };
}

function eventRowId(event: SmartCityEvent): string {
  return `${event.sourceId}:${event.id}`.replace(/\s+/g, "-");
}

function toEventRow(event: SmartCityEvent, runId?: string | null, seenAt = new Date().toISOString()): EventRow & { geometry: string } {
  return {
    id: eventRowId(event),
    source_id: event.sourceId,
    event_type: event.eventType,
    severity: event.severity,
    confidence: event.confidence,
    observed_at: event.observedAt,
    expires_at: event.expiresAt ?? null,
    region: event.region || "thailand",
    geometry: ewkt(event.geometry),
    title: event.title,
    description: event.description,
    source_url: event.sourceUrl,
    attributes: withPointAttributes({ ...event.attributes, upstreamId: event.id }, event.geometry),
    ...lifecycleFields(runId, seenAt),
  };
}

function fromEventRow(row: EventRow): SmartCityEvent | null {
  const geometry = pointFromAttributes(row.attributes);
  if (!geometry) return null;
  return {
    id: row.id,
    sourceId: row.source_id ?? "unknown-source",
    eventType: row.event_type,
    severity: row.severity,
    confidence: Math.max(0, Math.min(1, Number(row.confidence))),
    observedAt: row.observed_at,
    expiresAt: row.expires_at ?? undefined,
    region: row.region,
    geometry,
    title: row.title,
    description: row.description,
    sourceUrl: row.source_url ?? "",
    attributes: scalarRecord(row.attributes),
  };
}

function toAssetRow(asset: SmartCityAsset, runId?: string | null, seenAt = new Date().toISOString()): AssetRow & { geometry: string } {
  return {
    id: asset.id,
    source_id: asset.sourceId,
    asset_type: asset.assetType,
    name: asset.name,
    region: asset.region || "thailand",
    geometry: ewkt(asset.geometry),
    attributes: withPointAttributes(asset.attributes, asset.geometry),
    ...lifecycleFields(runId, seenAt),
  };
}

function fromAssetRow(row: AssetRow): SmartCityAsset | null {
  const geometry = pointFromAttributes(row.attributes);
  if (!geometry) return null;
  return {
    id: row.id,
    sourceId: row.source_id ?? "unknown-source",
    assetType: row.asset_type,
    name: row.name,
    region: row.region,
    geometry,
    attributes: scalarRecord(row.attributes),
  };
}

function sourceIdsFromHotspot(hotspot: SmartCityHotspot): string[] {
  return [
    ...new Set(
      hotspot.evidence
        .filter((item) => item.kind === "live" || item.kind === "historical")
        .map((item) => item.value)
        .filter((value) => /^[a-z0-9_.:-]+$/i.test(value) && !/^https?:\/\//i.test(value)),
    ),
  ];
}

function toHotspotRow(hotspot: SmartCityHotspot, runId?: string | null, seenAt = new Date().toISOString()): HotspotRow & { geometry: string } {
  return {
    id: hotspot.id,
    region: hotspot.region || "thailand",
    name: hotspot.name,
    corridor: hotspot.corridor,
    risk_score: hotspot.riskScore,
    trend: hotspot.trend,
    severity: hotspot.severity,
    confidence: hotspot.confidence,
    geometry: ewkt(hotspot.geometry),
    attributes: withPointAttributes({}, hotspot.geometry),
    evidence: hotspot.evidence,
    recommended_action: hotspot.recommendedAction,
    source_ids: sourceIdsFromHotspot(hotspot),
    updated_at: hotspot.updatedAt,
    ...lifecycleFields(runId, seenAt),
  };
}

function fromHotspotRow(row: HotspotRow): SmartCityHotspot | null {
  const geometry = pointFromAttributes(row.attributes);
  if (!geometry) return null;
  return {
    id: row.id,
    region: row.region,
    name: row.name,
    corridor: row.corridor,
    riskScore: row.risk_score,
    trend: row.trend,
    severity: row.severity,
    confidence: Math.max(0, Math.min(1, Number(row.confidence))),
    geometry,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    recommendedAction: row.recommended_action,
    updatedAt: row.updated_at,
  };
}

function toObjectRow(object: SmartCityOntologyObject, runId?: string | null, seenAt = new Date().toISOString()): ObjectRow & { geometry: string } {
  return {
    id: object.id,
    object_type: object.objectType,
    display_name: object.displayName,
    source_id: object.sourceId,
    region: object.region || "thailand",
    geometry: ewkt(object.geometry),
    severity: object.severity ?? null,
    confidence: object.confidence ?? null,
    observed_at: object.observedAt ?? null,
    updated_at: object.updatedAt,
    source_url: object.sourceUrl,
    properties: withPointAttributes(object.properties, object.geometry),
    provenance: object.provenance,
    ...lifecycleFields(runId, seenAt),
  };
}

function fromObjectRow(row: ObjectRow): SmartCityOntologyObject | null {
  const geometry = pointFromAttributes(row.properties);
  if (!geometry) return null;
  return {
    id: row.id,
    objectType: row.object_type,
    displayName: row.display_name,
    sourceId: row.source_id ?? "unknown-source",
    region: row.region,
    geometry,
    severity: row.severity ?? undefined,
    confidence: row.confidence === null ? undefined : Math.max(0, Math.min(1, Number(row.confidence))),
    observedAt: row.observed_at ?? undefined,
    updatedAt: row.updated_at,
    sourceUrl: row.source_url ?? "",
    properties: scalarRecord(row.properties),
    provenance: Array.isArray(row.provenance) ? row.provenance : [],
  };
}

function toLinkRow(link: SmartCityOntologyLink, runId?: string | null, seenAt = new Date().toISOString()): LinkRow {
  return {
    id: link.id,
    link_type: link.linkType,
    from_object_id: link.fromObjectId,
    to_object_id: link.toObjectId,
    confidence: link.confidence,
    reason: link.reason,
    distance_meters: link.distanceMeters ?? null,
    ...lifecycleFields(runId, seenAt),
  };
}

function fromLinkRow(row: LinkRow): SmartCityOntologyLink {
  return {
    id: row.id,
    linkType: row.link_type,
    fromObjectId: row.from_object_id,
    toObjectId: row.to_object_id,
    confidence: Math.max(0, Math.min(1, Number(row.confidence))),
    reason: row.reason,
    distanceMeters: row.distance_meters ?? undefined,
  };
}

function toInsightRow(insight: SmartCityInsight, runId?: string | null, seenAt = new Date().toISOString()): InsightRow {
  return {
    id: insight.id,
    domain: insight.domain,
    object_id: insight.objectId,
    object_type: insight.objectType,
    title: insight.title,
    why_now: insight.whyNow,
    evidence: insight.evidence,
    recommended_action: insight.recommendedAction,
    next_verification_step: insight.nextVerificationStep,
    severity: insight.severity,
    confidence: insight.confidence,
    risk_before: insight.riskBefore,
    expected_risk_after: insight.expectedRiskAfter,
    delta: insight.delta,
    source_object_ids: insight.sourceObjectIds,
    evidence_ids: insight.evidenceIds,
    caveat: insight.caveat,
    requires_research: insight.requiresResearch,
    generated_at: insight.generatedAt,
    ...lifecycleFields(runId, seenAt),
  };
}

function fromInsightRow(row: InsightRow): SmartCityInsight {
  return {
    id: row.id,
    domain: row.domain,
    objectId: row.object_id,
    objectType: row.object_type,
    title: row.title,
    whyNow: row.why_now,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    recommendedAction: row.recommended_action,
    nextVerificationStep: row.next_verification_step,
    severity: row.severity,
    confidence: Math.max(0, Math.min(1, Number(row.confidence))),
    riskBefore: row.risk_before,
    expectedRiskAfter: row.expected_risk_after,
    delta: row.delta,
    sourceObjectIds: Array.isArray(row.source_object_ids) ? row.source_object_ids : [],
    evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids : [],
    caveat: row.caveat,
    requiresResearch: row.requires_research,
    generatedAt: row.generated_at,
  };
}

function buildTimeline(events: SmartCityEvent[]): TimelineBucket[] {
  if (events.length === 0) return [];
  const labels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"];
  const buckets = labels.map<TimelineBucket>((label) => ({ label, incidents: 0, congestion: 0, weather: 0 }));
  for (const event of events) {
    const date = new Date(event.observedAt);
    const hour = Number.isNaN(date.getTime()) ? 0 : date.getHours();
    const bucket = buckets[Math.min(buckets.length - 1, Math.floor(hour / 4))];
    if (event.eventType === "congestion") bucket.congestion += 1;
    else if (event.eventType === "weather_risk") bucket.weather += 1;
    else bucket.incidents += 1;
  }
  return buckets;
}

export async function buildSpatialCoreSnapshot(): Promise<SpatialSnapshot> {
  const [overview, railOverview] = await Promise.all([getThailandTransportOverview(), getRailSafetyOverview()]);
  const ontology = buildOntologyReadModel({ overview, railOverview });
  const insights = buildActionableInsights(ontology, { domain: "transport", limit: 200 });
  return { overview, railOverview, ontology, insights };
}

export async function refreshSpatialCoreReadModel(): Promise<{
  persisted: boolean;
  generatedAt: string;
  ingestRunId?: string;
  counts: Record<string, number>;
}> {
  if (!spatialReadModelConfigured()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for spatial ingest refresh.");
  }

  const snapshot = await buildSpatialCoreSnapshot();
  const seenAt = new Date().toISOString();
  const sources = uniqueById([...snapshot.overview.sources, ...snapshot.railOverview.sources, ...snapshot.ontology.sources]);
  const health = uniqueBySourceId([
    ...snapshot.overview.sourceHealth,
    ...snapshot.railOverview.sourceHealth,
    ...snapshot.ontology.sourceHealth,
  ]);
  const events = uniqueById([...snapshot.overview.events, ...snapshot.railOverview.events].filter((event) => isFinitePoint(event.geometry)));
  const assets = uniqueById([...snapshot.overview.assets, ...snapshot.railOverview.crossings].filter((asset) => isFinitePoint(asset.geometry)));
  const hotspots = uniqueById([
    ...snapshot.overview.hotspots,
    ...snapshot.railOverview.cases.map<SmartCityHotspot>((railCase) => ({
      id: railCase.id,
      region: railCase.corridor,
      name: railCase.name,
      corridor: railCase.corridor,
      riskScore: railCase.riskScore,
      trend: "flat",
      severity: railCase.severity,
      confidence: railCase.confidence,
      geometry: railCase.geometry,
      evidence: railCase.evidence.map((item) => ({
        label: item.label,
        value: item.value,
        kind: item.kind === "mcp_research" ? "research" : item.kind === "inference" ? "inferred" : "historical",
      })),
      recommendedAction: railCase.recommendedAction,
      updatedAt: railCase.updatedAt,
    })),
  ].filter((hotspot) => isFinitePoint(hotspot.geometry)));

  const sourceIds = sources.map((source) => source.id);
  const runId = await rpcValue<string>("smart_city_begin_ingest_run", {
    p_run_type: "spatial_core",
    p_requested_by: "ops-dashboard",
    p_request_id: randomUUID(),
    p_source_ids: sourceIds,
    p_metadata: { adapter: "citymcp-spatial-core" },
  });

  const counts: Record<string, number> = {};
  try {
    counts.sources = await upsertRows("smart_city_sources", sources.map(toSourceRow));
    counts.sourceHealth = await upsertRows("smart_city_source_health", health.map(toHealthRow), "source_id");
    counts.assets = await upsertRows("smart_city_assets", assets.map((asset) => toAssetRow(asset, runId, seenAt)));
    counts.events = await upsertRows("smart_city_events", events.map((event) => toEventRow(event, runId, seenAt)));
    counts.hotspots = await upsertRows("smart_city_hotspots", hotspots.map((hotspot) => toHotspotRow(hotspot, runId, seenAt)));
    counts.objects = await upsertRows(
      "smart_city_objects",
      snapshot.ontology.objects.filter((object) => isFinitePoint(object.geometry)).map((object) => toObjectRow(object, runId, seenAt)),
    );
    counts.links = await upsertRows("smart_city_links", snapshot.ontology.links.map((link) => toLinkRow(link, runId, seenAt)));
    counts.insights = await upsertRows("smart_city_insights", snapshot.insights.map((insight) => toInsightRow(insight, runId, seenAt)));

    const succeededSourceIds = health
      .filter((item) => item.status === "ok" || item.status === "degraded" || item.status === "stale")
      .map((item) => item.sourceId);
    const failedSourceIds = health
      .filter((item) => item.status === "offline" || item.status === "needs_config")
      .map((item) => item.sourceId);
    await rpcValue<Record<string, number>>("smart_city_finish_ingest_run", {
      p_run_id: runId,
      p_status: failedSourceIds.length > 0 && succeededSourceIds.length > 0 ? "partial" : failedSourceIds.length > 0 ? "failed" : "succeeded",
      p_succeeded_source_ids: succeededSourceIds,
      p_failed_source_ids: failedSourceIds,
      p_counts: counts,
    });
  } catch (error) {
    await rpcValue("smart_city_finish_ingest_run", {
      p_run_id: runId,
      p_status: "failed",
      p_succeeded_source_ids: [],
      p_failed_source_ids: sourceIds,
      p_counts: counts,
      p_error_code: "refresh_failed",
      p_error_message: error instanceof Error ? error.message.slice(0, 500) : "Spatial refresh failed",
    }).catch(() => undefined);
    throw error;
  }

  return {
    persisted: true,
    generatedAt: new Date().toISOString(),
    ingestRunId: runId,
    counts,
  };
}

async function readSupabaseSourcesAndHealth(): Promise<{ sources: SmartCitySource[]; health: SourceHealth[] } | null> {
  if (!spatialReadModelConfigured()) return null;
  const sourceRows = await readRows<SourceRow>(
    "smart_city_sources",
    new URLSearchParams({ select: "*", order: "updated_at.desc", limit: "200" }),
  );
  if (sourceRows.length === 0) return null;
  const sources = sourceRows.map(fromSourceRow);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const healthRows = await readRows<SourceHealthRow>(
    "smart_city_source_freshness_v",
    new URLSearchParams({ select: "*", order: "updated_at.desc", limit: "200" }),
  ).catch(() =>
    readRows<SourceHealthRow>(
      "smart_city_source_health",
      new URLSearchParams({ select: "*", order: "updated_at.desc", limit: "200" }),
    ),
  );
  const health = healthRows.map((row) => fromHealthRow(row, sourceById));
  return { sources, health };
}

async function readSupabaseOverview(): Promise<OpsOverview | null> {
  const sourceState = await readSupabaseSourcesAndHealth();
  if (!sourceState) return null;
  const maxFeatures = layerMaxFeatures();
  const [eventRows, assetRows, hotspotRows] = await Promise.all([
    readRows<EventRow>(
      "smart_city_events",
      new URLSearchParams({ select: "*", is_stale: "eq.false", order: "observed_at.desc", limit: String(maxFeatures) }),
    ),
    readRows<AssetRow>(
      "smart_city_assets",
      new URLSearchParams({ select: "*", is_stale: "eq.false", order: "updated_at.desc", limit: String(maxFeatures) }),
    ),
    readRows<HotspotRow>(
      "smart_city_hotspots",
      new URLSearchParams({ select: "*", is_stale: "eq.false", order: "updated_at.desc", limit: "300" }),
    ).catch(() => []),
  ]);
  const events = eventRows.map(fromEventRow).filter((event): event is SmartCityEvent => event !== null);
  const assets = assetRows.map(fromAssetRow).filter((asset): asset is SmartCityAsset => asset !== null);
  const hotspots = hotspotRows.map(fromHotspotRow).filter((hotspot): hotspot is SmartCityHotspot => hotspot !== null);
  if (events.length === 0 && assets.length === 0 && hotspots.length === 0 && sourceState.health.length === 0) return null;
  return {
    generatedAt: new Date().toISOString(),
    region: "Thailand spatial read model",
    viewport: BANGKOK_VIEWPORT,
    sources: sourceState.sources,
    sourceHealth: sourceState.health,
    events,
    assets,
    hotspots,
    timeline: buildTimeline(events),
  };
}

async function readSupabaseOntology(filters: { type?: string | null; bbox?: Bbox | null; updatedSince?: string | null } = {}): Promise<OntologyReadModel | null> {
  const sourceState = await readSupabaseSourcesAndHealth();
  if (!sourceState) return null;
  const params = new URLSearchParams({
    select: "*",
    is_stale: "eq.false",
    order: "updated_at.desc",
    limit: String(layerMaxFeatures()),
  });
  if (filters.type) params.set("object_type", `eq.${filters.type}`);
  if (filters.updatedSince) params.set("updated_at", `gte.${filters.updatedSince}`);
  const [objectRows, linkRows] = await Promise.all([
    readRows<ObjectRow>("smart_city_objects", params),
    readRows<LinkRow>("smart_city_links", new URLSearchParams({ select: "*", limit: "5000" })),
  ]);
  const objects = objectRows
    .map(fromObjectRow)
    .filter((object): object is SmartCityOntologyObject => object !== null)
    .filter((object) => pointInBbox(object.geometry, filters.bbox));
  if (objects.length === 0) return null;
  const objectIds = new Set(objects.map((object) => object.id));
  const links = linkRows.map(fromLinkRow).filter((link) => objectIds.has(link.fromObjectId) || objectIds.has(link.toObjectId));
  return {
    generatedAt: new Date().toISOString(),
    viewport: BANGKOK_VIEWPORT,
    objects,
    links,
    sources: sourceState.sources,
    sourceHealth: sourceState.health,
  };
}

async function readSupabaseInsights(filters: InsightFilter = {}): Promise<{ generatedAt: string; insights: SmartCityInsight[] } | null> {
  if (filters.domain && filters.domain !== "transport") return { generatedAt: new Date().toISOString(), insights: [] };
  if (!spatialReadModelConfigured()) return null;
  const params = new URLSearchParams({
    select: "*",
    domain: "eq.transport",
    is_stale: "eq.false",
    order: "risk_before.desc,confidence.desc",
    limit: String(Math.max(0, Math.min(200, filters.limit ?? 50))),
  });
  const rows = await readRows<InsightRow>("smart_city_insights", params);
  if (rows.length === 0) return null;
  let insights = rows.map(fromInsightRow);
  if (filters.bbox) {
    const ontology = await readSupabaseOntology({ bbox: filters.bbox });
    const objectIds = new Set(ontology?.objects.map((object) => object.id) ?? []);
    insights = insights.filter((insight) => objectIds.has(insight.objectId));
  }
  return {
    generatedAt: insights[0]?.generatedAt ?? new Date().toISOString(),
    insights,
  };
}

export async function getReadModelOverview(): Promise<OpsOverview & { readModel?: "supabase" | "request_time_adapter" }> {
  try {
    const supabaseOverview = await readSupabaseOverview();
    if (supabaseOverview) return { ...supabaseOverview, readModel: "supabase" };
  } catch {
    // Fall through to request-time adapter for local or not-yet-migrated environments.
  }
  const overview = await getThailandTransportOverview();
  return { ...overview, readModel: "request_time_adapter" };
}

export async function getReadModelOntology(filters: {
  type?: string | null;
  bbox?: Bbox | null;
  updatedSince?: string | null;
}): Promise<OntologyReadModel & { readModel?: "supabase" | "request_time_adapter" }> {
  try {
    const supabaseModel = await readSupabaseOntology(filters);
    if (supabaseModel) return { ...supabaseModel, readModel: "supabase" };
  } catch {
    // Fall through to adapter build.
  }
  const [overview, railOverview] = await Promise.all([getThailandTransportOverview(), getRailSafetyOverview()]);
  const model = buildOntologyReadModel({ overview, railOverview });
  return { ...filterOntologyReadModel(model, filters), readModel: "request_time_adapter" };
}

export async function getReadModelInsights(filters: InsightFilter): Promise<{
  generatedAt: string;
  insights: SmartCityInsight[];
  readModel: "supabase" | "request_time_adapter";
}> {
  try {
    const supabaseInsights = await readSupabaseInsights(filters);
    if (supabaseInsights) return { ...supabaseInsights, readModel: "supabase" };
  } catch {
    // Fall through to adapter build.
  }
  const [overview, railOverview] = await Promise.all([getThailandTransportOverview(), getRailSafetyOverview()]);
  const model = buildOntologyReadModel({ overview, railOverview });
  const insights = buildActionableInsights(model, filters);
  return { generatedAt: model.generatedAt, insights, readModel: "request_time_adapter" };
}

function layerForEvent(event: SmartCityEvent): OpsLayerKey {
  if (event.sourceId.toLowerCase().includes("osiris")) return "osiris";
  if (event.eventType.startsWith("rail_")) return "rail";
  if (event.eventType === "congestion") return "congestion";
  if (event.eventType === "weather_risk") return "weather";
  if (event.eventType === "roadwork") return "roadworks";
  return "incidents";
}

function layerForAsset(asset: SmartCityAsset): OpsLayerKey {
  if (asset.sourceId.toLowerCase().includes("osiris")) return "osiris";
  if (asset.assetType === "camera") return "cameras";
  if (asset.assetType.startsWith("rail_")) return "rail";
  return "assets";
}

function worstStatus(items: SourceHealth[]): SourceStatus {
  if (items.some((item) => item.status === "offline")) return "offline";
  if (items.some((item) => item.status === "needs_config")) return "needs_config";
  if (items.some((item) => item.status === "stale")) return "stale";
  if (items.some((item) => item.status === "degraded")) return "degraded";
  return "ok";
}

function mostOperationalDataClass(items: SourceHealth[]): SourceDataClass {
  const rank: SourceDataClass[] = ["live", "near_real_time", "official_baseline", "historical", "stale", "needs_config"];
  const present = new Set(items.map((item) => item.dataClass ?? "needs_config"));
  return rank.find((item) => present.has(item)) ?? "needs_config";
}

function registryItem(params: {
  id: OpsLayerKey;
  label: string;
  count: number;
  sourceIds: string[];
  healthById: Map<string, SourceHealth>;
  enabledByDefault?: boolean;
}): OpsLayerRegistryItem {
  const health = params.sourceIds.map((sourceId) => params.healthById.get(sourceId)).filter(Boolean) as SourceHealth[];
  const dataClass = health.length ? mostOperationalDataClass(health) : "needs_config";
  return {
    id: params.id,
    label: params.label,
    enabledByDefault: params.enabledByDefault ?? ["incidents", "hotspots", "cameras", "weather", "rail"].includes(params.id),
    count: params.count,
    dataClass,
    status: health.length ? worstStatus(health) : "needs_config",
    freshnessSeconds: health.map((item) => item.freshnessSeconds).filter((item): item is number => typeof item === "number").sort((a, b) => a - b)[0] ?? null,
    lastRefreshAt:
      health
        .map((item) => item.lastSuccessAt ?? item.lastAttemptAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
    sourceIds: params.sourceIds,
    geometryTypes: ["Point"],
    provenance: params.sourceIds.map((sourceId) => `source:${sourceId}`),
    render: LAYER_RENDER[params.id],
  };
}

const LAYER_LABELS: Record<OpsLayerKey, string> = {
  incidents: "Incidents",
  hotspots: "Hotspots",
  cameras: "CCTV",
  congestion: "Congestion",
  weather: "Weather",
  roadworks: "Road works",
  osiris: "Osiris context",
  rail: "Rail",
  assets: "Assets",
};

function parseCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type LayerCursor = {
  rank: number;
  updatedAt: string;
  id: string;
  filtersHash: string;
};

function hashLayerFilters(filters: { bbox: Bbox; types?: OpsLayerKey[]; since?: string | null; zoom?: number | null }): string {
  return createHash("sha256")
    .update(
      stableJson({
        bbox: filters.bbox,
        since: filters.since ?? null,
        types: [...(filters.types ?? [])].sort(),
        zoom: filters.zoom ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export function encodeLayerCursor(cursor: LayerCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeLayerCursor(value: string | null | undefined): LayerCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<LayerCursor>;
    if (
      typeof parsed.rank === "number" &&
      typeof parsed.updatedAt === "string" &&
      typeof parsed.id === "string" &&
      typeof parsed.filtersHash === "string"
    ) {
      return { rank: parsed.rank, updatedAt: parsed.updatedAt, id: parsed.id, filtersHash: parsed.filtersHash };
    }
  } catch {
    return null;
  }
  return null;
}

function fromLayerRegistryRow(row: LayerRegistryRow): OpsLayerRegistryItem {
  const activeCount = parseCount(row.active_count);
  const staleCount = parseCount(row.stale_count);
  const totalCount = parseCount(row.total_count);
  return {
    id: row.layer_id,
    label: LAYER_LABELS[row.layer_id] ?? row.layer_id,
    enabledByDefault: ["incidents", "hotspots", "cameras", "weather", "rail"].includes(row.layer_id),
    count: activeCount,
    activeCount,
    staleCount,
    totalCount,
    dataClass: row.data_class ?? "needs_config",
    status: row.status ?? "needs_config",
    freshnessSeconds: row.freshness_seconds == null ? null : parseCount(row.freshness_seconds),
    lastRefreshAt: row.last_refresh_at,
    sourceIds: Array.isArray(row.source_ids) ? row.source_ids : [],
    geometryTypes: (row.geometry_types ?? ["Point"])
      .map((item) => (item === "ST_Point" ? "Point" : item))
      .filter((item): item is "Point" | "LineString" | "Polygon" => item === "Point" || item === "LineString" || item === "Polygon"),
    provenance: (row.source_ids ?? []).map((sourceId) => `source:${sourceId}`),
    render: LAYER_RENDER[row.layer_id],
  };
}

async function readLastIngestRun(): Promise<OpsLayerRegistryResponse["lastIngestRun"]> {
  if (!spatialReadModelConfigured()) return null;
  const rows = await readRows<IngestRunRow>(
    "smart_city_ingest_runs",
    new URLSearchParams({ select: "id,run_type,status,started_at,finished_at,counts", order: "started_at.desc", limit: "1" }),
  ).catch(() => []);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    runType: row.run_type,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts: row.counts ?? {},
  };
}

export async function ensureFreshSpatialCoreReadModel(): Promise<{
  checkedAt: string;
  refreshed: boolean;
  reason: "unconfigured" | "fresh" | "stale" | "running" | "refresh_failed";
  lastIngestFinishedAt: string | null;
  maxAgeSeconds: number;
  ingestRunId?: string;
  error?: string;
}> {
  const checkedAt = new Date().toISOString();
  const maxAgeSeconds = autoRefreshSeconds();
  if (!spatialReadModelConfigured()) {
    return { checkedAt, refreshed: false, reason: "unconfigured", lastIngestFinishedAt: null, maxAgeSeconds };
  }

  const last = await readLastIngestRun();
  if (last?.status === "running") {
    return {
      checkedAt,
      refreshed: false,
      reason: "running",
      lastIngestFinishedAt: last.finishedAt,
      maxAgeSeconds,
      ingestRunId: last.id,
    };
  }
  const finishedAt = last?.finishedAt ?? null;
  const ageSeconds = finishedAt ? Math.max(0, Math.round((Date.now() - new Date(finishedAt).getTime()) / 1000)) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(ageSeconds) && ageSeconds <= maxAgeSeconds) {
    return {
      checkedAt,
      refreshed: false,
      reason: "fresh",
      lastIngestFinishedAt: finishedAt,
      maxAgeSeconds,
      ingestRunId: last?.id,
    };
  }

  try {
    const result = await refreshSpatialCoreReadModel();
    return {
      checkedAt,
      refreshed: true,
      reason: "stale",
      lastIngestFinishedAt: finishedAt,
      maxAgeSeconds,
      ingestRunId: result.ingestRunId,
    };
  } catch (error) {
    return {
      checkedAt,
      refreshed: false,
      reason: "refresh_failed",
      lastIngestFinishedAt: finishedAt,
      maxAgeSeconds,
      ingestRunId: last?.id,
      error: error instanceof Error ? error.message.slice(0, 500) : "Spatial refresh failed",
    };
  }
}

async function readPostgisLayerRegistry(): Promise<OpsLayerRegistryResponse | null> {
  if (!spatialReadModelConfigured()) return null;
  const [sourceState, registryRows, lastIngestRun] = await Promise.all([
    readSupabaseSourcesAndHealth(),
    readRows<LayerRegistryRow>("smart_city_layer_registry_v", new URLSearchParams({ select: "*", order: "layer_id.asc" })),
    readLastIngestRun(),
  ]);
  if (!sourceState) return null;
  const returned = new Map(registryRows.map((row) => [row.layer_id, fromLayerRegistryRow(row)]));
  const layers: OpsLayerRegistryItem[] = (Object.keys(LAYER_RENDER) as OpsLayerKey[]).map((id): OpsLayerRegistryItem => {
    const item = returned.get(id);
    if (item) return item;
    return {
      id,
      label: LAYER_LABELS[id],
      enabledByDefault: ["incidents", "hotspots", "cameras", "weather", "rail"].includes(id),
      count: 0,
      activeCount: 0,
      staleCount: 0,
      totalCount: 0,
      dataClass: "needs_config" as SourceDataClass,
      status: "needs_config" as SourceStatus,
      freshnessSeconds: null,
      lastRefreshAt: null,
      sourceIds: [],
      geometryTypes: ["Point"],
      provenance: [],
      render: LAYER_RENDER[id],
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    region: "Thailand spatial read model",
    readModel: "supabase",
    sourceHealth: sourceState.health,
    layers,
    lastIngestRun,
  };
}

export async function getLayerRegistry(): Promise<OpsLayerRegistryResponse> {
  try {
    const registry = await readPostgisLayerRegistry();
    if (registry) return registry;
  } catch (error) {
    if (!shouldUseAdapterFallback()) throw error;
  }
  const overview = await getReadModelOverview();
  const railOverview = overview.readModel === "supabase" ? EMPTY_RAIL_OVERVIEW : await getRailSafetyOverview();
  const health = uniqueBySourceId([...overview.sourceHealth, ...railOverview.sourceHealth]);
  const healthById = new Map(health.map((item) => [item.sourceId, item]));
  const counts: Record<OpsLayerKey, { count: number; sourceIds: Set<string> }> = {
    incidents: { count: 0, sourceIds: new Set() },
    hotspots: { count: 0, sourceIds: new Set() },
    cameras: { count: 0, sourceIds: new Set() },
    congestion: { count: 0, sourceIds: new Set() },
    weather: { count: 0, sourceIds: new Set() },
    roadworks: { count: 0, sourceIds: new Set() },
    osiris: { count: 0, sourceIds: new Set() },
    rail: { count: 0, sourceIds: new Set() },
    assets: { count: 0, sourceIds: new Set() },
  };
  for (const event of [...overview.events, ...railOverview.events]) {
    const layer = layerForEvent(event);
    counts[layer].count += 1;
    counts[layer].sourceIds.add(event.sourceId);
  }
  for (const hotspot of [...overview.hotspots, ...railOverview.cases]) {
    counts.hotspots.count += 1;
    const source = hotspot.evidence.find((item) => /source/i.test(item.label))?.value;
    if (source) counts.hotspots.sourceIds.add(source);
  }
  for (const asset of [...overview.assets, ...railOverview.crossings]) {
    const layer = layerForAsset(asset);
    counts[layer].count += 1;
    counts[layer].sourceIds.add(asset.sourceId);
  }

  return {
    generatedAt: new Date().toISOString(),
    region: overview.region,
    readModel: overview.readModel ?? "request_time_adapter",
    sourceHealth: health,
    layers: (Object.keys(counts) as OpsLayerKey[]).map((id) =>
      registryItem({ id, label: LAYER_LABELS[id], count: counts[id].count, sourceIds: [...counts[id].sourceIds], healthById }),
    ),
  };
}

function featureFromPoint(
  point: GeoPoint,
  properties: LayerFeatureProperties,
): Feature<Point, LayerFeatureProperties> {
  return {
    type: "Feature",
    geometry: point,
    properties,
  };
}

function featureFromRpcRow(row: LayerFeatureRpcRow): Feature<Point, LayerFeatureProperties> | null {
  if (!isFinitePoint(row.geometry)) return null;
  return featureFromPoint(row.geometry, {
    id: row.id,
    layerId: row.layer_id,
    objectType: row.object_type,
    sourceId: row.source_id ?? "unknown-source",
    sourceIds: Array.isArray(row.source_ids) ? row.source_ids : [],
    severity: row.severity ?? undefined,
    title: row.title,
    dataClass: row.data_class ?? "needs_config",
    status: row.status ?? "needs_config",
    updatedAt: row.updated_at ?? row.observed_at,
    sourceUrl: row.source_url ?? undefined,
    provenance: Array.isArray(row.provenance) ? row.provenance : [],
    isStale: Boolean(row.is_stale),
    staleReason: row.stale_reason,
    lastSeenAt: row.last_seen_at,
    freshnessSeconds: row.freshness_seconds == null ? null : parseCount(row.freshness_seconds),
    eligibilityReason: row.eligibility_reason,
  });
}

async function getPostgisLayerFeatures(filters: {
  bbox: Bbox;
  zoom?: number | null;
  types?: OpsLayerKey[];
  since?: string | null;
  limit?: number | null;
  cursor?: LayerCursor | null;
}): Promise<
  FeatureCollection<Point, LayerFeatureProperties> & {
    generatedAt: string;
    readModel: "supabase";
    readPath: "postgis_rpc";
    filters: Record<string, unknown>;
    returnedCount: number;
    truncated: boolean;
    staleExcludedCount: number;
    freshnessExcludedCount: number;
    page: {
      limit: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
  }
> {
  const limit = Math.max(1, Math.min(Math.round(filters.limit ?? layerMaxFeatures()), layerMaxFeatures()));
  const pLayerIds = filters.types?.length ? filters.types : null;
  const filtersHash = hashLayerFilters(filters);
  if (filters.cursor && filters.cursor.filtersHash !== filtersHash) {
    throw new Error("Layer cursor does not match the current bbox/types/since/zoom filters.");
  }
  const [rows, statsRows] = await Promise.all([
    rpcRows<LayerFeaturePageRpcRow>("smart_city_get_layer_features_page", {
      p_west: filters.bbox.west,
      p_south: filters.bbox.south,
      p_east: filters.bbox.east,
      p_north: filters.bbox.north,
      p_zoom: filters.zoom ?? null,
      p_layer_ids: pLayerIds,
      p_since: filters.since ?? null,
      p_cursor_rank: filters.cursor?.rank ?? null,
      p_cursor_updated_at: filters.cursor?.updatedAt ?? null,
      p_cursor_id: filters.cursor?.id ?? null,
      p_include_stale: false,
      p_limit: limit,
    }),
    rpcRows<LayerFeatureStatsRow>("smart_city_get_layer_feature_stats", {
      p_west: filters.bbox.west,
      p_south: filters.bbox.south,
      p_east: filters.bbox.east,
      p_north: filters.bbox.north,
      p_layer_ids: pLayerIds,
      p_since: filters.since ?? null,
    }).catch(() => []),
  ]);
  const truncated = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const features = rows
    .slice(0, limit)
    .map(featureFromRpcRow)
    .filter((feature): feature is Feature<Point, LayerFeatureProperties> => feature !== null);
  const stats = statsRows[0];
  const lastRow = pageRows.at(-1);
  return {
    type: "FeatureCollection",
    generatedAt: new Date().toISOString(),
    readModel: "supabase",
    readPath: "postgis_rpc",
    filters: {
      bbox: filters.bbox,
      zoom: filters.zoom ?? null,
      types: filters.types ?? null,
      since: filters.since ?? null,
    },
    returnedCount: features.length,
    truncated,
    staleExcludedCount: parseCount(stats?.stale_excluded_count),
    freshnessExcludedCount: parseCount(stats?.freshness_excluded_count),
    page: {
      limit,
      hasMore: truncated,
      nextCursor:
        truncated && lastRow
          ? encodeLayerCursor({
              rank: parseCount(lastRow.cursor_rank),
              updatedAt: lastRow.cursor_updated_at,
              id: lastRow.cursor_id,
              filtersHash,
            })
          : null,
    },
    features,
  };
}

export async function getLayerFeatures(filters: {
  bbox?: Bbox | null;
  zoom?: number | null;
  types?: OpsLayerKey[];
  since?: string | null;
  limit?: number | null;
  cursor?: LayerCursor | null;
}): Promise<FeatureCollection<Point, LayerFeatureProperties> & { generatedAt?: string; readModel?: string; truncated?: boolean; page?: { limit: number; hasMore: boolean; nextCursor: string | null } }> {
  if (spatialReadModelConfigured()) {
    if (filters.bbox) {
      try {
        return await getPostgisLayerFeatures({ ...filters, bbox: filters.bbox });
      } catch (error) {
        if (!shouldUseAdapterFallback()) throw error;
      }
    } else if (!shouldUseAdapterFallback()) {
      throw new Error("bbox is required for production PostGIS layer reads.");
    }
  }
  const overview = await getReadModelOverview();
  const railOverview = overview.readModel === "supabase" ? EMPTY_RAIL_OVERVIEW : await getRailSafetyOverview();
  const sourceHealth = uniqueBySourceId([...overview.sourceHealth, ...railOverview.sourceHealth]);
  const healthById = new Map(sourceHealth.map((item) => [item.sourceId, item]));
  const types = new Set<OpsLayerKey>(filters.types?.length ? filters.types : ["incidents", "hotspots", "cameras", "congestion", "weather", "roadworks", "osiris", "rail", "assets"]);
  const sinceTime = filters.since ? new Date(filters.since).getTime() : null;
  const features: Array<Feature<Point, LayerFeatureProperties>> = [];

  const includeTime = (value: string | null | undefined) => !sinceTime || new Date(value ?? 0).getTime() >= sinceTime;
  const pushFeature = (point: GeoPoint, props: LayerFeatureProperties) => {
    if (!pointInBbox(point, filters.bbox)) return;
    if (!types.has(props.layerId)) return;
    if (!includeTime(props.updatedAt)) return;
    features.push(featureFromPoint(point, props));
  };

  for (const event of [...overview.events, ...railOverview.events]) {
    const layerId = layerForEvent(event);
    const health = healthById.get(event.sourceId);
    pushFeature(event.geometry, {
      id: event.id,
      layerId,
      objectType: event.eventType,
      sourceId: event.sourceId,
      severity: event.severity,
      title: event.title,
      dataClass: dataClassFor(event.sourceId, healthById),
      status: health?.status ?? "needs_config",
      updatedAt: event.observedAt,
      sourceUrl: event.sourceUrl,
      provenance: [`source:${event.sourceId}`, `url:${event.sourceUrl}`],
    });
  }

  for (const asset of [...overview.assets, ...railOverview.crossings]) {
    const layerId = layerForAsset(asset);
    const health = healthById.get(asset.sourceId);
    pushFeature(asset.geometry, {
      id: asset.id,
      layerId,
      objectType: asset.assetType,
      sourceId: asset.sourceId,
      title: asset.name,
      dataClass: dataClassFor(asset.sourceId, healthById),
      status: health?.status ?? "needs_config",
      updatedAt: String(asset.attributes.updatedAt ?? null),
      sourceUrl: String(asset.attributes.sourceUrl ?? ""),
      provenance: [`source:${asset.sourceId}`],
    });
  }

  for (const hotspot of overview.hotspots) {
    const sourceId = hotspot.evidence.find((item) => /source/i.test(item.label))?.value ?? "derived-hotspot";
    const health = healthById.get(sourceId);
    pushFeature(hotspot.geometry, {
      id: hotspot.id,
      layerId: "hotspots",
      objectType: "hotspot",
      sourceId,
      severity: hotspot.severity,
      title: hotspot.name,
      dataClass: dataClassFor(sourceId, healthById),
      status: health?.status ?? "needs_config",
      updatedAt: hotspot.updatedAt,
      provenance: [`source:${sourceId}`, "derived:hotspot"],
    });
  }

  const maxFeatures = layerMaxFeatures();
  const limit = Math.max(1, Math.min(Math.round(filters.limit ?? maxFeatures), maxFeatures));
  return {
    type: "FeatureCollection",
    generatedAt: new Date().toISOString(),
    readModel: overview.readModel ?? "request_time_adapter",
    truncated: features.length > limit,
    page: {
      limit,
      hasMore: features.length > limit,
      nextCursor: null,
    },
    features: features.slice(0, limit),
  };
}

export async function getLayerMvtTile(filters: {
  z: number;
  x: number;
  y: number;
  types?: OpsLayerKey[];
  since?: string | null;
}): Promise<{ tile: Buffer; featureCount: number; truncated: boolean; generatedAt: string; readModel: "supabase" }> {
  if (!spatialReadModelConfigured()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for MVT layer reads.");
  }
  const rows = await rpcRows<LayerMvtRpcRow>("smart_city_get_layer_mvt", {
    p_z: filters.z,
    p_x: filters.x,
    p_y: filters.y,
    p_layer_ids: filters.types?.length ? filters.types : null,
    p_since: filters.since ?? null,
    p_include_stale: false,
    p_limit: tileMaxFeatures(),
  });
  const row = rows[0];
  if (!row) {
    return { tile: Buffer.alloc(0), featureCount: 0, truncated: false, generatedAt: new Date().toISOString(), readModel: "supabase" };
  }
  return {
    tile: row.tile_base64 ? Buffer.from(row.tile_base64, "base64") : Buffer.alloc(0),
    featureCount: parseCount(row.feature_count),
    truncated: Boolean(row.truncated),
    generatedAt: row.generated_at,
    readModel: "supabase",
  };
}

function fromSourceSlaRow(row: SourceSlaRow): OpsSourceSla {
  return {
    sourceId: row.source_id,
    name: row.name,
    provider: row.provider,
    category: row.category,
    region: row.region,
    status: row.status,
    dataClass: row.data_class ?? "needs_config",
    slaState: row.sla_state,
    breachReasons: Array.isArray(row.breach_reasons) ? row.breach_reasons : [],
    secondsUntilBreach: row.seconds_until_breach == null ? null : parseCount(row.seconds_until_breach),
    successRate24h: row.success_rate_24h == null ? null : Number(row.success_rate_24h),
    p95LatencyMs24h: row.p95_latency_ms_24h == null ? null : parseCount(row.p95_latency_ms_24h),
    failures24h: parseCount(row.failures_24h),
    attempts24h: parseCount(row.attempts_24h),
    recordCount: parseCount(row.record_count),
    freshnessSeconds: row.freshness_seconds == null ? null : parseCount(row.freshness_seconds),
    slaFreshnessSeconds: parseCount(row.sla_freshness_seconds),
    slaLatencyMs: parseCount(row.sla_latency_ms),
    lastSuccessAt: row.last_success_at,
    lastAttemptAt: row.last_attempt_at,
    message: row.message,
  };
}

export async function getSourceSla(): Promise<OpsSourceSlaResponse> {
  if (!spatialReadModelConfigured()) {
    return {
      generatedAt: new Date().toISOString(),
      readModel: "unconfigured",
      summary: { total: 0, ok: 0, warn: 0, breach: 0, lastIngestStatus: null, lastIngestFinishedAt: null },
      sources: [],
    };
  }
  const [rows, lastIngestRun] = await Promise.all([
    readRows<SourceSlaRow>("smart_city_source_sla_v", new URLSearchParams({ select: "*", order: "sla_state.asc,source_id.asc", limit: "300" })),
    readLastIngestRun(),
  ]);
  const sources = rows.map(fromSourceSlaRow);
  return {
    generatedAt: new Date().toISOString(),
    readModel: "supabase",
    summary: {
      total: sources.length,
      ok: sources.filter((source) => source.slaState === "ok").length,
      warn: sources.filter((source) => source.slaState === "warn").length,
      breach: sources.filter((source) => source.slaState === "breach").length,
      lastIngestStatus: lastIngestRun?.status ?? null,
      lastIngestFinishedAt: lastIngestRun?.finishedAt ?? null,
    },
    sources,
  };
}

export function buildResearchGateWorkflow(response: ResearchGateResponse, insight: SmartCityInsight): OpsWorkflowTraceStep[] {
  const now = response.generatedAt;
  const hasAction = response.recommendedActions.length > 0;
  return [
    {
      id: "object",
      label: "Object",
      status: "complete",
      summary: `${insight.objectType.replaceAll("_", " ")} selected with ${response.objectIds.length} source object(s).`,
      createdAt: now,
    },
    {
      id: "research",
      label: "Evidence",
      status: response.evidenceUse.length > 0 ? "complete" : "blocked",
      summary:
        response.evidenceUse.length > 0
          ? `${response.evidenceUse.length} CivilMCP citation use row(s) evaluated.`
          : "No usable CivilMCP citation returned.",
      createdAt: now,
    },
    {
      id: "action",
      label: "Action",
      status: hasAction ? "complete" : "blocked",
      summary: hasAction ? "Evidence-backed local action record is available." : "Action disabled until direct/indirect cited evidence exists.",
      createdAt: now,
    },
    {
      id: "monitor",
      label: "Monitor",
      status: "pending",
      summary: insight.nextVerificationStep,
      createdAt: now,
    },
  ];
}

export function buildResearchGateMapCommands(response: ResearchGateResponse, insight: SmartCityInsight): OpsMapCommand[] {
  const layer: OpsLayerKey =
    insight.objectType === "rail_crossing" || /rail|crossing|รถไฟ/i.test(insight.title)
      ? "rail"
      : insight.objectType === "hotspot"
        ? "hotspots"
        : insight.objectType === "incident"
          ? "incidents"
          : "assets";
  return [
    { type: "toggle_layer", layerId: layer, enabled: true, reason: "Keep the selected object's operational layer visible." },
    {
      type: "select_object",
      objectId: insight.objectId,
      reason: "Bind CivilMCP evidence back to the selected ontology object.",
    },
    {
      type: "open_evidence_panel",
      objectId: insight.objectId,
      evidenceIds: response.evidenceUse.map((item) => item.evidenceId),
      reason: "Show citation-to-action mapping before any action record.",
    },
  ];
}

export function buildEvidenceProvenance(response: ResearchGateResponse): OpsEvidenceProvenance[] {
  return response.evidenceUse.map((item) => ({
    evidenceId: item.evidenceId,
    source: item.source,
    citation: item.citation,
    strength: item.evidenceStrength,
    objectIds: response.objectIds,
    actionImplication: item.actionImplication,
  }));
}

function researchRunIdFor(response: ResearchGateResponse): string {
  return `research:${response.insightId ?? "no-insight"}:${response.generatedAt}`.replace(/[^a-zA-Z0-9:_-]+/g, "-");
}

function proposalIdFor(proposal: ResearchGateProposal): string {
  return (proposal.proposalId ?? proposal.id).replace(/[^a-zA-Z0-9:_-]+/g, "-");
}

function evidenceStrengthMap(response: ResearchGateResponse): Record<string, ResearchGateEvidenceStrength> {
  return Object.fromEntries(response.evidenceUse.map((item) => [item.evidenceId, item.evidenceStrength]));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizedResearchProposalHash(proposal: ResearchGateProposal): string {
  return createHash("sha256")
    .update(
      stableJson({
        actionType: proposal.actionType,
        evidenceIds: proposal.evidenceIds,
        expectedRiskAfter: proposal.expectedRiskAfter,
        riskBefore: proposal.riskBefore,
        sourceObjectIds: proposal.sourceObjectIds ?? [],
        title: proposal.title,
      }),
    )
    .digest("hex");
}

export function bindResearchGateResponseForPersistence(response: ResearchGateResponse): ResearchGateResponse {
  const runId = response.researchRunId ?? researchRunIdFor(response);
  const strengths = evidenceStrengthMap(response);
  const recordableEvidence = new Set(
    response.evidenceUse.filter((item) => item.evidenceStrength !== "context_only").map((item) => item.evidenceId),
  );
  const recommendedActions = response.recommendedActions
    .map<ResearchGateProposal>((proposal) => {
      const proposalId = proposalIdFor(proposal);
      const evidenceIds = [...new Set(proposal.evidenceIds.filter((id) => recordableEvidence.has(id)))];
      const enriched: ResearchGateProposal = {
        ...proposal,
        id: proposalId,
        proposalId,
        researchRunId: runId,
        insightId: response.insightId,
        sourceObjectIds: response.objectIds,
        evidenceIds,
        evidenceStrengths: Object.fromEntries(evidenceIds.map((id) => [id, strengths[id] ?? "context_only"])),
        requiredAcknowledgements: ["read_only_civilmcp_evidence", "local_action_record_only", "expected_delta_not_measured"],
        recordable: evidenceIds.length > 0,
      };
      return {
        ...enriched,
        normalizedHash: normalizedResearchProposalHash(enriched),
      };
    })
    .filter((proposal) => proposal.recordable);

  return {
    ...response,
    researchRunId: runId,
    recommendedActions,
  };
}

function toResearchProposalRow(response: ResearchGateResponse, proposal: ResearchGateProposal): ResearchProposalRow {
  const proposalId = proposalIdFor(proposal);
  const runId = response.researchRunId ?? researchRunIdFor(response);
  return {
    id: `${runId}:${proposalId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-"),
    run_id: runId,
    proposal_id: proposalId,
    insight_id: response.insightId ?? null,
    action_type: proposal.actionType,
    title: proposal.title,
    rationale: proposal.rationale,
    confidence: Math.max(0, Math.min(1, proposal.confidence)),
    risk_before: Math.max(0, Math.min(100, proposal.riskBefore)),
    expected_risk_after: Math.max(0, Math.min(100, proposal.expectedRiskAfter)),
    delta: proposal.expectedRiskAfter - proposal.riskBefore,
    evidence_ids: proposal.evidenceIds,
    source_object_ids: proposal.sourceObjectIds ?? response.objectIds,
    evidence_strengths: proposal.evidenceStrengths ?? evidenceStrengthMap(response),
    required_acknowledgements: proposal.requiredAcknowledgements ?? [],
    normalized_hash: proposal.normalizedHash ?? normalizedResearchProposalHash(proposal),
    caveat: proposal.caveat,
    created_at: response.generatedAt,
  };
}

export async function persistResearchGateRun(response: ResearchGateResponse): Promise<{ researchRunId: string; persisted: boolean }> {
  const prepared = bindResearchGateResponseForPersistence(response);
  const runId = prepared.researchRunId ?? researchRunIdFor(prepared);
  if (!spatialReadModelConfigured()) return { researchRunId: runId, persisted: false };
  await upsertRows("smart_city_research_runs", [
    {
      id: runId,
      mode: prepared.mode,
      insight_id: prepared.insightId ?? null,
      object_ids: prepared.objectIds,
      workflow_trace: prepared.workflowTrace ?? [],
      map_commands: prepared.mapCommands ?? [],
      limitations: prepared.limitations,
      generated_at: prepared.generatedAt,
    },
  ]);
  await upsertRows(
    "smart_city_research_evidence",
    prepared.evidenceUse.map((item) => ({
      id: `${runId}:${item.evidenceId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-"),
      run_id: runId,
      evidence_id: item.evidenceId,
      citation: item.citation,
      source: item.source,
      section_title: item.sectionTitle,
      evidence_strength: item.evidenceStrength,
      matched_terms: item.matchedTerms,
      object_ids: prepared.objectIds,
      action_implication: item.actionImplication,
      operator_check: item.operatorCheck,
    })),
  );
  await upsertRows("smart_city_research_proposals", prepared.recommendedActions.map((proposal) => toResearchProposalRow(prepared, proposal)));
  return { researchRunId: runId, persisted: true };
}

export type PersistedResearchProposal = {
  proposal: ResearchProposalRow;
  evidence: ResearchEvidenceRow[];
  run: {
    id: string;
    mode: ResearchGateResponse["mode"];
    insightId?: string | null;
    objectIds: string[];
    generatedAt: string;
  };
};

export async function getPersistedResearchProposal(params: {
  researchRunId: string;
  proposalId: string;
}): Promise<PersistedResearchProposal | null> {
  if (!spatialReadModelConfigured()) return null;
  const [proposalRows, runRows, evidenceRows] = await Promise.all([
    readRows<ResearchProposalRow>(
      "smart_city_research_proposals",
      new URLSearchParams({
        select: "*",
        run_id: `eq.${params.researchRunId}`,
        proposal_id: `eq.${params.proposalId}`,
        limit: "1",
      }),
    ),
    readRows<{
      id: string;
      mode: ResearchGateResponse["mode"];
      insight_id: string | null;
      object_ids: string[];
      generated_at: string;
    }>(
      "smart_city_research_runs",
      new URLSearchParams({ select: "id,mode,insight_id,object_ids,generated_at", id: `eq.${params.researchRunId}`, limit: "1" }),
    ),
    readRows<ResearchEvidenceRow>(
      "smart_city_research_evidence",
      new URLSearchParams({ select: "*", run_id: `eq.${params.researchRunId}`, limit: "50" }),
    ),
  ]);
  const proposal = proposalRows[0];
  const run = runRows[0];
  if (!proposal || !run) return null;
  return {
    proposal,
    evidence: evidenceRows,
    run: {
      id: run.id,
      mode: run.mode,
      insightId: run.insight_id,
      objectIds: Array.isArray(run.object_ids) ? run.object_ids : [],
      generatedAt: run.generated_at,
    },
  };
}

export async function readActionSourceObjects(objectIds: string[]): Promise<Array<{ id: string; is_stale?: boolean; stale_reason?: string | null }>> {
  if (!spatialReadModelConfigured() || objectIds.length === 0) return [];
  const escaped = objectIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
  return readRows<{ id: string; is_stale?: boolean; stale_reason?: string | null }>(
    "smart_city_objects",
    new URLSearchParams({ select: "id,is_stale,stale_reason", id: `in.(${escaped})`, limit: String(objectIds.length) }),
  );
}
