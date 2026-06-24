import { loadOpsEnv } from "./env";
import type { SmartCityAsset, SmartCityEvent, SmartCitySource, SourceHealth, SourceStatus } from "./types";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

type OsirisFeed = {
  id: string;
  name: string;
  provider: string;
  category: string;
  path: string;
  arrays: string[];
  mapRows: (rows: JsonObject[], context: FeedContext) => { events: SmartCityEvent[]; assets: SmartCityAsset[] };
};

type FeedContext = {
  feed: OsirisFeed;
  baseUrl: string;
  attemptedAt: string;
  maxRows: number;
};

export type OsirisIngestionResult = {
  sources: SmartCitySource[];
  sourceHealth: SourceHealth[];
  events: SmartCityEvent[];
  assets: SmartCityAsset[];
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ROWS_PER_FEED = 320;
const DEFAULT_CACHE_TTL_MS = 60_000;

const globalForOsiris = globalThis as unknown as {
  osirisIngestionCache?: {
    expiresAt: number;
    value?: OsirisIngestionResult;
    refreshing?: Promise<OsirisIngestionResult>;
  };
};

function readModelCacheTtlMs(): number {
  const parsed = Number(process.env.SMART_CITY_READ_MODEL_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRows(payload: JsonValue, keys: string[]): JsonObject[] {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (!isObject(payload)) return [];

  const rows: JsonObject[] = [];
  for (const key of keys) {
    if (key === "__root") {
      rows.push(payload);
      continue;
    }
    const value = valueAtPath(payload, key);
    if (Array.isArray(value)) rows.push(...value.filter(isObject));
    else if (isObject(value)) rows.push(value);
  }
  return rows;
}

function valueAtPath(row: JsonObject, path: string): JsonValue | undefined {
  const parts = path.split(".");
  let current: JsonValue | undefined = row;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function sourceUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function numeric(row: JsonObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = valueAtPath(row, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function text(row: JsonObject, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = valueAtPath(row, key);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return fallback;
}

function objectValue(row: JsonObject, key: string): JsonObject | null {
  const value = valueAtPath(row, key);
  return isObject(value) ? value : null;
}

function isoTime(row: JsonObject, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = valueAtPath(row, key);
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return fallback;
}

function validPoint(lat: number | null, lng: number | null): lat is number {
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

function compactAttributes(values: Record<string, string | number | boolean | null | undefined>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<
    string,
    string | number | boolean | null
  >;
}

function severityFromScore(score: number | null): SmartCityEvent["severity"] {
  if (score === null) return "low";
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function severityFromText(value: string): SmartCityEvent["severity"] {
  const normalized = value.toLowerCase();
  if (["critical", "severe", "extreme", "hazardous"].some((token) => normalized.includes(token))) return "critical";
  if (["high", "unhealthy", "major"].some((token) => normalized.includes(token))) return "high";
  if (["medium", "moderate", "elevated", "warning"].some((token) => normalized.includes(token))) return "medium";
  return "low";
}

function pointEvent(params: {
  id: string;
  sourceId: string;
  lat: number | null;
  lng: number | null;
  title: string;
  description: string;
  eventType: SmartCityEvent["eventType"];
  severity: SmartCityEvent["severity"];
  confidence: number;
  observedAt: string;
  region: string;
  sourceUrl: string;
  attributes?: Record<string, string | number | boolean | null | undefined>;
}): SmartCityEvent | null {
  if (!validPoint(params.lat, params.lng)) return null;
  const lat = params.lat as number;
  const lng = params.lng as number;
  return {
    id: params.id,
    sourceId: params.sourceId,
    eventType: params.eventType,
    severity: params.severity,
    confidence: Math.max(0, Math.min(1, params.confidence)),
    observedAt: params.observedAt,
    region: params.region,
    geometry: { type: "Point", coordinates: [lng, lat] },
    title: params.title,
    description: params.description,
    sourceUrl: params.sourceUrl,
    attributes: compactAttributes(params.attributes ?? {}),
  };
}

function pointAsset(params: {
  id: string;
  sourceId: string;
  assetType: SmartCityAsset["assetType"];
  lat: number | null;
  lng: number | null;
  name: string;
  region: string;
  attributes?: Record<string, string | number | boolean | null | undefined>;
}): SmartCityAsset | null {
  if (!validPoint(params.lat, params.lng)) return null;
  const lat = params.lat as number;
  const lng = params.lng as number;
  return {
    id: params.id,
    sourceId: params.sourceId,
    assetType: params.assetType,
    name: params.name,
    region: params.region,
    geometry: { type: "Point", coordinates: [lng, lat] },
    attributes: compactAttributes(params.attributes ?? {}),
  };
}

function sampleRows(rows: JsonObject[], maxRows: number): JsonObject[] {
  if (rows.length <= maxRows) return rows;
  const step = Math.ceil(rows.length / maxRows);
  return rows.filter((_, index) => index % step === 0).slice(0, maxRows);
}

function mapEarthquakes(rows: JsonObject[], context: FeedContext) {
  const events = sampleRows(rows, context.maxRows)
    .map((row, index) => {
      const magnitude = numeric(row, ["magnitude", "mag"]);
      const place = text(row, ["place", "title"], "Earthquake signal");
      return pointEvent({
        id: `osiris-earthquake-${text(row, ["id"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: magnitude ? `M${magnitude.toFixed(1)} ${place}` : place,
        description: `USGS seismic event surfaced by Osiris. ${place}`,
        eventType: "weather_risk",
        severity: magnitude == null ? "low" : magnitude >= 6 ? "critical" : magnitude >= 5 ? "high" : magnitude >= 4 ? "medium" : "low",
        confidence: 0.96,
        observedAt: isoTime(row, ["time", "date", "timestamp"], context.attemptedAt),
        region: "global",
        sourceUrl: text(row, ["url"], sourceUrl(context.baseUrl, context.feed.path)),
        attributes: { osirisFeed: "earthquakes", magnitude, depth: numeric(row, ["depth"]), tsunami: numeric(row, ["tsunami"]) },
      });
    })
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets: [] };
}

function mapWeather(rows: JsonObject[], context: FeedContext) {
  const events = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointEvent({
        id: `osiris-weather-${text(row, ["id"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: text(row, ["title", "headline", "type"], "Weather risk"),
        description: text(row, ["area", "description", "type"], "Severe weather or environmental event surfaced by Osiris."),
        eventType: "weather_risk",
        severity: severityFromText(text(row, ["severity", "type", "level"])),
        confidence: 0.82,
        observedAt: isoTime(row, ["date", "effective", "sent", "timestamp"], context.attemptedAt),
        region: "global",
        sourceUrl: text(row, ["source", "url"], sourceUrl(context.baseUrl, context.feed.path)),
        attributes: { osirisFeed: "weather", provider: text(row, ["provider"]), category: text(row, ["category"]) },
      }),
    )
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets: [] };
}

function mapFires(rows: JsonObject[], context: FeedContext) {
  const events = sampleRows(rows, context.maxRows)
    .map((row, index) => {
      const frp = numeric(row, ["frp"]);
      const brightness = numeric(row, ["brightness", "bright_ti4"]);
      return pointEvent({
        id: `osiris-fire-${text(row, ["id"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: text(row, ["title", "type"], "Active fire hotspot"),
        description: "NASA FIRMS/EONET fire or volcano signal surfaced by Osiris.",
        eventType: "weather_risk",
        severity: frp != null && frp > 150 ? "high" : brightness != null && brightness > 360 ? "medium" : "low",
        confidence: 0.86,
        observedAt: isoTime(row, ["date", "timestamp"], context.attemptedAt),
        region: "global",
        sourceUrl: sourceUrl(context.baseUrl, context.feed.path),
        attributes: { osirisFeed: "fires", frp, brightness, confidence: text(row, ["confidence"]) },
      });
    })
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets: [] };
}

function mapCctv(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointAsset({
        id: `osiris-cctv-${text(row, ["id"], String(index))}`,
        sourceId: context.feed.id,
        assetType: "camera",
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["name", "title"], "Osiris CCTV camera"),
        region: text(row, ["country", "city"], "global"),
        attributes: {
          osirisFeed: "cctv",
          source: text(row, ["source"]),
          city: text(row, ["city"]),
          country: text(row, ["country"]),
          feedUrl: text(row, ["feed_url", "stream_url", "external_url"]),
        },
      }),
    )
    .filter((asset): asset is SmartCityAsset => asset !== null);

  return { events: [], assets };
}

function mapFlights(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointAsset({
        id: `osiris-air-${text(row, ["icao24", "callsign"], String(index))}`,
        sourceId: context.feed.id,
        assetType: "aircraft",
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["callsign", "registration", "model"], "Aircraft"),
        region: "global",
        attributes: {
          osirisFeed: "flights",
          category: text(row, ["category", "aircraft_category"]),
          altitudeMeters: numeric(row, ["alt"]),
          speedKnots: numeric(row, ["speed_knots"]),
          heading: numeric(row, ["heading"]),
        },
      }),
    )
    .filter((asset): asset is SmartCityAsset => asset !== null);

  const events = sampleRows(rows, Math.min(80, context.maxRows))
    .filter((row) => text(row, ["category"]) === "military")
    .map((row, index) =>
      pointEvent({
        id: `osiris-air-signal-${text(row, ["icao24", "callsign"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: `Military aircraft signal: ${text(row, ["callsign"], "unknown")}`,
        description: "Osiris classified this aircraft as a military flight. Treat as global context, not a local transport action.",
        eventType: "incident",
        severity: "medium",
        confidence: 0.68,
        observedAt: context.attemptedAt,
        region: "global",
        sourceUrl: sourceUrl(context.baseUrl, context.feed.path),
        attributes: { osirisFeed: "flights", category: text(row, ["category"]), model: text(row, ["model"]) },
      }),
    )
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets };
}

function mapMaritime(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) => {
      const risk = text(row, ["risk"]);
      const type = text(row, ["type"], "");
      const assetType: SmartCityAsset["assetType"] = risk ? "chokepoint" : type === "container" || type === "energy" || type === "naval" ? "port" : "vessel";
      return pointAsset({
        id: `osiris-sea-${text(row, ["id", "mmsi", "name"], String(index))}`,
        sourceId: context.feed.id,
        assetType,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["name", "mmsi"], assetType === "vessel" ? "Vessel" : "Maritime node"),
        region: text(row, ["country"], "global"),
        attributes: {
          osirisFeed: "maritime",
          type,
          risk,
          traffic: text(row, ["traffic"]),
          speed: numeric(row, ["speed"]),
          heading: numeric(row, ["heading"]),
        },
      });
    })
    .filter((asset): asset is SmartCityAsset => asset !== null);

  const events = rows
    .filter((row) => ["CRITICAL", "HIGH"].includes(text(row, ["risk"]).toUpperCase()))
    .slice(0, 80)
    .map((row, index) =>
      pointEvent({
        id: `osiris-maritime-risk-${text(row, ["name"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: `${text(row, ["name"], "Maritime chokepoint")} ${text(row, ["risk"], "risk")}`,
        description: text(row, ["traffic"], "Maritime flow risk surfaced by Osiris."),
        eventType: "incident",
        severity: severityFromText(text(row, ["risk"])),
        confidence: 0.74,
        observedAt: context.attemptedAt,
        region: "global",
        sourceUrl: sourceUrl(context.baseUrl, context.feed.path),
        attributes: { osirisFeed: "maritime", risk: text(row, ["risk"]), traffic: text(row, ["traffic"]) },
      }),
    )
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets };
}

function mapSatellites(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointAsset({
        id: `osiris-sat-${text(row, ["noradId", "name"], String(index))}`,
        sourceId: context.feed.id,
        assetType: "satellite",
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["name"], "Satellite"),
        region: "orbital",
        attributes: { osirisFeed: "satellites", mission: text(row, ["mission"]), altitudeKm: numeric(row, ["alt"]) },
      }),
    )
    .filter((asset): asset is SmartCityAsset => asset !== null);

  return { events: [], assets };
}

function mapIncidents(rows: JsonObject[], context: FeedContext) {
  const events = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointEvent({
        id: `osiris-incident-${context.feed.id}-${text(row, ["id"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: text(row, ["name", "title", "headline"], "Osiris incident signal"),
        description: text(row, ["description", "html"], "Open-source incident signal surfaced by Osiris."),
        eventType: "incident",
        severity: severityFromScore(numeric(row, ["risk_score", "score"])),
        confidence: 0.62,
        observedAt: isoTime(row, ["published", "pubDate", "timestamp"], context.attemptedAt),
        region: "global",
        sourceUrl: text(row, ["url", "link"], sourceUrl(context.baseUrl, context.feed.path)),
        attributes: { osirisFeed: context.feed.id, source: text(row, ["source"]), type: text(row, ["type"]) },
      }),
    )
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets: [] };
}

function mapInfrastructure(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointAsset({
        id: `osiris-infra-${text(row, ["id", "name"], String(index))}`,
        sourceId: context.feed.id,
        assetType: "infrastructure",
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["name"], "Critical infrastructure"),
        region: text(row, ["country", "city"], "global"),
        attributes: {
          osirisFeed: "infrastructure",
          status: text(row, ["status"]),
          city: text(row, ["city"]),
          country: text(row, ["country"]),
          capacityMW: numeric(row, ["capacityMW"]),
        },
      }),
    )
    .filter((asset): asset is SmartCityAsset => asset !== null);

  const events = rows
    .filter((row) => text(row, ["status"]).toLowerCase().includes("risk") || text(row, ["status"]).toLowerCase().includes("conflict"))
    .slice(0, 80)
    .map((row, index) =>
      pointEvent({
        id: `osiris-infra-risk-${text(row, ["id", "name"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: `${text(row, ["name"], "Infrastructure")} status: ${text(row, ["status"], "risk")}`,
        description: "Critical infrastructure status surfaced by Osiris.",
        eventType: "incident",
        severity: severityFromText(text(row, ["status"])),
        confidence: 0.72,
        observedAt: context.attemptedAt,
        region: "global",
        sourceUrl: sourceUrl(context.baseUrl, context.feed.path),
        attributes: { osirisFeed: "infrastructure", status: text(row, ["status"]), country: text(row, ["country"]) },
      }),
    )
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets };
}

function mapAirQuality(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointAsset({
        id: `osiris-aq-${text(row, ["id", "name"], String(index))}`,
        sourceId: context.feed.id,
        assetType: "air_quality_station",
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["name", "city"], "Air quality station"),
        region: text(row, ["country", "city"], "global"),
        attributes: {
          osirisFeed: "air-quality",
          pm25: numeric(row, ["pm25"]),
          level: text(row, ["level"]),
          city: text(row, ["city"]),
          country: text(row, ["country"]),
        },
      }),
    )
    .filter((asset): asset is SmartCityAsset => asset !== null);

  const events = rows
    .filter((row) => {
      const pm25 = numeric(row, ["pm25"]);
      return pm25 !== null && pm25 >= 35;
    })
    .slice(0, context.maxRows)
    .map((row, index) =>
      pointEvent({
        id: `osiris-aq-risk-${text(row, ["id", "name"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: `${text(row, ["name", "city"], "Air quality")} PM2.5 ${numeric(row, ["pm25"]) ?? ""}`,
        description: text(row, ["level"], "Air quality risk surfaced by Osiris."),
        eventType: "weather_risk",
        severity: severityFromText(text(row, ["level"])),
        confidence: 0.78,
        observedAt: isoTime(row, ["lastUpdated", "timestamp"], context.attemptedAt),
        region: "global",
        sourceUrl: sourceUrl(context.baseUrl, context.feed.path),
        attributes: { osirisFeed: "air-quality", pm25: numeric(row, ["pm25"]), level: text(row, ["level"]) },
      }),
    )
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets };
}

function mapLiveNews(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointAsset({
        id: `osiris-news-feed-${text(row, ["id"], String(index))}`,
        sourceId: context.feed.id,
        assetType: "news_feed",
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["name"], "Live news feed"),
        region: text(row, ["country", "city"], "global"),
        attributes: {
          osirisFeed: "live-news",
          category: text(row, ["category"]),
          language: text(row, ["language"]),
          url: text(row, ["url"]),
          embedAllowed: row.embed_allowed === true,
        },
      }),
    )
    .filter((asset): asset is SmartCityAsset => asset !== null);

  return { events: [], assets };
}

function mapTelemetryOnly() {
  return { events: [], assets: [] };
}

function collectPositions(value: JsonValue, output: Array<[number, number]>, max = 160): void {
  if (output.length >= max) return;
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    const lng = value[0];
    const lat = value[1];
    if (Number.isFinite(lat) && Number.isFinite(lng)) output.push([lat, lng]);
    return;
  }
  for (const child of value) {
    collectPositions(child as JsonValue, output, max);
    if (output.length >= max) return;
  }
}

function centroidFromGeoJson(row: JsonObject): { lat: number | null; lng: number | null } {
  const geometry = objectValue(row, "geometry");
  if (!geometry) return { lat: null, lng: null };
  const positions: Array<[number, number]> = [];
  collectPositions(geometry.coordinates, positions);
  if (positions.length === 0) return { lat: null, lng: null };
  const sum = positions.reduce(
    (acc, [lat, lng]) => {
      acc.lat += lat;
      acc.lng += lng;
      return acc;
    },
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / positions.length, lng: sum.lng / positions.length };
}

function mapFrontlines(rows: JsonObject[], context: FeedContext) {
  const events = sampleRows(rows, Math.min(100, context.maxRows))
    .map((row, index) => {
      const centroid = centroidFromGeoJson(row);
      return pointEvent({
        id: `osiris-frontline-${text(row, ["id", "properties.id"], String(index))}`,
        sourceId: context.feed.id,
        lat: centroid.lat,
        lng: centroid.lng,
        title: text(row, ["properties.name", "properties.title"], "Conflict frontline signal"),
        description: "Conflict-area geometry surfaced by Osiris. Treat as global context, not a local transport action.",
        eventType: "incident",
        severity: "high",
        confidence: 0.66,
        observedAt: context.attemptedAt,
        region: "global",
        sourceUrl: sourceUrl(context.baseUrl, context.feed.path),
        attributes: {
          osirisFeed: "frontlines",
          geometryType: text(row, ["geometry.type"]),
          source: "DeepState map via Osiris",
        },
      });
    })
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets: [] };
}

function mapSuppliers(rows: JsonObject[], context: FeedContext) {
  const assets = sampleRows(rows, context.maxRows)
    .map((row, index) =>
      pointAsset({
        id: `osiris-supplier-${text(row, ["id", "name"], String(index))}`,
        sourceId: context.feed.id,
        assetType: "infrastructure",
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        name: text(row, ["name"], "Supply-chain node"),
        region: text(row, ["country", "city"], "global"),
        attributes: {
          osirisFeed: "scm-suppliers",
          city: text(row, ["city"]),
          country: text(row, ["country"]),
          category: text(row, ["category"]),
          riskLevel: text(row, ["risk_level"]),
        },
      }),
    )
    .filter((asset): asset is SmartCityAsset => asset !== null);

  const events = rows
    .filter((row) => !["", "NORMAL", "LOW"].includes(text(row, ["risk_level"]).toUpperCase()))
    .slice(0, 80)
    .map((row, index) =>
      pointEvent({
        id: `osiris-supplier-risk-${text(row, ["id", "name"], String(index))}`,
        sourceId: context.feed.id,
        lat: numeric(row, ["lat", "latitude"]),
        lng: numeric(row, ["lng", "lon", "longitude"]),
        title: `${text(row, ["name"], "Supply-chain node")} ${text(row, ["risk_level"], "risk")}`,
        description: "Supply-chain risk surfaced by Osiris. Treat as regional context unless linked to a local asset.",
        eventType: "incident",
        severity: severityFromText(text(row, ["risk_level"])),
        confidence: 0.62,
        observedAt: context.attemptedAt,
        region: text(row, ["country", "city"], "global"),
        sourceUrl: sourceUrl(context.baseUrl, context.feed.path),
        attributes: {
          osirisFeed: "scm-suppliers",
          category: text(row, ["category"]),
          riskLevel: text(row, ["risk_level"]),
        },
      }),
    )
    .filter((event): event is SmartCityEvent => event !== null);

  return { events, assets };
}

export function buildOsirisFeeds(baseUrl: string, cctvRegion = "asia"): OsirisFeed[] {
  return [
    {
      id: "osiris-earthquakes",
      name: "OSIRIS earthquakes",
      provider: "OSIRIS / USGS",
      category: "seismic",
      path: "/api/earthquakes",
      arrays: ["earthquakes"],
      mapRows: mapEarthquakes,
    },
    {
      id: "osiris-fires",
      name: "OSIRIS fires",
      provider: "OSIRIS / NASA FIRMS/EONET",
      category: "fire",
      path: "/api/fires",
      arrays: ["fires"],
      mapRows: mapFires,
    },
    {
      id: "osiris-weather",
      name: "OSIRIS severe weather",
      provider: "OSIRIS / NASA EONET / NOAA",
      category: "weather",
      path: "/api/weather",
      arrays: ["events", "weather_events"],
      mapRows: mapWeather,
    },
    {
      id: "osiris-cctv",
      name: "OSIRIS CCTV network",
      provider: "OSIRIS / public traffic cameras",
      category: "camera",
      path: `/api/cctv?region=${encodeURIComponent(cctvRegion)}&v=2`,
      arrays: ["cameras"],
      mapRows: mapCctv,
    },
    {
      id: "osiris-maritime",
      name: "OSIRIS maritime layer",
      provider: "OSIRIS / AIS + static ports",
      category: "maritime",
      path: "/api/maritime",
      arrays: ["ports", "chokepoints", "ships"],
      mapRows: mapMaritime,
    },
    {
      id: "osiris-flights",
      name: "OSIRIS aviation layer",
      provider: "OSIRIS / ADS-B",
      category: "aviation",
      path: "/api/flights",
      arrays: ["commercial_flights", "private_flights", "private_jets", "military_flights", "gps_jamming"],
      mapRows: mapFlights,
    },
    {
      id: "osiris-satellites",
      name: "OSIRIS satellites",
      provider: "OSIRIS / SatNOGS TLE",
      category: "space",
      path: "/api/satellites",
      arrays: ["satellites"],
      mapRows: mapSatellites,
    },
    {
      id: "osiris-gdelt",
      name: "OSIRIS global incidents",
      provider: "OSIRIS / RSS + OSINT mapper",
      category: "global_incident",
      path: "/api/gdelt",
      arrays: ["events", "gdelt"],
      mapRows: mapIncidents,
    },
    {
      id: "osiris-news",
      name: "OSIRIS Telegram/RSS intel",
      provider: "OSIRIS / public Telegram previews + RSS",
      category: "news_osint",
      path: "/api/news",
      arrays: ["news"],
      mapRows: mapIncidents,
    },
    {
      id: "osiris-live-news",
      name: "OSIRIS live news feeds",
      provider: "OSIRIS / public broadcaster links",
      category: "live_news",
      path: "/api/live-news",
      arrays: ["feeds"],
      mapRows: mapLiveNews,
    },
    {
      id: "osiris-infrastructure",
      name: "OSIRIS critical infrastructure",
      provider: "OSIRIS / static infrastructure + USGS",
      category: "infrastructure",
      path: "/api/infrastructure",
      arrays: ["infrastructure"],
      mapRows: mapInfrastructure,
    },
    {
      id: "osiris-air-quality",
      name: "OSIRIS air quality",
      provider: "OSIRIS / OpenAQ",
      category: "environment",
      path: "/api/air-quality",
      arrays: ["stations"],
      mapRows: mapAirQuality,
    },
    {
      id: "osiris-country-risk",
      name: "OSIRIS country risk",
      provider: "OSIRIS / geopolitical risk",
      category: "geopolitical_risk",
      path: "/api/country-risk",
      arrays: ["countries", "exchanges"],
      mapRows: mapTelemetryOnly,
    },
    {
      id: "osiris-cyber-threats",
      name: "OSIRIS cyber threats",
      provider: "OSIRIS / CISA KEV + Shadowserver",
      category: "cyber_threat",
      path: "/api/cyber-threats",
      arrays: ["threats"],
      mapRows: mapTelemetryOnly,
    },
    {
      id: "osiris-frontlines",
      name: "OSIRIS frontlines",
      provider: "OSIRIS / DeepState map",
      category: "conflict_context",
      path: "/api/frontlines",
      arrays: ["frontlines.map.features"],
      mapRows: mapFrontlines,
    },
    {
      id: "osiris-markets",
      name: "OSIRIS markets and commodities",
      provider: "OSIRIS / Yahoo Finance + CoinGecko",
      category: "market_context",
      path: "/api/markets",
      arrays: ["__root"],
      mapRows: mapTelemetryOnly,
    },
    {
      id: "osiris-scm-suppliers",
      name: "OSIRIS supply-chain suppliers",
      provider: "OSIRIS / SCM supplier graph",
      category: "supply_chain",
      path: "/api/scm-suppliers",
      arrays: ["suppliers"],
      mapRows: mapSuppliers,
    },
    {
      id: "osiris-space-weather",
      name: "OSIRIS space weather",
      provider: "OSIRIS / NOAA SWPC",
      category: "space_weather",
      path: "/api/space-weather",
      arrays: ["alerts", "solar_flares", "__root"],
      mapRows: mapTelemetryOnly,
    },
  ].map((feed) => ({ ...feed, path: feed.path, sourceUrl: sourceUrl(baseUrl, feed.path) }));
}

function buildSource(feed: OsirisFeed, baseUrl: string): SmartCitySource {
  return {
    id: feed.id,
    name: feed.name,
    provider: feed.provider,
    category: feed.category,
    region: "global",
    sourceUrl: sourceUrl(baseUrl, feed.path),
    refreshSeconds: 300,
    dataClass: "near_real_time",
    refreshPolicy: "OSIRIS passive feed polling",
    upstreamCadence: "feed-dependent",
  };
}

function health(params: {
  feed: OsirisFeed;
  status: SourceStatus;
  attemptedAt: string;
  lastSuccessAt?: string | null;
  latencyMs?: number | null;
  recordCount?: number;
  message: string;
}): SourceHealth {
  const freshnessSeconds = params.lastSuccessAt
    ? Math.max(0, Math.round((Date.now() - new Date(params.lastSuccessAt).getTime()) / 1000))
    : null;
  return {
    sourceId: params.feed.id,
    name: params.feed.name,
    provider: params.feed.provider,
    status: params.status,
    lastAttemptAt: params.attemptedAt,
    lastSuccessAt: params.lastSuccessAt ?? null,
    latencyMs: params.latencyMs ?? null,
    recordCount: params.recordCount ?? 0,
    freshnessSeconds,
    message: params.message,
    dataClass: params.status === "stale" ? "stale" : "near_real_time",
    refreshPolicy: "OSIRIS passive feed polling",
    upstreamCadence: "feed-dependent",
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<JsonValue> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as JsonValue;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeOsirisFeedPayload(
  feed: OsirisFeed,
  payload: JsonValue,
  context: Omit<FeedContext, "feed">,
): { rows: JsonObject[]; events: SmartCityEvent[]; assets: SmartCityAsset[] } {
  const rows = asRows(payload, feed.arrays);
  const mapped = feed.mapRows(rows, { ...context, feed });
  return { rows, ...mapped };
}

async function fetchOsirisIngestion(): Promise<OsirisIngestionResult> {
  loadOpsEnv();
  const baseUrl = cleanBaseUrl(process.env.SMART_CITY_OSIRIS_BASE_URL ?? "");
  const cctvRegion = process.env.SMART_CITY_OSIRIS_CCTV_REGION?.trim() || "asia";
  const timeoutMs = Number(process.env.SMART_CITY_OSIRIS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const maxRows = Number(process.env.SMART_CITY_OSIRIS_MAX_ROWS_PER_FEED ?? DEFAULT_MAX_ROWS_PER_FEED);
  const attemptedAt = new Date().toISOString();

  if (!baseUrl) {
    const disabledFeed: OsirisFeed = {
      id: "osiris-passive-feeds",
      name: "OSIRIS passive feeds",
      provider: "OSIRIS",
      category: "global_intelligence",
      path: "/",
      arrays: [],
      mapRows: () => ({ events: [], assets: [] }),
    };
    return {
      sources: [buildSource(disabledFeed, "https://github.com/simplifaisoul/osiris")],
      sourceHealth: [
        health({
          feed: disabledFeed,
          status: "needs_config",
          attemptedAt,
          message: "Set SMART_CITY_OSIRIS_BASE_URL to ingest OSIRIS passive feeds.",
        }),
      ],
      events: [],
      assets: [],
    };
  }

  const feeds = buildOsirisFeeds(baseUrl, cctvRegion);
  const results = await Promise.all(
    feeds.map(async (feed) => {
      const started = Date.now();
      try {
        const payload = await fetchJson(sourceUrl(baseUrl, feed.path), Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);
        const normalized = normalizeOsirisFeedPayload(feed, payload, {
          baseUrl,
          attemptedAt,
          maxRows: Number.isFinite(maxRows) ? maxRows : DEFAULT_MAX_ROWS_PER_FEED,
        });
        const mappedCount = normalized.events.length + normalized.assets.length;
        return {
          source: buildSource(feed, baseUrl),
          health: health({
            feed,
            status: normalized.rows.length > 0 ? "ok" : "stale",
            attemptedAt,
            lastSuccessAt: attemptedAt,
            latencyMs: Date.now() - started,
            recordCount: normalized.rows.length,
            message:
              mappedCount > 0
                ? `OSIRIS feed connected. ${mappedCount} mapped item(s) shown from ${normalized.rows.length} upstream row(s).`
                : `OSIRIS feed responded with ${normalized.rows.length} row(s), but none had usable point geometry.`,
          }),
          events: normalized.events,
          assets: normalized.assets,
        };
      } catch (error) {
        return {
          source: buildSource(feed, baseUrl),
          health: health({
            feed,
            status: "offline",
            attemptedAt,
            latencyMs: Date.now() - started,
            message: `OSIRIS feed failed: ${error instanceof Error ? error.message : "unknown error"}`,
          }),
          events: [],
          assets: [],
        };
      }
    }),
  );

  return {
    sources: results.map((result) => result.source),
    sourceHealth: results.map((result) => result.health),
    events: results.flatMap((result) => result.events),
    assets: results.flatMap((result) => result.assets),
  };
}

export async function getOsirisIngestion(): Promise<OsirisIngestionResult> {
  loadOpsEnv();
  const ttlMs = readModelCacheTtlMs();
  const now = Date.now();
  const cached = globalForOsiris.osirisIngestionCache;
  if (cached?.value && now < cached.expiresAt) return cached.value;
  if (cached?.refreshing) return cached.refreshing;

  const refreshing = fetchOsirisIngestion()
    .then((value) => {
      globalForOsiris.osirisIngestionCache = {
        value,
        expiresAt: Date.now() + ttlMs,
      };
      return value;
    })
    .catch((error) => {
      if (cached?.value) return cached.value;
      throw error;
    });

  globalForOsiris.osirisIngestionCache = {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    refreshing,
  };
  return refreshing;
}
