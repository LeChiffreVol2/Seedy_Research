import type {
  McpEvidence,
  ResearchGateEvidenceStrength,
  ResearchGateEvidenceUse,
  SmartCityActionType,
  SmartCityInsight,
} from "./types";

type MechanismRule = {
  id: string;
  label: string;
  terms: string[];
};

const MECHANISM_RULES: MechanismRule[] = [
  {
    id: "queue_spillback",
    label: "Queueing or spillback exposure",
    terms: ["queue", "spillback", "congestion", "delay", "traffic", "flow", "capacity", "รถติด", "จราจร", "คิว", "ติดขัด"],
  },
  {
    id: "crossing_control",
    label: "Signal, warning, barrier, or crossing-control failure mode",
    terms: [
      "signal",
      "warning",
      "barrier",
      "gate",
      "crossing",
      "level crossing",
      "rail",
      "flashing",
      "visibility",
      "สัญญาณ",
      "เครื่องกั้น",
      "ทางตัด",
      "ไฟกระพริบ",
      "รถไฟ",
    ],
  },
  {
    id: "crash_exposure",
    label: "Crash, collision, severity, or exposure risk",
    terms: ["crash", "accident", "collision", "severity", "risk", "safety", "pedestrian", "vehicle", "ชน", "อุบัติเหตุ", "เสี่ยง"],
  },
  {
    id: "weather_visibility",
    label: "Weather, rainfall, flood, or visibility disruption",
    terms: ["rain", "rainfall", "weather", "visibility", "flood", "storm", "ฝน", "น้ำท่วม", "ทัศนวิสัย"],
  },
];

const ACTION_TERMS: Record<SmartCityActionType, string[]> = {
  verify_camera: ["camera", "cctv", "observe", "visual", "view", "monitor", "verification", "กล้อง"],
  audit_signal: ["signal", "warning", "barrier", "gate", "crossing", "level crossing", "rail", "flashing", "สัญญาณ", "เครื่องกั้น"],
  queue_control_review: ["queue", "spillback", "congestion", "delay", "traffic", "flow", "capacity", "จราจร", "รถติด"],
  dispatch_field_check: ["field", "inspection", "audit", "site", "verify", "crash", "collision", "ตรวจ", "พื้นที่"],
  monitor_watchlist: ["monitor", "watchlist", "risk", "safety", "incident", "crash", "weather", "severity", "ติดตาม", "เสี่ยง"],
};

const OBJECT_TERMS: Record<SmartCityInsight["objectType"], string[]> = {
  rail_crossing: ["rail", "railway", "crossing", "level crossing", "train", "srt", "รถไฟ", "ทางตัด"],
  road_segment: ["road", "traffic", "lane", "segment", "congestion", "ถนน", "จราจร"],
  intersection: ["intersection", "junction", "signal", "traffic", "แยก", "สัญญาณ"],
  camera: ["camera", "cctv", "video", "view", "กล้อง"],
  weather_station: ["weather", "rain", "rainfall", "visibility", "station", "ฝน"],
  incident: ["incident", "crash", "accident", "collision", "delay", "อุบัติเหตุ"],
  hotspot: ["hotspot", "cluster", "risk", "incident", "severity", "จุดเสี่ยง"],
};

