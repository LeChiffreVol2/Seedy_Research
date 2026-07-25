"use client";

import type { ButtonHTMLAttributes, FormEvent, KeyboardEvent, ReactNode, Ref } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "ai/react";
import type { UIMessage } from "ai";
import LiquidGlass from "liquid-glass-react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUp,
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
  History,
  Languages,
  Layers3,
  LockKeyhole,
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
  RefreshCw,
  Route,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  chatModelRequiresPro,
  isChatModel,
  type ChatModel,
} from "@/lib/chat-models";
import { ResearchWorkspacePanel, type ResearchWorkspacePaper } from "@/components/research-workspace";
import { GlassMenuSelect, type GlassMenuOption } from "@/components/glass-menu-select";

type Mode = "baseline" | "mcp";
type ChatExperience = "answer" | "mission" | "learn" | "research" | "automated";
type CollectionFilter = "" | "ce_project" | "ncce";
type SyncState = "loading" | "saving" | "saved" | "error";
type OpenDropdown = "experience" | "model" | "collection" | "actions" | "examples" | null;
type FeedFilter = "hot" | "for_you" | "recent" | "evidence" | "saved" | "tci" | "ncce" | "ce_project";
type MobileNavItem = "explore" | "workspace" | "path" | "chat" | "history" | "shared" | "settings";
type FeedStatus = "loading" | "ready" | "error";
type SessionsStatus = "idle" | "loading" | "ready" | "error";
type AuthMode = "signin" | "signup" | "magic-link" | "forgot-password" | "recovery";
type PaperLanguage = "th" | "en";

type CivilEvidenceItem = {
  evidenceId: string;
  citation: string;
  source: string;
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
  toolCalls?: number;
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
    providers?: Array<{ provider: string; records: number; citable: number }>;
    collections?: Array<{ collection: string; documents: number }>;
    filters?: Partial<Record<FeedFilter, number>>;
  };
  nextCursor?: string | null;
  generatedAt?: string;
};

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
  }>;
  counts: {
    sections: number;
    chunks: number;
  };
  related?: ResearchCardData[];
  generatedAt?: string;
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
  { value: "decision_brief", label: "Decision brief", description: "Synthesize evidence for action" },
];

type ResearchPath = {
  version: "civilmcp-research-path-v2";
  goal: string;
  level: PathLevel;
  outcome: PathOutcome;
  sourceCodes: string[];
  generatedAt: string;
  stages: Array<{
    id: string;
    title: string;
    objective: string;
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
    value: "mission",
    label: "Evidence Review",
    description: "Find, compare, and verify evidence across papers",
    badge: "Recommended",
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
    badge: "Pro",
  },
  { value: "answer", label: "Quick Answer", description: "Answer directly with page citations" },
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
  { id: "tci", label: "Thai journals", icon: Database },
  { id: "ncce", label: "NCCE", icon: Building2 },
  { id: "ce_project", label: "Student Transport", icon: Layers3 },
];

const MAIN_NAV_ITEMS: NavItem[] = [
  { id: "explore", label: "Explore", icon: Compass },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "workspace", label: "Workspace", icon: TableProperties },
  { id: "path", label: "Research Path", icon: Route },
  { id: "history", label: "History", icon: History },
  { id: "shared", label: "Shared", icon: Share2 },
  { id: "settings", label: "Settings", icon: Settings },
];

const MOBILE_NAV_ITEMS = MAIN_NAV_ITEMS.filter((item) => item.id !== "shared");

const ACTION_LABELS = {
  share: "Copy share link",
  export: "Export JSON",
  brief: "Export evidence brief",
  clear: "Clear chat",
} as const;

const THAI_TEXT_PATTERN = /[\u0E00-\u0E7F]/;
const TRANSLATION_CACHE_KEY = "civilmcp-paper-translations-v1";
const PAPER_LANGUAGE_KEY = "civilmcp-paper-language-v1";
const RESEARCH_PATH_KEY = "civilmcp-research-path-v2";
const TRANSLATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const TRANSLATION_CACHE_MAX_PAPERS = 30;
const TRANSLATION_BATCH_MAX_SEGMENTS = 48;
const TRANSLATION_BATCH_MAX_CHARS = 14_000;
const GUEST_BILLING_STATE: BillingState = {
  plan: "guest",
  status: "active",
  creditsIncluded: null,
  creditsUsed: null,
  creditsRemaining: null,
  resetAt: null,
  premiumModels: false,
  billingConfigured: false,
  priceThb: 199,
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
  for (const match of markdown.matchAll(/\[(E\d+)\]/g)) {
    ids.add(match[1]);
  }
  return [...ids].slice(0, 8);
}

function pageLabel(item: CivilEvidenceItem): string {
  if (item.pageStart == null || item.pageEnd == null) return "";
  return item.pageStart === item.pageEnd ? `p.${item.pageStart}` : `p.${item.pageStart}-${item.pageEnd}`;
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
      : ["- See the linked CivilMCP session for source packets and exact-page evidence."]),
    "",
    "_For research use. Not engineering advice._",
  ];
  return lines.join("\n");
}

function cardKey(card: ResearchCardData): string {
  return card.id || card.source;
}

function isResearchCardData(value: unknown): value is ResearchCardData {
  const card = value as Partial<ResearchCardData>;
  return Boolean(card && typeof card === "object" && typeof card.id === "string" && typeof card.title === "string" && typeof card.source === "string");
}

