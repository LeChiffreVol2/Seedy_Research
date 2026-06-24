import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildActionableInsights, buildOntologyReadModel } from "../lib/ontology";
import type { OpsOverview, RailOverview, SmartCityAsset, SmartCityEvent, SourceHealth } from "../lib/types";

const generatedAt = "2026-05-30T00:00:00.000Z";

function health(sourceId: string, status: SourceHealth["status"] = "ok"): SourceHealth {
  return {
    sourceId,
    name: sourceId,
    provider: "Real source provider",
    status,
    lastSuccessAt: status === "ok" || status === "degraded" ? generatedAt : null,
    lastAttemptAt: generatedAt,
    latencyMs: 12,
    recordCount: 1,
    freshnessSeconds: 10,
    message: "fixture",
  };
}

function event(overrides: Partial<SmartCityEvent> = {}): SmartCityEvent {
  return {
    id: "incident-1",
    sourceId: "real-traffic",
    eventType: "incident",
    severity: "high",
    confidence: 0.82,
    observedAt: generatedAt,
    region: "bangkok",
    geometry: { type: "Point", coordinates: [100.5567, 13.7559] },
    title: "Bangkok transport incident",
    description: "Real-source traffic safety signal.",
    sourceUrl: "https://example.test/incident-1",
    attributes: {},
    ...overrides,
  };
}

function asset(overrides: Partial<SmartCityAsset> = {}): SmartCityAsset {
  return {
    id: "crossing-1",
    sourceId: "real-assets",
    assetType: "rail_crossing",
    name: "Asok-Din Daeng crossing",
    region: "bangkok-srt",
    geometry: { type: "Point", coordinates: [100.557, 13.756] },
    attributes: {},
    ...overrides,
  };
}

function overview(params: {
  events?: SmartCityEvent[];
  assets?: SmartCityAsset[];
  sourceHealth?: SourceHealth[];
  sourceIds?: string[];
} = {}): OpsOverview {
  const sourceIds = params.sourceIds ?? ["real-traffic", "real-assets"];
  return {
    generatedAt,
    region: "Thailand real-data-only",
    viewport: { center: [100.548, 13.7563], zoom: 11 },
    sources: sourceIds.map((sourceId) => ({
      id: sourceId,
      name: sourceId,
      provider: "Real source provider",
      category: "transport",
      region: "thailand",
      sourceUrl: `https://example.test/${sourceId}`,
      refreshSeconds: 300,
    })),
    sourceHealth: params.sourceHealth ?? sourceIds.map((sourceId) => health(sourceId)),
    events: params.events ?? [event()],
    assets: params.assets ?? [],
    hotspots: [],
    timeline: [],
  };
}

function emptyRailOverview(): RailOverview {
  return {
    generatedAt,
    region: "Thailand SRT level crossings real-data-only",
    sources: [],
    sourceHealth: [],
    crossings: [],
    events: [],
    cases: [],
    simulations: [],
  };
}

test("missing coordinates never become ontology objects", () => {
  const badGeometry = { ...event(), id: "bad-geometry", geometry: undefined } as unknown as SmartCityEvent;
  const model = buildOntologyReadModel({ overview: overview({ events: [badGeometry] }), railOverview: emptyRailOverview() });
  assert.equal(model.objects.some((object) => object.id.includes("bad-geometry")), false);
});

test("stale or offline source does not create actionable insight", () => {
  const model = buildOntologyReadModel({
    overview: overview({ sourceHealth: [health("real-traffic", "stale"), health("real-assets", "ok")] }),
    railOverview: emptyRailOverview(),
  });
  const insights = buildActionableInsights(model);
  assert.equal(insights.length, 0);
});

test("duplicate incident rows dedupe by source, id, time, and location", () => {
  const duplicate = event();
  const model = buildOntologyReadModel({ overview: overview({ events: [event(), duplicate] }), railOverview: emptyRailOverview() });
  assert.equal(model.objects.filter((object) => object.objectType === "incident").length, 1);
});

test("rail crossing and incident link only inside proximity threshold", () => {
  const near = asset({ id: "crossing-near", geometry: { type: "Point", coordinates: [100.557, 13.756] } });
  const far = asset({ id: "crossing-far", geometry: { type: "Point", coordinates: [101.557, 14.756] } });
  const model = buildOntologyReadModel({
    overview: overview({ events: [event()], assets: [near, far] }),
    railOverview: emptyRailOverview(),
  });
  const links = model.links.filter((link) => link.linkType === "incident_near_asset");
  assert.equal(links.length, 1);
  assert.equal(links[0].toObjectId.includes("crossing-near"), true);
});

test("no real source provenance means no actionable insight", () => {
  const sourceMissing = event({ sourceId: "unregistered-source", sourceUrl: "" });
  const model = buildOntologyReadModel({
    overview: overview({ events: [sourceMissing], sourceIds: ["real-assets"] }),
    railOverview: emptyRailOverview(),
  });
  assert.equal(model.objects.length, 0);
  assert.equal(buildActionableInsights(model).length, 0);
});

test("expected risk delta remains zero before CivilMCP evidence", () => {
  const model = buildOntologyReadModel({ overview: overview({ events: [event()] }), railOverview: emptyRailOverview() });
  const [insight] = buildActionableInsights(model);
  assert.ok(insight);
  assert.equal(insight.riskBefore, insight.expectedRiskAfter);
  assert.equal(insight.delta, 0);
  assert.equal(insight.requiresResearch, true);
});

test("insights build under 300ms locally with 10k real-source objects", () => {
  const events = Array.from({ length: 10_000 }, (_, index) =>
    event({
      id: `incident-${index}`,
      geometry: { type: "Point", coordinates: [100.3 + (index % 100) * 0.001, 13.5 + Math.floor(index / 100) * 0.001] },
      title: `Bangkok transport incident ${index}`,
      sourceUrl: `https://example.test/incidents/${index}`,
    }),
  );
  const model = buildOntologyReadModel({ overview: overview({ events }), railOverview: emptyRailOverview() });
  const started = performance.now();
  const insights = buildActionableInsights(model, { limit: 50 });
  const elapsed = performance.now() - started;
  assert.equal(insights.length, 50);
  assert.ok(elapsed < 300, `expected p95-style local insight build under 300ms, got ${elapsed.toFixed(1)}ms`);
});

