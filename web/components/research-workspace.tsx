"use client";

import {
  BookOpenCheck,
  Check,
  Circle,
  ClipboardCheck,
  Cpu,
  Download,
  FileSearch,
  FolderOpen,
  LayoutTemplate,
  LoaderCircle,
  Library,
  NotebookTabs,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CHAT_MODELS, DEFAULT_CHAT_MODEL, normalizeStoredChatModel, type ChatModel } from "@/lib/chat-models";
import { GlassMenuSelect, type GlassMenuOption } from "@/components/glass-menu-select";

export type ResearchWorkspacePaper = {
  id: string;
  source: string;
  title: string;
  paperCode?: string | null;
  collection: "" | "ce_project" | "ncce";
  discipline?: string | null;
  pageLabel: string;
  evidenceCount: number;
};

type WorkspaceColumn = {
  id: string;
  label: string;
  prompt: string;
  custom?: boolean;
};

type WorkspaceEvidence = {
  id: string;
  source: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  sectionTitle?: string | null;
  snippet: string;
};

export type ResearchWorkspaceEvidenceTarget = Pick<WorkspaceEvidence, "id" | "pageStart" | "pageEnd" | "sectionTitle">;

type WorkspaceCell = {
  columnId: string;
  value: string;
  confidence: "high" | "medium" | "low";
  status: "idle" | "running" | "ready" | "needs_review" | "error";
  review: "unreviewed" | "verified" | "needs_review";
  evidence: WorkspaceEvidence[];
};

type WorkspaceRow = ResearchWorkspacePaper & {
  cells: WorkspaceCell[];
};

type WorkspaceState = {
  version: "civilmcp-research-workspace-v1";
  workspaceId: string;
  title: string;
  template: WorkspaceTemplate;
  model: ChatModel;
  rows: WorkspaceRow[];
  columns: WorkspaceColumn[];
  selectedSources: string[];
  reviewProtocol: ReviewProtocol;
  screening: Record<string, ScreeningEntry>;
  updatedAt: string;
};

type WorkspaceTemplate = "literature_matrix" | "methods_audit" | "evidence_gap" | "prisma_scoping";
type ScreeningDecision = "pending" | "included" | "maybe" | "excluded";

type ReviewProtocol = {
  question: string;
  searchStrategy: string;
  inclusion: string;
  exclusion: string;
};

type ScreeningEntry = {
  decision: ScreeningDecision;
  reason: string;
};

type RunResponse = {
  version: "civilmcp-research-workspace-run-v1";
  workspaceId: string;
  runId: string;
  model: ChatModel;
  chargedCredits: number;
  rows: Array<{
    source: string;
    cells: Array<{
      columnId: string;
      value: string;
      confidence: "high" | "medium" | "low";
      status: "ready" | "needs_review";
      evidence: WorkspaceEvidence[];
    }>;
  }>;
  generatedAt: string;
};

type PrivateLibraryItem = {
  itemId: string;
  source: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  doi: string | null;
  canonicalUrl: string | null;
  importType: "pdf" | "doi" | "bibtex" | "ris" | "manual";
  pageCount: number;
};

const STORAGE_KEY = "civilmcp-research-workspace-v1";
const MODEL_OPTIONS = CHAT_MODELS;
const DEFAULT_REVIEW_PROTOCOL: ReviewProtocol = {
  question: "What does this evidence show, where does it disagree, and what remains uncertain?",
  searchStrategy: "Search Thai and English research terms in Seedy Research, then screen the bounded candidate set.",
  inclusion: "Relevant studies with page-level evidence.",
  exclusion: "Out of scope, duplicate, or insufficient evidence.",
};

function normalizeReviewProtocol(value?: ReviewProtocol): ReviewProtocol {
  return {
    question: !value?.question || value.question === "What does the selected Thai civil engineering evidence show, where does it disagree, and what remains uncertain?"
      ? DEFAULT_REVIEW_PROTOCOL.question
      : value.question,
    searchStrategy: value?.searchStrategy?.trim() || DEFAULT_REVIEW_PROTOCOL.searchStrategy,
    inclusion: !value?.inclusion || value.inclusion === "Civil engineering studies relevant to the review question with page-linked evidence in Seed Research."
      ? DEFAULT_REVIEW_PROTOCOL.inclusion
      : value.inclusion,
    exclusion: !value?.exclusion || value.exclusion === "Out of scope, duplicate, or insufficient evidence to answer the review question."
      ? DEFAULT_REVIEW_PROTOCOL.exclusion
      : value.exclusion,
  };
}

const TEMPLATE_COLUMNS: Record<WorkspaceTemplate, WorkspaceColumn[]> = {
  literature_matrix: [
    { id: "method", label: "Method", prompt: "Summarize the research design, data source, and analytical method." },
    { id: "sample", label: "Sample / context", prompt: "Extract the sample, study area, material, structure, or operational context." },
    { id: "finding", label: "Key finding", prompt: "State the strongest directly supported result without adding inference." },
    { id: "limitation", label: "Limitation", prompt: "Identify limitations stated or directly implied by the supplied evidence." },
    { id: "gap", label: "Research gap", prompt: "Name the smallest defensible unanswered question based on this paper." },
    { id: "applicability", label: "Thai applicability", prompt: "Explain the supported Thai context and where transfer to another setting would require validation." },
  ],
  methods_audit: [
    { id: "method", label: "Method", prompt: "Describe the method and research design precisely." },
    { id: "variables", label: "Variables", prompt: "Extract inputs, outputs, measured variables, and comparison conditions." },
    { id: "validation", label: "Validation", prompt: "Describe validation, calibration, controls, or performance checks." },
    { id: "limitation", label: "Validity risk", prompt: "Identify threats to internal, external, or measurement validity." },
  ],
  evidence_gap: [
    { id: "claim", label: "Claim", prompt: "State the main evidence-supported claim of this paper." },
    { id: "support", label: "Support", prompt: "Describe the exact evidence that supports the claim." },
    { id: "contradiction", label: "Contradiction", prompt: "Identify conflicting or qualifying evidence within the supplied packets; say none found when absent." },
    { id: "gap", label: "Evidence gap", prompt: "Identify what evidence remains missing before the claim can guide real-world decisions." },
    { id: "next_study", label: "Next study", prompt: "Propose the smallest study or validation that would close the identified gap." },
  ],
  prisma_scoping: [
    { id: "study_design", label: "Study design", prompt: "Identify the study design and data source using only supplied evidence." },
    { id: "context", label: "Context", prompt: "Extract the study area, population, asset, material, or operational context." },
    { id: "method", label: "Method", prompt: "Summarize the analytical, experimental, survey, or modelling method." },
    { id: "finding", label: "Key finding", prompt: "State the strongest directly supported finding without adding inference." },
    { id: "limitation", label: "Limitation", prompt: "Identify stated limitations or explain that the supplied evidence is insufficient." },
    { id: "gap", label: "Evidence gap", prompt: "Name the smallest defensible unanswered question revealed by this study." },
  ],
};

