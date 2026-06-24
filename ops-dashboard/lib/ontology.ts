import type {
  GeoPoint,
  OntologyObjectType,
  OntologyReadModel,
  OpsOverview,
  RailOverview,
  Severity,
  SmartCityAsset,
  SmartCityEvent,
  SmartCityHotspot,
  SmartCityInsight,
  SmartCityInsightEvidence,
  SmartCityOntologyLink,
  SmartCityOntologyObject,
  SmartCitySource,
  SourceHealth,
} from "./types";

type BuildOntologyInput = {
  overview: OpsOverview;
  railOverview?: RailOverview | null;
};

export type Bbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type InsightFilter = {
  domain?: string | null;
  bbox?: Bbox | null;
  limit?: number | null;
};

const THAILAND_BBOX: Bbox = { west: 97, south: 5, east: 106, north: 21 };
const SYNTHETIC_MARKER = /\b(mock|seed|synthetic|pilot|fallback)\b/i;

function isFinitePoint(point: GeoPoint | undefined): point is GeoPoint {
  if (!point || point.type !== "Point") return false;
  const [lng, lat] = point.coordinates;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function pointInBbox(point: GeoPoint, bbox: Bbox): boolean {
  const [lng, lat] = point.coordinates;
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

function isHttpUrl(value: string | undefined | null): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function hasSyntheticMarker(...values: Array<string | undefined | null>): boolean {
  return values.some((value) => SYNTHETIC_MARKER.test(String(value ?? "")));
}

function sourceById(sources: SmartCitySource[]): Map<string, SmartCitySource> {
  return new Map(sources.map((source) => [source.id, source]));
}

function healthBySourceId(health: SourceHealth[]): Map<string, SourceHealth> {
  return new Map(health.map((item) => [item.sourceId, item]));
}

function healthyForInsight(sourceId: string, health: Map<string, SourceHealth>): boolean {
  const item = health.get(sourceId);
  return item?.status === "ok" || item?.status === "degraded";
}

function severityRisk(severity: Severity, confidence = 0.5): number {
  const base = { critical: 94, high: 82, medium: 64, low: 44 }[severity];
  return Math.max(1, Math.min(99, Math.round(base * (0.74 + Math.max(0, Math.min(1, confidence)) * 0.26))));
}

function eventObjectId(event: SmartCityEvent): string {
  return `incident:${event.sourceId}:${event.id}`;
}

function assetObjectId(asset: SmartCityAsset): string {
  return `${asset.assetType}:${asset.sourceId}:${asset.id}`;
}

function hotspotObjectId(hotspot: SmartCityHotspot): string {
  return `hotspot:${hotspot.id}`;
}

function eventDedupeKey(event: SmartCityEvent): string {
  const [lng, lat] = event.geometry.coordinates;
  return [
    event.sourceId,
    event.id,
    event.observedAt,
    Math.round(lat * 100000) / 100000,
    Math.round(lng * 100000) / 100000,
  ].join("|");
}

function normalizeSourceUrl(sourceId: string, sourceUrl: string | undefined, sources: Map<string, SmartCitySource>): string | null {
  if (isHttpUrl(sourceUrl)) return sourceUrl;
  const source = sources.get(sourceId);
  if (isHttpUrl(source?.sourceUrl)) return source.sourceUrl;
  return null;
}

function propertiesFromRecord(record: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Record<
    string,
    string | number | boolean | null
  >;
}

function ontologyTypeForAsset(assetType: SmartCityAsset["assetType"]): OntologyObjectType | null {
  if (assetType === "rail_crossing") return "rail_crossing";
  if (assetType === "camera") return "camera";
  if (assetType === "weather_station" || assetType === "air_quality_station") return "weather_station";
  if (assetType === "road_segment" || assetType === "rail_segment") return "road_segment";
  if (assetType === "intersection") return "intersection";
  return null;
}

function eventToObject(event: SmartCityEvent, sources: Map<string, SmartCitySource>): SmartCityOntologyObject | null {
  if (!isFinitePoint(event.geometry)) return null;
  const sourceUrl = normalizeSourceUrl(event.sourceId, event.sourceUrl, sources);
  if (!sourceUrl || hasSyntheticMarker(event.id, event.sourceId, event.title, sourceUrl)) return null;

  return {
    id: eventObjectId(event),
    objectType: "incident",
    displayName: event.title,
    sourceId: event.sourceId,
    region: event.region,
    geometry: event.geometry,
    severity: event.severity,
    confidence: event.confidence,
    observedAt: event.observedAt,
    updatedAt: event.observedAt,
    sourceUrl,
    properties: propertiesFromRecord({
      eventId: event.id,
      eventType: event.eventType,
      description: event.description,
      ...event.attributes,
    }),
    provenance: [`source:${event.sourceId}`, `url:${sourceUrl}`, `observed:${event.observedAt}`],
  };
}

function assetToObject(asset: SmartCityAsset, sources: Map<string, SmartCitySource>): SmartCityOntologyObject | null {
  if (!isFinitePoint(asset.geometry)) return null;
  const objectType = ontologyTypeForAsset(asset.assetType);
  if (!objectType) return null;
  const sourceUrl = normalizeSourceUrl(asset.sourceId, undefined, sources);
  if (!sourceUrl || hasSyntheticMarker(asset.id, asset.sourceId, asset.name, sourceUrl)) return null;

  return {
    id: assetObjectId(asset),
    objectType,
    displayName: asset.name,
    sourceId: asset.sourceId,
    region: asset.region,
    geometry: asset.geometry,
    updatedAt: new Date(0).toISOString(),
    sourceUrl,
    properties: propertiesFromRecord({
      assetId: asset.id,
      assetType: asset.assetType,
      ...asset.attributes,
    }),
    provenance: [`source:${asset.sourceId}`, `url:${sourceUrl}`],
  };
}

function hotspotToObject(hotspot: SmartCityHotspot, sources: Map<string, SmartCitySource>): SmartCityOntologyObject | null {
  if (!isFinitePoint(hotspot.geometry)) return null;
  const liveSource = hotspot.evidence.find((item) => item.kind === "live" && item.label.toLowerCase().includes("source"))?.value;
  const sourceId = liveSource && sources.has(liveSource) ? liveSource : "derived-hotspot";
  const sourceUrl = normalizeSourceUrl(sourceId, undefined, sources);
  if (!sourceUrl || hasSyntheticMarker(hotspot.id, hotspot.name, sourceUrl)) return null;

  return {
    id: hotspotObjectId(hotspot),
    objectType: "hotspot",
    displayName: hotspot.name,
    sourceId,
    region: hotspot.region,
    geometry: hotspot.geometry,
    severity: hotspot.severity,
    confidence: hotspot.confidence,
    observedAt: hotspot.updatedAt,
    updatedAt: hotspot.updatedAt,
    sourceUrl,
    properties: {
      hotspotId: hotspot.id,
      corridor: hotspot.corridor,
      riskScore: hotspot.riskScore,
      trend: hotspot.trend,
      recommendedAction: hotspot.recommendedAction,
    },
    provenance: [`source:${sourceId}`, `url:${sourceUrl}`, `derived:smart_city_hotspot`],
  };
}

function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const [lng1, lat1] = a.coordinates;
  const [lng2, lat2] = b.coordinates;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function gridKey(point: GeoPoint): string {
  const [lng, lat] = point.coordinates;
  return `${Math.floor(lat / 0.02)}:${Math.floor(lng / 0.02)}`;
}

function neighborGridKeys(point: GeoPoint): string[] {
  const [lng, lat] = point.coordinates;
  const baseLat = Math.floor(lat / 0.02);
  const baseLng = Math.floor(lng / 0.02);
  const keys: string[] = [];
  for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
    for (let lngOffset = -1; lngOffset <= 1; lngOffset += 1) {
      keys.push(`${baseLat + latOffset}:${baseLng + lngOffset}`);
    }
  }
  return keys;
}

function proximityLinks(objects: SmartCityOntologyObject[]): SmartCityOntologyLink[] {
  const links: SmartCityOntologyLink[] = [];
  const assetBuckets = new Map<string, SmartCityOntologyObject[]>();
  const events = objects.filter((object) => object.objectType === "incident");

  for (const object of objects) {
    if (!["rail_crossing", "road_segment", "intersection", "camera", "weather_station"].includes(object.objectType)) continue;
    const key = gridKey(object.geometry);
    const bucket = assetBuckets.get(key) ?? [];
    bucket.push(object);
    assetBuckets.set(key, bucket);
  }

  for (const event of events) {
    for (const key of neighborGridKeys(event.geometry)) {
      const nearbyAssets = assetBuckets.get(key) ?? [];
      for (const asset of nearbyAssets) {
        const meters = Math.round(distanceMeters(event.geometry, asset.geometry));
        if (meters > 750) continue;
        links.push({
          id: `incident_near_asset:${event.id}:${asset.id}`,
          linkType: "incident_near_asset",
          fromObjectId: event.id,
          toObjectId: asset.id,
          confidence: meters <= 250 ? 0.86 : meters <= 500 ? 0.72 : 0.58,
          distanceMeters: meters,
          reason: `${event.displayName} is within ${meters}m of ${asset.displayName}.`,
        });
      }
    }
  }

  const cameras = objects.filter((object) => object.objectType === "camera");
  const crossings = objects.filter((object) => object.objectType === "rail_crossing");
  if (cameras.length === 0 || crossings.length === 0) return links;

  const cameraBuckets = new Map<string, SmartCityOntologyObject[]>();
  for (const camera of cameras) {
    const key = gridKey(camera.geometry);
    const bucket = cameraBuckets.get(key) ?? [];
    bucket.push(camera);
    cameraBuckets.set(key, bucket);
  }

  for (const crossing of crossings) {
    for (const key of neighborGridKeys(crossing.geometry)) {
      const nearbyCameras = cameraBuckets.get(key) ?? [];
      for (const camera of nearbyCameras) {
        const meters = Math.round(distanceMeters(crossing.geometry, camera.geometry));
        if (meters > 500) continue;
        links.push({
          id: `camera_observes_crossing:${camera.id}:${crossing.id}`,
          linkType: "camera_observes_crossing",
          fromObjectId: camera.id,
          toObjectId: crossing.id,
          confidence: meters <= 200 ? 0.78 : 0.62,
          distanceMeters: meters,
          reason: `${camera.displayName} is close enough to verify ${crossing.displayName}.`,
        });
      }
    }
  }

  return links;
}

function hotspotLinks(hotspots: SmartCityHotspot[], events: SmartCityEvent[], objectIds: Set<string>): SmartCityOntologyLink[] {
  const links: SmartCityOntologyLink[] = [];
  const eventById = new Map(events.map((event) => [event.id, event]));

  for (const hotspot of hotspots) {
    const hotspotObject = hotspotObjectId(hotspot);
    if (!objectIds.has(hotspotObject)) continue;

    const directEventId = hotspot.id.startsWith("hotspot-real-") ? hotspot.id.replace("hotspot-real-", "") : null;
    const event = directEventId ? eventById.get(directEventId) : null;
    if (!event) continue;
    const incidentObject = eventObjectId(event);
    if (!objectIds.has(incidentObject)) continue;
    links.push({
      id: `hotspot_contains_event:${hotspotObject}:${incidentObject}`,
      linkType: "hotspot_contains_event",
      fromObjectId: hotspotObject,
      toObjectId: incidentObject,
      confidence: 0.9,
      reason: "Hotspot is derived from this live event row.",
    });
  }

  return links;
}

function uniqueEvents(events: SmartCityEvent[]): SmartCityEvent[] {
  const seen = new Set<string>();
  const output: SmartCityEvent[] = [];
  for (const event of events) {
    if (!isFinitePoint(event.geometry)) continue;
    const key = eventDedupeKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
}

function uniqueObjects(objects: Array<SmartCityOntologyObject | null>): SmartCityOntologyObject[] {
  const byId = new Map<string, SmartCityOntologyObject>();
  for (const object of objects) {
    if (!object) continue;
    if (byId.has(object.id)) continue;
    byId.set(object.id, object);
  }
  return [...byId.values()];
}

function railCrossingObjectIdsForCase(railOverview: RailOverview | null | undefined, caseId: string): string[] {
  const railCase = railOverview?.cases.find((item) => `hotspot:${item.id}` === caseId || item.id === caseId);
  if (!railCase) return [];
  const crossing = railOverview?.crossings.find((asset) => asset.id === railCase.crossingAssetId);
  return crossing ? [assetObjectId(crossing)] : [];
}

export function buildOntologyReadModel({ overview, railOverview }: BuildOntologyInput): OntologyReadModel {
  const generatedAt = new Date().toISOString();
  const sources = [...overview.sources, ...(railOverview?.sources ?? [])];
  const health = [...overview.sourceHealth, ...(railOverview?.sourceHealth ?? [])];
  const sourcesMap = sourceById(sources);
  const events = uniqueEvents([...overview.events, ...(railOverview?.events ?? [])]);
  const assets = [...overview.assets, ...(railOverview?.crossings ?? [])];

  const objects = uniqueObjects([
    ...events.map((event) => eventToObject(event, sourcesMap)),
    ...assets.map((asset) => assetToObject(asset, sourcesMap)),
    ...overview.hotspots.map((hotspot) => hotspotToObject(hotspot, sourcesMap)),
    ...(railOverview?.cases ?? []).map((railCase) => {
      const sourceEvent = events.find((event) => railCase.relatedEventIds.includes(event.id));
      const crossing = railOverview?.crossings.find((asset) => asset.id === railCase.crossingAssetId);
      const crossingSourceUrl = crossing ? normalizeSourceUrl(crossing.sourceId, String(crossing.attributes.sourceUrl ?? ""), sourcesMap) : null;
      const sourceUrl = sourceEvent ? normalizeSourceUrl(sourceEvent.sourceId, sourceEvent.sourceUrl, sourcesMap) : crossingSourceUrl;
      if (!sourceUrl || !isFinitePoint(railCase.geometry) || hasSyntheticMarker(railCase.id, railCase.name, sourceUrl)) return null;
      const sourceId = sourceEvent?.sourceId ?? crossing?.sourceId ?? "rail-derived-case";
      return {
        id: `hotspot:${railCase.id}`,
        objectType: "hotspot" as const,
        displayName: railCase.name,
        sourceId,
        region: railCase.corridor,
        geometry: railCase.geometry,
        severity: railCase.severity,
        confidence: railCase.confidence,
        observedAt: railCase.updatedAt,
        updatedAt: railCase.updatedAt,
        sourceUrl,
        properties: {
          hotspotId: railCase.id,
          corridor: railCase.corridor,
          riskScore: railCase.riskScore,
          recommendedAction: railCase.recommendedAction,
          crossingAssetId: railCase.crossingAssetId,
        },
        provenance: [`source:${sourceId}`, `url:${sourceUrl}`, "derived:rail_safety_case"],
      };
    }),
  ]);

  const objectIds = new Set(objects.map((object) => object.id));
  const links = [
    ...hotspotLinks(overview.hotspots, events, objectIds),
    ...proximityLinks(objects),
    ...(railOverview?.cases ?? []).flatMap((railCase) => {
      const hotspotId = `hotspot:${railCase.id}`;
      if (!objectIds.has(hotspotId)) return [];
      const railCrossings = railCrossingObjectIdsForCase(railOverview, railCase.id).filter((id) => objectIds.has(id));
      const incidentIds = railCase.relatedEventIds.map((id) => events.find((event) => event.id === id)).filter(Boolean) as SmartCityEvent[];
      return [
        ...railCrossings.map<SmartCityOntologyLink>((crossingId) => ({
          id: `hotspot_contains_event:${hotspotId}:${crossingId}`,
          linkType: "hotspot_contains_event",
          fromObjectId: hotspotId,
          toObjectId: crossingId,
          confidence: 0.78,
          reason: "Rail safety hotspot references this crossing asset.",
        })),
        ...incidentIds.map<SmartCityOntologyLink>((event) => ({
          id: `hotspot_contains_event:${hotspotId}:${eventObjectId(event)}`,
          linkType: "hotspot_contains_event",
          fromObjectId: hotspotId,
          toObjectId: eventObjectId(event),
          confidence: 0.88,
          reason: "Rail safety hotspot is derived from this real rail signal.",
        })),
      ];
    }),
  ];

  return {
    generatedAt,
    viewport: overview.viewport,
    objects,
    links: uniqueLinks(links),
    sources,
    sourceHealth: health,
  };
}

function uniqueLinks(links: SmartCityOntologyLink[]): SmartCityOntologyLink[] {
  const byId = new Map<string, SmartCityOntologyLink>();
  for (const link of links) {
    if (!byId.has(link.id)) byId.set(link.id, link);
  }
  return [...byId.values()];
}

export function parseBbox(value: string | null | undefined): Bbox | null {
  if (!value) return null;
  const parts = value.split(",").map((item) => Number(item.trim()));
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item))) return null;
  const [west, south, east, north] = parts;
  if (west > east || south > north || south < -90 || north > 90 || west < -180 || east > 180) return null;
  return { west, south, east, north };
}

