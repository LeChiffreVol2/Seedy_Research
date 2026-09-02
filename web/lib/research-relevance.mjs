const GENERIC_TERMS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "beyond", "by", "can", "conference", "current", "do", "does", "evidence", "for", "from", "how", "in", "into", "is", "it", "journal", "known", "of", "on", "or", "paper", "papers", "published", "report", "reported", "reports", "repository", "research", "should", "show", "shows", "studies", "study", "test", "testing", "thai", "thailand", "the", "this", "to", "use", "using", "what", "which", "with",
  "การ", "ของ", "จาก", "ด้วย", "ที่", "และ", "ใน", "เป็น", "เพื่อ", "ศึกษา", "การศึกษา", "งานวิจัย", "วิจัย", "ประเทศไทย", "อย่างไร",
]);

const THAI_TOPIC_FRAGMENTS = [
  "ปัญญาประดิษฐ์", "ภาษาอังกฤษ", "การเรียนรู้", "การสอน", "อุบัติเหตุ", "ความปลอดภัย", "ถนน", "จราจร", "ขนส่ง", "น้ำท่วม", "ระบายน้ำ", "ชลศาสตร์", "ก่อสร้าง", "คอนกรีต", "ซีเมนต์", "วัสดุ", "สะพาน", "แผ่นดินไหว", "สิ่งแวดล้อม", "การแพทย์", "สาธารณสุข", "เกษตร", "พลังงาน",
];

const CONCEPTS = [
  {
    id: "ai",
    test: (value) => /(?:^|\s)ai(?:\s|$)|artificial intelligence|ปัญญาประดิษฐ์/u.test(value),
  },
  {
    id: "elt",
    test: (value) => /(?:^|\s)elt(?:\s|$)|english language teaching|การสอนภาษาอังกฤษ/u.test(value),
  },
  {
    id: "efl",
    test: (value) => /(?:^|\s)efl(?:\s|$)|english as a foreign language|ภาษาอังกฤษเป็นภาษาต่างประเทศ/u.test(value),
  },
  {
    id: "mixed_methods",
    test: (value) => /mixed[\s-]?methods?|วิธี(?:การ)?แบบผสม|วิจัยแบบผสม/u.test(value),
  },
  {
    id: "longitudinal",
    test: (value) => /longitudinal|ระยะยาว|ตามยาว/u.test(value),
  },
  {
    id: "road_safety",
    test: (value) => /road safety|traffic safety|road (?:crash|accident)|อุบัติเหตุทางถนน|ความปลอดภัยทางถนน/u.test(value),
  },
  {
    id: "vehicle",
    test: (value) => /vehicle|motorcycle|car|ยานพาหนะ|รถจักรยานยนต์/u.test(value),
  },
  {
    id: "severe_injury",
    test: (value) => /severe|fatal|fatality|death|บาดเจ็บสาหัส|เสียชีวิต/u.test(value),
  },
  {
    id: "risk_factor",
    test: (value) => /condition|factor|component|ปัจจัย|องค์ประกอบ/u.test(value),
  },
];

// Topic anchors carry the user's domain intent. Study-design terms such as
// "mixed-method" or "longitudinal" may refine that intent, but cannot replace
// it merely because the corpus grew to include many Thai-affiliated studies.
const DOMAIN_ANCHOR_CONCEPTS = new Set(["ai", "elt", "efl", "road_safety"]);

