export type WebMcpCollection = "all" | "ncce" | "ce_project";
export type WebMcpDiscoveryScope = "thai" | "thai_and_global";
export type WebMcpPathLevel = "foundation" | "applied" | "research";
export type WebMcpPathOutcome = "literature_review" | "study_plan" | "decision_brief";
export type WebMcpGapLens = "method" | "context" | "population" | "outcome" | "validation";

export type DiscoverResearchInput = {
  query: string;
  collection: WebMcpCollection;
  scope: WebMcpDiscoveryScope;
};

export type InspectPaperEvidenceInput = {
  source: string;
  evidenceId?: string;
  page?: number;
};

export type TraceResearchConnectionsInput = {
  source: string;
};

export type AuditGlobalVisibilityInput = {
  source: string;
};

export type BuildResearchPathInput = {
  goal: string;
  level: WebMcpPathLevel;
  outcome: WebMcpPathOutcome;
  collection: WebMcpCollection;
  knowledgeGaps: string[];
  globalLeadIds: string[];
  passportId?: string;
  source?: string;
  evidenceIds: string[];
  gapLens?: WebMcpGapLens;
};

export type DraftResearchPassportInput = {
  source: string;
  focus: string;
  evidenceIds: string[];
  gapLens: WebMcpGapLens;
};

export type SeedResearchWebMcpHandlers = {
  discoverResearch: (input: DiscoverResearchInput, signal: AbortSignal) => Promise<unknown>;
  auditGlobalVisibility: (input: AuditGlobalVisibilityInput, signal: AbortSignal) => Promise<unknown>;
  inspectPaperEvidence: (input: InspectPaperEvidenceInput, signal: AbortSignal) => Promise<unknown>;
  traceResearchConnections: (input: TraceResearchConnectionsInput, signal: AbortSignal) => Promise<unknown>;
  draftResearchPassport: (input: DraftResearchPassportInput, signal: AbortSignal) => Promise<unknown>;
  buildResearchPath: (input: BuildResearchPathInput, signal: AbortSignal) => Promise<unknown>;
  inspectLearningProgress: (signal: AbortSignal) => Promise<unknown>;
};

type JsonSchema = Record<string, unknown>;

type WebMcpExecutionOptions = {
  signal?: AbortSignal;
};

type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: unknown, options?: WebMcpExecutionOptions) => Promise<unknown>;
};

type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
};

declare global {
  interface Document {
    modelContext?: WebMcpModelContext;
  }
}

export const SEED_RESEARCH_WEBMCP_TOOL_NAMES = [
  "discover_research",
  "audit_global_visibility",
  "inspect_paper_evidence",
  "trace_research_connections",
  "draft_research_passport",
  "build_research_path",
  "inspect_learning_progress",
] as const;

function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

function assertAllowedKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unsupported tool input: ${unexpected.join(", ")}.`);
}

function requiredText(input: Record<string, unknown>, key: string, minimum: number, maximum: number): string {
  const value = typeof input[key] === "string" ? input[key].replace(/\s+/g, " ").trim() : "";
  if (value.length < minimum || value.length > maximum) {
    throw new Error(`${key} must contain ${minimum}-${maximum} characters.`);
  }
  return value;
}

function optionalText(input: Record<string, unknown>, key: string, maximum: number): string | undefined {
  if (input[key] == null || input[key] === "") return undefined;
  const value = typeof input[key] === "string" ? input[key].replace(/\s+/g, " ").trim() : "";
  if (!value || value.length > maximum) throw new Error(`${key} must contain at most ${maximum} characters.`);
  return value;
}

function enumValue<T extends string>(
  input: Record<string, unknown>,
  key: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = input[key];
  if (value == null || value === "") return fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${key} must be one of: ${choices.join(", ")}.`);
  }
  return value as T;
}

function optionalPage(input: Record<string, unknown>): number | undefined {
  if (input.page == null) return undefined;
  if (!Number.isInteger(input.page) || Number(input.page) < 0 || Number(input.page) > 100_000) {
    throw new Error("page must be an integer between 0 and 100000.");
  }
  return Number(input.page);
}

