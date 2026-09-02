import assert from "node:assert/strict";
import test from "node:test";

import {
  filterResearchCardsByRelevance,
  scoreResearchCardRelevance,
} from "./research-relevance.mjs";

const aiEltPaper = {
  source: "thaijo:learn:291631",
  title: "A Critical Analysis of Research on the Use of Artificial Intelligence in English Language Teaching in Thailand: Conflicting Results and Methodological Limitations",
  summary: "Rights-verified full paper with page-addressable evidence.",
  discipline: "education",
  tags: ["Native reader", "ThaiJO"],
};

const unrelatedCivilPapers = [
  { source: "ncce:rain", title: "Reliability analysis of automatic rainfall stations", summary: "A study of rainfall data." },
  { source: "ncce:biochar", title: "Effect of biochar on crack depth in concrete", summary: "A mixed material experiment." },
  { source: "ncce:bridge", title: "Performance of bridge bearings in Thailand", summary: "A longitudinal inspection study." },
  { source: "ncce:water", title: "Development of an automatic water regulator", summary: "A research method for water control." },
  { source: "pmc:aging", title: "Thai older persons' technology outcomes: a mixed-method study", summary: "A longitudinal health study." },
];

test("long research goals retain the AI/ELT anchor and reject generic civil matches", () => {
  const query = "How should a longitudinal mixed-methods Thai ELT study test AI learning outcomes beyond novelty effects?";
  const result = filterResearchCardsByRelevance(query, [aiEltPaper, ...unrelatedCivilPapers]);

  assert.deepEqual(result.map((paper) => paper.source), [aiEltPaper.source]);
  const score = scoreResearchCardRelevance(query, aiEltPaper);
  assert.equal(score.relevant, true);
  assert.ok(score.matches.includes("concept:ai"));
  assert.ok(score.matches.includes("concept:elt"));
});

test("short domain searches still retain direct title matches", () => {
  const roadPaper = {
    source: "ncce:road-safety",
    title: "Road safety outcomes at roundabouts in Thailand",
    summary: "Crash observations and traffic conflicts.",
  };
  const result = filterResearchCardsByRelevance("road safety", [roadPaper, ...unrelatedCivilPapers]);
  assert.deepEqual(result.map((paper) => paper.source), [roadPaper.source]);
});

test("Thai topic fragments match Thai titles without treating generic research words as anchors", () => {
  const roadPaper = {
    source: "ncce:thai-road",
    title: "การประเมินความปลอดภัยและอุบัติเหตุทางถนนในเชียงใหม่",
    summary: "วิเคราะห์ข้อมูลจราจรจากพื้นที่ศึกษา",
  };
  const genericPaper = {
    source: "ncce:generic",
    title: "การศึกษาวิธีการทดสอบวัสดุก่อสร้าง",
    summary: "งานวิจัยในประเทศไทย",
  };
  const result = filterResearchCardsByRelevance("ช่องว่างงานวิจัยอุบัติเหตุทางถนน", [genericPaper, roadPaper]);
  assert.deepEqual(result.map((paper) => paper.source), [roadPaper.source]);
});

test("English road-safety questions can retain a Thai-title evidence record", () => {
  const thaiEvidence = {
    source: "NCCE29_TRL42.md",
    title: "การศึกษาองค์ประกอบของการเกิดอุบัติเหตุทางถนนและปัจจัยที่นำไปสู่การบาดเจ็บสาหัสและการเสียชีวิตในประเทศไทย",
    summary: "วิเคราะห์ปัจจัยด้านคน ยานพาหนะ ถนน และสิ่งแวดล้อม",
    discipline: "transport",
  };
  const result = filterResearchCardsByRelevance(
    "Which road and vehicle conditions are associated with severe or fatal crashes in Thailand?",
    [thaiEvidence],
  );
  assert.deepEqual(result.map((paper) => paper.source), [thaiEvidence.source]);
});

test("an explicitly retained reviewed source survives a sparse or abstract goal", () => {
  const result = filterResearchCardsByRelevance(
    "Validate transfer beyond the current context",
    [aiEltPaper, ...unrelatedCivilPapers],
    { alwaysIncludeSources: [aiEltPaper.source] },
  );
  assert.equal(result[0]?.source, aiEltPaper.source);
});

test("Thai-published scope labels cannot make an impossible sparse query look relevant", () => {
  const unrelated = {
    source: "thai-conference:ordinary",
    title: "Coastal sediment transport in southern Thailand",
    summary: "A conventional field observation study.",
    tags: ["Published in Thailand", "Thai Conferences"],
  };
  const result = filterResearchCardsByRelevance(
    "Which Thai conference validated zero-gravity railways beneath the Andaman Sea?",
    [unrelated],
  );
  assert.deepEqual(result, []);
});