const ACTION_LABELS: Record<SmartCityActionType, string> = {
  verify_camera: "camera verification",
  audit_signal: "signal or crossing audit",
  queue_control_review: "queue control review",
  dispatch_field_check: "field verification check",
  monitor_watchlist: "watchlist monitoring",
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  const cleaned = cleanText(value);
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars - 1).trim()}…`;
}

function termMatches(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return [...new Set(terms.filter((term) => lower.includes(term.toLowerCase())))];
}

function selectMechanism(text: string): { label: string; matchedTerms: string[] } | null {
  const ranked = MECHANISM_RULES.map((rule) => ({ rule, matchedTerms: termMatches(text, rule.terms) }))
    .filter((item) => item.matchedTerms.length > 0)
    .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length);
  const selected = ranked[0];
  if (!selected) return null;
  return { label: selected.rule.label, matchedTerms: selected.matchedTerms };
}

function extractExcerpt(content: string, matchedTerms: string[]): string {
  const cleaned = cleanText(content);
  if (!cleaned) return "CivilMCP returned a citation label but no usable evidence text for operators to inspect.";
  const chunks = cleaned
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const selected =
    chunks.find((chunk) => termMatches(chunk, matchedTerms).length > 0) ??
    chunks.find((chunk) => chunk.length >= 40) ??
    cleaned;
  return truncate(selected, 260);
}

function objectTypeLabel(value: SmartCityInsight["objectType"]): string {
  return value.replaceAll("_", " ");
}

function evidenceStrength({
  hasContent,
  mechanism,
  actionMatches,
  objectMatches,
}: {
  hasContent: boolean;
  mechanism: string | null;
  actionMatches: string[];
  objectMatches: string[];
}): ResearchGateEvidenceStrength {
  if (!hasContent || !mechanism) return "context_only";
  if (actionMatches.length > 0 && objectMatches.length > 0) return "direct";
  if (actionMatches.length > 0 || objectMatches.length > 0) return "indirect";
  return "context_only";
}

function operatorCheckFor(actionType: SmartCityActionType, insight: SmartCityInsight, operationalSources: string[]): string {
  const sourceText = operationalSources.length > 0 ? ` using ${operationalSources.join(", ")}` : "";
  if (actionType === "audit_signal") {
    return `Verify the selected ${objectTypeLabel(insight.objectType)}${sourceText}: warning visibility, signal timing, barrier/gate state, approach obstruction, and queue blocking before recording the audit.`;
  }
  if (actionType === "queue_control_review") {
    return `Check the live source${sourceText} for queue spillback, upstream/downstream control points, lane blockage, and whether the observed queue matches the cited mechanism.`;
  }
  if (actionType === "verify_camera") {
    return `Open the live camera or source URL${sourceText}, confirm timestamp and field of view, then compare the visible traffic state with the cited risk mechanism.`;
  }
  if (actionType === "dispatch_field_check") {
    return `Create only a reversible verification check${sourceText}; confirm the object, mechanism, and source timestamp before any field request is recorded.`;
  }
  return `Keep the object on the watchlist${sourceText} and monitor the live indicator named in the citation before escalating.`;
}

function contextOnlyCheck(insight: SmartCityInsight): string {
  return `Do not record an action from this citation alone. Ask for direct evidence or verify ${insight.title} against a live or official source first.`;
}

export function buildEvidenceUseRows({
  citations,
  insight,
  actionType,
  objectNames,
}: {
  citations: McpEvidence[];
  insight: SmartCityInsight;
  actionType: SmartCityActionType;
  objectNames: string[];
}): ResearchGateEvidenceUse[] {
  const operationalSources = [...new Set(objectNames.filter(Boolean))].slice(0, 4);
  return citations.slice(0, 4).map((item) => {
    const evidenceText = cleanText(`${item.sectionTitle} ${item.content}`);
    const mechanism = selectMechanism(evidenceText);
    const actionMatches = termMatches(evidenceText, ACTION_TERMS[actionType]);
    const objectMatches = termMatches(evidenceText, OBJECT_TERMS[insight.objectType]);
    const strength = evidenceStrength({
      hasContent: cleanText(item.content).length > 0,
      mechanism: mechanism?.label ?? null,
      actionMatches,
      objectMatches,
    });
    const matchedTerms = [...new Set([...(mechanism?.matchedTerms ?? []), ...actionMatches, ...objectMatches])].slice(0, 10);
    const excerpt = extractExcerpt(item.content, matchedTerms);
    const isContextOnly = strength === "context_only";
    const operatorCheck = isContextOnly ? contextOnlyCheck(insight) : operatorCheckFor(actionType, insight, operationalSources);
    const mechanismLabel = mechanism?.label ?? "No actionable transport mechanism detected";
    const objectLink = isContextOnly
      ? `This citation does not establish a usable mechanism-to-object link for ${insight.title}; keep it as background only.`
      : `It does not need to name ${insight.title} directly: it describes ${mechanismLabel.toLowerCase()} for a ${objectTypeLabel(
          insight.objectType,
        )}, which is the mechanism operators must verify against the selected real-source object.`;
    const actionImplication = isContextOnly
      ? "No operational action is supported by this citation alone."
      : `Supports ${ACTION_LABELS[actionType]} because the cited mechanism can be checked against the selected object before recording a reversible action.`;
    const caveat = isContextOnly
      ? "Context-only citation; it cannot support an executable action without direct mechanism or object linkage."
      : "Evidence supports decision framing only; operators still need live-source verification before recording an ops action.";

    return {
      evidenceId: `mcp:${item.id}`,
      citation: item.citation,
      source: item.source,
      sectionTitle: item.sectionTitle,
      relatedSources: [...new Set([...operationalSources, item.source].filter(Boolean))].slice(0, 4),
      relevance: objectLink,
      actionUse: actionImplication,
      caveat,
      excerpt,
      mechanism: mechanismLabel,
      objectLink,
      operatorCheck,
      actionImplication,
      evidenceStrength: strength,
      matchedTerms,
      operationalSources,
      researchCitation: item.citation,
    };
  });
}

export function actionableEvidenceIds(rows: ResearchGateEvidenceUse[]): Set<string> {
  return new Set(rows.filter((row) => row.evidenceStrength !== "context_only").map((row) => row.evidenceId));
}

export function proposalRationaleFromEvidence(
  insight: SmartCityInsight,
  rows: ResearchGateEvidenceUse[],
  actionType: SmartCityActionType,
): string {
  const actionableRows = rows.filter((row) => row.evidenceStrength !== "context_only");
  if (actionableRows.length === 0) {
    return `CivilMCP returned citations, but none directly support an executable action for ${insight.title}.`;
  }
  const mechanisms = [...new Set(actionableRows.map((row) => row.mechanism))].slice(0, 2).join("; ");
  return `CivilMCP evidence supports ${ACTION_LABELS[actionType]} for ${insight.title}: ${mechanisms}. Operators must verify the live or official source before recording the action.`;
}

export function evidenceUseSummary(totalCitations: number, rows: ResearchGateEvidenceUse[]): string {
  if (totalCitations === 0) return "No direct CivilMCP citation was returned for this question.";
  const actionableCount = rows.filter((row) => row.evidenceStrength !== "context_only").length;
  const contextOnlyCount = rows.filter((row) => row.evidenceStrength === "context_only").length;
  return `CivilMCP returned ${totalCitations} cited evidence packet(s). The ${rows.length} citation(s) mapped below include ${actionableCount} direct/indirect and ${contextOnlyCount} context-only. Only direct/indirect citations can support a recorded action.`;
}
