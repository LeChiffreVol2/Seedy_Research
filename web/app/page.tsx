"use client";

import type { ButtonHTMLAttributes, FormEvent, KeyboardEvent, ReactNode } from "react";
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
  Database,
  Download,
  FileText,
  Flame,
  Gauge,
  History,
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
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CHAT_MODELS, DEFAULT_CHAT_MODEL, isChatModel, type ChatModel } from "@/lib/chat-models";

type Mode = "baseline" | "mcp";
type CollectionFilter = "" | "ce_project" | "ncce";
type SyncState = "loading" | "saving" | "saved" | "error";
type OpenDropdown = "model" | "collection" | "actions" | "examples" | null;
type FeedFilter = "hot" | "recent" | "evidence" | "ncce" | "ce_project";
type MobileNavItem = "explore" | "chat" | "history" | "shared" | "settings";
type FeedStatus = "loading" | "ready" | "error";
type SessionsStatus = "idle" | "loading" | "ready" | "error";
type AuthMode = "signin" | "signup" | "magic-link";

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

type MenuOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
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
    collections?: Array<{ collection: string; documents: number }>;
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
  generatedAt?: string;
};

type NavItem = {
  id: MobileNavItem;
  label: string;
  icon: LucideIcon;
};

const QUICK_PROMPTS = [
  "สรุปแนวทางลดอุบัติเหตุทางแยก",
  "เปรียบเทียบแนวทางจัดการน้ำท่วมในเขตเมือง",
  "สรุปประเด็นวิจัยด้านขนส่งจากคลังเอกสาร",
  "ค้นงาน NCCE ด้านโครงสร้างที่เกี่ยวกับคอนกรีต",
];

const COLLECTION_OPTIONS: Array<MenuOption<CollectionFilter>> = [
  { value: "", label: "All", description: "ค้นจากทุกชุดเอกสาร" },
  { value: "ce_project", label: "CE Project", description: "รายงานโครงงานวิศวกรรมโยธา" },
  { value: "ncce", label: "NCCE", description: "บทความการประชุมวิชาการวิศวกรรมโยธา" },
];

const FILTER_OPTIONS: Array<{ id: FeedFilter; label: string; icon: LucideIcon }> = [
  { id: "hot", label: "Hot", icon: Flame },
  { id: "recent", label: "Recent", icon: Clock3 },
  { id: "evidence", label: "Evidence", icon: FileText },
  { id: "ncce", label: "NCCE", icon: Building2 },
  { id: "ce_project", label: "CE Project", icon: Layers3 },
];

const MAIN_NAV_ITEMS: NavItem[] = [
  { id: "explore", label: "Explore", icon: Compass },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "history", label: "History", icon: History },
  { id: "shared", label: "Shared", icon: Share2 },
  { id: "settings", label: "Settings", icon: Settings },
];

