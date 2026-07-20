"use client";

import {
  Check,
  ChevronDown,
  Download,
  FileSearch,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CHAT_MODELS, type ChatModel } from "@/lib/chat-models";

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
  updatedAt: string;
};

type WorkspaceTemplate = "literature_matrix" | "methods_audit" | "evidence_gap";

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

const STORAGE_KEY = "civilmcp-research-workspace-v1";
const MODEL_OPTIONS = CHAT_MODELS.filter((model) => ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"].includes(model.id));

const TEMPLATE_COLUMNS: Record<WorkspaceTemplate, WorkspaceColumn[]> = {
  literature_matrix: [
    { id: "method", label: "Method", prompt: "Summarize the research design, data source, and analytical method." },
    { id: "sample", label: "Sample / context", prompt: "Extract the sample, study area, material, structure, or operational context." },
    { id: "finding", label: "Key finding", prompt: "State the strongest directly supported result without adding inference." },
    { id: "limitation", label: "Limitation", prompt: "Identify limitations stated or directly implied by the supplied evidence." },
    { id: "gap", label: "Research gap", prompt: "Name the smallest defensible unanswered question based on this paper." },
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
    { id: "gap", label: "Evidence gap", prompt: "Identify what evidence remains missing before the claim can guide engineering decisions." },
    { id: "next_study", label: "Next study", prompt: "Propose the smallest study or validation that would close the identified gap." },
  ],
};

const TEMPLATE_LABELS: Record<WorkspaceTemplate, string> = {
  literature_matrix: "Literature matrix",
  methods_audit: "Methods audit",
  evidence_gap: "Evidence gap map",
};

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

export function ResearchWorkspacePanel({
  papers,
  authenticated,
  proEnabled,
  onUpgrade,
  onOpenPaper,
}: {
  papers: ResearchWorkspacePaper[];
  authenticated: boolean;
  proEnabled: boolean;
  onUpgrade: (message: string) => void;
  onOpenPaper: (source: string) => void;
}) {
  const defaultColumns = TEMPLATE_COLUMNS.literature_matrix;
  const [workspaceId, setWorkspaceId] = useState("workspace-local");
  const [title, setTitle] = useState("Thai civil engineering matrix");
  const [template, setTemplate] = useState<WorkspaceTemplate>("literature_matrix");
  const [model, setModel] = useState<ChatModel>("gpt-5.6-luna");
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [columns, setColumns] = useState<WorkspaceColumn[]>(defaultColumns);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [restoredLocally, setRestoredLocally] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customColumnOpen, setCustomColumnOpen] = useState(false);
  const [customColumnLabel, setCustomColumnLabel] = useState("");
  const [customColumnPrompt, setCustomColumnPrompt] = useState("");
  const [activeCell, setActiveCell] = useState<{ source: string; columnId: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "saving" | "saved" | "error">("idle");
  const [statusText, setStatusText] = useState("Saved locally");

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
      if (isWorkspaceState(parsed)) {
        setWorkspaceId(parsed.workspaceId);
        setTitle(parsed.title);
        setTemplate(parsed.template);
        setModel(parsed.model);
        setRows(parsed.rows);
        setColumns(parsed.columns);
        setSelectedSources(parsed.selectedSources);
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
    const seeded = normalizeRows(papers.slice(0, 4), columns);
    setRows(seeded);
    setSelectedSources(seeded.map((row) => row.source));
  }, [columns, papers, ready, rows.length]);

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
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (status === "idle") setStatusText("Saved locally");
    } catch {
      setStatusText("Local save unavailable");
    }
  }, [columns, model, ready, rows, selectedSources, status, template, title, workspaceId]);

  useEffect(() => {
    if (!ready || restoredLocally || !authenticated) return;
    let cancelled = false;
    void fetchWorkspaceJson<{ workspaces: Array<{ state?: unknown }> }>("/api/research-workspaces")
      .then((payload) => {
        const saved = payload.workspaces.map((item) => item.state).find(isWorkspaceState);
        if (!saved || cancelled) return;
        setWorkspaceId(saved.workspaceId);
        setTitle(saved.title);
        setTemplate(saved.template);
        setModel(saved.model);
        setRows(saved.rows);
        setColumns(saved.columns);
        setSelectedSources(saved.selectedSources);
        setStatusText("Loaded synced workspace");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [authenticated, ready, restoredLocally]);

  const selectedRows = useMemo(() => rows.filter((row) => selectedSources.includes(row.source)), [rows, selectedSources]);
  const activeRow = activeCell ? rows.find((row) => row.source === activeCell.source) : null;
  const activeColumn = activeCell ? columns.find((column) => column.id === activeCell.columnId) : null;
  const activeCellValue = activeRow && activeColumn ? activeRow.cells.find((cell) => cell.columnId === activeColumn.id) : null;
  const selectedModel = CHAT_MODELS.find((item) => item.id === model) ?? CHAT_MODELS[0];
  const estimatedCredits = selectedRows.length * (selectedModel?.credits ?? 1);

  const applyTemplate = (nextTemplate: WorkspaceTemplate) => {
    const nextColumns = TEMPLATE_COLUMNS[nextTemplate];
    setTemplate(nextTemplate);
    setColumns(nextColumns);
    setRows((current) => current.map((row) => ({ ...row, cells: nextColumns.map((column) => blankCell(column.id)) })));
    setActiveCell(null);
    setStatus("idle");
    setStatusText(`${TEMPLATE_LABELS[nextTemplate]} ready`);
  };

  const togglePaper = (paper: ResearchWorkspacePaper) => {
    setRows((current) => {
      const exists = current.some((row) => row.source === paper.source);
      return exists ? current.filter((row) => row.source !== paper.source) : [...current, ...normalizeRows([paper], columns)].slice(0, 12);
    });
    setSelectedSources((current) => current.includes(paper.source) ? current.filter((source) => source !== paper.source) : [...current, paper.source].slice(0, 12));
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

  const runResearch = async (runRows = selectedRows, runColumns = columns) => {
    if (!proEnabled) {
      onUpgrade("Research Workspace is included in Founder Pro. Sign in or upgrade to run batch research.");
      return;
    }
    if (!runRows.length || !runColumns.length || status === "running") return;
    const runSources = new Set(runRows.map((row) => row.source));
    const runColumnIds = new Set(runColumns.map((column) => column.id));
    setStatus("running");
    setStatusText(`Running ${runRows.length} papers × ${runColumns.length} AI columns`);
    setRows((current) => current.map((row) => !runSources.has(row.source) ? row : {
      ...row,
      cells: row.cells.map((cell) => runColumnIds.has(cell.columnId) ? { ...cell, status: "running", review: "unreviewed" } : cell),
    }));
    try {
      const payload = await fetchWorkspaceJson<RunResponse>("/api/research-workspaces", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          workspaceId,
          runId: `run-${crypto.randomUUID()}`,
          title,
          model,
          rows: runRows.slice(0, 6).map(({ source, title: paperTitle, paperCode, collection }) => ({ source, title: paperTitle, paperCode, collection })),
          columns: runColumns.slice(0, 6).map(({ id, label, prompt }) => ({ id, label, prompt })),
        }),
      });
      const resultBySource = new Map(payload.rows.map((row) => [row.source, row]));
      setRows((current) => current.map((row) => {
        const result = resultBySource.get(row.source);
        if (!result) return row;
        return {
          ...row,
          cells: row.cells.map((cell) => {
            const generated = result.cells.find((item) => item.columnId === cell.columnId);
            return generated ? { ...generated, review: "unreviewed" as const } : cell;
          }),
        };
      }));
      setStatus("saved");
      setStatusText(`Run complete · ${payload.chargedCredits} credits used · review generated cells`);
    } catch (error) {
      setRows((current) => current.map((row) => !runSources.has(row.source) ? row : {
        ...row,
        cells: row.cells.map((cell) => runColumnIds.has(cell.columnId) && cell.status === "running" ? { ...cell, status: "error" } : cell),
      }));
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Automated research run failed.");
    }
  };

  const saveWorkspace = async () => {
    if (!proEnabled) {
      onUpgrade("Research Workspace sync is included in Founder Pro. Sign in or upgrade to continue.");
      return;
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
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetchWorkspaceJson("/api/research-workspaces", {
        method: "POST",
        body: JSON.stringify({
          action: "save",
          workspaceId,
          title,
          collection: "",
          paperSources: rows.map((row) => row.source),
          state,
        }),
      });
      setStatus("saved");
      setStatusText("Workspace synced to your account");
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Workspace could not be synced.");
    }
  };

  const exportWorkspace = () => {
    const headers = ["Paper", "Source", ...columns.flatMap((column) => [column.label, `${column.label} sources`, `${column.label} review`])];
    const lines = [headers.map(csvValue).join(",")];
    for (const row of rows) {
      const values = columns.flatMap((column) => {
        const cell = row.cells.find((item) => item.columnId === column.id);
        const sources = cell?.evidence.map((item) => `${item.source} ${pageLabel(item)}`).join("; ") ?? "";
        return [cell?.value ?? "", sources, cell?.review ?? "unreviewed"];
      });
      lines.push([row.title, row.source, ...values].map(csvValue).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `civilmcp-research-workspace-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusText("Workspace exported with source columns");
  };

  return (
    <section className="researchWorkspace" aria-label="Research Workspace Pro">
      <header className="researchWorkspaceHeader">
        <div>
          <div className="workspaceTitleLine">
            <span className="workspaceEyebrow">Research Workspace</span>
            <span className="workspaceProBadge">Founder Pro</span>
          </div>
          <input aria-label="Workspace title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          <p>Run evidence-linked AI columns across selected CivilMCP papers.</p>
        </div>
        <div className="workspaceHeaderStatus" aria-live="polite">
          {status === "running" || status === "saving" ? <LoaderCircle size={15} className="workspaceSpinner" aria-hidden /> : status === "saved" ? <Check size={15} aria-hidden /> : null}
          <span>{statusText}</span>
        </div>
      </header>

      <div className="workspaceToolbar" aria-label="Research workspace controls">
        <label>
          <span>Template</span>
          <select aria-label="Workspace template" value={template} onChange={(event) => applyTemplate(event.target.value as WorkspaceTemplate)}>
            {Object.entries(TEMPLATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden />
        </label>
        <label>
          <span>Model</span>
          <select aria-label="Workspace model" value={model} onChange={(event) => setModel(event.target.value as ChatModel)}>
            {MODEL_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden />
        </label>
        <button type="button" onClick={() => setPickerOpen((value) => !value)} aria-expanded={pickerOpen}>
          <FolderOpen size={16} aria-hidden />
          <span>Papers</span>
          <strong>{rows.length}</strong>
        </button>
        <button type="button" onClick={() => setCustomColumnOpen((value) => !value)} disabled={columns.length >= 6} aria-expanded={customColumnOpen}>
          <Plus size={16} aria-hidden />
          <span>AI column</span>
        </button>
        <button type="button" onClick={() => void saveWorkspace()}>
          <Save size={16} aria-hidden />
          <span>Save</span>
        </button>
        <button type="button" onClick={exportWorkspace} disabled={!rows.length}>
          <Download size={16} aria-hidden />
          <span>Export CSV</span>
        </button>
        <button className="workspaceRunButton" type="button" onClick={() => void runResearch()} disabled={proEnabled && (!selectedRows.length || !columns.length || status === "running")}>
          <Sparkles size={16} aria-hidden />
          <span>{proEnabled ? "Run selected" : "Unlock batch run"}</span>
          {selectedRows.length ? <strong>{estimatedCredits} cr</strong> : null}
        </button>
      </div>

      {pickerOpen ? (
        <section className="workspacePaperPicker" aria-label="Add papers to workspace">
          <div><strong>Add papers</strong><span>Select up to 12; each batch run processes up to 6.</span></div>
          <div className="workspacePaperOptions">
            {papers.slice(0, 12).map((paper) => {
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
          <label><span>Agent instruction</span><input value={customColumnPrompt} maxLength={500} onChange={(event) => setCustomColumnPrompt(event.target.value)} placeholder="Extract the reported safety factor and its test condition." /></label>
          <button type="button" onClick={addCustomColumn} disabled={!customColumnLabel.trim() || customColumnPrompt.trim().length < 8}>Add column</button>
        </section>
      ) : null}

      {!proEnabled ? (
        <div className="workspaceProNotice" role="note">
          <ShieldCheck size={18} aria-hidden />
          <span><strong>Preview the workspace free.</strong> Batch runs, account sync, Terra, and Sol require Founder Pro.</span>
          <button type="button" onClick={() => onUpgrade("Research Workspace is included in Founder Pro. Sign in or upgrade to continue.")}>View Founder Pro</button>
        </div>
      ) : null}

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
                      <span>{row.paperCode || (row.collection === "ncce" ? "NCCE" : "CE Project")}</span>
                      <strong>{row.title}</strong>
                      <small>{row.pageLabel} · {row.evidenceCount} evidence</small>
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
                <button key={evidence.id} type="button" onClick={() => onOpenPaper(evidence.source)}>
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
