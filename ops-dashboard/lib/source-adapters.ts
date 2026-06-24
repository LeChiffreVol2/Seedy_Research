import { loadOpsEnv } from "./env";
import { getOsirisIngestion } from "./osiris-adapters";
import { THAILAND_SOURCES } from "./thailand-sources";
import type { OpsOverview, SmartCityEvent, SmartCityHotspot, SourceDataClass, SourceHealth, SourceStatus, TimelineBucket } from "./types";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_TTL_MS = 60_000;

const globalForTransportOverview = globalThis as unknown as {
  thailandTransportOverviewCache?: {
    expiresAt: number;
    value?: OpsOverview;
    refreshing?: Promise<OpsOverview>;
  };
};

function readModelCacheTtlMs(): number {
  const parsed = Number(process.env.SMART_CITY_READ_MODEL_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type RawEventRow = {
  id?: unknown;
  eid?: unknown;
  lat?: unknown;
  latitude?: unknown;
  lng?: unknown;
  lon?: unknown;
  longitude?: unknown;
  title?: unknown;
  title_en?: unknown;
  name?: unknown;
  description?: unknown;
  description_en?: unknown;
  event_type?: unknown;
  type?: unknown;
  icon?: unknown;
  severity?: unknown;
  confidence?: unknown;
  observed_at?: unknown;
  timestamp?: unknown;
  start?: unknown;
  stop?: unknown;
  pubDate?: unknown;
  source_url?: unknown;
  url?: unknown;
  contributor?: unknown;
  showlevel?: unknown;
};

export type ConfiguredSource = {
  sourceId: string;
  name: string;
  provider: string;
  url?: string;
  apiKey?: string;
  dataClass?: SourceDataClass;
  refreshPolicy?: string;
  upstreamCadence?: string;
  parseRows?: (payload: JsonValue) => RawEventRow[];
};

export function isFiniteCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function normalizeSeverity(value: unknown): SmartCityEvent["severity"] {
  const normalized = String(value ?? "").toLowerCase();
  if (["critical", "severe", "very_high"].includes(normalized)) return "critical";
  if (["high", "major"].includes(normalized)) return "high";
  if (["medium", "moderate", "warning"].includes(normalized)) return "medium";
  return "low";
}

export function normalizeEventType(...values: unknown[]): SmartCityEvent["eventType"] {
  const normalized = values.map((value) => String(value ?? "")).join(" ").toLowerCase();
  if (normalized.includes("weather") || normalized.includes("rain") || normalized.includes("flood") || normalized.includes("ฝน") || normalized.includes("น้ำท่วม")) return "weather_risk";
  if (normalized.includes("camera") || normalized.includes("cctv")) return "camera_signal";
  if (normalized.includes("roadwork") || normalized.includes("construction") || normalized.includes("ซ่อม") || normalized.includes("ก่อสร้าง")) return "roadwork";
  if (normalized.includes("congestion") || normalized.includes("traffic") || normalized.includes("avoid") || normalized.includes("รถติด") || normalized.includes("จราจร")) return "congestion";
  return "incident";
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeObservedAt(value: unknown): string {
  const raw = coerceString(value);
  if (!raw) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(" ", "T")}+07:00`).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeUpstreamSeverity(row: RawEventRow): SmartCityEvent["severity"] {
  const explicit = normalizeSeverity(row.severity);
  if (explicit !== "low") return explicit;
  const haystack = `${coerceString(row.icon)} ${coerceString(row.title)} ${coerceString(row.title_en)} ${coerceString(row.description)} ${coerceString(row.description_en)}`.toLowerCase();
  if (haystack.includes("fire") || haystack.includes("accident") || haystack.includes("collision") || haystack.includes("crash")) return "high";
  if (haystack.includes("เพลิงไหม้") || haystack.includes("อุบัติเหตุ") || haystack.includes("ชน") || haystack.includes("รถชน")) return "high";
  if (haystack.includes("warning") || haystack.includes("caution") || haystack.includes("ระวัง")) return "medium";
  return "low";
}

export function normalizeEventRows(rows: RawEventRow[], sourceId: string, sourceUrl: string): SmartCityEvent[] {
  const mapped: Array<SmartCityEvent | null> = rows.map((row, index) => {
    const lat = Number(row.lat ?? row.latitude);
    const lng = Number(row.lng ?? row.lon ?? row.longitude);
    if (!isFiniteCoordinate(lat, lng)) return null;

    const title = coerceString(row.title_en) || coerceString(row.title) || coerceString(row.name) || "Transport safety signal";
    const description = coerceString(row.description_en) || coerceString(row.description) || title;
    const observedAt = normalizeObservedAt(row.observed_at ?? row.timestamp ?? row.start ?? row.pubDate);
    const confidence = Number(row.confidence ?? 0.6);
    const expiresAt = row.stop ? normalizeObservedAt(row.stop) : undefined;
    const upstreamId = row.id ?? row.eid ?? `${sourceId}-${index}`;
    const sourceLink = coerceString(row.source_url) || coerceString(row.url) || sourceUrl;

    return {
      id: String(upstreamId),
      sourceId,
      eventType: normalizeEventType(row.event_type, row.type, row.icon, title, description),
      severity: normalizeUpstreamSeverity(row),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
      observedAt,
      expiresAt: expiresAt === observedAt ? undefined : expiresAt,
      region: "bangkok",
      geometry: { type: "Point" as const, coordinates: [lng, lat] },
      title,
      description,
      sourceUrl: sourceLink,
      attributes: {
        imported: true,
        adapter: sourceId,
        upstreamType: coerceString(row.type) || null,
        upstreamIcon: coerceString(row.icon) || null,
        contributor: coerceString(row.contributor) || null,
        showlevel: Number.isFinite(Number(row.showlevel)) ? Number(row.showlevel) : null,
      },
    };
  });

  return mapped.filter((event): event is SmartCityEvent => event !== null);
}

export function buildSourceHealth(params: {
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

export async function fetchJsonWithTimeout(url: string, apiKey?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JsonValue> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: apiKey ? { "api-key": apiKey, Authorization: `Bearer ${apiKey}` } : undefined,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as JsonValue;
  } finally {
    clearTimeout(timeout);
  }
}

function defaultRowParser(payload: JsonValue): RawEventRow[] {
  if (Array.isArray(payload)) return payload as RawEventRow[];
  if (!payload || typeof payload !== "object") return [];
  const objectPayload = payload as Record<string, JsonValue>;
  if (Array.isArray(objectPayload.events)) return objectPayload.events as RawEventRow[];
  if (Array.isArray(objectPayload.incidents)) return objectPayload.incidents as RawEventRow[];
  if (Array.isArray(objectPayload.records)) return objectPayload.records as RawEventRow[];
  if (
    objectPayload.result &&
    typeof objectPayload.result === "object" &&
    Array.isArray((objectPayload.result as Record<string, JsonValue>).records)
  ) {
    return (objectPayload.result as Record<string, JsonValue>).records as RawEventRow[];
  }
  return [];
}

async function readConfiguredJsonSource(source: ConfiguredSource): Promise<{ events: SmartCityEvent[]; health: SourceHealth }> {
  const attemptedAt = new Date().toISOString();
  if (!source.url) {
    return {
      events: [],
      health: buildSourceHealth({
        sourceId: source.sourceId,
        name: source.name,
        provider: source.provider,
        status: "needs_config",
        attemptedAt,
        message: "No upstream feed URL configured. Real-data-only mode leaves this connector empty.",
        dataClass: source.dataClass ?? "needs_config",
        refreshPolicy: source.refreshPolicy,
        upstreamCadence: source.upstreamCadence,
      }),
    };
  }

  const start = Date.now();
  try {
    const payload = await fetchJsonWithTimeout(source.url, source.apiKey);
    const rows = (source.parseRows ?? defaultRowParser)(payload);
    const events = normalizeEventRows(rows, source.sourceId, source.url);
    const latencyMs = Date.now() - start;
    return {
      events,
      health: buildSourceHealth({
        sourceId: source.sourceId,
        name: source.name,
        provider: source.provider,
        status: events.length > 0 ? "ok" : "stale",
        attemptedAt,
        lastSuccessAt: attemptedAt,
        latencyMs,
        recordCount: events.length,
        message: events.length > 0 ? "Live connector returned normalized transport safety events." : "Connector responded but returned no usable events.",
        dataClass: source.dataClass,
        refreshPolicy: source.refreshPolicy,
        upstreamCadence: source.upstreamCadence,
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: buildSourceHealth({
        sourceId: source.sourceId,
        name: source.name,
        provider: source.provider,
        status: "offline",
        attemptedAt,
        latencyMs: Date.now() - start,
        message: `Connector failed: ${error instanceof Error ? error.message : "unknown error"}`,
        dataClass: source.dataClass,
        refreshPolicy: source.refreshPolicy,
        upstreamCadence: source.upstreamCadence,
      }),
    };
  }
}

function sourceMetadata(source: ConfiguredSource) {
  const declared = THAILAND_SOURCES.find((item) => item.id === source.sourceId);
  if (declared) {
    return {
      ...declared,
      sourceUrl: source.url ?? declared.sourceUrl,
      dataClass: source.dataClass ?? declared.dataClass,
      refreshPolicy: source.refreshPolicy ?? declared.refreshPolicy,
      upstreamCadence: source.upstreamCadence ?? declared.upstreamCadence,
    };
  }
  return {
    id: source.sourceId,
    name: source.name,
    provider: source.provider,
    category: "configured_feed",
    region: "thailand",
    sourceUrl: source.url ?? "not-configured",
    refreshSeconds: 300,
    dataClass: source.dataClass,
    refreshPolicy: source.refreshPolicy,
    upstreamCadence: source.upstreamCadence,
  };
}

function severityRisk(severity: SmartCityEvent["severity"], confidence: number): number {
  const base = {
    critical: 92,
    high: 80,
    medium: 62,
    low: 44,
  }[severity];
  return Math.max(1, Math.min(99, Math.round(base * (0.75 + Math.max(0, Math.min(1, confidence)) * 0.25))));
}

function isThailandPoint(event: SmartCityEvent): boolean {
  const [lng, lat] = event.geometry.coordinates;
  return lng >= 97 && lng <= 106 && lat >= 5 && lat <= 21;
}

function deriveHotspotsFromEvents(events: SmartCityEvent[]): SmartCityHotspot[] {
  const thailandEvents = events.filter(isThailandPoint);
  const candidateEvents = thailandEvents.length > 0 ? thailandEvents : events;
  return [...candidateEvents]
    .sort((a, b) => severityRisk(b.severity, b.confidence) - severityRisk(a.severity, a.confidence))
    .slice(0, 8)
    .map((event) => {
      const corridor =
        typeof event.attributes.corridor === "string" && event.attributes.corridor.trim()
          ? event.attributes.corridor
          : event.region || event.eventType.replaceAll("_", " ");
      const riskScore = severityRisk(event.severity, event.confidence);
      return {
        id: `hotspot-real-${event.id}`,
        region: event.region,
        name: event.title,
        corridor,
        riskScore,
        trend: "flat",
        severity: event.severity,
        confidence: event.confidence,
        geometry: event.geometry,
        evidence: [
          { label: "Live source", value: event.sourceId, kind: "live" },
          { label: "Observed signal", value: event.title, kind: "live" },
          { label: "Derived risk", value: `${event.eventType.replaceAll("_", " ")} at source geometry`, kind: "inferred" },
        ],
        recommendedAction: "Verify the upstream signal and current field state before authorizing any operational response.",
        updatedAt: event.observedAt,
      };
    });
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

async function fetchThailandTransportOverview(): Promise<OpsOverview> {
  loadOpsEnv();
  const configuredSources: ConfiguredSource[] = [
    {
      sourceId: "bma-traffic",
      name: "Bangkok traffic and transport references",
      provider: "Bangkok Metropolitan Administration",
      url: process.env.SMART_CITY_BMA_FEED_URL,
      dataClass: process.env.SMART_CITY_BMA_FEED_URL ? "near_real_time" : "needs_config",
      refreshPolicy: "configured upstream",
      upstreamCadence: "unknown until BMA feed is configured",
    },
    {
      sourceId: "itic-live-events",
      name: "iTIC / Longdo live traffic events",
      provider: "iTIC Foundation / Longdo Traffic",
      url: process.env.SMART_CITY_ITIC_LIVE_EVENTS_URL ?? "https://event.longdo.com/feed/json",
      dataClass: "live",
      refreshPolicy: "request-time fetch with short read-model cache",
      upstreamCadence: "live event feed",
    },
    {
      sourceId: "itic-open-data",
      name: "iTIC historical traffic and incident data",
      provider: "iTIC Foundation",
      url: process.env.SMART_CITY_ITIC_FEED_URL,
      dataClass: process.env.SMART_CITY_ITIC_FEED_URL ? "historical" : "needs_config",
      refreshPolicy: "configured archive feed",
      upstreamCadence: "archive",
    },
    {
      sourceId: "data-goth-traffic",
      name: "Open Government traffic datasets",
      provider: "Open Government Data of Thailand",
      url:
        process.env.SMART_CITY_DATA_GOTH_RESOURCE_ID && process.env.SMART_CITY_DATA_GOTH_API_KEY
          ? `https://opend.data.go.th/get-ckan/datastore_search?resource_id=${encodeURIComponent(
              process.env.SMART_CITY_DATA_GOTH_RESOURCE_ID,
            )}&limit=100`
          : undefined,
      apiKey: process.env.SMART_CITY_DATA_GOTH_API_KEY,
      dataClass: process.env.SMART_CITY_DATA_GOTH_RESOURCE_ID ? "official_baseline" : "needs_config",
      refreshPolicy: "CKAN datastore fetch",
      upstreamCadence: "official dataset cadence",
    },
  ];

  const liveResults = await Promise.all(configuredSources.map((source) => readConfiguredJsonSource(source)));
  const osiris = await getOsirisIngestion();
  const liveEvents = liveResults.flatMap((result) => result.events);
  const events = [...liveEvents, ...osiris.events];
  const assets = osiris.assets;
  const hotspots = deriveHotspotsFromEvents(events);

  return {
    generatedAt: new Date().toISOString(),
    region: "Thailand real-data-only",
    viewport: {
      center: [100.548, 13.7563],
      zoom: 11.3,
    },
    sources: [...configuredSources.map(sourceMetadata), ...osiris.sources],
    sourceHealth: [...liveResults.map((result) => result.health), ...osiris.sourceHealth],
    events,
    assets,
    hotspots,
    timeline: buildTimeline(events),
  };
}

export async function getThailandTransportOverview(): Promise<OpsOverview> {
  loadOpsEnv();
  const ttlMs = readModelCacheTtlMs();
  const now = Date.now();
  const cached = globalForTransportOverview.thailandTransportOverviewCache;
  if (cached?.value && now < cached.expiresAt) return cached.value;
  if (cached?.refreshing) return cached.refreshing;

  const refreshing = fetchThailandTransportOverview()
    .then((value) => {
      globalForTransportOverview.thailandTransportOverviewCache = {
        value,
        expiresAt: Date.now() + ttlMs,
      };
      return value;
    })
    .catch((error) => {
      if (cached?.value) return cached.value;
      throw error;
    });

  globalForTransportOverview.thailandTransportOverviewCache = {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    refreshing,
  };
  return refreshing;
}
