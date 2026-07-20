import assert from "node:assert/strict";
import test from "node:test";

import { buildOsirisFeeds, normalizeOsirisFeedPayload } from "../lib/osiris-adapters";

test("normalizeOsirisFeedPayload maps Osiris earthquakes into smart-city events", () => {
  const feed = buildOsirisFeeds("https://osiris.example").find((item) => item.id === "osiris-earthquakes");
  assert.ok(feed);

  const normalized = normalizeOsirisFeedPayload(
    feed,
    {
      earthquakes: [
        {
          id: "eq-1",
          lat: 16.38,
          lng: 119.22,
          magnitude: 4.6,
          place: "Philippines",
          time: 1780150869256,
          url: "https://earthquake.example/eq-1",
        },
        { id: "bad", lat: 120, lng: 200, magnitude: 7.1 },
      ],
    },
    {
      baseUrl: "https://osiris.example",
      attemptedAt: "2026-05-30T00:00:00.000Z",
      maxRows: 50,
    },
  );

  assert.equal(normalized.rows.length, 2);
  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.events[0].sourceId, "osiris-earthquakes");
  assert.equal(normalized.events[0].eventType, "weather_risk");
  assert.deepEqual(normalized.events[0].geometry.coordinates, [119.22, 16.38]);
});

test("normalizeOsirisFeedPayload maps Osiris CCTV into smart-city assets", () => {
  const feed = buildOsirisFeeds("https://osiris.example", "asia").find((item) => item.id === "osiris-cctv");
  assert.ok(feed);

  const normalized = normalizeOsirisFeedPayload(
    feed,
    {
      cameras: [
        {
          id: "sin-1001",
          lat: 1.2953,
          lng: 103.8711,
          name: "Camera 1001",
          city: "Singapore",
          country: "Singapore",
          feed_url: "https://images.example/camera.jpg",
          source: "LTA Singapore",
        },
      ],
    },
    {
      baseUrl: "https://osiris.example",
      attemptedAt: "2026-05-30T00:00:00.000Z",
      maxRows: 50,
    },
  );

  assert.equal(normalized.events.length, 0);
  assert.equal(normalized.assets.length, 1);
  assert.equal(normalized.assets[0].assetType, "camera");
  assert.equal(normalized.assets[0].attributes.source, "LTA Singapore");
});

test("normalizeOsirisFeedPayload monitors non-geospatial Osiris capability feeds without fake markers", () => {
  const feed = buildOsirisFeeds("https://osiris.example").find((item) => item.id === "osiris-cyber-threats");
  assert.ok(feed);

  const normalized = normalizeOsirisFeedPayload(
    feed,
    {
      threats: [
        {
          id: "CVE-2026-0257",
          name: "PAN-OS Authentication Bypass Vulnerability",
          severity: "CRITICAL",
          source: "CISA KEV",
        },
      ],
    },
    {
      baseUrl: "https://osiris.example",
      attemptedAt: "2026-05-30T00:00:00.000Z",
      maxRows: 50,
    },
  );

  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.events.length, 0);
  assert.equal(normalized.assets.length, 0);
});

test("normalizeOsirisFeedPayload maps Osiris frontline GeoJSON to real geometry context", () => {
  const feed = buildOsirisFeeds("https://osiris.example").find((item) => item.id === "osiris-frontlines");
  assert.ok(feed);

  const normalized = normalizeOsirisFeedPayload(
    feed,
    {
      frontlines: {
        map: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { id: "front-1", name: "Frontline segment" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [37.8, 48.7, 0],
                    [37.9, 48.7, 0],
                    [37.9, 48.8, 0],
                    [37.8, 48.7, 0],
                  ],
                ],
              },
            },
          ],
        },
      },
    },
    {
      baseUrl: "https://osiris.example",
      attemptedAt: "2026-05-30T00:00:00.000Z",
      maxRows: 50,
    },
  );

  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.events[0].sourceId, "osiris-frontlines");
  assert.equal(normalized.events[0].attributes.geometryType, "Polygon");
  assert.ok(normalized.events[0].geometry.coordinates[0] > 37.8);
  assert.ok(normalized.events[0].geometry.coordinates[1] > 48.7);
});