export function filterOntologyReadModel(
  model: OntologyReadModel,
  filters: { type?: string | null; bbox?: Bbox | null; updatedSince?: string | null },
): OntologyReadModel {
  const updatedSinceTime = filters.updatedSince ? new Date(filters.updatedSince).getTime() : null;
  const filteredObjects = model.objects.filter((object) => {
    if (filters.type && object.objectType !== filters.type) return false;
    if (filters.bbox && !pointInBbox(object.geometry, filters.bbox)) return false;
    if (updatedSinceTime && new Date(object.updatedAt).getTime() < updatedSinceTime) return false;
    return true;
  });
  const objectIds = new Set(filteredObjects.map((object) => object.id));
  return {
    ...model,
    objects: filteredObjects,
    links: model.links.filter((link) => objectIds.has(link.fromObjectId) || objectIds.has(link.toObjectId)),
  };
}

function evidenceForObject(object: SmartCityOntologyObject, linkedObjects: SmartCityOntologyObject[]): SmartCityInsightEvidence[] {
  const evidence: SmartCityInsightEvidence[] = [
    {
      id: `live:${object.id}`,
      kind: "live_data",
      label: object.objectType.replaceAll("_", " "),
      value: object.displayName,
      objectId: object.id,
      sourceUrl: object.sourceUrl,
    },
  ];

  const incidentCount = linkedObjects.filter((item) => item.objectType === "incident").length;
  const cameraCount = linkedObjects.filter((item) => item.objectType === "camera").length;
  const assetCount = linkedObjects.filter((item) => item.objectType !== "incident" && item.objectType !== "hotspot").length;

  if (incidentCount > 0) {
    evidence.push({
      id: `baseline:${object.id}:incident-proximity`,
      kind: "historical_baseline",
      label: "Linked incident proximity",
      value: `${incidentCount} real incident object(s) linked within the local threshold.`,
      objectId: object.id,
    });
  }
  if (assetCount > 0 || cameraCount > 0) {
    evidence.push({
      id: `inference:${object.id}:verification-path`,
      kind: "inference",
      label: "Verification path",
      value: cameraCount > 0 ? `${cameraCount} nearby camera object(s) can support verification.` : `${assetCount} nearby asset object(s) need field verification.`,
      objectId: object.id,
    });
  }

  return evidence;
}

