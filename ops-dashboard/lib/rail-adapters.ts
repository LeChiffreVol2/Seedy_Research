import { loadOpsEnv } from "./env";
import type {
  RailOverview,
  RailCaseEvidence,
  RailSafetyCase,
  RailSimulationDelta,
  Severity,
  SmartCityAsset,
  SmartCityEvent,
  SourceDataClass,
  SourceHealth,
  SourceStatus,
} from "./types";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

export type RawRailSignal = {
  id?: unknown;
  lat?: unknown;
  latitude?: unknown;
  lng?: unknown;
  lon?: unknown;
  longitude?: unknown;
  coords?: unknown;
  title?: unknown;
  name?: unknown;
  headline?: unknown;
  description?: unknown;
  html?: unknown;
  severity?: unknown;
  observed_at?: unknown;
  published?: unknown;
  timestamp?: unknown;
  source_url?: unknown;
  url?: unknown;
  link?: unknown;
  source?: unknown;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CSV_TIMEOUT_MS = 25000;
const DEFAULT_DATASTORE_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_TTL_MS = 60_000;

const globalForRailOverview = globalThis as unknown as {
  railSafetyOverviewCache?: {
    expiresAt: number;
    value?: RailOverview;
    refreshing?: Promise<RailOverview>;
  };
};

function readModelCacheTtlMs(): number {
  const parsed = Number(process.env.SMART_CITY_READ_MODEL_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

const DRT_REPORT_URL = "https://www.drt.go.th/wp-content/uploads/2026/03/Rail-Infrastructure-Report-2025-EN.pdf";
const AP_ASOK_URL = "https://apnews.com/article/thailand-bangkok-train-collision-bus-984593ca4aaab2452ff60abc48092344";
const THAIRATH_ASOK_URL = "https://en.thairath.co.th/news/politic/2933510";
const DRT_CROSSING_CSV_URL =
  "https://drt.gdcatalog.go.th/dataset/8a6b2e9c-bc42-40f4-8f76-cdbb9ddc7ea7/resource/01b609ab-b91c-401a-a776-8b2d0753caf3/download/crossing-v1.csv";
const DRT_CROSSING_ACCIDENTS_CSV_URL =
  "https://drt.gdcatalog.go.th/dataset/77f0fbcc-20f4-47b5-b321-d9435cc58a42/resource/253db54d-2233-4165-b462-ce40f43eba75/download/crossing_accidents.csv";
const DRT_CROSSING_PLAN_CSV_URL =
  "https://drt.gdcatalog.go.th/dataset/f2b8add6-3037-44b9-be2f-5e3421910d15/resource/5d72b31c-cda1-452e-8b16-f829cf08cb0f/download/drt2566_01.csv";
const DRT_CROSSING_RESOURCE_ID = "01b609ab-b91c-401a-a776-8b2d0753caf3";
const DRT_CROSSING_PLAN_RESOURCE_ID = "5d72b31c-cda1-452e-8b16-f829cf08cb0f";
const DRT_DATASTORE_SEARCH_URL = "https://data.go.th/api/3/action/datastore_search";
const SRT_TTS_LATEST_INCIDENT_URL = "https://ttsview.railway.co.th/ttsAPI/incident/data?slug=latest";
const SRT_TTS_INCIDENT_PAGE_URL = "https://ttsview.railway.co.th/v3/incident/";

const nowIso = () => new Date().toISOString();

function isObject(value: JsonValue): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayRows(payload: JsonValue, keys: string[]): JsonObject[] {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (!isObject(payload)) return [];
  const rows: JsonObject[] = [];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) rows.push(...value.filter(isObject));
  }
  return rows;
}

function text(row: RawRailSignal | JsonObject, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return fallback;
}

function parseCsv(textValue: string): JsonObject[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index];
    if (char === '"') {
      if (quoted && textValue[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && textValue[index + 1] === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const [headers = [], ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), (cells[index] ?? "").trim()])) as JsonObject,
  );
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function coordinateValue(value: unknown, axis: "lat" | "lng"): number | null {
  const parsed = numberValue(value);
  if (parsed === null) return null;
  const max = axis === "lat" ? 90 : 180;
  if (Math.abs(parsed) <= max) return parsed;
  const scaled = parsed / 1_000_000;
  return Math.abs(scaled) <= max ? scaled : parsed;
}

function coordinate(row: RawRailSignal, latKeys: string[], lngKeys: string[]): { lat: number | null; lng: number | null } {
  let lat: number | null = null;
  let lng: number | null = null;
  for (const key of latKeys) lat ??= coordinateValue((row as Record<string, unknown>)[key], "lat");
  for (const key of lngKeys) lng ??= coordinateValue((row as Record<string, unknown>)[key], "lng");

  if ((lat === null || lng === null) && Array.isArray(row.coords) && row.coords.length >= 2) {
    const first = coordinateValue(row.coords[0], "lat");
    const second = coordinateValue(row.coords[1], "lng");
    if (first !== null && second !== null) {
      lat = first;
      lng = second;
    }
  }

  return { lat, lng };
}