const TEMPLATE_LABELS: Record<WorkspaceTemplate, string> = {
  literature_matrix: "Scientific evidence snapshot",
  methods_audit: "Methods audit",
  evidence_gap: "Evidence gap map",
  prisma_scoping: "PRISMA scoping review",
};

const TEMPLATE_MENU_OPTIONS: ReadonlyArray<GlassMenuOption<WorkspaceTemplate>> = Object.entries(TEMPLATE_LABELS).map(
  ([value, label]) => ({
    value: value as WorkspaceTemplate,
    label,
    description: value === "prisma_scoping" ? "Protocol, screening, flow, and extraction" : undefined,
    badge: value === "prisma_scoping" ? "PRISMA-ScR" : undefined,
  }),
);

const MODEL_MENU_OPTIONS: ReadonlyArray<GlassMenuOption<ChatModel>> = MODEL_OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
  description: option.id === DEFAULT_CHAT_MODEL
    ? "OpenAI default · efficient batch extraction"
    : option.id.startsWith("gpt-") ? "OpenAI · unlocked for this preview" : "Optional fallback · unlocked",
  badge: option.id.startsWith("gpt-") ? "OPENAI" : undefined,
}));

function blankCell(columnId: string): WorkspaceCell {
  return { columnId, value: "", confidence: "low", status: "idle", review: "unreviewed", evidence: [] };
}

function normalizeRows(rows: ResearchWorkspacePaper[], columns: WorkspaceColumn[]): WorkspaceRow[] {
  return rows.map((row) => ({ ...row, cells: columns.map((column) => blankCell(column.id)) }));
}

function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceState>;
  return candidate.version === "civilmcp-research-workspace-v1"
    && typeof candidate.workspaceId === "string"
    && typeof candidate.title === "string"
    && Array.isArray(candidate.rows)
    && Array.isArray(candidate.columns)
    && Array.isArray(candidate.selectedSources);
}

function pageLabel(evidence: WorkspaceEvidence): string {
  if (evidence.pageStart == null || evidence.pageEnd == null) return "Page unavailable";
  return evidence.pageStart === evidence.pageEnd ? `p.${evidence.pageStart}` : `p.${evidence.pageStart}-${evidence.pageEnd}`;
}

function csvValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function fetchWorkspaceJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(payload.error || `Workspace request failed (${response.status}).`) as Error & { code?: string };
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function trackWorkspaceEvent(event: "workspace_started" | "workspace_run_completed" | "review_exported" | "verified_research_outcome", properties: Record<string, string | number | boolean> = {}) {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, properties }),
    keepalive: true,
  }).catch(() => undefined);
}

