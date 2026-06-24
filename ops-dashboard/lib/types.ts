export type Severity = "critical" | "high" | "medium" | "low";
export type SourceStatus = "ok" | "degraded" | "stale" | "needs_config" | "offline";
export type SourceDataClass = "live" | "near_real_time" | "official_baseline" | "historical" | "needs_config" | "stale";
export type Trend = "rising" | "flat" | "falling";

export type GeoPoint = {
  type: "Point";
  coordinates: [number, number];
};

export type SmartCitySource = {
  id: string;
  name: string;
  provider: string;
  category: string;
  region: string;
  sourceUrl: string;
  refreshSeconds: number;
  dataClass?: SourceDataClass;
  refreshPolicy?: string;
  lastModified?: string | null;
  upstreamCadence?: string;
};

export type SourceHealth = {
  sourceId: string;
  name: string;
  provider: string;
  status: SourceStatus;
  lastSuccessAt: string | null;
  lastAttemptAt: string;
  latencyMs: number | null;
  recordCount: number;
  freshnessSeconds: number | null;
  message: string;
  dataClass?: SourceDataClass;
  refreshPolicy?: string;
  lastModified?: string | null;
  upstreamCadence?: string;
  isEligibleForLayers?: boolean;
  isEligibleForInsights?: boolean;
  eligibilityReason?: string;
};

export type SmartCityEvent = {
  id: string;
  sourceId: string;
  eventType:
    | "incident"
    | "congestion"
    | "weather_risk"
    | "camera_signal"
    | "roadwork"
    | "rail_crossing_incident"
    | "rail_crossing_risk"
    | "rail_weather_disruption"
    | "rail_news_signal";
  severity: Severity;
  confidence: number;
  observedAt: string;
  expiresAt?: string;
  region: string;
  geometry: GeoPoint;
  title: string;
  description: string;
  sourceUrl: string;
  attributes: Record<string, string | number | boolean | null>;
};

export type SmartCityAsset = {
  id: string;
  sourceId: string;
  assetType:
    | "camera"
    | "road_segment"
    | "intersection"
    | "weather_station"
    | "air_quality_station"
    | "aircraft"
    | "vessel"
    | "port"
    | "chokepoint"
    | "satellite"
    | "infrastructure"
    | "news_feed"
    | "rail_crossing"
    | "rail_station"
    | "rail_segment";
  name: string;
  region: string;
  geometry: GeoPoint;
  attributes: Record<string, string | number | boolean | null>;
};

export type HotspotEvidence = {
  label: string;
  value: string;
  kind: "live" | "historical" | "inferred" | "research";
};

export type SmartCityHotspot = {
  id: string;
  region: string;
  name: string;
  corridor: string;
  riskScore: number;
  trend: Trend;
  severity: Severity;
  confidence: number;
  geometry: GeoPoint;
  evidence: HotspotEvidence[];
  recommendedAction: string;
  updatedAt: string;
};

export type TimelineBucket = {
  label: string;
  incidents: number;
  congestion: number;
  weather: number;
};

export type OpsOverview = {
  generatedAt: string;
  region: string;
  viewport: {
    center: [number, number];
    zoom: number;
  };
  sources: SmartCitySource[];
  sourceHealth: SourceHealth[];
  events: SmartCityEvent[];
  assets: SmartCityAsset[];
  hotspots: SmartCityHotspot[];
  timeline: TimelineBucket[];
};

export type McpEvidence = {
  id: string;
  source: string;
  sectionTitle: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  similarity?: number | null;
  content: string;
  citation: string;
};

export type AnalystBrief = {
  generatedAt: string;
  mode: "mcp_read_only" | "offline_fallback";
  question: string;
  hotspotName: string;
  summary: string;
  liveSignals: string[];
  guidance: string[];
  evidence: McpEvidence[];
  limitations: string[];
};

export type ResearchQuestion = {
  id: string;
  question: string;
  reason: string;
};

export type ResearchFinding = {
  questionId: string;
  question: string;
  answer: string;
  evidence: McpEvidence[];
};

export type ActionProposal = {
  id: string;
  title: string;
  actionType: "verify" | "monitor" | "operate" | "design_review";
  confidence: number;
  rationale: string;
  executionScope: "controlled_action_record";
};