function isFiniteCoordinate(lat: number | null, lng: number | null): lat is number {
  return (
    lat !== null &&
    lng !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function observedAt(row: RawRailSignal, fallback: string): string {
  for (const key of ["observed_at", "published", "timestamp"]) {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return fallback;
}

function normalizeSeverity(value: unknown): Severity {
  const normalized = String(value ?? "").toLowerCase();
  if (["critical", "severe", "fatal"].some((token) => normalized.includes(token))) return "critical";
  if (["high", "major", "collision", "crash"].some((token) => normalized.includes(token))) return "high";
  if (["medium", "moderate", "delay", "warning"].some((token) => normalized.includes(token))) return "medium";
  return "low";
}

export function isThaiRailSignalText(value: string): boolean {
  const lower = value.toLowerCase();
  const hasRail =
    /รถไฟ|รฟท|ทางตัดรถไฟ|จุดตัดรถไฟ/.test(value) ||
    ["railway", "train", "level crossing", "rail crossing", "state railway", "srt", "crossing gate"].some((token) =>
      lower.includes(token),
    );
  const hasThailand =
    /ไทย|กรุงเทพ|อโศก|ดินแดง|มักกะสัน|ยมราช|รฟท/.test(value) ||
    ["thailand", "thai", "bangkok", "asok", "din daeng", "makkasan", "srt", "state railway"].some((token) =>
      lower.includes(token),
    );
  return hasRail && hasThailand;
}

function sourceHealth(params: {
  sourceId: string;
  name: string;
  provider: string;
  status: SourceStatus;
  attemptedAt: string;
  lastSuccessAt?: string | null;
  latencyMs?: number | null;
  recordCount?: number;
  message: string;
  dataClass?: SourceDataClass;
  refreshPolicy?: string;
  lastModified?: string | null;
  upstreamCadence?: string;
}): SourceHealth {
  const freshnessSeconds = params.lastSuccessAt
    ? Math.max(0, Math.round((Date.now() - new Date(params.lastSuccessAt).getTime()) / 1000))
    : null;
  return {
    sourceId: params.sourceId,
    name: params.name,
    provider: params.provider,
    status: params.status,
    lastAttemptAt: params.attemptedAt,
    lastSuccessAt: params.lastSuccessAt ?? null,
    latencyMs: params.latencyMs ?? null,
    recordCount: params.recordCount ?? 0,
    freshnessSeconds,
    message: params.message,
    dataClass: params.dataClass,
    refreshPolicy: params.refreshPolicy,
    lastModified: params.lastModified ?? null,
    upstreamCadence: params.upstreamCadence,
  };
}

function pointEvent(params: {
  id: string;
  sourceId: string;
  eventType: SmartCityEvent["eventType"];
  lat: number | null;
  lng: number | null;
  title: string;
  description: string;
  severity: Severity;
  confidence: number;
  observedAt: string;
  sourceUrl: string;
  attributes?: Record<string, string | number | boolean | null | undefined>;
}): SmartCityEvent | null {
  if (!isFiniteCoordinate(params.lat, params.lng)) return null;
  const lat = params.lat as number;
  const lng = params.lng as number;
  return {
    id: params.id,
    sourceId: params.sourceId,
    eventType: params.eventType,
    severity: params.severity,
    confidence: Math.max(0, Math.min(1, params.confidence)),
    observedAt: params.observedAt,
    region: "bangkok-srt",
    geometry: { type: "Point", coordinates: [lng, lat] },
    title: params.title,
    description: params.description,
    sourceUrl: params.sourceUrl,
    attributes: Object.fromEntries(Object.entries(params.attributes ?? {}).filter(([, value]) => value !== undefined)) as Record<
      string,
      string | number | boolean | null
    >,
  };
}

function railAsset(params: {
  sourceId: string;
  id: string;
  assetType: SmartCityAsset["assetType"];
  name: string;
  lat: number;
  lng: number;
  attributes: Record<string, string | number | boolean | null>;
}): SmartCityAsset {
  return {
    id: params.id,
    sourceId: params.sourceId,
    assetType: params.assetType,
    name: params.name,
    region: "bangkok-srt",
    geometry: { type: "Point", coordinates: [params.lng, params.lat] },
    attributes: params.attributes,
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function includesThaiToken(haystack: string, value: unknown): boolean {
  const token = String(value ?? "").trim();
  return token.length >= 4 && haystack.includes(token);
}

function eventTypeFromRailText(haystack: string): SmartCityEvent["eventType"] {
  if (/อุบัติเหตุ|ชน|collision|accident|crash/i.test(haystack)) return "rail_crossing_incident";
  if (/ปรับปรุง|ก่อสร้าง|ซ่อม|maintenance|construction/i.test(haystack)) return "rail_news_signal";
  if (/น้ำท่วม|อุทกภัย|ฝน|flood|weather|storm/i.test(haystack)) return "rail_weather_disruption";
  return "rail_news_signal";
}

function severityFromRailText(haystack: string): Severity {
  if (/เสียชีวิต|ตกราง|ชน|suspend|suspended|ปิดเส้นทาง|งดเดินรถ|หยุดเดินรถ|ยกเลิก|accident|collision|derail/i.test(haystack)) return "high";
  if (/ล่าช้า|ปรับเปลี่ยน|shorten|delay|ล่าช้า/i.test(haystack)) return "medium";
  return "low";
}

function matchCrossingsFromText(crossings: SmartCityAsset[], haystack: string): SmartCityAsset[] {
  const scored = crossings
    .map((crossing) => {
      let score = 0;
      if (includesThaiToken(haystack, crossing.name)) score += 5;
      if (includesThaiToken(haystack, crossing.attributes.district)) score += 4;
      if (includesThaiToken(haystack, crossing.attributes.province)) score += 2;
      if (includesThaiToken(haystack, crossing.attributes.roadOwner)) score += 2;
      if (includesThaiToken(haystack, crossing.attributes.corridor)) score += 1;
      return { crossing, score };
    })
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((item) => item.crossing);
}

type SrtTtsIncidentPayload = JsonObject & {
  found?: boolean;
  meta?: JsonObject;
  incidents?: JsonObject[];
  trainGroups?: JsonObject[];
};

export function normalizeSrtTtsIncidentReport(payload: JsonValue, crossings: SmartCityAsset[], sourceUrl: string, attemptedAt = nowIso()): SmartCityEvent[] {
  if (!isObject(payload) || payload.found !== true || !isObject(payload.meta as JsonValue)) return [];
  const report = payload as SrtTtsIncidentPayload;
  const meta = report.meta ?? {};
  const title = stripHtml(text(meta, ["title_th", "title_en"], "SRT TTS incident report"));
  const incidents = Array.isArray(report.incidents) ? report.incidents.filter(isObject) : [];
  const details = incidents
    .map((item) => stripHtml(`${text(item, ["header_th", "header_en"])} ${text(item, ["detail_th", "detail_en"])}`))
    .filter(Boolean);
  const trainGroups = Array.isArray(report.trainGroups) ? report.trainGroups.filter(isObject) : [];
  const trainCount = trainGroups.reduce((sum, group) => {
    const trains = Array.isArray(group.trains) ? group.trains : [];
    return sum + trains.length;
  }, 0);
  const haystack = `${title} ${details.join(" ")}`;
  const matchedCrossings = matchCrossingsFromText(crossings, haystack);
  const reportSlug = text(meta, ["url_slug"], "latest");
  const reportTime = text(meta, ["report_datetime", "created_at"], attemptedAt);
  const observed = Number.isFinite(new Date(reportTime).getTime()) ? new Date(reportTime).toISOString() : attemptedAt;
  const eventType = eventTypeFromRailText(haystack);
  const severity = severityFromRailText(haystack);
  const description = details[0] || title;
  const pageUrl = `${SRT_TTS_INCIDENT_PAGE_URL}${encodeURIComponent(reportSlug)}`;

  return matchedCrossings.map((crossing, index) =>
    pointEvent({
      id: `srt-tts-${reportSlug}-${crossing.id}`.replace(/[^a-zA-Z0-9ก-๙_.:+-]+/g, "-").slice(0, 150),
      sourceId: "srt-tts-incident",
      eventType,
      lat: crossing.geometry.coordinates[1],
      lng: crossing.geometry.coordinates[0],
      title,
      description,
      severity,
      confidence: index === 0 ? 0.68 : 0.6,
      observedAt: observed,
      sourceUrl: pageUrl || sourceUrl,
      attributes: {
        railDomain: true,
        crossingId: crossing.id,
        matchedCrossingName: crossing.name,
        matchMethod: "official_srt_tts_text_to_drt_crossing",
        sourceReportSlug: reportSlug,
        affectedTrainCount: trainCount,
        dataClass: "near_real_time",
      },
    }),
  ).filter((event): event is SmartCityEvent => event !== null);
}

export function normalizeRailNewsRows(rows: RawRailSignal[], sourceId: string, sourceUrl: string, attemptedAt = nowIso()): SmartCityEvent[] {
  return rows
    .map((row, index) => {
      const title = text(row, ["title", "headline", "name"], "Thai rail signal");
      const description = text(row, ["description", "html"], title).replace(/<[^>]+>/g, " ");
      const haystack = `${title} ${description} ${text(row, ["source"])}`;
      if (!isThaiRailSignalText(haystack)) return null;

      const { lat, lng } = coordinate(row, ["lat", "latitude"], ["lng", "lon", "longitude"]);
      const isIncident = /crash|collision|accident|ชน|อุบัติเหตุ/i.test(haystack);
      return pointEvent({
        id: String(row.id ?? `${sourceId}-${index}`),
        sourceId,
        eventType: isIncident ? "rail_crossing_incident" : "rail_news_signal",
        lat,
        lng,
        title,
        description,
        severity: isIncident ? "high" : normalizeSeverity(row.severity),
        confidence: sourceId.startsWith("osiris") ? 0.58 : 0.74,
        observedAt: observedAt(row, attemptedAt),
        sourceUrl: text(row, ["source_url", "url", "link"], sourceUrl),
        attributes: {
          railDomain: true,
          needsGeocode: !isFiniteCoordinate(lat, lng),
          source: text(row, ["source"]),
        },
      });
    })
    .filter((event): event is SmartCityEvent => event !== null);
}

type DrtPlanBySurvey = Map<string, JsonObject>;

function normalizeSurveyId(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeDrtCrossingRows(rows: JsonObject[], sourceUrl: string, planBySurvey: DrtPlanBySurvey = new Map()): SmartCityAsset[] {
  return rows
    .map((row, index) => {
      const id = normalizeSurveyId(row.sta) || `drt-crossing-${index}`;
      const lat = coordinateValue(row.lat || row.old_lat, "lat");
      const lng = coordinateValue(row.long || row.old_long, "lng");
      if (!isFiniteCoordinate(lat, lng)) return null;
      const plan = planBySurvey.get(id);
      const accidentCount = numberValue(plan?.ACCIDENTS) ?? 0;
      const plannedRiskScore = numberValue(plan?.RISK_SC);
      const name = text(row, ["road"], `DRT rail crossing ${id}`);
      return railAsset({
        sourceId: "drt-crossing-csv",
        id,
        assetType: "rail_crossing",
        name,
        lat: lat as number,
        lng: lng as number,
        attributes: {
          corridor: `${text(row, ["prov"], "Thailand")} · ${text(row, ["dist"], "rail district")}`,
          province: text(row, ["prov"]),
          district: text(row, ["dist"]),
          roadOwner: text(row, ["raod_owner"]),
          crossingType: text(row, ["crossing_type"]),
          authorization: text(row, ["authorization"]),
          trackCount: numberValue(row.no_track),
          laneCountPrimary: numberValue(row.no_lane_1),
          laneCountSecondary: numberValue(row.no_lane_2),
          roadWidthMeters: numberValue(row.road_wid_1),
          trafficMoment: numberValue(row.TM),
          historicalAccidents: accidentCount,
          plannedRiskScore,
          planPhase: text(plan ?? {}, ["PHASING"]),
          planType: text(plan ?? {}, ["TYPE_PLAN"]),
          planYear: text(plan ?? {}, ["PHASING_YR"]),
          planCostMillionBaht: numberValue(plan?.COST_M),
          latitude: lat,
          longitude: lng,
          dataClass: "official_baseline",
          sourceUrl,
        },
      });
    })
    .filter((asset): asset is SmartCityAsset => asset !== null);
}

export function normalizeDrtAccidentRows(rows: JsonObject[], sourceUrl: string, attemptedAt = nowIso()): SmartCityEvent[] {
  return rows
    .map((row, index) => {
      const lat = coordinateValue(row.lat || row.latitude || row.Latitude, "lat");
      const lng = coordinateValue(row.long || row.lng || row.lon || row.longitude || row.Longitude, "lng");
      if (!isFiniteCoordinate(lat, lng)) return null;
      const deceased = numberValue(row.Deceased) ?? 0;
      const injured = numberValue(row.Injured) ?? 0;
      return pointEvent({
        id: String(row._id ?? `drt-accident-${index}`),
        sourceId: "drt-crossing-accidents-csv",
        eventType: "rail_crossing_incident",
        lat,
        lng,
        title: `DRT crossing accident: ${text(row, ["Location"], "unknown location")}`,
        description: `${text(row, ["AccType"], "rail crossing accident")} · deceased ${deceased} · injured ${injured}`,
        severity: deceased > 0 ? "critical" : injured > 0 ? "high" : "medium",
        confidence: 0.72,
        observedAt: observedAt({ timestamp: text(row, ["Date"], attemptedAt) }, attemptedAt),
        sourceUrl,
        attributes: {
          railDomain: true,
          dataClass: "historical",
          accidentType: text(row, ["AccType"]),
          trainLine: text(row, ["TrainLine"]),
          location: text(row, ["Location"]),
          telegraphPole: text(row, ["Telegraph pole"]),
          deceased,
          injured,
        },
      });
    })
    .filter((event): event is SmartCityEvent => event !== null);
}

export function simulateRailImprovement(params: {
  proposalId: string;
  beforeRisk: number;
  intervention: "verify" | "signal_audit" | "queue_control" | "warning_review";
  evidenceCount: number;
  basis: string[];
}): RailSimulationDelta {
  const evidenceFactor = Math.min(1, params.evidenceCount / 6);
  const interventionFactor = {
    verify: 0.04,
    signal_audit: 0.16,
    queue_control: 0.1,
    warning_review: 0.09,
  }[params.intervention];
  const reduction = params.evidenceCount > 0 ? Math.round(params.beforeRisk * interventionFactor * (0.55 + evidenceFactor * 0.45)) : 0;
  const afterExpectedRisk = Math.max(1, params.beforeRisk - reduction);
  return {
    proposalId: params.proposalId,
    beforeRisk: params.beforeRisk,
    afterExpectedRisk,
    delta: afterExpectedRisk - params.beforeRisk,
    confidence: Math.min(0.9, params.evidenceCount > 0 ? 0.48 + evidenceFactor * 0.32 : 0.34),
    evidenceBasis: params.basis.slice(0, 4),
    caveat:
      "Expected risk reduction simulation only. This is not a measured field outcome until live operations and incident data are re-observed.",
  };
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function riskFromEvents(events: SmartCityEvent[]): number {
  const base = Math.max(
    42,
    ...events.map((event) => {
      const severityScore = { critical: 94, high: 82, medium: 64, low: 46 }[event.severity];
      return Math.round(severityScore * (0.75 + event.confidence * 0.25));
    }),
  );
  return Math.min(99, base + Math.min(10, Math.max(0, events.length - 1) * 3));
}

function highestSeverity(events: SmartCityEvent[]): Severity {
  const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return events.reduce<Severity>((highest, event) => (rank[event.severity] > rank[highest] ? event.severity : highest), "low");
}

function relatedEventsForCrossing(crossing: SmartCityAsset, events: SmartCityEvent[]) {
  return events.filter((event) => {
    if (event.attributes.crossingId === crossing.id) return true;
    return distanceKm(crossing.geometry.coordinates, event.geometry.coordinates) <= 0.75;
  });
}

function buildCaseFromEvents(params: {
  id: string;
  name: string;
  corridor: string;
  crossingAssetId: string;
  geometry: SmartCityEvent["geometry"];
  events: SmartCityEvent[];
  crossing?: SmartCityAsset | null;
}): RailSafetyCase {
  const crossingAccidents = numberValue(params.crossing?.attributes.historicalAccidents) ?? 0;
  const plannedRiskScore = numberValue(params.crossing?.attributes.plannedRiskScore);
  const riskScore = Math.max(riskFromEvents(params.events), plannedRiskScore ? Math.round(plannedRiskScore) : 0, crossingAccidents > 0 ? 70 : 0);
  const evidenceBasis = params.events.map((event) => event.sourceUrl || event.title).filter(Boolean);
  const evidence: RailCaseEvidence[] = [];
  if (params.crossing) {
    evidence.push({
      label: "Official baseline",
      value: `${params.crossing.name} from ${params.crossing.sourceId}`,
      kind: "official_baseline",
    });
  }
  if (crossingAccidents > 0) {
    evidence.push({
      label: "Historical accident",
      value: `${crossingAccidents} official DRT recorded accident(s) or planned-improvement accident count`,
      kind: "historical_accident",
    });
  }
  if (params.events.length > 0) {
    evidence.push({
      label: "Live/news signal",
      value: `${params.events.length} geocoded real rail signal(s)`,
      kind: "live_news_signal",
    });
  }
  evidence.push({
    label: "Inference",
    value: "Risk score is derived from real event severity, official crossing attributes, and DRT baseline only.",
    kind: "inference",
  });
  return {
    id: params.id,
    name: params.name,
    corridor: params.corridor,
    crossingAssetId: params.crossingAssetId,
    severity: params.events.length > 0 ? highestSeverity(params.events) : crossingAccidents > 0 || plannedRiskScore ? "high" : "medium",
    confidence:
      params.events.length > 0
        ? Math.max(0.35, Math.min(0.95, params.events.reduce((sum, event) => sum + event.confidence, 0) / params.events.length))
        : Math.max(0.56, plannedRiskScore ? 0.68 : 0.6),
    riskScore,
    geometry: params.geometry,
    relatedEventIds: params.events.map((event) => event.id),
    evidence,
    recommendedAction:
      params.events.length > 0
        ? "Verify the live/news source and crossing field state before authorizing a reversible local response."
        : "Review official DRT crossing baseline, accident history, and planned-improvement metadata before prioritizing a field audit.",
    simulationSummary: simulateRailImprovement({
      proposalId: "real-data-field-verification",
      beforeRisk: riskScore,
      intervention: "verify",
      evidenceCount: evidence.length,
      basis: evidenceBasis.length > 0 ? evidenceBasis : [String(params.crossing?.attributes.sourceUrl ?? DRT_CROSSING_CSV_URL)],
    }),
    updatedAt: nowIso(),
  };
}

export function buildRailCasesFromRealData(crossings: SmartCityAsset[], events: SmartCityEvent[]): RailSafetyCase[] {
  const cases: RailSafetyCase[] = [];
  const usedEventIds = new Set<string>();

  for (const crossing of crossings) {
    const relatedEvents = relatedEventsForCrossing(crossing, events);
    if (relatedEvents.length === 0) continue;
    relatedEvents.forEach((event) => usedEventIds.add(event.id));
    cases.push(
      buildCaseFromEvents({
        id: `rail-case-${crossing.id}`,
        name: crossing.name,
        corridor: String(crossing.attributes.corridor || crossing.region || "SRT crossing"),
        crossingAssetId: crossing.id,
        geometry: crossing.geometry,
        events: relatedEvents,
        crossing,
      }),
    );
  }

  for (const crossing of crossings) {
    if (cases.some((railCase) => railCase.crossingAssetId === crossing.id)) continue;
    const accidentCount = numberValue(crossing.attributes.historicalAccidents) ?? 0;
    const plannedRiskScore = numberValue(crossing.attributes.plannedRiskScore) ?? 0;
    if (accidentCount <= 0 && plannedRiskScore < 70) continue;
    cases.push(
      buildCaseFromEvents({
        id: `rail-case-${crossing.id}`,
        name: crossing.name,
        corridor: String(crossing.attributes.corridor || crossing.region || "SRT crossing"),
        crossingAssetId: crossing.id,
        geometry: crossing.geometry,
        events: [],
        crossing,
      }),
    );
  }

  for (const event of events) {
    if (usedEventIds.has(event.id)) continue;
    cases.push(
      buildCaseFromEvents({
        id: `rail-case-event-${event.id}`,
        name: event.title,
        corridor: String(event.attributes.corridor || event.region || "Thai rail signal"),
        crossingAssetId: String(event.attributes.crossingId || "event-only"),
        geometry: event.geometry,
        events: [event],
      }),
    );
  }

  return cases.sort((a, b) => b.riskScore - a.riskScore).slice(0, 12);
}

async function fetchJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JsonValue> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Accept-Language": "th,en;q=0.8",
        "User-Agent": "CityMCP-OpsDashboard/1.0 (+https://citymcp.vercel.app)",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as JsonValue;
  } finally {
    clearTimeout(timeout);
  }
}

function csvTimeoutMs() {
  const configured = Number(process.env.SMART_CITY_DRT_CSV_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 8000 ? configured : DEFAULT_CSV_TIMEOUT_MS;
}

async function fetchText(url: string, timeoutMs = csvTimeoutMs()): Promise<{ text: string; lastModified: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "text/csv,text/plain,*/*",
        "Accept-Language": "th,en;q=0.8",
        "User-Agent": "CityMCP-OpsDashboard/1.0 (+https://citymcp.vercel.app)",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      text: await response.text(),
      lastModified: response.headers.get("last-modified"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

type DatastoreSearchResponse = {
  success?: boolean;
  result?: {
    total?: number;
    records?: JsonObject[];
  };
};

function datastoreUrl(resourceId: string, limit: number, offset: number) {
  const url = new URL(DRT_DATASTORE_SEARCH_URL);
  url.searchParams.set("resource_id", resourceId);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

function datastoreResourceForKnownCsv(url: string, kind: "crossing" | "plan") {
  const expected = kind === "crossing" ? DRT_CROSSING_RESOURCE_ID : DRT_CROSSING_PLAN_RESOURCE_ID;
  return url.includes(expected) ? expected : null;
}

async function fetchDatastoreRows(resourceId: string, timeoutMs = DEFAULT_DATASTORE_TIMEOUT_MS): Promise<JsonObject[]> {
  const limit = 1000;
  const firstPayload = (await fetchJson(datastoreUrl(resourceId, limit, 0), timeoutMs)) as DatastoreSearchResponse;
  if (!firstPayload.success) throw new Error("CKAN datastore_search returned success=false");

  const firstRows = Array.isArray(firstPayload.result?.records) ? firstPayload.result.records : [];
  const total = Number(firstPayload.result?.total ?? firstRows.length);
  const offsets: number[] = [];
  for (let offset = limit; offset < total; offset += limit) offsets.push(offset);

  const nextPages = await Promise.all(
    offsets.map(async (offset) => {
      const payload = (await fetchJson(datastoreUrl(resourceId, limit, offset), timeoutMs)) as DatastoreSearchResponse;
      if (!payload.success) throw new Error(`CKAN datastore_search failed at offset ${offset}`);
      return Array.isArray(payload.result?.records) ? payload.result.records : [];
    }),
  );

  return [...firstRows, ...nextPages.flat()];
}

type SupabaseRailAssetRow = {
  id: string;
  source_id: string | null;
  asset_type: string;
  name: string;
  region: string;
  attributes: JsonObject;
  updated_at: string;
};

type SupabaseSourceHealthRow = {
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
};

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

function shouldReadRailBaselineFromSupabase() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && (process.env.VERCEL || process.env.SMART_CITY_RAIL_READ_MODEL_FIRST === "true"));
}

function scalarAttributes(attributes: JsonObject): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(attributes).filter((entry): entry is [string, string | number | boolean | null] => {
      const value = entry[1];
      return value === null || ["string", "number", "boolean"].includes(typeof value);
    }),
  );
}

async function readSupabaseSourceHealth(params: {
  sourceId: string;
  name: string;
  provider: string;
  attemptedAt: string;
  fallbackDataClass: SourceDataClass;
  fallbackRefreshPolicy: string;
  fallbackUpstreamCadence: string;
}): Promise<SourceHealth | null> {
  if (!shouldReadRailBaselineFromSupabase()) return null;
  try {
    const query = new URLSearchParams({
      select:
        "source_id,status,last_success_at,last_attempt_at,latency_ms,record_count,freshness_seconds,message,data_class,refresh_policy,last_modified,upstream_cadence",
      source_id: `eq.${params.sourceId}`,
      limit: "1",
    });
    const response = await fetch(supabaseRestUrl(`smart_city_source_health?${query.toString()}`), {
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as SupabaseSourceHealthRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      sourceId: params.sourceId,
      name: params.name,
      provider: params.provider,
      status: row.status,
      lastAttemptAt: row.last_attempt_at ?? params.attemptedAt,
      lastSuccessAt: row.last_success_at,
      latencyMs: row.latency_ms,
      recordCount: row.record_count ?? 0,
      freshnessSeconds: row.freshness_seconds,
      message: row.message ?? "Loaded source health from Supabase read model.",
      dataClass: row.data_class ?? params.fallbackDataClass,
      refreshPolicy: row.refresh_policy ?? params.fallbackRefreshPolicy,
      lastModified: row.last_modified,
      upstreamCadence: row.upstream_cadence ?? params.fallbackUpstreamCadence,
    };
  } catch {
    return null;
  }
}

async function readSupabaseDrtCrossings(attemptedAt: string): Promise<{ crossings: SmartCityAsset[]; health: SourceHealth } | null> {
  if (!shouldReadRailBaselineFromSupabase()) return null;

  const sourceId = "drt-crossing-csv";
  const name = "DRT official rail crossing geometry";
  const provider = "Department of Rail Transport / data.go.th";
  const started = Date.now();

  try {
    const rows: SupabaseRailAssetRow[] = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 5000; offset += pageSize) {
      const params = new URLSearchParams({
        select: "id,source_id,asset_type,name,region,attributes,updated_at",
        source_id: `eq.${sourceId}`,
        asset_type: "eq.rail_crossing",
        limit: String(pageSize),
        offset: String(offset),
        order: "updated_at.desc",
      });
      const response = await fetch(supabaseRestUrl(`smart_city_assets?${params.toString()}`), {
        headers: supabaseHeaders(),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const page = (await response.json()) as SupabaseRailAssetRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    const crossings = rows
      .map((row): SmartCityAsset | null => {
        const lat = numberValue(row.attributes.latitude);
        const lng = numberValue(row.attributes.longitude);
        if (!isFiniteCoordinate(lat, lng)) return null;
        return {
          id: row.id,
          sourceId: row.source_id || sourceId,
          assetType: "rail_crossing",
          name: row.name,
          region: row.region || "thailand",
          geometry: {
            type: "Point",
            coordinates: [lng as number, lat as number],
          },
          attributes: scalarAttributes(row.attributes),
        };
      })
      .filter((asset): asset is SmartCityAsset => asset !== null);

    if (crossings.length === 0) return null;
    return {
      crossings,
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "ok",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: crossings.length,
        message: "Official DRT crossing geometry loaded from Supabase read model.",
        dataClass: "official_baseline",
        refreshPolicy: "Supabase read model from official DRT/data.go.th ingest",
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  } catch {
    return null;
  }
}

async function readRailNewsFeed(url: string | undefined, attemptedAt: string): Promise<{ events: SmartCityEvent[]; health: SourceHealth }> {
  const sourceId = "rail-news-feed";
  const name = "Thai rail incident/news feed";
  const provider = "Configured public rail feed";
  if (!url) {
    return {
      events: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "needs_config",
        attemptedAt,
        message: "Set SMART_CITY_RAIL_NEWS_FEED_URL to ingest live Thai rail incident/news rows.",
        dataClass: "needs_config",
        refreshPolicy: "configured live rail feed",
        upstreamCadence: "unknown until configured",
      }),
    };
  }

  const started = Date.now();
  try {
    const payload = await fetchJson(url);
    const rows = arrayRows(payload, ["events", "news", "records", "items"]) as RawRailSignal[];
    const events = normalizeRailNewsRows(rows, sourceId, url, attemptedAt);
    return {
      events,
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: rows.length > 0 ? "ok" : "stale",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: rows.length,
        message: `${events.length} mapped Thai rail event(s); ${Math.max(0, rows.length - events.length)} row(s) omitted for keyword/geometry/geocode limits.`,
        dataClass: "live",
        refreshPolicy: "configured live rail feed",
        upstreamCadence: "feed-dependent",
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "offline",
        attemptedAt,
        latencyMs: Date.now() - started,
        message: `Rail news feed failed: ${error instanceof Error ? error.message : "unknown error"}`,
        dataClass: "live",
        refreshPolicy: "configured live rail feed",
        upstreamCadence: "feed-dependent",
      }),
    };
  }
}

async function readSrtTtsIncidentReport(
  url: string | undefined,
  attemptedAt: string,
  crossings: SmartCityAsset[],
): Promise<{ events: SmartCityEvent[]; health: SourceHealth }> {
  const sourceId = "srt-tts-incident";
  const name = "SRT TTS incident report";
  const provider = "State Railway of Thailand TTS";
  const sourceUrl = url || SRT_TTS_LATEST_INCIDENT_URL;
  const started = Date.now();

  try {
    const payload = await fetchJson(sourceUrl, 15000);
    const found = isObject(payload) && payload.found === true;
    const events = normalizeSrtTtsIncidentReport(payload, crossings, sourceUrl, attemptedAt);
    return {
      events,
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: found ? (events.length > 0 ? "ok" : "degraded") : "stale",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: found ? 1 : 0,
        message: found
          ? events.length > 0
            ? `SRT TTS active incident report linked to ${events.length} official DRT crossing object(s).`
            : "SRT TTS active incident report loaded, but no official crossing geometry match was made."
          : "SRT TTS latest incident endpoint responded with no active report.",
        dataClass: found ? "near_real_time" : "stale",
        refreshPolicy: "SRT TTS latest incident endpoint polled by dashboard read model",
        upstreamCadence: "SRT TTS incident report update cadence",
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "offline",
        attemptedAt,
        latencyMs: Date.now() - started,
        message: `SRT TTS incident endpoint failed: ${error instanceof Error ? error.message : "unknown error"}`,
        dataClass: "stale",
        refreshPolicy: "SRT TTS latest incident endpoint polled by dashboard read model",
        upstreamCadence: "SRT TTS incident report update cadence",
      }),
    };
  }
}

async function readDrtCrossingPlan(url: string, attemptedAt: string): Promise<{ rows: JsonObject[]; bySurvey: DrtPlanBySurvey; health: SourceHealth }> {
  const sourceId = "drt-crossing-plan-csv";
  const name = "DRT crossing improvement plan";
  const provider = "Department of Rail Transport / data.go.th";
  const started = Date.now();
  const readModelHealth = await readSupabaseSourceHealth({
    sourceId,
    name,
    provider,
    attemptedAt,
    fallbackDataClass: "official_baseline",
    fallbackRefreshPolicy: "Supabase read model from official DRT/data.go.th ingest",
    fallbackUpstreamCadence: "official dataset publication cadence",
  });
  if (readModelHealth) return { rows: [], bySurvey: new Map(), health: readModelHealth };

  try {
    const datastoreResourceId = datastoreResourceForKnownCsv(url, "plan");
    const rows = datastoreResourceId ? await fetchDatastoreRows(datastoreResourceId) : parseCsv((await fetchText(url)).text);
    return {
      rows,
      bySurvey: new Map(
        rows
          .map((row): [string, JsonObject] | null => {
            const surveyId = normalizeSurveyId(row.Survey_No);
            return surveyId ? [surveyId, row] : null;
          })
          .filter((entry): entry is [string, JsonObject] => Boolean(entry)),
      ),
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: rows.length > 0 ? "ok" : "stale",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: rows.length,
        message:
          rows.length > 0
            ? `Official DRT crossing improvement plan loaded from ${datastoreResourceId ? "CKAN datastore" : "CSV"}.`
            : "DRT plan source returned no rows.",
        dataClass: "official_baseline",
        refreshPolicy: datastoreResourceId ? "official DRT CKAN datastore pull" : "official DRT CSV pull",
        lastModified: null,
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  } catch (error) {
    return {
      rows: [],
      bySurvey: new Map(),
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "offline",
        attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: 0,
        message: `DRT crossing plan CSV failed: ${error instanceof Error ? error.message : "unknown error"}`,
        dataClass: "official_baseline",
        refreshPolicy: "official DRT CSV pull",
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  }
}

async function readDrtCrossings(url: string, attemptedAt: string, planBySurvey: DrtPlanBySurvey): Promise<{ crossings: SmartCityAsset[]; health: SourceHealth }> {
  const sourceId = "drt-crossing-csv";
  const name = "DRT official rail crossing geometry";
  const provider = "Department of Rail Transport / data.go.th";
  const started = Date.now();
  const readModel = await readSupabaseDrtCrossings(attemptedAt);
  if (readModel) return readModel;

  try {
    const datastoreResourceId = datastoreResourceForKnownCsv(url, "crossing");
    const rows = datastoreResourceId ? await fetchDatastoreRows(datastoreResourceId) : parseCsv((await fetchText(url)).text);
    const crossings = normalizeDrtCrossingRows(rows, url, planBySurvey);
    return {
      crossings,
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: crossings.length > 0 ? "ok" : "stale",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: crossings.length,
        message:
          crossings.length > 0
            ? `Official DRT crossing geometry loaded from ${datastoreResourceId ? "CKAN datastore" : "CSV"}; ${
                rows.length - crossings.length
              } row(s) omitted for invalid coordinates.`
            : "DRT crossing source responded but no point geometry was usable.",
        dataClass: "official_baseline",
        refreshPolicy: datastoreResourceId ? "official DRT CKAN datastore pull" : "official DRT CSV pull",
        lastModified: null,
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  } catch (error) {
    return {
      crossings: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "offline",
        attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: 0,
        message: `DRT crossing CSV failed: ${error instanceof Error ? error.message : "unknown error"}`,
        dataClass: "official_baseline",
        refreshPolicy: "official DRT CSV pull",
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  }
}

async function readDrtCrossingAccidents(url: string, attemptedAt: string): Promise<{ events: SmartCityEvent[]; health: SourceHealth }> {
  const sourceId = "drt-crossing-accidents-csv";
  const name = "DRT crossing accident history";
  const provider = "Department of Rail Transport / data.go.th";
  const started = Date.now();
  const readModelHealth = await readSupabaseSourceHealth({
    sourceId,
    name,
    provider,
    attemptedAt,
    fallbackDataClass: "historical",
    fallbackRefreshPolicy: "Supabase read model from official DRT/data.go.th ingest",
    fallbackUpstreamCadence: "official dataset publication cadence",
  });
  if (readModelHealth) return { events: [], health: readModelHealth };

  try {
    const payload = await fetchText(url);
    const rows = parseCsv(payload.text);
    const events = normalizeDrtAccidentRows(rows, url, attemptedAt);
    return {
      events,
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: rows.length > 0 ? "ok" : "stale",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: rows.length,
        message:
          events.length > 0
            ? `Mapped ${events.length} geocoded historical DRT crossing accident row(s).`
            : `Loaded ${rows.length} official DRT accident row(s); no GIS columns were available for map event creation.`,
        dataClass: "historical",
        refreshPolicy: "official DRT CSV pull",
        lastModified: payload.lastModified,
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "offline",
        attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: 0,
        message: `DRT accident CSV failed: ${error instanceof Error ? error.message : "unknown error"}`,
        dataClass: "historical",
        refreshPolicy: "official DRT CSV pull",
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  }
}

function parseGeoJsonCrossings(payload: JsonValue): SmartCityAsset[] {
  if (!isObject(payload) || !Array.isArray(payload.features)) return [];
  return payload.features
    .filter(isObject)
    .map((feature, index) => {
      const geometry = isObject(feature.geometry as JsonValue) ? (feature.geometry as JsonObject) : null;
      const properties = isObject(feature.properties as JsonValue) ? (feature.properties as JsonObject) : {};
      const coordinates = Array.isArray(geometry?.coordinates) ? geometry?.coordinates : [];
      const lng = numberValue(coordinates[0]);
      const lat = numberValue(coordinates[1]);
      if (!isFiniteCoordinate(lat, lng)) return null;
      return railAsset({
        sourceId: "rail-crossing-geojson",
        id: text(properties, ["id"], `rail-crossing-feed-${index}`),
        assetType: "rail_crossing",
        name: text(properties, ["name", "title"], "Configured rail crossing"),
        lat: lat as number,
        lng: lng as number,
        attributes: {
          corridor: text(properties, ["corridor"]),
          control: text(properties, ["control", "barrier", "signal"]),
          source: "configured geojson",
        },
      });
    })
    .filter((asset): asset is SmartCityAsset => asset !== null);
}

async function readRailCrossings(url: string | undefined, attemptedAt: string): Promise<{ crossings: SmartCityAsset[]; health: SourceHealth }> {
  const sourceId = "rail-crossing-geojson";
  const name = "SRT/DRT crossing geometry feed";
  const provider = "Configured rail asset feed";
  if (!url) {
    return {
      crossings: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "needs_config",
        attemptedAt,
        message: "Set SMART_CITY_RAIL_CROSSING_GEOJSON_URL to ingest official rail crossing geometry.",
        dataClass: "needs_config",
        refreshPolicy: "configured official rail geometry feed",
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  }

  const started = Date.now();
  try {
    const payload = await fetchJson(url);
    const crossings = parseGeoJsonCrossings(payload);
    return {
      crossings,
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: crossings.length > 0 ? "ok" : "stale",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs: Date.now() - started,
        recordCount: crossings.length,
        message: crossings.length > 0 ? "Configured rail crossing geometry loaded." : "Crossing feed responded but no point geometry was usable.",
        dataClass: "official_baseline",
        refreshPolicy: "configured official rail geometry feed",
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  } catch (error) {
    return {
      crossings: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "offline",
        attemptedAt,
        latencyMs: Date.now() - started,
        message: `Rail crossing feed failed: ${error instanceof Error ? error.message : "unknown error"}`,
        dataClass: "official_baseline",
        refreshPolicy: "configured official rail geometry feed",
        upstreamCadence: "official dataset publication cadence",
      }),
    };
  }
}

async function readOsirisRailContext(baseUrl: string | undefined, attemptedAt: string): Promise<{ events: SmartCityEvent[]; health: SourceHealth }> {
  const sourceId = "osiris-rail-context";
  const name = "OSIRIS Thai rail context filter";
  const provider = "OSIRIS passive news/weather context";
  if (!baseUrl) {
    return {
      events: [],
      health: sourceHealth({
        sourceId,
        name,
        provider,
        status: "needs_config",
        attemptedAt,
        message: "Set SMART_CITY_OSIRIS_BASE_URL to filter Osiris passive feeds for Thai rail context.",
        dataClass: "needs_config",
        refreshPolicy: "OSIRIS passive context filter",
        upstreamCadence: "feed-dependent",
      }),
    };
  }

  const cleaned = baseUrl.replace(/\/+$/, "");
  const endpoints = ["/api/gdelt", "/api/news", "/api/weather", "/api/live-news"];
  const started = Date.now();
  const rows: RawRailSignal[] = [];
  let failures = 0;
  await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const payload = await fetchJson(`${cleaned}${endpoint}`, 5000);
        rows.push(...(arrayRows(payload, ["events", "news", "weather_events", "feeds"]) as RawRailSignal[]));
      } catch {
        failures += 1;
      }
    }),
  );

  const events = normalizeRailNewsRows(rows, sourceId, `${cleaned}/`, attemptedAt).slice(0, 20);
  const status: SourceStatus = failures === endpoints.length ? "offline" : events.length > 0 ? "ok" : "stale";
  return {
    events,
    health: sourceHealth({
      sourceId,
      name,
      provider,
      status,
      attemptedAt,
      lastSuccessAt: failures === endpoints.length ? null : attemptedAt,
      latencyMs: Date.now() - started,
      recordCount: rows.length,
      message:
        events.length > 0
          ? `Filtered ${events.length} Thai rail context signal(s) from Osiris passive feeds.`
          : `No geocoded Thai rail context from ${rows.length} Osiris row(s); generic station false positives are ignored.`,
      dataClass: status === "ok" ? "near_real_time" : "stale",
      refreshPolicy: "OSIRIS passive context filter",
      upstreamCadence: "feed-dependent",
    }),
  };
}

async function fetchRailSafetyOverview(): Promise<RailOverview> {
  loadOpsEnv();
  const attemptedAt = nowIso();
  const drtPlanUrl = process.env.SMART_CITY_DRT_CROSSING_PLAN_CSV_URL || DRT_CROSSING_PLAN_CSV_URL;
  const drtCrossingUrl = process.env.SMART_CITY_DRT_CROSSING_CSV_URL || DRT_CROSSING_CSV_URL;
  const drtAccidentsUrl = process.env.SMART_CITY_DRT_CROSSING_ACCIDENTS_CSV_URL || DRT_CROSSING_ACCIDENTS_CSV_URL;
  const srtTtsIncidentUrl = process.env.SMART_CITY_SRT_TTS_INCIDENT_URL || SRT_TTS_LATEST_INCIDENT_URL;
  const [news, drtPlan, drtAccidents, crossingFeed, osirisContext] = await Promise.all([
    readRailNewsFeed(process.env.SMART_CITY_RAIL_NEWS_FEED_URL, attemptedAt),
    readDrtCrossingPlan(drtPlanUrl, attemptedAt),
    readDrtCrossingAccidents(drtAccidentsUrl, attemptedAt),
    readRailCrossings(process.env.SMART_CITY_RAIL_CROSSING_GEOJSON_URL, attemptedAt),
    readOsirisRailContext(process.env.SMART_CITY_OSIRIS_BASE_URL, attemptedAt),
  ]);

  const drtCrossings = await readDrtCrossings(drtCrossingUrl, attemptedAt, drtPlan.bySurvey);
  const crossings = [...drtCrossings.crossings, ...crossingFeed.crossings];
  const srtTtsIncident = await readSrtTtsIncidentReport(srtTtsIncidentUrl, attemptedAt, crossings);
  const events = [...news.events, ...srtTtsIncident.events, ...drtAccidents.events, ...osirisContext.events];
  const cases = buildRailCasesFromRealData(crossings, events);

  return {
    generatedAt: attemptedAt,
    region: "Thailand SRT level crossings real-data-only",
    sources: [
      {
        id: "drt-crossing-csv",
        name: "DRT official rail crossing geometry",
        provider: "Department of Rail Transport / data.go.th",
        category: "rail_crossing_geometry",
        region: "thailand",
        sourceUrl: drtCrossingUrl,
        refreshSeconds: 86400,
        dataClass: "official_baseline",
        refreshPolicy: "official DRT CSV pull",
        upstreamCadence: "official dataset publication cadence",
      },
      {
        id: "drt-crossing-accidents-csv",
        name: "DRT crossing accident history",
        provider: "Department of Rail Transport / data.go.th",
        category: "rail_accident_history",
        region: "thailand",
        sourceUrl: drtAccidentsUrl,
        refreshSeconds: 86400,
        dataClass: "historical",
        refreshPolicy: "official DRT CSV pull",
        upstreamCadence: "official dataset publication cadence",
      },
      {
        id: "drt-crossing-plan-csv",
        name: "DRT crossing improvement plan",
        provider: "Department of Rail Transport / data.go.th",
        category: "rail_improvement_plan",
        region: "thailand",
        sourceUrl: drtPlanUrl,
        refreshSeconds: 86400,
        dataClass: "official_baseline",
        refreshPolicy: "official DRT CSV pull",
        upstreamCadence: "official dataset publication cadence",
      },
      {
        id: "srt-tts-incident",
        name: "SRT TTS incident report",
        provider: "State Railway of Thailand TTS",
        category: "rail_incident_status",
        region: "thailand",
        sourceUrl: srtTtsIncidentUrl,
        refreshSeconds: 300,
        dataClass: "near_real_time",
        refreshPolicy: "SRT TTS latest incident endpoint polled by dashboard read model",
        upstreamCadence: "SRT TTS incident report update cadence",
      },
      {
        id: "rail-news-feed",
        name: "Thai rail incident/news feed",
        provider: "Configured public rail feed",
        category: "rail_news",
        region: "thailand",
        sourceUrl: process.env.SMART_CITY_RAIL_NEWS_FEED_URL || "not-configured",
        refreshSeconds: 300,
        dataClass: process.env.SMART_CITY_RAIL_NEWS_FEED_URL ? "live" : "needs_config",
        refreshPolicy: "configured live rail feed",
        upstreamCadence: "unknown until configured",
      },
      {
        id: "rail-crossing-geojson",
        name: "SRT/DRT crossing geometry feed",
        provider: "Configured rail asset feed",
        category: "rail_crossing_geometry",
        region: "thailand",
        sourceUrl: process.env.SMART_CITY_RAIL_CROSSING_GEOJSON_URL || "not-configured",
        refreshSeconds: 86400,
        dataClass: process.env.SMART_CITY_RAIL_CROSSING_GEOJSON_URL ? "official_baseline" : "needs_config",
        refreshPolicy: "configured official rail geometry feed",
        upstreamCadence: "official dataset publication cadence",
      },
      {
        id: "osiris-rail-context",
        name: "OSIRIS Thai rail context filter",
        provider: "OSIRIS passive feeds",
        category: "rail_context",
        region: "thailand",
        sourceUrl: process.env.SMART_CITY_OSIRIS_BASE_URL || "not-configured",
        refreshSeconds: 300,
        dataClass: process.env.SMART_CITY_OSIRIS_BASE_URL ? "near_real_time" : "needs_config",
        refreshPolicy: "OSIRIS passive context filter",
        upstreamCadence: "feed-dependent",
      },
    ],
    sourceHealth: [drtCrossings.health, drtAccidents.health, drtPlan.health, srtTtsIncident.health, news.health, crossingFeed.health, osirisContext.health],
    crossings,
    events,
    cases,
    simulations: cases.map((item) => item.simulationSummary),
  };
}

export async function getRailSafetyOverview(): Promise<RailOverview> {
  loadOpsEnv();
  const ttlMs = readModelCacheTtlMs();
  const now = Date.now();
  const cached = globalForRailOverview.railSafetyOverviewCache;
  if (cached?.value && now < cached.expiresAt) return cached.value;
  if (cached?.refreshing) return cached.refreshing;

  const refreshing = fetchRailSafetyOverview()
    .then((value) => {
      globalForRailOverview.railSafetyOverviewCache = {
        value,
        expiresAt: Date.now() + ttlMs,
      };
      return value;
    })
    .catch((error) => {
      if (cached?.value) return cached.value;
      throw error;
    });

  globalForRailOverview.railSafetyOverviewCache = {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    refreshing,
  };
  return refreshing;
}

export const RAIL_REFERENCE_URLS = {
  drtReport: DRT_REPORT_URL,
  asokAp: AP_ASOK_URL,
  asokThairath: THAIRATH_ASOK_URL,
};
