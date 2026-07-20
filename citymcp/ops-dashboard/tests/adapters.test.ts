import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceHealth, isFiniteCoordinate, normalizeEventRows, normalizeSeverity } from "../lib/source-adapters";

test("normalizeEventRows drops rows with invalid geometry", () => {
  const events = normalizeEventRows(
    [
      { id: "ok", lat: 13.7563, lng: 100.5018, title: "Valid event", severity: "high" },
      { id: "bad-lat", lat: 113.7563, lng: 100.5018, title: "Invalid event" },
      { id: "bad-lng", lat: 13.7563, lng: 200.5018, title: "Invalid event" },
    ],
    "test-source",
    "https://example.test/source",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "ok");
  assert.deepEqual(events[0].geometry.coordinates, [100.5018, 13.7563]);
});

test("normalizeSeverity handles upstream vocabulary safely", () => {
  assert.equal(normalizeSeverity("severe"), "critical");
  assert.equal(normalizeSeverity("major"), "high");
  assert.equal(normalizeSeverity("warning"), "medium");
  assert.equal(normalizeSeverity("unknown"), "low");
});

test("normalizeEventRows maps real iTIC Longdo event fields", () => {
  const [event] = normalizeEventRows(
    [
      {
        eid: "954383",
        title: "ระวังถุงกระสอบขนาดใหญ่ ถนนกาญจนาภิเษก",
        title_en: "Warning at Kanchana Phisek Rd.",
        description_en: "Caution! fallen objects on inbound Kanchana Phisek Rd.",
        latitude: "13.73750914725",
        longitude: "100.70318207145",
        type: "12",
        icon: "warning",
        start: "2026-05-31 08:09:09",
        stop: "2026-05-31 09:09:09",
        contributor: "itic",
        showlevel: 16,
      },
    ],
    "itic-live-events",
    "https://event.longdo.com/feed/json",
  );

  assert.equal(event.id, "954383");
  assert.equal(event.sourceId, "itic-live-events");
  assert.equal(event.eventType, "incident");
  assert.equal(event.severity, "medium");
  assert.equal(event.title, "Warning at Kanchana Phisek Rd.");
  assert.deepEqual(event.geometry.coordinates, [100.70318207145, 13.73750914725]);
  assert.equal(event.observedAt, "2026-05-31T01:09:09.000Z");
  assert.equal(event.expiresAt, "2026-05-31T02:09:09.000Z");
  assert.equal(event.sourceUrl, "https://event.longdo.com/feed/json");
  assert.equal(event.attributes.upstreamIcon, "warning");
});

test("isFiniteCoordinate validates latitude and longitude ranges", () => {
  assert.equal(isFiniteCoordinate(13.7, 100.5), true);
  assert.equal(isFiniteCoordinate(-91, 100.5), false);
  assert.equal(isFiniteCoordinate(13.7, 181), false);
  assert.equal(isFiniteCoordinate(Number.NaN, 100.5), false);
});

test("buildSourceHealth records needs_config without success time", () => {
  const attemptedAt = new Date().toISOString();
  const health = buildSourceHealth({
    sourceId: "data-goth-traffic",
    name: "Data.go.th traffic",
    provider: "Open Government Data of Thailand",
    status: "needs_config",
    attemptedAt,
    message: "No API key configured.",
  });

  assert.equal(health.status, "needs_config");
  assert.equal(health.lastSuccessAt, null);
  assert.equal(health.recordCount, 0);
});