export type ResearchWorkflowResponse = {
  generatedAt: string;
  mode: "mcp_read_only" | "offline_fallback";
  hotspotName: string;
  questions: ResearchQuestion[];
  findings: ResearchFinding[];
  proposals: ActionProposal[];
  limitations: string[];
};

export type RailEvidenceKind =
  | "live_news_signal"
  | "official_baseline"
  | "historical_accident"
  | "baseline_historical"
  | "mcp_research"
  | "inference";

export type RailCaseEvidence = {
  label: string;
  value: string;
  kind: RailEvidenceKind;
};

export type RailSimulationDelta = {
  proposalId: string;
  beforeRisk: number;
  afterExpectedRisk: number;
  delta: number;
  confidence: number;
  evidenceBasis: string[];
  caveat: string;
};

export type RailSafetyCase = {
  id: string;
  name: string;
  corridor: string;
  crossingAssetId: string;
  severity: Severity;
  confidence: number;
  riskScore: number;
  geometry: GeoPoint;
  relatedEventIds: string[];
  evidence: RailCaseEvidence[];
  recommendedAction: string;
  simulationSummary: RailSimulationDelta;
  updatedAt: string;
};

export type RailActionProposal = ActionProposal & {
  proposalId?: string;
  researchRunId?: string;
  simulation: RailSimulationDelta;
};

export type RailOverview = {
  generatedAt: string;
  region: string;
  sources: SmartCitySource[];
  sourceHealth: SourceHealth[];
  crossings: SmartCityAsset[];
  events: SmartCityEvent[];
  cases: RailSafetyCase[];
  simulations: RailSimulationDelta[];
};

export type RailResearchFinding = ResearchFinding & {
  kind: RailEvidenceKind;
};

export type RailResearchWorkflowResponse = {
  generatedAt: string;
  mode: "mcp_read_only" | "offline_fallback";
  researchRunId?: string;
  researchPersisted?: boolean;
  caseId: string;
  caseName: string;
  questions: ResearchQuestion[];
  findings: RailResearchFinding[];
  proposals: RailActionProposal[];
  limitations: string[];
};

export type RailActionRecord = {
  id: string;
  proposalId: string;
  caseId: string;
  title: string;
  createdAt: string;
  executionScope: "controlled_action_record";
  simulation: RailSimulationDelta;
};

export type OntologyObjectType =
  | "rail_crossing"
  | "road_segment"
  | "intersection"
  | "camera"
  | "weather_station"
  | "incident"
  | "hotspot";

export type OntologyLinkType =
  | "incident_near_asset"
  | "camera_observes_crossing"
  | "hotspot_contains_event"
  | "research_supports_action";

export type OntologyEvidenceKind = "live_data" | "historical_baseline" | "mcp_research" | "inference";

export type SmartCityOntologyObject = {
  id: string;
  objectType: OntologyObjectType;
  displayName: string;
  sourceId: string;
  region: string;
  geometry: GeoPoint;
  severity?: Severity;
  confidence?: number;
  observedAt?: string;
  updatedAt: string;
  sourceUrl: string;
  properties: Record<string, string | number | boolean | null>;
  provenance: string[];
};

export type SmartCityOntologyLink = {
  id: string;
  linkType: OntologyLinkType;
  fromObjectId: string;
  toObjectId: string;
  confidence: number;
  reason: string;
  distanceMeters?: number;
};

export type OntologyReadModel = {
  generatedAt: string;
  viewport: OpsOverview["viewport"];
  objects: SmartCityOntologyObject[];
  links: SmartCityOntologyLink[];
  sources: SmartCitySource[];
  sourceHealth: SourceHealth[];
};

export type SmartCityInsightEvidence = {
  id: string;
  kind: OntologyEvidenceKind;
  label: string;
  value: string;
  objectId?: string;
  sourceUrl?: string;
};

export type SmartCityInsight = {
  id: string;
  domain: "transport";
  objectId: string;
  objectType: OntologyObjectType;
  title: string;
  whyNow: string;
  evidence: SmartCityInsightEvidence[];
  recommendedAction: string;
  nextVerificationStep: string;
  severity: Severity;
  confidence: number;
  riskBefore: number;
  expectedRiskAfter: number;
  delta: number;
  sourceObjectIds: string[];
  evidenceIds: string[];
  caveat: string;
  requiresResearch: boolean;
  generatedAt: string;
};