function parseDiscoverResearch(input: unknown): DiscoverResearchInput {
  const record = inputRecord(input);
  assertAllowedKeys(record, ["query", "collection", "scope"]);
  return {
    query: requiredText(record, "query", 2, 180),
    collection: enumValue(record, "collection", ["all", "ncce", "ce_project"], "all"),
    scope: enumValue(record, "scope", ["thai", "thai_and_global"], "thai"),
  };
}

function parseInspectPaperEvidence(input: unknown): InspectPaperEvidenceInput {
  const record = inputRecord(input);
  assertAllowedKeys(record, ["source", "evidenceId", "page"]);
  return {
    source: requiredText(record, "source", 1, 320),
    evidenceId: optionalText(record, "evidenceId", 120),
    page: optionalPage(record),
  };
}

function parseTraceResearchConnections(input: unknown): TraceResearchConnectionsInput {
  const record = inputRecord(input);
  assertAllowedKeys(record, ["source"]);
  return { source: requiredText(record, "source", 1, 320) };
}

function parseAuditGlobalVisibility(input: unknown): AuditGlobalVisibilityInput {
  const record = inputRecord(input);
  assertAllowedKeys(record, ["source"]);
  return { source: requiredText(record, "source", 1, 320) };
}

function parseBuildResearchPath(input: unknown): BuildResearchPathInput {
  const record = inputRecord(input);
  assertAllowedKeys(record, ["goal", "level", "outcome", "collection", "knowledgeGaps", "globalLeadIds", "passportId", "source", "evidenceIds", "gapLens"]);
  const rawGaps = record.knowledgeGaps;
  if (rawGaps != null && !Array.isArray(rawGaps)) throw new Error("knowledgeGaps must be an array of strings.");
  const knowledgeGaps = (rawGaps ?? []).map((value) => {
    if (typeof value !== "string") throw new Error("Each knowledge gap must be text.");
    const gap = value.replace(/\s+/g, " ").trim();
    if (gap.length < 2 || gap.length > 180) throw new Error("Each knowledge gap must contain 2-180 characters.");
    return gap;
  });
  if (knowledgeGaps.length > 4) throw new Error("knowledgeGaps supports at most four items.");
  const rawGlobalLeadIds = record.globalLeadIds;
  if (rawGlobalLeadIds != null && !Array.isArray(rawGlobalLeadIds)) throw new Error("globalLeadIds must be an array of OpenAlex work IDs.");
  const globalLeadIds = (rawGlobalLeadIds ?? []).map((value) => {
    if (typeof value !== "string") throw new Error("Each global lead ID must be text.");
    const id = value.trim();
    if (!/^https:\/\/openalex\.org\/W\d+$/i.test(id) || id.length > 320) throw new Error("Each global lead ID must be a valid OpenAlex work URL.");
    return id;
  });
  if (globalLeadIds.length > 4) throw new Error("globalLeadIds supports at most four items.");
  if (new Set(globalLeadIds).size !== globalLeadIds.length) throw new Error("globalLeadIds must be unique.");
  const passportId = optionalText(record, "passportId", 120);
  const source = optionalText(record, "source", 320);
  const rawEvidenceIds = record.evidenceIds;
  if (rawEvidenceIds != null && !Array.isArray(rawEvidenceIds)) throw new Error("evidenceIds must be an array of visible Passport evidence IDs.");
  const evidenceIds = (rawEvidenceIds ?? []).map((value) => {
    if (typeof value !== "string") throw new Error("Each evidence ID must be text.");
    const id = value.trim();
    if (!id || id.length > 120) throw new Error("Each evidence ID must contain 1-120 characters.");
    return id;
  });
  if (evidenceIds.length > 3 || new Set(evidenceIds).size !== evidenceIds.length) throw new Error("evidenceIds supports at most three unique items.");
  const gapLens = record.gapLens == null || record.gapLens === ""
    ? undefined
    : enumValue(record, "gapLens", ["method", "context", "population", "outcome", "validation"], "validation");
  const hasPassportContext = Boolean(passportId || source || evidenceIds.length || gapLens);
  if (hasPassportContext && (!passportId || !source || !evidenceIds.length || !gapLens)) {
    throw new Error("passportId, source, evidenceIds, and gapLens must be supplied together.");
  }
  return {
    goal: requiredText(record, "goal", 8, 280),
    level: enumValue(record, "level", ["foundation", "applied", "research"], "foundation"),
    outcome: enumValue(record, "outcome", ["literature_review", "study_plan", "decision_brief"], "study_plan"),
    collection: enumValue(record, "collection", ["all", "ncce", "ce_project"], "all"),
    knowledgeGaps: [...new Set(knowledgeGaps)],
    globalLeadIds,
    passportId,
    source,
    evidenceIds,
    gapLens,
  };
}