function buildLinkedObjectIndex(
  objectsById: Map<string, SmartCityOntologyObject>,
  links: SmartCityOntologyLink[],
): Map<string, SmartCityOntologyObject[]> {
  const index = new Map<string, SmartCityOntologyObject[]>();
  for (const link of links) {
    const from = objectsById.get(link.fromObjectId);
    const to = objectsById.get(link.toObjectId);
    if (from && to) {
      const fromLinks = index.get(from.id) ?? [];
      fromLinks.push(to);
      index.set(from.id, fromLinks);

      const toLinks = index.get(to.id) ?? [];
      toLinks.push(from);
      index.set(to.id, toLinks);
    }
  }
  return index;
}

function recommendedActionFor(object: SmartCityOntologyObject, linked: SmartCityOntologyObject[]): string {
  if (object.objectType === "rail_crossing" || linked.some((item) => item.objectType === "rail_crossing")) {
    return "Ask CivilMCP for cited evidence, then record camera verification and signal/barrier audit only when the evidence supports it.";
  }
  if (linked.some((item) => item.objectType === "camera")) {
    return "Verify live camera state, confirm queue spillback or conflict mechanism, then record an ops action if evidence supports it.";
  }
  return "Ask CivilMCP and collect cited evidence before any reversible ops action is recorded.";
}