export type SmartCityActionType =
  | "verify_camera"
  | "audit_signal"
  | "queue_control_review"
  | "dispatch_field_check"
  | "monitor_watchlist";

export type SmartCityActionRecordStatus =
  | "proposed"
  | "acknowledged"
  | "recorded"
  | "pending_approval"
  | "approved"
  | "assigned"
  | "in_progress"
  | "verified"
  | "closed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "superseded"
  | "failed";

export type OpsActorRole = "viewer" | "analyst" | "operator" | "approver" | "admin";

export type OpsPermission =
  | "read.ops"
  | "run.research_gate"
  | "apply.ui_command"
  | "record.action"
  | "approve.action"
  | "transition.action"
  | "refresh.ingest";

export type OpsActor = {
  id: string;
  username: string;
  role: OpsActorRole;
  permissions: OpsPermission[];
  authSource: "basic" | "local_dev" | "system";
};

export type SmartCityActionRecord = {
  id: string;
  actionType: SmartCityActionType;
  title: string;
  actor: string;
  sourceObjectIds: string[];
  evidenceIds: string[];
  riskBefore: number;
  expectedRiskAfter: number;
  status: SmartCityActionRecordStatus;
  createdAt: string;
  updatedAt: string;
  executionScope: "controlled_action_record";
  limitations: string[];
  researchRunId?: string | null;
  proposalId?: string | null;
  insightId?: string | null;
  evidenceStrengths?: Record<string, ResearchGateEvidenceStrength>;
  evidenceSnapshot?: Array<Record<string, unknown>>;
  permissionState?: "operator_acknowledged" | "requires_ack" | "blocked";
  acknowledgements?: string[];
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  assignedTo?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  closedAt?: string | null;
  outcomeSummary?: string | null;
};