export function ResearchWorkspacePanel({
  papers,
  seedSources = [],
  caseId = null,
  authenticated,
  accessEnabled,
  onUpgrade,
  onOpenPaper,
  onToolBridge,
}: {
  papers: ResearchWorkspacePaper[];
  seedSources?: string[];
  caseId?: string | null;
  authenticated: boolean;
  accessEnabled: boolean;
  onUpgrade: (message: string) => void;
  onOpenPaper: (source: string, evidenceTarget?: ResearchWorkspaceEvidenceTarget) => void;
  onToolBridge?: (bridge: { caseId: string | null; send: (signal: AbortSignal) => Promise<{ version: number; sourceSnapshot: string[] }> } | null) => void;
}) {
  const defaultColumns = TEMPLATE_COLUMNS.literature_matrix;
  const [workspaceId, setWorkspaceId] = useState("workspace-local");
  const [title, setTitle] = useState("Thai research evidence matrix");
  const [template, setTemplate] = useState<WorkspaceTemplate>("literature_matrix");
  const [model, setModel] = useState<ChatModel>(DEFAULT_CHAT_MODEL);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [columns, setColumns] = useState<WorkspaceColumn[]>(defaultColumns);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [reviewProtocol, setReviewProtocol] = useState<ReviewProtocol>(DEFAULT_REVIEW_PROTOCOL);
  const [screening, setScreening] = useState<Record<string, ScreeningEntry>>({});
  const [ready, setReady] = useState(false);
  const [restoredLocally, setRestoredLocally] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customColumnOpen, setCustomColumnOpen] = useState(false);
  const [customColumnLabel, setCustomColumnLabel] = useState("");
  const [customColumnPrompt, setCustomColumnPrompt] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [privateItems, setPrivateItems] = useState<PrivateLibraryItem[]>([]);
  const [importType, setImportType] = useState<"doi" | "bibtex" | "ris">("doi");
  const [importValue, setImportValue] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [activeCell, setActiveCell] = useState<{ source: string; columnId: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "paused" | "saving" | "saved" | "error">("idle");
  const [statusText, setStatusText] = useState("Saved locally");
  const [runProgress, setRunProgress] = useState({ completed: 0, total: 0 });
  const [notebookPackBusy, setNotebookPackBusy] = useState(false);
  const appliedSeedRef = useRef("");
  const stopRunRef = useRef(false);
  const notebookTransferRef = useRef<AbortController | null>(null);
  useEffect(() => () => notebookTransferRef.current?.abort(), [caseId]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
      if (isWorkspaceState(parsed)) {
        setWorkspaceId(parsed.workspaceId);
        setTitle(parsed.title === "Thai civil engineering matrix"
          ? (parsed.template === "prisma_scoping" ? "Thai research scoping review" : "Thai research evidence matrix")
          : parsed.title);
        setTemplate(parsed.template);
        setModel(normalizeStoredChatModel(parsed.model));
        setRows(parsed.rows);
        setColumns(parsed.columns);
        setSelectedSources(parsed.selectedSources);
        setReviewProtocol(normalizeReviewProtocol(parsed.reviewProtocol));
        setScreening(parsed.screening ?? {});
        setRestoredLocally(true);
      } else {
        setWorkspaceId(`workspace-${crypto.randomUUID()}`);
      }
    } catch {
      setWorkspaceId(`workspace-${crypto.randomUUID()}`);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || rows.length || !papers.length) return;
    const requested = seedSources.length
      ? seedSources.map((source) => papers.find((paper) => paper.source === source)).filter((paper): paper is ResearchWorkspacePaper => Boolean(paper))
      : papers.slice(0, 4);
    const seeded = normalizeRows(requested.slice(0, 50), columns);
    setRows(seeded);
    setSelectedSources(seeded.map((row) => row.source));
  }, [columns, papers, ready, rows.length, seedSources]);

  useEffect(() => {
    if (!ready || !seedSources.length) return;
    const signature = seedSources.join("|");
    if (appliedSeedRef.current === signature) return;
    const requested = seedSources
      .map((source) => papers.find((paper) => paper.source === source))
      .filter((paper): paper is ResearchWorkspacePaper => Boolean(paper))
      .slice(0, 50);
    if (!requested.length) return;
    appliedSeedRef.current = signature;
    setRows((current) => {
      const existing = new Set(current.map((row) => row.source));
      const additions = requested.filter((paper) => !existing.has(paper.source));
      return [...current, ...normalizeRows(additions, columns)].slice(0, 50);
    });
    setSelectedSources((current) => [...new Set([...current, ...requested.map((paper) => paper.source)])].slice(0, 50));
    setStatusText(`${requested.length} saved papers ready to compare`);
  }, [columns, papers, ready, seedSources]);

  useEffect(() => {
    if (!ready) return;
    const state: WorkspaceState = {
      version: "civilmcp-research-workspace-v1",
      workspaceId,
      title,
      template,
      model,
      rows,
      columns,
      selectedSources,
      reviewProtocol,
      screening,
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (status === "idle") setStatusText("Saved locally");
    } catch {
      setStatusText("Local save unavailable");
    }
  }, [columns, model, ready, reviewProtocol, rows, screening, selectedSources, status, template, title, workspaceId]);

  useEffect(() => {
    if (!ready || restoredLocally || !authenticated) return;
    let cancelled = false;
    void fetchWorkspaceJson<{ workspaces: Array<{ state?: unknown }> }>("/api/research-workspaces")
      .then((payload) => {
        const saved = payload.workspaces.map((item) => item.state).find(isWorkspaceState);
        if (!saved || cancelled) return;
        setWorkspaceId(saved.workspaceId);
        setTitle(saved.title === "Thai civil engineering matrix"
          ? (saved.template === "prisma_scoping" ? "Thai research scoping review" : "Thai research evidence matrix")
          : saved.title);
        setTemplate(saved.template);
        setModel(normalizeStoredChatModel(saved.model));
        setRows(saved.rows);
        setColumns(saved.columns);
        setSelectedSources(saved.selectedSources);
        setReviewProtocol(normalizeReviewProtocol(saved.reviewProtocol));
        setScreening(saved.screening ?? {});
        setStatusText("Loaded synced workspace");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [authenticated, ready, restoredLocally]);

  useEffect(() => {
    if (!authenticated) {
      setPrivateItems([]);
      return;
    }
    void fetchWorkspaceJson<{ items: PrivateLibraryItem[] }>("/api/private-library")
      .then((payload) => setPrivateItems(payload.items))
      .catch(() => undefined);
  }, [authenticated]);

  const availablePapers = useMemo(() => [
    ...privateItems.map((item): ResearchWorkspacePaper => ({
      id: item.itemId,
      source: item.source,
      title: item.title,
      paperCode: "Private",
      collection: "",
      discipline: "private_source",
      pageLabel: item.pageCount ? `${item.pageCount} pages` : "Metadata only",
      evidenceCount: item.pageCount,
    })),
    ...papers,
  ], [papers, privateItems]);

  const selectedRows = useMemo(() => rows.filter((row) => selectedSources.includes(row.source)), [rows, selectedSources]);
  const prismaEnabled = template === "prisma_scoping";
  const runnableRows = useMemo(
    () => prismaEnabled ? selectedRows.filter((row) => screening[row.source]?.decision === "included") : selectedRows,
    [prismaEnabled, screening, selectedRows],
  );
  const prismaFlow = useMemo(() => {
    const entries = rows.map((row) => screening[row.source] ?? { decision: "pending" as const, reason: "" });
    const included = entries.filter((entry) => entry.decision === "included").length;
    const excluded = entries.filter((entry) => entry.decision === "excluded").length;
    const maybe = entries.filter((entry) => entry.decision === "maybe").length;
    return { identified: rows.length, screened: included + excluded + maybe, included, excluded, maybe, pending: rows.length - included - excluded - maybe };
  }, [rows, screening]);
  const protocolReady = Object.values(reviewProtocol).every((value) => value.trim().length >= 8);
  const screeningReady = rows.length > 0
    && prismaFlow.pending === 0
    && prismaFlow.maybe === 0
    && rows.every((row) => screening[row.source]?.decision !== "excluded" || Boolean(screening[row.source]?.reason.trim()));
  const activeRow = activeCell ? rows.find((row) => row.source === activeCell.source) : null;
  const activeColumn = activeCell ? columns.find((column) => column.id === activeCell.columnId) : null;
  const activeCellValue = activeRow && activeColumn ? activeRow.cells.find((cell) => cell.columnId === activeColumn.id) : null;
  const importCitation = async () => {
    if (!importValue.trim() || importBusy) return;
    setImportBusy(true);
    try {
      const payload = await fetchWorkspaceJson<{ item: PrivateLibraryItem }>("/api/private-library", {
        method: "POST",
        body: JSON.stringify({ importType, value: importValue }),
      });
      setPrivateItems((current) => [payload.item, ...current.filter((item) => item.itemId !== payload.item.itemId)]);
      setImportValue("");
      setStatusText("Private source imported");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Private source could not be imported.");
    } finally {
      setImportBusy(false);
    }
  };

  const importPdf = async (file: File | undefined) => {
    if (!file || importBusy) return;
    setImportBusy(true);
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/private-library", { method: "POST", body: form });
      const payload = await response.json() as { item?: PrivateLibraryItem; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error || "PDF could not be imported.");
      setPrivateItems((current) => [payload.item!, ...current]);
      setStatusText(`${payload.item.title} imported with ${payload.item.pageCount} private pages`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "PDF could not be imported.");
    } finally {
      setImportBusy(false);
    }
  };

  const removePrivateItem = async (item: PrivateLibraryItem) => {
    try {
      await fetchWorkspaceJson(`/api/private-library?itemId=${encodeURIComponent(item.itemId)}`, { method: "DELETE" });
      setPrivateItems((current) => current.filter((candidate) => candidate.itemId !== item.itemId));
      setRows((current) => current.filter((row) => row.source !== item.source));
      setSelectedSources((current) => current.filter((source) => source !== item.source));
      setStatusText("Private source removed");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Private source could not be removed.");
    }
  };

  const applyTemplate = (nextTemplate: WorkspaceTemplate) => {
    const nextColumns = TEMPLATE_COLUMNS[nextTemplate];
    setTemplate(nextTemplate);
    setColumns(nextColumns);
    setRows((current) => current.map((row) => ({ ...row, cells: nextColumns.map((column) => blankCell(column.id)) })));
    if (nextTemplate === "prisma_scoping" && title === "Thai research evidence matrix") {
      setTitle("Thai research scoping review");
    }
    setActiveCell(null);
    setStatus("idle");
    setStatusText(`${TEMPLATE_LABELS[nextTemplate]} ready`);
  };

  const togglePaper = (paper: ResearchWorkspacePaper) => {
    setRows((current) => {
      const exists = current.some((row) => row.source === paper.source);
      return exists ? current.filter((row) => row.source !== paper.source) : [...current, ...normalizeRows([paper], columns)].slice(0, 50);
    });
    setSelectedSources((current) => current.includes(paper.source) ? current.filter((source) => source !== paper.source) : [...current, paper.source].slice(0, 50));
  };

  const addCustomColumn = () => {
    const label = customColumnLabel.trim();
    const prompt = customColumnPrompt.trim();
    if (!label || prompt.length < 8 || columns.length >= 6) return;
    const idBase = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "custom";
    const column = { id: `${idBase}_${Date.now().toString(36)}`, label: label.slice(0, 80), prompt: prompt.slice(0, 500), custom: true };
    setColumns((current) => [...current, column]);
    setRows((current) => current.map((row) => ({ ...row, cells: [...row.cells, blankCell(column.id)] })));
    setCustomColumnLabel("");
    setCustomColumnPrompt("");
    setCustomColumnOpen(false);
  };

  const removeColumn = (columnId: string) => {
    setColumns((current) => current.filter((column) => column.id !== columnId));
    setRows((current) => current.map((row) => ({ ...row, cells: row.cells.filter((cell) => cell.columnId !== columnId) })));
    if (activeCell?.columnId === columnId) setActiveCell(null);
  };

  const updateReview = (source: string, columnId: string, review: WorkspaceCell["review"]) => {
    setRows((current) => current.map((row) => row.source !== source ? row : {
      ...row,
      cells: row.cells.map((cell) => cell.columnId === columnId ? { ...cell, review } : cell),
    }));
  };

  const updateScreening = (source: string, decision: ScreeningDecision, reason?: string) => {
    setScreening((current) => ({
      ...current,
      [source]: {
        decision,
        reason: reason ?? (decision === "excluded" ? current[source]?.reason ?? "" : ""),
      },
    }));
  };

  const runResearch = async (runRows = runnableRows, runColumns = columns) => {
    if (!accessEnabled) {
      onUpgrade("Research Workspace is temporarily unavailable.");
      return;
    }
    if (!runRows.length || !runColumns.length || status === "running") return;
    const boundedRows = runRows.slice(0, 50);
    const runSources = new Set(boundedRows.map((row) => row.source));
    const runColumnIds = new Set(runColumns.map((column) => column.id));
    stopRunRef.current = false;
    setRunProgress({ completed: 0, total: boundedRows.length });
    setStatus("running");
    setStatusText(`Running ${boundedRows.length} papers in ${Math.ceil(boundedRows.length / 6)} bounded batches`);
    trackWorkspaceEvent("workspace_started", { papers: boundedRows.length, columns: runColumns.length, template });
    setRows((current) => current.map((row) => !runSources.has(row.source) ? row : {
      ...row,
      cells: row.cells.map((cell) => runColumnIds.has(cell.columnId) ? { ...cell, status: "running", review: "unreviewed" } : cell),
    }));
    let workingRows = rows.map((row) => !runSources.has(row.source) ? row : {
      ...row,
      cells: row.cells.map((cell) => runColumnIds.has(cell.columnId) ? { ...cell, status: "running" as const, review: "unreviewed" as const } : cell),
    });
    let completedPapers = 0;
    try {
      for (let offset = 0; offset < boundedRows.length; offset += 6) {
        if (stopRunRef.current) break;
        const batch = boundedRows.slice(offset, offset + 6);
        const payload = await fetchWorkspaceJson<RunResponse>("/api/research-workspaces", {
          method: "POST",
          body: JSON.stringify({
            action: "run",
            workspaceId,
            runId: `run-${crypto.randomUUID()}`,
            title,
            model,
            rows: batch.map(({ source, title: paperTitle, paperCode, collection }) => ({ source, title: paperTitle, paperCode, collection })),
            columns: runColumns.slice(0, 6).map(({ id, label, prompt }) => ({ id, label, prompt })),
          }),
        });
        completedPapers += batch.length;
        const resultBySource = new Map(payload.rows.map((row) => [row.source, row]));
        workingRows = workingRows.map((row) => {
          const result = resultBySource.get(row.source);
          if (!result) return row;
          return {
            ...row,
            cells: row.cells.map((cell) => {
              const generated = result.cells.find((item) => item.columnId === cell.columnId);
              return generated ? { ...generated, review: "unreviewed" as const } : cell;
            }),
          };
        });
        setRows(workingRows);
        setRunProgress({ completed: completedPapers, total: boundedRows.length });
        if (authenticated) {
          const state: WorkspaceState = {
            version: "civilmcp-research-workspace-v1", workspaceId, title, template, model,
            rows: workingRows, columns, selectedSources, reviewProtocol, screening, updatedAt: new Date().toISOString(),
          };
          await fetchWorkspaceJson("/api/research-workspaces", {
            method: "POST",
          body: JSON.stringify({ action: "save", workspaceId, caseId, title, collection: "", paperSources: workingRows.map((row) => row.source), state }),
          });
        }
      }
      if (stopRunRef.current) {
        workingRows = workingRows.map((row) => ({ ...row, cells: row.cells.map((cell) => cell.status === "running" ? { ...cell, status: "idle" as const } : cell) }));
        setRows(workingRows);
        setStatus("paused");
        setStatusText(`Paused after ${completedPapers} of ${boundedRows.length} papers · select remaining papers and run again`);
      } else {
        setStatus("saved");
        setStatusText("Review run complete · verify generated cells against the linked pages");
        trackWorkspaceEvent("workspace_run_completed", { papers: boundedRows.length, columns: runColumns.length, model, openAccess: true });
      }
    } catch (error) {
      setRows(workingRows.map((row) => !runSources.has(row.source) ? row : {
        ...row, cells: row.cells.map((cell) => runColumnIds.has(cell.columnId) && cell.status === "running" ? { ...cell, status: "error" as const } : cell),
      }));
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Automated research run failed.");
    }
  };

  const saveWorkspace = async (signal?: AbortSignal): Promise<boolean> => {
    if (!authenticated) {
      setStatus("saved");
      setStatusText("Workspace saved locally · sign in only for cross-device sync");
      return false;
    }
    setStatus("saving");
    setStatusText("Saving workspace...");
    const state: WorkspaceState = {
      version: "civilmcp-research-workspace-v1",
      workspaceId,
      title,
      template,
      model,
      rows,
      columns,
      selectedSources,
      reviewProtocol,
      screening,
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetchWorkspaceJson("/api/research-workspaces", {
        method: "POST",
        signal,
        body: JSON.stringify({
          action: "save",
          workspaceId,
          caseId,
          title,
          collection: "",
          paperSources: rows.map((row) => row.source),
          state,
        }),
      });
      setStatus("saved");
      setStatusText("Workspace synced to your account");
      return true;
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Workspace could not be synced.");
      return false;
    }
  };

  const exportWorkspace = () => {
    const headers = [
      "Paper",
      "Source",
      ...(prismaEnabled ? ["Screening decision", "Exclusion reason"] : []),
      ...columns.flatMap((column) => [column.label, `${column.label} sources`, `${column.label} review`]),
    ];
    const lines = [headers.map(csvValue).join(",")];
    for (const row of rows) {
      const values = columns.flatMap((column) => {
        const cell = row.cells.find((item) => item.columnId === column.id);
        const sources = cell?.evidence.map((item) => `${item.source} ${pageLabel(item)}`).join("; ") ?? "";
        return [cell?.value ?? "", sources, cell?.review ?? "unreviewed"];
      });
      const screeningValues = prismaEnabled ? [screening[row.source]?.decision ?? "pending", screening[row.source]?.reason ?? ""] : [];
      lines.push([row.title, row.source, ...screeningValues, ...values].map(csvValue).join(","));
    }
    downloadText(`seed-research-workspace-${Date.now()}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
    setStatusText("Workspace exported with source columns");
    trackWorkspaceEvent("review_exported", { format: "csv", papers: rows.length, template });
    const verifiedCells = rows.flatMap((row) => row.cells).filter((cell) => cell.review === "verified" && cell.evidence.some((item) => item.pageStart != null)).length;
    if (verifiedCells) trackWorkspaceEvent("verified_research_outcome", { format: "csv", papers: rows.length, verifiedCells, template });
  };

  const exportPrismaReview = () => {
    const tableHeader = ["Paper", "Decision", ...columns.map((column) => column.label), "Human review"];
    const tableRows = rows.map((row) => {
      const entry = screening[row.source] ?? { decision: "pending", reason: "" };
      const values = columns.map((column) => row.cells.find((cell) => cell.columnId === column.id)?.value || "Not extracted");
      const reviewState = row.cells.some((cell) => cell.review === "needs_review")
        ? "Needs review"
        : row.cells.length && row.cells.every((cell) => cell.review === "verified")
          ? "Verified"
          : "Unreviewed";
      return [row.title, entry.decision, ...values, reviewState]
        .map((value) => value.replaceAll("|", "/").replace(/\s+/g, " ").trim())
        .join(" | ");
    });
    const provenance = rows.flatMap((row) => columns.flatMap((column) => {
      const cell = row.cells.find((item) => item.columnId === column.id);
      return (cell?.evidence ?? []).map((item) => `- **${row.title} · ${column.label}:** ${item.source} · ${pageLabel(item)}${item.sectionTitle ? ` · ${item.sectionTitle}` : ""}`);
    }));
    const lines = [
      `# ${title}`,
      "",
      "> PRISMA-guided scoping review of a bounded Seedy Research candidate set. Human verification is required; this export does not imply PRISMA endorsement or certification.",
      "",
      "## Protocol",
      `- Review question: ${reviewProtocol.question.trim()}`,
      `- Search strategy: ${reviewProtocol.searchStrategy.trim()}`,
      `- Inclusion criteria: ${reviewProtocol.inclusion.trim()}`,
      `- Exclusion criteria: ${reviewProtocol.exclusion.trim()}`,
      "- Database: Seedy Research Thai-first evidence corpus",
      `- Workspace ID: ${workspaceId}`,
      `- Extraction model: ${model}`,
      `- Exported: ${new Date().toISOString()}`,
      "",
      "## Flow",
      `- Candidate records: ${prismaFlow.identified}`,
      "- Duplicates removed: 0 (candidate sources are unique within Seedy Research)",
      `- Screened: ${prismaFlow.screened}`,
      `- Excluded: ${prismaFlow.excluded}`,
      `- Included for extraction: ${prismaFlow.included}`,
      `- Awaiting decision: ${prismaFlow.pending + prismaFlow.maybe}`,
      "",
      "## Screening log",
      ...rows.map((row) => {
        const entry = screening[row.source] ?? { decision: "pending", reason: "" };
        return `- **${row.title}** — ${entry.decision}${entry.reason ? `: ${entry.reason}` : ""} (${row.source})`;
      }),
      "",
      "## Extraction matrix",
      "",
      `| ${tableHeader.join(" | ")} |`,
      `| ${tableHeader.map(() => "---").join(" | ")} |`,
      ...tableRows.map((row) => `| ${row} |`),
      "",
      "## Exact-page provenance",
      "",
      ...(provenance.length ? provenance : ["- No extracted evidence packets are attached yet."]),
      "",
      "## Checklist readiness",
      `- Protocol captured: ${protocolReady ? "yes" : "no"}`,
      `- Screening complete with exclusion reasons: ${screeningReady ? "yes" : "no"}`,
      `- Included studies extracted: ${runnableRows.length > 0 && runnableRows.every((row) => row.cells.some((cell) => cell.status === "ready" || cell.status === "needs_review")) ? "yes" : "no"}`,
    ];
    downloadText(`seed-research-prisma-scoping-review-${Date.now()}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
    setStatusText("PRISMA review log exported");
    trackWorkspaceEvent("review_exported", { format: "markdown", papers: rows.length, template });
    const verifiedCells = rows.flatMap((row) => row.cells).filter((cell) => cell.review === "verified" && cell.evidence.some((item) => item.pageStart != null)).length;
    if (verifiedCells) trackWorkspaceEvent("verified_research_outcome", { format: "markdown", papers: rows.length, verifiedCells, template });
  };

  const extractedPapers = rows.filter((row) => row.cells.some((cell) => cell.status === "ready" || cell.status === "needs_review")).length;
  const reviewedPapers = rows.filter((row) => row.cells.length > 0 && row.cells.every((cell) => cell.review === "verified")).length;
  const verifiedEvidenceCells = rows.flatMap((row) => row.cells).filter((cell) => cell.review === "verified" && cell.evidence.some((item) => item.pageStart != null)).length;

  const sendReviewedToNotebook = async (signal?: AbortSignal) => {
    if (!authenticated) {
      onUpgrade("Sign in to send reviewed Workspace evidence to Notebook.");
      throw new Error("Sign in to send reviewed Workspace evidence to Notebook.");
    }
    if (!caseId) {
      setStatusText("Start or resume a Research Case before sending reviewed evidence to Notebook.");
      throw new Error("Start or resume a Research Case first.");
    }
    if (!verifiedEvidenceCells) throw new Error("A person must verify at least one exact-page cell in Workspace first.");
    if (notebookTransferRef.current || notebookPackBusy || status === "running") throw new Error("Workspace is busy. Wait for its current action.");
    if (signal && rows.some((row) => row.source.startsWith("private:"))) throw new Error("Private workspaces remain in the human interface; site tools cannot transfer them.");
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    notebookTransferRef.current = controller;
    setNotebookPackBusy(true);
    setStatus("saving");
    setStatusText("Preparing reviewed evidence for Notebook…");
    try {
      const saved = await saveWorkspace(controller.signal);
      if (!saved) throw new Error("Workspace could not be saved. No evidence pack was sent.");
      controller.signal.throwIfAborted();
      const payload = await fetchWorkspaceJson<{ pack: { version: number; sourceSnapshot: string[] } }>("/api/research-notebooks", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ action: "workspace_pack", caseId, workspaceId }),
      });
      controller.signal.throwIfAborted();
      setStatus("saved");
      setStatusText(`Workspace Evidence Pack v${payload.pack.version} sent to Notebook · ${payload.pack.sourceSnapshot.length} reviewed sources`);
      return payload.pack;
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Reviewed evidence could not be sent to Notebook.");
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (notebookTransferRef.current === controller) notebookTransferRef.current = null;
      setNotebookPackBusy(false);
    }
  };
  useEffect(() => {
    onToolBridge?.(ready && authenticated && accessEnabled ? { caseId, send: sendReviewedToNotebook } : null);
    return () => onToolBridge?.(null);
  });
  const workflowStages = [
    { label: "Scope", complete: protocolReady },
    { label: "Find", complete: rows.length > 0 },
    { label: "Screen", complete: prismaEnabled ? screeningReady : selectedRows.length > 0 },
    { label: "Extract", complete: extractedPapers > 0 },
    { label: "Review", complete: reviewedPapers > 0 },
    { label: "Export", complete: false },
  ];

  return (
    <section
      className="researchWorkspace"
      aria-label="Open Access Research Workspace"
    >
      <div className="workspaceCommandSurface">
        <header className="researchWorkspaceHeader">
          <div>
            <div className="workspaceTitleLine">
              <span className="workspaceEyebrow">Verified Review Project</span>
              <span className="workspaceProBadge">Open review tools</span>
              {prismaEnabled ? <span className="workspaceStandardBadge">PRISMA-ScR</span> : null}
            </div>
            <input aria-label="Workspace title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
            <p>{prismaEnabled ? "Scope, screen, extract, verify, and export one defensible review." : "Build scientific evidence snapshots with exact-page provenance."}</p>
          </div>
          <div className="workspaceHeaderStatus" aria-live="polite">
            {status === "running" || status === "saving" ? <LoaderCircle size={15} className="workspaceSpinner" aria-hidden /> : status === "saved" ? <Check size={15} aria-hidden /> : null}
            <span>{statusText}</span>
          </div>
        </header>

        <div className="workspaceToolbar" aria-label="Research workspace controls">
          <GlassMenuSelect
            label="Template"
            value={template}
            options={TEMPLATE_MENU_OPTIONS}
            onChange={applyTemplate}
            icon={LayoutTemplate}
            className="workspaceGlassSelect"
          />
          <GlassMenuSelect
            label="Model"
            value={model}
            options={MODEL_MENU_OPTIONS}
            onChange={setModel}
            icon={Cpu}
            className="workspaceGlassSelect"
          />
          <button type="button" onClick={() => setPickerOpen((value) => !value)} aria-expanded={pickerOpen}>
            <FolderOpen size={16} aria-hidden />
            <span>Papers</span>
            <strong>{rows.length}</strong>
          </button>
          <button type="button" onClick={() => authenticated ? setLibraryOpen((value) => !value) : onUpgrade("Sign in to import private research sources.")} aria-expanded={libraryOpen}>
            <Library size={16} aria-hidden />
            <span>Private sources</span>
            {privateItems.length ? <strong>{privateItems.length}</strong> : null}
          </button>
          <button type="button" onClick={() => setCustomColumnOpen((value) => !value)} disabled={columns.length >= 6} aria-expanded={customColumnOpen}>
            <Plus size={16} aria-hidden />
            <span>Add column</span>
          </button>
          <button type="button" onClick={() => void saveWorkspace()}>
            <Save size={16} aria-hidden />
            <span>Save</span>
          </button>
          <button type="button" onClick={() => void sendReviewedToNotebook().catch(() => undefined)} disabled={notebookPackBusy || !verifiedEvidenceCells} title={!caseId ? "Start a Research Case first" : "Send only human-verified exact-page cells"}>
            {notebookPackBusy ? <LoaderCircle size={16} className="workspaceSpinner" aria-hidden /> : <NotebookTabs size={16} aria-hidden />}
            <span>{notebookPackBusy ? "Sending…" : "Send reviewed to Notebook"}</span>
            {verifiedEvidenceCells ? <strong>{verifiedEvidenceCells}</strong> : null}
          </button>
          <button type="button" onClick={prismaEnabled ? exportPrismaReview : exportWorkspace} disabled={!rows.length}>
            <Download size={16} aria-hidden />
            <span>{prismaEnabled ? "Export PRISMA" : "Export CSV"}</span>
          </button>
          <button
            className="workspaceRunButton"
            type="button"
            onClick={() => status === "running" ? (stopRunRef.current = true) : void runResearch()}
            disabled={status !== "running" && (!accessEnabled || !runnableRows.length || !columns.length)}
          >
            {status === "running" ? <Square size={15} aria-hidden /> : <Sparkles size={16} aria-hidden />}
            <span>{status === "running" ? "Stop after batch" : prismaEnabled ? "Run included" : "Run selected"}</span>
            {runnableRows.length ? <strong>{runnableRows.length} paper{runnableRows.length === 1 ? "" : "s"}</strong> : null}
          </button>
        </div>
      </div>

      {libraryOpen ? (
        <section className="privateLibraryPanel" aria-label="Private project library">
          <header>
            <div><span className="workspaceEyebrow">Private Project Library</span><strong>Bring your own research into the same review.</strong></div>
            <small>Visible only to your account · never added to the public corpus</small>
          </header>
          <div className="privateImportGrid">
            <label className="privatePdfImport">
              <Upload size={18} aria-hidden />
              <span><strong>Upload PDF</strong><small>Up to 12 MB / 200 pages</small></span>
              <input type="file" accept="application/pdf" disabled={importBusy} onChange={(event) => void importPdf(event.target.files?.[0])} />
            </label>
            <div className="privateCitationImport">
              <div role="group" aria-label="Citation import type">
                {(["doi", "bibtex", "ris"] as const).map((type) => <button key={type} type="button" className={importType === type ? "selected" : ""} onClick={() => setImportType(type)}>{type.toUpperCase()}</button>)}
              </div>
              <textarea value={importValue} onChange={(event) => setImportValue(event.target.value)} rows={3} maxLength={40_000} placeholder={importType === "doi" ? "10.xxxx/xxxxx" : `Paste ${importType.toUpperCase()} metadata`} />
              <button type="button" onClick={() => void importCitation()} disabled={importBusy || importValue.trim().length < 3}>{importBusy ? "Importing…" : "Import source"}</button>
            </div>
          </div>
          {privateItems.length ? (
            <div className="privateLibraryList">
              {privateItems.map((item) => (
                <article key={item.itemId}>
                  <div><span>{item.importType.toUpperCase()} · {item.pageCount ? `${item.pageCount} pages` : "metadata"}</span><strong>{item.title}</strong><small>{[item.publicationYear, item.authors.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || "Private source"}</small></div>
                  <button type="button" aria-label={`Remove ${item.title}`} onClick={() => void removePrivateItem(item)}><Trash2 size={15} aria-hidden /></button>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="verifiedReviewFlow" aria-label="Verified review workflow">
        <ol>
          {workflowStages.map((stage, index) => (
            <li key={stage.label} className={stage.complete ? "complete" : index === workflowStages.findIndex((item) => !item.complete) ? "active" : ""}>
              <span>{stage.complete ? <Check size={13} aria-hidden /> : index + 1}</span>
              {stage.label}
            </li>
          ))}
        </ol>
        <div>
          <span>{rows.length} papers</span>
          <span>{extractedPapers} extracted</span>
          <span>{reviewedPapers} verified</span>
        </div>
      </section>

      {status === "running" && runProgress.total > 0 ? (
        <div className="workspaceRunProgress" role="status" aria-live="polite">
          <span style={{ width: `${Math.round((runProgress.completed / runProgress.total) * 100)}%` }} />
          <strong>{runProgress.completed}/{runProgress.total} papers</strong>
          <small>Bounded batches protect reliability · signed-in progress syncs after each batch</small>
        </div>
      ) : null}

      {pickerOpen ? (
        <section className="workspacePaperPicker" aria-label="Add papers to workspace">
          <div><strong>Add papers</strong><span>Choose up to 50. Seedy Research processes six at a time and saves each batch.</span></div>
          <div className="workspacePaperOptions">
            {availablePapers.slice(0, 50).map((paper) => {
              const included = rows.some((row) => row.source === paper.source);
              return (
                <button key={paper.source} type="button" className={included ? "selected" : ""} aria-pressed={included} onClick={() => togglePaper(paper)}>
                  <span>{paper.paperCode || paper.collection.toUpperCase()}</span>
                  <strong>{paper.title}</strong>
                  <small>{paper.pageLabel} · {paper.evidenceCount} evidence</small>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {customColumnOpen ? (
        <section className="workspaceColumnBuilder" aria-label="Add AI research column">
          <label><span>Column name</span><input value={customColumnLabel} maxLength={80} onChange={(event) => setCustomColumnLabel(event.target.value)} placeholder="e.g. Safety factor" /></label>
          <label><span>Instruction</span><input value={customColumnPrompt} maxLength={500} onChange={(event) => setCustomColumnPrompt(event.target.value)} placeholder="Extract the reported safety factor and its test condition." /></label>
          <button type="button" onClick={addCustomColumn} disabled={!customColumnLabel.trim() || customColumnPrompt.trim().length < 8}>Add column</button>
        </section>
      ) : null}

      {prismaEnabled ? (
        <section className="prismaWorkspace" aria-label="PRISMA-guided scoping review">
          <header className="prismaWorkspaceHeader">
            <div>
              <span><BookOpenCheck size={16} aria-hidden /> Review protocol</span>
              <strong>Screen first. Extract included studies.</strong>
            </div>
            <small>PRISMA-ScR · Seedy Research corpus</small>
          </header>

          <div className="prismaOverview">
            <div className="prismaProtocol">
              <label>
                <span>Review question</span>
                <textarea value={reviewProtocol.question} maxLength={600} rows={2} onChange={(event) => setReviewProtocol((current) => ({ ...current, question: event.target.value }))} />
              </label>
              <label>
                <span>Search strategy</span>
                <textarea value={reviewProtocol.searchStrategy} maxLength={800} rows={2} onChange={(event) => setReviewProtocol((current) => ({ ...current, searchStrategy: event.target.value }))} />
              </label>
              <div>
                <label>
                  <span>Include if</span>
                  <textarea value={reviewProtocol.inclusion} maxLength={600} rows={3} onChange={(event) => setReviewProtocol((current) => ({ ...current, inclusion: event.target.value }))} />
                </label>
                <label>
                  <span>Exclude if</span>
                  <textarea value={reviewProtocol.exclusion} maxLength={600} rows={3} onChange={(event) => setReviewProtocol((current) => ({ ...current, exclusion: event.target.value }))} />
                </label>
              </div>
            </div>

            <div className="prismaStatus" aria-label="PRISMA flow status">
              <div className="prismaFlow">
                <span aria-label={`Candidates ${prismaFlow.identified}`}><strong>{prismaFlow.identified}</strong>Candidates</span>
                <span aria-label={`Screened ${prismaFlow.screened}`}><strong>{prismaFlow.screened}</strong>Screened</span>
                <span aria-label={`Excluded ${prismaFlow.excluded}`}><strong>{prismaFlow.excluded}</strong>Excluded</span>
                <span aria-label={`Included ${prismaFlow.included}`}><strong>{prismaFlow.included}</strong>Included</span>
              </div>
              <div className="prismaChecklist">
                <span className={protocolReady ? "complete" : ""}>{protocolReady ? <Check size={14} aria-hidden /> : <Circle size={14} aria-hidden />}Protocol ready</span>
                <span className={screeningReady ? "complete" : ""}>{screeningReady ? <Check size={14} aria-hidden /> : <Circle size={14} aria-hidden />}Screening complete</span>
                <span className={prismaFlow.included > 0 ? "complete" : ""}>{prismaFlow.included > 0 ? <Check size={14} aria-hidden /> : <Circle size={14} aria-hidden />}Studies selected</span>
              </div>
              <p>Scope: selected Seedy Research papers. Add external databases before treating this as a comprehensive systematic review.</p>
            </div>
          </div>

          <div className="prismaScreening">
            <div className="prismaScreeningHeading">
              <span><ClipboardCheck size={16} aria-hidden /> Screen papers</span>
              <small>{prismaFlow.pending} to review · {prismaFlow.maybe} maybe</small>
            </div>
            <div className="prismaScreeningRows">
              {rows.map((row) => {
                const entry = screening[row.source] ?? { decision: "pending" as const, reason: "" };
                return (
                  <article key={row.source} className={`prismaScreeningRow ${entry.decision}`}>
                    <div>
                      <span>{row.paperCode || (row.collection === "ncce" ? "NCCE" : "Student Transport")}</span>
                      <strong>{row.title}</strong>
                    </div>
                    <div className="prismaDecisionGroup" role="group" aria-label={`Screen ${row.title}`}>
                      {(["included", "maybe", "excluded"] as const).map((decision) => (
                        <button key={decision} type="button" className={entry.decision === decision ? "selected" : ""} aria-pressed={entry.decision === decision} onClick={() => updateScreening(row.source, decision)}>
                          {decision === "included" ? "Include" : decision === "maybe" ? "Maybe" : "Exclude"}
                        </button>
                      ))}
                    </div>
                    {entry.decision === "excluded" ? (
                      <input aria-label={`Exclusion reason for ${row.title}`} value={entry.reason} maxLength={240} onChange={(event) => updateScreening(row.source, "excluded", event.target.value)} placeholder="Why was this paper excluded?" />
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <div className="workspaceProNotice workspaceOpenAccessNotice" role="note">
        <ShieldCheck size={18} aria-hidden />
        <span><strong>Open review tools.</strong> Batch research and every model are unlocked; Notebook answers and private sources require sign-in for owner isolation. Rate and agent budgets remain for service reliability.</span>
      </div>

      <div className={`workspaceSurface ${activeCell ? "withInspector" : ""}`}>
        <div className="workspaceTableWrap">
          <table className="workspaceTable">
            <thead>
              <tr>
                <th className="workspaceSelectColumn">
                  <input
                    type="checkbox"
                    aria-label="Select all workspace papers"
                    checked={rows.length > 0 && selectedSources.length === rows.length}
                    onChange={(event) => setSelectedSources(event.target.checked ? rows.map((row) => row.source) : [])}
                  />
                </th>
                <th className="workspacePaperColumn">Paper</th>
                {columns.map((column) => (
                  <th key={column.id}>
                    <span>{column.label}</span>
                    {column.custom ? <button type="button" aria-label={`Remove ${column.label} column`} onClick={() => removeColumn(column.id)}><X size={13} aria-hidden /></button> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={row.source}>
                  <td className="workspaceSelectColumn">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.title}`}
                      checked={selectedSources.includes(row.source)}
                      onChange={() => setSelectedSources((current) => current.includes(row.source) ? current.filter((source) => source !== row.source) : [...current, row.source])}
                    />
                  </td>
                  <th scope="row" className="workspacePaperColumn">
                    <button type="button" onClick={() => onOpenPaper(row.source)}>
                      <span>{row.paperCode || (row.collection === "ncce" ? "NCCE" : "Student Transport")}</span>
                      <strong>{row.title}</strong>
                      <small>{row.pageLabel} · {row.evidenceCount} evidence{prismaEnabled ? ` · ${screening[row.source]?.decision ?? "pending"}` : ""}</small>
                    </button>
                  </th>
                  {columns.map((column) => {
                    const cell = row.cells.find((item) => item.columnId === column.id) ?? blankCell(column.id);
                    return (
                      <td key={column.id}>
                        <button
                          type="button"
                          className={`workspaceCell ${cell.status} ${cell.review}`}
                          aria-label={`${column.label} for ${row.title}`}
                          onClick={() => setActiveCell({ source: row.source, columnId: column.id })}
                        >
                          {cell.status === "running" ? <><LoaderCircle size={14} className="workspaceSpinner" aria-hidden /><span>Running...</span></> : null}
                          {cell.status === "idle" ? <span className="workspaceCellEmpty">Run column</span> : null}
                          {cell.status === "error" ? <span className="workspaceCellError">Run failed</span> : null}
                          {cell.status === "ready" || cell.status === "needs_review" ? (
                            <>
                              <span>{cell.value}</span>
                              <small>{cell.evidence.length} source{cell.evidence.length === 1 ? "" : "s"} · {cell.review.replace("_", " ")}</small>
                            </>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              )) : (
                <tr><td colSpan={columns.length + 2}><div className="workspaceEmpty"><FileSearch size={22} aria-hidden /><strong>Add papers to begin</strong><span>Use the Papers control to build a batch research set.</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {activeRow && activeColumn && activeCellValue ? (
          <aside className="workspaceInspector" aria-label="Cell evidence inspector">
            <header>
              <div><span>{activeColumn.label}</span><strong>{activeRow.paperCode || activeRow.title}</strong></div>
              <button type="button" aria-label="Close cell inspector" onClick={() => setActiveCell(null)}><X size={17} aria-hidden /></button>
            </header>
            <p className="workspaceInspectorValue">{activeCellValue.value || "This cell has not been generated yet."}</p>
            <div className="workspaceInspectorMeta">
              <span>Confidence · {activeCellValue.confidence}</span>
              <span>Review · {activeCellValue.review.replace("_", " ")}</span>
            </div>
            <section>
              <strong>Exact-page evidence</strong>
              {activeCellValue.evidence.length ? activeCellValue.evidence.map((evidence) => (
                <button key={evidence.id} type="button" onClick={() => onOpenPaper(evidence.source, evidence)}>
                  <span>[{evidence.id}] {pageLabel(evidence)}</span>
                  <strong>{evidence.sectionTitle || "Indexed evidence"}</strong>
                  <small>{evidence.snippet}</small>
                </button>
              )) : <p>No page-linked evidence is attached to this cell.</p>}
            </section>
            <div className="workspaceReviewActions">
              <button type="button" className={activeCellValue.review === "verified" ? "selected" : ""} onClick={() => updateReview(activeRow.source, activeColumn.id, "verified")}><Check size={15} aria-hidden />Verified</button>
              <button type="button" className={activeCellValue.review === "needs_review" ? "selected" : ""} onClick={() => updateReview(activeRow.source, activeColumn.id, "needs_review")}><FileSearch size={15} aria-hidden />Needs review</button>
              <button type="button" onClick={() => void runResearch([activeRow], [activeColumn])}><RefreshCw size={15} aria-hidden />Retry cell</button>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