const ACTION_LABELS = {
  share: "Copy share link",
  export: "Export JSON",
  clear: "Clear chat",
} as const;

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
  return new Intl.DateTimeFormat("th-TH", {
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

function compactSourceLabel(card: ResearchCardData): string {
  if (card.paperCode) return card.paperCode;
  const raw = card.sourcePdf || card.parentSourcePdf || card.source;
  return raw
    .replace(/\.(md|pdf)$/i, "")
    .replace(/^Y(\d{4})_/, "Y$1 · ")
    .replace(/_/g, " ")
    .slice(0, 34);
}

function cleanSourceLabel(card: ResearchCardData): string {
  const parts = [card.sourceLabel, compactSourceLabel(card)]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
  return parts.slice(0, 2).join(" · ");
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
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <span className={`glassWrap ${active ? "active" : ""} ${disabled ? "disabled" : ""} ${className}`}>
      <ClientLiquidLayer />
      <button {...buttonProps} type={buttonProps.type ?? "button"} disabled={disabled} className="glassButton">
        {children}
      </button>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronDown className={`chevronIcon ${open ? "open" : ""}`} aria-hidden />;
}

function GlassDropdown({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
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

  return (
    <div className={`selectControl ${className}`} data-dropdown-root>
      <GlassButton
        className="selectTrigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpenDropdown(open ? null : id)}
      >
        {Icon ? <Icon className="controlIcon" aria-hidden /> : null}
        <span className="controlLabel">{label}</span>
        <span className="controlValue">{selected.label}</span>
        <Chevron open={open} />
      </GlassButton>

      {open ? (
        <GlassDropdown>
          <div className="menuTitle">{label}</div>
          <div className="menuOptions" role="listbox" aria-label={label}>
            {options.map((option) => {
              const selectedOption = option.value === value;
              return (
                <button
                  key={`${id}-${option.value || "all"}`}
                  type="button"
                  className={`menuOption ${selectedOption ? "selected" : ""}`}
                  role="option"
                  aria-selected={selectedOption}
                  onClick={() => {
                    onChange(option.value);
                    setOpenDropdown(null);
                  }}
                >
                  <span>
                    <span className="optionLabel">{option.label}</span>
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

function ModeToggle({ useMcp, setUseMcp }: { useMcp: boolean; setUseMcp: (updater: (prev: boolean) => boolean) => void }) {
  return (
    <div className="modeGroup" aria-label="MCP mode">
      <span className="modeLabel">MCP</span>
      <span className="modeSegmentWrap">
        <ClientLiquidLayer cornerRadius={999} displacementScale={26} />
        <button
          type="button"
          className={`modeSegment ${useMcp ? "on" : "off"}`}
          onClick={() => setUseMcp((prev) => !prev)}
          aria-pressed={useMcp}
        >
          <span className="modeKnob" aria-hidden />
          <span>เปิด</span>
          <span>ปิด</span>
        </button>
      </span>
    </div>
  );
}

function ActionsMenu({
  openDropdown,
  setOpenDropdown,
  copyShareLink,
  exportSession,
  clearConversation,
  isReady,
  isLoading,
}: {
  openDropdown: OpenDropdown;
  setOpenDropdown: (dropdown: OpenDropdown) => void;
  copyShareLink: () => void;
  exportSession: () => void;
  clearConversation: () => void;
  isReady: boolean;
  isLoading: boolean;
}) {
  const open = openDropdown === "actions";
  const [confirmClear, setConfirmClear] = useState(false);
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
	    { key: "clear", icon: Trash2, label: ACTION_LABELS.clear, onClick: clearConversation, disabled: isLoading, danger: true },
	  ];
  const closeActions = () => {
    setConfirmClear(false);
    setOpenDropdown(null);
  };

  return (
    <div className="selectControl actionControl" data-dropdown-root>
      <GlassButton
        className="actionsTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenDropdown(open ? null : "actions")}
      >
        <SlidersHorizontal className="controlIcon" aria-hidden />
        <span className="controlValue">Actions</span>
        <Chevron open={open} />
      </GlassButton>
      {open ? (
        <GlassDropdown align="right">
          <div className="menuTitle">Session actions</div>
          <div className="menuOptions" role="menu" aria-label="Session actions">
            {actions.map((action) => {
              const Icon = action.icon;
              const isClear = action.key === "clear";
              return (
                <div key={action.key}>
                  <button
                    type="button"
                    className={`menuOption actionOption ${action.danger ? "danger" : ""}`}
                    disabled={action.disabled}
                    role="menuitem"
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
                    <button type="button" className="menuOption actionOption" role="menuitem" onClick={() => setConfirmClear(false)}>
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

  return (
    <div className="promptMenu" data-dropdown-root>
      <GlassButton
        className="promptTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Prompt starters"
        onClick={() => setOpenDropdown(open ? null : "examples")}
      >
        <Sparkles className="controlIcon" aria-hidden />
      </GlassButton>
      {open ? (
        <GlassDropdown>
          <div className="menuTitle">Prompt examples</div>
          <div className="menuOptions promptOptions" role="menu" aria-label="Prompt examples">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="menuOption promptOption"
                role="menuitem"
                onClick={() => {
                  setDraft(prompt);
                  setOpenDropdown(null);
                }}
              >
                <span className="optionLabel">{prompt}</span>
              </button>
            ))}
          </div>
        </GlassDropdown>
      ) : null}
    </div>
  );
}

function EvidenceCards({ annotation, markdown }: { annotation: CivilMcpAnnotation | null; markdown: string }) {
  const evidenceItems = annotation?.evidenceItems ?? [];
  if (evidenceItems.length) {
    return (
      <div className="evidenceGrid" aria-label="Evidence citations">
        {evidenceItems.map((item) => (
          <article key={item.evidenceId} className="evidenceCard">
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
          </article>
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
          ระบบสรุปบทสนทนาอัตโนมัติเพื่อลด context cost และคงความต่อเนื่องของคำถามถัดไป
          {annotation.compactedMessageCount ? ` โดยย่อ ${annotation.compactedMessageCount} messages` : ""}.
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

function AnswerFeedback({ message, traceId, sessionId }: { message: UIMessage; traceId?: string; sessionId: string }) {
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

function MessageRenderer({ message, sessionId }: { message: UIMessage; sessionId: string }) {
  const text = messageText(message);
  if (message.role === "user") {
    return <p className="userText">{text}</p>;
  }

  const annotation = getCivilMcpAnnotation(message);
  const traceAnnotation = getCivilTraceAnnotation(message);
  const traceId = annotation?.traceId ?? traceAnnotation?.traceId;
  const memoryAnnotation = getCivilMemoryAnnotation(message);
  const shouldShowEvidence = text.trim().length > 0;
  return (
    <>
      <div className="markdownBody">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
      <MemoryNotice annotation={memoryAnnotation} />
      {shouldShowEvidence ? <EvidenceCards annotation={annotation} markdown={text} /> : null}
      {shouldShowEvidence ? <AnswerFeedback message={message} traceId={traceId} sessionId={sessionId} /> : null}
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
            <p className="brandSubline">Civil engineering research assistant</p>
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
            <strong>MCP status</strong>
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
      {MAIN_NAV_ITEMS.map((item) => {
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
  onSubmit,
  onKeyDown,
  useMcp,
  setUseMcp,
  selectedModel,
  modelOptions,
  selectedCollection,
  openDropdown,
  setOpenDropdown,
  setSelectedModel,
  setSelectedCollection,
  copyShareLink,
  exportSession,
  clearConversation,
  isReady,
  isLoading,
}: {
  draft: string;
  setDraft: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  useMcp: boolean;
  setUseMcp: (updater: (prev: boolean) => boolean) => void;
  selectedModel: ChatModel;
  modelOptions: Array<MenuOption<ChatModel>>;
  selectedCollection: CollectionFilter;
  openDropdown: OpenDropdown;
  setOpenDropdown: (dropdown: OpenDropdown) => void;
  setSelectedModel: (value: ChatModel) => void;
  setSelectedCollection: (value: CollectionFilter) => void;
  copyShareLink: () => void;
  exportSession: () => void;
  clearConversation: () => void;
  isReady: boolean;
  isLoading: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="searchComposer">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="ถามเกี่ยวกับงานวิจัยวิศวกรรมโยธา"
        disabled={isLoading}
        rows={3}
      />
      <div className="composerToolbar">
        <PromptMenu openDropdown={openDropdown} setOpenDropdown={setOpenDropdown} setDraft={setDraft} />
        <ModeToggle useMcp={useMcp} setUseMcp={setUseMcp} />
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
          clearConversation={clearConversation}
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
  generatedAt,
  onRefresh,
  isRefreshing,
}: {
  activeFilter: FeedFilter;
  setActiveFilter: (filter: FeedFilter) => void;
  totalDocuments: number;
  generatedAt: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const syncText = generatedAt
    ? new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(new Date(generatedAt))
    : "pending";

  return (
    <div className="feedToolbar" aria-label="Research feed filters">
      <div className="filterChips">
        {FILTER_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = activeFilter === option.id;
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
            </GlassButton>
          );
        })}
      </div>
      <div className="feedToolbarAside">
        <div className="feedMeta" aria-label="Dynamic corpus status">
          <Database size={15} strokeWidth={2.2} aria-hidden />
          <span>{totalDocuments ? `${totalDocuments.toLocaleString("th-TH")} papers` : "Live corpus"}</span>
          <small>updated {syncText}</small>
        </div>
        <GlassButton
          className="refreshChip"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label={isRefreshing ? "Updating research feed" : "Refresh research feed"}
        >
          <RefreshCw className="chipIcon" aria-hidden />
          <span>{isRefreshing ? "Updating feed" : "Refresh feed"}</span>
        </GlassButton>
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
}: {
  variant: ResearchCardData["preview"];
  pageLabel: string;
  previewUrl?: string;
  title: string;
}) {
  return (
    <div className={`documentPreview ${variant}`} aria-hidden>
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
      <div className="previewSheet">
        <div className="previewTitle" />
        <div className="previewText" />
        <div className="previewText short" />
        <PreviewSvg variant={variant} />
      </div>
      <span className="previewBadge" title={title}>
        {pageLabel}
      </span>
    </div>
  );
}

function ResearchCard({
  card,
  onAsk,
  onOpen,
  onStatus,
  disabled,
}: {
  card: ResearchCardData;
  onAsk: (card: ResearchCardData) => void;
  onOpen: (card: ResearchCardData) => void;
  onStatus: (message: string) => void;
  disabled: boolean;
}) {
  return (
    <article className="researchCard">
      <div className="cardContent">
        <div className="cardTitleRow">
          <FileText className="cardDocIcon" aria-hidden />
          <button type="button" className="cardTitleButton" onClick={() => onOpen(card)}>
            <h2>{card.title}</h2>
          </button>
        </div>
        <div className="paperMeta">
          <span>{card.date}</span>
          <span>{cleanSourceLabel(card)}</span>
          {card.collection === "ncce" ? (
            <span>PDF preview</span>
          ) : card.pageStart != null ? (
            <span>{card.pageEnd === card.pageStart ? `p.${card.pageStart}` : `p.${card.pageStart}-${card.pageEnd}`}</span>
          ) : null}
        </div>
        <p className="paperSummary">{card.summary}</p>
        <div className="tagRow" aria-label="Research tags">
          {card.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        <div className="cardActions">
          <button type="button" className="cardAction primary" disabled={disabled} onClick={() => onAsk(card)}>
            <MessageCircle size={17} strokeWidth={2.2} aria-hidden />
            <span>Ask</span>
          </button>
          <button type="button" className="cardAction" onClick={() => onStatus("Bookmarked in this browser session")}>
            <Bookmark size={17} strokeWidth={2.2} aria-hidden />
            <span>Bookmark</span>
            <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
          </button>
          <button type="button" className="cardAction" onClick={() => onOpen(card)}>
            <Layers3 size={17} strokeWidth={2.2} aria-hidden />
            <span>Evidence</span>
            <strong>{card.evidenceCount}</strong>
          </button>
        </div>
      </div>
      <DocumentPreview variant={card.preview} pageLabel={card.pageLabel ?? "PDF preview"} previewUrl={card.previewUrl} title={card.title} />
    </article>
  );
}

function ResearchFeed({
  cards,
  status,
  error,
  query,
  hasMore,
  isLoadingMore,
  onAsk,
  onOpen,
  onRetry,
  onLoadMore,
  onStatus,
  disabled,
}: {
  cards: ResearchCardData[];
  status: FeedStatus;
  error: string;
  query: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onAsk: (card: ResearchCardData) => void;
  onOpen: (card: ResearchCardData) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onStatus: (message: string) => void;
  disabled: boolean;
}) {
  if (status === "loading") {
    return (
      <section className="feedStack" aria-label="CivilMCP research feed loading">
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
        <article className="feedStateCard">
          <h2>โหลด research feed ไม่สำเร็จ</h2>
          <p>{error || "เกิดข้อผิดพลาดจาก API หรือ Supabase"}</p>
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
          <h2>ไม่พบ paper ที่ตรงกับเงื่อนไข</h2>
          <p>{query ? `ลองปรับคำค้น "${query}" หรือเปลี่ยน collection/filter` : "ลองเปลี่ยน filter หรือ collection เพื่อดูเอกสารชุดอื่น"}</p>
          <button type="button" className="cardAction" onClick={onRetry}>
            Refresh feed
          </button>
        </article>
      </section>
    );
  }

  return (
    <section className="feedStack" aria-label="CivilMCP research feed">
      {cards.map((card) => (
        <ResearchCard key={card.id} card={card} onAsk={onAsk} onOpen={onOpen} onStatus={onStatus} disabled={disabled} />
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

function PaperDetailDrawer({
  detail,
  status,
  error,
  onClose,
  onAsk,
}: {
  detail: PaperDetailData | null;
  status: FeedStatus;
  error: string;
  onClose: () => void;
  onAsk: (card: ResearchCardData) => void;
}) {
  if (!detail && status !== "loading" && status !== "error") return null;
  const document = detail?.document;

  return (
    <div className="detailBackdrop" role="presentation" onClick={onClose}>
      <aside className="paperDetailDrawer" role="dialog" aria-modal="true" aria-label="Paper detail" onClick={(event) => event.stopPropagation()}>
        <div className="detailHeader">
          <div>
            <p className="detailEyebrow">Paper detail</p>
            <h2>{document?.title ?? "Loading paper..."}</h2>
            {document ? (
              <p className="detailMeta">
                {document.sourceLabel} · {document.source}
                {document.pageStart != null ? ` · ${document.pageEnd === document.pageStart ? `p.${document.pageStart}` : `p.${document.pageStart}-${document.pageEnd}`}` : ""}
              </p>
            ) : null}
          </div>
          <button type="button" className="detailClose" onClick={onClose} aria-label="Close paper detail">
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
            <p className="detailError">{error || "โหลด paper detail ไม่สำเร็จ"}</p>
          </div>
        ) : detail && document ? (
          <div className="detailBody">
            <div className="detailActions">
              <button type="button" className="cardAction primary" onClick={() => onAsk(document)}>
                <MessageCircle size={17} strokeWidth={2.2} aria-hidden />
                <span>Ask this paper</span>
              </button>
              <span>{detail.counts.sections} sections</span>
              <span>{detail.counts.chunks} chunks</span>
            </div>

            <section className="detailSection">
              <h3>Summary</h3>
              <p>{document.summary}</p>
            </section>

            <section className="detailSection">
              <h3>Outline</h3>
              <div className="outlineList">
                {detail.sections.slice(0, 14).map((section) => (
                  <article key={section.id}>
                    <strong>
                      {section.sectionIndex != null ? `${section.sectionIndex}. ` : ""}
                      {section.title}
                    </strong>
                    <span>{section.pageStart != null ? (section.pageEnd === section.pageStart ? `p.${section.pageStart}` : `p.${section.pageStart}-${section.pageEnd}`) : "no page"}</span>
                    {section.snippet ? <p>{section.snippet}</p> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="detailSection">
              <h3>Representative evidence</h3>
              <div className="detailEvidenceGrid">
                {detail.evidence.slice(0, 8).map((item) => (
                  <article key={item.id} className="detailEvidenceCard">
                    <div>
                      <strong>
                        chunk {item.chunkIndex ?? "?"}
                        {item.pageStart != null ? ` · ${item.pageEnd === item.pageStart ? `p.${item.pageStart}` : `p.${item.pageStart}-${item.pageEnd}`}` : ""}
                      </strong>
                      {item.sectionTitle ? <span>{item.sectionTitle}</span> : null}
                    </div>
                    <p>{item.snippet}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ConversationFeed({ messages, sessionId }: { messages: UIMessage[]; sessionId: string }) {
  return (
    <section className="feedStack conversationFeed" aria-label="Conversation">
      {messages.map((message) => {
        const isUser = message.role === "user";
        return (
          <article key={message.id} className={`conversationCard ${isUser ? "user" : "assistant"}`}>
            <div className="conversationHeader">
              <span className="conversationRole">
                {isUser ? <Search size={16} strokeWidth={2.2} aria-hidden /> : <Gauge size={16} strokeWidth={2.2} aria-hidden />}
                {isUser ? "Your question" : "CivilMCP answer"}
              </span>
            </div>
            <MessageRenderer message={message} sessionId={sessionId} />
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
}: {
  messages: UIMessage[];
  sessionId: string;
  title: string;
  isLoading: boolean;
  error?: Error;
  onNewChat: () => void;
}) {
  return (
    <section className="workspacePanel" aria-label="Chat workspace">
      <div className="workspaceHeader">
        <div>
          <p className="workspaceEyebrow">Chat workspace</p>
          <h2>{title || "Untitled chat"}</h2>
          <p>แชทแยกจาก research feed แล้ว ประวัติจะ sync ต่อ session นี้โดยเฉพาะ</p>
        </div>
        <button type="button" className="cardAction primary" onClick={onNewChat} disabled={isLoading}>
          <Plus size={17} strokeWidth={2.2} aria-hidden />
          <span>New chat</span>
        </button>
      </div>

      {messages.length ? (
        <ConversationFeed messages={messages} sessionId={sessionId} />
      ) : (
        <article className="feedStateCard chatEmptyState">
          <h2>เริ่มห้องแชทใหม่</h2>
          <p>พิมพ์คำถามด้านบน หรือกด Ask จาก paper เพื่อเริ่มบทสนทนาที่ผูกกับหลักฐานจากคลัง CivilMCP</p>
        </article>
      )}
      {error ? (
        <article className="feedStateCard errorState" role="alert">
          <h2>ส่งคำถามไม่สำเร็จ</h2>
          <p>ตรวจการเชื่อมต่อหรือ backend model แล้วลองส่งอีกครั้ง</p>
        </article>
      ) : null}
    </section>
  );
}

function ChatHistoryPanel({
  sessions,
  status,
  currentSessionId,
  pendingDeleteSessionId,
  onNewChat,
  onOpenSession,
  onRequestDeleteSession,
  onCancelDeleteSession,
  onConfirmDeleteSession,
}: {
  sessions: ChatSessionSummary[];
  status: SessionsStatus;
  currentSessionId: string;
  pendingDeleteSessionId: string | null;
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
          <p className="workspaceEyebrow">Chat history</p>
          <h2>Saved conversations</h2>
          <p>เลือกห้องแชทเดิมโดยไม่ปนกับหน้า feed หรือสร้างห้องใหม่ก่อนถามเรื่องอื่น</p>
        </div>
        <button type="button" className="cardAction primary" onClick={onNewChat}>
          <Plus size={17} strokeWidth={2.2} aria-hidden />
          <span>New chat</span>
        </button>
      </div>

      {status === "loading" ? (
        <article className="feedStateCard">
          <h2>กำลังโหลดประวัติแชท</h2>
          <p>กำลังดึงรายการ session จาก Supabase</p>
        </article>
      ) : sessions.length ? (
        <div className="historyList">
          {sessions.map((session) => {
            const selected = session.sessionId === currentSessionId;
            const confirmingDelete = session.sessionId === pendingDeleteSessionId;
            return (
              <article key={session.sessionId} className={`historyCard ${selected ? "selected" : ""}`}>
                <button type="button" className="historyMain" onClick={() => onOpenSession(session.sessionId)}>
                  <span className="historyTitle">{session.title}</span>
                  <span className="historySnippet">{session.lastUserMessage || "ยังไม่มีข้อความใน session นี้"}</span>
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
                    <button type="button" onClick={() => onConfirmDeleteSession(session.sessionId)}>
                      Delete
                    </button>
                    <button type="button" onClick={onCancelDeleteSession}>
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
          <h2>ยังไม่มี chat history</h2>
          <p>กด New chat หรือเริ่มถามคำถามด้านบน แล้ว session จะถูกบันทึกแยกให้ทันที</p>
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
  return (
    <section className="workspacePanel" aria-label="Share workspace">
      <div className="workspaceHeader">
        <div>
          <p className="workspaceEyebrow">Shared work</p>
          <h2>Share or export this research session</h2>
          <p>สร้างลิงก์สำหรับ session นี้เมื่อต้องส่งต่อคำถาม คำตอบ และ evidence ให้ทีมตรวจต่อ</p>
        </div>
        <button type="button" className="cardAction primary" onClick={shareUrl ? onCopyLink : onCreateLink} disabled={isBusy}>
          <Share2 size={17} strokeWidth={2.2} aria-hidden />
          <span>{isBusy ? "Preparing..." : shareUrl ? "Copy link" : "Create link"}</span>
        </button>
      </div>

      <div className="shareGrid">
        <article className="shareCard">
          <p className="workspaceEyebrow">Current session</p>
          <h3>{title || "Untitled chat"}</h3>
          <p>{messageCount ? `${messageCount} messages are ready to share.` : "Start a chat before sharing a research session."}</p>
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
          <p className="workspaceEyebrow">Portable archive</p>
          <h3>Export as JSON</h3>
          <p>ใช้สำหรับเก็บหลักฐานการสนทนา หรือส่งต่อให้ทีม backend/debug โดยไม่ต้องเปิด public link</p>
          <button type="button" className="cardAction" onClick={onExport}>
            <Download size={17} strokeWidth={2.2} aria-hidden />
            <span>Export session</span>
          </button>
        </article>
      </div>
    </section>
  );
}

function AccountPanel({
  user,
  authenticated,
  authMode,
  setAuthMode,
  statusText,
  displayName,
  email,
  password,
  setDisplayName,
  setEmail,
  setPassword,
  onAuthSubmit,
  onMagicLink,
  onLogout,
  isBusy,
}: {
  user: ChatUserProfile | null;
  authenticated: boolean;
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  statusText: string;
  displayName: string;
  email: string;
  password: string;
  setDisplayName: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  onAuthSubmit: () => void;
  onMagicLink: () => void;
  onLogout: () => void;
  isBusy: boolean;
}) {
  const signedIn = authenticated && user?.isGuest === false;
  const isSignup = authMode === "signup";
  const isMagic = authMode === "magic-link";
  const authTitle = signedIn
    ? "Workspace account active"
    : isSignup
      ? "Create your CivilMCP account"
      : isMagic
        ? "Sign in with email"
        : "Sign in to CivilMCP";
  const authSubtitle = signedIn
    ? "Your saved chats, shared links, and research sessions are connected to this account."
    : isSignup
      ? "Set up a workspace for saved chats, paper-backed answers, and shared CivilMCP sessions."
      : isMagic
        ? "Receive a secure sign-in link and continue without entering a password."
        : "Welcome back. Continue to your synced research workspace.";
  const authSwitchLabel = isMagic ? "Prefer password?" : isSignup ? "Already have an account?" : "New to CivilMCP?";
  const authSwitchAction = isMagic || isSignup ? "Sign in" : "Create account";
  const authSwitchMode: AuthMode = isMagic || isSignup ? "signin" : "signup";
  const primaryActionLabel = isBusy
    ? "Please wait..."
    : isMagic
      ? "Send secure sign-in link"
      : isSignup
        ? "Create secure account"
        : "Continue securely";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isMagic) {
      onMagicLink();
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
            </div>
          ) : (
            <>
              <div className="authFormHeader">
                <p>{isSignup ? "Start a workspace" : isMagic ? "Password-free access" : "Welcome back"}</p>
                <h3>{authTitle}</h3>
                <div className="authSwitch">
                  <span>{authSwitchLabel}</span>
                  <button type="button" onClick={() => setAuthMode(authSwitchMode)}>
                    {authSwitchAction}
                  </button>
                </div>
              </div>

              {isSignup ? (
                <label>
                  <span>Name or organization</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="CivilMCP research team"
                    autoComplete="name"
                  />
                </label>
              ) : null}

              <label>
                <span>Email</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  type="email"
                  autoComplete="email"
                />
              </label>

              {!isMagic ? (
                <label>
                  <span>Password</span>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimum 8 characters"
                    type="password"
                    autoComplete={isSignup ? "new-password" : "current-password"}
                  />
                </label>
              ) : null}

              <div className="accountActions">
                <button
                  type="submit"
                  className="cardAction primary"
                  disabled={isBusy}
                >
                  {isMagic ? <Mail size={17} strokeWidth={2.2} aria-hidden /> : <LockKeyhole size={17} strokeWidth={2.2} aria-hidden />}
                  <span>{primaryActionLabel}</span>
                </button>
                {!isMagic ? (
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
          {signedIn ? (
            <>
              <p className="workspaceEyebrow">Workspace ready</p>
              <h3>Your account is connected.</h3>
              <p className="authBenefitIntro">New chats and saved sessions will stay tied to this workspace account.</p>
              <div className="authFeatureList">
                <div className="authFeatureRow">
                  <History size={17} strokeWidth={2.2} aria-hidden />
                  <span>
                    <strong>History available</strong>
                    <small>Open saved sessions from the History tab.</small>
                  </span>
                </div>
                <div className="authFeatureRow">
                  <Share2 size={17} strokeWidth={2.2} aria-hidden />
                  <span>
                    <strong>Share intentionally</strong>
                    <small>Create links from the Shared work tab when needed.</small>
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="workspaceEyebrow">Research workspace</p>
              <h3>Keep your paper-backed work connected.</h3>
              <p className="authBenefitIntro">Sign in when you want CivilMCP to remember the sessions that matter beyond this browser.</p>
              <div className="authFeatureList">
                <div className="authFeatureRow">
                  <History size={17} strokeWidth={2.2} aria-hidden />
                  <span>
                    <strong>Synced chat history</strong>
                    <small>Resume saved conversations from another device.</small>
                  </span>
                </div>
                <div className="authFeatureRow">
                  <Layers3 size={17} strokeWidth={2.2} aria-hidden />
                  <span>
                    <strong>Research context</strong>
                    <small>Keep model, collection, and MCP mode with each session.</small>
                  </span>
                </div>
                <div className="authFeatureRow">
                  <Share2 size={17} strokeWidth={2.2} aria-hidden />
                  <span>
                    <strong>Share-ready work</strong>
                    <small>Return to exported or shared research threads faster.</small>
                  </span>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function AppShell({
  children,
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
      <div className="mainRail">{children}</div>
      <MobileBottomNav active={activeMobileNav} setActive={setActiveMobileNav} authenticated={authenticated} />
    </main>
  );
}

export default function Home() {
  const [useMcp, setUseMcp] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ChatModel>(DEFAULT_CHAT_MODEL);
  const [selectedCollection, setSelectedCollection] = useState<CollectionFilter>("");
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
  const [userProfile, setUserProfile] = useState<ChatUserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [chatSessionsStatus, setChatSessionsStatus] = useState<SessionsStatus>("idle");
  const [chatSessionsError, setChatSessionsError] = useState("");
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [loginName, setLoginName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [feedCards, setFeedCards] = useState<ResearchCardData[]>([]);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("loading");
  const [feedError, setFeedError] = useState("");
  const [feedQuery, setFeedQuery] = useState("");
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedGeneratedAt, setFeedGeneratedAt] = useState("");
  const [feedNextCursor, setFeedNextCursor] = useState<string | null>(null);
  const [isFeedLoadingMore, setIsFeedLoadingMore] = useState(false);
  const [feedRefreshNonce, setFeedRefreshNonce] = useState(0);
  const [paperDetail, setPaperDetail] = useState<PaperDetailData | null>(null);
  const [paperDetailStatus, setPaperDetailStatus] = useState<FeedStatus>("ready");
  const [paperDetailError, setPaperDetailError] = useState("");
  const pageRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mode: Mode = useMcp ? "mcp" : "baseline";
  const { messages, append, isLoading, setMessages, error: chatError } = useChat({
    api: "/api/chat",
    id: "civilmcp-session",
  });

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

  const closePaperDetail = useCallback(() => {
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
        void refreshChatSessions();
      } catch (error) {
        if (!cancelled) {
          setSyncState("error");
          setStatusText(error instanceof Error ? error.message : "Failed to load session.");
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
  }, [refreshChatSessions, setMessages]);

  useEffect(() => {
    if (!isReady || !currentSessionId || isSharedView) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    const nextTitle = sessionTitleFromMessages(messages, currentSessionTitle);
    setCurrentSessionTitle(nextTitle);
    setSyncState("saving");
    saveTimerRef.current = setTimeout(() => {
      void fetchJson<{ ok: boolean }>("/api/history", {
        method: "POST",
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
          setSyncState("saved");
          void refreshChatSessions();
        })
        .catch(() => setSyncState("error"));
    }, 450);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
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
    if (!isReady || activeMobileNav !== "explore") return;
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
        setFeedGeneratedAt(payload.generatedAt ?? "");
        setFeedNextCursor(payload.nextCursor ?? null);
        setFeedStatus("ready");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setFeedCards([]);
        setFeedTotal(0);
        setFeedNextCursor(null);
        setFeedStatus("error");
        setFeedError(error instanceof Error ? error.message : "Failed to load research feed.");
      }
    }

    void loadFeed();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeMobileNav, buildFeedParams, feedRefreshNonce, isReady]);

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
        description: option.provider === "openai" ? "OpenAI reasoning model" : "DeepSeek chat model",
      })),
    [],
  );

  const visibleCards = feedCards;

  const submitPrompt = async (text: string, paperAnchor?: PaperAnchor, modeOverride?: Mode) => {
    const trimmed = text.trim();
    if (!trimmed || !isReady || isLoading) return;
    setDraft("");
    setOpenDropdown(null);
    setActiveMobileNav("chat");
    try {
      await append(
        { role: "user", content: trimmed },
        {
          body: { mode: modeOverride ?? mode, model: selectedModel, collection: selectedCollection, sessionId: currentSessionId, paperAnchor },
        },
      );
    } catch (error) {
      setDraft(trimmed);
      setActiveMobileNav("explore");
      setStatusText(error instanceof Error ? error.message : "Could not send your question. Your draft was restored.");
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
      setActiveMobileNav("chat");
      setIsSharedView(false);
      setStatusText("New chat created");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to create chat.");
    }
  };

  const openChatSession = async (sessionId: string) => {
    try {
      const payload = await fetchJson<SessionPayload>(`/api/history?session=${encodeURIComponent(sessionId)}`);
      const normalized = normalizeSessionPayload(payload);
      setCurrentSessionId(normalized.sessionId);
      setCurrentSessionTitle(normalized.title);
      setUseMcp(normalized.mode === "mcp");
      setSelectedModel(normalized.model);
      setSelectedCollection(normalized.collection);
      setMessages(normalized.messages);
      if (normalized.user) setUserProfile(normalized.user);
      setIsAuthenticated(normalized.authenticated);
      setActiveMobileNav("chat");
      setPendingDeleteSessionId(null);
      setIsSharedView(false);
      setStatusText("Chat session loaded");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to load chat session.");
    }
  };

  const deleteChatSession = async (sessionId: string) => {
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

  const submitAuth = async () => {
    const email = loginEmail.trim();
    if (!email || (authMode !== "magic-link" && loginPassword.length < 8)) {
      setStatusText("Enter your work email and a password with at least 8 characters.");
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
        setStatusText("Signed in. Your current chat history is now linked to this account.");
        await refreshCurrentSession();
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

  const logoutChat = async () => {
    try {
      await fetchJson<{ ok: boolean }>("/api/auth", { method: "DELETE" });
      setUserProfile(null);
      setLoginName("");
      setLoginEmail("");
      setLoginPassword("");
      setIsAuthenticated(false);
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

  const openPaperDetail = async (card: ResearchCardData) => {
    setPaperDetail({
      document: card,
      sections: [],
      evidence: [],
      counts: { sections: 0, chunks: card.evidenceCount },
    });
    setPaperDetailStatus("loading");
    setPaperDetailError("");
    try {
      const detail = await fetchJson<PaperDetailData>(`/api/papers/${encodeURIComponent(card.source)}`);
      setPaperDetail(detail);
      setPaperDetailStatus("ready");
    } catch (error) {
      setPaperDetailStatus("error");
      setPaperDetailError(error instanceof Error ? error.message : "Failed to load paper detail.");
    }
  };

  const loadMoreFeed = async () => {
    if (!feedNextCursor || isFeedLoadingMore || feedStatus !== "ready") return;
    setIsFeedLoadingMore(true);
    try {
      const params = buildFeedParams(feedNextCursor);
      const payload = await fetchJson<ResearchFeedResponse>(`/api/research-feed?${params.toString()}`);
      setFeedCards((current) => {
        const seen = new Set(current.map((card) => card.id));
        const nextCards = (payload.cards ?? []).filter((card) => !seen.has(card.id));
        return [...current, ...nextCards];
      });
      setFeedTotal(payload.facets?.total ?? feedTotal);
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

  const createShareLink = async (copyToClipboard: boolean) => {
    if (!currentSessionId) {
      setStatusText("Start or open a chat before creating a share link.");
      return null;
    }

    setShareBusy(true);
    try {
      const data = await fetchJson<{ shareUrl: string }>("/api/share", {
        method: "POST",
        body: JSON.stringify({ sessionId: currentSessionId }),
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
    await createShareLink(true);
  };

  const navigateApp = (item: MobileNavItem) => {
    setActiveMobileNav(item);
    if (item === "explore") {
      setStatusText("");
    } else if (item === "chat") {
      setStatusText("");
    } else if (item === "history") {
      void refreshChatSessions(true);
      setStatusText("");
    } else if (item === "shared") {
      setStatusText("");
    } else {
      setStatusText(isAuthenticated ? "Account settings and synced history are available." : "Sign in to keep CivilMCP history available across devices.");
    }
  };

  return (
    <div ref={pageRef}>
      <AppShell
        syncState={syncState}
        syncLabel={syncLabel}
        authenticated={isAuthenticated}
        activeMobileNav={activeMobileNav}
        setActiveMobileNav={navigateApp}
        onExport={exportSession}
        onShare={() => void copyShareLink()}
        onNavigate={navigateApp}
      >
        <section className="searchStage">
          <div className="mobileBrandStrip" aria-label="CivilMCP status">
            <span className="mobileBrandName">CivilMCP</span>
            <span className="brandBadge">Research Preview</span>
          </div>
          <h1>Ask or search civil engineering papers...</h1>
          <SearchComposer
            draft={draft}
            setDraft={setDraft}
            onSubmit={onSubmit}
            onKeyDown={onComposerKeyDown}
            useMcp={useMcp}
            setUseMcp={setUseMcp}
            selectedModel={selectedModel}
            modelOptions={modelOptions}
            selectedCollection={selectedCollection}
            openDropdown={openDropdown}
            setOpenDropdown={setOpenDropdown}
            setSelectedModel={setSelectedModel}
            setSelectedCollection={setSelectedCollection}
            copyShareLink={copyShareLink}
            exportSession={exportSession}
            clearConversation={clearConversation}
            isReady={isReady}
            isLoading={isLoading}
          />
        </section>

        {activeMobileNav === "explore" ? (
          <FilterBar
            activeFilter={activeFeedFilter}
            setActiveFilter={setActiveFeedFilter}
            totalDocuments={feedTotal}
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
        {chatSessionsStatus === "error" ? (
          <p className="statusLine error" role="alert">
            {chatSessionsError}
          </p>
        ) : null}

        {activeMobileNav === "history" ? (
          <ChatHistoryPanel
            sessions={chatSessions}
            status={chatSessionsStatus}
            currentSessionId={currentSessionId}
            pendingDeleteSessionId={pendingDeleteSessionId}
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
            authMode={authMode}
            setAuthMode={setAuthMode}
            statusText={statusText}
            displayName={loginName}
            email={loginEmail}
            password={loginPassword}
            setDisplayName={setLoginName}
            setEmail={setLoginEmail}
            setPassword={setLoginPassword}
            onAuthSubmit={() => void submitAuth()}
            onMagicLink={() => void sendMagicLink()}
            onLogout={() => void logoutChat()}
            isBusy={authBusy}
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
            status={feedStatus}
            error={feedError}
            query={feedQuery}
            hasMore={Boolean(feedNextCursor)}
            isLoadingMore={isFeedLoadingMore}
            onAsk={askPaper}
            onOpen={(card) => void openPaperDetail(card)}
            onRetry={() => setFeedRefreshNonce((value) => value + 1)}
            onLoadMore={() => void loadMoreFeed()}
            onStatus={setStatusText}
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
          />
        )}
      </AppShell>
      <PaperDetailDrawer
        detail={paperDetail}
        status={paperDetailStatus}
        error={paperDetailError}
        onClose={closePaperDetail}
        onAsk={askPaper}
      />
    </div>
  );
}