function parseDraftResearchPassport(input: unknown): DraftResearchPassportInput {
  const record = inputRecord(input);
  assertAllowedKeys(record, ["source", "focus", "evidenceIds", "gapLens"]);
  const rawEvidenceIds = record.evidenceIds;
  if (!Array.isArray(rawEvidenceIds) || rawEvidenceIds.length < 1 || rawEvidenceIds.length > 3) {
    throw new Error("evidenceIds must contain one to three visible evidence identifiers.");
  }
  const evidenceIds = rawEvidenceIds.map((value) => {
    if (typeof value !== "string") throw new Error("Each evidence identifier must be text.");
    const id = value.trim();
    if (!id || id.length > 120) throw new Error("Each evidence identifier must contain 1-120 characters.");
    return id;
  });
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new Error("evidenceIds must be unique.");
  if (record.gapLens == null || record.gapLens === "") throw new Error("gapLens is required.");
  return {
    source: requiredText(record, "source", 1, 320),
    focus: requiredText(record, "focus", 8, 180),
    evidenceIds,
    gapLens: enumValue(record, "gapLens", ["method", "context", "population", "outcome", "validation"], "validation"),
  };
}

export async function registerSeedResearchWebMcpTools(
  handlers: SeedResearchWebMcpHandlers,
): Promise<AbortController | null> {
  if (typeof document.modelContext?.registerTool !== "function") return null;

  const controller = new AbortController();
  const signalFor = (options?: WebMcpExecutionOptions) => options?.signal ?? controller.signal;
  const tools: WebMcpTool[] = [
    {
      name: "discover_research",
      title: "Discover Thai research",
      description: "Search Seedy Research's Thai-local sources first. Returns bounded page-citable evidence and source-addressable discovery-only Thai records separately, so a later visibility audit can inspect what global indexes may overlook. Optional global topical metadata is a comparison layer only.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2, maxLength: 180, description: "Research topic or question in Thai or English." },
          collection: { type: "string", enum: ["all", "ncce", "ce_project"], description: "Thai evidence collection; defaults to all." },
          scope: { type: "string", enum: ["thai", "thai_and_global"], description: "Defaults to Thai-local discovery; add global metadata only for optional topical comparison." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, options) => handlers.discoverResearch(parseDiscoverResearch(input), signalFor(options)),
    },
    {
      name: "audit_global_visibility",
      title: "Read the dated global-visibility receipt",
      description: "Read Seedy's latest dated OpenAlex comparison receipt for one Thai-local work. Exact identity, under-indexing, review candidates, not-found-in-this-audit, not-yet-audited, and provider-unavailable remain distinct states. This does not submit or repair records in OpenAlex.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", minLength: 1, maxLength: 320, description: "Exact Thai-local source identifier returned by discover_research." },
        },
        required: ["source"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, options) => handlers.auditGlobalVisibility(parseAuditGlobalVisibility(input), signalFor(options)),
    },
    {
      name: "inspect_paper_evidence",
      title: "Inspect evidence and lawful full-paper access",
      description: "Open one Seedy Research paper on the shared page, return bounded evidence excerpts with source pages, and report the strongest lawful reader mode without returning full-page text to the agent. Use after discovery when the user wants to verify a paper or supported claim.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", minLength: 1, maxLength: 320, description: "Exact source identifier returned by discover_research." },
          evidenceId: { type: "string", maxLength: 120, description: "Optional evidence packet identifier to highlight." },
          page: { type: "integer", minimum: 0, maximum: 100000, description: "Optional original page to highlight." },
        },
        required: ["source"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, options) => handlers.inspectPaperEvidence(parseInspectPaperEvidence(input), signalFor(options)),
    },
    {
      name: "trace_research_connections",
      title: "Trace Thai-to-global research connections",
      description: "Trace the active Thai paper into a bounded OpenAlex citation neighborhood. Use only after opening the paper evidence. The shared page shows match confidence plus cited, citing, and related works; every returned global node remains metadata-only until separately reviewed as evidence.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", minLength: 1, maxLength: 320, description: "Exact source identifier of the active Thai paper opened with inspect_paper_evidence." },
        },
        required: ["source"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, options) => handlers.traceResearchConnections(parseTraceResearchConnections(input), signalFor(options)),
    },
    {
      name: "draft_research_passport",
      title: "Draft a Thai-to-global research passport",
      description: "Create a visible Research Passport from evidence already opened in the active Thai paper. It connects one to three exact-page anchors to OpenAlex metadata and one candidate validation gap that requires human review.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", minLength: 1, maxLength: 320, description: "Active indexed Thai paper source ID." },
          focus: { type: "string", minLength: 8, maxLength: 180, description: "Finding or research question to connect globally." },
          evidenceIds: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 120 }, description: "Visible exact-page evidence IDs from the active paper." },
          gapLens: { type: "string", enum: ["method", "context", "population", "outcome", "validation"], description: "Dimension to test before claiming transfer or novelty." },
        },
        required: ["source", "focus", "evidenceIds", "gapLens"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, options) => handlers.draftResearchPassport(parseDraftResearchPassport(input), signalFor(options)),
    },
    {
      name: "build_research_path",
      title: "Build an evidence-backed research path",
      description: "Create or adapt a visible Thai-to-global Research Path: map the Thai field, inspect page/full-paper evidence, connect selected metadata-only global leads, then frame a candidate gap and falsifiable Next-Study Protocol. Optional learning gaps personalize the next path.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string", minLength: 8, maxLength: 280, description: "The learner's research goal in Thai or English." },
          level: { type: "string", enum: ["foundation", "applied", "research"], description: "Current research-learning level." },
          outcome: { type: "string", enum: ["literature_review", "study_plan", "decision_brief"], description: "Artifact the learner wants to produce." },
          collection: { type: "string", enum: ["all", "ncce", "ce_project"], description: "Thai evidence collection; defaults to all." },
          knowledgeGaps: { type: "array", maxItems: 4, items: { type: "string", minLength: 2, maxLength: 180 }, description: "Optional evidence-backed gaps from a prior checkpoint." },
          globalLeadIds: { type: "array", maxItems: 4, uniqueItems: true, items: { type: "string", pattern: "^https://openalex\\.org/W[0-9]+$" }, description: "Optional metadata-only OpenAlex work IDs returned by trace_research_connections to carry as global comparison leads." },
          passportId: { type: "string", maxLength: 120, description: "Optional active Research Passport ID. Supply with source, evidenceIds, and gapLens to preserve the reviewed evidence trail." },
          source: { type: "string", maxLength: 320, description: "Exact Thai paper source carried by the active Research Passport." },
          evidenceIds: { type: "array", maxItems: 3, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 120 }, description: "Exact-page evidence IDs carried by the active Research Passport." },
          gapLens: { type: "string", enum: ["method", "context", "population", "outcome", "validation"], description: "Candidate-gap lens carried by the active Research Passport." },
        },
        required: ["goal"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, options) => handlers.buildResearchPath(parseBuildResearchPath(input), signalFor(options)),
    },
    {
      name: "inspect_learning_progress",
      title: "Inspect Research Path progress",
      description: "Read the visible Research Path stages, checkpoint statuses, scores, and evidence-backed learning gaps. It omits the learner's private free-text answers and helps choose the next collaborative step.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, options) => {
        const record = inputRecord(input);
        assertAllowedKeys(record, []);
        return handlers.inspectLearningProgress(signalFor(options));
      },
    },
  ];

  try {
    for (const tool of tools) {
      await document.modelContext.registerTool(tool, { signal: controller.signal });
    }
    return controller;
  } catch (error) {
    controller.abort();
    throw error;
  }
}
