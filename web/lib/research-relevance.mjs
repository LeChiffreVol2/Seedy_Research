const GENERIC_TERMS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "beyond", "by", "can", "current", "do", "does", "for", "from", "how", "in", "into", "is", "it", "of", "on", "or", "paper", "papers", "research", "should", "study", "studies", "test", "testing", "the", "this", "to", "use", "using", "what", "with",
  "การ", "ของ", "จาก", "ด้วย", "ที่", "และ", "ใน", "เป็น", "เพื่อ", "ศึกษา", "การศึกษา", "งานวิจัย", "วิจัย", "อย่างไร",
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
];

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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function queryTerms(query) {
  const normalized = normalizeText(query);
  const lexical = (normalized.match(/[\p{L}\p{N}]+/gu) ?? [])
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
  for (const concept of CONCEPTS) {
    if (!concept.test(normalizedQuery)) continue;
    queryConceptCount += 1;
    if (concept.test(fields.all)) {
      score += 6;
      matches.add(`concept:${concept.id}`);
      matchedSignals.add(concept.id);
    }
  }

  if (normalizedQuery.length <= 120 && fields.title.includes(normalizedQuery)) {
    score += 12;
    matches.add("phrase:title");
    matchedSignals.add("phrase:title");
  }

  const signalCount = terms.length + queryConceptCount;
  const minimumDistinctMatches = signalCount >= 4 ? 2 : 1;
  const minimumScore = signalCount >= 4 ? 6 : 4;
  return {
    relevant: matchedSignals.size >= minimumDistinctMatches && score >= minimumScore,
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
