"use client";

import type { ButtonHTMLAttributes, FormEvent, KeyboardEvent, ReactNode, Ref } from "react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "ai/react";
import type { UIMessage } from "ai";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUp,
  ArrowRight,
  Bell,
  Bookmark,
  Building2,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Copy,
  CreditCard,
  Crown,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Flame,
  Gauge,
  GitFork,
  History,
  KeyRound,
  Languages,
  Layers3,
  LoaderCircle,
  LogIn,
  LogOut,
  Mail,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  Target,
  Terminal,
  TriangleAlert,
  RefreshCw,
  Route,
  Save,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  isChatModel,
  type ChatModel,
} from "@/lib/chat-models";
import { CIVILMCP_FEATURE_ACCESS, CIVILMCP_OPEN_ACCESS, CIVILMCP_OPEN_ACCESS_LABEL, type CivilMcpFeature } from "@/lib/product-access";
import { ResearchWorkspacePanel, type ResearchNotebookFinding, type ResearchWorkspacePaper, type ResearchWorkspaceEvidenceTarget } from "@/components/research-workspace";
import { GlassMenuSelect, type GlassMenuOption } from "@/components/glass-menu-select";
import {
  registerSeedResearchWebMcpTools,
  type SeedResearchWebMcpHandlers,
  type WebMcpGapLens,
} from "@/lib/webmcp";

type Mode = "baseline" | "mcp";
type ChatExperience = "answer" | "mission" | "learn" | "research" | "automated";
type CollectionFilter = "" | "ce_project" | "ncce";
type SyncState = "loading" | "saving" | "saved" | "error";
type OpenDropdown = "experience" | "model" | "collection" | "actions" | "examples" | null;
type FeedFilter = "hot" | "for_you" | "recent" | "evidence" | "saved" | "thai" | "tci" | "ncce" | "ce_project";
type MobileNavItem = "explore" | "workspace" | "path" | "chat" | "history" | "shared" | "settings";
type FeedStatus = "loading" | "ready" | "error";
type SessionsStatus = "idle" | "loading" | "ready" | "error";
type AuthMode = "signin" | "signup" | "forgot-password" | "recovery";
type PaperLanguage = "th" | "en";
type WebMcpStatus = "checking" | "ready" | "unsupported" | "error";
type ProductEvent =
  | "explore_search" | "paper_open" | "evidence_open" | "paper_save"
  | "research_path_created" | "path_stage_completed"
  | "workspace_started" | "workspace_run_completed"
  | "session_export" | "evidence_export" | "review_exported"
  | "checkpoint_answered" | "checkpoint_mastered" | "path_adapted"
  | "first_answer" | "onboarding_completed" | "user_returned" | "upgrade_intent" | "verified_research_outcome";
type ActivationStep = "search" | "verify" | "outcome";

type CivilEvidenceItem = {
  evidenceId: string;
  citation: string;
  source: string;
  id?: string;
  documentId?: string;
  sectionId?: string;
  sectionIndex?: number | null;
  chunkIndex?: number | null;
  collection?: string;
  paperCode?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  sectionTitle?: string;
  snippet?: string;
};

type CivilMcpAnnotation = {
  type: "civilmcp_context";
  traceId?: string;
  mode?: string;
  collection?: string;
  intent?: string | null;
  searchQuery?: string | null;
  queryExpansions?: string[];
  discipline?: string | null;
  sectionsUsed?: number;
  chunksUsed?: number;
  toolCalls?: number;
  retrievalMode?: "semantic" | "lexical_fallback" | "unavailable";
  retrievalDegraded?: boolean;
  retrievalDegradedReason?: string | null;
  evidenceItems?: CivilEvidenceItem[];
};

type CivilTraceAnnotation = {
  type: "civilmcp_trace";
  traceId?: string;
  mode?: string;
  model?: string;
};

type CivilMemoryAnnotation = {
  type: "civilmcp_memory";
  state?: "active" | "compacted";
  runningSummary?: string;
  activeEvidenceMap?: CivilEvidenceItem[];
  estimatedTokensBefore?: number;
  contextWindowTokens?: number;
  contextFillRatio?: number;
  compactedMessageCount?: number;
  recentMessageCount?: number;
};

type MissionVerdict = "supported" | "mixed" | "conflicting" | "insufficient";

type CivilMissionArtifact = {
  version: "civilmcp-evidence-brief-v1";
  question: string;
  experience: "mission" | "learn" | "research" | "automated";
  title: string;
  executiveSummary: string;
  verdict: { status: MissionVerdict; rationale: string };
  matrix: Array<{
    finding: string;
    interpretation: string;
    methodOrContext: string;
    limitation: string;
    evidenceIds: string[];
  }>;
  worldBridge: {
    transferableSignals: string[];
    thaiContext: string[];
    validateNext: string[];
  };
  learning: {
    objective: string;
    checkpoints: Array<{ question: string; hint: string; evidenceIds: string[] }>;
  };
  trust: {
    evidenceCount: number;
    sourceCount: number;
    exactPageCount: number;
    pageCoveragePercent: number;
  };
  agentRun: {
    bounded: true;
    toolCalls: number;
    toolCallLimit: number;
    stepLimit: number;
    stages: Array<{ name: string; detail: string; status: "complete" | "limited" }>;
  };
  automation?: {
    objective: string;
    subquestions: string[];
    tasks: Array<{
      name: string;
      objective: string;
      status: "complete" | "limited";
      evidenceIds: string[];
    }>;
    deliverables: string[];
  };
};

type CivilMissionAnnotation = {
  type: "civilmcp_mission";
  traceId?: string;
  artifact: CivilMissionArtifact;
};

type SessionPayload = {
  sessionId?: string;
  title?: string;
  mode?: string;
  model?: string;
  collection?: string;
  messages?: UIMessage[];
  user?: ChatUserProfile | null;
  authenticated?: boolean;
};

type ChatUserProfile = {
  userId: string;
  displayName: string;
  email?: string | null;
  isGuest: boolean;
};

type ChatSessionSummary = {
  sessionId: string;
  title: string;
  mode: Mode;
  model: ChatModel;
  collection: CollectionFilter;
  messageCount: number;
  lastUserMessage: string;
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string | null;
};

type ChatSessionsResponse = {
  user?: ChatUserProfile | null;
  sessions: ChatSessionSummary[];
  authenticated?: boolean;
};

type BillingState = {
  plan: "guest" | "free" | "founder_pro";
  status: string;
  creditsIncluded: number | null;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  resetAt: string | null;
  premiumModels: boolean;
  openAccess: boolean;
  billingConfigured: boolean;
  priceThb: number;
  hasStripeCustomer: boolean;
};

type MenuOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  badge?: string;
};

type ResearchCardData = {
  id: string;
  source: string;
  sourcePdf?: string | null;
  collection: CollectionFilter;
  sourceType?: string | null;
  parentSourcePdf?: string | null;
  paperCode?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  proceedingNo?: number | null;
  proceedingYear?: number | null;
  discipline?: string | null;
  language?: string | null;
  publishedAt?: string | null;
  title: string;
  date: string;
  sourceLabel: string;
  summary: string;
  tags: string[];
  filters: FeedFilter[];
  evidenceCount: number;
  pages: number;
  pageLabel: string;
  preview: "beam" | "flood" | "seismic" | "traffic";
  previewUrl?: string;
  prompt: string;
  indexedAt?: string | null;
  provider?: string | null;
  evidenceStatus?: "metadata_only" | "extracted" | "indexed" | "quarantined" | "removed";
  citable?: boolean;
  canonicalUrl?: string | null;
  journalTitle?: string | null;
  authors?: string[];
  doi?: string | null;
  rightsStatus?: string | null;
  accessLevel?: string | null;
  licenseExpression?: string | null;
  licenseUrl?: string | null;
  discoveryLayer?: "evidence" | "thai_discovery";
  publicationCountry?: string | null;
  thaiPublished?: boolean | null;
  thailandContext?: boolean | null;
  thaiLanguage?: boolean | null;
  thaiAffiliated?: boolean | null;
  visibility?: VisibilityReceipt;
};

type GlobalVisibilityState = "globally_indexed" | "under_indexed" | "candidate_match" | "not_found_in_audit" | "not_audited" | "audit_unavailable";

type VisibilityReceipt = {
  source: string;
  provider: string | null;
  externalIndex: "openalex";
  state: GlobalVisibilityState;
  matchBasis: string;
  externalWorkId: string | null;
  externalUrl: string | null;
  confidence: number | null;
  requiresHumanReview: boolean;
  metadataGaps: string[];
  checkedAt: string | null;
  snapshotDate: string | null;
  methodVersion: string | null;
};

type VisibilitySummary = {
  auditRunId: string | null;
  provider: string;
  externalIndex: "openalex";
  snapshotDate: string | null;
  runStatus: "not_started" | "running" | "partial" | "complete" | "failed";
  strategy: "identifiers" | "full" | null;
  denominator: number;
  attempted: number;
  audited: number;
  globallyIndexed: number;
  underIndexed: number;
  candidateReview: number;
  notFoundInAudit: number;
  unavailable: number;
  methodVersion: string | null;
  complete: boolean;
};

type PaperAnchor = {
  source: string;
  collection?: CollectionFilter;
  paperCode?: string | null;
};

type ResearchFeedResponse = {
  cards: ResearchCardData[];
  facets?: {
    total?: number;
    totalSections?: number;
    totalChunks?: number;
    catalogTotal?: number;
    citableTotal?: number;
    metadataOnlyTotal?: number;
    providers?: Array<{ provider: string; records: number; citable: number; metadataOnly?: number }>;
    coverage?: ResearchCoverageProvider[];
    collections?: Array<{ collection: string; documents: number }>;
    filters?: Partial<Record<FeedFilter, number>>;
    visibility?: VisibilitySummary;
  };
  nextCursor?: string | null;
  generatedAt?: string;
};

type ResearchCoverageProvider = {
  provider: string;
  label: string;
  state: "connected" | "import_validated" | "partner_required" | "planned" | "blocked";
  records: number;
  metadataOnly: number;
  pageCitable: number;
  nativeFullPaper: number;
  sourceHostedFullPaper: number | null;
  endpointObserved: number | null;
  endpointKnown: number | null;
  rights: "article_specific" | "manifest_reviewed" | "agreement_required" | "not_assessed";
  freshness: string;
  filter: string | null;
};

type GlobalDiscoveryStatus = "connected" | "link_only" | "unavailable" | "rate_limited" | "disabled";

type GlobalDiscoveryWork = {
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedByCount: number;
  topic: string | null;
  url: string;
  citable: false;
};

type GlobalDiscoveryResponse = {
  status: GlobalDiscoveryStatus;
  searchUrl: string;
  works: GlobalDiscoveryWork[];
  provider: "openalex";
  generatedAt: string;
};

type GlobalDiscoveryState = {
  phase: "idle" | "loading" | "ready" | "error";
  query: string;
  response: GlobalDiscoveryResponse | null;
  error: string;
};

type LivingReviewWatch = {
  watchId: string;
  query: string;
  collection: CollectionFilter;
  resultCount: number;
  newCount: number;
  active: boolean;
  lastCheckedAt: string | null;
};

type CitationMapResponse = {
  status: GlobalDiscoveryStatus;
  relationsStatus: "complete" | "partial" | "unavailable" | "not_requested";
  searchUrl: string;
  match: {
    status: "verified" | "candidate" | "unmatched";
    basis: "doi" | "title_year" | "title" | "none";
    requiresHumanReview: boolean;
    titleSimilarity: number | null;
    yearDelta: number | null;
    matchedOpenAlexId: string | null;
  };
  seed: null | {
    id: string;
    title: string;
    year: number | null;
    citedByCount: number;
    url: string;
    relation: "seed";
    topic?: string | null;
    authors?: string[];
    institutions?: string[];
    citable: false;
  };
  nodes: Array<{
    id: string;
    title: string;
    year: number | null;
    citedByCount: number;
    url: string;
    relation: "cites" | "cited_by" | "related";
    topic?: string | null;
    authors?: string[];
    institutions?: string[];
    citable: false;
  }>;
};

type CitationMapState = {
  phase: "idle" | "loading" | "ready" | "error";
  response: CitationMapResponse | null;
  error: string;
};

function isTraceableOpenAlexMatch(match: CitationMapResponse["match"] | null | undefined): boolean {
  return match?.status === "verified" && match.basis === "doi" && match.requiresHumanReview === false;
}

function tracedGlobalWorks(map: CitationMapResponse | null | undefined): GlobalDiscoveryWork[] {
  if (!map || map.status !== "connected" || !isTraceableOpenAlexMatch(map.match)) return [];
  return map.nodes.slice(0, 4).map((node) => ({
    id: node.id,
    doi: null,
    title: node.title,
    year: node.year,
    citedByCount: node.citedByCount,
    topic: node.topic ?? null,
    url: node.url,
    citable: false,
  }));
}

type PaperDetailData = {
  document: ResearchCardData;
  sections: Array<{
    id: string;
    sectionIndex: number | null;
    title: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    snippet: string;
  }>;
  evidence: Array<{
    id: string;
    sectionIndex: number | null;
    chunkIndex: number | null;
    sectionTitle?: string | null;
    pageStart?: number | null;
    pageEnd?: number | null;
    snippet: string;
    readerPageNumber?: number | null;
    readerAnchor?: string | null;
  }>;
  counts: {
    sections: number;
    chunks: number;
  };
  related?: ResearchCardData[];
  generatedAt?: string;
  readerAccess?: PaperReaderAccessSummary | null;
};

type PaperReaderAccessMode = "native_verified" | "source_hosted" | "restricted" | "metadata_only" | "unavailable";

type PaperReaderAccessSummary = {
  mode: PaperReaderAccessMode;
  statusLabel: string;
  pageReadableInSeedResearch: boolean;
  pageAnchor: string | null;
  readerUrl: string | null;
  sourceUrl: string | null;
};

type PaperReaderAccessPayload = {
  access?: {
    mode?: unknown;
    statusLabel?: unknown;
    sourceUrl?: unknown;
  } | null;
  pages?: Array<{
    pageNumber?: unknown;
    anchor?: unknown;
  }> | null;
};

type ResearchPassportEvidence = PaperDetailData["evidence"][number] & {
  englishSnippet: string | null;
};

type ResearchCaseReviewDecision = {
  evidenceId: string;
  source: string;
  pageAnchor: string;
  decision: "accepted" | "rejected";
  note: string;
  updatedAt: string;
};

type ActiveResearchCase = {
  caseId: string;
  question: string;
  status: "active" | "completed" | "archived";
  selectedSources: string[];
  state: Record<string, unknown>;
  reviews: ResearchCaseReviewDecision[];
  createdAt: string;
  updatedAt: string;
};

type WebMcpActivity = {
  tool: string;
  detail: string;
  completedAt: string;
};

type ResearchPassportArtifact = {
  version: "seed-research-passport-v1";
  passportId: string;
  createdAt: string;
  reviewedAt: string | null;
  stale: boolean;
  openedEvidenceIds: string[];
  reviewDecisions: Record<string, ResearchCaseReviewDecision>;
  runSteps: WebMcpActivity[];
  translationStatus: "ready" | "not_needed" | "unavailable";
  focus: string;
  gapLens: WebMcpGapLens;
  paper: ResearchCardData;
  evidence: ResearchPassportEvidence[];
  globalStatus: GlobalDiscoveryStatus;
  globalSearchUrl: string;
  globalWorks: GlobalDiscoveryWork[];
  candidateGap: {
    statement: string;
    missingValidation: string;
    nextVerificationQuery: string;
    localBasisEvidenceIds: string[];
    relationValidated: false;
  };
};

type ResearchPassportState = {
  phase: "idle" | "loading" | "ready" | "error";
  artifact: ResearchPassportArtifact | null;
  error: string;
};

type PaperWorkspaceItem = {
  id: string;
  source: string;
  documentId?: string | null;
  collection: CollectionFilter;
  paperCode?: string | null;
  note: string;
  labels: string[];
  updatedAt?: string;
};

type TranslationStatus = "idle" | "loading" | "ready" | "error";

type PaperTranslationState = {
  status: TranslationStatus;
  showingTranslation: boolean;
  segments: Record<string, string>;
  updatedAt?: number;
  error?: string;
};

type TranslationSegment = {
  id: string;
  text: string;
};

type PaperTranslationResponse = {
  sourceLanguage: "th";
  targetLanguage: "en";
  translations: TranslationSegment[];
  translatedAt: string;
};

type PathLevel = "foundation" | "applied" | "research";
type PathOutcome = "literature_review" | "study_plan" | "decision_brief";

const PATH_LEVEL_OPTIONS: ReadonlyArray<GlassMenuOption<PathLevel>> = [
  { value: "foundation", label: "New to the topic", description: "Start with concepts and vocabulary" },
  { value: "applied", label: "Working knowledge", description: "Compare methods and real evidence" },
  { value: "research", label: "Research-ready", description: "Prioritize gaps, validity, and transfer" },
];

const PATH_OUTCOME_OPTIONS: ReadonlyArray<GlassMenuOption<PathOutcome>> = [
  { value: "literature_review", label: "Literature review", description: "Map evidence and disagreements" },
  { value: "study_plan", label: "Study plan", description: "Build a sequenced learning path" },
  { value: "decision_brief", label: "Project brief", description: "Frame the next evidence-led experiment" },
];

type ResearchPath = {
  version: "civilmcp-research-path-v2";
  goal: string;
  level: PathLevel;
  outcome: PathOutcome;
  sourceCodes: string[];
  passportContext?: {
    passportId: string;
    source: string;
    evidenceIds: string[];
    gapLens: WebMcpGapLens;
    reviewedAt: string;
    globalLeadIds: string[];
    evidence: Array<{ id: string; pageStart: number; pageEnd: number; sectionTitle: string | null }>;
  } | null;
  adaptedFromGaps?: string[];
  coverage?: {
    status: "strong" | "limited";
    paperCount: number;
    message: string;
  };
  planningMode?: "model" | "retrieval_fallback";
  model?: "gpt-5.6-luna" | null;
  candidateGap: {
    status: "candidate_unvalidated";
    statement: string;
    basis: string;
    missingValidation: string[];
    noveltyEstablished: false;
  };
  nextStudyProtocol: {
    status: "draft_framework";
    researchQuestion: string;
    contextOrPopulation: string;
    dataNeeded: string[];
    method: string;
    validationPlan: string;
    falsificationCondition: string;
    evidenceBoundary: string;
  };
  timings?: { totalMs: number };
  generatedAt: string;
  stages: Array<{
    id: string;
    title: string;
    objective: string;
    checkpointQuestion?: string;
    concepts?: string[];
    prompt: string;
    papers: Array<{
      id: string;
      source: string;
      paperCode?: string | null;
      collection: CollectionFilter;
      title: string;
      summary: string;
      discipline?: string | null;
      pageLabel: string;
      evidenceCount: number;
    }>;
  }>;
  openAlex: {
    status: "connected" | "link_only" | "unavailable";
    searchUrl: string;
    works: Array<{
      id: string;
      title: string;
      year?: number | null;
      citedByCount: number;
      topic?: string | null;
      url: string;
    }>;
  };
  globalConnections?: {
    match: CitationMapResponse["match"];
    source: string;
    evidenceBoundary: string;
    leads: CitationMapResponse["nodes"];
  };
};

type ResearchPathCheckpointStatus = "needs_review" | "partial" | "understood";

type ResearchPathCheckpointAssessment = {
  version: "civilmcp-checkpoint-assessment-v1";
  stageId: string;
  status: ResearchPathCheckpointStatus;
  score: number;
  gradeAvailable?: boolean;
  assessmentMode?: "model" | "evidence_fallback";
  feedback: string;
  strengths: string[];
  gaps: string[];
  nextStep: string;
  evidence: CivilEvidenceItem[];
  model: "gpt-5.6-luna";
  assessedAt: string;
  timings?: { totalMs: number };
};

type NavItem = {
  id: MobileNavItem;
  label: string;
  icon: LucideIcon;
};

const PROMPT_STARTERS: Array<{ id: string; label: string; description: string; prompt: string; icon: LucideIcon }> = [
  {
    id: "construction-risk",
    label: "Construction risk",
    description: "Delay, finance, and schedule evidence",
    prompt: "Compare NCCE25_CEM14, NCCE25_CEM28, and NCCE25_CEM04. What delay, financial, and scheduling risks do they report? Cite exact pages and distinguish findings from inference.",
    icon: Building2,
  },
  {
    id: "road-safety",
    label: "Road safety",
    description: "Truck crashes and system factors",
    prompt: "Compare NCCE29_TRL40 and NCCE29_TRL42. What truck-crash and road-system factors lead to serious injury or death, where do findings agree or differ, and which findings are site-specific? Cite exact pages.",
    icon: ShieldCheck,
  },
  {
    id: "materials-methods",
    label: "Materials methods",
    description: "Tests, performance, and limitations",
    prompt: "Compare NCCE25_MAT06, NCCE25_MAT13, and NCCE25_MAT18. Contrast materials, test methods, performance measures, and limitations with exact-page citations.",
    icon: Layers3,
  },
  {
    id: "flood-mission",
    label: "Flood resilience",
    description: "Compare findings and transfer limits",
    prompt: "Review the evidence on flood-resilient infrastructure in Thailand. Compare methods and findings, identify what may transfer internationally, and cite the exact pages used.",
    icon: Route,
  },
];

const EXPERIENCE_OPTIONS: Array<MenuOption<ChatExperience>> = [
  {
    value: "answer",
    label: "Quick Answer",
    description: "Stream a direct answer with page citations",
    badge: "Recommended",
  },
  {
    value: "mission",
    label: "Evidence Review",
    description: "Find, compare, and verify evidence across papers",
  },
  {
    value: "learn",
    label: "Guided Learning",
    description: "Learn through questions grounded in the selected evidence",
  },
  {
    value: "research",
    label: "Deep Research",
    description: "Compare methods, conflicts, limitations, and gaps across papers",
    badge: "OpenAI",
  },
  {
    value: "automated",
    label: "Automated Research",
    description: "Decompose a goal into a bounded, auditable evidence program",
    badge: "Agent",
  },
];

const COLLECTION_OPTIONS: Array<MenuOption<CollectionFilter>> = [
  { value: "", label: "All", description: "All indexed papers" },
  { value: "ce_project", label: "Student Transport", description: "Student transport research projects" },
  { value: "ncce", label: "NCCE", description: "Conference proceedings" },
];

const FILTER_OPTIONS: Array<{ id: FeedFilter; label: string; icon: LucideIcon }> = [
  { id: "hot", label: "Top", icon: Flame },
  { id: "recent", label: "Recent", icon: Clock3 },
  { id: "evidence", label: "Evidence", icon: FileText },
  { id: "saved", label: "Saved", icon: Bookmark },
  { id: "for_you", label: "For you", icon: Sparkles },
  { id: "thai", label: "Thai discovery", icon: Database },
  { id: "ncce", label: "NCCE", icon: Building2 },
  { id: "ce_project", label: "Student Transport", icon: Layers3 },
];

const MAIN_NAV_ITEMS: NavItem[] = ([
  { id: "path", label: "Research Path", icon: Route },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "workspace", label: "Workspace", icon: TableProperties },
  { id: "history", label: "History", icon: History },
  { id: "shared", label: "Share & export", icon: Share2 },
  { id: "settings", label: "Settings", icon: Settings },
] satisfies NavItem[]).filter((item) => CIVILMCP_FEATURE_ACCESS[item.id].enabled);

const MOBILE_NAV_ITEMS = MAIN_NAV_ITEMS.filter((item) => item.id !== "shared");
const AUTH_RETURN_FEATURE_KEY = "seedy-auth-return-feature-v1";
const DEFAULT_AUTHENTICATED_FEATURE: MobileNavItem = CIVILMCP_FEATURE_ACCESS.explore.enabled ? "explore" : MAIN_NAV_ITEMS.find((item) => item.id !== "settings")?.id ?? "settings";

function isMobileNavItem(value: string | null | undefined): value is MobileNavItem {
  return Boolean(value && MAIN_NAV_ITEMS.some((item) => item.id === value));
}

const ACTION_LABELS = {
  share: "Copy share link",
  export: "Export JSON",
  brief: "Export evidence brief",
  clear: "Clear chat",
} as const;

const THAI_TEXT_PATTERN = /[\u0E00-\u0E7F]/;
const TRANSLATION_CACHE_KEY = "civilmcp-paper-translations-v1";
const PAPER_LANGUAGE_KEY = "civilmcp-paper-language-v1";
const RESEARCH_PATH_KEY = "civilmcp-research-path-v3";
const READER_REVIEW_RECEIPT_KEY = "seed-research-reader-review-receipt-v1";
const RESEARCH_PATH_DEMO_LEVEL: PathLevel = "foundation";
const RESEARCH_PATH_DEMO_OUTCOME: PathOutcome = "study_plan";
const ACTIVATION_KEY = "civilmcp-activation-v1";
const TRANSLATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const TRANSLATION_CACHE_MAX_PAPERS = 30;
const TRANSLATION_BATCH_MAX_SEGMENTS = 48;
const TRANSLATION_BATCH_MAX_CHARS = 14_000;

function researchPathStorageKey(userId: string): string {
  return `${RESEARCH_PATH_KEY}:${userId}`;
}

const GUEST_BILLING_STATE: BillingState = {
  plan: "guest",
  status: "active",
  creditsIncluded: null,
  creditsUsed: null,
  creditsRemaining: null,
  resetAt: null,
  premiumModels: true,
  openAccess: true,
  billingConfigured: false,
  priceThb: 0,
  hasStripeCustomer: false,
};

function normalizeCollection(value: string | undefined): CollectionFilter {
  return value === "ce_project" || value === "ncce" ? value : "";
}

function messageText(message: UIMessage | undefined): string {
  if (!message) return "";
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") return content;
  return (message.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[#*_`[\]]/g, "").trim().slice(0, 86);
}

function sessionTitleFromMessages(messages: UIMessage[], fallback = "Untitled chat"): string {
  const firstUser = messages.find((message) => message.role === "user");
  return cleanTitle(messageText(firstUser)) || fallback;
}

function formatSessionTime(value?: string | null): string {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getCivilMcpAnnotation(message: UIMessage): CivilMcpAnnotation | null {
  const annotations = (message as unknown as { annotations?: unknown }).annotations;
  if (!Array.isArray(annotations)) return null;
  const found = annotations.find(
    (annotation): annotation is CivilMcpAnnotation =>
      Boolean(annotation) &&
      typeof annotation === "object" &&
      (annotation as { type?: unknown }).type === "civilmcp_context",
  );
  return found ?? null;
}

function getCivilTraceAnnotation(message: UIMessage): CivilTraceAnnotation | null {
  const annotations = (message as unknown as { annotations?: unknown }).annotations;
  if (!Array.isArray(annotations)) return null;
  const found = annotations.find(
    (annotation): annotation is CivilTraceAnnotation =>
      Boolean(annotation) &&
      typeof annotation === "object" &&
      (annotation as { type?: unknown }).type === "civilmcp_trace",
  );
  return found ?? null;
}

function getCivilMemoryAnnotation(message: UIMessage): CivilMemoryAnnotation | null {
  const annotations = (message as unknown as { annotations?: unknown }).annotations;
  if (!Array.isArray(annotations)) return null;
  const found = annotations.find(
    (annotation): annotation is CivilMemoryAnnotation =>
      Boolean(annotation) &&
      typeof annotation === "object" &&
      (annotation as { type?: unknown }).type === "civilmcp_memory",
  );
  return found ?? null;
}

function getCivilMissionAnnotation(message: UIMessage): CivilMissionAnnotation | null {
  const annotations = (message as unknown as { annotations?: unknown }).annotations;
  if (!Array.isArray(annotations)) return null;
  const found = annotations.find(
    (annotation): annotation is CivilMissionAnnotation =>
      Boolean(annotation) &&
      typeof annotation === "object" &&
      (annotation as { type?: unknown }).type === "civilmcp_mission" &&
      Boolean((annotation as { artifact?: unknown }).artifact),
  );
  return found ?? null;
}

function citedEvidenceIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(/\[(E\d+)\]/gi)) {
    ids.add(match[1].toUpperCase());
  }
  return [...ids].slice(0, 8);
}

function pageLabel(item: CivilEvidenceItem): string {
  if (item.pageStart == null || item.pageEnd == null) return "";
  return item.pageStart === item.pageEnd ? `p.${item.pageStart}` : `p.${item.pageStart}-${item.pageEnd}`;
}

function boundedToolText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function researchCardYear(card: ResearchCardData): number | null {
  if (Number.isInteger(card.proceedingYear) && Number(card.proceedingYear) > 0) return Number(card.proceedingYear);
  const publishedYear = card.publishedAt ? Number.parseInt(card.publishedAt.slice(0, 4), 10) : Number.NaN;
  if (Number.isInteger(publishedYear) && publishedYear > 0) return publishedYear;
  const dateYear = card.date.match(/(?:19|20)\d{2}/)?.[0];
  return dateYear ? Number.parseInt(dateYear, 10) : null;
}

function safeReaderSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeReaderAnchor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const anchor = value
    .replace(/^#/, "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);
  return anchor || null;
}

function summarizePaperReaderAccess(
  payload: PaperReaderAccessPayload | null,
  source: string,
  expectedPageNumber?: number | null,
): PaperReaderAccessSummary | null {
  const rawMode = boundedToolText(payload?.access?.mode, 40);
  const mode: PaperReaderAccessMode | null = (
    ["native_verified", "source_hosted", "restricted", "metadata_only", "unavailable"] as const
  ).find((candidate) => candidate === rawMode) ?? null;
  if (!mode) return null;
  const page = (payload?.pages ?? []).find((candidate) => (
    expectedPageNumber == null || candidate.pageNumber === expectedPageNumber
  ));
  const pageAnchor = mode === "native_verified" && Number.isInteger(page?.pageNumber)
    ? safeReaderAnchor(page?.anchor)
    : null;
  const sourceUrl = safeReaderSourceUrl(payload?.access?.sourceUrl);
  const pageReadableInSeedResearch = mode === "native_verified" && pageAnchor != null;
  const readerPath = `/papers/${encodeURIComponent(source)}`;
  const readerUrl = pageReadableInSeedResearch
    ? `${readerPath}#${pageAnchor}`
    : mode === "source_hosted" || mode === "restricted"
      ? sourceUrl
      : null;
  const fallbackLabel: Record<PaperReaderAccessMode, string> = {
    native_verified: "Read in Seedy Research",
    source_hosted: "Open at official source",
    restricted: "Institutional access required",
    metadata_only: "Metadata only",
    unavailable: "Full text unavailable",
  };
  return {
    mode,
    statusLabel: boundedToolText(payload?.access?.statusLabel, 120) || fallbackLabel[mode],
    pageReadableInSeedResearch,
    pageAnchor,
    readerUrl,
    sourceUrl,
  };
}

function passportEvidencePage(item: PaperDetailData["evidence"][number]): string {
  if (item.pageStart == null || item.pageEnd == null) return "Page unavailable";
  return item.pageStart === item.pageEnd ? `p.${item.pageStart}` : `p.${item.pageStart}-${item.pageEnd}`;
}

function passportGapCopy(focus: string, gapLens: WebMcpGapLens) {
  const validationByLens: Record<WebMcpGapLens, string> = {
    method: "a comparable study design and measurement protocol",
    context: "a different geographic, regulatory, or institutional context",
    population: "a clearly defined population beyond the indexed Thai sample",
    outcome: "the same outcome definition and observation window",
    validation: "an independent replication or triangulation dataset",
  };
  const querySuffixByLens: Record<WebMcpGapLens, string> = {
    method: "comparable method measurement protocol",
    context: "cross-context comparative validation",
    population: "population external validation",
    outcome: "harmonized outcome comparative study",
    validation: "independent replication triangulation",
  };
  const condition = validationByLens[gapLens];
  return {
    statement: `Question to test against the selected evidence: how should this focus be evaluated under ${condition}?`,
    missingValidation: `Missing validation: ${condition}. Novelty and transferability have not been established.`,
    nextVerificationQuery: boundedToolText(`${focus} ${querySuffixByLens[gapLens]}`, 220),
  };
}

function passportGlobalStatusCopy(status: GlobalDiscoveryStatus, hasWorks: boolean): string {
  if (status === "connected") return hasWorks ? "Bounded OpenAlex metadata returned" : "No matching OpenAlex records found";
  if (status === "rate_limited") return "Global discovery not completed · rate limited";
  if (status === "link_only") return "Global metadata API not connected · search link available";
  if (status === "disabled") return "Global discovery disabled for this deployment";
  return "Global layer not checked · provider unavailable";
}

function researchPassportMarkdown(artifact: ResearchPassportArtifact): string {
  const acceptedEvidence = artifact.evidence.filter((item) => artifact.reviewDecisions[item.id]?.decision === "accepted");
  const lines = [
    `# Thai → Global Research Passport — ${boundedToolText(artifact.paper.title, 180)}`,
    "",
    `- Passport: ${artifact.passportId}`,
    `- Status: ${artifact.reviewedAt ? `Claim-level evidence reviewed ${artifact.reviewedAt}; candidate inference unvalidated` : "Draft · claim-level evidence review required"}`,
    `- Focus: ${artifact.focus}`,
    `- Thai source: ${artifact.paper.paperCode || artifact.paper.source}`,
    `- Collection: ${artifact.paper.collection || "all"}`,
    `- Page coverage: ${artifact.paper.pageLabel}`,
    `- Accepted evidence: ${acceptedEvidence.length}/${artifact.evidence.length}`,
    `- English bridge: ${artifact.translationStatus === "ready" ? "bounded rendering included" : artifact.translationStatus === "not_needed" ? "source excerpts already English" : "unavailable; original source excerpts retained"}`,
    "",
    "## Accepted page-reviewed Thai evidence",
    "",
    ...acceptedEvidence.flatMap((item) => [
      `### ${item.id} · ${passportEvidencePage(item)}`,
      item.sectionTitle ? `Section: ${boundedToolText(item.sectionTitle, 100)}` : "",
      artifact.reviewDecisions[item.id]?.note ? `Reviewer note: ${boundedToolText(artifact.reviewDecisions[item.id].note, 300)}` : "",
      `Source excerpt: ${boundedToolText(item.snippet, 360)}`,
      item.englishSnippet ? `English rendering: ${boundedToolText(item.englishSnippet, 360)}` : "",
      "",
    ]),
    "## Global discovery leads — metadata only",
    "",
    `Status: ${passportGlobalStatusCopy(artifact.globalStatus, artifact.globalWorks.length > 0)}`,
    "",
    ...(artifact.globalWorks.length
      ? artifact.globalWorks.map((work) => `- ${boundedToolText(work.title, 180)}${work.year ? ` (${work.year})` : ""} — ${work.url}`)
      : [`- No OpenAlex records were returned. Continue discovery: ${artifact.globalSearchUrl}`]),
    "",
    "## Candidate inference — human review required",
    "",
    artifact.candidateGap.statement,
    "",
    `Proposed local basis: ${artifact.candidateGap.localBasisEvidenceIds.join(", ")} · evidence relationship not validated`,
    "",
    artifact.candidateGap.missingValidation,
    "",
    `Next verification query: ${artifact.candidateGap.nextVerificationQuery}`,
    "",
    "## Evidence boundary",
    "",
    "Thai page-linked packets above may support claims after human review. OpenAlex records are discovery metadata only and were not used as evidence. This passport checks provenance boundaries, not scientific correctness or novelty.",
  ];
  return lines.join("\n");
}

type CitationAuditClaim = {
  text: string;
  evidenceIds: string[];
};

function citationAuditClaims(markdown: string): CitationAuditClaim[] {
  const seen = new Set<string>();
  const claims: CitationAuditClaim[] = [];
  for (const rawLine of markdown.split(/\n+/)) {
    const evidenceIds = citedEvidenceIds(rawLine);
    if (!evidenceIds.length) continue;
    const text = rawLine
      .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 420);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    claims.push({ text, evidenceIds });
    if (claims.length >= 8) break;
  }
  return claims;
}

function intentLabel(intent?: string | null): string {
  return {
    simple_lookup: "Direct lookup",
    compare: "Cross-paper comparison",
    summarize: "Research synthesis",
    methodology: "Methods review",
    citation_search: "Citation search",
  }[intent ?? ""] ?? "General research question";
}

function disciplineLabel(discipline?: string | null): string {
  if (!discipline) return "No discipline restriction";
  const labels: Record<string, string> = {
    unknown: "General research",
    science: "Science",
    life_sciences: "Life Sciences",
    physical_sciences: "Physical Sciences",
    health_sciences: "Health Sciences",
    social_sciences: "Social Sciences",
  };
  if (labels[discipline]) return labels[discipline];
  return discipline
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function discoveryProviderLabel(provider?: string | null): string {
  return {
    tci_thaijo: "ThaiJO",
    tci_citation: "TCI Citation Index",
    tnrr: "TNRR",
    thailis_tdc: "ThaiLIS / TDC",
    thai_conference: "Thai Conferences",
    thai_ir: "Thai Institutional Repositories",
  }[provider ?? ""] ?? "Thai source";
}

function collectionLabel(collection?: string): string {
  if (collection === "ncce") return "NCCE proceedings";
  if (collection === "ce_project") return "Student Transport projects";
  return "All citable collections";
}

function citationAuditMarkdown(
  annotation: CivilMcpAnnotation,
  markdown: string,
  question?: string,
): string {
  const evidenceItems = annotation.evidenceItems ?? [];
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceId.toUpperCase(), item]));
  const citedIds = citedEvidenceIds(markdown);
  const claims = citationAuditClaims(markdown);
  const lines = [
    "# Seedy Research evidence audit",
    "",
    `- Question: ${question?.trim() || "Not available"}`,
    `- Interpreted query: ${annotation.searchQuery?.trim() || question?.trim() || "Not available"}`,
    `- Bilingual concept expansion: ${annotation.queryExpansions?.length ? annotation.queryExpansions.join(", ") : "None applied"}`,
    `- Intent: ${intentLabel(annotation.intent)}`,
    `- Discipline: ${disciplineLabel(annotation.discipline)}`,
    `- Collection: ${collectionLabel(annotation.collection)}`,
    `- Retrieval: ${annotation.retrievalMode === "lexical_fallback" ? "Keyword fallback" : annotation.retrievalMode === "semantic" ? "Semantic" : "Unavailable"}`,
    `- Generated: ${new Date().toISOString()}`,
    "",
    "## Claim ledger",
    "",
    ...(claims.length
      ? claims.flatMap((claim, index) => [
          `${index + 1}. ${claim.text}`,
          `   - Evidence: ${claim.evidenceIds.map((id) => evidenceById.has(id) ? `[${id}] linked` : `[${id}] unresolved`).join("; ")}`,
        ])
      : ["- No [E#] citation markers were found in the answer."]),
    "",
    "## Evidence provenance",
    "",
    ...(citedIds.length
      ? citedIds.map((id) => {
          const item = evidenceById.get(id);
          if (!item) return `- [${id}] Unresolved citation marker`;
          return `- [${id}] ${item.source}${pageLabel(item) ? ` · ${pageLabel(item)}` : " · page unavailable"}${item.sectionTitle ? ` · ${item.sectionTitle}` : ""}${item.snippet ? `\n  - ${item.snippet}` : ""}`;
        })
      : evidenceItems.map((item) => `- [${item.evidenceId}] Retrieved but not cited · ${item.source}${pageLabel(item) ? ` · ${pageLabel(item)}` : ""}`)),
    "",
    "_This audit checks citation resolution and page provenance, not scientific correctness. Human review remains required._",
  ];
  return lines.join("\n");
}

function missionVerdictLabel(status: MissionVerdict): string {
  return {
    supported: "Supported",
    mixed: "Mixed evidence",
    conflicting: "Conflicting evidence",
    insufficient: "Insufficient evidence",
  }[status];
}

function evidenceBriefMarkdown(annotation: CivilMissionAnnotation, evidenceItems: CivilEvidenceItem[] = []): string {
  const artifact = annotation.artifact;
  const lines = [
    `# ${artifact.title}`,
    "",
    `> ${artifact.version} · ${new Date().toISOString()}`,
    "",
    `**Research question:** ${artifact.question}`,
    "",
    ...(artifact.automation
      ? [
          "## Automated research program",
          "",
          artifact.automation.objective,
          "",
          "### Questions investigated",
          ...artifact.automation.subquestions.map((item, index) => `${index + 1}. ${item}`),
          "",
          "### Execution log",
          ...artifact.automation.tasks.map(
            (task) => `- **${task.name} — ${task.status}:** ${task.objective}${task.evidenceIds.length ? ` ${task.evidenceIds.map((id) => `[${id}]`).join(" ")}` : ""}`,
          ),
          "",
          `**Dossier includes:** ${artifact.automation.deliverables.join(" · ")}`,
          "",
        ]
      : []),
    "## Executive summary",
    "",
    artifact.executiveSummary,
    "",
    `## Evidence verdict — ${missionVerdictLabel(artifact.verdict.status)}`,
    "",
    artifact.verdict.rationale,
    "",
    "## Evidence matrix",
    "",
    "| Finding | Interpretation | Method / context | Limitation | Evidence |",
    "| --- | --- | --- | --- | --- |",
    ...artifact.matrix.map(
      (row) =>
        `| ${row.finding.replaceAll("|", "/")} | ${row.interpretation.replaceAll("|", "/")} | ${row.methodOrContext.replaceAll("|", "/")} | ${row.limitation.replaceAll("|", "/")} | ${row.evidenceIds.map((id) => `[${id}]`).join(", ")} |`,
    ),
    "",
    "## Thailand → World bridge",
    "",
    "### Transferable signals",
    ...artifact.worldBridge.transferableSignals.map((item) => `- ${item}`),
    "",
    "### Thai context to preserve",
    ...artifact.worldBridge.thaiContext.map((item) => `- ${item}`),
    "",
    "### Validate before transfer",
    ...artifact.worldBridge.validateNext.map((item) => `- ${item}`),
    "",
    "## Learning checkpoints",
    "",
    artifact.learning.objective,
    "",
    ...artifact.learning.checkpoints.flatMap((checkpoint, index) => [
      `${index + 1}. ${checkpoint.question} ${checkpoint.evidenceIds.map((id) => `[${id}]`).join(" ")}`,
      `   - Hint: ${checkpoint.hint}`,
    ]),
    "",
    "## Trust and provenance",
    "",
    `- Evidence packets: ${artifact.trust.evidenceCount}`,
    `- Unique paper sources: ${artifact.trust.sourceCount}`,
    `- Exact-page coverage: ${artifact.trust.exactPageCount}/${artifact.trust.evidenceCount} (${artifact.trust.pageCoveragePercent}%)`,
    `- Bounded run: ${artifact.agentRun.toolCalls}/${artifact.agentRun.toolCallLimit} tool calls, step limit ${artifact.agentRun.stepLimit}`,
    "",
    "## Evidence sources",
    "",
    ...(evidenceItems.length
      ? evidenceItems.map((item) => `- [${item.evidenceId}] ${item.source}${pageLabel(item) ? ` · ${pageLabel(item)}` : ""}${item.sectionTitle ? ` · ${item.sectionTitle}` : ""}`)
      : ["- See the linked Seedy Research session for source packets and exact-page evidence."]),
    "",
    "_For research use. Not professional advice._",
  ];
  return lines.join("\n");
}

function cardKey(card: ResearchCardData): string {
  const doi = card.doi
    ?.trim()
    .toLocaleLowerCase("en")
    .replace(/^doi:\s*/, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  if (doi) return `doi:${doi}`;
  return card.source || card.id;
}

function isResearchCardData(value: unknown): value is ResearchCardData {
  const card = value as Partial<ResearchCardData>;
  return Boolean(card && typeof card === "object" && typeof card.id === "string" && typeof card.title === "string" && typeof card.source === "string");
}

function normalizeActiveResearchCase(value: unknown): ActiveResearchCase | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.caseId !== "string"
    || typeof candidate.question !== "string"
    || !["active", "completed", "archived"].includes(String(candidate.status))
  ) return null;
  const reviews = Array.isArray(candidate.reviews)
    ? candidate.reviews.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const review = value as Record<string, unknown>;
        if (
          typeof review.evidenceId !== "string"
          || typeof review.source !== "string"
          || typeof review.pageAnchor !== "string"
          || !["accepted", "rejected"].includes(String(review.decision))
        ) return [];
        return [{
          evidenceId: review.evidenceId,
          source: review.source,
          pageAnchor: review.pageAnchor,
          decision: review.decision as "accepted" | "rejected",
          note: typeof review.note === "string" ? review.note : "",
          updatedAt: typeof review.updatedAt === "string" ? review.updatedAt : new Date(0).toISOString(),
        }];
      })
    : [];
  return {
    caseId: candidate.caseId,
    question: candidate.question,
    status: candidate.status as ActiveResearchCase["status"],
    selectedSources: Array.isArray(candidate.selectedSources) ? candidate.selectedSources.map(String).slice(0, 50) : [],
    state: candidate.state && typeof candidate.state === "object" && !Array.isArray(candidate.state)
      ? candidate.state as Record<string, unknown>
      : {},
    reviews,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
}

function isResearchPath(value: unknown): value is ResearchPath {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResearchPath>;
  return candidate.version === "civilmcp-research-path-v2"
    && typeof candidate.goal === "string"
    && Array.isArray(candidate.stages)
    && candidate.candidateGap?.status === "candidate_unvalidated"
    && candidate.candidateGap.noveltyEstablished === false
    && typeof candidate.candidateGap.statement === "string"
    && Array.isArray(candidate.candidateGap.missingValidation)
    && candidate.nextStudyProtocol?.status === "draft_framework"
    && typeof candidate.nextStudyProtocol.researchQuestion === "string"
    && Array.isArray(candidate.nextStudyProtocol.dataNeeded);
}

function isResearchPathCheckpointAssessment(value: unknown): value is ResearchPathCheckpointAssessment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResearchPathCheckpointAssessment>;
  return candidate.version === "civilmcp-checkpoint-assessment-v1"
    && typeof candidate.stageId === "string"
    && (candidate.status === "needs_review" || candidate.status === "partial" || candidate.status === "understood")
    && typeof candidate.score === "number"
    && typeof candidate.feedback === "string"
    && Array.isArray(candidate.strengths)
    && Array.isArray(candidate.gaps)
    && Array.isArray(candidate.evidence);
}

function looksLikeFileCode(value: string): boolean {
  return /^(Y\d{4}|NCCE\d{2})[_-]/i.test(value.trim());
}

function displayTitle(card: ResearchCardData): string {
  if (!looksLikeFileCode(card.title)) return card.title;
  return card.paperCode || card.title;
}

function displaySummary(card: ResearchCardData): string {
  return card.summary.includes("ยังไม่มี summary ที่อ่านได้")
    ? "Read the evidence or ask a cited question about this paper."
    : card.summary;
}

function paperTranslationSegments(card: ResearchCardData, detail?: PaperDetailData | null): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const add = (id: string, text: string | null | undefined) => {
    const cleaned = text?.trim();
    if (cleaned && THAI_TEXT_PATTERN.test(cleaned)) segments.push({ id, text: cleaned });
  };

  add("paper.title", displayTitle(card));
  add("paper.summary", displaySummary(card));
  card.tags.slice(0, 8).forEach((tag, index) => add(`paper.tag.${index}`, tag));

  detail?.sections.slice(0, 14).forEach((section) => {
    add(`section.${section.id}.title`, section.title);
    add(`section.${section.id}.snippet`, section.snippet);
  });
  detail?.evidence.slice(0, 8).forEach((item) => {
    add(`evidence.${item.id}.title`, item.sectionTitle);
    add(`evidence.${item.id}.snippet`, item.snippet);
  });

  return segments;
}

function contentLanguage(value: string): "en" | "th" {
  return THAI_TEXT_PATTERN.test(value) ? "th" : "en";
}

function useDropdownKeyboard({
  open,
  onOpen,
  onClose,
  preferredIndex = 0,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  preferredIndex?: number;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pendingIndexRef = useRef(preferredIndex);

  const menuItems = useCallback(
    () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem'], [role='menuitemradio']") ?? []).filter(
        (item) => !item.disabled,
      ),
    [],
  );

  const focusItem = useCallback(
    (index: number) => {
      const items = menuItems();
      if (!items.length) return;
      items[Math.max(0, Math.min(index, items.length - 1))]?.focus();
    },
    [menuItems],
  );

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => focusItem(pendingIndexRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [focusItem, open]);

  const openMenu = (index = preferredIndex) => {
    pendingIndexRef.current = index;
    onOpen();
  };

  const closeMenu = (returnFocus = true) => {
    onClose();
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowUp" ? Number.MAX_SAFE_INTEGER : preferredIndex);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusItem((currentIndex + direction + items.length) % items.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusItem(event.key === "Home" ? 0 : items.length - 1);
    } else if (event.key === "Tab") {
      onClose();
    }
  };

  return { triggerRef, menuRef, openMenu, closeMenu, onTriggerKeyDown, onMenuKeyDown };
}

function translatedPaperText(
  translation: PaperTranslationState | undefined,
  segmentId: string,
  original: string,
): string {
  const translated = translation?.showingTranslation ? translation.segments[segmentId] || original : original;
  if (!translation?.showingTranslation || segmentId !== "paper.title") return translated;

  const parts = translated.split(" / ").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return translated;
  const normalized = parts.map((part) => part.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, ""));
  return normalized[0] && normalized[0] === normalized[1] ? parts[0] : translated;
}

function translationCacheEntry(value: unknown): Pick<PaperTranslationState, "segments" | "updatedAt"> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { segments?: unknown; updatedAt?: unknown };
  if (!candidate.segments || typeof candidate.segments !== "object" || typeof candidate.updatedAt !== "number") return null;

  const segments = Object.fromEntries(
    Object.entries(candidate.segments).filter(
      (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string" && Boolean(entry[1].trim()),
    ),
  );
  return Object.keys(segments).length ? { segments, updatedAt: candidate.updatedAt } : null;
}

function ClientLiquidLayer(_props: {
  prominent?: boolean;
  cornerRadius?: number;
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  className?: string;
}) {
  // Static CSS surfaces preserve the visual hierarchy without mounting a
  // pointer-reactive SVG filter for every control.
  return null;
}

function GlassButton({
  children,
  className = "",
  active = false,
  disabled = false,
  buttonRef,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <span className={`glassWrap ${active ? "active" : ""} ${disabled ? "disabled" : ""} ${className}`}>
      <ClientLiquidLayer />
      <button ref={buttonRef} {...buttonProps} type={buttonProps.type ?? "button"} disabled={disabled} className="glassButton">
        {children}
      </button>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronDown className={`chevronIcon ${open ? "open" : ""}`} aria-hidden />;
}

function GlassDropdown({
  children,
  align = "left",
  onDismiss,
}: {
  children: ReactNode;
  align?: "left" | "right";
  onDismiss: () => void;
}) {
  return (
    <>
      <div
        className="dropdownDismissLayer"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
        }}
      />
      <div className={`glassDropdown ${align === "right" ? "right" : ""}`}>
        <ClientLiquidLayer
          prominent
          className="liquidPanelEffect"
          cornerRadius={18}
          displacementScale={34}
          blurAmount={0.05}
          saturation={136}
          aberrationIntensity={1.2}
          elasticity={0.12}
        />
        <div className="dropdownSurface">{children}</div>
      </div>
    </>
  );
}

function GlassSelect<T extends string>({
  id,
  label,
  value,
  options,
  icon: Icon,
  className = "",
  openDropdown,
  setOpenDropdown,
  onChange,
}: {
  id: Exclude<OpenDropdown, null>;
  label: string;
  value: T;
  options: Array<MenuOption<T>>;
  icon?: LucideIcon;
  className?: string;
  openDropdown: OpenDropdown;
  setOpenDropdown: (dropdown: OpenDropdown) => void;
  onChange: (value: T) => void;
}) {
  const open = openDropdown === id;
  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const menuId = `${id}-menu`;
  const keyboard = useDropdownKeyboard({
    open,
    preferredIndex: selectedIndex,
    onOpen: () => setOpenDropdown(id),
    onClose: () => setOpenDropdown(null),
  });

  return (
    <div className={`selectControl ${className}`} data-dropdown-root>
      <GlassButton
        buttonRef={keyboard.triggerRef}
        className="selectTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onKeyDown={keyboard.onTriggerKeyDown}
        onClick={() => (open ? keyboard.closeMenu(false) : keyboard.openMenu(selectedIndex))}
      >
        {Icon ? <Icon className="controlIcon" aria-hidden /> : null}
        <span className="controlLabel">{label}</span>
        <span className="controlValue">{selected.label}</span>
        <Chevron open={open} />
      </GlassButton>

      {open ? (
        <GlassDropdown onDismiss={() => keyboard.closeMenu()}>
          <div className="menuTitle">{label}</div>
          <div ref={keyboard.menuRef} id={menuId} className="menuOptions" role="menu" aria-label={label} onKeyDown={keyboard.onMenuKeyDown}>
            {options.map((option) => {
              const selectedOption = option.value === value;
              return (
                <button
                  key={`${id}-${option.value || "all"}`}
                  type="button"
                  role="menuitemradio"
                  className={`menuOption ${selectedOption ? "selected" : ""}`}
                  aria-checked={selectedOption}
                  onClick={() => {
                    onChange(option.value);
                    keyboard.closeMenu();
                  }}
                >
                  <span>
                    <span className="optionLabel">
                      {option.label}
                      {option.badge ? <small className="optionBadge">{option.badge}</small> : null}
                    </span>
                    {option.description ? <span className="optionDescription">{option.description}</span> : null}
                  </span>
                  <span className="checkMark" aria-hidden>
                    {selectedOption ? <Check size={15} strokeWidth={2.6} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </GlassDropdown>
      ) : null}
    </div>
  );
}

function PaperLanguageToggle({
  language,
  isTranslating,
  onChange,
}: {
  language: PaperLanguage;
  isTranslating: boolean;
  onChange: (language: PaperLanguage) => void;
}) {
  return (
    <div className="paperLanguageControl" role="group" aria-label="Paper language">
      <span className="paperLanguageLabel">
        <Languages size={16} strokeWidth={2.2} aria-hidden />
        <span>Paper language</span>
      </span>
      <span className="paperLanguageSegments">
        <ClientLiquidLayer cornerRadius={12} displacementScale={18} blurAmount={0.03} saturation={122} />
        <button
          type="button"
          className={language === "th" ? "active" : ""}
          aria-pressed={language === "th"}
          aria-label="Show Thai original"
          onClick={() => onChange("th")}
        >
          TH
        </button>
        <button
          type="button"
          className={language === "en" ? "active" : ""}
          aria-pressed={language === "en"}
          aria-label="Translate papers to English"
          onClick={() => onChange("en")}
        >
          EN
        </button>
      </span>
      <span className="paperLanguageState" aria-live="polite">
        {isTranslating ? (
          <RefreshCw className="paperLanguageBusy" size={15} strokeWidth={2.2} aria-hidden />
        ) : (
          <Check size={15} strokeWidth={2.4} aria-hidden />
        )}
        <span className="srOnly">{isTranslating ? "Translating visible papers" : "Paper language ready"}</span>
      </span>
    </div>
  );
}

function ActionsMenu({
  openDropdown,
  setOpenDropdown,
  copyShareLink,
  exportSession,
  exportEvidenceBrief,
  clearConversation,
  canExportEvidenceBrief,
  isReady,
  isLoading,
}: {
  openDropdown: OpenDropdown;
  setOpenDropdown: (dropdown: OpenDropdown) => void;
  copyShareLink: () => void;
  exportSession: () => void;
  exportEvidenceBrief: () => void;
  clearConversation: () => void;
  canExportEvidenceBrief: boolean;
  isReady: boolean;
  isLoading: boolean;
}) {
  const open = openDropdown === "actions";
  const [confirmClear, setConfirmClear] = useState(false);
  const keyboard = useDropdownKeyboard({
    open,
    onOpen: () => setOpenDropdown("actions"),
    onClose: () => setOpenDropdown(null),
  });

  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  const actions: Array<{
    key: keyof typeof ACTION_LABELS;
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    disabled: boolean;
    danger?: boolean;
  }> = [
    { key: "share", icon: Copy, label: ACTION_LABELS.share, onClick: copyShareLink, disabled: !isReady || isLoading },
    { key: "export", icon: Download, label: ACTION_LABELS.export, onClick: exportSession, disabled: !isReady },
    {
      key: "brief",
      icon: FileText,
      label: ACTION_LABELS.brief,
      onClick: exportEvidenceBrief,
      disabled: !isReady || !canExportEvidenceBrief,
    },
    { key: "clear", icon: Trash2, label: ACTION_LABELS.clear, onClick: clearConversation, disabled: isLoading, danger: true },
  ];
  const closeActions = () => {
    setConfirmClear(false);
    keyboard.closeMenu();
  };

  return (
    <div className="selectControl actionControl" data-dropdown-root>
      <GlassButton
        buttonRef={keyboard.triggerRef}
        className="actionsTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "actions-menu" : undefined}
        aria-label="Session actions"
        onKeyDown={keyboard.onTriggerKeyDown}
        onClick={() => (open ? keyboard.closeMenu(false) : keyboard.openMenu())}
      >
        <SlidersHorizontal className="controlIcon" aria-hidden />
        <span className="controlValue">Actions</span>
        <Chevron open={open} />
      </GlassButton>
      {open ? (
        <GlassDropdown align="right" onDismiss={() => keyboard.closeMenu()}>
          <div className="menuTitle">Session actions</div>
          <div ref={keyboard.menuRef} id="actions-menu" className="menuOptions" role="menu" aria-label="Session actions" onKeyDown={keyboard.onMenuKeyDown}>
            {actions.map((action) => {
              const Icon = action.icon;
              const isClear = action.key === "clear";
              return (
                <div key={action.key}>
                  <button
                    type="button"
                    role="menuitem"
                    className={`menuOption actionOption ${action.danger ? "danger" : ""}`}
                    disabled={action.disabled}
                    aria-expanded={isClear ? confirmClear : undefined}
                    onClick={() => {
                      if (isClear && !confirmClear) {
                        setConfirmClear(true);
                        return;
                      }
                      action.onClick();
                      closeActions();
                    }}
                  >
                    <span className="menuOptionInline">
                      <Icon size={16} strokeWidth={2.2} aria-hidden />
                      <span>
                        <span className="optionLabel">{confirmClear && isClear ? "Confirm clear chat" : action.label}</span>
                        {isClear ? <span className="optionDescription">Remove messages from the current session.</span> : null}
                      </span>
                    </span>
                  </button>
                  {isClear && confirmClear ? (
                    <button type="button" role="menuitem" className="menuOption actionOption" onClick={() => setConfirmClear(false)}>
                      <span className="menuOptionInline">
                        <X size={16} strokeWidth={2.2} aria-hidden />
                        <span className="optionLabel">Cancel</span>
                      </span>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </GlassDropdown>
      ) : null}
    </div>
  );
}

function PromptMenu({
  openDropdown,
  setOpenDropdown,
  setDraft,
}: {
  openDropdown: OpenDropdown;
  setOpenDropdown: (dropdown: OpenDropdown) => void;
  setDraft: (prompt: string) => void;
}) {
  const open = openDropdown === "examples";
  const keyboard = useDropdownKeyboard({
    open,
    onOpen: () => setOpenDropdown("examples"),
    onClose: () => setOpenDropdown(null),
  });

  return (
    <div className="promptMenu" data-dropdown-root>
      <GlassButton
        buttonRef={keyboard.triggerRef}
        className="promptTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "prompt-menu" : undefined}
        aria-label="Prompt starters"
        onKeyDown={keyboard.onTriggerKeyDown}
        onClick={() => (open ? keyboard.closeMenu(false) : keyboard.openMenu())}
      >
        <Sparkles className="controlIcon" aria-hidden />
        <span>Examples</span>
      </GlassButton>
      {open ? (
        <GlassDropdown onDismiss={() => keyboard.closeMenu()}>
          <div className="menuTitle">Research starters</div>
          <div ref={keyboard.menuRef} id="prompt-menu" className="menuOptions promptOptions" role="menu" aria-label="Prompt examples" onKeyDown={keyboard.onMenuKeyDown}>
            {PROMPT_STARTERS.map((starter) => {
              const Icon = starter.icon;
              return (
                <button
                  key={starter.id}
                  type="button"
                  role="menuitem"
                  className="menuOption promptOption"
                  onClick={() => {
                    setDraft(starter.prompt);
                    keyboard.closeMenu();
                  }}
                >
                  <span className="promptOptionIcon"><Icon size={16} strokeWidth={2.1} aria-hidden /></span>
                  <span className="promptOptionCopy">
                    <span className="optionLabel">{starter.label}</span>
                    <span className="optionDescription">{starter.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </GlassDropdown>
      ) : null}
    </div>
  );
}

function CitationIntegrityPanel({
  annotation,
  markdown,
  question,
  onOpenEvidence,
}: {
  annotation: CivilMcpAnnotation | null;
  markdown: string;
  question?: string;
  onOpenEvidence: (item: CivilEvidenceItem) => void;
}) {
  if (!annotation) return null;

  const evidenceItems = annotation.evidenceItems ?? [];
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceId.toUpperCase(), item]));
  const citedIds = citedEvidenceIds(markdown);
  const resolvedIds = citedIds.filter((id) => evidenceById.has(id));
  const unresolvedIds = citedIds.filter((id) => !evidenceById.has(id));
  const citedEvidence = resolvedIds.map((id) => evidenceById.get(id)).filter((item): item is CivilEvidenceItem => Boolean(item));
  const exactPageCount = citedEvidence.filter((item) => Boolean(pageLabel(item))).length;
  const sourceCount = new Set(citedEvidence.map((item) => item.source)).size;
  const claims = citationAuditClaims(markdown);
  const status = !citedIds.length || unresolvedIds.length
    ? "review"
    : exactPageCount === citedEvidence.length
      ? "complete"
      : "partial";
  const statusLabel = status === "complete"
    ? "Provenance complete"
    : status === "partial"
      ? "Some pages unavailable"
      : citedIds.length
        ? "Citation review needed"
        : "No citation markers";
  const searchQuery = annotation.searchQuery?.trim() || question?.trim() || "Current question";

  const exportAudit = () => {
    const blob = new Blob([citationAuditMarkdown(annotation, markdown, question)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seed-research-evidence-audit-${Date.now()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    trackProductEvent("evidence_export", { format: "citation_audit", traceId: annotation.traceId ?? "" });
  };

  return (
    <details className={`citationAudit ${status}`} aria-label="Evidence audit">
      <summary>
        <span className="citationAuditIcon"><ShieldCheck size={17} strokeWidth={2.2} aria-hidden /></span>
        <span className="citationAuditTitle">
          <strong>Evidence audit</strong>
          <small>{statusLabel}</small>
        </span>
        <span className="citationAuditSummary">
          {citedIds.length ? `${resolvedIds.length}/${citedIds.length} linked` : "Review"}
        </span>
        <ChevronDown className="citationAuditChevron" size={16} strokeWidth={2.2} aria-hidden />
      </summary>
      <div className="citationAuditBody">
        <div className="citationAuditMetrics" aria-label="Citation provenance metrics">
          <span><strong>{resolvedIds.length}/{citedIds.length}</strong> citation IDs resolve</span>
          <span><strong>{exactPageCount}</strong> exact-page links</span>
          <span><strong>{sourceCount}</strong> papers cited</span>
        </div>

        <section className="citationAuditScope" aria-label="Search scope">
          <div className="citationAuditSectionTitle">
            <Search size={15} strokeWidth={2.2} aria-hidden />
            <strong>Search scope</strong>
          </div>
          <p>{searchQuery}</p>
          <div className="citationAuditChips">
            <span>{intentLabel(annotation.intent)}</span>
            <span>{disciplineLabel(annotation.discipline)}</span>
            <span>{collectionLabel(annotation.collection)}</span>
            <span>{annotation.retrievalMode === "lexical_fallback" ? "Keyword fallback" : annotation.retrievalMode === "semantic" ? "Semantic retrieval" : "Retrieval unavailable"}</span>
            {annotation.queryExpansions?.map((term) => <span key={term}>Expanded · {term}</span>)}
            {annotation.sectionsUsed != null || annotation.chunksUsed != null ? (
              <span>{(annotation.sectionsUsed ?? 0) + (annotation.chunksUsed ?? 0)} context packets inspected</span>
            ) : null}
          </div>
        </section>

        <section className="citationClaimLedger" aria-label="Claim ledger">
          <div className="citationAuditSectionTitle">
            <FileText size={15} strokeWidth={2.2} aria-hidden />
            <strong>Claim ledger</strong>
          </div>
          {claims.length ? (
            <ol>
              {claims.map((claim, index) => (
                <li key={`${claim.text}-${index}`}>
                  <p>{claim.text}</p>
                  <div>
                    {claim.evidenceIds.map((id) => {
                      const item = evidenceById.get(id);
                      return item ? (
                        <button key={id} type="button" onClick={() => onOpenEvidence(item)}>
                          [{id}] {pageLabel(item) || "Page unavailable"}
                        </button>
                      ) : <span key={id} className="unresolved">[{id}] unresolved</span>;
                    })}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="citationAuditWarning" role="note">
              <TriangleAlert size={16} strokeWidth={2.1} aria-hidden />
              <span>The answer has no [E#] citation markers. Treat it as unverified until evidence is linked.</span>
            </div>
          )}
          {unresolvedIds.length ? (
            <div className="citationAuditWarning" role="alert">
              <TriangleAlert size={16} strokeWidth={2.1} aria-hidden />
              <span>Unresolved citation markers: {unresolvedIds.map((id) => `[${id}]`).join(", ")}.</span>
            </div>
          ) : null}
        </section>

        <div className="citationAuditFooter">
          <p>Checks citation links and page provenance—not scientific correctness. Human review remains required.</p>
          <button type="button" onClick={exportAudit}>
            <Download size={15} strokeWidth={2.2} aria-hidden />
            <span>Export audit</span>
          </button>
        </div>
      </div>
    </details>
  );
}

function EvidenceCards({
  annotation,
  markdown,
  onOpenEvidence,
}: {
  annotation: CivilMcpAnnotation | null;
  markdown: string;
  onOpenEvidence: (item: CivilEvidenceItem) => void;
}) {
  const evidenceItems = annotation?.evidenceItems ?? [];
  if (evidenceItems.length) {
    return (
      <div className="evidenceGrid" aria-label="Evidence citations">
        {evidenceItems.map((item) => (
          <button
            key={item.evidenceId}
            type="button"
            className="evidenceCard"
            onClick={() => onOpenEvidence(item)}
            aria-label={`Open ${item.evidenceId} in ${item.source}${pageLabel(item) ? ` at ${pageLabel(item)}` : ""}`}
          >
            <div className="evidenceTopline">
              <span className="evidenceId">[{item.evidenceId}]</span>
              <span className="evidenceSource">{item.source}</span>
            </div>
            <div className="evidenceMeta">
              {item.collection ? <span>{item.collection}</span> : null}
              {item.paperCode ? <span>{item.paperCode}</span> : null}
              {pageLabel(item) ? <span>{pageLabel(item)}</span> : null}
            </div>
            {item.sectionTitle ? <p className="evidenceSection">{item.sectionTitle}</p> : null}
            {item.snippet ? <p className="evidenceSnippet">{item.snippet}</p> : null}
            <span className="evidenceOpen">Open paper evidence</span>
          </button>
        ))}
      </div>
    );
  }

  const ids = citedEvidenceIds(markdown);
  if (!ids.length) return null;

  return (
    <div className="evidenceFallback" aria-label="Evidence markers">
      {ids.map((id) => (
        <span key={id}>[{id}] cited in answer</span>
      ))}
    </div>
  );
}

function RetrievalNotice({ annotation }: { annotation: CivilMcpAnnotation | null }) {
  if (!annotation?.retrievalDegraded || annotation.retrievalMode !== "lexical_fallback") return null;
  return (
    <div className="retrievalNotice" role="status" aria-label="Keyword search fallback active">
      <TriangleAlert size={16} strokeWidth={2.1} aria-hidden />
      <div>
        <strong>Keyword search fallback active</strong>
        <span>Semantic matching is temporarily unavailable. Results may be narrower, but every citation still opens to the indexed source page.</span>
      </div>
    </div>
  );
}

function AgenticMissionCard({
  annotation,
  onAsk,
  onExport,
}: {
  annotation: CivilMissionAnnotation;
  onAsk: (prompt: string) => void;
  onExport: () => void;
}) {
  const artifact = annotation.artifact;
  const verdictLabel = missionVerdictLabel(artifact.verdict.status);
  const isDeepResearch = artifact.experience === "research";
  const isAutomatedResearch = artifact.experience === "automated";
  const artifactLabel = isAutomatedResearch
    ? "Automated Research Dossier"
    : isDeepResearch
      ? "Deep Research Brief"
      : "Evidence Review";
  return (
    <section className="missionArtifact" aria-label={artifactLabel}>
      <div className="missionHeader">
        <div>
          <span className="missionEyebrow">
            {isAutomatedResearch ? "Open Access · Automated Research" : isDeepResearch ? "OpenAI · Deep Research" : "Evidence Review"}
          </span>
          <h3>{artifact.title}</h3>
        </div>
        <span className={`missionVerdict ${artifact.verdict.status}`}>{verdictLabel}</span>
      </div>

      <div className="missionTrust" aria-label="Evidence trust metrics">
        <span><strong>{artifact.trust.evidenceCount}</strong> evidence packets</span>
        <span><strong>{artifact.trust.sourceCount}</strong> sources</span>
        <span><strong>{artifact.trust.pageCoveragePercent}%</strong> exact-page coverage</span>
        <span><strong>{artifact.agentRun.toolCalls}/{artifact.agentRun.toolCallLimit}</strong> bounded tool calls</span>
      </div>

      {isAutomatedResearch && artifact.automation ? (
        <section className="missionSection automationProgram" aria-label="Automated research program">
          <div className="missionSectionHeading">
            <div>
              <span>Research program</span>
              <p>{artifact.automation.objective}</p>
            </div>
          </div>
          <div className="automationProgramLayout">
            <div>
              <strong>Questions investigated</strong>
              <ol>
                {artifact.automation.subquestions.map((question) => <li key={question}>{question}</li>)}
              </ol>
            </div>
            <div>
              <strong>Execution</strong>
              <ol className="automationTasks">
                {artifact.automation.tasks.map((task) => (
                  <li key={task.name} className={task.status}>
                    <span>{task.name}</span>
                    <p>{task.objective}</p>
                    <small>
                      {task.status === "complete" ? "Complete" : "Limited"}
                      {task.evidenceIds.length ? ` · ${task.evidenceIds.map((id) => `[${id}]`).join(" ")}` : ""}
                    </small>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="automationDeliverables">
            <strong>Dossier includes</strong>
            <span>{artifact.automation.deliverables.join(" · ")}</span>
          </div>
        </section>
      ) : null}

      <section className="missionSection">
        <div className="missionSectionHeading">
          <div>
            <span>Evidence matrix</span>
            <p>Findings stay linked to the packets used to support them.</p>
          </div>
        </div>
        <div className="missionMatrix">
          {artifact.matrix.map((row, index) => (
            <article key={`${row.finding}-${index}`} className="missionMatrixRow">
              <div className="missionMatrixFinding">
                <span className="missionRowIndex">{String(index + 1).padStart(2, "0")}</span>
                <strong>{row.finding}</strong>
                <div className="missionEvidenceIds">
                  {row.evidenceIds.map((id) => <span key={id}>[{id}]</span>)}
                </div>
              </div>
              <dl>
                <div><dt>Interpretation</dt><dd>{row.interpretation}</dd></div>
                <div><dt>Method / context</dt><dd>{row.methodOrContext}</dd></div>
                <div><dt>Limitation</dt><dd>{row.limitation}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="missionSection">
        <div className="missionSectionHeading">
          <div>
            <span>Thailand → World bridge</span>
            <p>Transfer the question, not an untested local conclusion.</p>
          </div>
        </div>
        <div className="worldBridgeGrid">
          <article>
            <strong>Transferable signals</strong>
            <ul>{artifact.worldBridge.transferableSignals.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <strong>Thai context to preserve</strong>
            <ul>{artifact.worldBridge.thaiContext.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <strong>Validate before transfer</strong>
            <ul>{artifact.worldBridge.validateNext.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
        </div>
      </section>

      <section className="missionSection learningMission">
        <div className="missionSectionHeading">
          <div>
            <span>Learn from the evidence</span>
            <p>{artifact.learning.objective}</p>
          </div>
        </div>
        <div className="learningCheckpoints">
          {artifact.learning.checkpoints.map((checkpoint, index) => (
            <button key={`${checkpoint.question}-${index}`} type="button" onClick={() => onAsk(checkpoint.question)}>
              <span>Checkpoint {index + 1}</span>
              <strong>{checkpoint.question}</strong>
              <small>{checkpoint.hint}</small>
              <em>{checkpoint.evidenceIds.map((id) => `[${id}]`).join(" ")}</em>
            </button>
          ))}
        </div>
      </section>

      <details className="agentRunTrace">
        <summary>
          <span>Inspect agent run</span>
          <small>bounded · step limit {artifact.agentRun.stepLimit}</small>
        </summary>
        <ol>
          {artifact.agentRun.stages.map((stage) => (
            <li key={stage.name} className={stage.status}>
              <span>{stage.name}</span>
              <small>{stage.detail}</small>
            </li>
          ))}
        </ol>
      </details>

      <div className="missionActions">
        <button type="button" className="cardAction" onClick={onExport}>
          <Download size={16} strokeWidth={2.2} aria-hidden />
          <span>{isAutomatedResearch ? "Export Research Dossier" : "Export Evidence Brief"}</span>
        </button>
        <span>Saved with this chat and share link</span>
      </div>
    </section>
  );
}

function MemoryNotice({ annotation }: { annotation: CivilMemoryAnnotation | null }) {
  if (!annotation?.runningSummary) return null;
  const percent = Math.max(0, Math.round((annotation.contextFillRatio ?? 0) * 100));
  const evidenceCount = annotation.activeEvidenceMap?.length ?? 0;
  const isCompacted = annotation.state === "compacted";

  return (
    <details className={`memoryNotice ${isCompacted ? "compacted" : "active"}`}>
      <summary>
        <span className="memoryDot" aria-hidden />
        <span>{isCompacted ? "Memory compacted" : "Memory active"}</span>
        {percent ? <span className="memoryMeta">{percent}% context</span> : null}
      </summary>
      <div className="memoryDetails">
        <p>
          Seedy Research summarizes older conversation context to preserve continuity while controlling context cost
          {annotation.compactedMessageCount ? ` across ${annotation.compactedMessageCount} compacted messages` : ""}.
        </p>
        {annotation.runningSummary ? <p className="memorySummary">{annotation.runningSummary}</p> : null}
        <div className="memoryChips">
          {annotation.recentMessageCount ? <span>recent {annotation.recentMessageCount} messages kept</span> : null}
          {evidenceCount ? <span>{evidenceCount} pinned evidence</span> : null}
        </div>
      </div>
    </details>
  );
}

function AnswerFeedback({
  message,
  traceId,
  sessionId,
  question,
}: {
  message: UIMessage;
  traceId?: string;
  sessionId: string;
  question?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showIssues, setShowIssues] = useState(false);

  if (!traceId) return null;

  const sendFeedback = async (rating: "up" | "down", categories: string[] = []) => {
    setState("sending");
    try {
      await fetchJson<{ ok: boolean }>("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          traceId,
          sessionId,
          messageId: message.id,
          rating,
          categories,
          ...(rating === "down" ? { questionSnapshot: question, answerSnapshot: messageText(message) } : {}),
        }),
      });
      setState("sent");
      setShowIssues(false);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="answerFeedback" aria-label="Answer feedback">
      <span>Answer quality</span>
      <button type="button" disabled={state === "sending" || state === "sent"} onClick={() => void sendFeedback("up")}>
        Helpful
      </button>
      <button
        type="button"
        disabled={state === "sending" || state === "sent"}
        onClick={() => setShowIssues((current) => !current)}
      >
        Issue
      </button>
      {state === "sent" ? <small>Saved</small> : null}
      {state === "error" ? <small>Could not save</small> : null}
      {showIssues ? (
        <div className="feedbackIssues">
          <button type="button" onClick={() => void sendFeedback("down", ["wrong_citation"])}>
            Wrong citation
          </button>
          <button type="button" onClick={() => void sendFeedback("down", ["irrelevant_evidence"])}>
            Irrelevant evidence
          </button>
          <button type="button" onClick={() => void sendFeedback("down", ["too_slow"])}>
            Too slow
          </button>
          <button type="button" onClick={() => void sendFeedback("down", ["ocr_noise"])}>
            OCR noise
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MessageRenderer({
  message,
  sessionId,
  question,
  onAsk,
  onOpenEvidence,
  onExportEvidenceBrief,
}: {
  message: UIMessage;
  sessionId: string;
  question?: string;
  onAsk: (prompt: string) => void;
  onOpenEvidence: (item: CivilEvidenceItem) => void;
  onExportEvidenceBrief: (annotation: CivilMissionAnnotation) => void;
}) {
  const text = messageText(message);
  if (message.role === "user") {
    return <p className="userText">{text}</p>;
  }

  const annotation = getCivilMcpAnnotation(message);
  const traceAnnotation = getCivilTraceAnnotation(message);
  const traceId = annotation?.traceId ?? traceAnnotation?.traceId;
  const memoryAnnotation = getCivilMemoryAnnotation(message);
  const missionAnnotation = getCivilMissionAnnotation(message);
  const shouldShowEvidence = text.trim().length > 0;
  return (
    <>
      <div className="markdownBody">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
      {missionAnnotation ? (
        <AgenticMissionCard
          annotation={missionAnnotation}
          onAsk={onAsk}
          onExport={() => onExportEvidenceBrief(missionAnnotation)}
        />
      ) : null}
      <MemoryNotice annotation={memoryAnnotation} />
      <RetrievalNotice annotation={annotation} />
      {shouldShowEvidence ? (
        <CitationIntegrityPanel
          annotation={annotation}
          markdown={text}
          question={question}
          onOpenEvidence={onOpenEvidence}
        />
      ) : null}
      {shouldShowEvidence ? <EvidenceCards annotation={annotation} markdown={text} onOpenEvidence={onOpenEvidence} /> : null}
      {shouldShowEvidence ? (
        <AnswerFeedback message={message} traceId={traceId} sessionId={sessionId} question={question} />
      ) : null}
    </>
  );
}

function normalizeSessionPayload(payload: SessionPayload): {
  sessionId: string;
  title: string;
  model: ChatModel;
  mode: Mode;
  collection: CollectionFilter;
  messages: UIMessage[];
  user: ChatUserProfile | null;
  authenticated: boolean;
} {
  const model: ChatModel = isChatModel(payload.model ?? "") ? (payload.model as ChatModel) : DEFAULT_CHAT_MODEL;
  const mode: Mode = payload.mode === "baseline" ? "baseline" : "mcp";
  const collection = normalizeCollection(payload.collection);
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const title = cleanTitle(payload.title ?? "") || sessionTitleFromMessages(messages);
  return {
    sessionId: payload.sessionId ?? "",
    title,
    model,
    mode,
    collection,
    messages,
    user: payload.user ?? null,
    authenticated: Boolean(payload.authenticated),
  };
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    let apiMessage = "";
    try {
      const payload = JSON.parse(text) as { error?: unknown };
      if (typeof payload.error === "string") apiMessage = payload.error.trim();
    } catch {}
    if (apiMessage) throw new Error(apiMessage);
    throw new Error(text || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function trackProductEvent(
  event: ProductEvent,
  properties: Record<string, string | number | boolean | null> = {},
) {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, properties }),
    keepalive: true,
  }).catch(() => undefined);
}

function AppSidebar({
  syncState,
  syncLabel,
  activeNav,
  authenticated,
  onNavigate,
}: {
  syncState: SyncState;
  syncLabel: string;
  activeNav: MobileNavItem;
  authenticated: boolean;
  onNavigate: (item: MobileNavItem) => void;
}) {
  return (
    <aside className="appSidebar" aria-label="SEEDY navigation">
      <div className="sidebarTop">
        <div className="sidebarBrand">
          <img className="brandMark" src="/civilmcp-logo.svg" alt="" aria-hidden="true" />
          <div>
            <div className="brandTitleRow">
              <p className="brandName">SEEDY</p>
              <span className="brandBadge">Research Preview</span>
            </div>
            <p className="brandSubline">Seedy Research</p>
          </div>
        </div>

        <nav className="sidebarNav" aria-label="Primary">
          {MAIN_NAV_ITEMS.map((item) => {
            const isAccountItem = item.id === "settings";
            const Icon = isAccountItem ? (authenticated ? ShieldCheck : LogIn) : item.icon;
            const label = isAccountItem ? (authenticated ? "Account" : "Sign in") : item.label;
            const locked = !CIVILMCP_OPEN_ACCESS && !authenticated && CIVILMCP_FEATURE_ACCESS[item.id].requiresAuth;
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebarNavItem ${item.id === activeNav ? "selected" : ""} ${locked ? "locked" : ""}`}
                aria-label={isAccountItem ? label : undefined}
                aria-current={item.id === activeNav ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <span className="navItemIcon">
                  <Icon size={21} strokeWidth={2.1} aria-hidden />
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="sidebarBottom">
        <div className={`mcpStatus ${syncState}`}>
          <span className="syncDot" aria-hidden />
          <span>
            <strong>Workspace</strong>
            <small>{syncLabel}</small>
          </span>
        </div>
      </div>
    </aside>
  );
}

function MobileBottomNav({
  active,
  setActive,
  authenticated,
}: {
  active: MobileNavItem;
  setActive: (item: MobileNavItem) => void;
  authenticated: boolean;
}) {
  return (
    <nav className="mobileBottomNav" aria-label="Mobile navigation">
      {MOBILE_NAV_ITEMS.map((item) => {
        const isAccountItem = item.id === "settings";
        const Icon = isAccountItem ? (authenticated ? ShieldCheck : LogIn) : item.icon;
        const label = isAccountItem ? (authenticated ? "Account" : "Sign in") : item.label;
        const selected = active === item.id;
        const locked = !CIVILMCP_OPEN_ACCESS && !authenticated && CIVILMCP_FEATURE_ACCESS[item.id].requiresAuth;
        return (
          <button
            key={item.id}
            type="button"
            className={`${selected ? "selected" : ""} ${locked ? "locked" : ""}`}
            aria-current={selected ? "page" : undefined}
            aria-label={isAccountItem ? label : undefined}
            onClick={() => setActive(item.id)}
          >
            <span className="navItemIcon">
              <Icon size={19} strokeWidth={2.2} aria-hidden />
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function SearchComposer({
  draft,
  setDraft,
  activeNav,
  onSubmit,
  onKeyDown,
  useMcp,
  experience,
  setExperience,
  selectedModel,
  modelOptions,
  selectedCollection,
  openDropdown,
  setOpenDropdown,
  setSelectedModel,
  setSelectedCollection,
  copyShareLink,
  exportSession,
  exportEvidenceBrief,
  clearConversation,
  canExportEvidenceBrief,
  isReady,
  isLoading,
}: {
  draft: string;
  setDraft: (value: string) => void;
  activeNav: MobileNavItem;
  onSubmit: (event: FormEvent<HTMLFormElement>, draft: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  useMcp: boolean;
  experience: ChatExperience;
  setExperience: (value: ChatExperience) => void;
  selectedModel: ChatModel;
  modelOptions: Array<MenuOption<ChatModel>>;
  selectedCollection: CollectionFilter;
  openDropdown: OpenDropdown;
  setOpenDropdown: (dropdown: OpenDropdown) => void;
  setSelectedModel: (value: ChatModel) => void;
  setSelectedCollection: (value: CollectionFilter) => void;
  copyShareLink: () => void;
  exportSession: () => void;
  exportEvidenceBrief: () => void;
  clearConversation: () => void;
  canExportEvidenceBrief: boolean;
  isReady: boolean;
  isLoading: boolean;
}) {
  // Keep the keystroke on the composer's small subtree. The research feed,
  // coverage ledger, and evidence panels consume the draft only after the
  // user pauses, so their large subtree never sits on the keystroke path.
  const [localDraft, setLocalDraft] = useState(draft);
  const draftCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (draftCommitTimerRef.current) clearTimeout(draftCommitTimerRef.current);
    setLocalDraft(draft);
  }, [draft]);

  useEffect(() => () => {
    if (draftCommitTimerRef.current) clearTimeout(draftCommitTimerRef.current);
  }, []);

  const updateDraft = (value: string) => {
    setLocalDraft(value);
    if (draftCommitTimerRef.current) clearTimeout(draftCommitTimerRef.current);
    draftCommitTimerRef.current = setTimeout(() => {
      startTransition(() => setDraft(value));
    }, 250);
  };

  const composerHint =
    activeNav === "explore"
      ? "Typing previews relevant papers. Submit starts one persistent Research Case."
      : "Ask a cited research question.";

  return (
    <form onSubmit={(event) => onSubmit(event, localDraft)} className="searchComposer">
      <textarea
        value={localDraft}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={activeNav === "explore" ? "What do you want to understand from research published in Thailand?" : "Ask about the evidence"}
        aria-label={activeNav === "explore" ? "Start a Thai-to-global Research Case" : "Ask about research evidence"}
        aria-describedby="composer-intent"
        rows={3}
      />
      <p id="composer-intent" className="srOnly">
        {composerHint}
      </p>
      <div className="composerToolbar">
        <PromptMenu openDropdown={openDropdown} setOpenDropdown={setOpenDropdown} setDraft={setDraft} />
        {useMcp ? (
          <GlassSelect
            id="experience"
            label="Run"
            icon={Gauge}
            className="experienceControl"
            value={experience}
            options={EXPERIENCE_OPTIONS}
            openDropdown={openDropdown}
            setOpenDropdown={setOpenDropdown}
            onChange={setExperience}
          />
        ) : null}
        <GlassSelect
          id="model"
          label="Model"
          icon={Sparkles}
          className="modelControl"
          value={selectedModel}
          options={modelOptions}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
          onChange={(value) => setSelectedModel(value)}
        />
        <GlassSelect
          id="collection"
          label="Collection"
          icon={Database}
          className="collectionControl"
          value={selectedCollection}
          options={COLLECTION_OPTIONS}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
          onChange={(value) => setSelectedCollection(normalizeCollection(value))}
        />
        <ActionsMenu
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
          copyShareLink={copyShareLink}
          exportSession={exportSession}
          exportEvidenceBrief={exportEvidenceBrief}
          clearConversation={clearConversation}
          canExportEvidenceBrief={canExportEvidenceBrief}
          isReady={isReady}
          isLoading={isLoading}
        />
        <span className="keyHint">{activeNav === "explore" ? "⌘↵ to start case" : "⌘↵ to send"}</span>
        <GlassButton
          type="submit"
          className="sendButtonWrap"
          disabled={!isReady || isLoading || !localDraft.trim()}
          aria-label={isLoading ? "Seedy Research is answering" : activeNav === "explore" ? "Start Research Case" : "Send message"}
        >
          <ArrowUp size={22} strokeWidth={2.5} aria-hidden />
        </GlassButton>
      </div>
    </form>
  );
}

function FilterBar({
  activeFilter,
  setActiveFilter,
  totalDocuments,
  savedCount,
  filterCounts,
  paperLanguage,
  isTranslating,
  onPaperLanguageChange,
  generatedAt,
  onRefresh,
  isRefreshing,
}: {
  activeFilter: FeedFilter;
  setActiveFilter: (filter: FeedFilter) => void;
  totalDocuments: number;
  savedCount: number;
  filterCounts: Partial<Record<FeedFilter, number>>;
  paperLanguage: PaperLanguage;
  isTranslating: boolean;
  onPaperLanguageChange: (language: PaperLanguage) => void;
  generatedAt: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const syncText =
    activeFilter === "saved"
      ? "local"
      : generatedAt
        ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(generatedAt))
        : "pending";

  return (
    <div className="feedToolbar" aria-label="Research feed filters">
      <div className="filterChips">
        {FILTER_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = activeFilter === option.id;
          const count = option.id === "saved" ? savedCount : filterCounts[option.id];
          return (
            <GlassButton
              key={option.id}
              className="filterChip"
              active={selected}
              aria-pressed={selected}
              onClick={() => setActiveFilter(option.id)}
            >
              <Icon className="chipIcon" aria-hidden />
              <span>{option.label}</span>
              {typeof count === "number" ? <small className="chipCount">{count.toLocaleString("en-US")}</small> : null}
            </GlassButton>
          );
        })}
      </div>
      <div className="feedToolbarControls">
        <PaperLanguageToggle language={paperLanguage} isTranslating={isTranslating} onChange={onPaperLanguageChange} />
        <div className="feedToolbarAside">
          <div className="feedMeta" aria-label="Dynamic corpus status">
            <Database size={15} strokeWidth={2.2} aria-hidden />
            <span>
              {activeFilter === "saved"
                ? `${savedCount.toLocaleString("en-US")} saved`
                : activeFilter === "thai" || activeFilter === "tci"
                  ? `${(filterCounts.thai ?? filterCounts.tci ?? 0).toLocaleString("en-US")} discovery records`
                  : totalDocuments
                    ? `${totalDocuments.toLocaleString("en-US")} searchable records`
                    : "Live corpus"}
            </span>
            <small>{activeFilter === "saved" ? syncText : `updated ${syncText}`}</small>
          </div>
          {activeFilter === "saved" ? (
            <div className="refreshChipStatic" aria-label="Saved papers are kept in the Seedy Research library">
              <Bookmark className="chipIcon" aria-hidden />
              <span>Library synced</span>
            </div>
          ) : (
            <GlassButton
              className="refreshChip"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label={isRefreshing ? "Updating research feed" : "Refresh research feed"}
            >
              <RefreshCw className="chipIcon" aria-hidden />
              <span>{isRefreshing ? "Updating feed" : "Refresh feed"}</span>
            </GlassButton>
          )}
        </div>
      </div>
    </div>
  );
}

function DiscoveryTrustBar({
  citableTotal,
  metadataOnlyTotal,
}: {
  citableTotal: number;
  metadataOnlyTotal: number;
}) {
  return (
    <section className="discoveryTrustBar" aria-label="Discovery source types">
      <div className="discoveryTrustItem evidenceTrust">
        <span className="discoveryTrustIcon" aria-hidden><ShieldCheck size={16} strokeWidth={2.2} /></span>
        <span>
          <strong>Page-cited evidence</strong>
          <small>Use in answers, comparisons, and exact-page citations.</small>
        </span>
        {citableTotal ? <em>{citableTotal.toLocaleString("en-US")}</em> : null}
      </div>
      <div className="discoveryTrustItem metadataTrust">
        <span className="discoveryTrustIcon" aria-hidden><Database size={16} strokeWidth={2.2} /></span>
        <span>
          <strong>Thai research discovery metadata</strong>
          <small>Provider metadata and source links only. Not used as answer evidence.</small>
        </span>
        {metadataOnlyTotal ? <em>{metadataOnlyTotal.toLocaleString("en-US")}</em> : null}
      </div>
    </section>
  );
}

function visibilityReceiptCopy(receipt: VisibilityReceipt): { label: string; detail: string } {
  if (receipt.state === "globally_indexed") return { label: "Exact global identity", detail: "Exact DOI or reviewed identity in the dated OpenAlex audit." };
  if (receipt.state === "under_indexed") return { label: "Under-indexed globally", detail: `Exact identity found, but local metadata is richer${receipt.metadataGaps.length ? ` · ${receipt.metadataGaps.length} gaps` : ""}.` };
  if (receipt.state === "candidate_match") return { label: "Candidate · review required", detail: "A possible identity match is not treated as verified." };
  if (receipt.state === "not_found_in_audit") return { label: "No exact match in dated audit", detail: "Not found in this bounded audit; this is not a permanent absence claim." };
  if (receipt.state === "audit_unavailable") return { label: "Audit unavailable", detail: "The provider could not be checked, so no visibility claim is made." };
  return { label: "Not audited yet", detail: "No dated visibility receipt exists for this work yet." };
}

function VisibilityReceiptBadge({ receipt }: { receipt?: VisibilityReceipt }) {
  if (!receipt) return null;
  const copy = visibilityReceiptCopy(receipt);
  return (
    <span className={`visibilityReceipt ${receipt.state}`} title={copy.detail}>
      <GitFork size={12} aria-hidden />
      {copy.label}
    </span>
  );
}

function VisibilityCorrectionControl({ card }: { card: ResearchCardData }) {
  const [candidate, setCandidate] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const receipt = card.visibility;
  if (!receipt || receipt.state === "globally_indexed" || receipt.state === "not_audited") return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "saving" || status === "saved") return;
    const normalized = candidate.trim();
    const openAlexMatch = normalized.match(/(?:https?:\/\/openalex\.org\/)?(W\d+)/i);
    const doi = normalized.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    setStatus("saving");
    try {
      await fetchJson("/api/visibility-corrections", {
        method: "POST",
        body: JSON.stringify({
          source: card.source,
          kind: openAlexMatch ? "match" : normalized ? "metadata_correction" : "review_request",
          proposedExternalWorkId: openAlexMatch ? `https://openalex.org/${openAlexMatch[1].toUpperCase()}` : null,
          proposedDoi: !openAlexMatch && normalized ? doi : null,
          note,
        }),
      });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };
  return (
    <details className="visibilityCorrectionControl">
      <summary>{status === "saved" ? "Sent for steward review" : "Suggest match/correction"}</summary>
      {status === "saved" ? (
        <p>Stored in Seedy’s steward queue. No external index was modified.</p>
      ) : (
        <form onSubmit={submit}>
          <label><span>OpenAlex ID or DOI (optional)</span><input value={candidate} onChange={(event) => setCandidate(event.target.value)} maxLength={180} placeholder="W… or 10.…" /></label>
          <label><span>Why should this be reviewed? (optional)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1500} rows={2} /></label>
          {status === "error" ? <p role="alert">Could not save this suggestion. Retry shortly.</p> : null}
          <button type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Send to Seedy steward"}</button>
        </form>
      )}
    </details>
  );
}

function VisibilityAuditPanel({ summary }: { summary: VisibilitySummary | null }) {
  if (!summary) return null;
  const dated = summary.snapshotDate
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${summary.snapshotDate}T00:00:00Z`))
    : "not started";
  return (
    <section className="visibilityAuditPanel" aria-label="Thai to global visibility audit">
      <header>
        <div>
          <span className="workspaceEyebrow">Thai–Global Visibility Audit</span>
          <h2>What global indexes can—and cannot yet—see</h2>
          <p>Dated OpenAlex comparison receipts for the bounded ThaiJO cohort. Seedy connects overlooked Thai work inside the research workflow; it does not submit records to OpenAlex.</p>
        </div>
        <span className={`visibilityAuditStatus ${summary.runStatus}`}>{summary.runStatus.replace("_", " ")}</span>
      </header>
      {summary.runStatus === "not_started" ? (
        <p className="visibilityAuditEmpty">Audit infrastructure is ready; no production audit receipt has been published yet.</p>
      ) : (
        <>
          <div className="visibilityAuditMetrics">
            <div><strong>{summary.attempted.toLocaleString("en-US")}</strong><span>attempted of {summary.denominator.toLocaleString("en-US")}</span></div>
            <div><strong>{summary.globallyIndexed.toLocaleString("en-US")}</strong><span>exact global identity</span></div>
            <div><strong>{summary.underIndexed.toLocaleString("en-US")}</strong><span>under-indexed</span></div>
            <div><strong>{summary.candidateReview.toLocaleString("en-US")}</strong><span>candidate review</span></div>
            <div><strong>{summary.notFoundInAudit.toLocaleString("en-US")}</strong><span>no exact match in audit</span></div>
            <div><strong>{summary.unavailable.toLocaleString("en-US")}</strong><span>provider unavailable</span></div>
          </div>
          <p className="visibilityAuditFoot">Snapshot {dated} · {summary.strategy === "full" ? "identifier + title review candidates" : "identifier audit"} · {summary.complete ? "complete bounded cohort" : "partial cohort—no national percentage claimed"}</p>
        </>
      )}
    </section>
  );
}

function CoverageLedger({
  providers,
  activeProvider,
  onViewProvider,
  onClearProvider,
}: {
  providers: ResearchCoverageProvider[];
  activeProvider: string;
  onViewProvider: (provider: ResearchCoverageProvider) => void;
  onClearProvider: () => void;
}) {
  if (!providers.length) return null;
  const connected = providers.filter((provider) => (provider.state === "connected" || provider.state === "import_validated") && provider.records > 0);
  const partnerRequired = providers.filter((provider) => provider.state === "partner_required");
  const planned = providers.filter((provider) => provider.state === "planned" || provider.state === "blocked");
  return (
    <section className="coverageLedger" aria-label="Thai research coverage ledger">
      <header>
        <div>
          <span className="workspaceEyebrow">Coverage Ledger</span>
          <h2>What Seedy can discover, cite, and lawfully read</h2>
          <p>Counts are dated access classes, not a claim that Thai research is nationally complete.</p>
        </div>
        {activeProvider ? <button type="button" className="textAction" onClick={onClearProvider}>Show all sources</button> : null}
      </header>
      <div className="coverageRows">
        {connected.map((provider) => (
          <article key={provider.provider} className={activeProvider === provider.provider ? "active" : ""}>
            <div className="coverageIdentity">
              <strong>{provider.label}</strong>
              <span>{provider.provider === "pmc_oa"
                ? "global comparison corpus · excluded from Thai-local totals"
                : provider.state === "import_validated" ? "validated bounded import" : "connected Thai-published source"}</span>
            </div>
            <dl>
              <div><dt>Records</dt><dd>{provider.records.toLocaleString("en-US")}</dd></div>
              <div><dt>Evidence</dt><dd>{provider.pageCitable.toLocaleString("en-US")} page-citable</dd></div>
              <div><dt>Discovery</dt><dd>{provider.metadataOnly.toLocaleString("en-US")} metadata-only</dd></div>
              <div><dt>Reader</dt><dd>{provider.nativeFullPaper.toLocaleString("en-US")} native full papers</dd></div>
            </dl>
            <div className="coverageFoot">
              <span>{provider.endpointKnown ? `${provider.endpointObserved ?? 0} of ${provider.endpointKnown} endpoints observed` : `${provider.endpointObserved ?? 0} bounded source slices`}</span>
              <span>{provider.sourceHostedFullPaper == null ? "source-hosted full-paper count unmeasured" : `${provider.sourceHostedFullPaper} source-hosted full papers`}</span>
              {provider.filter ? (
                <button type="button" onClick={() => onViewProvider(provider)} aria-label={`View ${provider.label} records`}>
                  View records
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {partnerRequired.length ? (
        <details>
          <summary>{partnerRequired.length} national providers require formal access</summary>
          <p>{partnerRequired.map((provider) => provider.label).join(" · ")}. Seedy will not bypass access controls or imply ingestion before an agreement or lawful export exists.</p>
        </details>
      ) : null}
      {planned.length ? (
        <details>
          <summary>{planned.length} provider classes planned, not yet connected</summary>
          <p>{planned.map((provider) => provider.label).join(" · ")}. A repeatable access method and rights review are required before promotion.</p>
        </details>
      ) : null}
    </section>
  );
}

function ResearchCasePanel({
  researchCase,
  status,
  error,
  onOpenSource,
  onStartNew,
}: {
  researchCase: ActiveResearchCase | null;
  status: "idle" | "loading" | "saving" | "ready" | "error";
  error: string;
  onOpenSource: (source: string) => void;
  onStartNew: () => void;
}) {
  if (!researchCase && status === "idle" && !error) return null;
  if (!researchCase && status === "loading") {
    return <section className="researchCasePanel loading" aria-label="Research Case" role="status"><LoaderCircle size={17} className="passportSpinner" aria-hidden /><span>Resuming your latest Research Case…</span></section>;
  }
  if (!researchCase) {
    return <section className="researchCasePanel error" aria-label="Research Case"><TriangleAlert size={17} aria-hidden /><span>{error || "Research Case could not be loaded."}</span><button type="button" onClick={onStartNew}>Start locally</button></section>;
  }
  const accepted = researchCase.reviews.filter((review) => review.decision === "accepted").length;
  const visibilityState = typeof researchCase.state.visibilityState === "string" ? researchCase.state.visibilityState : "pending";
  const hasEvidence = Number(researchCase.state.evidenceCount ?? 0) > 0;
  const hasProtocol = researchCase.state.pathReady === true;
  const stages = [
    { label: "Discover", complete: researchCase.selectedSources.length > 0 },
    { label: "Visibility", complete: visibilityState !== "pending" },
    { label: "Evidence", complete: hasEvidence },
    { label: "Review", complete: accepted > 0 },
    { label: "Next study", complete: hasProtocol },
  ];
  return (
    <section className="researchCasePanel" aria-label="Research Case" data-testid="research-case-panel">
      <header>
        <div>
          <span className="workspaceEyebrow">Active Research Case · {researchCase.caseId.slice(-8)}</span>
          <h2>{researchCase.question}</h2>
          <p>One resumable trail from research published in Thailand to a reviewed next-study decision.</p>
        </div>
        <span className={`caseSaveState ${status}`}>{status === "saving" ? "Saving…" : "Saved"}</span>
      </header>
      <ol className="researchCaseStages" aria-label="Research Case progress">
        {stages.map((stage, index) => <li key={stage.label} className={stage.complete ? "complete" : "pending"}><span>{stage.complete ? <Check size={13} aria-hidden /> : index + 1}</span>{stage.label}</li>)}
      </ol>
      <footer>
        <span>{researchCase.selectedSources.length} selected sources · {accepted} accepted evidence items</span>
        <div>
          {researchCase.selectedSources[0] ? <button type="button" className="cardAction primary" onClick={() => onOpenSource(researchCase.selectedSources[0])}>Continue with evidence</button> : null}
          <button type="button" className="cardAction" onClick={onStartNew}>Start a new case</button>
        </div>
      </footer>
    </section>
  );
}

function GlobalDiscoveryPanel({
  query,
  state,
  onExpand,
}: {
  query: string;
  state: GlobalDiscoveryState;
  onExpand: () => void;
}) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return null;

  const response = state.response;
  const status = response?.status;
  const hasResults = status === "connected" && Boolean(response?.works.length);
  const statusCopy = status === "link_only"
    ? "Global results open on OpenAlex for this preview."
    : status === "rate_limited"
      ? "OpenAlex is busy. Retry shortly or continue on OpenAlex."
      : status === "disabled"
        ? "Global discovery is paused for this preview."
        : status === "unavailable"
          ? "Global discovery could not load just now. Retry or continue on OpenAlex."
          : status === "connected"
            ? "No matching global metadata was returned for this search."
            : "Search beyond the Thai corpus only when you need broader context.";

  return (
    <section className="globalDiscoveryPanel" aria-label="Suggested global comparison leads">
      <header className="globalDiscoveryHeader">
        <div>
          <span className="globalDiscoveryEyebrow"><Compass size={15} strokeWidth={2.2} aria-hidden /> Suggested comparison leads</span>
          <h2>Compare “{normalizedQuery}” with global work</h2>
          <p>Optional OpenAlex topical metadata appears after Thai-local results. It is not a verified connection and never counts as evidence.</p>
        </div>
        <button
          type="button"
          className="cardAction globalDiscoveryAction"
          disabled={state.phase === "loading"}
          onClick={onExpand}
        >
          {state.phase === "loading" ? <RefreshCw className="globalDiscoverySpinner" size={16} aria-hidden /> : <Search size={16} aria-hidden />}
          <span>
            {state.phase === "loading"
              ? "Searching OpenAlex"
              : state.phase === "idle"
                ? "Expand globally"
                : "Refresh global results"}
          </span>
        </button>
      </header>

      {state.phase === "error" ? (
        <div className="globalDiscoveryState" role="alert">
          <TriangleAlert size={17} aria-hidden />
          <span>{state.error || "Global discovery is temporarily unavailable."}</span>
        </div>
      ) : state.phase === "loading" ? (
        <div className="globalDiscoveryState" role="status" aria-live="polite">
          <RefreshCw className="globalDiscoverySpinner" size={17} aria-hidden />
          <span>Searching global research metadata…</span>
        </div>
      ) : hasResults && response ? (
        <div className="globalDiscoveryResults">
          <div className="globalDiscoveryResultHeading">
            <strong>OpenAlex metadata</strong>
            <span>{response.works.length} results · external sources</span>
          </div>
          <div className="globalWorkGrid">
            {response.works.map((work) => (
              <a
                key={work.id || work.doi || `${work.title}-${work.year ?? "unknown"}`}
                className="globalWorkCard"
                href={work.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open global metadata: ${work.title}`}
              >
                <span className="globalWorkProvider">OpenAlex · metadata only <ExternalLink size={13} aria-hidden /></span>
                <strong>{work.title}</strong>
                <small>
                  {[work.year, work.topic, `${work.citedByCount.toLocaleString("en-US")} citations`]
                    .filter((value) => value !== null && value !== "")
                    .join(" · ")}
                </small>
              </a>
            ))}
          </div>
          <a className="globalDiscoveryFooterLink" href={response.searchUrl} target="_blank" rel="noopener noreferrer">
            Search this topic on OpenAlex <ExternalLink size={14} aria-hidden />
          </a>
        </div>
      ) : state.phase === "ready" && response ? (
        <div className="globalDiscoveryState">
          <Compass size={17} aria-hidden />
          <span>{statusCopy}</span>
          <a href={response.searchUrl} target="_blank" rel="noopener noreferrer">
            Open OpenAlex <ExternalLink size={13} aria-hidden />
          </a>
        </div>
      ) : null}
    </section>
  );
}

function ResearchPassportPanel({
  enabled,
  state,
  onOpenEvidence,
  onReviewEvidence,
  onMarkReviewed,
  onExport,
  onClear,
  onContinueToPath,
}: {
  enabled: boolean;
  state: ResearchPassportState;
  onOpenEvidence: (item: ResearchPassportEvidence) => void;
  onReviewEvidence: (item: ResearchPassportEvidence, decision: "accepted" | "rejected") => void;
  onMarkReviewed: () => void;
  onExport: () => void;
  onClear: () => void;
  onContinueToPath: (artifact: ResearchPassportArtifact) => void;
}) {
  if (!enabled || state.phase === "idle") return null;
  const artifact = state.artifact;
  const exactPageCount = artifact?.evidence.filter((item) => item.pageStart != null && item.pageEnd != null).length ?? 0;
  const reviewed = Boolean(artifact?.reviewedAt);
  const allEvidenceOpened = artifact
    ? artifact.evidence.length > 0 && artifact.evidence.every((item) => artifact.openedEvidenceIds.includes(item.id))
    : false;
  const acceptedEvidenceCount = artifact
    ? artifact.evidence.filter((item) => artifact.reviewDecisions[item.id]?.decision === "accepted").length
    : 0;
  const allEvidenceDecided = artifact
    ? artifact.evidence.length > 0 && artifact.evidence.every((item) => Boolean(artifact.reviewDecisions[item.id]))
    : false;

  return (
    <section className={`researchPassport ${state.phase}${artifact?.stale ? " stale" : ""}`} aria-label="Thai-to-global research passport">
      <header className="passportHeader">
        <div>
          <span className="passportEyebrow"><GitFork size={15} strokeWidth={2.2} aria-hidden /> Research Passport · WebMCP run</span>
          <h2>{artifact ? "Thai → Global Research Passport" : "Build a Thai → Global Research Passport"}</h2>
          <p>{artifact
            ? "A bounded evidence trail drafted on this page by your browser agent."
            : "Open exact-page evidence, then ask your browser agent to connect the finding to global discovery without treating metadata as evidence."}</p>
        </div>
        <span className={`passportReviewStatus ${reviewed ? "reviewed" : "pending"}`}>
          {artifact?.stale
            ? "Out of date · redraft required"
            : reviewed
              ? `${acceptedEvidenceCount} evidence claims accepted · inference remains candidate`
              : artifact
                ? allEvidenceDecided ? "Ready to complete claim review" : allEvidenceOpened ? "Accept or reject each evidence claim" : `Open exact pages · ${artifact.openedEvidenceIds.length}/${artifact.evidence.length}`
                : "8 site tools ready"}
        </span>
      </header>

      {state.phase === "loading" ? (
        <div className="passportLoading" role="status" aria-live="polite">
          <LoaderCircle className="passportSpinner" size={18} aria-hidden />
          <div><strong>Drafting the evidence boundary</strong><span>Validating Thai page anchors · searching bounded global metadata · framing one candidate gap</span></div>
        </div>
      ) : state.phase === "error" ? (
        <div className="passportError" role="alert">
          <TriangleAlert size={17} aria-hidden />
          <span>{state.error || "The Research Passport could not be drafted."}</span>
          <button type="button" onClick={onClear}>Reset</button>
        </div>
      ) : artifact ? (
        <>
          <div className="passportMeta" aria-label="Research Passport summary">
            <span><strong>{artifact.passportId}</strong> passport</span>
            <span><strong>{artifact.evidence.length}</strong> Thai anchors</span>
            <span><strong>{artifact.globalWorks.length}</strong> global leads</span>
            <span><strong>{artifact.translationStatus === "ready" ? "EN" : artifact.translationStatus === "not_needed" ? "EN source" : "Original"}</strong> language bridge</span>
            <span><strong>0</strong> global records used as evidence</span>
          </div>

          <div className="passportLedger">
            <section className="passportEvidenceColumn" aria-label="Page-linked Thai evidence">
              <div className="passportSectionHeading">
                <span className="passportStep">01</span>
                <div><strong>{reviewed ? "Human-reviewed page anchors" : "Page-linked Thai evidence"}</strong><small>{artifact.translationStatus === "ready" ? "Original + bounded English rendering" : artifact.translationStatus === "unavailable" ? "Original retained · English rendering unavailable" : "Source text already English"} · not scientific validation</small></div>
              </div>
              <h3>{artifact.paper.title}</h3>
              <p>{artifact.paper.paperCode || artifact.paper.source} · {artifact.paper.pageLabel}</p>
              <div className="passportEvidenceList">
                {artifact.evidence.map((item) => {
                  const opened = artifact.openedEvidenceIds.includes(item.id);
                  const decision = artifact.reviewDecisions[item.id]?.decision;
                  return (
                    <div key={item.id} className={`passportEvidenceItem ${decision ?? "pending"}`}>
                      <button
                        type="button"
                        className="passportEvidenceOpen"
                        onClick={() => onOpenEvidence(item)}
                        aria-pressed={opened}
                        aria-label={`Open evidence ${item.id} at ${passportEvidencePage(item)}`}
                      >
                        <span><strong>{item.id}</strong><em>{passportEvidencePage(item)}{opened ? " · opened" : ""}</em></span>
                        <small>{item.sectionTitle || "Evidence packet"}</small>
                        <span className="passportEvidenceExcerpt" lang={contentLanguage(item.snippet)}>{boundedToolText(item.snippet, 180)}</span>
                        {item.englishSnippet ? <span className="passportEvidenceTranslation" lang="en"><em>English</em>{boundedToolText(item.englishSnippet, 180)}</span> : null}
                      </button>
                      <div className="evidenceDecisionActions" aria-label={`Review ${item.id}`}>
                        <button type="button" disabled={!opened || reviewed} aria-pressed={decision === "accepted"} onClick={() => onReviewEvidence(item, "accepted")}><Check size={13} aria-hidden /> Accept</button>
                        <button type="button" disabled={!opened || reviewed} aria-pressed={decision === "rejected"} onClick={() => onReviewEvidence(item, "rejected")}><X size={13} aria-hidden /> Reject</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="passportInferenceColumn" aria-label="Candidate inference requiring review">
              <div className="passportSectionHeading">
                <span className="passportStep">02</span>
                <div><strong>Candidate inference</strong><small>Agent-drafted · review required</small></div>
              </div>
              <blockquote>“{artifact.focus}”</blockquote>
              <p>{artifact.candidateGap.statement}</p>
              <p className="passportCandidateBasis">
                Proposed local basis: {artifact.candidateGap.localBasisEvidenceIds.join(", ")} · evidence relationship not validated
              </p>
              <div className="passportGapWarning">
                <TriangleAlert size={15} aria-hidden />
                <span>{artifact.candidateGap.missingValidation}</span>
              </div>
              <dl>
                <div><dt>Gap lens</dt><dd>{artifact.gapLens}</dd></div>
                <div><dt>Verify next</dt><dd>{artifact.candidateGap.nextVerificationQuery}</dd></div>
              </dl>
            </section>

            <section className="passportGlobalColumn" aria-label="Global discovery metadata">
              <div className="passportSectionHeading">
                <span className="passportStep">03</span>
                <div><strong>Global discovery leads</strong><small>OpenAlex · metadata only</small></div>
              </div>
              <p className={`passportGlobalStatus ${artifact.globalStatus}`}>
                {passportGlobalStatusCopy(artifact.globalStatus, artifact.globalWorks.length > 0)}
              </p>
              {artifact.globalWorks.length ? (
                <ol>
                  {artifact.globalWorks.map((work) => (
                    <li key={work.id || work.doi || work.url}>
                      <a href={work.url} target="_blank" rel="noopener noreferrer">
                        <span>Metadata only <ExternalLink size={12} aria-hidden /></span>
                        <strong>{work.title}</strong>
                        <small>{[work.year, work.topic, `${work.citedByCount} citations`].filter((value) => value != null && value !== "").join(" · ")}</small>
                      </a>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="passportNoGlobal">
                  <Database size={17} aria-hidden />
                  <p>{artifact.globalStatus === "connected"
                    ? "No matching records were returned. The Thai page anchors remain usable on their own."
                    : "No global records are shown because this layer was not completed. The Thai page anchors remain usable on their own."}</p>
                </div>
              )}
              <a className="passportGlobalSearch" href={artifact.globalSearchUrl} target="_blank" rel="noopener noreferrer">
                Continue verification on OpenAlex <ExternalLink size={13} aria-hidden />
              </a>
            </section>
          </div>

          <div className="passportBoundary" role="note">
            <ShieldCheck size={18} strokeWidth={2.2} aria-hidden />
            <div><strong>Provenance checks passed</strong><span>{exactPageCount}/{artifact.evidence.length} anchors resolve to Thai source pages · global records used as evidence: 0 · provenance is not scientific correctness.</span></div>
          </div>

          <div className="passportActions">
            <button type="button" className="cardAction primary" disabled={reviewed || artifact.stale || !allEvidenceOpened || !allEvidenceDecided || acceptedEvidenceCount < 1} onClick={onMarkReviewed}>
              {reviewed ? <Check size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              <span>{reviewed ? "Evidence reviewed" : !allEvidenceOpened ? "Open every exact page first" : !allEvidenceDecided ? "Accept or reject each claim" : acceptedEvidenceCount < 1 ? "Accept at least one claim" : "Complete evidence review"}</span>
            </button>
            <button type="button" className="cardAction" disabled={!reviewed || artifact.stale} onClick={onExport}>
              <Download size={16} aria-hidden />
              <span>Export passport</span>
            </button>
            <button type="button" className="cardAction" disabled={!reviewed || artifact.stale} onClick={() => onContinueToPath(artifact)}>
              <Route size={16} aria-hidden />
              <span>Continue to Research Path</span>
            </button>
            <button type="button" className="cardAction" onClick={onClear}>
              <X size={16} aria-hidden />
              <span>Clear</span>
            </button>
          </div>

          <details className="passportRun">
            <summary><Terminal size={15} aria-hidden /><span>Inspect WebMCP run</span><strong>{artifact.runSteps.length} completed calls</strong><ChevronDown size={15} aria-hidden /></summary>
            <ol>
              {artifact.runSteps.map((item, index) => (
                <li key={`${item.tool}-${item.completedAt}-${index}`}>
                  <code>{item.tool}</code><span>{item.detail}</span><time dateTime={item.completedAt}>{new Date(item.completedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : null}
    </section>
  );
}

function LivingReviewPanel({
  authenticated,
  query,
  collection,
  watches,
  busyId,
  onWatch,
  onCheck,
  onDelete,
  onSignIn,
}: {
  authenticated: boolean;
  query: string;
  collection: CollectionFilter;
  watches: LivingReviewWatch[];
  busyId: string;
  onWatch: () => void;
  onCheck: (watchId: string) => void;
  onDelete: (watchId: string) => void;
  onSignIn: () => void;
}) {
  const normalized = query.trim();
  if (!normalized && !watches.length) return null;
  const alreadyWatching = watches.some((watch) => watch.query.toLocaleLowerCase("en") === normalized.toLocaleLowerCase("en") && watch.collection === collection);
  return (
    <section className="livingReviewPanel" aria-label="Living Reviews">
      <header>
        <div><span><Bell size={15} aria-hidden /> Living Review</span><strong>Know what changed since your last review.</strong></div>
        {normalized && !alreadyWatching ? (
          <button type="button" className="cardAction" onClick={authenticated ? onWatch : onSignIn} disabled={Boolean(busyId)}>
            <Bell size={14} aria-hidden /> {authenticated ? "Watch this search" : "Sign in to watch"}
          </button>
        ) : null}
      </header>
      {watches.length ? (
        <div className="livingReviewList">
          {watches.slice(0, 5).map((watch) => (
            <article key={watch.watchId}>
              <div>
                <span>{watch.collection || "All sources"}{watch.newCount ? ` · ${watch.newCount} new` : " · up to date"}</span>
                <strong>{watch.query}</strong>
                <small>{watch.resultCount} tracked records{watch.lastCheckedAt ? ` · checked ${new Date(watch.lastCheckedAt).toLocaleDateString("en-GB")}` : ""}</small>
              </div>
              <div>
                <button type="button" onClick={() => onCheck(watch.watchId)} disabled={busyId === watch.watchId}>{busyId === watch.watchId ? "Checking…" : "Check now"}</button>
                <button type="button" onClick={() => onDelete(watch.watchId)} aria-label={`Stop watching ${watch.query}`}><X size={14} aria-hidden /></button>
              </div>
            </article>
          ))}
        </div>
      ) : <p>Save a focused search to compare new Thai and global metadata over time.</p>}
    </section>
  );
}

function PreviewSvg({ variant }: { variant: ResearchCardData["preview"] }) {
  if (variant === "flood") {
    return (
      <svg className="previewSvg" viewBox="0 0 220 118" role="img" aria-label="Flood map preview">
        <path className="previewMapBase" d="M14 83C42 58 58 72 78 44c21-30 45-25 64-8 19 18 36 21 63 5v62H14Z" />
        <path className="previewRiver" d="M24 90c26-30 44-19 62-46 16-25 34-24 51-8 18 17 32 18 60 1" />
        <path className="previewContour" d="M18 29c31 8 49 3 70-13M23 51c45 9 67 4 101-20M126 82c28-14 54-16 80-5" />
        <circle className="previewNode" cx="82" cy="45" r="4" />
        <circle className="previewNode" cx="142" cy="37" r="4" />
      </svg>
    );
  }

  if (variant === "seismic") {
    return (
      <svg className="previewSvg" viewBox="0 0 220 118" role="img" aria-label="Seismic chart preview">
        <path className="previewAxis" d="M22 96H204M22 96V18" />
        <path className="previewLine blue" d="M25 82c18-12 31-4 45-22 18-23 31-33 49-16 18 16 26 30 48 15 14-9 22-20 34-24" />
        <path className="previewLine green" d="M25 90c19-6 34-8 50-21 18-14 30-19 45-9 21 14 39 21 81-2" />
        <path className="previewGridLine" d="M22 72H204M22 48H204M58 18V96M104 18V96M150 18V96" />
      </svg>
    );
  }

  if (variant === "traffic") {
    return (
      <svg className="previewSvg" viewBox="0 0 220 118" role="img" aria-label="Traffic network preview">
        <path className="previewRoad" d="M10 61H210M110 12V106M36 28l147 69M42 96 178 26" />
        <circle className="previewJunction" cx="110" cy="61" r="13" />
        <circle className="previewNode" cx="56" cy="61" r="4" />
        <circle className="previewNode" cx="162" cy="61" r="4" />
        <path className="previewSignal" d="M118 50h22v12h-22zM80 66h24v12H80z" />
      </svg>
    );
  }

  return (
    <svg className="previewSvg" viewBox="0 0 220 118" role="img" aria-label="Structural diagram preview">
      <path className="previewAxis" d="M24 82H198" />
      <path className="previewBeam" d="M34 64H188" />
      <path className="previewColumn" d="M54 64v28M110 64v28M166 64v28" />
      <path className="previewLoad" d="M54 28v28M82 28v28M110 28v28M138 28v28M166 28v28" />
      <path className="previewLoadHead" d="m49 51 5 7 5-7M77 51l5 7 5-7M105 51l5 7 5-7M133 51l5 7 5-7M161 51l5 7 5-7" />
      <path className="previewCurve" d="M34 96c30-26 53-26 76 0 24 26 50 25 78 0" />
    </svg>
  );
}

function DocumentPreview({
  variant,
  pageLabel,
  previewUrl,
  title,
  onOpen,
}: {
  variant: ResearchCardData["preview"];
  pageLabel: string;
  previewUrl?: string;
  title: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`documentPreview ${variant}`} onClick={onOpen} aria-label={`Open paper detail for ${title}`}>
      {previewUrl ? (
        <img
          className="previewImage"
          src={previewUrl}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.hidden = true;
            event.currentTarget.closest(".documentPreview")?.classList.add("fallbackPreview");
          }}
        />
      ) : null}
      <div className="previewSheet" aria-hidden="true">
        <div className="previewTitle" />
        <div className="previewText" />
        <div className="previewText short" />
        <PreviewSvg variant={variant} />
      </div>
      <span className="previewBadge" title={title}>
        {pageLabel}
      </span>
      <span className="previewOpen">Open detail</span>
    </button>
  );
}

function ResearchCard({
  card,
  bookmarked,
  translation,
  onAsk,
  onOpen,
  onToggleBookmark,
  workspaceSelected,
  onToggleWorkspace,
  disabled,
}: {
  card: ResearchCardData;
  bookmarked: boolean;
  translation?: PaperTranslationState;
  onAsk: (card: ResearchCardData) => void;
  onOpen: (card: ResearchCardData) => void;
  onToggleBookmark: (card: ResearchCardData) => void;
  workspaceSelected?: boolean;
  onToggleWorkspace?: (card: ResearchCardData) => void;
  disabled: boolean;
}) {
  const title = translatedPaperText(translation, "paper.title", displayTitle(card));
  const summary = translatedPaperText(translation, "paper.summary", displaySummary(card));
  const translated = Boolean(translation?.showingTranslation);
  const visibleDate = /^Indexed\b/i.test(card.date.trim()) ? "" : card.date.trim();
  const citable = card.citable !== false && card.evidenceStatus !== "metadata_only";
  const nativeReaderCard = card.pageLabel === "Native full paper";
  const collectionLabel = card.collection === "ncce"
    ? "NCCE"
    : card.collection === "ce_project"
      ? "Student Transport"
      : card.provider
        ? discoveryProviderLabel(card.provider)
        : "All collections";
  const visibleDisciplineLabel = card.discipline?.trim() ? disciplineLabel(card.discipline) : "";
  const pagesLabel = card.pageStart != null
    ? card.pageEnd === card.pageStart
      ? `p.${card.pageStart}`
      : `p.${card.pageStart}-${card.pageEnd}`
    : nativeReaderCard
      ? card.pageLabel
      : card.pages
      ? `${card.pages} pages`
      : "Page mapping pending";

  return (
    <article className="researchCard">
      <div className="cardContent">
        <div className="cardTitleRow">
          <FileText className="cardDocIcon" aria-hidden />
          {citable ? (
            <button type="button" className="cardTitleButton" onClick={() => onOpen(card)}>
              <h2 lang={contentLanguage(title)}>{title}</h2>
            </button>
          ) : card.canonicalUrl ? (
            <a className="cardTitleButton catalogTitleLink" href={card.canonicalUrl} target="_blank" rel="noreferrer">
              <h2 lang={contentLanguage(title)}>{title}</h2>
            </a>
          ) : (
            <div className="cardTitleButton"><h2 lang={contentLanguage(title)}>{title}</h2></div>
          )}
        </div>
        <div className="paperMeta">
          {visibleDate ? <span>{visibleDate}</span> : null}
          <span>{collectionLabel}</span>
          {visibleDisciplineLabel ? <span>{visibleDisciplineLabel}</span> : null}
          {citable ? <span>{pagesLabel}</span> : null}
          <span className={citable ? "citableMeta" : "discoveryMeta"}>
            {citable
              ? nativeReaderCard
                ? "Native full text verified"
                : `Page-cited evidence · ${card.evidenceCount}`
              : "Discovery metadata"}
          </span>
          {translated ? <span className="translatedMeta">EN translation</span> : null}
          <VisibilityReceiptBadge receipt={card.visibility} />
        </div>
        <VisibilityCorrectionControl card={card} />
        <p className="paperSummary" lang={contentLanguage(summary)}>{summary}</p>
        <div className="tagRow" aria-label="Research tags">
          {card.tags.map((tag, index) => {
            const displayTag = translatedPaperText(translation, `paper.tag.${index}`, tag);
            return <span key={tag} lang={contentLanguage(displayTag)}>#{displayTag}</span>;
          })}
        </div>
        <div className="cardActions">
          {citable ? (
            <>
              {onToggleWorkspace ? (
                <button
                  type="button"
                  className={`cardAction workspaceSelectAction ${workspaceSelected ? "selected" : ""}`}
                  aria-pressed={workspaceSelected}
                  disabled={disabled}
                  onClick={() => onToggleWorkspace(card)}
                >
                  {workspaceSelected ? <Check size={17} strokeWidth={2.3} aria-hidden /> : <TableProperties size={17} strokeWidth={2.2} aria-hidden />}
                  <span>{workspaceSelected ? "Selected" : "Compare"}</span>
                </button>
              ) : null}
              <button type="button" className="cardAction primary" disabled={disabled} onClick={() => onAsk(card)}>
                <MessageCircle size={17} strokeWidth={2.2} aria-hidden />
                <span>Ask with evidence</span>
              </button>
              <button
                type="button"
                className={`cardAction iconAction ${bookmarked ? "saved" : ""}`}
                aria-pressed={bookmarked}
                aria-label={bookmarked ? "Remove saved paper" : "Save paper to library"}
                title={bookmarked ? "Saved" : "Save to library"}
                disabled={disabled}
                onClick={() => onToggleBookmark(card)}
              >
                <Bookmark size={17} strokeWidth={2.2} aria-hidden />
                <span className="srOnly">{bookmarked ? "Saved" : "Save to library"}</span>
              </button>
              <button type="button" className="cardAction" onClick={() => onOpen(card)}>
                <Layers3 size={17} strokeWidth={2.2} aria-hidden />
                <span>{nativeReaderCard ? "Read paper" : "Evidence"}</span>
                {!nativeReaderCard ? <strong>{card.evidenceCount}</strong> : null}
              </button>
            </>
          ) : card.canonicalUrl ? (
            <a className="cardAction primary" href={card.canonicalUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} strokeWidth={2.2} aria-hidden />
              <span>Open source record</span>
            </a>
          ) : (
            <span className="catalogUnavailable">Source link unavailable</span>
          )}
        </div>
      </div>
      {citable ? (
        <DocumentPreview
          variant={card.preview}
          pageLabel={card.pageLabel ?? "PDF preview"}
          previewUrl={card.previewUrl}
          title={card.title}
          onOpen={() => onOpen(card)}
        />
      ) : (
        <aside className="catalogSourceCard" aria-label="Discovery record status">
          <Database size={20} aria-hidden />
          <strong>{discoveryProviderLabel(card.provider)} metadata</strong>
          <span>Not used for AI answers or citations</span>
          {card.journalTitle ? <small>{card.journalTitle}</small> : null}
        </aside>
      )}
    </article>
  );
}

function ResearchFeed({
  cards,
  bookmarkedCards,
  paperTranslations,
  activeFilter,
  status,
  error,
  query,
  hasMore,
  isLoadingMore,
  onAsk,
  onOpen,
  onToggleBookmark,
  workspaceSelection,
  onToggleWorkspace,
  onCompareSelected,
  onClearWorkspaceSelection,
  onRetry,
  onLoadMore,
  disabled,
}: {
  cards: ResearchCardData[];
  bookmarkedCards: Record<string, ResearchCardData>;
  paperTranslations: Record<string, PaperTranslationState>;
  activeFilter: FeedFilter;
  status: FeedStatus;
  error: string;
  query: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onAsk: (card: ResearchCardData) => void;
  onOpen: (card: ResearchCardData) => void;
  onToggleBookmark: (card: ResearchCardData) => void;
  workspaceSelection: string[];
  onToggleWorkspace: (card: ResearchCardData) => void;
  onCompareSelected: () => void;
  onClearWorkspaceSelection: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  disabled: boolean;
}) {
  const isSavedFilter = activeFilter === "saved";
  const savedCount = Object.keys(bookmarkedCards).length;

  if (status === "loading") {
    return (
      <section className="feedStack" aria-label="Seedy Research feed loading" aria-busy="true">
        <p className="srOnly" role="status">
          Loading research feed
        </p>
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={`skeleton-${index}`} className="researchCard skeletonCard" aria-hidden>
            <div className="cardContent">
              <span className="skeletonLine title" />
              <span className="skeletonLine meta" />
              <span className="skeletonLine" />
              <span className="skeletonLine short" />
            </div>
            <div className="documentPreview skeletonPreview" />
          </article>
        ))}
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="feedStack" aria-label="Seedy Research feed error">
        <article className="feedStateCard" role="alert">
          <h2>Research feed unavailable</h2>
          <p>{error || "Seedy Research could not load the indexed paper collection."}</p>
          <button type="button" className="cardAction primary" onClick={onRetry}>
            Retry
          </button>
        </article>
      </section>
    );
  }

  if (!cards.length) {
    return (
      <section className="feedStack" aria-label="Seedy Research feed empty">
        <article className="feedStateCard">
          <h2>{isSavedFilter ? (savedCount ? "No saved papers match this search" : "No saved papers yet") : "No papers match these filters"}</h2>
          <p>
            {isSavedFilter
              ? savedCount
                ? `Try a broader search than "${query}" or change the collection.`
                : "Bookmark papers from the feed to keep them available here."
              : query
                ? `Try a broader search than "${query}" or change the filters.`
                : "Choose another filter or collection to explore more research."}
          </p>
          {!isSavedFilter ? (
            <button type="button" className="cardAction" onClick={onRetry}>
              Refresh feed
            </button>
          ) : null}
        </article>
      </section>
    );
  }

  return (
    <section className="feedStack" aria-label="Seedy Research feed">
      {isSavedFilter ? (
        <aside className="workspaceSelectionTray" aria-label="Compare saved papers">
          <div>
            <strong>{workspaceSelection.length} selected</strong>
            <span>Choose 2–50 saved papers. Workspace processes six per verified batch.</span>
          </div>
          <div>
            {workspaceSelection.length ? (
              <button type="button" className="textAction" onClick={onClearWorkspaceSelection}>Clear</button>
            ) : null}
            <button
              type="button"
              className="cardAction primary"
              disabled={workspaceSelection.length < 2}
              onClick={onCompareSelected}
            >
              <TableProperties size={16} strokeWidth={2.2} aria-hidden />
              <span>Compare in Workspace</span>
            </button>
          </div>
        </aside>
      ) : null}
      {cards.map((card) => (
        <ResearchCard
          key={card.id}
          card={card}
          bookmarked={Boolean(bookmarkedCards[cardKey(card)])}
          translation={paperTranslations[cardKey(card)]}
          onAsk={onAsk}
          onOpen={onOpen}
          onToggleBookmark={onToggleBookmark}
          workspaceSelected={workspaceSelection.includes(card.source)}
          onToggleWorkspace={isSavedFilter ? onToggleWorkspace : undefined}
          disabled={disabled}
        />
      ))}
      {hasMore ? (
        <article className="feedLoadMore">
          <button type="button" className="cardAction primary" disabled={isLoadingMore} onClick={onLoadMore}>
            <Layers3 size={17} strokeWidth={2.2} aria-hidden />
            <span>{isLoadingMore ? "Loading more papers" : "Load more papers"}</span>
          </button>
        </article>
      ) : null}
    </section>
  );
}

function downloadCitation(card: ResearchCardData, format: "bibtex" | "ris") {
  const key = (card.paperCode || card.source || "civilmcp")
    .replace(/\.(md|pdf)$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "civilmcp";
  const year = String(card.proceedingYear ?? card.date.match(/\b(19|20)\d{2}\b/)?.[0] ?? "");
  const title = displayTitle(card).replace(/[{}]/g, "");
  const source = card.source.replace(/[{}]/g, "");
  const content = format === "bibtex"
    ? [
        `@${card.collection === "ncce" ? "inproceedings" : "techreport"}{${key},`,
        `  title = {${title}},`,
        year ? `  year = {${year}},` : "",
        `  note = {Seedy Research source: ${source}; page-linked evidence available},`,
        "}",
      ].filter(Boolean).join("\n")
    : [
        `TY  - ${card.collection === "ncce" ? "CPAPER" : "RPRT"}`,
        `TI  - ${title}`,
        year ? `PY  - ${year}` : "",
        `N1  - Seedy Research source: ${source}; page-linked evidence available`,
        "ER  -",
      ].filter(Boolean).join("\n");
  const blob = new Blob([content], { type: format === "bibtex" ? "application/x-bibtex;charset=utf-8" : "application/x-research-info-systems;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${key}.${format === "bibtex" ? "bib" : "ris"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PaperDetailDrawer({
  detail,
  status,
  error,
  citationMap,
  translation,
  paperLanguage,
  highlightedEvidence,
  bookmarked,
  libraryItem,
  onClose,
  onAsk,
  onOpenRelated,
  onToggleBookmark,
  onSaveLibrary,
  onLoadCitationMap,
  onPaperLanguageChange,
}: {
  detail: PaperDetailData | null;
  status: FeedStatus;
  error: string;
  citationMap: CitationMapState;
  translation?: PaperTranslationState;
  paperLanguage: PaperLanguage;
  highlightedEvidence: CivilEvidenceItem | null;
  bookmarked: boolean;
  libraryItem?: PaperWorkspaceItem;
  onClose: () => void;
  onAsk: (card: ResearchCardData) => void;
  onOpenRelated: (card: ResearchCardData) => void;
  onToggleBookmark: (card: ResearchCardData) => void;
  onSaveLibrary: (card: ResearchCardData, note: string, labels: string[]) => Promise<void>;
  onLoadCitationMap: () => void;
  onPaperLanguageChange: (language: PaperLanguage) => void;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const highlightedEvidenceRef = useRef<HTMLElement | null>(null);
  const isOpen = Boolean(detail) || status === "loading" || status === "error";
  const [libraryNote, setLibraryNote] = useState("");
  const [libraryLabels, setLibraryLabels] = useState("");
  const [librarySaving, setLibrarySaving] = useState(false);

  useEffect(() => {
    setLibraryNote(libraryItem?.note ?? "");
    setLibraryLabels((libraryItem?.labels ?? []).join(", "));
  }, [detail?.document.source, libraryItem?.labels, libraryItem?.note]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);
      previousFocus?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!detail || !highlightedEvidence) return;
    const frame = window.requestAnimationFrame(() => highlightedEvidenceRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [detail, highlightedEvidence]);

  if (!isOpen) return null;
  const paper = detail?.document;
  const sourceRef = paper?.sourcePdf || paper?.parentSourcePdf || paper?.source || "";
  const readerAccess = detail?.readerAccess ?? null;
  const publicReaderPath = paper ? `/papers/${encodeURIComponent(paper.source)}` : "#";
  const readerActionHref = readerAccess?.readerUrl
    ?? readerAccess?.sourceUrl
    ?? paper?.canonicalUrl
    ?? publicReaderPath;
  const readerActionLabel = readerAccess?.mode === "native_verified"
    ? "Read verified full paper"
    : readerAccess?.mode === "source_hosted"
      ? "Open official full text"
      : readerAccess?.mode === "restricted"
        ? "Open institutional resolver"
        : readerAccess
          ? "Open source record"
          : "Open paper reader";
  const readerIsPrimary = readerAccess?.mode === "native_verified" || readerAccess?.mode === "source_hosted";
  const translatedTitle = paper
    ? translatedPaperText(translation, "paper.title", displayTitle(paper))
    : "Loading paper...";
  const translated = Boolean(translation?.showingTranslation);
  const translatedSummary = paper
    ? translatedPaperText(translation, "paper.summary", displaySummary(paper))
    : "";
  const evidenceRows = detail
    ? [...detail.evidence].sort((left, right) => {
        const score = (item: PaperDetailData["evidence"][number]) => {
          if (!highlightedEvidence) return 0;
          if (highlightedEvidence.id && item.id === highlightedEvidence.id) return 4;
          if (highlightedEvidence.sectionIndex != null && highlightedEvidence.chunkIndex != null
            && item.sectionIndex === highlightedEvidence.sectionIndex && item.chunkIndex === highlightedEvidence.chunkIndex) return 3;
          if (highlightedEvidence.pageStart != null && item.pageStart === highlightedEvidence.pageStart) return 2;
          return 0;
        };
        return score(right) - score(left);
      })
    : [];
  const isHighlighted = (item: PaperDetailData["evidence"][number]) => Boolean(
    highlightedEvidence && (
      (highlightedEvidence.id && item.id === highlightedEvidence.id)
      || (highlightedEvidence.sectionIndex != null && highlightedEvidence.chunkIndex != null
        && item.sectionIndex === highlightedEvidence.sectionIndex && item.chunkIndex === highlightedEvidence.chunkIndex)
      || (!highlightedEvidence.id && highlightedEvidence.pageStart != null && item.pageStart === highlightedEvidence.pageStart)
    )
  );
  return (
    <div className="detailBackdrop" role="presentation" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="paperDetailDrawer"
        role="dialog"
        aria-modal="true"
        aria-label="Paper detail"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            drawerRef.current?.querySelectorAll<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])") ?? [],
          ).filter((element) => !element.hasAttribute("disabled"));
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && globalThis.document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && globalThis.document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="detailHeader">
          <div>
            <p className="detailEyebrow">Paper detail</p>
            <h2 lang={contentLanguage(translatedTitle)}>{translatedTitle}</h2>
            {paper ? (
              <p className="detailMeta">
                {paper.sourceLabel} · {paper.source}
                {paper.pageStart != null ? ` · ${paper.pageEnd === paper.pageStart ? `p.${paper.pageStart}` : `p.${paper.pageStart}-${paper.pageEnd}`}` : ""}
              </p>
            ) : null}
          </div>
          <button ref={closeButtonRef} type="button" className="detailClose" onClick={onClose} aria-label="Close paper detail">
            <X size={19} strokeWidth={2.4} aria-hidden />
          </button>
        </div>

        {status === "loading" && !detail ? (
          <div className="detailBody">
            <span className="skeletonLine title" />
            <span className="skeletonLine" />
            <span className="skeletonLine short" />
          </div>
        ) : status === "error" && !detail ? (
          <div className="detailBody">
            <p className="detailError">{error || "Paper details could not be loaded."}</p>
          </div>
        ) : detail && paper ? (
          <div className="detailBody">
            <div className="detailActions">
              <a
                className={`cardAction ${readerIsPrimary ? "primary detailReaderPrimary" : ""}`}
                href={readerActionHref}
                target="_blank"
                rel="noreferrer"
                data-testid="paper-reader-action"
                data-reader-mode={readerAccess?.mode ?? "unknown"}
              >
                <ExternalLink size={17} strokeWidth={2.2} aria-hidden />
                <span>{readerActionLabel}</span>
              </a>
              <button type="button" className={`cardAction ${readerIsPrimary ? "" : "primary"}`} onClick={() => onAsk(paper)}>
                <MessageCircle size={17} strokeWidth={2.2} aria-hidden />
                <span>Ask this paper</span>
              </button>
              <button
                type="button"
                className={`cardAction ${bookmarked ? "saved" : ""}`}
                aria-pressed={bookmarked}
                onClick={() => onToggleBookmark(paper)}
              >
                <Bookmark size={17} strokeWidth={2.2} aria-hidden />
                <span>{bookmarked ? "Saved" : "Save to library"}</span>
              </button>
              <PaperLanguageToggle
                language={paperLanguage}
                isTranslating={translation?.status === "loading"}
                onChange={onPaperLanguageChange}
              />
              <button type="button" className="cardAction" onClick={() => downloadCitation(paper, "bibtex")}>
                <Download size={17} strokeWidth={2.2} aria-hidden />
                <span>BibTeX</span>
              </button>
              <button type="button" className="cardAction" onClick={() => downloadCitation(paper, "ris")}>
                <Download size={17} strokeWidth={2.2} aria-hidden />
                <span>RIS · Zotero</span>
              </button>
              <a
                className="cardAction"
                href={`https://openalex.org/works?search=${encodeURIComponent(displayTitle(paper))}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={17} strokeWidth={2.2} aria-hidden />
                <span>Compare globally</span>
              </a>
              <button type="button" className="cardAction" onClick={onLoadCitationMap} disabled={citationMap.phase === "loading"}>
                <GitFork size={17} strokeWidth={2.2} aria-hidden />
                <span>{citationMap.phase === "loading" ? "Mapping…" : "Citation map"}</span>
              </button>
              {sourceRef ? (
                <button
                  type="button"
                  className="cardAction"
                  onClick={() => {
                    void navigator.clipboard?.writeText(sourceRef);
                  }}
                >
                  <Copy size={17} strokeWidth={2.2} aria-hidden />
                  <span>Copy source</span>
                </button>
              ) : null}
              <span>{detail.counts.sections} sections</span>
              <span>{detail.counts.chunks} chunks</span>
              {readerAccess ? <span className="translationStatus">{readerAccess.statusLabel}</span> : null}
              {translation?.showingTranslation ? <span className="translationStatus">Translated from Thai</span> : null}
            </div>

            {paper.previewUrl ? (
              <button type="button" className="detailPreview" onClick={() => onAsk(paper)}>
                <img src={paper.previewUrl} alt="" loading="lazy" />
                <span>Ask from this indexed paper</span>
              </button>
            ) : null}

            <section className="detailSection">
              <h3>Summary</h3>
              <p lang={contentLanguage(translatedSummary)}>{translatedSummary}</p>
            </section>

            <section className="detailSection libraryEditor">
              <div className="libraryHeading">
                <div>
                  <h3>Library notes</h3>
                  <p>Use comma-separated labels as folders or review tags.</p>
                </div>
                {!bookmarked ? <span>Save this paper first</span> : null}
              </div>
              <label>
                <span>Folders and labels</span>
                <input
                  value={libraryLabels}
                  onChange={(event) => setLibraryLabels(event.target.value)}
                  placeholder="Road safety, Thesis, Read next"
                  disabled={!bookmarked || librarySaving}
                />
              </label>
              <label>
                <span>Note</span>
                <textarea
                  value={libraryNote}
                  onChange={(event) => setLibraryNote(event.target.value)}
                  placeholder="Why this paper matters, questions to verify, or advisor feedback"
                  disabled={!bookmarked || librarySaving}
                />
              </label>
              <button
                type="button"
                className="cardAction primary"
                disabled={!bookmarked || librarySaving}
                onClick={() => {
                  setLibrarySaving(true);
                  void onSaveLibrary(
                    paper,
                    libraryNote,
                    [...new Set(libraryLabels.split(",").map((label) => label.trim()).filter(Boolean))].slice(0, 20),
                  ).finally(() => setLibrarySaving(false));
                }}
              >
                <Bookmark size={17} aria-hidden />
                <span>{librarySaving ? "Saving..." : "Save note"}</span>
              </button>
            </section>

            <section className="detailSection">
              <h3>Outline</h3>
              <div className="outlineList">
                {detail.sections.slice(0, 14).map((section) => {
                  const sectionTitle = translatedPaperText(translation, `section.${section.id}.title`, section.title);
                  const sectionSnippet = translatedPaperText(translation, `section.${section.id}.snippet`, section.snippet);
                  return (
                    <article key={section.id}>
                      <strong lang={contentLanguage(sectionTitle)}>
                        {section.sectionIndex != null ? `${section.sectionIndex}. ` : ""}
                        {sectionTitle}
                      </strong>
                      <span>{section.pageStart != null ? (section.pageEnd === section.pageStart ? `p.${section.pageStart}` : `p.${section.pageStart}-${section.pageEnd}`) : "no page"}</span>
                      {section.snippet ? <p lang={contentLanguage(sectionSnippet)}>{sectionSnippet}</p> : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="detailSection">
              <h3>{highlightedEvidence ? "Evidence used in the answer" : "Representative evidence"}</h3>
              {highlightedEvidence ? (
                <p className="detailSectionLead">The cited packet is pinned first and highlighted below.</p>
              ) : null}
              <div className="detailEvidenceGrid">
                {evidenceRows.slice(0, 8).map((item) => {
                  const evidenceTitle = item.sectionTitle
                    ? translatedPaperText(translation, `evidence.${item.id}.title`, item.sectionTitle)
                    : "";
                  const evidenceSnippet = translatedPaperText(translation, `evidence.${item.id}.snippet`, item.snippet);
                  return (
                    <article
                      key={item.id}
                      ref={isHighlighted(item) ? highlightedEvidenceRef : undefined}
                      className={`detailEvidenceCard ${isHighlighted(item) ? "highlighted" : ""}`}
                      aria-label={isHighlighted(item) ? "Cited evidence packet" : undefined}
                    >
                      <div>
                        <strong>
                          {isHighlighted(item) ? "Cited in answer" : `Evidence chunk ${item.chunkIndex ?? "?"}`}
                          {item.pageStart != null ? ` · ${item.pageEnd === item.pageStart ? `p.${item.pageStart}` : `p.${item.pageStart}-${item.pageEnd}`}` : ""}
                        </strong>
                        {item.sectionTitle ? <span lang={contentLanguage(evidenceTitle)}>{evidenceTitle}</span> : null}
                      </div>
                      <p lang={contentLanguage(evidenceSnippet)}>{evidenceSnippet}</p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="detailSection">
              <div className="detailSectionHeading">
                <div><h3>Thai-to-global connection map</h3><p className="detailSectionLead">OpenAlex metadata for discovery only. Seedy Research does not use these nodes as answer evidence.</p></div>
                {citationMap.phase !== "idle" ? <button type="button" className="textAction" onClick={onLoadCitationMap}>Refresh</button> : null}
              </div>
              {citationMap.phase === "idle" ? (
                <button type="button" className="citationMapEmpty" onClick={onLoadCitationMap}><GitFork size={18} aria-hidden /><span><strong>Trace citations and related work</strong><small>See what this paper cites, who cites it, and similar global research.</small></span></button>
              ) : citationMap.phase === "loading" ? <p className="detailEmpty">Building a bounded citation map…</p>
                : citationMap.phase === "error" ? <p className="detailError">{citationMap.error}</p>
                  : citationMap.response?.status === "connected"
                    && citationMap.response.seed
                    && isTraceableOpenAlexMatch(citationMap.response.match) ? (
                    <div className="citationMap">
                      <p className={`citationMatch ${citationMap.response.match.status}`}>
                        Verified DOI OpenAlex match
                      </p>
                      <a href={citationMap.response.seed.url} target="_blank" rel="noreferrer" className="citationSeed"><span>Matched seed</span><strong>{citationMap.response.seed.title}</strong><small>{citationMap.response.seed.citedByCount.toLocaleString("en-US")} citations</small></a>
                      {citationMap.response.relationsStatus === "partial" ? (
                        <p className="detailEmpty">Some OpenAlex relationships are temporarily unavailable. The metadata-only nodes shown here may be incomplete.</p>
                      ) : citationMap.response.relationsStatus === "unavailable" ? (
                        <p className="detailEmpty">OpenAlex verified the DOI seed, but relationship enrichment is temporarily unavailable. Refresh to retry.</p>
                      ) : null}
                      <div className="citationNodes">
                        {citationMap.response.nodes.map((node) => (
                          <a key={`${node.relation}-${node.id}`} href={node.url} target="_blank" rel="noreferrer" data-relation={node.relation}>
                            <span>{node.relation === "cites" ? "Cited by seed" : node.relation === "cited_by" ? "Cites seed" : "Related"}</span>
                            <strong>{node.title}</strong>
                            <small>{[node.year, `${node.citedByCount.toLocaleString("en-US")} citations`].filter(Boolean).join(" · ")}</small>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : citationMap.response && citationMap.response.status !== "connected" ? (
                    <p className="detailEmpty">OpenAlex is temporarily unavailable, so Seedy makes no visibility or identity claim. <button type="button" className="inlineTextButton" onClick={onLoadCitationMap}>Retry</button>.</p>
                  ) : citationMap.response?.match.status === "candidate" ? (
                    <p className="detailEmpty">A candidate OpenAlex match needs human confirmation before SeedyMCP can trace its relationships. <a href={citationMap.response.searchUrl} target="_blank" rel="noreferrer">Review in OpenAlex</a>.</p>
                  ) : <p className="detailEmpty">No exact OpenAlex match was found in this lookup. This is not a permanent absence claim. <a href={citationMap.response?.searchUrl} target="_blank" rel="noreferrer">Search OpenAlex</a>.</p>}
            </section>

            <section className="detailSection">
              <h3>Related Thai evidence</h3>
              <p className="detailSectionLead">
                {status === "loading"
                  ? "Finding page-linked studies in the same research field…"
                  : "More page-linked studies in the same research field."}
              </p>
              {detail.related?.length ? (
                <div className="relatedPaperList">
                  {detail.related.map((related) => (
                    <button type="button" key={related.id} onClick={() => onOpenRelated(related)}>
                      <strong>{displayTitle(related)}</strong>
                      <span>{related.paperCode || related.sourceLabel} · {related.evidenceCount} evidence</span>
                    </button>
                  ))}
                </div>
              ) : status !== "loading" ? <p className="detailEmpty">No related indexed evidence was found.</p> : null}
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ConversationFeed({
  messages,
  sessionId,
  onAsk,
  onOpenEvidence,
  onExportEvidenceBrief,
}: {
  messages: UIMessage[];
  sessionId: string;
  onAsk: (prompt: string) => void;
  onOpenEvidence: (item: CivilEvidenceItem) => void;
  onExportEvidenceBrief: (annotation: CivilMissionAnnotation) => void;
}) {
  return (
    <section className="feedStack conversationFeed" aria-label="Conversation">
      {messages.map((message, index) => {
        const isUser = message.role === "user";
        const previousQuestion = isUser
          ? undefined
          : [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
        return (
          <article key={message.id} className={`conversationCard ${isUser ? "user" : "assistant"}`}>
            <div className="conversationHeader">
              <span className="conversationRole">
                {isUser ? <Search size={16} strokeWidth={2.2} aria-hidden /> : <Gauge size={16} strokeWidth={2.2} aria-hidden />}
                {isUser ? "Your question" : "Seedy Research answer"}
              </span>
            </div>
            <MessageRenderer
              message={message}
              sessionId={sessionId}
              question={previousQuestion ? messageText(previousQuestion) : undefined}
              onAsk={onAsk}
              onOpenEvidence={onOpenEvidence}
              onExportEvidenceBrief={onExportEvidenceBrief}
            />
          </article>
        );
      })}
    </section>
  );
}

function ChatWorkspace({
  messages,
  sessionId,
  title,
  isLoading,
  error,
  onNewChat,
  onAsk,
  onOpenEvidence,
  onExportEvidenceBrief,
}: {
  messages: UIMessage[];
  sessionId: string;
  title: string;
  isLoading: boolean;
  error?: Error;
  onNewChat: () => void;
  onAsk: (prompt: string) => void;
  onOpenEvidence: (item: CivilEvidenceItem) => void;
  onExportEvidenceBrief: (annotation: CivilMissionAnnotation) => void;
}) {
  return (
    <section className="workspacePanel" aria-label="Chat workspace">
      <div className="workspaceHeader">
        <div>
          <p className="workspaceEyebrow">Conversation</p>
          <h2>{title || "New research"}</h2>
          <p>Sources and answers stay together in this chat.</p>
        </div>
        <button type="button" className="cardAction primary" onClick={onNewChat} disabled={isLoading}>
          <Plus size={17} strokeWidth={2.2} aria-hidden />
          <span>New chat</span>
        </button>
      </div>

      {messages.length ? (
        <ConversationFeed
          messages={messages}
          sessionId={sessionId}
          onAsk={onAsk}
          onOpenEvidence={onOpenEvidence}
          onExportEvidenceBrief={onExportEvidenceBrief}
        />
      ) : (
        <article className="feedStateCard chatEmptyState">
          <h2>Ask your first question</h2>
          <p>Seedy Research searches the selected collection and cites the pages it uses.</p>
        </article>
      )}
      {error ? (
        <article className="feedStateCard errorState" role="alert">
          <h2>We couldn&apos;t send that question</h2>
          <p>Try again or choose another model.</p>
        </article>
      ) : null}
    </section>
  );
}

function ChatHistoryPanel({
  sessions,
  status,
  error,
  currentSessionId,
  pendingDeleteSessionId,
  deletingSessionId,
  onNewChat,
  onOpenSession,
  onRequestDeleteSession,
  onCancelDeleteSession,
  onConfirmDeleteSession,
}: {
  sessions: ChatSessionSummary[];
  status: SessionsStatus;
  error: string;
  currentSessionId: string;
  pendingDeleteSessionId: string | null;
  deletingSessionId: string | null;
  onNewChat: () => void;
  onOpenSession: (sessionId: string) => void;
  onRequestDeleteSession: (sessionId: string) => void;
  onCancelDeleteSession: () => void;
  onConfirmDeleteSession: (sessionId: string) => void;
}) {
  return (
    <section className="workspacePanel" aria-label="Chat history">
      <div className="workspaceHeader">
        <div>
          <p className="workspaceEyebrow">History</p>
          <h2>Saved research</h2>
          <p>Resume a conversation or start a new one.</p>
        </div>
        <button type="button" className="cardAction primary" onClick={onNewChat}>
          <Plus size={17} strokeWidth={2.2} aria-hidden />
          <span>New chat</span>
        </button>
      </div>

      {status === "loading" ? (
        <article className="feedStateCard">
          <h2>Loading history</h2>
          <p>Fetching saved conversations.</p>
        </article>
      ) : status === "error" ? (
        <article className="feedStateCard errorState" role="alert">
          <h2>History unavailable</h2>
          <p>{error || "Check the connection and reopen History."}</p>
        </article>
      ) : sessions.length ? (
        <div className="historyList">
          {sessions.map((session) => {
            const selected = session.sessionId === currentSessionId;
            const confirmingDelete = session.sessionId === pendingDeleteSessionId;
            const deleting = session.sessionId === deletingSessionId;
            return (
              <article key={session.sessionId} className={`historyCard ${selected ? "selected" : ""}`}>
                <button type="button" className="historyMain" onClick={() => onOpenSession(session.sessionId)}>
                  <span className="historyTitle">{session.title}</span>
                  <span className="historySnippet">{session.lastUserMessage || "No messages in this session yet."}</span>
                  <span className="historyMeta">
                    {session.mode === "mcp" ? "MCP ON" : "MCP OFF"} · {session.collection || "All"} · {session.messageCount} messages ·{" "}
                    {formatSessionTime(session.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="historyDelete"
                  aria-label={`Delete ${session.title}`}
                  aria-expanded={confirmingDelete}
                  onClick={() => onRequestDeleteSession(session.sessionId)}
                >
                  <Trash2 size={16} strokeWidth={2.2} aria-hidden />
                </button>
                {confirmingDelete ? (
                  <div className="historyConfirm" role="alert">
                    <span>Delete this chat history?</span>
                    <button type="button" disabled={deleting} onClick={() => onConfirmDeleteSession(session.sessionId)}>
                      {deleting ? "Deleting..." : "Delete"}
                    </button>
                    <button type="button" disabled={deleting} onClick={onCancelDeleteSession}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <article className="feedStateCard">
          <h2>No saved research yet</h2>
          <p>Start a chat to save it here.</p>
        </article>
      )}
    </section>
  );
}

function SharedPanel({
  title,
  messageCount,
  shareUrl,
  isBusy,
  onCreateLink,
  onCopyLink,
  onExport,
}: {
  title: string;
  messageCount: number;
  shareUrl: string;
  isBusy: boolean;
  onCreateLink: () => void;
  onCopyLink: () => void;
  onExport: () => void;
}) {
  const canShare = messageCount > 0;
  const shareButtonLabel = isBusy ? "Preparing..." : shareUrl ? "Copy link" : canShare ? "Create link" : "Start chat first";

  return (
    <section className="workspacePanel" aria-label="Share workspace">
      <div className="workspaceHeader">
        <div>
          <p className="workspaceEyebrow">Share</p>
          <h2>Share this research</h2>
          <p>Create a read-only link to the conversation and its sources.</p>
        </div>
        <button
          type="button"
          className="cardAction primary"
          onClick={shareUrl ? onCopyLink : onCreateLink}
          disabled={isBusy || !canShare}
        >
          <Share2 size={17} strokeWidth={2.2} aria-hidden />
          <span>{shareButtonLabel}</span>
        </button>
      </div>

      <div className="shareGrid">
        <article className="shareCard">
          <p className="workspaceEyebrow">Current session</p>
          <h3>{title || "Untitled chat"}</h3>
          <p>{messageCount ? `${messageCount} messages ready to share.` : "Start a chat before creating a link."}</p>
          {shareUrl ? (
            <div className="shareUrlBox">
              <span>{shareUrl}</span>
              <button type="button" onClick={onCopyLink} disabled={isBusy}>
                Copy
              </button>
            </div>
          ) : null}
        </article>

        <article className="shareCard secondary">
          <p className="workspaceEyebrow">Export</p>
          <h3>Download session data</h3>
          <p>Keep a copy without creating a public link.</p>
          <button type="button" className="cardAction" onClick={onExport}>
            <Download size={17} strokeWidth={2.2} aria-hidden />
            <span>Export session</span>
          </button>
        </article>
      </div>
    </section>
  );
}

function PersonalizedResearchPathPanel({
  goal,
  setGoal,
  level,
  setLevel,
  outcome,
  setOutcome,
  path,
  status,
  error,
  completedStages,
  stageMastery,
  checkpointAnswers,
  checkpointAssessments,
  assessingStageId,
  onBuild,
  onReset,
  onAnswerChange,
  onAssessCheckpoint,
  onAdapt,
  onExport,
  onOpenPaper,
}: {
  goal: string;
  setGoal: (value: string) => void;
  level: PathLevel;
  setLevel: (value: PathLevel) => void;
  outcome: PathOutcome;
  setOutcome: (value: PathOutcome) => void;
  path: ResearchPath | null;
  status: SessionsStatus;
  error: string;
  completedStages: string[];
  stageMastery: Record<string, ResearchPathCheckpointStatus>;
  checkpointAnswers: Record<string, string>;
  checkpointAssessments: Record<string, ResearchPathCheckpointAssessment>;
  assessingStageId: string;
  onBuild: () => void;
  onReset: () => void;
  onAnswerChange: (stageId: string, answer: string) => void;
  onAssessCheckpoint: (stageId: string) => void;
  onAdapt: () => void;
  onExport: () => void;
  onOpenPaper: (source: string) => void;
}) {
  const progress = path?.stages.length
    ? Math.round((completedStages.length / path.stages.length) * 100)
    : 0;
  const reviewCount = Object.values(stageMastery).filter((value) => value !== "understood").length;
  const nextStageIndex = path?.stages.findIndex((stage) => !completedStages.includes(stage.id)) ?? -1;
  const progressStages = path?.stages.map((stage, index) => {
    const complete = completedStages.includes(stage.id);
    const assessment = checkpointAssessments[stage.id];
    const hasDraft = Boolean(checkpointAnswers[stage.id]?.trim());
    const state = complete
      ? "mastered"
      : assessingStageId === stage.id
        ? "checking"
        : assessment
          ? "review"
          : hasDraft
            ? "draft"
            : index === nextStageIndex
              ? "current"
              : "upcoming";
    const label = {
      mastered: "Mastered",
      checking: "Checking",
      review: "Review",
      draft: "Draft",
      current: "Current",
      upcoming: "Upcoming",
    }[state];
    return { stage, index, state, label };
  }) ?? [];

  return (
    <section className="workspacePanel pathWorkspace" aria-label="Personalized research learning path">
      <div className="pathHeroSurface">
        <header className="pathHeader">
          <div>
            <p className="workspaceEyebrow"><Route size={14} aria-hidden /> Research Path</p>
            <h2>{path ? path.goal : "Turn a topic into a research plan"}</h2>
            <p>{path ? "Move from Thai evidence to global comparison leads, a candidate gap, and a testable next study." : "Set a goal. Seedy Research builds a bounded Thai-to-global path from page-linked evidence."}</p>
          </div>
          {path ? (
            <div className="pathHeaderActions">
              <button type="button" className="textAction" onClick={onExport}><Download size={15} aria-hidden /><span>{progress === 100 ? "Export reviewed path" : "Export draft path"}</span></button>
              <button type="button" className="textAction pathResetAction" onClick={onReset}><RefreshCw size={15} aria-hidden /><span>New path</span></button>
            </div>
          ) : null}
        </header>

        {path ? (
          <>
            <div className="pathProgress" aria-label={`${progress}% of research path mastered`}>
              <div className="pathProgressSummary">
                <span><strong>{completedStages.length}</strong> of {path.stages.length} stages mastered</span>
                <span>{progress}%</span>
              </div>
              <ol className="pathProgressSteps">
                {progressStages.map(({ stage, index, state, label }) => (
                  <li key={`progress-${stage.id}`} className={state}>
                    <button
                      type="button"
                      aria-label={`Stage ${index + 1}: ${stage.title} · ${label}`}
                      onClick={() => document.getElementById(stage.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{stage.title}</strong>
                      <small>{label}</small>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            {path.passportContext ? (
              <div className="pathPassportContinuity" role="note" aria-label="Research Passport continuity">
                <ShieldCheck size={17} aria-hidden />
                <div>
                  <strong>Continued from {path.passportContext.passportId}</strong>
                  <span>{path.passportContext.evidenceIds.length} reviewed exact-page anchor{path.passportContext.evidenceIds.length === 1 ? "" : "s"} · {path.passportContext.gapLens} gap lens · source retained in full-paper stage</span>
                </div>
              </div>
            ) : null}
            {path.coverage?.status === "limited" ? (
              <div className="pathCoverageNotice" role="note">
                <TriangleAlert size={16} aria-hidden />
                <span>{path.coverage.message}</span>
              </div>
            ) : null}
            <p className="pathPlanningProvenance">
              {path.planningMode === "model" ? "Path planned with GPT‑5.6 Luna from the retrieved evidence set." : "Path built from retrieved evidence; checkpoint grading uses GPT‑5.6 Luna."}
            </p>
            {reviewCount ? (
              <button type="button" className="cardAction pathAdaptAction" onClick={onAdapt} disabled={status === "loading"}>
                <RefreshCw size={15} aria-hidden />
                <span>{status === "loading" ? "Adapting…" : `Adapt to ${reviewCount} learning gap${reviewCount === 1 ? "" : "s"}`}</span>
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {!path ? (
        <form className="pathBuilder" onSubmit={(event) => { event.preventDefault(); onBuild(); }}>
          <label className="pathGoalField">
            <span>What do you want to understand?</span>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. How can Thai cities reduce serious truck crashes?"
              rows={3}
              maxLength={280}
              required
            />
          </label>
          <div className="pathExamples" aria-label="Research path examples">
            {["Low-carbon concrete performance", "Flood-resilient infrastructure", "Urban road safety"].map((example) => (
              <button key={example} type="button" onClick={() => setGoal(example)}>{example}</button>
            ))}
          </div>
          <div className="pathPreferences">
            <GlassMenuSelect
              label="Starting point"
              value={level}
              options={PATH_LEVEL_OPTIONS}
              onChange={setLevel}
              icon={Gauge}
              className="pathGlassSelect"
            />
            <GlassMenuSelect
              label="Target outcome"
              value={outcome}
              options={PATH_OUTCOME_OPTIONS}
              onChange={setOutcome}
              icon={Target}
              className="pathGlassSelect"
            />
          </div>
          <button type="submit" className="primaryAction pathBuildAction" disabled={status === "loading" || goal.trim().length < 8}>
            {status === "loading" ? <><RefreshCw className="pathActionSpinner" size={16} aria-hidden /><span>Building path…</span></> : <><Sparkles size={16} aria-hidden /><span>Build research path</span></>}
          </button>
          {error ? <p className="pathError" role="alert">{error}</p> : null}
        </form>
      ) : (
        <>
          {error ? <p className="pathError pathInlineError" role="alert">{error}</p> : null}
          <div className="pathStageList">
            {path.stages.map((stage, index) => {
              const complete = completedStages.includes(stage.id);
              const answer = checkpointAnswers[stage.id] ?? "";
              const assessment = checkpointAssessments[stage.id];
              const assessing = assessingStageId === stage.id;
              const answerReady = answer.trim().length >= 40;
              const checkpointHelpId = `${stage.id}-checkpoint-help`;
              const responseTemplate = (index === 3 ? [
                "Candidate gap — not yet proven novel:",
                "Evidence boundary:",
                "Bounded research question:",
                "Population or context:",
                "Data and method:",
                "Validation step:",
                "What would falsify this premise:",
              ] : [
                "Claim:",
                `What I learned from ${stage.papers.map((paper) => paper.title).join(" and ")}:`,
                "Comparison or limitation:",
                "What remains uncertain:",
              ]).join("\n\n");
              const primaryPaper = stage.papers[0];
              const comparisonPaper = stage.papers[1];
              const evidenceReference = primaryPaper
                ? primaryPaper.title
                : "the selected source above";
              const exampleAnswer = index === 3
                ? [
                    `Demo research question: For urban roads in Thailand, which road-safety approach identified in ${evidenceReference} should be tested first, for whom, and under what local conditions?`,
                    `Evidence basis: ${primaryPaper?.summary?.slice(0, 520) || stage.objective}`,
                    "Proposed study plan: define one measurable safety outcome, document the road and road-user context, collect a baseline, test one bounded intervention or comparison, and report uncertainty rather than treating association as causation.",
                    comparisonPaper
                      ? `Comparison to resolve: ${comparisonPaper.summary.slice(0, 360)} (${comparisonPaper.title}). The follow-up study should test whether the difference comes from method, population, or road context.`
                      : "Evidence gap: a second comparable source or local dataset is needed before choosing the study design.",
                    "Next validation: open the exact pages, confirm the outcome definition and method, then narrow the population, location, and time window before data collection.",
                  ].join("\n\n")
                : [
                    `Demo learning claim: ${primaryPaper?.summary?.slice(0, 520) || stage.objective}`,
                    `Evidence to verify: ${evidenceReference}.`,
                    comparisonPaper
                      ? `Comparison or limitation: ${comparisonPaper.summary.slice(0, 420)} (${comparisonPaper.title}). The two studies may use different settings or methods, so the findings should not be treated as directly interchangeable.`
                      : "Comparison or limitation: This stage currently has one selected source, so the strength of cross-study comparison is limited.",
                    "What I need to learn next: confirm the definitions, method, study population, and limits on the linked pages before carrying the finding into a new research question.",
                  ].join("\n\n");
              const startTask = () => {
                if (!answer.trim()) onAnswerChange(stage.id, exampleAnswer);
                window.requestAnimationFrame(() => {
                  const field = document.getElementById(`${stage.id}-checkpoint-answer`);
                  field?.focus();
                  field?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              };
              return (
                <article id={stage.id} key={stage.id} className={`pathStage ${complete ? "complete" : ""}`}>
                  <div className="pathStageIndex" aria-hidden>{String(index + 1).padStart(2, "0")}</div>
                  <div className="pathStageBody">
                    <div className="pathStageHeading">
                      <div>
                        <h3>{stage.title}</h3>
                        <p>{stage.objective}</p>
                      </div>
                      <button
                        type="button"
                        className={`stageCheck ${complete ? "completed" : ""}`}
                        aria-label={complete ? "View completed task" : answerReady ? "Complete task" : "Load demo answer"}
                        disabled={assessing}
                        onClick={() => {
                          if (complete) document.getElementById(`${stage.id}-assessment`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                          else if (answerReady) onAssessCheckpoint(stage.id);
                          else startTask();
                        }}
                      >
                        {assessing ? <LoaderCircle className="pathActionSpinner" size={15} aria-hidden /> : complete ? <Check size={15} aria-hidden /> : answerReady ? <Sparkles size={15} aria-hidden /> : <FileText size={15} aria-hidden />}
                        <span>{assessing ? "Checking…" : complete ? "Completed" : answerReady ? "Complete task" : "Load demo answer"}</span>
                      </button>
                    </div>
                    <div className="pathReadingIntro">
                      <strong>Core reading</strong>
                      <span>Inspect the selected paper evidence. A verified full-text reader will open when rights permit; otherwise use exact-page evidence or the source record.</span>
                    </div>
                    <div className="pathPaperList">
                      {stage.papers.map((paper) => (
                        <button key={paper.id} type="button" className="pathPaper" aria-label={`Open paper evidence: ${paper.title}`} onClick={() => onOpenPaper(paper.source)}>
                          <span>{paper.title}</span>
                          <small><FileText size={12} aria-hidden /> Open paper evidence</small>
                        </button>
                      ))}
                    </div>
                    {stage.checkpointQuestion ? (
                      <div className="pathCheckpoint">
                        <div className="pathCheckpointPrompt">
                          <header className="pathCheckpointHeader">
                            <FileText size={17} aria-hidden />
                            <div>
                              <span>{index === 3 ? "Next-Study Protocol" : "Research checkpoint"}</span>
                              <p>{stage.checkpointQuestion}</p>
                            </div>
                          </header>
                          <ol className="pathCheckpointSteps">
                            <li><strong>Read</strong><span>Open the exact-page evidence or rights-cleared full paper and record the method, finding, and study context.</span></li>
                            <li><strong>Connect</strong><span>Treat OpenAlex relationships as metadata-only leads until their underlying papers are reviewed.</span></li>
                            <li><strong>{index === 3 ? "Test" : "Reflect"}</strong><span>{index === 3 ? "Keep the gap provisional and name the data, validation, and falsification condition for the next study." : "Answer in your own words and identify what you still need to research."}</span></li>
                          </ol>
                          <div className="pathDraftHeader">
                            <div><strong>Example use case</strong><span>Prefilled from the selected paper summaries; edit freely for a real task.</span></div>
                            <button type="button" className="cardAction pathStartTask" onClick={startTask}>
                              <FileText size={14} aria-hidden /><span>{answer.trim() ? "Continue writing" : "Load example answer"}</span>
                            </button>
                          </div>
                          <label htmlFor={`${stage.id}-checkpoint-answer`}>
                            <span className="visuallyHidden">Your reasoning</span>
                            <textarea
                              id={`${stage.id}-checkpoint-answer`}
                              value={answer}
                              onChange={(event) => onAnswerChange(stage.id, event.target.value)}
                              rows={7}
                              maxLength={3_000}
                              aria-describedby={checkpointHelpId}
                              placeholder={responseTemplate}
                            />
                          </label>
                          <div className="pathCheckpointActions">
                            <button
                              type="button"
                              className="primaryAction"
                              onClick={() => onAssessCheckpoint(stage.id)}
                              disabled={assessing || !answerReady}
                            >
                              {assessing ? <LoaderCircle className="pathActionSpinner" size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />}
                              <span>{assessing ? "Checking your reading…" : assessment ? "Check revised answer" : "Check understanding"}</span>
                            </button>
                            <small id={checkpointHelpId} aria-live="polite">
                              {assessing
                                ? "Comparing your note with the selected research papers."
                                : !answerReady
                                  ? `Add ${Math.max(0, 40 - answer.trim().length)} more characters so the claim can be checked.`
                                  : assessment?.assessmentMode === "evidence_fallback"
                                    ? "The reading is available, but model feedback needs a retry."
                                    : "Ready · OpenAI GPT‑5.6 Luna · selected readings only."}
                            </small>
                          </div>
                        </div>
                        {assessment ? (
                          <aside id={`${stage.id}-assessment`} className={`pathAssessment ${assessment.status}`} aria-label={`Checkpoint assessment for ${stage.title}`}>
                            <header>
                              <span>{assessment.gradeAvailable === false ? "Evidence available · grade pending" : assessment.status === "understood" ? "Mastered" : assessment.status === "partial" ? "Developing" : "Review needed"}</span>
                              <strong>{assessment.gradeAvailable === false ? "Not graded" : `${assessment.score}/100`}</strong>
                            </header>
                            <p>{assessment.feedback}</p>
                            {assessment.strengths.length ? <div><strong>What worked</strong><ul>{assessment.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
                            {assessment.gaps.length ? <div><strong>Repair next</strong><ul>{assessment.gaps.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
                            <div className="pathNextStep"><strong>Next step</strong><span>{assessment.nextStep}</span></div>
                            {assessment.evidence.length ? (
                              <div className="pathAssessmentEvidence">
                                <strong>Reading checked</strong>
                                <div>{assessment.evidence.map((item) => (
                                  <button key={`${stage.id}-${item.evidenceId}`} type="button" onClick={() => onOpenPaper(item.source)}>
                                    <span>{stage.papers.find((paper) => paper.source === item.source)?.title || "Selected research paper"}</span>
                                    <small>Open paper evidence</small>
                                  </button>
                                ))}</div>
                              </div>
                            ) : null}
                            {index < path.stages.length - 1 ? (
                              <button
                                type="button"
                                className="cardAction pathContinueTask"
                                onClick={() => document.getElementById(path.stages[index + 1].id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                              >
                                <span>Continue to stage {index + 2}</span>
                                <ArrowRight size={14} aria-hidden />
                              </button>
                            ) : null}
                          </aside>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          <aside className="pathResearchArtifacts" aria-label="Candidate gap and Next-Study Protocol">
            <article className="pathCandidateGap">
              <p className="workspaceEyebrow">Candidate · human validation required</p>
              <h3>Candidate gap · not proven novel</h3>
              <p>{path.candidateGap.statement}</p>
              <dl>
                <div><dt>Basis</dt><dd>{path.candidateGap.basis}</dd></div>
                <div><dt>Missing validation</dt><dd><ul>{path.candidateGap.missingValidation.map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
              </dl>
            </article>
            <article className="pathNextStudyProtocol">
              <p className="workspaceEyebrow">Draft framework · not a completed study design</p>
              <h3>Next-Study Protocol</h3>
              <dl>
                <div><dt>Question</dt><dd>{path.nextStudyProtocol.researchQuestion}</dd></div>
                <div><dt>Context / population</dt><dd>{path.nextStudyProtocol.contextOrPopulation}</dd></div>
                <div><dt>Data needed</dt><dd><ul>{path.nextStudyProtocol.dataNeeded.map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
                <div><dt>Method</dt><dd>{path.nextStudyProtocol.method}</dd></div>
                <div><dt>Validation</dt><dd>{path.nextStudyProtocol.validationPlan}</dd></div>
                <div><dt>Falsification</dt><dd>{path.nextStudyProtocol.falsificationCondition}</dd></div>
              </dl>
              <p className="pathProtocolBoundary">{path.nextStudyProtocol.evidenceBoundary}</p>
            </article>
          </aside>
          {completedStages.length === path.stages.length ? (
            <aside className="pathCompletion" aria-label="Research path complete">
              <div>
                <p className="workspaceEyebrow">Path complete</p>
                <h3>Export an auditable next-study package</h3>
                <p>Seedy Research carries the Thai evidence, metadata-only global leads, candidate gap, and Next-Study Protocol into one cited artifact.</p>
              </div>
              <button type="button" className="primaryAction" onClick={onExport}>
                <Download size={16} aria-hidden />
                <span>Export cited path</span>
              </button>
            </aside>
          ) : null}
          <aside className="openAlexBridge" aria-label="Global research discovery with OpenAlex">
            <div>
              <p className="workspaceEyebrow">OpenAlex · metadata only</p>
              <h3>{path.globalConnections?.leads.length ? "Global comparison leads" : "Compare with global research"}</h3>
              <p>{path.globalConnections?.leads.length
                ? "Selected cited, citing, or related works travel with this path as discovery leads—not evidence."
                : "Explore related work, authors, and citation paths outside the Seedy Research corpus."}</p>
            </div>
            {path.globalConnections?.leads.length ? (
              <div className="openAlexWorks">
                {path.globalConnections.leads.map((work) => (
                  <a key={work.id} href={work.url} target="_blank" rel="noreferrer">
                    <span>{work.title}</span>
                    <small>{[
                      work.relation === "cites" ? "Cited by Thai seed" : work.relation === "cited_by" ? "Cites Thai seed" : "Related work",
                      work.year,
                      work.topic,
                      "not evidence",
                    ].filter(Boolean).join(" · ")}</small>
                  </a>
                ))}
              </div>
            ) : path.openAlex.works.length ? (
              <div className="openAlexWorks">
                {path.openAlex.works.map((work) => (
                  <a key={work.id || work.url} href={work.url} target="_blank" rel="noreferrer">
                    <span>{work.title}</span>
                    <small>{[work.year, work.topic, `${work.citedByCount.toLocaleString("en-US")} citations`].filter(Boolean).join(" · ")}</small>
                  </a>
                ))}
              </div>
            ) : (
              <a className="openAlexSearch" href={path.openAlex.searchUrl} target="_blank" rel="noreferrer">Search this topic in OpenAlex</a>
            )}
          </aside>
        </>
      )}
    </section>
  );
}

type McpAccessKey = { key_id: string; token_prefix: string; label: string; last_used_at?: string | null; created_at?: string };
type OAuthGrant = { client: { id: string; name: string; uri?: string }; scopes: string[]; granted_at: string };
type McpUsage = { plan: "free" | "founder_pro"; included_units: number; used_units: number; remaining_units: number; reset_at: string };
type McpPricing = { openAccess?: boolean; tools: Array<{ label: string; units: number }>; founderPro: { monthlyUnits: number; priceThb: number } };

function McpAccessCard() {
  const [keys, setKeys] = useState<McpAccessKey[]>([]);
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [usage, setUsage] = useState<McpUsage | null>(null);
  const [pricing, setPricing] = useState<McpPricing | null>(null);
  const [revealedToken, setRevealedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [payload, grantPayload] = await Promise.all([
        fetchJson<{ keys: McpAccessKey[]; endpoint: string; usage: McpUsage | null; pricing: McpPricing }>("/api/mcp-access"),
        fetchJson<{ grants: OAuthGrant[]; oauthAvailable: boolean }>("/api/oauth-grants").catch(() => ({ grants: [], oauthAvailable: false })),
      ]);
      setKeys(payload.keys ?? []);
      setEndpoint(payload.endpoint ?? "");
      setUsage(payload.usage ?? null);
      setPricing(payload.pricing ?? null);
      setGrants(grantPayload.grants ?? []);
    } catch {
      setMessage("MCP access is temporarily unavailable.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createKey = async () => {
    setBusy(true);
    setMessage("");
    try {
      const payload = await fetchJson<{ token: string; endpoint: string }>("/api/mcp-access", { method: "POST", body: JSON.stringify({ label: "Research client" }) });
      setRevealedToken(payload.token);
      setEndpoint(payload.endpoint);
      setMessage("Copy this key now. SEEDY will not show it again.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MCP key could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    setBusy(true);
    try {
      await fetchJson(`/api/mcp-access?keyId=${encodeURIComponent(keyId)}`, { method: "DELETE" });
      setRevealedToken("");
      setMessage("MCP key revoked.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MCP key could not be revoked.");
    } finally {
      setBusy(false);
    }
  };

  const revokeGrant = async (clientId: string) => {
    setBusy(true);
    try {
      await fetchJson("/api/oauth-grants", { method: "DELETE", body: JSON.stringify({ clientId }) });
      setMessage("Connected app access revoked.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connected app access could not be revoked.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mcpAccessCard" aria-label="Personal MCP access">
      <header>
        <div><span className="workspaceEyebrow"><Terminal size={14} aria-hidden /> API &amp; MCP</span><strong>Use your Seedy Research library from research agents.</strong><small>Personal keys are owner-scoped, rate-limited, and revocable.</small></div>
        <button type="button" className="cardAction primary" onClick={() => void createKey()} disabled={busy || keys.length >= 5}><KeyRound size={15} aria-hidden /> Create key</button>
      </header>
      {endpoint ? <div className="mcpEndpoint"><span>MCP v2 endpoint</span><code>{endpoint}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(endpoint)}><Copy size={14} aria-hidden /> Copy</button></div> : null}
      {pricing?.openAccess ? <div className="mcpOpenAccess"><Sparkles size={16} aria-hidden /><div><strong>Open-access research API</strong><span>All 14 research tools are unlocked. Safety rate limits still protect service reliability.</span></div></div> : null}
      {usage ? <div className="mcpUnitMeter" aria-label={`${usage.remaining_units} of ${usage.included_units} Research Units remaining`}>
        <div><span>{usage.plan === "founder_pro" ? "Founder Pro API" : "Free API"}</span><strong>{usage.remaining_units.toLocaleString()} <small>of {usage.included_units.toLocaleString()} units left</small></strong></div>
        <progress value={usage.remaining_units} max={usage.included_units} />
        <small>Resets {new Date(usage.reset_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. AI answer credits are separate.</small>
      </div> : null}
      {revealedToken ? <div className="mcpTokenReveal" role="status"><code>{revealedToken}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(revealedToken)}><Copy size={14} aria-hidden /> Copy key</button></div> : null}
      {keys.length ? <div className="mcpKeyList">{keys.map((key) => <article key={key.key_id}><div><strong>{key.label}</strong><span>{key.token_prefix}{key.last_used_at ? ` · used ${new Date(key.last_used_at).toLocaleDateString("en-GB")}` : " · never used"}</span></div><button type="button" onClick={() => void revokeKey(key.key_id)} disabled={busy}>Revoke</button></article>)}</div> : <p>No personal MCP keys yet.</p>}
      {grants.length ? <div className="mcpKeyList">{grants.map((grant) => <article key={grant.client.id}><div><strong>{grant.client.name || "Connected research client"}</strong><span>OAuth · connected {new Date(grant.granted_at).toLocaleDateString("en-GB")}</span></div><button type="button" onClick={() => void revokeGrant(grant.client.id)} disabled={busy}>Disconnect</button></article>)}</div> : null}
      {message ? <small className="mcpAccessMessage">{message}</small> : null}
      <p className="mcpAccessScope">14 high-level tools cover Thai/global discovery, exact-page evidence, comparison, private PDFs, and folder-based library workflows. {pricing && !pricing.openAccess ? `${pricing.tools.map((item) => `${item.label} ${item.units}`).join(" · ")}. Founder Pro includes ${pricing.founderPro.monthlyUnits.toLocaleString()} monthly units.` : ""} <a href="/developers">Setup and usage</a></p>
    </section>
  );
}

function AccountPanel({
  user,
  authenticated,
  billing,
  authMode,
  setAuthMode,
  statusText,
  displayName,
  email,
  password,
  passwordConfirm,
  setDisplayName,
  setEmail,
  setPassword,
  setPasswordConfirm,
  onAuthSubmit,
  onGoogle,
  onForgotPassword,
  onUpdatePassword,
  onProfileUpdate,
  onDeleteAccount,
  onLogout,
  onCheckout,
  onPortal,
  isBusy,
  billingBusy,
}: {
  user: ChatUserProfile | null;
  authenticated: boolean;
  billing: BillingState;
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  statusText: string;
  displayName: string;
  email: string;
  password: string;
  passwordConfirm: string;
  setDisplayName: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setPasswordConfirm: (value: string) => void;
  onAuthSubmit: () => void;
  onGoogle: () => void;
  onForgotPassword: () => void;
  onUpdatePassword: () => void;
  onProfileUpdate: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
  onCheckout: () => void;
  onPortal: () => void;
  isBusy: boolean;
  billingBusy: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const isSignup = authMode === "signup";
  const isForgot = authMode === "forgot-password";
  const isRecovery = authMode === "recovery";
  const signedIn = authenticated && user?.isGuest === false && !isRecovery;
  const founderPro = billing.plan === "founder_pro" && billing.premiumModels;
  const resetLabel = billing.resetAt
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(billing.resetAt))
    : "next month";
  const authTitle = signedIn
    ? "Account"
    : isSignup
      ? "Create your account"
      : isForgot || isRecovery
        ? "Reset password"
        : "Sign in";
  const authSubtitle = signedIn
    ? "Your chats, paths, and papers sync across devices."
    : isSignup
      ? "Create one account for your research across devices."
      : isForgot
        ? "We'll email you a secure reset link."
      : isRecovery
          ? "Choose a new password with at least eight characters."
          : "Sign in to use Research Path, chat, workspace, and synced history.";
  const authSwitchLabel = isSignup
    ? "Already have an account?"
    : isForgot || isRecovery
      ? "Remember your password?"
      : "New to SEEDY?";
  const authSwitchAction = isSignup || isForgot || isRecovery ? "Sign in" : "Create account";
  const authSwitchMode: AuthMode = isSignup || isForgot || isRecovery ? "signin" : "signup";
  const primaryActionLabel = isBusy
    ? "Please wait..."
    : isSignup
      ? "Create account"
      : isForgot
        ? "Send recovery link"
        : isRecovery
          ? "Update password"
          : "Sign in";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isForgot) {
      onForgotPassword();
    } else if (isRecovery) {
      onUpdatePassword();
    } else {
      onAuthSubmit();
    }
  };

  return (
    <section className={`workspacePanel accountWorkspace ${!signedIn ? "guestAuthWorkspace" : ""}`} aria-label="Account and chat history login">
      {signedIn ? (
        <div className="workspaceHeader">
          <div>
            <p className="workspaceEyebrow">Account</p>
            <h2>{authTitle}</h2>
            <p>{authSubtitle}</p>
          </div>
          <button type="button" className="cardAction" onClick={onLogout}>
            <LogOut size={17} strokeWidth={2.2} aria-hidden />
            <span>Log out</span>
          </button>
        </div>
      ) : null}

      <div className={`accountGrid withPlan ${!signedIn ? "guestAuthGrid" : ""} ${signedIn && billing.openAccess ? "signedInAccountGrid" : ""}`}>
        <form className="accountCard authFormCard" onSubmit={onSubmit}>
          {!signedIn ? (
            <header className="authFormHeader">
              <p>{isSignup ? "Start your workspace" : isForgot || isRecovery ? "Account recovery" : "Welcome back"}</p>
              <h2>{authTitle}</h2>
              <span className="authFormSubtitle">{authSubtitle}</span>
            </header>
          ) : null}
          {signedIn ? (
            <>
              <div className="accountSignedIn">
                <span className="authAvatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{user.displayName}</strong>
                  <span>{user.email || "Verified workspace session"}</span>
                </div>
                <span className="accountSyncPill"><Check size={13} strokeWidth={2.4} aria-hidden /> Synced</span>
              </div>
              <div className="accountProfileEditor">
                <label>
                  <span>Display name</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    maxLength={80}
                    disabled={isBusy}
                  />
                </label>
                <div className="accountActions">
                  <button
                    type="button"
                    className="cardAction primary"
                    onClick={onProfileUpdate}
                    disabled={isBusy || !displayName.trim() || displayName.trim() === user.displayName}
                  >
                    <Save size={17} strokeWidth={2.2} aria-hidden />
                    <span>{isBusy ? "Saving..." : "Save profile"}</span>
                  </button>
                </div>
              </div>
              {statusText ? (
                <p className="authFormStatus" role="status" aria-live="polite">
                  {statusText}
                </p>
              ) : null}
              <details className="accountDangerZone accountDangerDisclosure">
                <summary>
                  <span className="accountDangerIcon"><Trash2 size={16} strokeWidth={2} aria-hidden /></span>
                  <span className="accountDangerCopy">
                    <strong>Delete account</strong>
                    <small>Permanently remove this account and all synced research.</small>
                  </span>
                  <span className="accountDangerManage">Manage</span>
                </summary>
                <div className="accountDangerControls">
                  <div>
                    <strong>Delete account</strong>
                    <span>Permanently removes chats, saved papers, workspaces, feedback, and sign-in access.</span>
                  </div>
                  <input
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    placeholder="Type DELETE to confirm"
                    aria-label="Type DELETE to confirm account deletion"
                    autoComplete="off"
                    disabled={isBusy}
                  />
                  <button
                    type="button"
                    className="cardAction dangerAction"
                    onClick={onDeleteAccount}
                    disabled={isBusy || deleteConfirmation !== "DELETE"}
                  >
                    <Trash2 size={17} strokeWidth={2.2} aria-hidden />
                    <span>Delete account</span>
                  </button>
                </div>
              </details>
            </>
          ) : (
            <>
              {!isForgot && !isRecovery ? (
                <>
                  <button type="button" className="googleAuthAction" onClick={onGoogle} disabled={isBusy}>
                    <svg className="googleAuthMark" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.25c1.9-1.75 2.97-4.33 2.97-7.41Z" />
                      <path fill="#34A853" d="M12 22c2.72 0 5-0.9 6.63-2.36l-3.25-2.54c-.9.6-2.05.96-3.38.96-2.62 0-4.85-1.77-5.64-4.15H3v2.62A10 10 0 0 0 12 22Z" />
                      <path fill="#FBBC05" d="M6.36 13.91A6.02 6.02 0 0 1 6.05 12c0-.66.11-1.3.31-1.91V7.47H3A10 10 0 0 0 2 12c0 1.61.39 3.14 1 4.53l3.36-2.62Z" />
                      <path fill="#EA4335" d="M12 5.94c1.48 0 2.8.51 3.84 1.5l2.87-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-9 5.47l3.36 2.62C7.15 7.71 9.38 5.94 12 5.94Z" />
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                  <div className="authDivider"><span>or continue with email</span></div>
                </>
              ) : null}

              {isSignup ? (
                <label>
                  <span>Name</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    disabled={isBusy}
                  />
                </label>
              ) : null}

              {!isRecovery ? (
                <label>
                  <span>Email</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={isBusy}
                  />
                </label>
              ) : null}

              {!isForgot ? (
                <div className="authField">
                  <div className="authFieldHeader">
                    <label htmlFor="civilmcp-password">Password</label>
                    {authMode === "signin" ? (
                      <button type="button" className="forgotPasswordButton" onClick={() => setAuthMode("forgot-password")} disabled={isBusy}>
                        Forgot password?
                      </button>
                    ) : null}
                  </div>
                  <div className="passwordField">
                    <input
                      id="civilmcp-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Minimum 8 characters"
                      type={showPassword ? "text" : "password"}
                      autoComplete={isSignup || isRecovery ? "new-password" : "current-password"}
                      required
                      minLength={8}
                      disabled={isBusy}
                    />
                    <button
                      type="button"
                      className="passwordToggle"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={isBusy}
                    >
                      {showPassword ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
                    </button>
                  </div>
                </div>
              ) : null}

              {isSignup || isRecovery ? (
                <label>
                  <span>Confirm password</span>
                  <input
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    placeholder="Enter the password again"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    disabled={isBusy}
                  />
                </label>
              ) : null}

              <div className="accountActions">
                <button
                  type="submit"
                  className="cardAction primary authPrimaryAction"
                  disabled={isBusy}
                >
                  {isForgot
                    ? <Mail size={17} strokeWidth={2.2} aria-hidden />
                    : isSignup
                      ? <UserPlus size={17} strokeWidth={2.2} aria-hidden />
                      : isRecovery
                        ? <ShieldCheck size={17} strokeWidth={2.2} aria-hidden />
                        : <LogIn size={17} strokeWidth={2.2} aria-hidden />}
                  <span>{primaryActionLabel}</span>
                </button>
              </div>
              <div className="authSwitch authSwitchBottom">
                <span>{authSwitchLabel}</span>
                <button type="button" onClick={() => setAuthMode(authSwitchMode)} disabled={isBusy}>
                  {authSwitchAction}
                </button>
              </div>
              {statusText ? (
                <p className="authFormStatus" role="status" aria-live="polite">
                  {statusText}
                </p>
              ) : null}
            </>
          )}
        </form>

        {!signedIn && billing.openAccess ? (
          <aside className="authBenefitCard openAccessCard" aria-label="SEEDY Open Access">
            <div className="openAccessBrand" aria-hidden="true">
              <img src="/civilmcp-logo.svg" alt="" />
              <span>
                <strong>SEEDY</strong>
                <small>Research Preview</small>
              </span>
            </div>
            <div className="openAccessLead">
              <p className="openAccessStatus"><Check size={14} strokeWidth={2.5} aria-hidden />{CIVILMCP_OPEN_ACCESS_LABEL}</p>
              <h3>Every research workflow is included after sign in.</h3>
              <p className="authBenefitIntro">Powered primarily by OpenAI GPT‑5.6. No answer credits, model paywalls, or Pro-only research modes.</p>
            </div>
            <div className="authFeatureList">
              <div className="authFeatureRow">
                <Route size={18} strokeWidth={2} aria-hidden />
                <span><strong>Evidence-based learning</strong><small>Build a path, answer checkpoints, repair gaps, and inspect exact source pages.</small></span>
              </div>
              <div className="authFeatureRow">
                <TableProperties size={18} strokeWidth={2} aria-hidden />
                <span><strong>Research Workspace + Deep Research</strong><small>Run bounded comparisons and auditable review workflows without upgrading.</small></span>
              </div>
              <div className="authFeatureRow">
                <ShieldCheck size={18} strokeWidth={2} aria-hidden />
                <span><strong>Reliability guardrails remain</strong><small>Abuse rate limits and agent/tool/context budgets keep the public demo stable.</small></span>
              </div>
            </div>
            {!signedIn ? (
              <div className="authAccessFlags" aria-label="Research tools included with your account">
                {MAIN_NAV_ITEMS.filter((item) => item.id !== "settings").map((item) => (
                  <span key={item.id}><Check size={12} strokeWidth={2.2} aria-hidden /><strong>{CIVILMCP_FEATURE_ACCESS[item.id].label}</strong></span>
                ))}
              </div>
            ) : null}
            <p className="openAccessNote">
              {signedIn ? <ShieldCheck size={16} strokeWidth={2} aria-hidden /> : <LogIn size={16} strokeWidth={2} aria-hidden />}
              <span>
                <strong>{signedIn ? "Sync is active" : "Sign in to sync"}</strong>
                <small>{signedIn ? "Your paths, chats, papers, and private research sources stay with you across devices." : "Authentication attaches research paths, chats, and history to one account across devices."}</small>
              </span>
            </p>
          </aside>
        ) : !billing.openAccess ? (
          <aside className="authBenefitCard" aria-label="SEEDY Founder Pro plan">
            <div className="planHeading">
              <span className={`planIcon ${founderPro ? "pro" : ""}`}>
                {founderPro ? <Crown size={19} strokeWidth={2.2} aria-hidden /> : <Sparkles size={19} strokeWidth={2.2} aria-hidden />}
              </span>
              <div>
                <p className="workspaceEyebrow">Founder Pro</p>
                <h3>{founderPro ? "Your Pro tools are ready." : "For larger research projects."}</h3>
              </div>
            </div>
            <p className="planPrice"><strong>฿{billing.priceThb}</strong><span>/ month</span></p>
            <p className="authBenefitIntro">Free includes 100 weekly credits for DeepSeek Flash and GPT-5.6 Luna. Pro adds 500 credits each month.</p>
            {signedIn && billing.creditsRemaining != null && billing.creditsIncluded != null ? (
              <div className="creditMeter" aria-label={`${billing.creditsRemaining} of ${billing.creditsIncluded} answer credits remaining`}>
                <div><strong>{billing.creditsRemaining}</strong><span>of {billing.creditsIncluded} credits left</span></div>
                <progress value={billing.creditsRemaining} max={billing.creditsIncluded} />
                <small>Next credit refresh {resetLabel}</small>
              </div>
            ) : null}
            <div className="authFeatureList">
              <div className="authFeatureRow">
                <Crown size={17} strokeWidth={2.2} aria-hidden />
                <span><strong>Research Workspace</strong><small>Screen, compare, and extract evidence across papers.</small></span>
              </div>
              <div className="authFeatureRow">
                <FileText size={17} strokeWidth={2.2} aria-hidden />
                <span><strong>Deep Research</strong><small>Create cited briefs across methods, findings, conflicts, and gaps.</small></span>
              </div>
            </div>
            {signedIn ? (
              <button
                type="button"
                className="cardAction primary planAction"
                onClick={founderPro || billing.hasStripeCustomer ? onPortal : onCheckout}
                disabled={billingBusy || (!billing.billingConfigured && !billing.hasStripeCustomer)}
              >
                <CreditCard size={17} strokeWidth={2.2} aria-hidden />
                <span>
                  {billingBusy
                    ? "Opening..."
                    : founderPro || billing.hasStripeCustomer
                      ? "Manage plan"
                      : billing.billingConfigured
                        ? "Upgrade to Founder Pro"
                        : "Founder Pro coming soon"}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="cardAction planAction"
                onClick={() => setAuthMode("signin")}
                disabled={!billing.billingConfigured}
              >
                <LogIn size={17} strokeWidth={2.2} aria-hidden />
                <span>{billing.billingConfigured ? "Sign in to upgrade" : "Founder Pro opening soon"}</span>
              </button>
            )}
            <p className="planFinePrint">Pro credits are added monthly. Usage is weighted by model; unused Pro credits do not roll over.</p>
          </aside>
        ) : null}
      </div>
      {signedIn ? <McpAccessCard /> : null}
      <nav className="accountLegalLinks" aria-label="Legal and support">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/support">Support &amp; takedowns</a>
      </nav>
    </section>
  );
}

function AppShell({
  children,
  mainRailRef,
  syncState,
  syncLabel,
  authenticated,
  activeMobileNav,
  setActiveMobileNav,
  onNavigate,
}: {
  children: ReactNode;
  mainRailRef: Ref<HTMLDivElement>;
  syncState: SyncState;
  syncLabel: string;
  authenticated: boolean;
  activeMobileNav: MobileNavItem;
  setActiveMobileNav: (item: MobileNavItem) => void;
  onNavigate: (item: MobileNavItem) => void;
}) {
  return (
    <main className="researchApp">
      <AppSidebar
        syncState={syncState}
        syncLabel={syncLabel}
        activeNav={activeMobileNav}
        authenticated={authenticated}
        onNavigate={onNavigate}
      />
      <div ref={mainRailRef} className="mainRail">{children}</div>
      <MobileBottomNav active={activeMobileNav} setActive={setActiveMobileNav} authenticated={authenticated} />
    </main>
  );
}

export default function Home() {
  const [useMcp, setUseMcp] = useState(true);
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  const [selectedModel, setSelectedModel] = useState<ChatModel>(DEFAULT_CHAT_MODEL);
  const [selectedCollection, setSelectedCollection] = useState<CollectionFilter>("");
  const [selectedExperience, setSelectedExperience] = useState<ChatExperience>("answer");
  const [draft, setDraft] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [statusText, setStatusText] = useState("");
  const [isSharedView, setIsSharedView] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<OpenDropdown>(null);
  const [activeFeedFilter, setActiveFeedFilter] = useState<FeedFilter>("thai");
  // Explore is the stable public shell while the signed guest/account session
  // hydrates. Requested deep links are applied immediately after hydration;
  // starting on Settings or Path creates a misleading sign-in/product flash.
  const [activeMobileNav, setActiveMobileNav] = useState<MobileNavItem>("explore");
  const [pendingFeature, setPendingFeature] = useState<MobileNavItem | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [currentSessionTitle, setCurrentSessionTitle] = useState("Untitled chat");
  const [pathGoal, setPathGoal] = useState("");
  const [pathLevel, setPathLevel] = useState<PathLevel>(RESEARCH_PATH_DEMO_LEVEL);
  const [pathOutcome, setPathOutcome] = useState<PathOutcome>(RESEARCH_PATH_DEMO_OUTCOME);
  const [researchPath, setResearchPath] = useState<ResearchPath | null>(null);
  const [researchPathStatus, setResearchPathStatus] = useState<SessionsStatus>("idle");
  const [researchPathError, setResearchPathError] = useState("");
  const [completedPathStages, setCompletedPathStages] = useState<string[]>([]);
  const [pathStageMastery, setPathStageMastery] = useState<Record<string, ResearchPathCheckpointStatus>>({});
  const [pathCheckpointAnswers, setPathCheckpointAnswers] = useState<Record<string, string>>({});
  const [pathCheckpointAssessments, setPathCheckpointAssessments] = useState<Record<string, ResearchPathCheckpointAssessment>>({});
  const [pathAssessingStageId, setPathAssessingStageId] = useState("");
  const [researchPathReady, setResearchPathReady] = useState(false);
  const [userProfile, setUserProfile] = useState<ChatUserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [chatSessionsStatus, setChatSessionsStatus] = useState<SessionsStatus>("idle");
  const [chatSessionsError, setChatSessionsError] = useState("");
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [loginName, setLoginName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPasswordConfirm, setLoginPasswordConfirm] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [billing, setBilling] = useState<BillingState>(GUEST_BILLING_STATE);
  const [billingBusy, setBillingBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [bookmarkedCards, setBookmarkedCards] = useState<Record<string, ResearchCardData>>({});
  const [workspaceItems, setWorkspaceItems] = useState<Record<string, PaperWorkspaceItem>>({});
  const [workspaceSelection, setWorkspaceSelection] = useState<string[]>([]);
  const [workspaceSeedSources, setWorkspaceSeedSources] = useState<string[]>([]);
  const [bookmarksReady, setBookmarksReady] = useState(false);
  const [paperTranslations, setPaperTranslations] = useState<Record<string, PaperTranslationState>>({});
  const [translationCacheReady, setTranslationCacheReady] = useState(false);
  const [paperLanguage, setPaperLanguage] = useState<PaperLanguage>("th");
  const [paperLanguageReady, setPaperLanguageReady] = useState(false);
  const [, setActivationSteps] = useState<ActivationStep[]>([]);
  const [translationRefreshNonce, setTranslationRefreshNonce] = useState(0);
  const [feedCards, setFeedCards] = useState<ResearchCardData[]>([]);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("loading");
  const [feedError, setFeedError] = useState("");
  const [feedQuery, setFeedQuery] = useState("");
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedCitableTotal, setFeedCitableTotal] = useState(0);
  const [feedMetadataOnlyTotal, setFeedMetadataOnlyTotal] = useState(0);
  const [feedTotalSections, setFeedTotalSections] = useState(0);
  const [feedTotalChunks, setFeedTotalChunks] = useState(0);
  const [feedFilterCounts, setFeedFilterCounts] = useState<Partial<Record<FeedFilter, number>>>({});
  const [feedCoverage, setFeedCoverage] = useState<ResearchCoverageProvider[]>([]);
  const feedThaiNativeFullPaperTotal = feedCoverage.reduce(
    (sum, provider) => sum + (provider.provider === "pmc_oa" ? 0 : provider.nativeFullPaper),
    0,
  );
  const feedThaiPublishedDiscoveryTotal = feedCoverage.reduce(
    (sum, provider) => sum + (provider.provider === "pmc_oa" || (provider.state !== "connected" && provider.state !== "import_validated") ? 0 : provider.records),
    0,
  );
  const feedThaiPublishedPageCitableTotal = feedCoverage.reduce(
    (sum, provider) => sum + (provider.provider === "pmc_oa" ? 0 : provider.pageCitable),
    0,
  );
  const feedGlobalComparisonTotal = feedCoverage.find((provider) => provider.provider === "pmc_oa")?.records ?? 0;
  const [feedVisibility, setFeedVisibility] = useState<VisibilitySummary | null>(null);
  const [activeFeedProvider, setActiveFeedProvider] = useState("");
  const [feedGeneratedAt, setFeedGeneratedAt] = useState("");
  const [feedNextCursor, setFeedNextCursor] = useState<string | null>(null);
  const [isFeedLoadingMore, setIsFeedLoadingMore] = useState(false);
  const [feedRefreshNonce, setFeedRefreshNonce] = useState(0);
  const [activeResearchCase, setActiveResearchCase] = useState<ActiveResearchCase | null>(null);
  const [researchCaseStatus, setResearchCaseStatus] = useState<"idle" | "loading" | "saving" | "ready" | "error">("idle");
  const [researchCaseError, setResearchCaseError] = useState("");
  const [completedResearchCaseCount, setCompletedResearchCaseCount] = useState(0);
  const [globalDiscovery, setGlobalDiscovery] = useState<GlobalDiscoveryState>({
    phase: "idle",
    query: "",
    response: null,
    error: "",
  });
  const [researchPassport, setResearchPassport] = useState<ResearchPassportState>({
    phase: "idle",
    artifact: null,
    error: "",
  });
  const [livingReviewWatches, setLivingReviewWatches] = useState<LivingReviewWatch[]>([]);
  const [livingReviewBusyId, setLivingReviewBusyId] = useState("");
  const [paperDetail, setPaperDetail] = useState<PaperDetailData | null>(null);
  const [paperDetailStatus, setPaperDetailStatus] = useState<FeedStatus>("ready");
  const [paperDetailError, setPaperDetailError] = useState("");
  const [paperEvidenceTarget, setPaperEvidenceTarget] = useState<CivilEvidenceItem | null>(null);
  const [citationMap, setCitationMap] = useState<CitationMapState>({ phase: "idle", response: null, error: "" });
  const mainRailRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const detailRequestIdRef = useRef(0);
  const chatSessionRequestIdRef = useRef(0);
  const pathBuildRequestIdRef = useRef(0);
  const pathCheckpointRequestIdRef = useRef(0);
  const navigationTouchedRef = useRef(false);
  const feedKeyRef = useRef("");
  const globalDiscoveryRequestIdRef = useRef(0);
  const researchPassportRequestIdRef = useRef(0);
  const webMcpDiscoveryRequestIdRef = useRef(0);
  const webMcpEvidenceRequestIdRef = useRef(0);
  const citationMapRequestIdRef = useRef(0);
  const researchContextRevisionRef = useRef(0);
  const feedResearchContextKeyRef = useRef("");
  const researchPassportRef = useRef(researchPassport);
  const webMcpActivityRef = useRef<WebMcpActivity[]>([]);
  const webMcpEvidenceContextRef = useRef<PaperDetailData | null>(null);
  const citationMapRef = useRef(citationMap);
  const citationMapSourceRef = useRef("");
  const paperLanguageRef = useRef<PaperLanguage>("th");
  const paperTranslationsRef = useRef<Record<string, PaperTranslationState>>({});
  const translationInFlightRef = useRef(new Set<string>());
  const announcePaperLanguageRef = useRef(false);
  const initialEvidenceLinkOpenedRef = useRef(false);
  const pendingHumanAnswerRef = useRef(false);
  const activationReportedRef = useRef(false);
  const webMcpHandlersRef = useRef<SeedResearchWebMcpHandlers | null>(null);

  const setAppView = useCallback((item: MobileNavItem) => {
    setActiveMobileNav(item);
    setOpenDropdown(null);
    window.requestAnimationFrame(() => mainRailRef.current?.scrollTo({ top: 0, behavior: "auto" }));
  }, []);

  const recordWebMcpActivity = useCallback((tool: string, detail: string) => {
    const entry = { tool, detail: boundedToolText(detail, 180), completedAt: new Date().toISOString() };
    webMcpActivityRef.current = [...webMcpActivityRef.current, entry].slice(-8);
    return entry;
  }, []);

  const invalidateResearchContext = useCallback(() => {
    researchContextRevisionRef.current += 1;
    researchPassportRequestIdRef.current += 1;
    citationMapRequestIdRef.current += 1;
    const emptyCitationMap: CitationMapState = { phase: "idle", response: null, error: "" };
    citationMapRef.current = emptyCitationMap;
    citationMapSourceRef.current = "";
    setCitationMap(emptyCitationMap);
    setResearchPassport((current) => {
      if (current.artifact) {
        const next = { ...current, artifact: { ...current.artifact, stale: true } };
        researchPassportRef.current = next;
        return next;
      }
      if (current.phase === "loading") {
        const next: ResearchPassportState = { phase: "error", artifact: null, error: "Research context changed while the Passport was being drafted. Redraft from the current evidence." };
        researchPassportRef.current = next;
        return next;
      }
      return current;
    });
  }, []);

  useEffect(() => {
    researchPassportRef.current = researchPassport;
  }, [researchPassport]);

  useEffect(() => {
    citationMapRef.current = citationMap;
  }, [citationMap]);

  useEffect(() => {
    const contextKey = `${feedQuery}\u0000${selectedCollection || "all"}\u0000${activeFeedFilter}\u0000${activeFeedProvider || "all-providers"}`;
    if (!feedResearchContextKeyRef.current) {
      feedResearchContextKeyRef.current = contextKey;
      return;
    }
    if (feedResearchContextKeyRef.current === contextKey) return;
    feedResearchContextKeyRef.current = contextKey;
    invalidateResearchContext();
  }, [activeFeedFilter, activeFeedProvider, feedQuery, invalidateResearchContext, selectedCollection]);

  const mode: Mode = useMcp ? "mcp" : "baseline";
  const { messages, append, isLoading, setMessages, error: chatError } = useChat({
    api: "/api/chat",
    id: "civilmcp-session",
    // React 19 can hit its nested-update guard when every data-stream part
    // synchronously invalidates SWR. Batch paint updates without delaying the
    // network stream or changing the final message.
    experimental_throttle: 50,
  });

  const recordActivationStep = useCallback((step: ActivationStep) => {
    setActivationSteps((current) => {
      if (current.includes(step)) return current;
      const next = [...current, step];
      try {
        const stored = JSON.parse(window.localStorage.getItem(ACTIVATION_KEY) ?? "{}") as Record<string, unknown>;
        window.localStorage.setItem(ACTIVATION_KEY, JSON.stringify({ ...stored, steps: next, lastVisit: Date.now() }));
      } catch {}
      if (next.length === 3 && !activationReportedRef.current) {
        activationReportedRef.current = true;
        trackProductEvent("onboarding_completed", { journey: "search_verify_outcome" });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(ACTIVATION_KEY) ?? "{}") as {
        steps?: unknown;
        lastVisit?: unknown;
      };
      const steps = Array.isArray(stored.steps)
        ? stored.steps.filter((step): step is ActivationStep => step === "search" || step === "verify" || step === "outcome")
        : [];
      setActivationSteps(steps);
      activationReportedRef.current = steps.length === 3;
      if (typeof stored.lastVisit === "number" && Date.now() - stored.lastVisit > 6 * 60 * 60 * 1_000) {
        trackProductEvent("user_returned", { hoursAway: Math.floor((Date.now() - stored.lastVisit) / 3_600_000) });
      }
      window.localStorage.setItem(ACTIVATION_KEY, JSON.stringify({ ...stored, steps, lastVisit: Date.now() }));
    } catch {}
  }, []);

  useEffect(() => {
    if (isLoading || !pendingHumanAnswerRef.current) return;
    const answer = [...messages].reverse().find((message) => message.role === "assistant");
    if (!answer) return;
    pendingHumanAnswerRef.current = false;
    trackProductEvent("first_answer", { experience: selectedExperience, model: selectedModel });
  }, [isLoading, messages, selectedExperience, selectedModel]);
  const latestMissionAnnotation = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const annotation = getCivilMissionAnnotation(messages[index]);
      if (annotation) return annotation;
    }
    return null;
  }, [messages]);

  const refreshBilling = useCallback(async () => {
    try {
      setBilling(await fetchJson<BillingState>("/api/billing"));
    } catch {
      // Billing configuration never blocks the free Research Preview.
    }
  }, []);

  const refreshLivingReviews = useCallback(async () => {
    try {
      const payload = await fetchJson<{ watches: LivingReviewWatch[] }>("/api/living-reviews");
      setLivingReviewWatches(payload.watches ?? []);
    } catch {
      // Discovery remains available when saved watches are temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) void refreshLivingReviews();
    else setLivingReviewWatches([]);
  }, [isAuthenticated, refreshLivingReviews]);

  const buildFeedParams = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams({
        filter: activeFeedFilter,
        collection: selectedCollection || "all",
        limit: "12",
      });
      if (feedQuery) params.set("q", feedQuery);
      if (activeFeedProvider) params.set("provider", activeFeedProvider);
      if (cursor) params.set("cursor", cursor);
      return params;
    },
    [activeFeedFilter, activeFeedProvider, feedQuery, selectedCollection],
  );

  useEffect(() => {
    feedKeyRef.current = `${activeFeedFilter}|${activeFeedProvider}|${feedQuery}|${selectedCollection}`;
  }, [activeFeedFilter, activeFeedProvider, feedQuery, selectedCollection]);

  useEffect(() => {
    globalDiscoveryRequestIdRef.current += 1;
    setGlobalDiscovery({ phase: "idle", query: feedQuery, response: null, error: "" });
  }, [feedQuery]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem("civilmcp-bookmarks") ?? "{}") as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        setBookmarkedCards(Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ResearchCardData] => isResearchCardData(entry[1]))));
      }
    } catch {
      setBookmarkedCards({});
    } finally {
      setBookmarksReady(true);
    }
  }, []);

  useEffect(() => {
    if (!bookmarksReady) return;
    try {
      window.localStorage.setItem("civilmcp-bookmarks", JSON.stringify(bookmarkedCards));
    } catch {
      setStatusText("Saved papers could not be updated in this browser.");
    }
  }, [bookmarkedCards, bookmarksReady]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !bookmarksReady) return;
    let cancelled = false;
    void fetchJson<{ items: PaperWorkspaceItem[]; cards: ResearchCardData[] }>("/api/paper-workspace")
      .then((payload) => {
        if (cancelled) return;
        setWorkspaceItems(Object.fromEntries((payload.items ?? []).map((item) => [item.source, item])));
        setBookmarkedCards((current) => ({
          ...current,
          ...Object.fromEntries((payload.cards ?? []).map((card) => [cardKey(card), card])),
        }));
      })
      .catch(() => {
        // Browser bookmarks remain available if account sync is temporarily unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [bookmarksReady, isAuthenticated, isReady]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !userProfile?.userId) return;
    setResearchPathReady(false);
    try {
      const parsed = JSON.parse(window.localStorage.getItem(researchPathStorageKey(userProfile.userId)) ?? "null") as {
        path?: unknown;
        completedStages?: unknown;
        stageMastery?: unknown;
        checkpointAnswers?: unknown;
        checkpointAssessments?: unknown;
      } | null;
      if (isResearchPath(parsed?.path)) {
        setResearchPath(parsed.path);
        setPathGoal(parsed.path.goal);
        setPathLevel(parsed.path.level);
        setPathOutcome(parsed.path.outcome);
        setCompletedPathStages(Array.isArray(parsed?.completedStages) ? parsed.completedStages.filter((value): value is string => typeof value === "string") : []);
        const storedMastery = parsed?.stageMastery && typeof parsed.stageMastery === "object" ? parsed.stageMastery as Record<string, unknown> : {};
        setPathStageMastery(Object.fromEntries(Object.entries(storedMastery).filter((entry): entry is [string, ResearchPathCheckpointStatus] => entry[1] === "needs_review" || entry[1] === "partial" || entry[1] === "understood")));
        const storedAnswers = parsed?.checkpointAnswers && typeof parsed.checkpointAnswers === "object" ? parsed.checkpointAnswers as Record<string, unknown> : {};
        setPathCheckpointAnswers(Object.fromEntries(Object.entries(storedAnswers).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
        const storedAssessments = parsed?.checkpointAssessments && typeof parsed.checkpointAssessments === "object" ? parsed.checkpointAssessments as Record<string, unknown> : {};
        setPathCheckpointAssessments(Object.fromEntries(Object.entries(storedAssessments).filter((entry): entry is [string, ResearchPathCheckpointAssessment] => isResearchPathCheckpointAssessment(entry[1]))));
        setResearchPathStatus("ready");
      }
    } catch {
      setResearchPath(null);
      setCompletedPathStages([]);
      setPathStageMastery({});
      setPathCheckpointAnswers({});
      setPathCheckpointAssessments({});
    } finally {
      setResearchPathReady(true);
    }
  }, [isAuthenticated, isReady, userProfile?.userId]);

  useEffect(() => {
    if (!researchPathReady || !isAuthenticated || !userProfile?.userId) return;
    try {
      if (researchPath) {
        window.localStorage.setItem(researchPathStorageKey(userProfile.userId), JSON.stringify({
          path: researchPath,
          completedStages: completedPathStages,
          stageMastery: pathStageMastery,
          checkpointAnswers: pathCheckpointAnswers,
          checkpointAssessments: pathCheckpointAssessments,
        }));
      } else {
        window.localStorage.removeItem(researchPathStorageKey(userProfile.userId));
      }
    } catch {
      setResearchPathError("This browser could not save your path locally.");
    }
  }, [completedPathStages, isAuthenticated, pathCheckpointAnswers, pathCheckpointAssessments, pathStageMastery, researchPath, researchPathReady, userProfile?.userId]);

  useEffect(() => {
    let nextLanguage: PaperLanguage = "th";
    try {
      const storedLanguage = window.localStorage.getItem(PAPER_LANGUAGE_KEY);
      if (storedLanguage === "th" || storedLanguage === "en") {
        nextLanguage = storedLanguage;
      }
    } catch {
      nextLanguage = "th";
    }
    paperLanguageRef.current = nextLanguage;
    setPaperLanguage(nextLanguage);
    setPaperLanguageReady(true);
  }, []);

  useEffect(() => {
    if (!paperLanguageReady) return;
    paperLanguageRef.current = paperLanguage;
    document.documentElement.dataset.paperLanguage = paperLanguage;
    try {
      window.localStorage.setItem(PAPER_LANGUAGE_KEY, paperLanguage);
    } catch {
      // The selected language still applies to the current page view.
    }
  }, [paperLanguage, paperLanguageReady]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(TRANSLATION_CACHE_KEY) ?? "{}") as Record<string, unknown>;
      const now = Date.now();
      const cached = Object.fromEntries(
        Object.entries(parsed)
          .map(([key, value]) => [key, translationCacheEntry(value)] as const)
          .filter(
            (entry): entry is [string, Pick<PaperTranslationState, "segments" | "updatedAt">] =>
              Boolean(entry[1]?.updatedAt && now - entry[1].updatedAt < TRANSLATION_CACHE_TTL_MS),
          )
          .map(([key, value]) => [
            key,
            {
              status: "ready" as const,
              showingTranslation: paperLanguageRef.current === "en",
              segments: value.segments,
              updatedAt: value.updatedAt,
            },
          ]),
      );
      setPaperTranslations(cached);
    } catch {
      setPaperTranslations({});
    } finally {
      setTranslationCacheReady(true);
    }
  }, []);

  useEffect(() => {
    paperTranslationsRef.current = paperTranslations;
  }, [paperTranslations]);

  useEffect(() => {
    if (!translationCacheReady) return;
    try {
      const cache = Object.fromEntries(
        Object.entries(paperTranslations)
          .filter(([, translation]) => Object.keys(translation.segments).length > 0 && translation.updatedAt)
          .sort(([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
          .slice(0, TRANSLATION_CACHE_MAX_PAPERS)
          .map(([key, translation]) => [key, { segments: translation.segments, updatedAt: translation.updatedAt }]),
      );
      window.localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Translation still works for this page view when browser storage is unavailable.
    }
  }, [paperTranslations, translationCacheReady]);

  const closePaperDetail = useCallback(() => {
    detailRequestIdRef.current += 1;
    webMcpEvidenceContextRef.current = null;
    setPaperDetail(null);
    setPaperDetailStatus("ready");
    setPaperDetailError("");
    setPaperEvidenceTarget(null);
    const url = new URL(window.location.href);
    for (const key of ["paper", "evidence", "section", "chunk", "page"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const refreshChatSessions = useCallback(async (showLoading = false) => {
    if (showLoading) setChatSessionsStatus("loading");
    setChatSessionsError("");
    try {
      const payload = await fetchJson<ChatSessionsResponse>("/api/chat-sessions");
      setChatSessions(payload.sessions ?? []);
      if (payload.user) {
        setUserProfile(payload.user);
        setIsAuthenticated(Boolean(payload.authenticated));
        setLoginName(payload.authenticated ? payload.user.displayName : "");
        setLoginEmail(payload.user.email ?? "");
      }
      setChatSessionsStatus("ready");
    } catch (error) {
      setChatSessionsStatus("error");
      setChatSessionsError(error instanceof Error ? error.message : "Failed to load chat sessions.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        await fetchJson<{ sessionId: string }>("/api/session");
        const searchParams = new URLSearchParams(window.location.search);
        const shareId = searchParams.get("share")?.trim();
        const isRecovery = searchParams.get("auth") === "recovery";
        const requestedView = searchParams.get("view");
        const payload = shareId
          ? await fetchJson<SessionPayload>(`/api/history?share=${encodeURIComponent(shareId)}`)
          : await fetchJson<SessionPayload>("/api/history");

        if (cancelled) return;
        const normalized = normalizeSessionPayload(payload);
        setCurrentSessionId(normalized.sessionId);
        setCurrentSessionTitle(normalized.title);
        setUseMcp(normalized.mode === "mcp");
        setSelectedModel(normalized.model);
        setSelectedCollection(normalized.collection);
        setMessages(normalized.messages);
        setUserProfile(normalized.user);
        setIsAuthenticated(normalized.authenticated);
        setLoginName(normalized.authenticated ? normalized.user?.displayName ?? "" : "");
        setLoginEmail(normalized.user?.email ?? "");
        setIsSharedView(Boolean(shareId));
        setSyncState("saved");
        let returnFeature = DEFAULT_AUTHENTICATED_FEATURE;
        try {
          const storedFeature = window.sessionStorage.getItem(AUTH_RETURN_FEATURE_KEY);
          if (isMobileNavItem(storedFeature)) returnFeature = storedFeature;
          window.sessionStorage.removeItem(AUTH_RETURN_FEATURE_KEY);
        } catch {}
        const requestedFeature = isMobileNavItem(requestedView) ? requestedView : null;
        if (shareId || requestedFeature || !navigationTouchedRef.current) {
          setAppView(shareId ? "shared" : requestedFeature ?? returnFeature);
        }
        const billingResult = searchParams.get("billing");
        if (billingResult) {
          setAppView("settings");
          setStatusText(
            billingResult === "success"
              ? "Payment received. Founder Pro will appear as soon as Stripe confirms the subscription."
              : billingResult === "cancelled"
                ? "Checkout cancelled. Your current plan is unchanged."
                : "Billing settings updated.",
          );
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.delete("billing");
          window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
        }
        if (isRecovery) {
          setAppView("settings");
          setAuthMode(normalized.authenticated ? "recovery" : "forgot-password");
          setStatusText(
            normalized.authenticated
              ? "Choose a new password to finish recovering your account."
              : "This recovery link is invalid or has expired. Request a new link.",
          );
        }
        void refreshBilling();
        void refreshChatSessions();
      } catch (error) {
        if (!cancelled) {
          setSyncState("error");
          const publicFallback = MAIN_NAV_ITEMS.find(
            (item) => item.id !== "settings" && CIVILMCP_FEATURE_ACCESS[item.id].enabled && (CIVILMCP_OPEN_ACCESS || !CIVILMCP_FEATURE_ACCESS[item.id].requiresAuth),
          )?.id;
          if (publicFallback) {
            if (!navigationTouchedRef.current) setAppView(DEFAULT_AUTHENTICATED_FEATURE);
            setStatusText("Account sync is temporarily unavailable. Public research tools remain available.");
          } else {
            setAppView("settings");
            setStatusText(error instanceof Error && /sign in/i.test(error.message)
              ? "Sign in to use Research Path, chat, workspace, and history."
              : "Sign in is required. Account services are temporarily unavailable.");
          }
        }
      } finally {
        if (!cancelled) {
          setIsReady(true);
        }
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [refreshBilling, refreshChatSessions, setAppView, setMessages]);

  useEffect(() => {
    if (!isReady || isSharedView) return;
    let cancelled = false;
    setResearchCaseStatus("loading");
    void fetchJson<{ cases?: unknown[]; summary?: { completed?: number } }>("/api/research-cases")
      .then((payload) => {
        if (cancelled) return;
        const latest = normalizeActiveResearchCase(payload.cases?.[0]);
        setActiveResearchCase(latest);
        setResearchCaseStatus(latest ? "ready" : "idle");
        setResearchCaseError("");
        setCompletedResearchCaseCount(Math.max(0, Number(payload.summary?.completed ?? 0)));
      })
      .catch(() => {
        if (cancelled) return;
        // Research discovery remains usable during a rolling migration or a
        // temporary case-store outage; writes report their own explicit error.
        setResearchCaseStatus("idle");
      });
    return () => { cancelled = true; };
  }, [isReady, isSharedView]);

  useEffect(() => {
    if (!isReady || !currentSessionId || isSharedView) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveControllerRef.current?.abort();
    const controller = new AbortController();
    saveControllerRef.current = controller;

    const nextTitle = sessionTitleFromMessages(messages, currentSessionTitle);
    setCurrentSessionTitle(nextTitle);
    setSyncState("saving");
    saveTimerRef.current = setTimeout(() => {
      void fetchJson<{ ok: boolean }>("/api/history", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: currentSessionId,
          title: nextTitle,
          mode,
          model: selectedModel,
          collection: selectedCollection,
          messages,
        }),
      })
        .then(() => {
          if (controller.signal.aborted) return;
          setSyncState("saved");
          void refreshChatSessions();
        })
        .catch(() => {
          if (!controller.signal.aborted) setSyncState("error");
        });
    }, 450);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      controller.abort();
    };
  }, [currentSessionId, currentSessionTitle, isReady, isSharedView, messages, mode, refreshChatSessions, selectedCollection, selectedModel]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-dropdown-root]")) {
        setOpenDropdown(null);
      }
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenDropdown(null);
        closePaperDetail();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePaperDetail]);

  useEffect(() => {
    if (activeMobileNav !== "explore") return;
    const timer = setTimeout(() => {
      setFeedQuery(draft.trim());
    }, 100);
    return () => clearTimeout(timer);
  }, [activeMobileNav, draft]);

  useEffect(() => {
    if (activeMobileNav !== "explore" && activeMobileNav !== "workspace") return;
    if (activeFeedFilter === "saved") {
      setFeedStatus("ready");
      setFeedError("");
      setFeedNextCursor(null);
      setFeedGeneratedAt("");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    async function loadFeed() {
      setFeedStatus("loading");
      setFeedError("");
      try {
        const params = buildFeedParams();
        const payload = await fetchJson<ResearchFeedResponse>(`/api/research-feed?${params.toString()}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        setFeedCards(payload.cards ?? []);
        setFeedTotal(payload.facets?.total ?? 0);
        setFeedCitableTotal(payload.facets?.citableTotal ?? payload.facets?.total ?? 0);
        setFeedMetadataOnlyTotal(payload.facets?.metadataOnlyTotal ?? 0);
        setFeedTotalSections(payload.facets?.totalSections ?? 0);
        setFeedTotalChunks(payload.facets?.totalChunks ?? 0);
        setFeedFilterCounts(payload.facets?.filters ?? {});
        setFeedCoverage(payload.facets?.coverage ?? []);
        setFeedVisibility(payload.facets?.visibility ?? null);
        setFeedGeneratedAt(payload.generatedAt ?? "");
        setFeedNextCursor(payload.nextCursor ?? null);
        setFeedStatus("ready");
        if (feedQuery) {
          trackProductEvent("explore_search", {
            queryLength: feedQuery.length,
            resultCount: payload.cards?.length ?? 0,
            filter: activeFeedFilter,
            collection: selectedCollection || "all",
          });
          recordActivationStep("search");
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setFeedCards([]);
        setFeedTotal(0);
        setFeedCitableTotal(0);
        setFeedMetadataOnlyTotal(0);
        setFeedTotalSections(0);
        setFeedTotalChunks(0);
        setFeedFilterCounts({});
        setFeedCoverage([]);
        setFeedVisibility(null);
        setFeedNextCursor(null);
        setFeedStatus("error");
        setFeedError("The indexed paper collection could not be loaded. Please try again.");
      }
    }

    void loadFeed();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeFeedFilter, activeMobileNav, buildFeedParams, feedRefreshNonce, recordActivationStep]);

  useEffect(() => {
    setShareUrl("");
    setPendingDeleteSessionId(null);
  }, [currentSessionId]);

  const syncLabel = useMemo(() => {
    if (syncState === "loading") return "Preparing session";
    if (syncState === "saving") return "Syncing";
    if (syncState === "error") return "Sync error";
    if (isSharedView) return "Shared session";
    return isAuthenticated ? "Account synced" : "Saved locally";
  }, [isAuthenticated, isSharedView, syncState]);

  const modelOptions = useMemo<Array<MenuOption<ChatModel>>>(
    () =>
      CHAT_MODELS.map((option) => ({
        value: option.id,
        label: option.label,
        badge: option.id.startsWith("gpt-") ? "OPENAI" : "OPTIONAL",
        description:
          option.id === DEFAULT_CHAT_MODEL
            ? "Default · efficient, grounded research answers"
            : option.id === "gpt-5.6-terra"
              ? "Balanced reasoning for deeper research"
              : option.id === "gpt-5.6-sol"
                ? "Flagship reasoning for the hardest synthesis"
                : option.id.startsWith("gpt-")
                  ? "OpenAI model · available to every learner"
                  : "Optional fallback model · no plan gate",
      })),
    [],
  );

  const selectModel = (model: ChatModel) => {
    setSelectedModel(model);
  };

  const visibleCards = useMemo(() => {
    if (activeFeedFilter === "for_you") {
      const saved = Object.values(bookmarkedCards);
      const disciplines = new Set(saved.map((card) => card.discipline).filter(Boolean));
      const tags = new Set(saved.flatMap((card) => card.tags.map((tag) => tag.toLocaleLowerCase("en"))));
      return [...feedCards].sort((left, right) => {
        const score = (card: ResearchCardData) =>
          (card.discipline && disciplines.has(card.discipline) ? 8 : 0)
          + card.tags.filter((tag) => tags.has(tag.toLocaleLowerCase("en"))).length * 2
          + Math.min(card.evidenceCount, 100) / 100;
        return score(right) - score(left);
      });
    }
    if (activeFeedFilter !== "saved") return feedCards;
    const query = feedQuery.toLowerCase();
    return Object.values(bookmarkedCards).filter((card) => {
      if (selectedCollection && card.collection !== selectedCollection) return false;
      if (!query) return true;
      return [card.title, card.summary, card.source, card.sourcePdf, card.paperCode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [activeFeedFilter, bookmarkedCards, feedCards, feedQuery, selectedCollection]);

  const workspacePaperCards = useMemo(() => {
    const cards = [...Object.values(bookmarkedCards), ...feedCards];
    const seen = new Set<string>();
    return cards.filter((card) => {
      if (!card.source || seen.has(card.source) || card.citable === false) return false;
      seen.add(card.source);
      return true;
    });
  }, [bookmarkedCards, feedCards]);
  const workspacePapers = useMemo(
    () => workspacePaperCards.map((card): ResearchWorkspacePaper => ({
      id: card.id,
      source: card.source,
      title: card.title,
      paperCode: card.paperCode,
      collection: card.collection,
      discipline: card.discipline,
      pageLabel: card.pageLabel,
      evidenceCount: card.evidenceCount,
    })),
    [workspacePaperCards],
  );

  const isPaperTranslationBusy = Object.values(paperTranslations).some((translation) => translation.status === "loading");

  const ensureWritableSession = async () => {
    if (!isSharedView) return currentSessionId;

    const payload = await fetchJson<{
      session: SessionPayload;
      sessions: ChatSessionSummary[];
      user?: ChatUserProfile | null;
      authenticated?: boolean;
    }>("/api/chat-sessions", {
      method: "POST",
      body: JSON.stringify({ action: "create" }),
    });
    const normalized = normalizeSessionPayload(payload.session ?? {});
    const nextTitle = sessionTitleFromMessages(messages, currentSessionTitle);

    await fetchJson<{ ok: boolean; sessionId: string }>("/api/history", {
      method: "POST",
      body: JSON.stringify({
        sessionId: normalized.sessionId,
        title: nextTitle,
        mode,
        model: selectedModel,
        collection: selectedCollection,
        messages,
      }),
    });

    setCurrentSessionId(normalized.sessionId);
    setCurrentSessionTitle(nextTitle);
    setChatSessions(payload.sessions ?? []);
    if (payload.user) setUserProfile(payload.user);
    setIsAuthenticated(Boolean(payload.authenticated));
    setIsSharedView(false);
    setShareUrl("");
    setSyncState("saved");
    void refreshChatSessions();
    setStatusText("Shared session copied to your workspace.");
    return normalized.sessionId;
  };

  const submitPrompt = async (
    text: string,
    paperAnchor?: PaperAnchor,
    modeOverride?: Mode,
    experienceOverride?: ChatExperience,
  ) => {
    const trimmed = text.trim();
    if (!trimmed || !isReady || isLoading) return;
    const previousMobileNav = activeMobileNav;
    setDraft("");
    setOpenDropdown(null);
    setAppView("chat");
    try {
      const writableSessionId = await ensureWritableSession();
      const requestMode = modeOverride ?? mode;
      pendingHumanAnswerRef.current = true;
      await append(
        { role: "user", content: trimmed },
        {
          body: {
            mode: requestMode,
            experience: requestMode === "mcp" ? experienceOverride ?? selectedExperience : "answer",
            model: selectedModel,
            collection: selectedCollection,
            sessionId: writableSessionId,
            paperAnchor,
          },
        },
      );
      void refreshBilling();
    } catch (error) {
      pendingHumanAnswerRef.current = false;
      setDraft(trimmed);
      const message = error instanceof Error ? error.message : "Could not send your question.";
      if (/Founder Pro|credits/i.test(message)) setAppView("settings");
      else setAppView(previousMobileNav);
      setStatusText(`${message} Your draft was restored.`);
    }
  };

  const askPaper = (card: ResearchCardData) => {
    const anchor: PaperAnchor = {
      source: card.source,
      collection: card.collection,
      paperCode: card.paperCode,
    };
    setUseMcp(true);
    void submitPrompt(card.prompt, anchor, "mcp");
  };

  const toggleBookmark = (card: ResearchCardData) => {
    const key = cardKey(card);
    const saved = Boolean(bookmarkedCards[key]);
    setBookmarkedCards((current) => {
      const next = { ...current };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = card;
      }
      return next;
    });
    setStatusText(saved ? "Removed from library" : "Saved to your research library");
    if (!saved) {
      trackProductEvent("paper_save", { source: card.source, collection: card.collection });
      recordActivationStep("outcome");
    }
    if (saved) {
      setWorkspaceSelection((current) => current.filter((source) => source !== card.source));
      setWorkspaceItems((current) => {
        const next = { ...current };
        delete next[card.source];
        return next;
      });
      void fetchJson<{ ok: boolean }>(`/api/paper-workspace?source=${encodeURIComponent(card.source)}`, { method: "DELETE" })
        .catch(() => setStatusText("Removed in this browser. Library sync will retry on your next save."));
      return;
    }
    const existing = workspaceItems[card.source];
    void fetchJson<{ item: PaperWorkspaceItem }>("/api/paper-workspace", {
      method: "POST",
      body: JSON.stringify({
        documentId: card.id,
        source: card.source,
        collection: card.collection,
        paperCode: card.paperCode,
        note: existing?.note ?? "",
        labels: existing?.labels ?? [],
      }),
    })
      .then((payload) => setWorkspaceItems((current) => ({ ...current, [card.source]: payload.item })))
      .catch(() => setStatusText("Saved in this browser. Account sync is temporarily unavailable."));
  };

  const toggleWorkspaceSelection = (card: ResearchCardData) => {
    setWorkspaceSelection((current) => {
      if (current.includes(card.source)) return current.filter((source) => source !== card.source);
      if (current.length >= 50) {
        setStatusText("A Verified Review Project supports up to 50 papers.");
        return current;
      }
      return [...current, card.source];
    });
  };

  const compareSelectedPapers = () => {
    if (workspaceSelection.length < 2) {
      setStatusText("Select at least 2 saved papers to compare.");
      return;
    }
    setWorkspaceSeedSources(workspaceSelection);
    setAppView("workspace");
    setStatusText(`${workspaceSelection.length} saved papers are ready to compare.`);
  };

  const saveLibraryDetails = async (card: ResearchCardData, note: string, labels: string[]) => {
    const payload = await fetchJson<{ item: PaperWorkspaceItem }>("/api/paper-workspace", {
      method: "POST",
      body: JSON.stringify({
        documentId: card.id,
        source: card.source,
        collection: card.collection,
        paperCode: card.paperCode,
        note,
        labels,
      }),
    });
    setWorkspaceItems((current) => ({ ...current, [card.source]: payload.item }));
    setBookmarkedCards((current) => ({ ...current, [cardKey(card)]: card }));
    setStatusText("Library note synced");
  };

  const translatePapersToEnglish = useCallback(
    async (
      papers: Array<{ card: ResearchCardData; detail?: PaperDetailData | null }>,
      announce = false,
    ) => {
      const uniquePapers = new Map<string, { card: ResearchCardData; detail?: PaperDetailData | null }>();
      for (const paper of papers) {
        const key = cardKey(paper.card);
        const existing = uniquePapers.get(key);
        if (!existing || (!existing.detail && paper.detail)) uniquePapers.set(key, paper);
      }

      type QueuedSegment = {
        requestId: string;
        key: string;
        segmentId: string;
        text: string;
      };

      const queuedSegments: QueuedSegment[] = [];
      const readyKeys: string[] = [];
      const pendingKeys: string[] = [];
      let requestIndex = 0;

      for (const [key, paper] of uniquePapers) {
        if (translationInFlightRef.current.has(key)) continue;
        const current = paperTranslationsRef.current[key];
        const segments = paperTranslationSegments(paper.card, paper.detail);
        const missingSegments = segments.filter((segment) => !current?.segments[segment.id]);
        if (!missingSegments.length) {
          if (segments.length) readyKeys.push(key);
          continue;
        }

        translationInFlightRef.current.add(key);
        pendingKeys.push(key);
        for (const segment of missingSegments) {
          queuedSegments.push({
            requestId: `segment-${requestIndex}`,
            key,
            segmentId: segment.id,
            text: segment.text,
          });
          requestIndex += 1;
        }
      }

      if (readyKeys.length || pendingKeys.length) {
        setPaperTranslations((translations) => {
          const next = { ...translations };
          for (const key of readyKeys) {
            const current = next[key];
            next[key] = {
              status: "ready",
              showingTranslation: paperLanguageRef.current === "en" && Boolean(Object.keys(current?.segments ?? {}).length),
              segments: current?.segments ?? {},
              updatedAt: current?.updatedAt,
            };
          }
          for (const key of pendingKeys) {
            const current = next[key];
            next[key] = {
              status: "loading",
              showingTranslation: paperLanguageRef.current === "en" && Boolean(Object.keys(current?.segments ?? {}).length),
              segments: current?.segments ?? {},
              updatedAt: current?.updatedAt,
            };
          }
          paperTranslationsRef.current = next;
          return next;
        });
      }

      if (!queuedSegments.length) {
        if (announce) setStatusText("English paper translations are ready from this browser's cache.");
        return;
      }

      const batches: QueuedSegment[][] = [];
      let batch: QueuedSegment[] = [];
      let batchChars = 0;
      for (const segment of queuedSegments) {
        if (
          batch.length &&
          (batch.length >= TRANSLATION_BATCH_MAX_SEGMENTS || batchChars + segment.text.length > TRANSLATION_BATCH_MAX_CHARS)
        ) {
          batches.push(batch);
          batch = [];
          batchChars = 0;
        }
        batch.push(segment);
        batchChars += segment.text.length;
      }
      if (batch.length) batches.push(batch);

      const translatedByPaper = new Map<string, Record<string, string>>();
      let translatedAt = Date.now();

      try {
        for (const translationBatch of batches) {
          const payload = await fetchJson<PaperTranslationResponse>("/api/paper-translation", {
            method: "POST",
            body: JSON.stringify({
              targetLanguage: "en",
              segments: translationBatch.map((segment) => ({ id: segment.requestId, text: segment.text })),
            }),
          });
          const responseById = new Map(payload.translations.map((segment) => [segment.id, segment.text]));
          if (responseById.size !== translationBatch.length) throw new Error("Translation response was incomplete.");

          for (const segment of translationBatch) {
            const translatedText = responseById.get(segment.requestId)?.trim();
            if (!translatedText) throw new Error("Translation response was incomplete.");
            const paperSegments = translatedByPaper.get(segment.key) ?? {};
            paperSegments[segment.segmentId] = translatedText;
            translatedByPaper.set(segment.key, paperSegments);
          }
          translatedAt = Date.parse(payload.translatedAt) || translatedAt;
        }

        setPaperTranslations((translations) => {
          const next = { ...translations };
          for (const key of pendingKeys) {
            const current = next[key];
            const segments = { ...current?.segments, ...translatedByPaper.get(key) };
            next[key] = {
              status: "ready",
              showingTranslation: paperLanguageRef.current === "en" && Boolean(Object.keys(segments).length),
              segments,
              updatedAt: translatedAt,
            };
          }
          paperTranslationsRef.current = next;
          return next;
        });
        if (announce) setStatusText("Paper language set to English. Technical terms, citations, units, and identifiers are preserved.");
      } catch {
        setPaperTranslations((translations) => {
          const next = { ...translations };
          for (const key of pendingKeys) {
            const current = next[key];
            const hasCachedTranslation = Boolean(Object.keys(current?.segments ?? {}).length);
            next[key] = {
              status: "error",
              showingTranslation: paperLanguageRef.current === "en" && hasCachedTranslation,
              segments: current?.segments ?? {},
              updatedAt: current?.updatedAt,
              error: "Translation is temporarily unavailable.",
            };
          }
          paperTranslationsRef.current = next;
          return next;
        });
        setStatusText("English translation is temporarily unavailable. Original Thai paper text remains visible.");
      } finally {
        for (const key of pendingKeys) translationInFlightRef.current.delete(key);
      }
    },
    [],
  );

  const changePaperLanguage = useCallback((language: PaperLanguage) => {
    announcePaperLanguageRef.current = language === "en";
    paperLanguageRef.current = language;
    setPaperLanguage(language);
    setTranslationRefreshNonce((value) => value + 1);
    setPaperTranslations((translations) => {
      const next = Object.fromEntries(
        Object.entries(translations).map(([key, translation]) => [
          key,
          {
            ...translation,
            showingTranslation: language === "en" && Boolean(Object.keys(translation.segments).length),
            error: undefined,
          },
        ]),
      );
      paperTranslationsRef.current = next;
      return next;
    });
    setStatusText(language === "en" ? "Translating visible papers to English..." : "Showing original Thai paper text.");
  }, []);

  useEffect(() => {
    if (!translationRefreshNonce || !translationCacheReady || !paperLanguageReady || paperLanguage !== "en" || feedStatus !== "ready" || !visibleCards.length) return;
    const announce = announcePaperLanguageRef.current;
    announcePaperLanguageRef.current = false;
    const citableCards = visibleCards.filter((card) => card.citable !== false);
    if (citableCards.length) void translatePapersToEnglish(citableCards.map((card) => ({ card })), announce);
  }, [feedStatus, paperLanguage, paperLanguageReady, translatePapersToEnglish, translationCacheReady, translationRefreshNonce, visibleCards]);

  const createNewChat = async () => {
    if (isLoading) return;
    try {
      const payload = await fetchJson<{
        session: SessionPayload;
        sessions: ChatSessionSummary[];
        user?: ChatUserProfile | null;
        authenticated?: boolean;
      }>(
        "/api/chat-sessions",
        {
          method: "POST",
          body: JSON.stringify({ action: "create" }),
        },
      );
      const normalized = normalizeSessionPayload(payload.session ?? {});
      setCurrentSessionId(normalized.sessionId);
      setCurrentSessionTitle(normalized.title);
      setUseMcp(normalized.mode === "mcp");
      setSelectedModel(normalized.model);
      setSelectedCollection(normalized.collection);
      setMessages([]);
      setChatSessions(payload.sessions ?? []);
      if (payload.user) setUserProfile(payload.user);
      setIsAuthenticated(Boolean(payload.authenticated));
      setAppView("chat");
      setIsSharedView(false);
      setStatusText("New chat created");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to create chat.");
    }
  };

  const openChatSession = async (sessionId: string) => {
    const requestId = chatSessionRequestIdRef.current + 1;
    chatSessionRequestIdRef.current = requestId;
    try {
      const payload = await fetchJson<SessionPayload>(`/api/history?session=${encodeURIComponent(sessionId)}`);
      if (chatSessionRequestIdRef.current !== requestId) return;
      const normalized = normalizeSessionPayload(payload);
      setCurrentSessionId(normalized.sessionId);
      setCurrentSessionTitle(normalized.title);
      setUseMcp(normalized.mode === "mcp");
      setSelectedModel(normalized.model);
      setSelectedCollection(normalized.collection);
      setMessages(normalized.messages);
      if (normalized.user) setUserProfile(normalized.user);
      setIsAuthenticated(normalized.authenticated);
      setAppView("chat");
      setPendingDeleteSessionId(null);
      setIsSharedView(false);
      setStatusText("Chat session loaded");
    } catch (error) {
      if (chatSessionRequestIdRef.current !== requestId) return;
      setStatusText(error instanceof Error ? error.message : "Failed to load chat session.");
    }
  };

  const deleteChatSession = async (sessionId: string) => {
    if (deletingSessionId) return;
    setDeletingSessionId(sessionId);
    try {
      const payload = await fetchJson<ChatSessionsResponse>(`/api/chat-sessions?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      setChatSessions(payload.sessions ?? []);
      setIsAuthenticated(Boolean(payload.authenticated));
      setPendingDeleteSessionId(null);
      if (sessionId === currentSessionId) {
        await createNewChat();
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to delete chat session.");
    } finally {
      setDeletingSessionId(null);
    }
  };

  const refreshCurrentSession = async () => {
    const payload = await fetchJson<SessionPayload>("/api/history");
    const normalized = normalizeSessionPayload(payload);
    setCurrentSessionId(normalized.sessionId);
    setCurrentSessionTitle(normalized.title);
    setUseMcp(normalized.mode === "mcp");
    setSelectedModel(normalized.model);
    setSelectedCollection(normalized.collection);
    setMessages(normalized.messages);
    setUserProfile(normalized.user);
    setIsAuthenticated(normalized.authenticated);
    setLoginName(normalized.authenticated ? normalized.user?.displayName ?? "" : "");
    setLoginEmail(normalized.user?.email ?? loginEmail);
  };

  const continueWithGoogle = async () => {
    setAuthBusy(true);
    try {
      try {
        window.sessionStorage.setItem(AUTH_RETURN_FEATURE_KEY, pendingFeature ?? DEFAULT_AUTHENTICATED_FEATURE);
      } catch {}
      const payload = await fetchJson<{ url: string }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "oauth", provider: "google" }),
      });
      window.location.assign(payload.url);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Google sign-in is unavailable.");
      setAuthBusy(false);
    }
  };

  const openBilling = async (action: "checkout" | "portal") => {
    setBillingBusy(true);
    if (action === "checkout") trackProductEvent("upgrade_intent", { surface: "account", plan: "founder_pro" });
    try {
      const payload = await fetchJson<{ url: string }>("/api/billing", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      window.location.assign(payload.url);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Billing is temporarily unavailable.");
      setBillingBusy(false);
    }
  };

  const submitAuth = async () => {
    const email = loginEmail.trim();
    if (!email || loginPassword.length < 8) {
      setStatusText("Enter your email and a password with at least 8 characters.");
      return;
    }
    if (authMode === "signup" && loginPassword !== loginPasswordConfirm) {
      setStatusText("The passwords do not match.");
      return;
    }

    setAuthBusy(true);
    try {
      const payload = await fetchJson<{ user?: ChatUserProfile; authenticated?: boolean; pendingEmail?: boolean }>("/api/auth", {
        method: "POST",
        body: JSON.stringify(
          authMode === "signup"
            ? {
                action: "signup",
                displayName: loginName.trim() || email.split("@")[0] || "Researcher",
                email,
                password: loginPassword,
              }
            : {
                action: "signin",
                email,
                password: loginPassword,
              },
        ),
      });
      if (payload.pendingEmail) {
        setStatusText("Check your inbox to confirm the account, then sign in to SEEDY.");
      } else {
        let returnFeature = pendingFeature ?? DEFAULT_AUTHENTICATED_FEATURE;
        try {
          const storedFeature = window.sessionStorage.getItem(AUTH_RETURN_FEATURE_KEY);
          if (isMobileNavItem(storedFeature)) returnFeature = storedFeature;
          window.sessionStorage.removeItem(AUTH_RETURN_FEATURE_KEY);
        } catch {}
        if (payload.user) {
          setUserProfile(payload.user);
          setLoginName(payload.user.displayName);
          setLoginEmail(payload.user.email ?? email);
        }
        setIsAuthenticated(Boolean(payload.authenticated));
        setLoginPassword("");
        setLoginPasswordConfirm("");
        await refreshCurrentSession();
        await refreshBilling();
        await refreshChatSessions(true);
        setPendingFeature(null);
        setAppView(returnFeature);
        setStatusText(`Signed in. ${CIVILMCP_FEATURE_ACCESS[returnFeature].label} is ready.`);
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to sign in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const sendPasswordRecovery = async () => {
    const email = loginEmail.trim();
    if (!email) {
      setStatusText("Enter your email before requesting a recovery link.");
      return;
    }

    setAuthBusy(true);
    try {
      await fetchJson<{ ok: boolean; pendingEmail?: boolean }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "forgot-password", email }),
      });
      setStatusText("If an account exists for this email, a recovery link is on its way.");
    } catch {
      setStatusText("If an account exists for this email, a recovery link is on its way.");
    } finally {
      setAuthBusy(false);
    }
  };

  const updatePassword = async () => {
    if (loginPassword.length < 8) {
      setStatusText("Use at least 8 characters for the new password.");
      return;
    }
    if (loginPassword !== loginPasswordConfirm) {
      setStatusText("The passwords do not match.");
      return;
    }

    setAuthBusy(true);
    try {
      const payload = await fetchJson<{ user?: ChatUserProfile; authenticated?: boolean }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "update-password", password: loginPassword }),
      });
      if (payload.user) {
        setUserProfile(payload.user);
        setLoginName(payload.user.displayName);
        setLoginEmail(payload.user.email ?? loginEmail);
      }
      setIsAuthenticated(Boolean(payload.authenticated));
      setLoginPassword("");
      setLoginPasswordConfirm("");
      setAuthMode("signin");
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("auth");
      window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      setStatusText("Password updated. Your SEEDY account is ready.");
      await refreshCurrentSession();
      await refreshBilling();
      await refreshChatSessions(true);
      setAppView(pendingFeature ?? DEFAULT_AUTHENTICATED_FEATURE);
      setPendingFeature(null);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Password could not be updated.");
    } finally {
      setAuthBusy(false);
    }
  };

  const updateProfile = async () => {
    const displayName = loginName.trim();
    if (!displayName) {
      setStatusText("Enter a display name.");
      return;
    }

    setAuthBusy(true);
    try {
      const payload = await fetchJson<{ user?: ChatUserProfile; authenticated?: boolean }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "profile", displayName }),
      });
      if (payload.user) {
        setUserProfile(payload.user);
        setLoginName(payload.user.displayName);
        setLoginEmail(payload.user.email ?? loginEmail);
      }
      setIsAuthenticated(Boolean(payload.authenticated));
      setStatusText("Profile saved.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setAuthBusy(false);
    }
  };

  const logoutChat = async () => {
    try {
      await fetchJson<{ ok: boolean }>("/api/auth", { method: "DELETE" });
      setUserProfile(null);
      setLoginName("");
      setLoginEmail("");
      setLoginPassword("");
      setLoginPasswordConfirm("");
      setIsAuthenticated(false);
      setBilling(GUEST_BILLING_STATE);
      setMessages([]);
      setChatSessions([]);
      setCurrentSessionId("");
      setCurrentSessionTitle("Untitled chat");
      setStatusText("Signed out. Sign in again to use research features.");
      window.location.reload();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to log out.");
    }
  };

  const deleteAccount = async () => {
    setAuthBusy(true);
    setStatusText("");
    try {
      await fetchJson<{ ok: boolean; deleted: boolean }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "delete-account", confirmation: "DELETE" }),
      });
      window.localStorage.removeItem("civilmcp-bookmarks");
      window.localStorage.removeItem(RESEARCH_PATH_KEY);
      window.localStorage.removeItem(TRANSLATION_CACHE_KEY);
      setStatusText("Account and synced research data deleted.");
      window.location.assign("/");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Account could not be deleted.");
    } finally {
      setAuthBusy(false);
    }
  };

  const openPaperDetailBySource = useCallback(async (
    source: string,
    seedCard?: ResearchCardData,
    evidenceTarget: CivilEvidenceItem | null = null,
  ): Promise<boolean> => {
    const currentPassport = researchPassportRef.current.artifact;
    const openingCurrentPassportEvidence = Boolean(
      currentPassport
      && !currentPassport.stale
      && currentPassport.paper.source === source
      && evidenceTarget?.id
      && currentPassport.evidence.some((item) => item.id === evidenceTarget.id),
    );
    if (!openingCurrentPassportEvidence) invalidateResearchContext();
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    webMcpEvidenceContextRef.current = null;
    setPaperDetail(
      seedCard
        ? {
            document: seedCard,
            sections: [],
            evidence: [],
            counts: { sections: 0, chunks: seedCard.evidenceCount },
          }
        : null,
    );
    setPaperDetailStatus("loading");
    setPaperDetailError("");
    setPaperEvidenceTarget(evidenceTarget);
    try {
      const params = new URLSearchParams();
      if (evidenceTarget?.id) params.set("evidence", evidenceTarget.id);
      if (evidenceTarget?.sectionIndex != null) params.set("section", String(evidenceTarget.sectionIndex));
      if (evidenceTarget?.chunkIndex != null) params.set("chunk", String(evidenceTarget.chunkIndex));
      if (evidenceTarget?.pageStart != null) params.set("page", String(evidenceTarget.pageStart));
      const detail = await fetchJson<PaperDetailData>(`/api/papers/${encodeURIComponent(source)}${params.size ? `?${params.toString()}` : ""}`);
      if (detailRequestIdRef.current !== requestId) return false;
      const highlighted = detail.evidence.find((item) => (
        (evidenceTarget?.id && item.id === evidenceTarget.id)
        || (evidenceTarget?.sectionIndex != null && evidenceTarget?.chunkIndex != null
          && item.sectionIndex === evidenceTarget.sectionIndex && item.chunkIndex === evidenceTarget.chunkIndex)
        || (evidenceTarget?.pageStart != null && item.pageStart === evidenceTarget.pageStart)
      ));
      if (
        openingCurrentPassportEvidence
        && (!highlighted || highlighted.pageStart == null || highlighted.pageEnd == null)
      ) {
        throw new Error("The selected Passport anchor could not be reopened at its original page.");
      }
      const visibleEvidence = highlighted
        ? [highlighted, ...detail.evidence.filter((item) => item.id !== highlighted.id)].slice(0, 8)
        : detail.evidence.slice(0, 8);
      const readerPageNumber = highlighted?.readerPageNumber ?? 1;
      const readerPayload = await fetchJson<PaperReaderAccessPayload>(
        `/api/papers/${encodeURIComponent(source)}/reader?page=${readerPageNumber}&limit=1`,
      ).catch(() => null);
      if (detailRequestIdRef.current !== requestId) return false;
      const readerAccess = summarizePaperReaderAccess(readerPayload, detail.document.source, readerPageNumber);
      const enrichedDetail = { ...detail, readerAccess };
      webMcpEvidenceContextRef.current = { ...enrichedDetail, evidence: visibleEvidence };
      setPaperDetail(enrichedDetail);
      setPaperDetailStatus("ready");
      trackProductEvent("paper_open", {
        source: detail.document.source,
        collection: detail.document.collection,
        exactEvidence: Boolean(evidenceTarget),
      });
      recordActivationStep("verify");
      if (evidenceTarget) {
        const url = new URL(window.location.href);
        url.searchParams.set("paper", source);
        if (evidenceTarget.id) url.searchParams.set("evidence", evidenceTarget.id);
        if (evidenceTarget.sectionIndex != null) url.searchParams.set("section", String(evidenceTarget.sectionIndex));
        if (evidenceTarget.chunkIndex != null) url.searchParams.set("chunk", String(evidenceTarget.chunkIndex));
        if (evidenceTarget.pageStart != null) url.searchParams.set("page", String(evidenceTarget.pageStart));
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
      if (paperLanguageRef.current === "en") {
        void translatePapersToEnglish([{ card: detail.document, detail }]);
      }
      return true;
    } catch (error) {
      if (detailRequestIdRef.current !== requestId) return false;
      setPaperDetailStatus("error");
      setPaperDetailError(error instanceof Error ? error.message : "Failed to load paper detail.");
      return false;
    }
  }, [invalidateResearchContext, recordActivationStep, translatePapersToEnglish]);

  const loadCitationMapForPaper = useCallback(async (
    paper: ResearchCardData,
    signal?: AbortSignal,
  ): Promise<CitationMapResponse> => {
    const requestId = citationMapRequestIdRef.current + 1;
    citationMapRequestIdRef.current = requestId;
    const loadingState: CitationMapState = { phase: "loading", response: null, error: "" };
    citationMapRef.current = loadingState;
    citationMapSourceRef.current = paper.source;
    setCitationMap(loadingState);
    try {
      const response = await fetchJson<CitationMapResponse>("/api/citation-map", {
        method: "POST",
        signal,
        body: JSON.stringify({
          doi: paper.doi ?? null,
          title: displayTitle(paper),
          year: researchCardYear(paper),
        }),
      });
      if (signal?.aborted || citationMapRequestIdRef.current !== requestId) {
        throw new DOMException("The research connection trace was cancelled or superseded.", "AbortError");
      }
      const readyState: CitationMapState = { phase: "ready", response, error: "" };
      citationMapRef.current = readyState;
      setCitationMap(readyState);
      return response;
    } catch (error) {
      if (citationMapRequestIdRef.current === requestId && !signal?.aborted) {
        const errorState: CitationMapState = {
          phase: "error",
          response: null,
          error: error instanceof Error ? error.message : "Research connections could not be traced.",
        };
        citationMapRef.current = errorState;
        setCitationMap(errorState);
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!isReady || initialEvidenceLinkOpenedRef.current) return;
    initialEvidenceLinkOpenedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const source = params.get("paper")?.trim();
    if (!source) return;
    const numberParam = (key: string) => {
      const value = Number.parseInt(params.get(key) ?? "", 10);
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const target: CivilEvidenceItem = {
      evidenceId: "LINK",
      citation: source,
      source,
      id: params.get("evidence")?.slice(0, 120) || undefined,
      sectionIndex: numberParam("section"),
      chunkIndex: numberParam("chunk"),
      pageStart: numberParam("page"),
      pageEnd: numberParam("page"),
    };
    void openPaperDetailBySource(source, undefined, target);
  }, [isReady, openPaperDetailBySource]);

  const openPaperDetail = async (card: ResearchCardData) => {
    await openPaperDetailBySource(card.source, card, null);
  };

  const expandGlobalDiscovery = async () => {
    const query = feedQuery.trim();
    if (query.length < 2 || globalDiscovery.phase === "loading") return;
    const requestId = globalDiscoveryRequestIdRef.current + 1;
    globalDiscoveryRequestIdRef.current = requestId;
    setGlobalDiscovery({ phase: "loading", query, response: null, error: "" });
    try {
      const response = await fetchJson<GlobalDiscoveryResponse>("/api/global-discovery", {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      if (globalDiscoveryRequestIdRef.current !== requestId) return;
      setGlobalDiscovery({ phase: "ready", query, response, error: "" });
    } catch (error) {
      if (globalDiscoveryRequestIdRef.current !== requestId) return;
      setGlobalDiscovery({
        phase: "error",
        query,
        response: null,
        error: error instanceof Error ? error.message : "Global discovery is temporarily unavailable.",
      });
    }
  };

  const clearResearchPassport = useCallback(() => {
    researchPassportRequestIdRef.current += 1;
    const next: ResearchPassportState = { phase: "idle", artifact: null, error: "" };
    researchPassportRef.current = next;
    setResearchPassport(next);
    setStatusText("Research Passport cleared.");
  }, []);

  const reviewResearchPassportEvidence = useCallback(async (
    item: ResearchPassportEvidence,
    decision: "accepted" | "rejected",
  ) => {
    const current = researchPassportRef.current;
    const artifact = current.artifact;
    if (current.phase !== "ready" || !artifact || artifact.stale || artifact.reviewedAt) return;
    if (!artifact.openedEvidenceIds.includes(item.id)) {
      setStatusText("Open the exact source page before accepting or rejecting this evidence claim.");
      return;
    }
    const pageAnchor = item.readerAnchor
      || (item.pageStart != null ? `${artifact.paper.source}:page:${item.pageStart}` : "");
    if (!pageAnchor) {
      setStatusText("This evidence has no stable page anchor and cannot be reviewed.");
      return;
    }
    setResearchCaseStatus("saving");
    setResearchCaseError("");
    try {
      let researchCase = activeResearchCase;
      if (!researchCase || !researchCase.selectedSources.includes(artifact.paper.source)) {
        const created = await fetchJson<{ researchCase?: unknown }>("/api/research-cases", {
          method: "POST",
          body: JSON.stringify({
            action: "upsert",
            caseId: researchCase?.caseId,
            question: researchCase?.question || artifact.focus,
            selectedSources: [...new Set([...(researchCase?.selectedSources ?? []), artifact.paper.source])],
            state: {
              ...(researchCase?.state ?? {}),
              stage: "evidence",
              evidenceCount: artifact.evidence.length,
              passportId: artifact.passportId,
            },
          }),
        });
        researchCase = normalizeActiveResearchCase(created.researchCase);
      }
      if (!researchCase) throw new Error("Research Case could not be prepared for review.");
      const reviewed = await fetchJson<{ researchCase?: unknown }>("/api/research-cases", {
        method: "POST",
        body: JSON.stringify({
          action: "review",
          caseId: researchCase.caseId,
          source: artifact.paper.source,
          evidenceId: item.id,
          pageAnchor,
          decision,
          note: "",
        }),
      });
      const saved = normalizeActiveResearchCase(reviewed.researchCase);
      if (!saved) throw new Error("Evidence review persistence returned an invalid Research Case.");
      const reviewDecision: ResearchCaseReviewDecision = {
        evidenceId: item.id,
        source: artifact.paper.source,
        pageAnchor,
        decision,
        note: "",
        updatedAt: new Date().toISOString(),
      };
      const next: ResearchPassportState = {
        ...current,
        artifact: {
          ...artifact,
          reviewDecisions: { ...artifact.reviewDecisions, [item.id]: reviewDecision },
        },
      };
      researchPassportRef.current = next;
      setResearchPassport(next);
      setActiveResearchCase(saved);
      setResearchCaseStatus("ready");
      setStatusText(`${item.id} ${decision}. The candidate inference remains unvalidated.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence review could not be saved.";
      setResearchCaseStatus("error");
      setResearchCaseError(message);
      setStatusText(message);
    }
  }, [activeResearchCase]);

  const markResearchPassportReviewed = useCallback(() => {
    const current = researchPassportRef.current;
    const artifact = current.artifact;
    if (current.phase !== "ready" || !artifact || artifact.stale || artifact.reviewedAt) return;
    const allEvidenceOpened = artifact.evidence.every((item) => artifact.openedEvidenceIds.includes(item.id));
    if (!allEvidenceOpened) {
      setStatusText("Open every exact-page anchor before completing evidence review.");
      return;
    }
    const allEvidenceDecided = artifact.evidence.every((item) => Boolean(artifact.reviewDecisions[item.id]));
    const acceptedEvidence = artifact.evidence.filter((item) => artifact.reviewDecisions[item.id]?.decision === "accepted");
    if (!allEvidenceDecided || acceptedEvidence.length < 1) {
      setStatusText("Accept or reject every evidence claim and accept at least one before completing review.");
      return;
    }
    const next: ResearchPassportState = {
      ...current,
      artifact: { ...artifact, reviewedAt: new Date().toISOString() },
    };
    researchPassportRef.current = next;
    setResearchPassport(next);
    setStatusText("Claim-level evidence review completed. Export is now available; the candidate inference remains unvalidated.");
    const researchCase = activeResearchCase;
    if (researchCase) {
      setResearchCaseStatus("saving");
      void fetchJson<{ researchCase?: unknown }>("/api/research-cases", {
        method: "POST",
        body: JSON.stringify({
          action: "upsert",
          caseId: researchCase.caseId,
          question: researchCase.question,
          selectedSources: researchCase.selectedSources,
          state: {
            ...researchCase.state,
            stage: "review",
            evidenceCount: artifact.evidence.length,
            acceptedEvidenceCount: acceptedEvidence.length,
            passportId: artifact.passportId,
          },
        }),
      }).then((payload) => {
        const saved = normalizeActiveResearchCase(payload.researchCase);
        if (saved) setActiveResearchCase(saved);
        setResearchCaseStatus(saved ? "ready" : "error");
      }).catch(() => setResearchCaseStatus("error"));
    }
  }, [activeResearchCase]);

  const exportResearchPassport = useCallback(() => {
    const artifact = researchPassport.artifact;
    const allEvidenceOpened = artifact?.evidence.every((item) => artifact.openedEvidenceIds.includes(item.id)) ?? false;
    const acceptedEvidence = artifact?.evidence.filter((item) => artifact.reviewDecisions[item.id]?.decision === "accepted") ?? [];
    if (researchPassport.phase !== "ready" || !artifact?.reviewedAt || artifact.stale || !allEvidenceOpened || acceptedEvidence.length < 1) {
      setStatusText("Review the current Research Passport before exporting it.");
      return;
    }
    const blob = new Blob([researchPassportMarkdown(artifact)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seed-research-passport-${artifact.passportId.toLowerCase()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    trackProductEvent("review_exported", {
      surface: "research_passport",
      source: artifact.paper.source,
      evidenceCount: artifact.evidence.length,
      globalLeadCount: artifact.globalWorks.length,
    });
    trackProductEvent("verified_research_outcome", {
      surface: "research_passport_export",
      passportId: artifact.passportId,
      source: artifact.paper.source,
      evidenceCount: acceptedEvidence.length,
      globalLeadCount: artifact.globalWorks.length,
    });
    recordActivationStep("outcome");
    setStatusText("Page-reviewed Research Passport exported as Markdown with its candidate-inference warning intact.");
  }, [recordActivationStep, researchPassport]);

  const consumeReaderReviewReceipt = useCallback(() => {
    type ReaderReviewReceipt = {
      passportId?: unknown;
      evidenceId?: unknown;
      source?: unknown;
      pageStart?: unknown;
      readerPageNumber?: unknown;
      accessMode?: unknown;
      visitedAt?: unknown;
    };
    let receipt: ReaderReviewReceipt | null = null;
    try {
      receipt = JSON.parse(window.localStorage.getItem(READER_REVIEW_RECEIPT_KEY) ?? "null") as ReaderReviewReceipt | null;
    } catch {
      return;
    }
    if (!receipt || receipt.accessMode !== "native_verified" || typeof receipt.visitedAt !== "string") return;
    const visitedAt = new Date(receipt.visitedAt).getTime();
    if (!Number.isFinite(visitedAt) || Date.now() - visitedAt > 15 * 60_000) return;
    const current = researchPassportRef.current;
    const artifact = current.artifact;
    if (
      current.phase !== "ready"
      || !artifact
      || artifact.stale
      || receipt.passportId !== artifact.passportId
      || receipt.source !== artifact.paper.source
      || typeof receipt.evidenceId !== "string"
    ) return;
    const evidence = artifact.evidence.find((item) => item.id === receipt?.evidenceId);
    if (
      !evidence
      || !evidence.readerAnchor
      || evidence.readerPageNumber !== receipt.readerPageNumber
      || evidence.pageStart !== receipt.pageStart
    ) return;
    try {
      window.localStorage.removeItem(READER_REVIEW_RECEIPT_KEY);
    } catch {}
    if (artifact.openedEvidenceIds.includes(evidence.id)) return;
    const next: ResearchPassportState = {
      ...current,
      artifact: { ...artifact, openedEvidenceIds: [...artifact.openedEvidenceIds, evidence.id] },
    };
    researchPassportRef.current = next;
    setResearchPassport(next);
    setStatusText(`${evidence.id} loaded in the verified full-paper reader at ${passportEvidencePage(evidence)}. Return to accept or reject this evidence claim.`);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === READER_REVIEW_RECEIPT_KEY) consumeReaderReviewReceipt();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", consumeReaderReviewReceipt);
    consumeReaderReviewReceipt();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", consumeReaderReviewReceipt);
    };
  }, [consumeReaderReviewReceipt]);

  const openResearchPassportEvidence = useCallback((item: ResearchPassportEvidence) => {
    const artifact = researchPassport.artifact;
    if (!artifact) return;
    const passportId = artifact.passportId;
    if (item.readerAnchor && item.readerPageNumber && item.pageStart != null) {
      const params = new URLSearchParams({
        passport: passportId,
        evidence: item.id,
        page: String(item.pageStart),
        readerPage: String(item.readerPageNumber),
      });
      const readerUrl = `/papers/${encodeURIComponent(artifact.paper.source)}?${params.toString()}#${item.readerAnchor.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
      const readerWindow = window.open(readerUrl, "_blank", "noopener,noreferrer");
      setStatusText(readerWindow
        ? `Opened ${item.id} in the verified full-paper reader. Its review receipt will unlock the Passport after the page loads.`
        : "The verified reader window was blocked. Allow pop-ups for this site and open the evidence again.");
      return;
    }
    const target: CivilEvidenceItem = {
      evidenceId: item.id,
      citation: `${artifact.paper.paperCode || artifact.paper.title} · ${passportEvidencePage(item)}`,
      source: artifact.paper.source,
      id: item.id,
      documentId: artifact.paper.id,
      sectionIndex: item.sectionIndex,
      chunkIndex: item.chunkIndex,
      pageStart: item.pageStart,
      pageEnd: item.pageEnd,
      sectionTitle: item.sectionTitle ?? undefined,
      snippet: item.snippet,
    };
    void openPaperDetailBySource(artifact.paper.source, artifact.paper, target).then((opened) => {
      if (!opened) return;
      setResearchPassport((current) => {
        if (current.phase !== "ready" || !current.artifact || current.artifact.passportId !== passportId || current.artifact.stale) return current;
        if (current.artifact.openedEvidenceIds.includes(item.id)) return current;
        const next: ResearchPassportState = {
          ...current,
          artifact: {
            ...current.artifact,
            openedEvidenceIds: [...current.artifact.openedEvidenceIds, item.id],
          },
        };
        researchPassportRef.current = next;
        return next;
      });
      setStatusText(`${item.id} reopened in the exact-page evidence view at ${passportEvidencePage(item)}. Review every Passport anchor before export.`);
    });
  }, [openPaperDetailBySource, researchPassport.artifact]);

  const promoteNotebookFinding = useCallback(async (finding: ResearchNotebookFinding) => {
    const publicCitations = finding.citations.filter((citation) => citation.shareable && !citation.source.startsWith("private:"));
    const seed = publicCitations[0];
    if (!seed || finding.insufficient) {
      setStatusText("Only supported public exact-page evidence can be promoted to a Research Passport.");
      return;
    }
    const target: CivilEvidenceItem = {
      evidenceId: seed.evidenceId,
      citation: `${seed.source} · p.${seed.pageStart}${seed.pageEnd !== seed.pageStart ? `-${seed.pageEnd}` : ""}`,
      source: seed.source,
      id: seed.evidenceId,
      pageStart: seed.pageStart,
      pageEnd: seed.pageEnd,
      sectionTitle: seed.sectionTitle ?? undefined,
    };
    const opened = await openPaperDetailBySource(seed.source, undefined, target);
    const detail = webMcpEvidenceContextRef.current;
    if (!opened || !detail || detail.document.source !== seed.source || detail.document.citable !== true) {
      setStatusText("The Notebook citation could not be reopened in the current citable paper.");
      return;
    }
    const citationIds = new Set(publicCitations.filter((citation) => citation.source === seed.source).map((citation) => citation.evidenceId));
    const evidence = detail.evidence.filter((item) => citationIds.has(item.id) && item.pageStart != null && item.pageEnd != null).slice(0, 3);
    if (!evidence.length) {
      setStatusText("The Notebook citation no longer resolves to an exact-page evidence packet.");
      return;
    }
    const connectionResponse = citationMapSourceRef.current === detail.document.source
      ? citationMapRef.current.response
      : null;
    const globalWorks = tracedGlobalWorks(connectionResponse);
    const fallbackSearchUrl = connectionResponse?.searchUrl || `https://openalex.org/works?search=${encodeURIComponent(finding.question)}`;
    const gap = passportGapCopy(finding.question, "validation");
    const artifact: ResearchPassportArtifact = {
      version: "seed-research-passport-v1",
      passportId: `SR-${Date.now().toString(36).toUpperCase()}-NB`,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      stale: false,
      openedEvidenceIds: [],
      reviewDecisions: {},
      runSteps: [{ tool: "research_notebook", detail: `${evidence.length} exact-page citations promoted · claim review pending`, completedAt: new Date().toISOString() }],
      translationStatus: evidence.some((item) => THAI_TEXT_PATTERN.test(item.snippet)) ? "unavailable" : "not_needed",
      focus: finding.question,
      gapLens: "validation",
      paper: detail.document,
      evidence: evidence.map((item) => ({ ...item, englishSnippet: null })),
      globalStatus: connectionResponse?.status ?? "disabled",
      globalSearchUrl: fallbackSearchUrl,
      globalWorks,
      candidateGap: { ...gap, localBasisEvidenceIds: evidence.map((item) => item.id), relationValidated: false },
    };
    const ready: ResearchPassportState = { phase: "ready", artifact, error: "" };
    researchPassportRef.current = ready;
    setResearchPassport(ready);
    closePaperDetail();
    setAppView("explore");
    setStatusText("Notebook evidence promoted to a Research Passport. Open every exact page, then accept or reject each evidence claim.");
  }, [closePaperDetail, openPaperDetailBySource]);

  const createLivingReview = async () => {
    const query = feedQuery.trim();
    if (query.length < 3 || livingReviewBusyId) return;
    setLivingReviewBusyId("new");
    try {
      const payload = await fetchJson<{ watch: LivingReviewWatch }>("/api/living-reviews", {
        method: "POST",
        body: JSON.stringify({ action: "create", query, collection: selectedCollection }),
      });
      setLivingReviewWatches((current) => [payload.watch, ...current.filter((watch) => watch.watchId !== payload.watch.watchId)]);
      setStatusText("Living Review saved. Check it anytime for new records.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Living Review could not be saved.");
    } finally {
      setLivingReviewBusyId("");
    }
  };

  const checkLivingReview = async (watchId: string) => {
    setLivingReviewBusyId(watchId);
    try {
      const payload = await fetchJson<{ watch: LivingReviewWatch }>("/api/living-reviews", { method: "POST", body: JSON.stringify({ action: "check", watchId }) });
      setLivingReviewWatches((current) => current.map((watch) => watch.watchId === watchId ? payload.watch : watch));
      setStatusText(payload.watch.newCount ? `${payload.watch.newCount} new records found.` : "Living Review is up to date.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Living Review could not be checked.");
    } finally {
      setLivingReviewBusyId("");
    }
  };

  const deleteLivingReview = async (watchId: string) => {
    try {
      await fetchJson(`/api/living-reviews?watchId=${encodeURIComponent(watchId)}`, { method: "DELETE" });
      setLivingReviewWatches((current) => current.filter((watch) => watch.watchId !== watchId));
      setStatusText("Living Review removed.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Living Review could not be removed.");
    }
  };

  const loadMoreFeed = async () => {
    if (!feedNextCursor || isFeedLoadingMore || feedStatus !== "ready") return;
    const requestFeedKey = feedKeyRef.current;
    setIsFeedLoadingMore(true);
    try {
      const params = buildFeedParams(feedNextCursor);
      const payload = await fetchJson<ResearchFeedResponse>(`/api/research-feed?${params.toString()}`);
      if (feedKeyRef.current !== requestFeedKey) return;
      setFeedCards((current) => {
        const seen = new Set(current.map((card) => card.id));
        const nextCards = (payload.cards ?? []).filter((card) => !seen.has(card.id));
        return [...current, ...nextCards];
      });
      setFeedTotal(payload.facets?.total ?? feedTotal);
      setFeedCitableTotal(payload.facets?.citableTotal ?? feedCitableTotal);
      setFeedMetadataOnlyTotal(payload.facets?.metadataOnlyTotal ?? feedMetadataOnlyTotal);
      setFeedTotalSections(payload.facets?.totalSections ?? feedTotalSections);
      setFeedTotalChunks(payload.facets?.totalChunks ?? feedTotalChunks);
      setFeedFilterCounts(payload.facets?.filters ?? feedFilterCounts);
      setFeedCoverage(payload.facets?.coverage ?? feedCoverage);
      setFeedVisibility(payload.facets?.visibility ?? feedVisibility);
      setFeedGeneratedAt(payload.generatedAt ?? feedGeneratedAt);
      setFeedNextCursor(payload.nextCursor ?? null);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to load more papers.");
    } finally {
      setIsFeedLoadingMore(false);
    }
  };

  const startResearchCaseFromComposer = async (submittedDraft = draft) => {
    const question = submittedDraft.trim();
    if (question.length < 8 || researchCaseStatus === "saving") return;
    const handler = webMcpHandlersRef.current?.startResearchCase;
    if (!handler) {
      setResearchCaseError("Research Case tools are still preparing.");
      setResearchCaseStatus("error");
      return;
    }
    const controller = new AbortController();
    try {
      await handler({
        query: question,
        collection: selectedCollection || "all",
        scope: "thai",
        outcome: "study_plan",
      }, controller.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Research Case could not be started.";
      setResearchCaseError(message);
      setResearchCaseStatus("error");
      setStatusText(message);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>, submittedDraft: string) => {
    event.preventDefault();
    if (activeMobileNav === "explore") {
      void startResearchCaseFromComposer(submittedDraft);
      return;
    }
    void submitPrompt(submittedDraft);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setCurrentSessionTitle("Untitled chat");
    setStatusText("");
  };

  const exportSession = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      sessionId: currentSessionId,
      title: currentSessionTitle,
      mode,
      model: selectedModel,
      collection: selectedCollection,
      messages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seed-research-session-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusText("Session exported as JSON");
    trackProductEvent("session_export", { messageCount: messages.length, mode });
    recordActivationStep("outcome");
  };

  const exportEvidenceBrief = (annotation: CivilMissionAnnotation | null = latestMissionAnnotation) => {
    if (!annotation) {
      setStatusText("Run an evidence or research mode before exporting its linked artifact.");
      return;
    }
    const sourceMessage = messages.find((message) => getCivilMissionAnnotation(message)?.traceId === annotation.traceId);
    const evidenceItems = sourceMessage ? getCivilMcpAnnotation(sourceMessage)?.evidenceItems ?? [] : [];
    const blob = new Blob([evidenceBriefMarkdown(annotation, evidenceItems)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const automated = annotation.artifact.experience === "automated";
    anchor.download = `seed-research-${automated ? "research-dossier" : "evidence-brief"}-${Date.now()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusText(`${automated ? "Research Dossier" : "Evidence Brief"} exported as Markdown`);
    trackProductEvent("evidence_export", {
      experience: annotation.artifact.experience,
      evidenceCount: annotation.artifact.trust.evidenceCount,
    });
    recordActivationStep("outcome");
  };

  const createShareLink = async (copyToClipboard: boolean) => {
    if (shareBusy) return null;
    if (!currentSessionId) {
      setStatusText("Start or open a chat before creating a share link.");
      return null;
    }
    if (!messages.length) {
      setStatusText("Ask a question before creating a share link.");
      return null;
    }

    setShareBusy(true);
    try {
      const writableSessionId = await ensureWritableSession();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveControllerRef.current?.abort();
      const nextTitle = sessionTitleFromMessages(messages, currentSessionTitle);
      setCurrentSessionTitle(nextTitle);
      setSyncState("saving");
      await fetchJson<{ ok: boolean }>("/api/history", {
        method: "POST",
        body: JSON.stringify({
          sessionId: writableSessionId,
          title: nextTitle,
          mode,
          model: selectedModel,
          collection: selectedCollection,
          messages,
        }),
      });
      setSyncState("saved");
      void refreshChatSessions();

      const data = await fetchJson<{ shareUrl: string }>("/api/share", {
        method: "POST",
        body: JSON.stringify({ sessionId: writableSessionId }),
      });
      setShareUrl(data.shareUrl);
      if (copyToClipboard && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.shareUrl);
        setStatusText("Share link copied");
      } else {
        setStatusText("Share link ready");
      }
      return data.shareUrl;
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to create share link.");
      return null;
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    if (shareUrl && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setStatusText("Share link copied");
        return;
      } catch {
        // Fall through and recreate the link when clipboard access fails.
      }
    }
    const url = await createShareLink(true);
    if (url) setAppView("shared");
  };

  const changeAuthMode = (nextMode: AuthMode) => {
    setAuthMode(nextMode);
    setLoginPassword("");
    setLoginPasswordConfirm("");
    setStatusText("");
  };

  const persistResearchCasePathReady = useCallback((path: ResearchPath, complete: boolean) => {
    const researchCase = activeResearchCase;
    if (!researchCase) return;
    setResearchCaseStatus("saving");
    void fetchJson<{ researchCase?: unknown }>("/api/research-cases", {
      method: "POST",
      body: JSON.stringify({
        action: "upsert",
        caseId: researchCase.caseId,
        question: researchCase.question,
        status: complete ? "completed" : researchCase.status,
        selectedSources: researchCase.selectedSources,
        state: {
          ...researchCase.state,
          stage: "next_study",
          pathReady: true,
          pathGoal: path.goal,
          candidateGapStatus: path.candidateGap?.status ?? "unsupported_candidate",
          nextStudyProtocolReady: Boolean(path.nextStudyProtocol),
        },
      }),
    }).then((payload) => {
      const saved = normalizeActiveResearchCase(payload.researchCase);
      if (!saved) throw new Error("Research Case path state was not returned.");
      setActiveResearchCase(saved);
      if (researchCase.status !== "completed" && saved.status === "completed") {
        setCompletedResearchCaseCount((count) => count + 1);
      }
      setResearchCaseStatus("ready");
      setResearchCaseError("");
    }).catch((error) => {
      setResearchCaseStatus("error");
      setResearchCaseError(error instanceof Error ? error.message : "Research Case path state could not be saved.");
    });
  }, [activeResearchCase]);

  const buildResearchPath = async (
    knowledgeGaps: string[] = [],
    preserveMastered = false,
    passportArtifact: ResearchPassportArtifact | null = null,
    goalOverride = "",
  ) => {
    const goal = (passportArtifact?.focus ?? (goalOverride || pathGoal)).trim();
    if (goal.length < 8 || researchPathStatus === "loading") return;
    const requestId = ++pathBuildRequestIdRef.current;
    const previousPath = researchPath;
    const preservedGlobalLeads = passportArtifact
      ? passportArtifact.globalWorks.slice(0, 4).flatMap((lead) => /^https:\/\/openalex\.org\/W\d+$/i.test(lead.id) ? [{
          id: lead.id,
          title: lead.title,
          year: lead.year,
          relation: "related" as const,
          topic: lead.topic ?? null,
          citable: false as const,
        }] : [])
      : preserveMastered
      ? previousPath?.globalConnections?.leads.map((lead) => ({
          id: lead.id,
          title: lead.title,
          year: lead.year,
          relation: lead.relation,
          topic: lead.topic ?? null,
          citable: false as const,
        })) ?? []
      : [];
    const masteredStageIds = new Set(completedPathStages);
    setResearchPathStatus("loading");
    setResearchPathError("");
    try {
      const path = await fetchJson<ResearchPath>("/api/research-path", {
        method: "POST",
        body: JSON.stringify({
          goal,
          level: passportArtifact ? "research" : pathLevel,
          outcome: passportArtifact ? "study_plan" : pathOutcome,
          collection: passportArtifact?.paper.collection ?? selectedCollection,
          knowledgeGaps,
          globalLeads: preservedGlobalLeads,
          passportContext: passportArtifact?.reviewedAt ? {
            passportId: passportArtifact.passportId,
            source: passportArtifact.paper.source,
            evidenceIds: passportArtifact.evidence.map((item) => item.id),
            gapLens: passportArtifact.gapLens,
            reviewedAt: passportArtifact.reviewedAt,
            globalLeadIds: preservedGlobalLeads.map((lead) => lead.id),
          } : null,
        }),
      });
      if (!isResearchPath(path)) throw new Error("Seedy Research returned an invalid research path.");
      if (pathBuildRequestIdRef.current !== requestId) return;
      if (preserveMastered && previousPath) {
        const priorStages = new Map(previousPath.stages.map((stage) => [stage.id, stage]));
        const stages = path.stages.map((stage) => masteredStageIds.has(stage.id) ? priorStages.get(stage.id) ?? stage : stage);
        const validMasteredIds = stages.map((stage) => stage.id).filter((stageId) => masteredStageIds.has(stageId));
        setResearchPath({ ...path, stages, globalConnections: previousPath.globalConnections ?? path.globalConnections });
        setCompletedPathStages(validMasteredIds);
        setPathStageMastery((current) => Object.fromEntries(
          Object.entries(current).filter(([stageId, status]) => validMasteredIds.includes(stageId) && status === "understood"),
        ));
        setPathCheckpointAnswers((current) => Object.fromEntries(
          Object.entries(current).filter(([stageId]) => validMasteredIds.includes(stageId)),
        ));
        setPathCheckpointAssessments((current) => Object.fromEntries(
          Object.entries(current).filter(([stageId]) => validMasteredIds.includes(stageId)),
        ));
      } else {
        setResearchPath(path);
        setCompletedPathStages([]);
        setPathStageMastery({});
        setPathCheckpointAnswers({});
        setPathCheckpointAssessments({});
      }
      setResearchPathStatus("ready");
      trackProductEvent("research_path_created", {
        level: path.level,
        outcome: path.outcome,
        paperCount: path.stages.reduce((count, stage) => count + stage.papers.length, 0),
        collection: selectedCollection || "all",
        passportId: path.passportContext?.passportId ?? null,
      });
      persistResearchCasePathReady(path, Boolean(passportArtifact?.reviewedAt));
    } catch (error) {
      if (pathBuildRequestIdRef.current !== requestId) return;
      setResearchPathStatus("error");
      setResearchPathError(error instanceof Error ? error.message : "Could not build this research path.");
    }
  };

  const resetResearchPath = () => {
    pathBuildRequestIdRef.current += 1;
    pathCheckpointRequestIdRef.current += 1;
    setResearchPath(null);
    setCompletedPathStages([]);
    setPathStageMastery({});
    setPathCheckpointAnswers({});
    setPathCheckpointAssessments({});
    setPathAssessingStageId("");
    setResearchPathError("");
    setResearchPathStatus("idle");
    setPathGoal("");
    setPathLevel(RESEARCH_PATH_DEMO_LEVEL);
    setPathOutcome(RESEARCH_PATH_DEMO_OUTCOME);
  };

  const updatePathCheckpointAnswer = (stageId: string, answer: string) => {
    setPathCheckpointAnswers((current) => ({ ...current, [stageId]: answer }));
    setPathCheckpointAssessments((current) => {
      if (!current[stageId]) return current;
      const next = { ...current };
      delete next[stageId];
      return next;
    });
    setPathStageMastery((current) => {
      if (!current[stageId]) return current;
      const next = { ...current };
      delete next[stageId];
      return next;
    });
    setCompletedPathStages((current) => current.filter((id) => id !== stageId));
  };

  const assessPathCheckpoint = async (stageId: string) => {
    if (!researchPath || pathAssessingStageId) return;
    const stage = researchPath.stages.find((candidate) => candidate.id === stageId);
    const answer = pathCheckpointAnswers[stageId]?.trim() ?? "";
    if (!stage?.checkpointQuestion || answer.length < 20) return;
    const requestId = ++pathCheckpointRequestIdRef.current;
    setPathAssessingStageId(stageId);
    setResearchPathError("");
    try {
      const assessment = await fetchJson<ResearchPathCheckpointAssessment>("/api/research-path", {
        method: "POST",
        body: JSON.stringify({
          action: "assess_checkpoint",
          goal: researchPath.goal,
          level: researchPath.level,
          stageId: stage.id,
          stageTitle: stage.title,
          checkpointQuestion: stage.checkpointQuestion,
          concepts: stage.concepts ?? [],
          paperSources: stage.papers.map((paper) => paper.source).slice(0, 2),
          answer,
        }),
      });
      if (!isResearchPathCheckpointAssessment(assessment)) throw new Error("Seedy Research returned an invalid checkpoint assessment.");
      if (pathCheckpointRequestIdRef.current !== requestId) return;
      setPathCheckpointAssessments((current) => ({ ...current, [stageId]: assessment }));
      setPathStageMastery((current) => ({ ...current, [stageId]: assessment.status }));
      setCompletedPathStages((current) => {
        if (assessment.status === "understood") return current.includes(stageId) ? current : [...current, stageId];
        return current.filter((id) => id !== stageId);
      });
      trackProductEvent("checkpoint_answered", { stageId, score: assessment.score, status: assessment.status, model: assessment.model });
      if (assessment.status === "understood") {
        trackProductEvent("checkpoint_mastered", { stageId, score: assessment.score });
        trackProductEvent("path_stage_completed", { stageId, checkpoint: true, score: assessment.score });
      }
    } catch (error) {
      if (pathCheckpointRequestIdRef.current !== requestId) return;
      setResearchPathError(error instanceof Error ? error.message : "Could not assess this checkpoint.");
    } finally {
      if (pathCheckpointRequestIdRef.current === requestId) setPathAssessingStageId("");
    }
  };

  const adaptResearchPath = () => {
    if (!researchPath) return;
    const gaps = researchPath.stages
      .filter((stage) => pathStageMastery[stage.id] && pathStageMastery[stage.id] !== "understood")
      .flatMap((stage) => pathCheckpointAssessments[stage.id]?.gaps?.length
        ? pathCheckpointAssessments[stage.id].gaps
        : stage.concepts?.length ? stage.concepts : [stage.objective])
      .slice(0, 4);
    if (gaps.length) {
      trackProductEvent("path_adapted", { gapCount: gaps.length, completedStages: completedPathStages.length });
      void buildResearchPath(gaps, true);
    }
  };

  const exportResearchPath = () => {
    if (!researchPath) return;
    const reviewed = completedPathStages.length === researchPath.stages.length;
    const lines = [
      `# Research Path — ${researchPath.goal}`,
      "",
      reviewed
        ? "> REVIEWED PATH: every learning checkpoint was completed in this Seedy session. Candidate novelty still requires external validation."
        : "> DRAFT — NOT REVIEWED: one or more learning checkpoints are incomplete. Do not present this export as a reviewed research artifact.",
      "",
      `- Starting point: ${researchPath.level}`,
      `- Target outcome: ${researchPath.outcome.replace(/_/g, " ")}`,
      `- Progress: ${completedPathStages.length}/${researchPath.stages.length} stages mastered`,
      researchPath.coverage ? `- Coverage: ${researchPath.coverage.status} (${researchPath.coverage.paperCount} matching papers)` : "",
      researchPath.passportContext ? `- Continued from page-reviewed Passport: ${researchPath.passportContext.passportId}` : "",
      researchPath.passportContext ? `- Retained evidence: ${researchPath.passportContext.evidence.map((item) => `${item.id} (p.${item.pageStart}${item.pageEnd !== item.pageStart ? `-${item.pageEnd}` : ""})`).join("; ")}` : "",
      "",
      ...researchPath.stages.flatMap((stage, index) => {
        const assessment = pathCheckpointAssessments[stage.id];
        const answer = pathCheckpointAnswers[stage.id]?.trim();
        return [
          `## ${index + 1}. ${stage.title}`,
          "",
          stage.objective,
          "",
          "### Papers",
          ...stage.papers.map((paper) => `- ${paper.title}`),
          "",
          `### Checkpoint\n${stage.checkpointQuestion || "No checkpoint question"}`,
          answer ? `\n### Your reasoning\n${answer}` : "",
          assessment ? `\n### Assessment\n${assessment.gradeAvailable === false ? "Grade pending" : `${assessment.score}/100 · ${assessment.status}`}\n\n${assessment.feedback}` : "",
          ...(assessment?.evidence.length ? ["", "### Reading checked", ...assessment.evidence.map((item) => `- ${stage.papers.find((paper) => paper.source === item.source)?.title || "Selected research paper"}`)] : []),
          "",
        ];
      }),
      "## Candidate gap — not proven novel",
      "",
      researchPath.candidateGap.statement,
      "",
      `Basis: ${researchPath.candidateGap.basis}`,
      "",
      "### Missing validation",
      ...researchPath.candidateGap.missingValidation.map((item) => `- ${item}`),
      "",
      "Novelty established: no",
      "",
      "## Next-Study Protocol — draft framework",
      "",
      `- Research question: ${researchPath.nextStudyProtocol.researchQuestion}`,
      `- Context / population: ${researchPath.nextStudyProtocol.contextOrPopulation}`,
      `- Data needed: ${researchPath.nextStudyProtocol.dataNeeded.join("; ")}`,
      `- Method: ${researchPath.nextStudyProtocol.method}`,
      `- Validation: ${researchPath.nextStudyProtocol.validationPlan}`,
      `- Falsification condition: ${researchPath.nextStudyProtocol.falsificationCondition}`,
      "",
      researchPath.nextStudyProtocol.evidenceBoundary,
      "",
      ...(researchPath.globalConnections?.leads.length ? [
        "## Global comparison leads — metadata only",
        "",
        ...researchPath.globalConnections.leads.map((lead) => `- [${lead.title}](${lead.url}) — ${lead.relation}; not used as evidence`),
        "",
        researchPath.globalConnections.evidenceBoundary,
        "",
      ] : []),
      "---",
      "Generated from a bounded Seedy Research Path. Thai page-linked evidence still requires human review; global leads are metadata only.",
    ].filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seed-research-path-${reviewed ? "reviewed" : "draft"}-${Date.now()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    if (reviewed) trackProductEvent("review_exported", { surface: "research_path", completedStages: completedPathStages.length });
    setStatusText(reviewed ? "Reviewed Research Path exported as Markdown" : "Draft Research Path exported with an unreviewed watermark");
  };

  useEffect(() => {
    webMcpHandlersRef.current = {
      startResearchCase: async (input, signal) => {
        const discoveryHandler = webMcpHandlersRef.current?.discoverResearch;
        if (!discoveryHandler) throw new Error("Research discovery is still preparing.");
        setResearchCaseStatus("saving");
        setResearchCaseError("");
        try {
          const discovery = await discoveryHandler({
          query: input.query,
          collection: input.collection,
          scope: input.scope,
        }, signal) as {
          thaiEvidence?: Array<{ source?: string; evidencePackets?: number; visibilityState?: string }>;
          thaiDiscoveryRecords?: Array<{ source?: string; visibilityState?: string }>;
          discoveryOnlyReturned?: number;
        };
        const firstEvidence = discovery.thaiEvidence?.find((item) => item.source);
        const firstDiscovery = discovery.thaiDiscoveryRecords?.find((item) => item.source);
        const selected = firstEvidence ?? firstDiscovery;
        const selectedSource = selected?.source ?? "";
        const response = await fetchJson<{ researchCase?: unknown }>("/api/research-cases", {
          method: "POST",
          signal,
          body: JSON.stringify({
            action: "upsert",
            question: input.query,
            selectedSources: selectedSource ? [selectedSource] : [],
            state: {
              stage: selectedSource ? "discovery" : "sparse",
              outcome: input.outcome,
              visibilityState: selected?.visibilityState ?? "pending",
              evidenceCount: firstEvidence?.evidencePackets ?? 0,
              discoveryOnlyReturned: discovery.discoveryOnlyReturned ?? 0,
              startedBy: "webmcp",
            },
          }),
        });
        if (signal.aborted) throw new DOMException("The Research Case was cancelled.", "AbortError");
        const saved = normalizeActiveResearchCase(response.researchCase);
        if (!saved) throw new Error("Research Case persistence returned an invalid record.");
        setActiveResearchCase(saved);
        setResearchCaseStatus("ready");
        recordWebMcpActivity("start_research_case", `${saved.caseId} · ${selectedSource ? "source selected" : "sparse result"}`);
        setStatusText(selectedSource
          ? "Research Case saved. Inspect the selected paper and make claim-level review decisions next."
          : "Research Case saved with sparse coverage. Refine the question without adding unrelated filler.");
          return {
          ok: true,
          caseId: saved.caseId,
          visibleView: "explore",
          question: saved.question,
          selectedSource: selectedSource || null,
          visibilityState: selected?.visibilityState ?? "pending",
          citableEvidenceAvailable: Boolean(firstEvidence),
          sparse: !selectedSource,
          nextStep: firstEvidence
            ? "Use inspect_paper_evidence on selectedSource, then accept or reject the claim-level evidence in the shared page."
            : firstDiscovery
              ? "Read audit_global_visibility for selectedSource, then verify lawful full-paper access at the source."
              : "Refine the question; Seedy intentionally returned no unrelated filler.",
          evidenceBoundary: "Thai-published membership and topical relevance are separate. Global metadata and discovery-only records are not citable evidence.",
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Research Case could not be started.";
          setResearchCaseStatus("error");
          setResearchCaseError(message);
          throw error;
        }
      },
      discoverResearch: async (input, signal) => {
        const requestId = ++webMcpDiscoveryRequestIdRef.current;
        invalidateResearchContext();
        const collection: CollectionFilter = input.collection === "all" ? "" : input.collection;
        const params = new URLSearchParams({
          filter: collection || "thai",
          collection: input.collection,
          limit: "8",
          q: input.query,
        });
        const globalRequest = input.scope === "thai_and_global"
          ? fetchJson<GlobalDiscoveryResponse>("/api/global-discovery", {
              method: "POST",
              signal,
              body: JSON.stringify({ query: input.query }),
            }).then((response) => ({ response, error: "" })).catch((error: unknown) => ({
              response: null,
              error: error instanceof Error ? error.message : "Global discovery is unavailable.",
            }))
          : Promise.resolve({ response: null, error: "" });
        const [payload, globalResult] = await Promise.all([
          fetchJson<ResearchFeedResponse>(`/api/research-feed?${params.toString()}`, { signal }),
          globalRequest,
        ]);
        if (signal.aborted || webMcpDiscoveryRequestIdRef.current !== requestId) {
          throw new DOMException("The research discovery was cancelled or superseded.", "AbortError");
        }

        const cards = payload.cards ?? [];
        setDraft(input.query);
        setFeedQuery(input.query);
        setSelectedCollection(collection);
        setActiveFeedFilter(collection || "thai");
        setFeedCards(cards);
        setFeedTotal(payload.facets?.total ?? cards.length);
        setFeedCitableTotal(payload.facets?.citableTotal ?? cards.filter((card) => card.citable !== false).length);
        setFeedMetadataOnlyTotal(payload.facets?.metadataOnlyTotal ?? cards.filter((card) => card.citable === false).length);
        setFeedTotalSections(payload.facets?.totalSections ?? 0);
        setFeedTotalChunks(payload.facets?.totalChunks ?? 0);
        setFeedFilterCounts(payload.facets?.filters ?? {});
        setFeedCoverage(payload.facets?.coverage ?? []);
        setFeedVisibility(payload.facets?.visibility ?? null);
        setFeedGeneratedAt(payload.generatedAt ?? "");
        setFeedNextCursor(payload.nextCursor ?? null);
        setFeedStatus("ready");
        setFeedError("");
        if (input.scope === "thai_and_global") {
          setGlobalDiscovery(globalResult.response
            ? { phase: "ready", query: input.query, response: globalResult.response, error: "" }
            : { phase: "error", query: input.query, response: null, error: globalResult.error });
        } else {
          setGlobalDiscovery({ phase: "idle", query: input.query, response: null, error: "" });
        }
        closePaperDetail();
        setAppView("explore");
        setStatusText(`WebMCP found ${cards.length} visible Thai research records${globalResult.response ? " and added global discovery" : ""}.`);
        trackProductEvent("explore_search", {
          queryLength: input.query.length,
          resultCount: cards.length,
          filter: "webmcp",
          collection: collection || "all",
        });
        recordActivationStep("search");
        recordWebMcpActivity(
          "discover_research",
          `${cards.length} Thai records${globalResult.response ? ` · ${globalResult.response.works.length} global metadata leads` : ""}`,
        );

        const citable = cards
          .filter((card) => card.citable === true && card.discoveryLayer !== "thai_discovery")
          .slice(0, 4);
        const metadataOnly = cards.filter((card) => card.citable !== true || card.discoveryLayer === "thai_discovery");
        return {
          ok: true,
          visibleView: "explore",
          query: input.query,
          thaiEvidence: citable.map((card) => ({
            source: card.source,
            title: boundedToolText(card.title, 140),
            collection: card.collection,
            pages: card.pageLabel,
            evidencePackets: card.evidenceCount,
            nativeReaderVerified: card.accessLevel === "full_text_licensed",
            thaiPublished: card.thaiPublished ?? card.provider !== "pmc_oa",
            thailandContext: card.thailandContext ?? null,
            visibilityState: card.visibility?.state ?? "not_audited",
          })),
          thaiDiscoveryRecords: metadataOnly.slice(0, 4).map((card) => ({
            source: card.source,
            title: boundedToolText(card.title, 140),
            provider: card.provider,
            doi: boundedToolText(card.doi, 180) || null,
            sourceUrl: boundedToolText(card.canonicalUrl, 220) || null,
            visibilityState: card.visibility?.state ?? "not_audited",
            visibilitySnapshotDate: card.visibility?.snapshotDate ?? null,
            thaiPublished: card.thaiPublished ?? card.provider !== "pmc_oa",
            thailandContext: card.thailandContext ?? null,
            citable: false,
          })),
          discoveryOnlyReturned: metadataOnly.length,
          globalMetadata: (globalResult.response?.works ?? []).slice(0, 3).map((work) => ({
            title: boundedToolText(work.title, 120),
            year: work.year,
            citedBy: work.citedByCount,
            url: boundedToolText(work.url, 180),
          })),
          evidenceBoundary: "Only page-linked Thai evidence is citable here. Rights-verified ThaiJO reader papers are evidence; unverified Thai catalog records and OpenAlex leads remain discovery metadata.",
        };
      },
      auditGlobalVisibility: async (input, signal) => {
        const payload = await fetchJson<{ receipt: VisibilityReceipt }>(
          `/api/visibility?source=${encodeURIComponent(input.source)}`,
          { signal },
        );
        if (signal.aborted) throw new DOMException("The visibility audit read was cancelled.", "AbortError");
        const receipt = payload.receipt;
        setFeedCards((current) => current.map((card) => card.source === input.source ? { ...card, visibility: receipt } : card));
        recordWebMcpActivity(
          "audit_global_visibility",
          `${boundedToolText(receipt.source, 100)} · ${visibilityReceiptCopy(receipt).label}`,
        );
        setStatusText(`Visibility receipt: ${visibilityReceiptCopy(receipt).label}.`);
        return {
          ok: true,
          source: receipt.source,
          provider: receipt.provider,
          comparedAgainst: receipt.externalIndex,
          state: receipt.state,
          matchBasis: receipt.matchBasis,
          snapshotDate: receipt.snapshotDate,
          checkedAt: receipt.checkedAt,
          externalWorkId: receipt.externalWorkId,
          externalUrl: receipt.externalUrl,
          confidence: receipt.confidence,
          metadataGaps: receipt.metadataGaps,
          requiresHumanReview: receipt.requiresHumanReview,
          claimBoundary: receipt.state === "not_found_in_audit"
            ? "No exact identity was found in this dated bounded audit. This is not a permanent absence claim."
            : receipt.state === "audit_unavailable"
              ? "The provider was unavailable, so no visibility claim is made."
              : receipt.state === "not_audited"
                ? "This work has not yet been included in a dated audit."
                : "This receipt reports identity visibility only; global metadata remains a comparison lead, not Thai evidence.",
          nextStep: "Open the Thai paper evidence, then trace verified relationships or continue with the Thai-local record alone.",
        };
      },
      inspectPaperEvidence: async (input, signal) => {
        const requestId = ++webMcpEvidenceRequestIdRef.current;
        invalidateResearchContext();
        const params = new URLSearchParams();
        if (input.evidenceId) params.set("evidence", input.evidenceId);
        if (input.page != null) params.set("page", String(input.page));
        webMcpEvidenceContextRef.current = null;
        setPaperDetailStatus("loading");
        setPaperDetailError("");
        try {
          const detail = await fetchJson<PaperDetailData>(
            `/api/papers/${encodeURIComponent(input.source)}${params.size ? `?${params.toString()}` : ""}`,
            { signal },
          );
          if (signal.aborted || webMcpEvidenceRequestIdRef.current !== requestId) {
            throw new DOMException("The evidence request was cancelled or superseded.", "AbortError");
          }
          if (detail.document.citable !== true || detail.document.discoveryLayer === "thai_discovery") {
            throw new Error("This record is discovery-only and cannot be returned as exact-page evidence.");
          }
          if (!detail.evidence.length) {
            throw new Error("This paper has no verified page-linked evidence packets to inspect.");
          }
          const highlighted = detail.evidence.find((item) => item.id === input.evidenceId)
            ?? detail.evidence.find((item) => input.page != null && item.pageStart != null && item.pageEnd != null && input.page >= item.pageStart && input.page <= item.pageEnd)
            ?? detail.evidence[0]
            ?? null;
          const visibleEvidence = highlighted
            ? [highlighted, ...detail.evidence.filter((item) => item.id !== highlighted.id)].slice(0, 8)
            : detail.evidence.slice(0, 8);
          const expectedReaderPage = highlighted?.readerPageNumber ?? null;
          const readerPayload = await fetchJson<PaperReaderAccessPayload>(
            `/api/papers/${encodeURIComponent(input.source)}/reader?page=${expectedReaderPage ?? 1}&limit=1`,
            { signal },
          ).catch(() => null);
          if (signal.aborted || webMcpEvidenceRequestIdRef.current !== requestId) {
            throw new DOMException("The evidence request was cancelled or superseded.", "AbortError");
          }
          const readerAccess = summarizePaperReaderAccess(
            readerPayload,
            detail.document.source,
            expectedReaderPage ?? -1,
          );
          const enrichedDetail = { ...detail, readerAccess };
          const target: CivilEvidenceItem | null = highlighted ? {
            evidenceId: "WEBMCP",
            citation: `${detail.document.paperCode || detail.document.title} · ${highlighted.pageStart == null ? "page unavailable" : highlighted.pageStart === highlighted.pageEnd ? `p.${highlighted.pageStart}` : `p.${highlighted.pageStart}-${highlighted.pageEnd}`}`,
            source: detail.document.source,
            id: highlighted.id,
            documentId: detail.document.id,
            sectionIndex: highlighted.sectionIndex,
            chunkIndex: highlighted.chunkIndex,
            pageStart: highlighted.pageStart,
            pageEnd: highlighted.pageEnd,
            sectionTitle: highlighted.sectionTitle ?? undefined,
            snippet: highlighted.snippet,
          } : null;
          webMcpEvidenceContextRef.current = { ...enrichedDetail, evidence: visibleEvidence };
          setPaperDetail(enrichedDetail);
          setPaperDetailStatus("ready");
          setPaperEvidenceTarget(target);
          setAppView("explore");
          setStatusText("WebMCP opened the paper evidence for human verification.");
          const url = new URL(window.location.href);
          url.searchParams.set("paper", detail.document.source);
          if (target?.id) url.searchParams.set("evidence", target.id);
          if (target?.pageStart != null) url.searchParams.set("page", String(target.pageStart));
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
          trackProductEvent("evidence_open", {
            source: detail.document.source,
            evidenceId: target?.id ?? "webmcp",
            page: target?.pageStart ?? null,
          });
          recordActivationStep("verify");
          recordWebMcpActivity(
            "inspect_paper_evidence",
            `${detail.document.paperCode || detail.document.source} · ${highlighted ? passportEvidencePage(highlighted) : "evidence opened"}`,
          );
          if (paperLanguageRef.current === "en") void translatePapersToEnglish([{ card: detail.document, detail }]);

          return {
            ok: true,
            visibleView: "paper_evidence_drawer",
            paper: {
              source: detail.document.source,
              title: boundedToolText(detail.document.title, 180),
              collection: detail.document.collection,
              pageCoverage: detail.document.pageLabel,
              citable: true,
            },
            evidence: visibleEvidence.slice(0, 3).map((item) => ({
              id: item.id,
              page: item.pageStart == null ? "unavailable" : item.pageStart === item.pageEnd ? `p.${item.pageStart}` : `p.${item.pageStart}-${item.pageEnd}`,
              section: boundedToolText(item.sectionTitle, 80),
              excerpt: boundedToolText(item.snippet, 220),
            })),
            readerAccess,
            nextHumanStep: "Inspect the highlighted original page before relying on or exporting a claim.",
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "The paper evidence could not be loaded.";
          if (webMcpEvidenceRequestIdRef.current === requestId) {
            setPaperDetailStatus("error");
            setPaperDetailError(message);
          }
          throw new Error(message);
        }
      },
      traceResearchConnections: async (input, signal) => {
        const activeDetail = webMcpEvidenceContextRef.current;
        if (!activeDetail || activeDetail.document.source !== input.source) {
          throw new Error("Open this paper and its evidence before tracing global research connections.");
        }
        if (activeDetail.document.citable !== true || activeDetail.document.discoveryLayer === "thai_discovery") {
          throw new Error("Discovery-only records cannot anchor a Thai-to-global research connection trace.");
        }
        const map = await loadCitationMapForPaper(activeDetail.document, signal);
        const traceable = isTraceableOpenAlexMatch(map.match);
        const relations = traceable ? map.nodes : [];
        const relationCounts = relations.reduce<Record<string, number>>((counts, node) => {
          counts[node.relation] = (counts[node.relation] ?? 0) + 1;
          return counts;
        }, {});
        recordWebMcpActivity(
          "trace_research_connections",
          `${map.match.status} ${map.match.basis} match · ${relations.length} metadata-only relations`,
        );
        setStatusText(
          traceable
            ? `SeedyMCP traced ${relations.length} global research relationships. They remain metadata-only leads.`
            : map.status !== "connected"
              ? "OpenAlex is temporarily unavailable. SeedyMCP makes no identity or visibility claim."
            : map.match.status === "candidate"
              ? "SeedyMCP found a candidate OpenAlex match. Human confirmation is required before tracing relationships."
              : "SeedyMCP found no safe exact match in this lookup; this is not a permanent absence claim.",
        );
        return {
          ok: true,
          visibleView: "paper_connection_map",
          thaiPaper: {
            source: activeDetail.document.source,
            title: boundedToolText(activeDetail.document.title, 180),
            citable: true,
          },
          match: map.match,
          seed: traceable && map.seed ? {
            id: map.seed.id,
            title: boundedToolText(map.seed.title, 160),
            year: map.seed.year,
            topic: boundedToolText(map.seed.topic, 100) || null,
            authors: (map.seed.authors ?? []).slice(0, 3).map((name) => boundedToolText(name, 100)),
            institutions: (map.seed.institutions ?? []).slice(0, 3).map((name) => boundedToolText(name, 120)),
            citable: false,
          } : null,
          relationCounts: {
            cites: relationCounts.cites ?? 0,
            citedBy: relationCounts.cited_by ?? 0,
            related: relationCounts.related ?? 0,
          },
          relations: relations.map((node) => ({
            id: node.id,
            title: boundedToolText(node.title, 150),
            year: node.year,
            relation: node.relation,
            topic: boundedToolText(node.topic, 100) || null,
            url: boundedToolText(node.url, 220),
            citable: false,
          })),
          evidenceBoundary: "OpenAlex relationships are metadata-only Global Research Leads. They are not evidence until the underlying sources are separately opened and reviewed.",
          providerStatus: map.status,
          nextHumanStep: traceable
            ? "Review the visible relationship map, then carry selected leads into a Research Path as comparison targets—not as evidence."
            : map.status !== "connected"
              ? "Retry later or continue with the Thai-local evidence without a global identity claim."
              : "Review the candidate in OpenAlex or continue without a global relationship claim.",
        };
      },
      draftResearchPassport: async (input, signal) => {
        if (input.source.startsWith("private:")) {
          throw new Error("Private paper sources cannot be included in a public Research Passport.");
        }
        const activeDetail = webMcpEvidenceContextRef.current;
        if (!activeDetail || activeDetail.document.source !== input.source) {
          throw new Error("Open this paper and its evidence before drafting its Research Passport.");
        }
        if (activeDetail.document.citable !== true || activeDetail.document.discoveryLayer === "thai_discovery") {
          throw new Error("Discovery-only records cannot be used as Research Passport evidence.");
        }
        const evidenceById = new Map(activeDetail.evidence.map((item) => [item.id, item]));
        const selectedEvidence = input.evidenceIds.map((id) => evidenceById.get(id));
        if (selectedEvidence.some((item) => !item)) {
          throw new Error("Every evidenceId must be visible in the active paper.");
        }
        const exactEvidence = selectedEvidence.filter((item): item is PaperDetailData["evidence"][number] => Boolean(item));
        if (exactEvidence.some((item) => item.pageStart == null || item.pageEnd == null)) {
          throw new Error("Research Passport evidence must resolve to original source pages.");
        }

        const requestId = ++researchPassportRequestIdRef.current;
        const contextRevision = researchContextRevisionRef.current;
        const fallbackSearchUrl = `https://openalex.org/works?search=${encodeURIComponent(input.focus)}`;
        const loadingPassport: ResearchPassportState = { phase: "loading", artifact: null, error: "" };
        researchPassportRef.current = loadingPassport;
        setResearchPassport(loadingPassport);
        closePaperDetail();
        setAppView("explore");
        try {
          const thaiEvidence = exactEvidence.filter((item) => THAI_TEXT_PATTERN.test(item.snippet));
          const translationRequest = thaiEvidence.length
            ? fetchJson<PaperTranslationResponse>("/api/paper-translation", {
                method: "POST",
                signal,
                body: JSON.stringify({
                  targetLanguage: "en",
                  segments: thaiEvidence.map((item, index) => ({ id: `passport-${index}`, text: item.snippet })),
                }),
              }).catch((error: unknown) => {
                if (signal.aborted) throw error;
                return null;
              })
            : Promise.resolve(null);
          const translationResponse = await translationRequest;
          if (
            signal.aborted
            || researchPassportRequestIdRef.current !== requestId
            || researchContextRevisionRef.current !== contextRevision
          ) {
            throw new DOMException("The Research Passport draft was cancelled because the research context changed.", "AbortError");
          }
          const createdAt = new Date().toISOString();
          const candidateGapCopy = passportGapCopy(input.focus, input.gapLens);
          const connectionResponse = citationMapSourceRef.current === activeDetail.document.source
            ? citationMapRef.current.response
            : null;
          const globalWorks = tracedGlobalWorks(connectionResponse);
          const englishByRequestId = new Map(translationResponse?.translations.map((item) => [item.id, item.text.trim()]) ?? []);
          const englishByEvidenceId = new Map(
            thaiEvidence.map((item, index) => [item.id, englishByRequestId.get(`passport-${index}`) || null]),
          );
          const passportEvidence: ResearchPassportEvidence[] = exactEvidence.map((item) => ({
            ...item,
            englishSnippet: englishByEvidenceId.get(item.id) ?? null,
          }));
          const translationStatus: ResearchPassportArtifact["translationStatus"] = thaiEvidence.length
            ? thaiEvidence.every((item) => Boolean(englishByEvidenceId.get(item.id))) ? "ready" : "unavailable"
            : "not_needed";
          const priorRunSteps = webMcpActivityRef.current;
          const latestInspect = [...priorRunSteps].reverse().find((item) => item.tool === "inspect_paper_evidence");
          const latestDiscover = [...priorRunSteps].reverse().find((item) => item.tool === "discover_research");
          const latestVisibilityAudit = [...priorRunSteps].reverse().find((item) => item.tool === "audit_global_visibility");
          const latestConnectionTrace = [...priorRunSteps].reverse().find((item) => item.tool === "trace_research_connections");
          const draftStep = recordWebMcpActivity(
            "draft_research_passport",
            `${exactEvidence.length} exact-page anchors · ${globalWorks.length} metadata-only leads · claim review pending`,
          );
          const artifact: ResearchPassportArtifact = {
            version: "seed-research-passport-v1",
            passportId: `SR-${Date.now().toString(36).toUpperCase()}-${requestId}`,
            createdAt,
            reviewedAt: null,
            stale: false,
            openedEvidenceIds: [],
            reviewDecisions: {},
            runSteps: [latestDiscover, latestVisibilityAudit, latestInspect, latestConnectionTrace, draftStep].filter((item): item is WebMcpActivity => Boolean(item)),
            translationStatus,
            focus: input.focus,
            gapLens: input.gapLens,
            paper: activeDetail.document,
            evidence: passportEvidence,
            globalStatus: connectionResponse?.status ?? "disabled",
            globalSearchUrl: connectionResponse?.searchUrl || fallbackSearchUrl,
            globalWorks,
            candidateGap: {
              ...candidateGapCopy,
              localBasisEvidenceIds: exactEvidence.map((item) => item.id),
              relationValidated: false,
            },
          };
          const readyPassport: ResearchPassportState = { phase: "ready", artifact, error: "" };
          researchPassportRef.current = readyPassport;
          setResearchPassport(readyPassport);
          setStatusText("WebMCP drafted a Research Passport. Open every exact page, then accept or reject each evidence claim before exporting.");

          return {
            ok: true,
            visibleArtifact: "research_passport",
            version: artifact.version,
            passportId: artifact.passportId,
            thaiPaper: {
              source: artifact.paper.source,
              title: boundedToolText(artifact.paper.title, 160),
              collection: artifact.paper.collection,
              citable: true,
            },
            pageLinkedThaiEvidence: artifact.evidence.map((item) => ({
              id: item.id,
              page: passportEvidencePage(item),
              section: boundedToolText(item.sectionTitle, 70),
              excerptOriginal: boundedToolText(item.snippet, 180),
              excerptEnglish: boundedToolText(item.englishSnippet, 180) || null,
            })),
            translationStatus: artifact.translationStatus,
            globalLeads: artifact.globalWorks.map((work) => ({
              title: boundedToolText(work.title, 110),
              year: work.year,
              url: boundedToolText(work.url, 180),
              citable: false,
            })),
            globalStatus: artifact.globalStatus,
            globalLeadBasis: artifact.globalWorks.length ? "verified DOI relationship trace" : "no verified relationship carried",
            candidateGap: {
              lens: input.gapLens,
              status: "unsupported_candidate",
              reviewRequired: true,
              evidenceRelationValidated: false,
              localBasisEvidenceIds: artifact.candidateGap.localBasisEvidenceIds,
              nextVerificationQuery: candidateGapCopy.nextVerificationQuery,
            },
            boundary: "Thai page-linked packets are evidence. Only OpenAlex nodes from the active exact-DOI relationship trace are carried as metadata-only leads. Topical search results are excluded. Novelty and transferability are not established.",
            nextHumanStep: "Open every exact page, accept or reject each evidence claim, then export the accepted evidence. The candidate inference remains unvalidated.",
          };
        } catch (error) {
          if (researchPassportRequestIdRef.current === requestId) {
            const message = error instanceof Error ? error.message : "The Research Passport could not be drafted.";
            const errorPassport: ResearchPassportState = { phase: "error", artifact: null, error: message };
            researchPassportRef.current = errorPassport;
            setResearchPassport(errorPassport);
            throw new Error(message);
          }
          throw error;
        }
      },
      buildResearchPath: async (input, signal) => {
        const collection: CollectionFilter = input.collection === "all" ? "" : input.collection;
        const activePassport = researchPassportRef.current.artifact;
        const passportRequested = Boolean(input.passportId);
        if (passportRequested) {
          const evidenceIds = activePassport?.evidence.map((item) => item.id) ?? [];
          if (
            researchPassportRef.current.phase !== "ready"
            || !activePassport
            || activePassport.stale
            || !activePassport.reviewedAt
            || input.passportId !== activePassport.passportId
            || input.source !== activePassport.paper.source
            || input.gapLens !== activePassport.gapLens
            || input.evidenceIds.length !== evidenceIds.length
            || input.evidenceIds.some((id) => !evidenceIds.includes(id))
          ) {
            throw new Error("Open and page-review the active Research Passport before carrying it into a Research Path.");
          }
        }
        const connectionResponse = citationMapRef.current.phase === "ready" ? citationMapRef.current.response : null;
        const connectionTraceable = isTraceableOpenAlexMatch(connectionResponse?.match);
        const selectedConnectionLeads = input.globalLeadIds.map((id) => connectionResponse?.nodes.find((node) => node.id === id)).filter((node): node is CitationMapResponse["nodes"][number] => Boolean(node));
        const selectedPassportLeads = passportRequested && activePassport
          ? input.globalLeadIds.flatMap((id) => {
              const lead = activePassport.globalWorks.find((work) => work.id === id);
              return lead ? [{ id: lead.id, title: lead.title, year: lead.year, relation: "related" as const, topic: lead.topic ?? null, citable: false as const }] : [];
            })
          : [];
        const selectedGlobalLeads = selectedConnectionLeads.length === input.globalLeadIds.length ? selectedConnectionLeads : selectedPassportLeads;
        if (input.globalLeadIds.length && selectedGlobalLeads.length !== input.globalLeadIds.length) {
          throw new Error("Trace and review the active paper connections before carrying these global leads into a Research Path.");
        }
        const requestId = ++pathBuildRequestIdRef.current;
        setPathGoal(input.goal);
        setPathLevel(input.level);
        setPathOutcome(input.outcome);
        setSelectedCollection(collection);
        setResearchPathStatus("loading");
        setResearchPathError("");
        closePaperDetail();
        setAppView("path");
        try {
          const path = await fetchJson<ResearchPath>("/api/research-path", {
            method: "POST",
            signal,
            body: JSON.stringify({
              goal: input.goal,
              level: input.level,
              outcome: input.outcome,
              collection,
              knowledgeGaps: [...input.knowledgeGaps, ...(passportRequested && activePassport ? [activePassport.candidateGap.missingValidation] : [])].slice(0, 4),
              globalLeads: selectedGlobalLeads.map((lead) => ({
                id: lead.id,
                title: lead.title,
                year: lead.year,
                relation: lead.relation,
                topic: lead.topic ?? null,
                citable: false,
              })),
              passportContext: passportRequested && activePassport?.reviewedAt ? {
                passportId: activePassport.passportId,
                source: activePassport.paper.source,
                evidenceIds: activePassport.evidence.map((item) => item.id),
                gapLens: activePassport.gapLens,
                reviewedAt: activePassport.reviewedAt,
                globalLeadIds: selectedGlobalLeads.map((lead) => lead.id),
              } : null,
            }),
          });
          if (!isResearchPath(path)) throw new Error("Seedy Research returned an invalid research path.");
          if (signal.aborted || pathBuildRequestIdRef.current !== requestId) {
            throw new DOMException("The Research Path build was cancelled.", "AbortError");
          }
          const enrichedPath: ResearchPath = selectedConnectionLeads.length && connectionResponse && connectionTraceable ? {
            ...path,
            globalConnections: {
              match: connectionResponse.match,
              source: citationMapSourceRef.current,
              evidenceBoundary: "OpenAlex relationships are metadata-only Global Research Leads and are not used as Research Path evidence.",
              leads: selectedConnectionLeads,
            },
          } : path;
          setResearchPath(enrichedPath);
          setCompletedPathStages([]);
          setPathStageMastery({});
          setPathCheckpointAnswers({});
          setPathCheckpointAssessments({});
          setResearchPathStatus("ready");
          setStatusText(passportRequested
            ? "WebMCP carried the page-reviewed Research Passport into the visible Research Path."
            : input.knowledgeGaps.length
              ? "WebMCP adapted the visible Research Path around the reviewed gaps."
              : "WebMCP built a visible Research Path for the learner to review.");
          trackProductEvent("research_path_created", {
            level: enrichedPath.level,
            outcome: enrichedPath.outcome,
            paperCount: enrichedPath.stages.reduce((count, stage) => count + stage.papers.length, 0),
            collection: collection || "all",
          });
          persistResearchCasePathReady(enrichedPath, Boolean(passportRequested && activePassport?.reviewedAt));
          if (input.knowledgeGaps.length) trackProductEvent("path_adapted", { gapCount: input.knowledgeGaps.length, completedStages: 0 });
          recordWebMcpActivity("build_research_path", `${enrichedPath.stages.length} stages · ${enrichedPath.coverage?.paperCount ?? 0} matching papers · ${selectedGlobalLeads.length} global leads`);

          return {
            ok: true,
            visibleView: "research_path",
            goal: enrichedPath.goal,
            planningMode: enrichedPath.planningMode,
            coverage: enrichedPath.coverage,
            passportContext: enrichedPath.passportContext ? {
              passportId: enrichedPath.passportContext.passportId,
              source: enrichedPath.passportContext.source,
              evidenceIds: enrichedPath.passportContext.evidenceIds,
              gapLens: enrichedPath.passportContext.gapLens,
              reviewedAt: enrichedPath.passportContext.reviewedAt,
            } : null,
            adaptedFromGaps: enrichedPath.adaptedFromGaps ?? input.knowledgeGaps,
            candidateGap: enrichedPath.candidateGap,
            nextStudyProtocol: enrichedPath.nextStudyProtocol,
            stages: enrichedPath.stages.map((stage) => ({
              id: stage.id,
              title: stage.title,
              objective: boundedToolText(stage.objective, 150),
              papers: stage.papers.map((paper) => boundedToolText(paper.title, 100)),
            })),
            globalConnections: enrichedPath.globalConnections ? {
              match: enrichedPath.globalConnections.match,
              leads: enrichedPath.globalConnections.leads.map((lead) => ({
                id: lead.id,
                title: boundedToolText(lead.title, 140),
                year: lead.year,
                relation: lead.relation,
                url: boundedToolText(lead.url, 220),
                citable: false,
              })),
              evidenceBoundary: enrichedPath.globalConnections.evidenceBoundary,
            } : null,
            nextHumanStep: "Open a stage paper, answer its checkpoint in your own words, then ask the agent to inspect learning progress.",
          };
        } catch (error) {
          if (pathBuildRequestIdRef.current === requestId) setResearchPathStatus("error");
          const message = error instanceof Error ? error.message : "The Research Path could not be built.";
          setResearchPathError(message);
          throw new Error(message);
        }
      },
      inspectLearningProgress: async (signal) => {
        if (signal.aborted) throw new DOMException("The progress inspection was cancelled.", "AbortError");
        if (!researchPath) {
          recordWebMcpActivity("inspect_learning_progress", "No active Research Path");
          return {
            ok: true,
            state: "no_path",
            visibleView: activeMobileNav,
            nextStep: "Use build_research_path to create a four-stage evidence-backed path.",
          };
        }
        const gaps = researchPath.stages.flatMap((stage) => pathCheckpointAssessments[stage.id]?.gaps ?? []).slice(0, 4);
        recordWebMcpActivity("inspect_learning_progress", `${completedPathStages.length}/${researchPath.stages.length} stages mastered · ${gaps.length} reviewed gaps`);
        return {
          ok: true,
          state: completedPathStages.length === researchPath.stages.length ? "complete" : "in_progress",
          goal: researchPath.goal,
          masteredStages: completedPathStages.length,
          totalStages: researchPath.stages.length,
          gaps: gaps.map((gap) => boundedToolText(gap, 160)),
          stages: researchPath.stages.map((stage) => ({
            id: stage.id,
            title: stage.title,
            status: pathStageMastery[stage.id] ?? "not_assessed",
            score: pathCheckpointAssessments[stage.id]?.gradeAvailable === false ? null : pathCheckpointAssessments[stage.id]?.score ?? null,
            evidenceReviewed: pathCheckpointAssessments[stage.id]?.evidence.length ?? 0,
          })),
          privacy: "Learner free-text answers are intentionally omitted.",
          nextStep: gaps.length ? "Adapt the path with these reviewed gaps." : "Ask the learner to complete the next checkpoint in the visible page.",
        };
      },
    };
  });

  useEffect(() => {
    let active = true;
    let registration: AbortController | null = null;
    setWebMcpStatus("checking");
    const proxy: SeedResearchWebMcpHandlers = {
      startResearchCase: (input, signal) => {
        if (!webMcpHandlersRef.current) throw new Error("Seedy Research is still preparing its site tools.");
        return webMcpHandlersRef.current.startResearchCase(input, signal);
      },
      discoverResearch: (input, signal) => {
        if (!webMcpHandlersRef.current) throw new Error("Seedy Research is still preparing its site tools.");
        return webMcpHandlersRef.current.discoverResearch(input, signal);
      },
      auditGlobalVisibility: (input, signal) => {
        if (!webMcpHandlersRef.current) throw new Error("Seedy Research is still preparing its site tools.");
        return webMcpHandlersRef.current.auditGlobalVisibility(input, signal);
      },
      inspectPaperEvidence: (input, signal) => {
        if (!webMcpHandlersRef.current) throw new Error("Seedy Research is still preparing its site tools.");
        return webMcpHandlersRef.current.inspectPaperEvidence(input, signal);
      },
      traceResearchConnections: (input, signal) => {
        if (!webMcpHandlersRef.current) throw new Error("SeedyMCP is still preparing its site tools.");
        return webMcpHandlersRef.current.traceResearchConnections(input, signal);
      },
      draftResearchPassport: (input, signal) => {
        if (!webMcpHandlersRef.current) throw new Error("Seedy Research is still preparing its site tools.");
        return webMcpHandlersRef.current.draftResearchPassport(input, signal);
      },
      buildResearchPath: (input, signal) => {
        if (!webMcpHandlersRef.current) throw new Error("Seedy Research is still preparing its site tools.");
        return webMcpHandlersRef.current.buildResearchPath(input, signal);
      },
      inspectLearningProgress: (signal) => {
        if (!webMcpHandlersRef.current) throw new Error("Seedy Research is still preparing its site tools.");
        return webMcpHandlersRef.current.inspectLearningProgress(signal);
      },
    };
    void registerSeedResearchWebMcpTools(proxy)
      .then((controller) => {
        if (!active) {
          controller?.abort();
          return;
        }
        registration = controller;
        setWebMcpStatus(controller ? "ready" : "unsupported");
      })
      .catch((error) => {
        if (!active) return;
        console.warn("seed_research_webmcp_registration_failed", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        setWebMcpStatus("error");
      });
    return () => {
      active = false;
      registration?.abort();
    };
  }, []);

  const selectExperience = (experience: ChatExperience) => {
    setSelectedExperience(experience);
  };

  const navigateApp = (item: MobileNavItem) => {
    navigationTouchedRef.current = true;
    const access = CIVILMCP_FEATURE_ACCESS[item];
    if (!access.enabled) {
      setStatusText(`${access.label} is not enabled in this demo environment.`);
      return;
    }
    if (!CIVILMCP_OPEN_ACCESS && access.requiresAuth && !isAuthenticated) {
      setPendingFeature(item);
      setAuthMode("signin");
      try {
        window.sessionStorage.setItem(AUTH_RETURN_FEATURE_KEY, item);
      } catch {}
      setStatusText(`Sign in to use ${access.label}.`);
      setAppView("settings");
      return;
    }
    setPendingFeature(null);
    setAppView(item);
    if (item === "explore") {
      setStatusText("");
    } else if (item === "chat") {
      setStatusText("");
    } else if (item === "path") {
      setStatusText("");
    } else if (item === "workspace") {
      setStatusText("");
    } else if (item === "history") {
      void refreshChatSessions(true);
      setStatusText("");
    } else if (item === "shared") {
      setStatusText("");
    } else {
      setStatusText("");
    }
  };

  const showComposer = activeMobileNav === "explore" || activeMobileNav === "chat";

  return (
    <div>
      <AppShell
        mainRailRef={mainRailRef}
        syncState={syncState}
        syncLabel={syncLabel}
        authenticated={isAuthenticated}
        activeMobileNav={activeMobileNav}
        setActiveMobileNav={navigateApp}
        onNavigate={navigateApp}
      >
        <div className="mobileBrandStrip" aria-label="SEEDY status">
          <span className="mobileBrandName">SEEDY</span>
          <span className="brandBadge">Seedy Research</span>
        </div>
        {showComposer ? (
          <section className="searchStage">
            <h1>
              {activeMobileNav === "explore"
                ? "Start a Thai-to-global Research Case."
                : "Research with sources."}
            </h1>
            {activeMobileNav === "explore" ? (
              <>
                <p className="searchLead">
                  {feedCitableTotal
                    ? `Turn research published in Thailand—especially work global indexes represent incompletely—into page-verifiable evidence, global connections, and a reviewable next study.`
                    : "Start with a real question, preserve sparse results honestly, and carry reviewed exact-page evidence into a bounded next-study decision."}
                </p>
                <div className="corpusProof" aria-label="Non-overlapping Seedy Research corpus scoreboard">
                  <span><strong>{feedThaiPublishedDiscoveryTotal ? feedThaiPublishedDiscoveryTotal.toLocaleString("en-US") : "—"}</strong> Thai-published discovery records</span>
                  <span><strong>{feedThaiNativeFullPaperTotal ? feedThaiNativeFullPaperTotal.toLocaleString("en-US") : "—"}</strong> Thai-published native full papers</span>
                  <span><strong>{feedThaiPublishedPageCitableTotal ? feedThaiPublishedPageCitableTotal.toLocaleString("en-US") : "—"}</strong> Thai-published page-citable papers</span>
                  <span><strong>{feedGlobalComparisonTotal ? feedGlobalComparisonTotal.toLocaleString("en-US") : "—"}</strong> Thai-affiliated global comparisons</span>
                  <span><strong>{feedVisibility?.audited ? feedVisibility.audited.toLocaleString("en-US") : "—"}</strong> visibility-audited works</span>
                  <span><strong>{completedResearchCaseCount.toLocaleString("en-US")}</strong> completed Research Cases</span>
                </div>
                <p className="corpusContext">Published in Thailand · Context, language, and affiliation remain separate facets</p>
                {webMcpStatus === "ready" ? (
                  <p className="webMcpStatus" role="status" aria-label="WebMCP site tools ready">
                    <span aria-hidden />
                    SeedyMCP active · 8 site tools · shared human-agent case
                  </p>
                ) : null}
              </>
            ) : null}
            <SearchComposer
              draft={draft}
              setDraft={setDraft}
              activeNav={activeMobileNav}
              onSubmit={onSubmit}
              onKeyDown={onComposerKeyDown}
              useMcp={useMcp}
              experience={selectedExperience}
              setExperience={selectExperience}
              selectedModel={selectedModel}
              modelOptions={modelOptions}
              selectedCollection={selectedCollection}
              openDropdown={openDropdown}
              setOpenDropdown={setOpenDropdown}
              setSelectedModel={selectModel}
              setSelectedCollection={setSelectedCollection}
              copyShareLink={copyShareLink}
              exportSession={exportSession}
              exportEvidenceBrief={() => exportEvidenceBrief()}
              clearConversation={clearConversation}
              canExportEvidenceBrief={Boolean(latestMissionAnnotation)}
              isReady={isReady}
              isLoading={isLoading}
            />
            {activeMobileNav === "explore" ? (
              <div className="caseExamples" aria-label="Research Case examples">
                <span>Try an unscripted question</span>
                {[
                  "How should Thai universities test AI learning outcomes beyond novelty effects?",
                  "Which road-system factors should a Thai city validate before reducing severe crashes?",
                  "What validation gaps recur in biomedical research published in Thailand?",
                ].map((example) => <button type="button" key={example} onClick={() => setDraft(example)}>{example}</button>)}
              </div>
            ) : null}
            <p className="researchDisclaimer">For research use. Not professional advice.</p>
          </section>
        ) : null}

        {activeMobileNav === "explore" ? (
          <>
            <ResearchCasePanel
              researchCase={activeResearchCase}
              status={researchCaseStatus}
              error={researchCaseError}
              onOpenSource={(source) => {
                const card = [...feedCards, ...Object.values(bookmarkedCards)].find((item) => item.source === source);
                void openPaperDetailBySource(source, card);
              }}
              onStartNew={() => {
                setActiveResearchCase(null);
                setResearchCaseStatus("idle");
                setResearchCaseError("");
                setDraft("");
                setFeedQuery("");
                closePaperDetail();
              }}
            />
            <FilterBar
              activeFilter={activeFeedFilter}
              setActiveFilter={(filter) => {
                setActiveFeedProvider("");
                setActiveFeedFilter(filter);
              }}
              totalDocuments={feedTotal}
              savedCount={Object.keys(bookmarkedCards).length}
              filterCounts={feedFilterCounts}
              paperLanguage={paperLanguage}
              isTranslating={isPaperTranslationBusy}
              onPaperLanguageChange={changePaperLanguage}
              generatedAt={feedGeneratedAt}
              isRefreshing={feedStatus === "loading"}
              onRefresh={() => setFeedRefreshNonce((value) => value + 1)}
            />
            <DiscoveryTrustBar citableTotal={feedThaiPublishedPageCitableTotal} metadataOnlyTotal={feedMetadataOnlyTotal} />
          </>
        ) : null}

        {statusText && activeMobileNav !== "settings" ? (
          <p className="statusLine" role="status" aria-live="polite">
            {statusText}
          </p>
        ) : null}
        {chatSessionsStatus === "error" && activeMobileNav === "history" ? (
          <p className="statusLine error" role="alert">
            Synced history is temporarily unavailable. Please try again shortly.
          </p>
        ) : null}

        {activeMobileNav === "workspace" ? (
          <ResearchWorkspacePanel
            papers={workspacePapers}
            seedSources={workspaceSeedSources}
            authenticated={isAuthenticated}
            accessEnabled={billing.openAccess || (billing.plan === "founder_pro" && billing.premiumModels)}
            onUpgrade={(message) => {
              setStatusText(message);
              setAppView("settings");
            }}
            onOpenPaper={(source, target?: ResearchWorkspaceEvidenceTarget) => void openPaperDetailBySource(source, undefined, target ? {
              evidenceId: target.id,
              citation: `${source} · ${target.pageStart == null ? "page unavailable" : `p.${target.pageStart}${target.pageEnd != null && target.pageEnd !== target.pageStart ? `-${target.pageEnd}` : ""}`}`,
              source,
              id: target.id,
              pageStart: target.pageStart ?? undefined,
              pageEnd: target.pageEnd ?? undefined,
              sectionTitle: target.sectionTitle ?? undefined,
            } : null)}
            onPromoteNotebookFinding={(finding) => void promoteNotebookFinding(finding)}
            onContinueNotebookPath={(finding) => {
              setPathGoal(finding.question);
              setPathLevel("research");
              setPathOutcome("study_plan");
              setAppView("path");
              void buildResearchPath([boundedToolText(finding.answer, 180)], false, null, finding.question);
            }}
          />
        ) : activeMobileNav === "path" ? (
          <PersonalizedResearchPathPanel
            goal={pathGoal}
            setGoal={setPathGoal}
            level={pathLevel}
            setLevel={setPathLevel}
            outcome={pathOutcome}
            setOutcome={setPathOutcome}
            path={researchPath}
            status={researchPathStatus}
            error={researchPathError}
            completedStages={completedPathStages}
            stageMastery={pathStageMastery}
            checkpointAnswers={pathCheckpointAnswers}
            checkpointAssessments={pathCheckpointAssessments}
            assessingStageId={pathAssessingStageId}
            onBuild={() => void buildResearchPath()}
            onReset={resetResearchPath}
            onAnswerChange={updatePathCheckpointAnswer}
            onAssessCheckpoint={(stageId) => void assessPathCheckpoint(stageId)}
            onAdapt={adaptResearchPath}
            onExport={exportResearchPath}
            onOpenPaper={(source) => void openPaperDetailBySource(source)}
          />
        ) : activeMobileNav === "history" ? (
          <ChatHistoryPanel
            sessions={chatSessions}
            status={chatSessionsStatus}
            error={chatSessionsError}
            currentSessionId={currentSessionId}
            pendingDeleteSessionId={pendingDeleteSessionId}
            deletingSessionId={deletingSessionId}
            onNewChat={() => void createNewChat()}
            onOpenSession={(sessionId) => void openChatSession(sessionId)}
            onRequestDeleteSession={setPendingDeleteSessionId}
            onCancelDeleteSession={() => setPendingDeleteSessionId(null)}
            onConfirmDeleteSession={(sessionId) => void deleteChatSession(sessionId)}
          />
        ) : activeMobileNav === "settings" ? (
          <AccountPanel
            user={userProfile}
            authenticated={isAuthenticated}
            billing={billing}
            authMode={authMode}
            setAuthMode={changeAuthMode}
            statusText={statusText}
            displayName={loginName}
            email={loginEmail}
            password={loginPassword}
            passwordConfirm={loginPasswordConfirm}
            setDisplayName={setLoginName}
            setEmail={setLoginEmail}
            setPassword={setLoginPassword}
            setPasswordConfirm={setLoginPasswordConfirm}
            onAuthSubmit={() => void submitAuth()}
            onGoogle={() => void continueWithGoogle()}
            onForgotPassword={() => void sendPasswordRecovery()}
            onUpdatePassword={() => void updatePassword()}
            onProfileUpdate={() => void updateProfile()}
            onDeleteAccount={() => void deleteAccount()}
            onLogout={() => void logoutChat()}
            onCheckout={() => void openBilling("checkout")}
            onPortal={() => void openBilling("portal")}
            isBusy={authBusy}
            billingBusy={billingBusy}
          />
        ) : activeMobileNav === "shared" ? (
          <SharedPanel
            title={currentSessionTitle}
            messageCount={messages.length}
            shareUrl={shareUrl}
            isBusy={shareBusy}
            onCreateLink={() => void createShareLink(false)}
            onCopyLink={() => void copyShareLink()}
            onExport={exportSession}
          />
        ) : activeMobileNav === "explore" ? (
          <>
            <ResearchFeed
              cards={visibleCards}
              bookmarkedCards={bookmarkedCards}
              paperTranslations={paperTranslations}
              activeFilter={activeFeedFilter}
              status={feedStatus}
              error={feedError}
              query={feedQuery}
              hasMore={Boolean(feedNextCursor)}
              isLoadingMore={isFeedLoadingMore}
              onAsk={askPaper}
              onOpen={(card) => void openPaperDetail(card)}
              onToggleBookmark={toggleBookmark}
              workspaceSelection={workspaceSelection}
              onToggleWorkspace={toggleWorkspaceSelection}
              onCompareSelected={compareSelectedPapers}
              onClearWorkspaceSelection={() => setWorkspaceSelection([])}
              onRetry={() => setFeedRefreshNonce((value) => value + 1)}
              onLoadMore={() => void loadMoreFeed()}
              disabled={!isReady || !bookmarksReady || isLoading}
            />
            <ResearchPassportPanel
              enabled={webMcpStatus === "ready"}
              state={researchPassport}
              onOpenEvidence={openResearchPassportEvidence}
              onReviewEvidence={(item, decision) => void reviewResearchPassportEvidence(item, decision)}
              onMarkReviewed={markResearchPassportReviewed}
              onExport={exportResearchPassport}
              onClear={clearResearchPassport}
              onContinueToPath={(artifact) => {
                const reviewedArtifact = {
                  ...artifact,
                  evidence: artifact.evidence.filter((item) => artifact.reviewDecisions[item.id]?.decision === "accepted"),
                };
                setPathGoal(reviewedArtifact.focus);
                setPathLevel("research");
                setPathOutcome("study_plan");
                setSelectedCollection(reviewedArtifact.paper.collection);
                setAppView("path");
                void buildResearchPath([reviewedArtifact.candidateGap.missingValidation], false, reviewedArtifact);
              }}
            />
            <VisibilityAuditPanel summary={feedVisibility} />
            <CoverageLedger
              providers={feedCoverage}
              activeProvider={activeFeedProvider}
              onClearProvider={() => setActiveFeedProvider("")}
              onViewProvider={(provider) => {
                if (provider.filter === "tci_thaijo") {
                  setActiveFeedProvider(provider.provider);
                  setActiveFeedFilter("thai");
                } else if (provider.filter === "ncce" || provider.filter === "ce_project") {
                  setActiveFeedProvider("");
                  setActiveFeedFilter(provider.filter);
                }
              }}
            />
            <LivingReviewPanel
              authenticated={isAuthenticated}
              query={activeFeedFilter === "saved" ? "" : feedQuery}
              collection={selectedCollection}
              watches={livingReviewWatches}
              busyId={livingReviewBusyId}
              onWatch={() => void createLivingReview()}
              onCheck={(watchId) => void checkLivingReview(watchId)}
              onDelete={(watchId) => void deleteLivingReview(watchId)}
              onSignIn={() => setAppView("settings")}
            />
            {researchPassport.phase === "ready" ? null : (
              <GlobalDiscoveryPanel
                query={activeFeedFilter === "saved" ? "" : feedQuery}
                state={globalDiscovery}
                onExpand={() => void expandGlobalDiscovery()}
              />
            )}
          </>
        ) : (
          <ChatWorkspace
            messages={messages}
            sessionId={currentSessionId}
            title={currentSessionTitle}
            isLoading={isLoading}
            error={chatError}
            onNewChat={() => void createNewChat()}
            onAsk={(prompt) => void submitPrompt(prompt, undefined, "mcp", "learn")}
            onOpenEvidence={(item) => {
              trackProductEvent("evidence_open", {
                source: item.source,
                evidenceId: item.evidenceId,
                page: item.pageStart ?? null,
              });
              recordActivationStep("verify");
              void openPaperDetailBySource(item.source, undefined, item);
            }}
            onExportEvidenceBrief={exportEvidenceBrief}
          />
        )}
      </AppShell>
      <PaperDetailDrawer
        detail={paperDetail}
        status={paperDetailStatus}
        error={paperDetailError}
        citationMap={citationMap}
        translation={paperDetail ? paperTranslations[cardKey(paperDetail.document)] : undefined}
        paperLanguage={paperLanguage}
        highlightedEvidence={paperEvidenceTarget}
        bookmarked={paperDetail ? Boolean(bookmarkedCards[cardKey(paperDetail.document)]) : false}
        libraryItem={paperDetail ? workspaceItems[paperDetail.document.source] : undefined}
        onClose={closePaperDetail}
        onAsk={askPaper}
        onOpenRelated={(card) => void openPaperDetail(card)}
        onToggleBookmark={toggleBookmark}
        onSaveLibrary={saveLibraryDetails}
        onLoadCitationMap={() => {
          if (paperDetail?.document) void loadCitationMapForPaper(paperDetail.document).catch(() => undefined);
        }}
        onPaperLanguageChange={changePaperLanguage}
      />
    </div>
  );
}