const TERM_SIGNAL = new Map([
  ["ai", "ai"],
  ["elt", "elt"],
  ["efl", "efl"],
  ["longitudinal", "longitudinal"],
  ["mixed", "mixed_methods"],
  ["method", "mixed_methods"],
  ["methods", "mixed_methods"],
]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    // Thai vowels and tone marks are Unicode marks, not letters. Preserving
    // them is required for exact Thai phrase/concept matching.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function queryTerms(query) {
  const normalized = normalizeText(query);
  const lexical = (normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .filter((term) => term.length >= 2 && !GENERIC_TERMS.has(term));
  const thaiFragments = THAI_TOPIC_FRAGMENTS.filter((term) => normalized.includes(term));
  return unique([...lexical, ...thaiFragments]).slice(0, 20);
}

function includesTerm(haystack, term) {
  if (!term || !haystack) return false;
  if (/^[a-z0-9]+$/u.test(term)) {
    return new RegExp(`(?:^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "u").test(haystack);
  }
  return haystack.includes(term);
}

function cardFields(card) {
  const title = normalizeText(card?.title);
  const summary = normalizeText(card?.summary);
  const metadata = normalizeText([
    card?.source,
    card?.paperCode,
    card?.discipline,
    card?.journalTitle,
    ...(Array.isArray(card?.tags) ? card.tags : []),
    ...(Array.isArray(card?.authors) ? card.authors : []),
  ].filter(Boolean).join(" "));
  return { title, summary, metadata, all: `${title} ${summary} ${metadata}`.trim() };
}

/**
 * Scores visible research metadata conservatively. Generic research prose is
 * deliberately ignored so a long natural-language goal cannot pull an
 * unrelated paper into an evidence workflow because it contains “study” or
 * “method”.
 */
export function scoreResearchCardRelevance(query, card) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return { relevant: true, score: 1, matches: [] };

  const fields = cardFields(card);
  const terms = queryTerms(normalizedQuery);
  const matches = new Set();
  const matchedSignals = new Set();
  let score = 0;

  for (const term of terms) {
    if (includesTerm(fields.title, term)) {
      score += 4;
      matches.add(`term:${term}`);
      matchedSignals.add(TERM_SIGNAL.get(term) ?? `term:${term}`);
    } else if (includesTerm(fields.summary, term)) {
      score += 2;
      matches.add(`term:${term}`);
      matchedSignals.add(TERM_SIGNAL.get(term) ?? `term:${term}`);
    } else if (includesTerm(fields.metadata, term)) {
      score += 1;
      matches.add(`term:${term}`);
      matchedSignals.add(TERM_SIGNAL.get(term) ?? `term:${term}`);
    }
  }

  let queryConceptCount = 0;
  const requiredDomainConcepts = [];
  const matchedDomainConcepts = new Set();
  for (const concept of CONCEPTS) {
    if (!concept.test(normalizedQuery)) continue;
    queryConceptCount += 1;
    if (DOMAIN_ANCHOR_CONCEPTS.has(concept.id)) requiredDomainConcepts.push(concept.id);
    if (concept.test(fields.all)) {
      score += 6;
      matches.add(`concept:${concept.id}`);
      matchedSignals.add(concept.id);
      if (DOMAIN_ANCHOR_CONCEPTS.has(concept.id)) matchedDomainConcepts.add(concept.id);
    }
  }

  if (normalizedQuery.length <= 120 && fields.title.includes(normalizedQuery)) {
    score += 12;
    matches.add("phrase:title");
    matchedSignals.add("phrase:title");
  }

  const signalCount = terms.length + queryConceptCount;
  const minimumDistinctMatches = requiredDomainConcepts.length >= 2
    ? 2
    : signalCount >= 5 ? 3 : signalCount >= 4 ? 2 : 1;
  const minimumScore = signalCount >= 5 ? 8 : signalCount >= 4 ? 6 : 4;
  const domainAnchorsSatisfied = requiredDomainConcepts.every((concept) => matchedDomainConcepts.has(concept));
  return {
    relevant: domainAnchorsSatisfied && matchedSignals.size >= minimumDistinctMatches && score >= minimumScore,
    score,
    matches: [...matches],
  };
}

export function filterResearchCardsByRelevance(query, cards, options = {}) {
  const retained = new Set(options.alwaysIncludeSources ?? []);
  return cards
    .map((card, index) => {
      const forced = retained.has(card?.source);
      const result = scoreResearchCardRelevance(query, card);
      return { card, index, forced, ...result };
    })
    .filter((item) => item.forced || item.relevant)
    .sort((left, right) => Number(right.forced) - Number(left.forced) || right.score - left.score || left.index - right.index)
    .map((item) => item.card);
}