function isResearchPath(value: unknown): value is ResearchPath {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResearchPath>;
  return candidate.version === "civilmcp-research-path-v2" && typeof candidate.goal === "string" && Array.isArray(candidate.stages);
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

function ClientLiquidLayer({
  prominent = false,
  cornerRadius = 16,
  displacementScale = 28,
  blurAmount = 0.04,
  saturation = 126,
  aberrationIntensity = 1,
  elasticity = 0.16,
  className = "",
}: {
  prominent?: boolean;
  cornerRadius?: number;
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <LiquidGlass
      className={`liquidEffect ${className}`}
      mode={prominent ? "prominent" : "standard"}
      cornerRadius={cornerRadius}
      displacementScale={displacementScale}
      blurAmount={blurAmount}
      saturation={saturation}
      aberrationIntensity={aberrationIntensity}
      elasticity={elasticity}
      padding="0"
      style={{ position: "absolute", top: "50%", left: "50%", width: "100%", height: "100%" }}
    >
      <span className="liquidGhost" aria-hidden />
    </LiquidGlass>
  );
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

function EvidenceCards({
  annotation,
  markdown,
  onOpenEvidence,
}: {
  annotation: CivilMcpAnnotation | null;
  markdown: string;
  onOpenEvidence: (source: string) => void;
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
            onClick={() => onOpenEvidence(item.source)}
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
            {isAutomatedResearch ? "Pro · Automated Research" : isDeepResearch ? "Pro · Deep Research" : "Evidence Review"}
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
          CivilMCP summarizes older conversation context to preserve continuity while controlling context cost
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
  onOpenEvidence: (source: string) => void;
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
    throw new Error(text || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function AppSidebar({
  syncState,
  syncLabel,
  activeNav,
  authenticated,
  onExport,
  onShare,
  onNavigate,
}: {
  syncState: SyncState;
  syncLabel: string;
  activeNav: MobileNavItem;
  authenticated: boolean;
  onExport: () => void;
  onShare: () => void;
  onNavigate: (item: MobileNavItem) => void;
}) {
  return (
    <aside className="appSidebar" aria-label="CivilMCP navigation">
      <div className="sidebarTop">
        <div className="sidebarBrand">
          <img className="brandMark" src="/civilmcp-logo.svg" alt="" aria-hidden="true" />
          <div>
            <div className="brandTitleRow">
              <p className="brandName">CivilMCP</p>
              <span className="brandBadge">Research Preview</span>
            </div>
            <p className="brandSubline">Civil engineering evidence</p>
          </div>
        </div>

        <nav className="sidebarNav" aria-label="Primary">
          {MAIN_NAV_ITEMS.map((item) => {
            const isAccountItem = item.id === "settings";
            const Icon = isAccountItem ? (authenticated ? ShieldCheck : LockKeyhole) : item.icon;
            const label = isAccountItem ? (authenticated ? "Account" : "Sign in") : item.label;
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebarNavItem ${item.id === activeNav ? "selected" : ""}`}
                aria-label={isAccountItem ? label : undefined}
                aria-current={item.id === activeNav ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={21} strokeWidth={2.1} aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="sidebarBottom">
        <button type="button" className="sidebarUtility" onClick={onExport}>
          <Download size={19} strokeWidth={2.1} aria-hidden />
          <span>Export</span>
        </button>
        <button type="button" className="sidebarUtility" onClick={onShare}>
          <Share2 size={19} strokeWidth={2.1} aria-hidden />
          <span>Share</span>
        </button>
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
        const Icon = isAccountItem ? (authenticated ? ShieldCheck : LockKeyhole) : item.icon;
        const label = isAccountItem ? (authenticated ? "Account" : "Sign in") : item.label;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={selected ? "selected" : ""}
            aria-current={selected ? "page" : undefined}
            aria-label={isAccountItem ? label : undefined}
            onClick={() => setActive(item.id)}
          >
            <Icon size={19} strokeWidth={2.2} aria-hidden />
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
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
  const composerHint =
    activeNav === "explore"
      ? "Search filters papers. Enter asks a cited question."
      : "Ask a cited research question.";

  return (
    <form onSubmit={onSubmit} className="searchComposer">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={activeNav === "explore" ? "Search papers or ask a question" : "Ask about the evidence"}
        aria-label="Ask or search civil engineering papers"
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
        <span className="keyHint">⌘↵ to send</span>
        <GlassButton
          type="submit"
          className="sendButtonWrap"
          disabled={!isReady || isLoading || !draft.trim()}
          aria-label={isLoading ? "CivilMCP is answering" : "Send message"}
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
                : activeFilter === "tci"
                  ? `${(filterCounts.tci ?? 0).toLocaleString("en-US")} journal records`
                  : totalDocuments
                    ? `${totalDocuments.toLocaleString("en-US")} cited papers`
                    : "Live corpus"}
            </span>
            <small>{activeFilter === "saved" ? syncText : `updated ${syncText}`}</small>
          </div>
          {activeFilter === "saved" ? (
            <div className="refreshChipStatic" aria-label="Saved papers are kept in the CivilMCP library">
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
  disabled,
}: {
  card: ResearchCardData;
  bookmarked: boolean;
  translation?: PaperTranslationState;
  onAsk: (card: ResearchCardData) => void;
  onOpen: (card: ResearchCardData) => void;
  onToggleBookmark: (card: ResearchCardData) => void;
  disabled: boolean;
}) {
  const title = translatedPaperText(translation, "paper.title", displayTitle(card));
  const summary = translatedPaperText(translation, "paper.summary", displaySummary(card));
  const translated = Boolean(translation?.showingTranslation);
  const citable = card.citable !== false && card.evidenceStatus !== "metadata_only";
  const collectionLabel = card.collection === "ncce"
    ? "NCCE"
    : card.collection === "ce_project"
      ? "Student Transport"
      : card.provider === "tci_thaijo"
        ? "ThaiJO"
        : "All collections";
  const disciplineLabel = card.discipline?.trim();
  const pagesLabel = card.pageStart != null
    ? card.pageEnd === card.pageStart
      ? `p.${card.pageStart}`
      : `p.${card.pageStart}-${card.pageEnd}`
    : card.pages
      ? `${card.pages} pages`
      : "Indexed PDF";

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
          <span>{card.date}</span>
          <span>{collectionLabel}</span>
          {disciplineLabel ? <span>{disciplineLabel}</span> : null}
          {citable ? <span>{pagesLabel}</span> : null}
          <span className={citable ? "citableMeta" : "discoveryMeta"}>
            {citable ? `${card.evidenceCount} evidence` : "Discovery metadata"}
          </span>
          {translated ? <span className="translatedMeta">EN translation</span> : null}
        </div>
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
                onClick={() => onToggleBookmark(card)}
              >
                <Bookmark size={17} strokeWidth={2.2} aria-hidden />
                <span className="srOnly">{bookmarked ? "Saved" : "Save to library"}</span>
              </button>
              <button type="button" className="cardAction" onClick={() => onOpen(card)}>
                <Layers3 size={17} strokeWidth={2.2} aria-hidden />
                <span>Evidence</span>
                <strong>{card.evidenceCount}</strong>
              </button>
            </>
          ) : card.canonicalUrl ? (
            <a className="cardAction primary" href={card.canonicalUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} strokeWidth={2.2} aria-hidden />
              <span>Open publisher record</span>
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
          <strong>Metadata only</strong>
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
  onRetry: () => void;
  onLoadMore: () => void;
  disabled: boolean;
}) {
  const isSavedFilter = activeFilter === "saved";
  const savedCount = Object.keys(bookmarkedCards).length;

  if (status === "loading") {
    return (
      <section className="feedStack" aria-label="CivilMCP research feed loading" aria-busy="true">
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
      <section className="feedStack" aria-label="CivilMCP research feed error">
        <article className="feedStateCard" role="alert">
          <h2>Research feed unavailable</h2>
          <p>{error || "CivilMCP could not load the indexed paper collection."}</p>
          <button type="button" className="cardAction primary" onClick={onRetry}>
            Retry
          </button>
        </article>
      </section>
    );
  }

  if (!cards.length) {
    return (
      <section className="feedStack" aria-label="CivilMCP research feed empty">
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
    <section className="feedStack" aria-label="CivilMCP research feed">
      {cards.map((card) => (
        <ResearchCard
          key={card.id}
          card={card}
          bookmarked={Boolean(bookmarkedCards[cardKey(card)])}
          translation={paperTranslations[cardKey(card)]}
          onAsk={onAsk}
          onOpen={onOpen}
          onToggleBookmark={onToggleBookmark}
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
        `  note = {CivilMCP source: ${source}; page-linked evidence available},`,
        "}",
      ].filter(Boolean).join("\n")
    : [
        `TY  - ${card.collection === "ncce" ? "CPAPER" : "RPRT"}`,
        `TI  - ${title}`,
        year ? `PY  - ${year}` : "",
        `N1  - CivilMCP source: ${source}; page-linked evidence available`,
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
  translation,
  paperLanguage,
  bookmarked,
  libraryItem,
  onClose,
  onAsk,
  onOpenRelated,
  onToggleBookmark,
  onSaveLibrary,
  onPaperLanguageChange,
}: {
  detail: PaperDetailData | null;
  status: FeedStatus;
  error: string;
  translation?: PaperTranslationState;
  paperLanguage: PaperLanguage;
  bookmarked: boolean;
  libraryItem?: PaperWorkspaceItem;
  onClose: () => void;
  onAsk: (card: ResearchCardData) => void;
  onOpenRelated: (card: ResearchCardData) => void;
  onToggleBookmark: (card: ResearchCardData) => void;
  onSaveLibrary: (card: ResearchCardData, note: string, labels: string[]) => Promise<void>;
  onPaperLanguageChange: (language: PaperLanguage) => void;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
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

  if (!isOpen) return null;
  const paper = detail?.document;
  const sourceRef = paper?.sourcePdf || paper?.parentSourcePdf || paper?.source || "";
  const translatedTitle = paper
    ? translatedPaperText(translation, "paper.title", displayTitle(paper))
    : "Loading paper...";
  const translated = Boolean(translation?.showingTranslation);
  const translatedSummary = paper
    ? translatedPaperText(translation, "paper.summary", displaySummary(paper))
    : "";

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

        {status === "loading" ? (
          <div className="detailBody">
            <span className="skeletonLine title" />
            <span className="skeletonLine" />
            <span className="skeletonLine short" />
          </div>
        ) : status === "error" ? (
          <div className="detailBody">
            <p className="detailError">{error || "Paper details could not be loaded."}</p>
          </div>
        ) : detail && paper ? (
          <div className="detailBody">
            <div className="detailActions">
              <button type="button" className="cardAction primary" onClick={() => onAsk(paper)}>
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
              <h3>Representative evidence</h3>
              <div className="detailEvidenceGrid">
                {detail.evidence.slice(0, 8).map((item) => {
                  const evidenceTitle = item.sectionTitle
                    ? translatedPaperText(translation, `evidence.${item.id}.title`, item.sectionTitle)
                    : "";
                  const evidenceSnippet = translatedPaperText(translation, `evidence.${item.id}.snippet`, item.snippet);
                  return (
                    <article key={item.id} className="detailEvidenceCard">
                      <div>
                        <strong>
                          Cited chunk {item.chunkIndex ?? "?"}
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

            {detail.related?.length ? (
              <section className="detailSection">
                <h3>Related Thai evidence</h3>
                <p className="detailSectionLead">More page-linked studies in the same civil engineering discipline.</p>
                <div className="relatedPaperList">
                  {detail.related.map((related) => (
                    <button type="button" key={related.id} onClick={() => onOpenRelated(related)}>
                      <strong>{displayTitle(related)}</strong>
                      <span>{related.paperCode || related.sourceLabel} · {related.evidenceCount} evidence</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
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
  onOpenEvidence: (source: string) => void;
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
                {isUser ? "Your question" : "CivilMCP answer"}
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
  onOpenEvidence: (source: string) => void;
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
          <p>CivilMCP searches the selected collection and cites the pages it uses.</p>
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
  onBuild,
  onReset,
  onToggleStage,
  onStudyStage,
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
  onBuild: () => void;
  onReset: () => void;
  onToggleStage: (stageId: string) => void;
  onStudyStage: (prompt: string) => void;
  onOpenPaper: (source: string) => void;
}) {
  const progress = path?.stages.length
    ? Math.round((completedStages.length / path.stages.length) * 100)
    : 0;

  return (
    <section className="workspacePanel pathWorkspace" aria-label="Personalized research learning path">
      <div className="pathHeroSurface">
        <header className="pathHeader">
          <div>
            <p className="workspaceEyebrow"><Route size={14} aria-hidden /> Research Path</p>
            <h2>{path ? path.goal : "Turn a topic into a research plan"}</h2>
            <p>{path ? "Four focused stages, grounded in page-linked Thai evidence." : "Set a goal. CivilMCP organizes relevant studies into a focused four-stage path."}</p>
          </div>
          {path ? <button type="button" className="textAction pathResetAction" onClick={onReset}><RefreshCw size={15} aria-hidden /><span>New path</span></button> : null}
        </header>

        {path ? (
          <div className="pathProgress" aria-label={`${progress}% of research path complete`}>
            <span><strong>{completedStages.length}</strong> of {path.stages.length} stages complete</span>
            <progress value={completedStages.length} max={path.stages.length} />
            <span>{progress}%</span>
          </div>
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
            {["Construction delay risk", "Flood-resilient infrastructure", "Urban road safety"].map((example) => (
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
          <div className="pathStageList">
            {path.stages.map((stage, index) => {
              const complete = completedStages.includes(stage.id);
              return (
                <article key={stage.id} className={`pathStage ${complete ? "complete" : ""}`}>
                  <div className="pathStageIndex" aria-hidden>{String(index + 1).padStart(2, "0")}</div>
                  <div className="pathStageBody">
                    <div className="pathStageHeading">
                      <div>
                        <h3>{stage.title}</h3>
                        <p>{stage.objective}</p>
                      </div>
                      <button type="button" className="stageCheck" aria-pressed={complete} onClick={() => onToggleStage(stage.id)}>
                        <Check size={16} aria-hidden />
                        <span>{complete ? "Completed" : "Mark complete"}</span>
                      </button>
                    </div>
                    <div className="pathPaperList">
                      {stage.papers.map((paper) => (
                        <button key={paper.id} type="button" className="pathPaper" onClick={() => onOpenPaper(paper.source)}>
                          <span>{paper.title}</span>
                          <small>{[paper.paperCode, paper.pageLabel, `${paper.evidenceCount} evidence`].filter(Boolean).join(" · ")}</small>
                        </button>
                      ))}
                    </div>
                    <button type="button" className="primaryAction stageStudyAction" onClick={() => onStudyStage(stage.prompt)}>
                      <MessageCircle size={15} aria-hidden />
                      <span>Study with evidence</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <aside className="openAlexBridge" aria-label="Global research discovery with OpenAlex">
            <div>
              <p className="workspaceEyebrow">OpenAlex</p>
              <h3>Compare with global research</h3>
              <p>Explore related work, authors, and citation paths outside the CivilMCP corpus.</p>
            </div>
            {path.openAlex.works.length ? (
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
  onMagicLink,
  onForgotPassword,
  onUpdatePassword,
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
  onMagicLink: () => void;
  onForgotPassword: () => void;
  onUpdatePassword: () => void;
  onLogout: () => void;
  onCheckout: () => void;
  onPortal: () => void;
  isBusy: boolean;
  billingBusy: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = authMode === "signup";
  const isMagic = authMode === "magic-link";
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
      ? "Create an account"
      : isMagic
        ? "Sign in"
        : isForgot || isRecovery
          ? "Reset password"
          : "Sign in";
  const authSubtitle = signedIn
    ? "Your chats, paths, and papers sync across devices."
    : isSignup
      ? "Save chats, paths, and papers across devices."
      : isMagic
        ? "Save chats, paths, and papers across devices."
        : isForgot
          ? "We'll email you a secure reset link."
          : isRecovery
            ? "Use at least eight characters."
            : "Save chats, paths, and papers across devices.";
  const authSwitchLabel = isSignup
    ? "Already have an account?"
    : isForgot || isRecovery
      ? "Back to sign in"
      : isMagic
        ? "Use a password instead"
        : "New to CivilMCP?";
  const authSwitchAction = isSignup || isMagic || isForgot || isRecovery ? "Sign in" : "Create account";
  const authSwitchMode: AuthMode = isSignup || isMagic || isForgot || isRecovery ? "signin" : "signup";
  const primaryActionLabel = isBusy
    ? "Please wait..."
    : isMagic
      ? "Send sign-in link"
      : isSignup
        ? "Create account"
        : isForgot
          ? "Send recovery link"
          : isRecovery
            ? "Update password"
            : "Sign in";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isMagic) {
      onMagicLink();
    } else if (isForgot) {
      onForgotPassword();
    } else if (isRecovery) {
      onUpdatePassword();
    } else {
      onAuthSubmit();
    }
  };

  return (
    <section className="workspacePanel" aria-label="Account and chat history login">
      <div className="workspaceHeader">
        <div>
          <p className="workspaceEyebrow">Account</p>
          <h2>{authTitle}</h2>
          <p>{authSubtitle}</p>
        </div>
        {signedIn ? (
          <button type="button" className="cardAction" onClick={onLogout}>
            <LogOut size={17} strokeWidth={2.2} aria-hidden />
            <span>Log out</span>
          </button>
        ) : null}
      </div>

      <div className="accountGrid">
        <form className="accountCard authFormCard" onSubmit={onSubmit}>
          {signedIn ? (
            <div className="accountSignedIn">
              <span className="authAvatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{user.displayName}</strong>
                <span>{user.email || "Verified workspace session"}</span>
              </div>
              {statusText ? (
                <p className="authFormStatus" role="status" aria-live="polite">
                  {statusText}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <button type="button" className="googleAuthAction" onClick={onGoogle} disabled={isBusy}>
                <span>Continue with Google</span>
              </button>
              <div className="authDivider"><span>or use email</span></div>
              <div className="authSwitch authSwitchTop">
                <span>{authSwitchLabel}</span>
                <button type="button" onClick={() => setAuthMode(authSwitchMode)} disabled={isBusy}>
                  {authSwitchAction}
                </button>
              </div>

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

              {!isMagic && !isForgot ? (
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
                  className="cardAction primary"
                  disabled={isBusy}
                >
                  {isMagic || isForgot ? <Mail size={17} strokeWidth={2.2} aria-hidden /> : <LockKeyhole size={17} strokeWidth={2.2} aria-hidden />}
                  <span>{primaryActionLabel}</span>
                </button>
                {authMode === "signin" ? (
                  <button type="button" className="cardAction" onClick={() => setAuthMode("magic-link")} disabled={isBusy}>
                    <Mail size={17} strokeWidth={2.2} aria-hidden />
                    <span>Use email link</span>
                  </button>
                ) : null}
              </div>
              {statusText ? (
                <p className="authFormStatus" role="status" aria-live="polite">
                  {statusText}
                </p>
              ) : null}
            </>
          )}
        </form>

        <aside className="authBenefitCard" aria-label="CivilMCP workspace benefits">
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
          <p className="authBenefitIntro">150 monthly research credits and advanced models.</p>
          {signedIn && billing.creditsRemaining != null && billing.creditsIncluded != null ? (
            <div className="creditMeter" aria-label={`${billing.creditsRemaining} of ${billing.creditsIncluded} answer credits remaining`}>
              <div><strong>{billing.creditsRemaining}</strong><span>of {billing.creditsIncluded} credits left</span></div>
              <progress value={billing.creditsRemaining} max={billing.creditsIncluded} />
              <small>Resets {resetLabel}</small>
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
            <button type="button" className="cardAction primary planAction" onClick={() => setAuthMode("magic-link")}>
              <Mail size={17} strokeWidth={2.2} aria-hidden />
              <span>Sign in to upgrade</span>
            </button>
          )}
          <p className="planFinePrint">Free includes DeepSeek Flash and exact-page citations.</p>
        </aside>
      </div>
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
  onExport,
  onShare,
  onNavigate,
}: {
  children: ReactNode;
  mainRailRef: Ref<HTMLDivElement>;
  syncState: SyncState;
  syncLabel: string;
  authenticated: boolean;
  activeMobileNav: MobileNavItem;
  setActiveMobileNav: (item: MobileNavItem) => void;
  onExport: () => void;
  onShare: () => void;
  onNavigate: (item: MobileNavItem) => void;
}) {
  return (
    <main className="researchApp">
      <AppSidebar
        syncState={syncState}
        syncLabel={syncLabel}
        activeNav={activeMobileNav}
        authenticated={authenticated}
        onExport={onExport}
        onShare={onShare}
        onNavigate={onNavigate}
      />
      <div ref={mainRailRef} className="mainRail">{children}</div>
      <MobileBottomNav active={activeMobileNav} setActive={setActiveMobileNav} authenticated={authenticated} />
    </main>
  );
}

export default function Home() {
  const [useMcp, setUseMcp] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ChatModel>(DEFAULT_CHAT_MODEL);
  const [selectedCollection, setSelectedCollection] = useState<CollectionFilter>("");
  const [selectedExperience, setSelectedExperience] = useState<ChatExperience>("mission");
  const [draft, setDraft] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [statusText, setStatusText] = useState("");
  const [isSharedView, setIsSharedView] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<OpenDropdown>(null);
  const [activeFeedFilter, setActiveFeedFilter] = useState<FeedFilter>("hot");
  const [activeMobileNav, setActiveMobileNav] = useState<MobileNavItem>("explore");
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [currentSessionTitle, setCurrentSessionTitle] = useState("Untitled chat");
  const [pathGoal, setPathGoal] = useState("");
  const [pathLevel, setPathLevel] = useState<PathLevel>("applied");
  const [pathOutcome, setPathOutcome] = useState<PathOutcome>("literature_review");
  const [researchPath, setResearchPath] = useState<ResearchPath | null>(null);
  const [researchPathStatus, setResearchPathStatus] = useState<SessionsStatus>("idle");
  const [researchPathError, setResearchPathError] = useState("");
  const [completedPathStages, setCompletedPathStages] = useState<string[]>([]);
  const [researchPathReady, setResearchPathReady] = useState(false);
  const [userProfile, setUserProfile] = useState<ChatUserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [chatSessionsStatus, setChatSessionsStatus] = useState<SessionsStatus>("idle");
  const [chatSessionsError, setChatSessionsError] = useState("");
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("magic-link");
  const [loginName, setLoginName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPasswordConfirm, setLoginPasswordConfirm] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [billing, setBilling] = useState<BillingState>(GUEST_BILLING_STATE);
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [bookmarkedCards, setBookmarkedCards] = useState<Record<string, ResearchCardData>>({});
  const [workspaceItems, setWorkspaceItems] = useState<Record<string, PaperWorkspaceItem>>({});
  const [bookmarksReady, setBookmarksReady] = useState(false);
  const [paperTranslations, setPaperTranslations] = useState<Record<string, PaperTranslationState>>({});
  const [translationCacheReady, setTranslationCacheReady] = useState(false);
  const [paperLanguage, setPaperLanguage] = useState<PaperLanguage>("en");
  const [paperLanguageReady, setPaperLanguageReady] = useState(false);
  const [translationRefreshNonce, setTranslationRefreshNonce] = useState(0);
  const [feedCards, setFeedCards] = useState<ResearchCardData[]>([]);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("loading");
  const [feedError, setFeedError] = useState("");
  const [feedQuery, setFeedQuery] = useState("");
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedCatalogTotal, setFeedCatalogTotal] = useState(0);
  const [feedCitableTotal, setFeedCitableTotal] = useState(0);
  const [feedMetadataOnlyTotal, setFeedMetadataOnlyTotal] = useState(0);
  const [feedTotalSections, setFeedTotalSections] = useState(0);
  const [feedTotalChunks, setFeedTotalChunks] = useState(0);
  const [feedFilterCounts, setFeedFilterCounts] = useState<Partial<Record<FeedFilter, number>>>({});
  const [feedGeneratedAt, setFeedGeneratedAt] = useState("");
  const [feedNextCursor, setFeedNextCursor] = useState<string | null>(null);
  const [isFeedLoadingMore, setIsFeedLoadingMore] = useState(false);
  const [feedRefreshNonce, setFeedRefreshNonce] = useState(0);
  const [paperDetail, setPaperDetail] = useState<PaperDetailData | null>(null);
  const [paperDetailStatus, setPaperDetailStatus] = useState<FeedStatus>("ready");
  const [paperDetailError, setPaperDetailError] = useState("");
  const mainRailRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const detailRequestIdRef = useRef(0);
  const chatSessionRequestIdRef = useRef(0);
  const feedKeyRef = useRef("");
  const paperLanguageRef = useRef<PaperLanguage>("en");
  const paperTranslationsRef = useRef<Record<string, PaperTranslationState>>({});
  const translationInFlightRef = useRef(new Set<string>());
  const announcePaperLanguageRef = useRef(false);

  const setAppView = useCallback((item: MobileNavItem) => {
    setActiveMobileNav(item);
    setOpenDropdown(null);
    window.requestAnimationFrame(() => mainRailRef.current?.scrollTo({ top: 0, behavior: "auto" }));
  }, []);

  const mode: Mode = useMcp ? "mcp" : "baseline";
  const { messages, append, isLoading, setMessages, error: chatError } = useChat({
    api: "/api/chat",
    id: "civilmcp-session",
  });
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
    } finally {
      setBillingLoaded(true);
    }
  }, []);

  const buildFeedParams = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams({
        filter: activeFeedFilter,
        collection: selectedCollection || "all",
        limit: "12",
      });
      if (feedQuery) params.set("q", feedQuery);
      if (cursor) params.set("cursor", cursor);
      return params;
    },
    [activeFeedFilter, feedQuery, selectedCollection],
  );

  useEffect(() => {
    feedKeyRef.current = `${activeFeedFilter}|${feedQuery}|${selectedCollection}`;
  }, [activeFeedFilter, feedQuery, selectedCollection]);

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
    if (!isReady || !bookmarksReady) return;
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
  }, [bookmarksReady, isReady]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RESEARCH_PATH_KEY) ?? "null") as {
        path?: unknown;
        completedStages?: unknown;
      } | null;
      if (isResearchPath(parsed?.path)) {
        setResearchPath(parsed.path);
        setPathGoal(parsed.path.goal);
        setPathLevel(parsed.path.level);
        setPathOutcome(parsed.path.outcome);
        setCompletedPathStages(Array.isArray(parsed?.completedStages) ? parsed.completedStages.filter((value): value is string => typeof value === "string") : []);
        setResearchPathStatus("ready");
      }
    } catch {
      setResearchPath(null);
      setCompletedPathStages([]);
    } finally {
      setResearchPathReady(true);
    }
  }, []);

  useEffect(() => {
    if (!researchPathReady) return;
    try {
      if (researchPath) {
        window.localStorage.setItem(RESEARCH_PATH_KEY, JSON.stringify({ path: researchPath, completedStages: completedPathStages }));
      } else {
        window.localStorage.removeItem(RESEARCH_PATH_KEY);
      }
    } catch {
      setResearchPathError("This browser could not save your path locally.");
    }
  }, [completedPathStages, researchPath, researchPathReady]);

  useEffect(() => {
    let nextLanguage: PaperLanguage = "en";
    try {
      const storedLanguage = window.localStorage.getItem(PAPER_LANGUAGE_KEY);
      if (storedLanguage === "th" || storedLanguage === "en") {
        nextLanguage = storedLanguage;
      } else if (navigator.languages.some((language) => language.toLowerCase().startsWith("th"))) {
        nextLanguage = "th";
      }
    } catch {
      if (navigator.language.toLowerCase().startsWith("th")) nextLanguage = "th";
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
    setPaperDetail(null);
    setPaperDetailStatus("ready");
    setPaperDetailError("");
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
          setStatusText("Session sync is temporarily unavailable. Paper search remains available.");
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
    if (billingLoaded && !billing.premiumModels && chatModelRequiresPro(selectedModel)) {
      setSelectedModel(DEFAULT_CHAT_MODEL);
    }
  }, [billing.premiumModels, billingLoaded, selectedModel]);

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
    }, 350);
    return () => clearTimeout(timer);
  }, [activeMobileNav, draft]);

  useEffect(() => {
    if (!isReady || (activeMobileNav !== "explore" && activeMobileNav !== "workspace")) return;
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
        setFeedCatalogTotal(payload.facets?.catalogTotal ?? payload.facets?.total ?? 0);
        setFeedCitableTotal(payload.facets?.citableTotal ?? payload.facets?.total ?? 0);
        setFeedMetadataOnlyTotal(payload.facets?.metadataOnlyTotal ?? 0);
        setFeedTotalSections(payload.facets?.totalSections ?? 0);
        setFeedTotalChunks(payload.facets?.totalChunks ?? 0);
        setFeedFilterCounts(payload.facets?.filters ?? {});
        setFeedGeneratedAt(payload.generatedAt ?? "");
        setFeedNextCursor(payload.nextCursor ?? null);
        setFeedStatus("ready");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setFeedCards([]);
        setFeedTotal(0);
        setFeedCatalogTotal(0);
        setFeedCitableTotal(0);
        setFeedMetadataOnlyTotal(0);
        setFeedTotalSections(0);
        setFeedTotalChunks(0);
        setFeedFilterCounts({});
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
  }, [activeFeedFilter, activeMobileNav, buildFeedParams, feedRefreshNonce, isReady]);

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
        badge: option.requiresPro ? (billing.premiumModels ? `${option.credits} credits` : "PRO") : undefined,
        description:
          option.id === DEFAULT_CHAT_MODEL
            ? "Default · 1 credit · fast research answers"
            : option.requiresPro
              ? `${option.credits} ${option.credits === 1 ? "credit" : "credits"} · advanced reasoning`
              : `${option.credits} ${option.credits === 1 ? "credit" : "credits"} · additional model`,
      })),
    [billing.premiumModels],
  );

  const selectModel = (model: ChatModel) => {
    if (chatModelRequiresPro(model) && !billing.premiumModels) {
      setAppView("settings");
      setStatusText(`${CHAT_MODELS.find((option) => option.id === model)?.label ?? model} is included in Founder Pro.`);
      return;
    }
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
    if (saved) {
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
    if (!translationCacheReady || !paperLanguageReady || paperLanguage !== "en" || feedStatus !== "ready" || !visibleCards.length) return;
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
        setStatusText("Check your inbox to confirm the account, then sign in to CivilMCP.");
      } else {
        if (payload.user) {
          setUserProfile(payload.user);
          setLoginName(payload.user.displayName);
          setLoginEmail(payload.user.email ?? email);
        }
        setIsAuthenticated(Boolean(payload.authenticated));
        setLoginPassword("");
        setLoginPasswordConfirm("");
        setStatusText("Signed in. Your current chat history is now linked to this account.");
        await refreshCurrentSession();
        await refreshBilling();
        await refreshChatSessions(true);
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to sign in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const sendMagicLink = async () => {
    const email = loginEmail.trim();
    if (!email) {
      setStatusText("Enter your email before requesting a secure sign-in link.");
      return;
    }

    setAuthBusy(true);
    try {
      await fetchJson<{ ok: boolean; pendingEmail?: boolean }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "magic-link", email }),
      });
      setStatusText("Secure sign-in link sent. Open it from your email to finish signing in.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to send magic link.");
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
      setStatusText("Password updated. Your CivilMCP account is ready.");
      await refreshCurrentSession();
      await refreshBilling();
      await refreshChatSessions(true);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Password could not be updated.");
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
      setBillingLoaded(true);
      setMessages([]);
      setChatSessions([]);
      setCurrentSessionId("");
      setCurrentSessionTitle("Untitled chat");
      setStatusText("Signed out. You can continue working on this browser without an account.");
      window.location.reload();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to log out.");
    }
  };

  const openPaperDetailBySource = async (source: string, seedCard?: ResearchCardData) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
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
    try {
      const detail = await fetchJson<PaperDetailData>(`/api/papers/${encodeURIComponent(source)}`);
      if (detailRequestIdRef.current !== requestId) return;
      setPaperDetail(detail);
      setPaperDetailStatus("ready");
      if (paperLanguageRef.current === "en") {
        void translatePapersToEnglish([{ card: detail.document, detail }]);
      }
    } catch (error) {
      if (detailRequestIdRef.current !== requestId) return;
      setPaperDetailStatus("error");
      setPaperDetailError(error instanceof Error ? error.message : "Failed to load paper detail.");
    }
  };

  const openPaperDetail = async (card: ResearchCardData) => {
    await openPaperDetailBySource(card.source, card);
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
      setFeedCatalogTotal(payload.facets?.catalogTotal ?? feedCatalogTotal);
      setFeedCitableTotal(payload.facets?.citableTotal ?? feedCitableTotal);
      setFeedMetadataOnlyTotal(payload.facets?.metadataOnlyTotal ?? feedMetadataOnlyTotal);
      setFeedTotalSections(payload.facets?.totalSections ?? feedTotalSections);
      setFeedTotalChunks(payload.facets?.totalChunks ?? feedTotalChunks);
      setFeedFilterCounts(payload.facets?.filters ?? feedFilterCounts);
      setFeedGeneratedAt(payload.generatedAt ?? feedGeneratedAt);
      setFeedNextCursor(payload.nextCursor ?? null);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to load more papers.");
    } finally {
      setIsFeedLoadingMore(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt(draft);
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
    anchor.download = `civilmcp-session-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusText("Session exported as JSON");
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
    anchor.download = `civilmcp-${automated ? "research-dossier" : "evidence-brief"}-${Date.now()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusText(`${automated ? "Research Dossier" : "Evidence Brief"} exported as Markdown`);
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

  const buildResearchPath = async () => {
    const goal = pathGoal.trim();
    if (goal.length < 8 || researchPathStatus === "loading") return;
    setResearchPathStatus("loading");
    setResearchPathError("");
    try {
      const path = await fetchJson<ResearchPath>("/api/research-path", {
        method: "POST",
        body: JSON.stringify({ goal, level: pathLevel, outcome: pathOutcome, collection: selectedCollection }),
      });
      if (!isResearchPath(path)) throw new Error("CivilMCP returned an invalid research path.");
      setResearchPath(path);
      setCompletedPathStages([]);
      setResearchPathStatus("ready");
    } catch (error) {
      setResearchPathStatus("error");
      setResearchPathError(error instanceof Error ? error.message : "Could not build this research path.");
    }
  };

  const resetResearchPath = () => {
    setResearchPath(null);
    setCompletedPathStages([]);
    setResearchPathError("");
    setResearchPathStatus("idle");
  };

  const togglePathStage = (stageId: string) => {
    setCompletedPathStages((current) => current.includes(stageId) ? current.filter((id) => id !== stageId) : [...current, stageId]);
  };

  const studyPathStage = (prompt: string) => {
    setUseMcp(true);
    setSelectedExperience("learn");
    void submitPrompt(prompt, undefined, "mcp", "learn");
  };

  const selectExperience = (experience: ChatExperience) => {
    if ((experience === "research" || experience === "automated") && !(billing.plan === "founder_pro" && billing.premiumModels)) {
      const proGateMessage = experience === "automated"
        ? "Automated Research is included in Founder Pro. Sign in or upgrade to continue."
        : "Deep Research is included in Founder Pro. Sign in or upgrade to continue.";
      setStatusText(proGateMessage);
      setAppView("settings");
      return;
    }
    setSelectedExperience(experience);
  };

  const navigateApp = (item: MobileNavItem) => {
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
      setStatusText(isAuthenticated ? "Your account and saved work are synced." : "Sign in to sync your work across devices.");
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
        onExport={exportSession}
        onShare={() => void copyShareLink()}
        onNavigate={navigateApp}
      >
        <div className="mobileBrandStrip" aria-label="CivilMCP status">
          <span className="mobileBrandName">CivilMCP</span>
          <span className="brandBadge">Research Preview</span>
        </div>
        {showComposer ? (
          <section className="searchStage">
            <h1>
              {activeMobileNav === "explore"
                ? "Thai civil engineering research, with sources."
                : "Research with sources."}
            </h1>
            {activeMobileNav === "explore" ? (
              <>
                <p className="searchLead">
                  {feedCitableTotal
                    ? `Search ${feedCitableTotal.toLocaleString("en-US")} page-cited papers across ${Math.max(feedCatalogTotal, feedCitableTotal).toLocaleString("en-US")} Thai research records.`
                    : "Search Thai civil engineering research. Compare findings. Verify every claim on the original page."}
                </p>
                <div className="corpusProof" aria-label="CivilMCP corpus coverage">
                  <span><strong>{feedCitableTotal ? feedCitableTotal.toLocaleString("en-US") : "—"}</strong> citable papers</span>
                  <span><strong>{feedTotalChunks ? feedTotalChunks.toLocaleString("en-US") : "—"}</strong> cited passages</span>
                  {feedMetadataOnlyTotal ? <span><strong>{feedMetadataOnlyTotal.toLocaleString("en-US")}</strong> discovery records</span> : null}
                  <span>Exact-page citations</span>
                </div>
                <p className="corpusContext">Thai + English · Page-linked sources</p>
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
            <p className="researchDisclaimer">For research use. Not engineering advice.</p>
          </section>
        ) : null}

        {activeMobileNav === "explore" ? (
          <FilterBar
            activeFilter={activeFeedFilter}
            setActiveFilter={setActiveFeedFilter}
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
            papers={feedCards.map((card): ResearchWorkspacePaper => ({
              id: card.id,
              source: card.source,
              title: card.title,
              paperCode: card.paperCode,
              collection: card.collection,
              discipline: card.discipline,
              pageLabel: card.pageLabel,
              evidenceCount: card.evidenceCount,
            }))}
            authenticated={isAuthenticated}
            proEnabled={billing.plan === "founder_pro" && billing.premiumModels}
            onUpgrade={(message) => {
              setStatusText(message);
              setAppView("settings");
            }}
            onOpenPaper={(source) => void openPaperDetailBySource(source)}
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
            onBuild={() => void buildResearchPath()}
            onReset={resetResearchPath}
            onToggleStage={togglePathStage}
            onStudyStage={studyPathStage}
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
            onMagicLink={() => void sendMagicLink()}
            onForgotPassword={() => void sendPasswordRecovery()}
            onUpdatePassword={() => void updatePassword()}
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
            onRetry={() => setFeedRefreshNonce((value) => value + 1)}
            onLoadMore={() => void loadMoreFeed()}
            disabled={!isReady || isLoading}
          />
        ) : (
          <ChatWorkspace
            messages={messages}
            sessionId={currentSessionId}
            title={currentSessionTitle}
            isLoading={isLoading}
            error={chatError}
            onNewChat={() => void createNewChat()}
            onAsk={(prompt) => void submitPrompt(prompt, undefined, "mcp", "learn")}
            onOpenEvidence={(source) => void openPaperDetailBySource(source)}
            onExportEvidenceBrief={exportEvidenceBrief}
          />
        )}
      </AppShell>
      <PaperDetailDrawer
        detail={paperDetail}
        status={paperDetailStatus}
        error={paperDetailError}
        translation={paperDetail ? paperTranslations[cardKey(paperDetail.document)] : undefined}
        paperLanguage={paperLanguage}
        bookmarked={paperDetail ? Boolean(bookmarkedCards[cardKey(paperDetail.document)]) : false}
        libraryItem={paperDetail ? workspaceItems[paperDetail.document.source] : undefined}
        onClose={closePaperDetail}
        onAsk={askPaper}
        onOpenRelated={(card) => void openPaperDetail(card)}
        onToggleBookmark={toggleBookmark}
        onSaveLibrary={saveLibraryDetails}
        onPaperLanguageChange={changePaperLanguage}
      />
    </div>
  );
}
