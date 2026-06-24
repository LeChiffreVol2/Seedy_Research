import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRailCasesFromRealData,
  isThaiRailSignalText,
  normalizeDrtAccidentRows,
  normalizeDrtCrossingRows,
  normalizeRailNewsRows,
  normalizeSrtTtsIncidentReport,
  simulateRailImprovement,
} from "../lib/rail-adapters";

test("isThaiRailSignalText rejects generic station false positives outside Thailand", () => {
  assert.equal(isThaiRailSignalText("M3.7 219 km SE of Attu Station, Alaska"), false);
  assert.equal(isThaiRailSignalText("Bangkok train collision at Asok-Din Daeng level crossing"), true);
  assert.equal(isThaiRailSignalText("ข่าวรถไฟชนรถบัสบริเวณอโศก-ดินแดง"), true);
});

test("normalizeRailNewsRows drops Thai rail rows without usable geometry", () => {
  const events = normalizeRailNewsRows(
    [
      {
        id: "with-geometry",
        title: "Bangkok train collision at Asok-Din Daeng level crossing",
        lat: 13.7559,
        lng: 100.5567,
        link: "https://example.test/rail",
      },
      {
        id: "needs-geocode",
        title: "Bangkok train disruption near SRT crossing",
        link: "https://example.test/rail-no-point",
      },
    ],
    "test-rail-news",
    "https://example.test/feed",
    "2026-05-30T00:00:00.000Z",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "with-geometry");
  assert.equal(events[0].eventType, "rail_crossing_incident");
});

test("simulateRailImprovement only reduces expected risk when evidence exists", () => {
  const withEvidence = simulateRailImprovement({
    proposalId: "signal-audit",
    beforeRisk: 86,
    intervention: "signal_audit",
    evidenceCount: 5,
    basis: ["CivilMCP citation"],
  });
  const withoutEvidence = simulateRailImprovement({
    proposalId: "signal-audit",
    beforeRisk: 86,
    intervention: "signal_audit",
    evidenceCount: 0,
    basis: [],
  });

  assert.equal(withEvidence.beforeRisk > withEvidence.afterExpectedRisk, true);
  assert.equal(withoutEvidence.beforeRisk, withoutEvidence.afterExpectedRisk);
  assert.equal(withoutEvidence.confidence < withEvidence.confidence, true);
});

test("buildRailCasesFromRealData derives cases only from real geocoded events", () => {
  const events = normalizeRailNewsRows(
    [
      {
        id: "real-rail-event",
        title: "Bangkok train collision at SRT level crossing",
        lat: 13.7559,
        lng: 100.5567,
        link: "https://example.test/real-rail-event",
      },
    ],
    "real-feed",
    "https://example.test/feed",
    "2026-05-30T00:00:00.000Z",
  );
  const cases = buildRailCasesFromRealData([], events);

  assert.equal(cases.length, 1);
  assert.equal(cases[0].relatedEventIds[0], "real-rail-event");
  assert.equal(cases[0].simulationSummary.beforeRisk > cases[0].simulationSummary.afterExpectedRisk, true);
  assert.equal(cases[0].simulationSummary.evidenceBasis[0], "https://example.test/real-rail-event");
});

test("normalizeDrtCrossingRows maps official DRT CSV rows into rail crossings", () => {
  const plan = new Map([
    [
      "11-0002+170.3",
      {
        Survey_No: "11-0002+170.3",
        ACCIDENTS: "2",
        RISK_SC: "74.5",
        PHASING: "เร่งด่วน",
        TYPE_PLAN: "BI",
        PHASING_YR: "2568",
        COST_M: "4.25",
      },
    ],
  ]);
  const crossings = normalizeDrtCrossingRows(
    [
      {
        sta: "11-0002+170.3",
        road: "ถ.เพชรบุรี (ยมราช)",
        crossing_type: "ก.1",
        authorization: "ทางที่ได้รับอนุญาต",
        prov: "กรุงเทพมหานคร",
        dist: "พญาไท",
        lat: "13.75707",
        long: "100520885",
        TM: "396600",
      },
      {
        sta: "invalid",
        road: "bad row",
        lat: "",
        long: "",
      },
    ],
    "https://example.test/crossing-v1.csv",
    plan,
  );

  assert.equal(crossings.length, 1);
  assert.equal(crossings[0].assetType, "rail_crossing");
  assert.deepEqual(crossings[0].geometry.coordinates, [100.520885, 13.75707]);
  assert.equal(crossings[0].attributes.historicalAccidents, 2);
  assert.equal(crossings[0].attributes.plannedRiskScore, 74.5);
  assert.equal(crossings[0].attributes.dataClass, "official_baseline");
});