function nextStepFor(object: SmartCityOntologyObject, linked: SmartCityOntologyObject[]): string {
  if (linked.some((item) => item.objectType === "camera")) return "Open the nearest camera or CCTV source and capture current state.";
  if (object.objectType === "rail_crossing" || linked.some((item) => item.objectType === "rail_crossing")) {
    return "Verify crossing geometry, gate/signal status, and queue spillback with an operator before authorizing action.";
  }
  return "Confirm the real source row, then ask CivilMCP for intervention evidence.";
}

export function buildActionableInsights(model: OntologyReadModel, filters: InsightFilter = {}): SmartCityInsight[] {
  if (filters.domain && filters.domain !== "transport") return [];
  const limit = Math.max(0, Math.min(filters.limit ?? 50, 200));
  if (limit === 0) return [];
  const health = healthBySourceId(model.sourceHealth);
  const objectsById = new Map(model.objects.map((object) => [object.id, object]));
  const linkedObjectIndex = buildLinkedObjectIndex(objectsById, model.links);
  const candidates: Array<{
    object: SmartCityOntologyObject;
    linkedRealObjects: SmartCityOntologyObject[];
    severity: Severity;
    riskBefore: number;
  }> = [];

  for (const object of model.objects) {
    if (filters.bbox && !pointInBbox(object.geometry, filters.bbox)) continue;
    if (!pointInBbox(object.geometry, THAILAND_BBOX) && !/thai|bangkok|srt|กรุงเทพ|ไทย/i.test(object.region)) continue;
    if (!healthyForInsight(object.sourceId, health)) continue;
    if (!isHttpUrl(object.sourceUrl) || object.provenance.length === 0) continue;
    if (!["incident", "hotspot", "rail_crossing", "intersection"].includes(object.objectType)) continue;
    const linked = linkedObjectIndex.get(object.id) ?? [];
    const linkedRealObjects = linked.filter((item) => isHttpUrl(item.sourceUrl) && item.provenance.length > 0);
    const severity = object.severity ?? (linkedRealObjects.find((item) => item.severity)?.severity as Severity | undefined) ?? "medium";
    const riskBefore = Number(object.properties.riskScore ?? severityRisk(severity, object.confidence ?? 0.55));
    candidates.push({
      object,
      linkedRealObjects,
      severity,
      riskBefore: Math.max(1, Math.min(99, Math.round(riskBefore))),
    });
  }

  const insights: SmartCityInsight[] = [];
  const selectedCandidates = candidates
    .sort((a, b) => b.riskBefore - a.riskBefore || (b.object.confidence ?? 0.58) - (a.object.confidence ?? 0.58))
    .slice(0, limit);

  for (const { object, linkedRealObjects, severity, riskBefore: boundedRiskBefore } of selectedCandidates) {
    const evidence = evidenceForObject(object, linkedRealObjects);
    const evidenceIds = evidence.map((item) => item.id);
    if (evidenceIds.length === 0) continue;

    const sourceObjectIds = [object.id, ...linkedRealObjects.slice(0, 6).map((item) => item.id)];

    insights.push({
      id: `insight:${object.id}`,
      domain: "transport",
      objectId: object.id,
      objectType: object.objectType,
      title: `${object.displayName}`,
      whyNow:
        object.objectType === "hotspot"
          ? "This object is a current derived hotspot from real transport signals and needs evidence-gated action."
          : "A real transport object has live provenance and linked operational context requiring verification.",
      evidence,
      recommendedAction: recommendedActionFor(object, linkedRealObjects),
      nextVerificationStep: nextStepFor(object, linkedRealObjects),
      severity,
      confidence: Math.max(0.3, Math.min(0.95, object.confidence ?? 0.58)),
      riskBefore: boundedRiskBefore,
      expectedRiskAfter: boundedRiskBefore,
      delta: 0,
      sourceObjectIds,
      evidenceIds,
      caveat: "Expected risk delta remains 0 until CivilMCP returns cited evidence; any reduction is a simulation, not a measured field outcome.",
      requiresResearch: true,
      generatedAt: model.generatedAt,
    });
  }

  return insights;
}