export type SmartCityActionEvent = {
  id: string;
  actionRecordId: string;
  fromStatus: SmartCityActionRecordStatus | null;
  toStatus: SmartCityActionRecordStatus;
  actor: string;
  role: OpsActorRole;
  reason?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ResearchGateFinding = {
  kind: OntologyEvidenceKind;
  title: string;
  summary: string;
  evidence: McpEvidence[];
};

export type ResearchGateProposal = {
  id: string;
  proposalId?: string;
  researchRunId?: string;
  insightId?: string;
  actionType: SmartCityActionType;
  title: string;
  rationale: string;
  confidence: number;
  riskBefore: number;
  expectedRiskAfter: number;
  delta: number;
  evidenceIds: string[];
  sourceObjectIds?: string[];
  evidenceStrengths?: Record<string, ResearchGateEvidenceStrength>;
  requiredAcknowledgements?: string[];
  normalizedHash?: string;
  recordable?: boolean;
  caveat: string;
};

export type ResearchGateEvidenceStrength = "direct" | "indirect" | "context_only";

export type ResearchGateEvidenceUse = {
  evidenceId: string;
  citation: string;
  source: string;
  sectionTitle: string;
  relatedSources: string[];
  relevance: string;
  actionUse: string;
  caveat: string;
  excerpt: string;
  mechanism: string;
  objectLink: string;
  operatorCheck: string;
  actionImplication: string;
  evidenceStrength: ResearchGateEvidenceStrength;
  matchedTerms: string[];
  operationalSources: string[];
  researchCitation: string;
};

export type ResearchGateResponse = {
  generatedAt: string;
  mode: "mcp_read_only" | "offline_fallback";
  researchRunId?: string;
  researchPersisted?: boolean;
  objectIds: string[];
  insightId?: string;
  findings: ResearchGateFinding[];
  recommendedActions: ResearchGateProposal[];
  evidenceUse: ResearchGateEvidenceUse[];
  limitations: string[];
  mapCommands?: OpsMapCommand[];
  workflowTrace?: OpsWorkflowTraceStep[];
  evidenceProvenance?: OpsEvidenceProvenance[];
};

export type OpsLayerKey =
  | "incidents"
  | "hotspots"
  | "cameras"
  | "congestion"
  | "weather"
  | "roadworks"
  | "osiris"
  | "rail"
  | "assets";

export type OpsLayerRegistryItem = {
  id: OpsLayerKey;
  label: string;
  enabledByDefault: boolean;
  count: number;
  activeCount?: number;
  staleCount?: number;
  totalCount?: number;
  dataClass: SourceDataClass;
  status: SourceStatus;
  freshnessSeconds: number | null;
  lastRefreshAt: string | null;
  eligibilityReason?: string;
  sourceIds: string[];
  geometryTypes: Array<"Point" | "LineString" | "Polygon">;
  provenance: string[];
  render: {
    color: string;
    icon: string;
    minZoom: number;
    maxFeatures: number;
  };
};

export type OpsLayerRegistryResponse = {
  generatedAt: string;
  region: string;
  readModel: "supabase" | "request_time_adapter";
  layers: OpsLayerRegistryItem[];
  sourceHealth: SourceHealth[];
  lastIngestRun?: {
    id: string;
    runType: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    counts: Record<string, unknown>;
  } | null;
};

export type OpsMapCommand =
  | {
      type: "set_view";
      center: [number, number];
      zoom: number;
      reason: string;
    }
  | {
      type: "toggle_layer";
      layerId: OpsLayerKey;
      enabled: boolean;
      reason: string;
    }
  | {
      type: "style_layer";
      layerId: OpsLayerKey;
      style: Record<string, string | number | boolean>;
      reason: string;
    }
  | {
      type: "apply_spatial_filter";
      bbox?: [number, number, number, number];
      objectIds?: string[];
      reason: string;
    }
  | {
      type: "select_object";
      objectId: string;
      reason: string;
    }
  | {
      type: "open_evidence_panel";
      objectId: string;
      evidenceIds: string[];
      reason: string;
    }
  | {
      type: "run_research_gate";
      objectIds: string[];
      insightId?: string;
      reason: string;
    };

export type OpsWorkflowTraceStep = {
  id: string;
  label: string;
  status: "complete" | "blocked" | "pending";
  summary: string;
  createdAt: string;
};

export type OpsEvidenceProvenance = {
  evidenceId: string;
  source: string;
  citation: string;
  strength: ResearchGateEvidenceStrength;
  objectIds: string[];
  actionImplication: string;
};

export type OpsMapCommandEnvelope = {
  commandId: string;
  batchId: string;
  researchRunId?: string;
  proposalId?: string | null;
  insightId?: string | null;
  objectIds?: string[];
  actor?: string;
  role?: OpsActorRole;
  command: OpsMapCommand;
  permission: "auto" | "requires_ack" | "blocked";
  ackState: "not_required" | "pending" | "acknowledged";
  requiredAcknowledgements: string[];
  status: "pending" | "applied" | "rejected" | "failed";
  idempotencyHash?: string;
  createdAt: string;
  appliedAt?: string;
  error?: string;
};

export type OpsCommandEvent = {
  id: string;
  commandId: string;
  actor: string;
  role: OpsActorRole;
  eventType: string;
  fromStatus?: OpsMapCommandEnvelope["status"] | null;
  toStatus: OpsMapCommandEnvelope["status"];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type OpsSourceSlaState = "ok" | "warn" | "breach";

export type OpsSourceSla = {
  sourceId: string;
  name: string;
  provider: string;
  category: string;
  region: string;
  status: SourceStatus;
  dataClass: SourceDataClass;
  slaState: OpsSourceSlaState;
  breachReasons: string[];
  secondsUntilBreach: number | null;
  successRate24h: number | null;
  p95LatencyMs24h: number | null;
  failures24h: number;
  attempts24h: number;
  recordCount: number;
  freshnessSeconds: number | null;
  slaFreshnessSeconds: number;
  slaLatencyMs: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  message?: string | null;
};

export type OpsSourceSlaResponse = {
  generatedAt: string;
  readModel: "supabase" | "unconfigured";
  summary: {
    total: number;
    ok: number;
    warn: number;
    breach: number;
    lastIngestStatus?: string | null;
    lastIngestFinishedAt?: string | null;
  };
  sources: OpsSourceSla[];
};