test("normalizeDrtAccidentRows only creates map events when official accident rows include geometry", () => {
  const events = normalizeDrtAccidentRows(
    [
      {
        _id: "1",
        Date: "2026-05-30T00:00:00.000Z",
        Location: "อโศก - ดินแดง",
        AccType: "ชนยานพาหนะ",
        Deceased: "1",
        Injured: "0",
      },
      {
        _id: "2",
        Date: "2026-05-30T00:00:00.000Z",
        Location: "อโศก - ดินแดง",
        AccType: "ชนยานพาหนะ",
        Deceased: "0",
        Injured: "2",
        lat: "13.7559",
        long: "100.5567",
      },
    ],
    "https://example.test/crossing_accidents.csv",
    "2026-05-30T00:00:00.000Z",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "2");
  assert.equal(events[0].eventType, "rail_crossing_incident");
  assert.equal(events[0].attributes.dataClass, "historical");
});

test("official DRT crossing baseline can create rail cases without fabricated live events", () => {
  const crossings = normalizeDrtCrossingRows(
    [
      {
        sta: "11-0069+582",
        road: "ถ.ทางหลวงหมายเลข 3477",
        crossing_type: "ข.1",
        prov: "พระนครศรีอยุธยา",
        dist: "บางปะหัน",
        lat: "14.4801",
        long: "100.5399",
      },
    ],
    "https://example.test/crossing-v1.csv",
    new Map([["11-0069+582", { Survey_No: "11-0069+582", ACCIDENTS: "1", RISK_SC: "71.3" }]]),
  );
  const cases = buildRailCasesFromRealData(crossings, []);

  assert.equal(cases.length, 1);
  assert.equal(cases[0].relatedEventIds.length, 0);
  assert.equal(cases[0].evidence.some((item) => item.kind === "official_baseline"), true);
  assert.equal(cases[0].evidence.some((item) => item.kind === "historical_accident"), true);
});

test("normalizeSrtTtsIncidentReport links active SRT TTS report only to matched official crossings", () => {
  const crossings = normalizeDrtCrossingRows(
    [
      {
        sta: "12-0477+529",
        road: "ถ.เข้า ไร่ - สวน",
        prov: "สุโขทัย",
        dist: "สวรรคโลก",
        raod_owner: "อบต.คลองมะพลับ",
        lat: "17.336357",
        long: "99.916178",
      },
      {
        sta: "11-0002+170.3",
        road: "ถ.เพชรบุรี (ยมราช)",
        prov: "กรุงเทพมหานคร",
        dist: "พญาไท",
        lat: "13.75707",
        long: "100.520885",
      },
    ],
    "https://data.go.th/api/3/action/datastore_search?resource_id=01b609ab-b91c-401a-a776-8b2d0753caf3",
  );

  const events = normalizeSrtTtsIncidentReport(
    {
      found: true,
      meta: {
        report_datetime: "2026-05-30T04:00:00.000Z",
        url_slug: "SawankhalokLine",
        title_th: "ประกาศปิดเส้นทางระหว่างสถานีคลองมะพลับ-สวรรคโลก",
      },
      incidents: [
        {
          header_th: "ปิดเส้นทางการเดินรถระหว่างสถานีคลองมะพลับ-สวรรคโลก",
          detail_th: "การรถไฟฯ มีความจำเป็นต้องปิดเส้นทางการเดินรถเพื่อปรับปรุงก่อสร้างสะพานรถไฟ",
        },
      ],
      trainGroups: [],
    },
    crossings,
    "https://ttsview.railway.co.th/ttsAPI/incident/data?slug=latest",
    "2026-05-31T00:00:00.000Z",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].sourceId, "srt-tts-incident");
  assert.equal(events[0].attributes.crossingId, "12-0477+529");
  assert.equal(events[0].attributes.dataClass, "near_real_time");
});
