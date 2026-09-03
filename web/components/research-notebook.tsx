"use client";

import {
  ArrowRight,
  BookOpen,
  Check,
  FilePlus2,
  FileText,
  Library,
  LoaderCircle,
  MessageSquarePlus,
  NotebookTabs,
  PanelLeft,
  Pin,
  Plus,
  Route,
  ShieldCheck,
  Sparkles,
  TableProperties,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ResearchWorkspaceEvidenceTarget, ResearchWorkspacePaper } from "@/components/research-workspace";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, type ChatModel } from "@/lib/chat-models";
import { GlassMenuSelect, type GlassMenuOption } from "@/components/glass-menu-select";
import type { AskResearchNotebookInput, DraftNotebookArtifactInput, SeedResearchWebMcpHandlers } from "@/lib/webmcp";

export type NotebookToolBridge = Pick<SeedResearchWebMcpHandlers, "openResearchNotebook" | "askResearchNotebook" | "draftNotebookArtifact"> & { caseId: string; ready: boolean };

type NotebookCitation = {
  id: string;
  evidenceId: string;
  source: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  snippet: string;
  shareable: boolean;
};

type NotebookMessage = {
  messageId: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  citations: NotebookCitation[];
  sourceSnapshot: string[];
  insufficient: boolean;
  createdAt: string;
};

type NotebookThread = {
  threadId: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

type NotebookNote = {
  noteId: string;
  title: string;
  content: string;
  pinned: boolean;
  stale: boolean;
  version: number;
  updatedAt: string;
};

type NotebookArtifactKind = "source_guide" | "evidence_brief" | "evidence_matrix" | "literature_synthesis" | "candidate_gap" | "next_study_protocol" | "manuscript_package";

type NotebookArtifact = {
  artifactId: string;
  kind: NotebookArtifactKind;
  title: string;
  content: string;
  stale: boolean;
  version: number;
  createdAt: string;
  provenance?: { citations?: NotebookCitation[] };
};

type WorkspaceEvidencePack = {
  packId: string;
  workspaceId: string;
  version: number;
  sourceSnapshot: string[];
  payload: { workspaceTitle?: unknown; rows?: unknown[] };
  createdAt: string;
};

type ResearchNotebookSnapshot = {
  notebookId: string;
  caseId: string;
  title: string;
  caseQuestion: string;
  caseSources: string[];
  threads: NotebookThread[];
  activeThreadId: string;
  messages: NotebookMessage[];
  notes: NotebookNote[];
  artifacts: NotebookArtifact[];
  workspacePacks: WorkspaceEvidencePack[];
  updatedAt: string;
};

export type ResearchNotebookCase = {
  caseId: string;
  question: string;
};

export type ResearchNotebookFinding = {
  question: string;
  answer: string;
  citations: NotebookCitation[];
  insufficient: boolean;
};

const ARTIFACTS: Array<{ kind: NotebookArtifactKind; label: string; description: string; icon: typeof FileText }> = [
  { kind: "source_guide", label: "Source Guide", description: "What each source can support", icon: Library },
  { kind: "evidence_brief", label: "Evidence Brief", description: "Findings, conflicts, limitations", icon: FileText },
  { kind: "evidence_matrix", label: "Evidence Matrix", description: "Compact cross-source comparison", icon: TableProperties },
  { kind: "literature_synthesis", label: "Literature Synthesis", description: "Bounded synthesis, not a full review", icon: BookOpen },
  { kind: "candidate_gap", label: "Candidate Gap", description: "Gap hypothesis with validation needs", icon: TriangleAlert },
  { kind: "next_study_protocol", label: "Next-Study Protocol", description: "Question, design, data, validation", icon: Route },
  { kind: "manuscript_package", label: "Manuscript Package", description: "Outline and missing-results checklist", icon: FilePlus2 },
];

const MODEL_OPTIONS: ReadonlyArray<GlassMenuOption<ChatModel>> = CHAT_MODELS.map((model) => ({
  value: model.id,
  label: model.label,
  description: model.id === DEFAULT_CHAT_MODEL ? "Efficient Light Mode default" : model.id.startsWith("gpt-") ? "OpenAI API" : "DeepSeek API",
  badge: model.id.startsWith("gpt-") ? "OPENAI" : undefined,
}));

async function fetchNotebookJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Notebook request failed (${response.status}).`);
  return payload;
}

function sourceLabel(source: string, papers: Map<string, ResearchWorkspacePaper>) {
  return papers.get(source)?.title || source.replace(/^private:/, "Private · ");
}

function messageQuestion(messages: NotebookMessage[], message: NotebookMessage): string {
  const index = messages.findIndex((item) => item.messageId === message.messageId);
  for (let offset = index - 1; offset >= 0; offset -= 1) {
    if (messages[offset].role === "user") return messages[offset].content;
  }
  return "What does the selected evidence support?";
}

export function ResearchNotebookPanel({
  researchCase,
  papers,
  authenticated,
  accessEnabled,
  onUpgrade,
  onExplore,
  onOpenWorkspace,
  onOpenPaper,
  onPromoteFinding,
  onContinuePath,
  onToolBridge,
}: {
  researchCase: ResearchNotebookCase | null;
  papers: ResearchWorkspacePaper[];
  authenticated: boolean;
  accessEnabled: boolean;
  onUpgrade: (message: string) => void;
  onExplore: () => void;
  onOpenWorkspace: () => void;
  onOpenPaper: (source: string, evidenceTarget?: ResearchWorkspaceEvidenceTarget) => void;
  onPromoteFinding: (finding: ResearchNotebookFinding) => void;
  onContinuePath: (finding: ResearchNotebookFinding) => void;
  onToolBridge?: (bridge: NotebookToolBridge | null) => void;
}) {
  const [notebook, setNotebook] = useState<ResearchNotebookSnapshot | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [model, setModel] = useState<ChatModel>(DEFAULT_CHAT_MODEL);
  const [question, setQuestion] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [studioBusy, setStudioBusy] = useState<NotebookArtifactKind | "">("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [expandedArtifact, setExpandedArtifact] = useState<string>("");
  const generationRef = useRef<AbortController | null>(null);

  useEffect(() => () => { generationRef.current?.abort(); }, [researchCase?.caseId]);

  const paperMap = useMemo(() => new Map(papers.map((paper) => [paper.source, paper])), [papers]);

  const adoptNotebook = useCallback((next: ResearchNotebookSnapshot) => {
    setNotebook(next);
    setSelectedSources((current) => {
      const available = new Set(next.caseSources);
      const preserved = current.filter((source) => available.has(source)).slice(0, 12);
      return preserved.length ? preserved : next.caseSources.slice(0, 6);
    });
    setStatus("ready");
    setError("");
  }, []);

  useEffect(() => {
    setNotebook(null);
    setSelectedSources([]);
    setQuestion("");
    if (!researchCase || !authenticated || !accessEnabled) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void fetchNotebookJson<{ notebook: ResearchNotebookSnapshot }>("/api/research-notebooks", {
      method: "POST",
      body: JSON.stringify({ action: "ensure", caseId: researchCase.caseId }),
    }).then((payload) => {
      if (!cancelled) adoptNotebook(payload.notebook);
    }).catch((reason) => {
      if (cancelled) return;
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "Research Notebook could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [accessEnabled, adoptNotebook, authenticated, researchCase]);

  const switchThread = async (threadId: string) => {
    if (!researchCase || !threadId || busy) return;
    setStatus("loading");
    try {
      const payload = await fetchNotebookJson<{ notebook: ResearchNotebookSnapshot }>(`/api/research-notebooks?caseId=${encodeURIComponent(researchCase.caseId)}&threadId=${encodeURIComponent(threadId)}`);
      adoptNotebook(payload.notebook);
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "Notebook thread could not be loaded.");
    }
  };

  const newThread = async () => {
    if (!researchCase || busy) return;
    setBusy(true);
    try {
      const payload = await fetchNotebookJson<{ notebook: ResearchNotebookSnapshot }>("/api/research-notebooks", {
        method: "POST",
        body: JSON.stringify({ action: "thread", caseId: researchCase.caseId, title: `Research thread ${(notebook?.threads.length ?? 0) + 1}` }),
      });
      adoptNotebook(payload.notebook);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A new thread could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async (input?: AskResearchNotebookInput, signal?: AbortSignal) => {
    const prompt = input?.question ?? question.trim();
    const sources = input?.sources ?? selectedSources;
    if (!researchCase || !notebook?.activeThreadId || prompt.length < 8 || !sources.length) throw new Error("Open a Notebook and select its Case Sources first.");
    if (generationRef.current || busy || studioBusy) throw new Error("Notebook is busy. Wait for the current action.");
    if (input && sources.some((source) => source.startsWith("private:") || !notebook.caseSources.includes(source))) throw new Error("Select public sources admitted to this Research Case.");
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    generationRef.current = controller;
    setSelectedSources(sources);
    setQuestion(prompt);
    setBusy(true);
    setError("");
    try {
      const payload = await fetchNotebookJson<{ userMessage: NotebookMessage; message: NotebookMessage }>("/api/research-notebooks", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          action: "ask",
          caseId: researchCase.caseId,
          threadId: notebook.activeThreadId,
          question: prompt,
          model,
          sources,
          publicSourcesOnly: Boolean(input),
        }),
      });
      controller.signal.throwIfAborted();
      setNotebook((current) => current ? { ...current, messages: [...current.messages, payload.userMessage, payload.message] } : current);
      setQuestion("");
      return payload.message;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Research Notebook could not answer.");
      throw reason;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (generationRef.current === controller) generationRef.current = null;
      setBusy(false);
    }
  };

  const saveNote = async (message?: NotebookMessage) => {
    if (!researchCase || noteBusy) return;
    const content = message?.content || noteContent.trim();
    if (!content) return;
    setNoteBusy(true);
    try {
      const payload = await fetchNotebookJson<{ note: NotebookNote }>("/api/research-notebooks", {
        method: "POST",
        body: JSON.stringify({
          action: "note",
          caseId: researchCase.caseId,
          title: message ? `Pinned answer · ${new Date().toLocaleDateString("en-GB")}` : noteTitle.trim() || "Research note",
          content,
          sources: message?.sourceSnapshot ?? selectedSources,
          messageId: message?.messageId,
        }),
      });
      setNotebook((current) => current ? { ...current, notes: [payload.note, ...current.notes] } : current);
      if (!message) {
        setNoteTitle("");
        setNoteContent("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Note could not be saved.");
    } finally {
      setNoteBusy(false);
    }
  };

  const generateArtifact = async (kind: NotebookArtifactKind, input?: DraftNotebookArtifactInput, signal?: AbortSignal) => {
    const sources = input?.sources ?? selectedSources;
    if (!researchCase || !notebook || !sources.length) throw new Error("Open a Notebook and select its Case Sources first.");
    if (generationRef.current || busy || studioBusy) throw new Error("Notebook is busy. Wait for the current action.");
    if (input && sources.some((source) => source.startsWith("private:") || !notebook.caseSources.includes(source))) throw new Error("Select public sources admitted to this Research Case.");
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    generationRef.current = controller;
    setSelectedSources(sources);
    setStudioBusy(kind);
    setError("");
    try {
      const payload = await fetchNotebookJson<{ artifact: NotebookArtifact }>("/api/research-notebooks", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ action: "artifact", caseId: researchCase.caseId, kind, model, sources, publicSourcesOnly: Boolean(input) }),
      });
      controller.signal.throwIfAborted();
      setNotebook((current) => current ? { ...current, artifacts: [payload.artifact, ...current.artifacts] } : current);
      setExpandedArtifact(payload.artifact.artifactId);
      return payload.artifact;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Studio artifact could not be generated.");
      throw reason;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (generationRef.current === controller) generationRef.current = null;
      setStudioBusy("");
    }
  };

  useEffect(() => {
    onToolBridge?.(researchCase && authenticated && accessEnabled ? {
      caseId: researchCase.caseId,
      ready: status === "ready" || status === "error",
      openResearchNotebook: async (signal) => {
        signal.throwIfAborted();
        if (!notebook || status !== "ready") throw new Error(error || "Notebook is still synchronizing.");
        return {
          ok: true, visibleView: "notebook", caseId: notebook.caseId, model,
          sources: notebook.caseSources.filter((source) => !source.startsWith("private:")).slice(0, 50),
          selectedSources: selectedSources.filter((source) => !source.startsWith("private:")),
          reviewedPackCount: notebook.workspacePacks.length, artifactCount: notebook.artifacts.length,
          privacy: "Private sources, prior conversations and notes are omitted. Only explicitly selected public sources are available to site tools.",
          nextHumanStep: "Inspect exact-page citations before accepting claims. Studio outputs remain drafts.",
        };
      },
      askResearchNotebook: async (input, signal) => {
        const message = await ask(input, signal);
        const publicOnly = message.citations.every((citation) => citation.shareable && !citation.source.startsWith("private:"));
        return { ok: true, visibleView: "notebook", messageId: message.messageId, answer: publicOnly ? message.content.slice(0, 3600) : "Answer kept in the owner-scoped Notebook because it contains private evidence.", citations: publicOnly ? message.citations.map(({ snippet: _snippet, ...locator }) => locator) : [], insufficient: message.insufficient, requiresHumanReview: true };
      },
      draftNotebookArtifact: async (input, signal) => {
        const artifact = await generateArtifact(input.kind, input, signal);
        const citations = artifact.provenance?.citations ?? [];
        const publicOnly = citations.length > 0 && citations.every((citation) => citation.shareable && !citation.source.startsWith("private:"));
        return { ok: true, visibleView: "notebook", artifactId: artifact.artifactId, kind: artifact.kind, version: artifact.version, excerpt: publicOnly ? artifact.content.slice(0, 2400) : "Inspect the draft in the owner-scoped Notebook.", citations: publicOnly ? citations.map(({ snippet: _snippet, ...locator }) => locator) : [], requiresHumanReview: true, noveltyEstablished: false, exported: false };
      },
    } : null);
    return () => onToolBridge?.(null);
  });

  const toggleSource = (source: string) => {
    setSelectedSources((current) => current.includes(source)
      ? current.filter((item) => item !== source)
      : current.length >= 12 ? current : [...current, source]);
  };

  if (!researchCase) {
    return (
      <section className="notebookEmptyState" aria-label="Research Notebook">
        <span><NotebookTabs size={23} aria-hidden /></span>
        <p className="workspaceEyebrow">Research Notebook</p>
        <h1>Start with one Research Case.</h1>
        <p>Notebook keeps the sources, conversations, reviewed Workspace evidence, and research artifacts for one continuous Thai-to-global investigation.</p>
        <button type="button" onClick={onExplore}>Start a Research Case <ArrowRight size={15} aria-hidden /></button>
      </section>
    );
  }

  if (!authenticated || !accessEnabled) {
    return (
      <section className="notebookEmptyState" aria-label="Research Notebook">
        <span><ShieldCheck size={23} aria-hidden /></span>
        <p className="workspaceEyebrow">Owner-scoped Notebook</p>
        <h1>Sign in to keep research state private and durable.</h1>
        <p>Notebook threads, notes, private sources, and Studio artifacts must remain attached to one verified owner.</p>
        <button type="button" onClick={() => onUpgrade("Sign in to use Research Notebook Light Mode.")}>Sign in <ArrowRight size={15} aria-hidden /></button>
      </section>
    );
  }

  if (status === "loading" && !notebook) {
    return <section className="notebookEmptyState" aria-label="Research Notebook"><LoaderCircle className="workspaceSpinner" aria-hidden /><h1>Synchronizing Research Case…</h1></section>;
  }

  if (!notebook) {
    return (
      <section className="notebookEmptyState" aria-label="Research Notebook">
        <TriangleAlert size={23} aria-hidden />
        <h1>Research Notebook is not ready.</h1>
        <p>{error || "The Notebook store could not be reached."}</p>
      </section>
    );
  }

  const latestAnswer = [...notebook.messages].reverse().find((message) => message.role === "assistant");
  const latestFinding: ResearchNotebookFinding | null = latestAnswer ? {
    question: messageQuestion(notebook.messages, latestAnswer),
    answer: latestAnswer.content,
    citations: latestAnswer.citations,
    insufficient: latestAnswer.insufficient,
  } : null;

  return (
    <section className="researchNotebookShell" aria-label="Research Notebook">
      <header className="notebookTopbar">
        <div>
          <p className="workspaceEyebrow">Research Notebook · one Research Case</p>
          <h1>{notebook.caseQuestion}</h1>
          <span><ShieldCheck size={13} aria-hidden /> Seedy Light Retrieval active · model API · OpenRAG-ready</span>
        </div>
        <GlassMenuSelect label="Model" value={model} options={MODEL_OPTIONS} onChange={setModel} className="notebookModelSelect" />
      </header>

      {error ? <p className="notebookInlineError" role="alert">{error}</p> : null}

      <div className="notebookThreePane">
        <aside className="notebookSourcesPane" aria-label="Notebook sources">
          <header><span><PanelLeft size={15} aria-hidden /> Sources</span><strong>{selectedSources.length}/{Math.min(12, notebook.caseSources.length)}</strong></header>
          <p>Only checked Case Sources ground Chat and Studio.</p>
          <div className="notebookSourceList">
            {notebook.caseSources.map((source) => (
              <label key={source}>
                <input type="checkbox" checked={selectedSources.includes(source)} disabled={busy || Boolean(studioBusy)} onChange={() => toggleSource(source)} />
                <span><strong>{sourceLabel(source, paperMap)}</strong><small>{source.startsWith("private:") ? "Private · non-shareable" : paperMap.get(source)?.pageLabel || "Case source"}</small></span>
              </label>
            ))}
          </div>
          <div className="notebookSourceActions">
            <button type="button" onClick={onExplore}><Plus size={14} aria-hidden /> Discover Thai research</button>
            <button type="button" onClick={onOpenWorkspace}><TableProperties size={14} aria-hidden /> Open review Workspace</button>
          </div>
          <section className="notebookPackList">
            <header><span>Workspace Evidence Packs</span><strong>{notebook.workspacePacks.length}</strong></header>
            {notebook.workspacePacks.length ? notebook.workspacePacks.map((pack) => (
              <article key={pack.packId}>
                <Check size={13} aria-hidden />
                <span><strong>{String(pack.payload.workspaceTitle || "Reviewed Workspace")}</strong><small>v{pack.version} · {pack.sourceSnapshot.length} sources</small></span>
              </article>
            )) : <p>Verify cells in Workspace, then use “Send reviewed to Notebook”.</p>}
          </section>
          <p className="notebookGlobalBoundary">OpenAlex connections remain metadata leads until a Seedy exact-page source is admitted to this Case.</p>
        </aside>

        <main className="notebookChatPane">
          <header className="notebookThreadBar">
            <div role="tablist" aria-label="Notebook threads">
              {notebook.threads.map((thread) => (
                <button key={thread.threadId} type="button" role="tab" disabled={busy || Boolean(studioBusy)} aria-selected={thread.threadId === notebook.activeThreadId} onClick={() => void switchThread(thread.threadId)}>{thread.title}</button>
              ))}
            </div>
            <button type="button" aria-label="New Notebook thread" onClick={() => void newThread()} disabled={busy || Boolean(studioBusy) || notebook.threads.length >= 8}><MessageSquarePlus size={15} aria-hidden /></button>
          </header>

          <div className="notebookMessages" aria-live="polite">
            {notebook.messages.length ? notebook.messages.map((message) => (
              <article key={message.messageId} className={`notebookMessage ${message.role} ${message.insufficient ? "insufficient" : ""}`}>
                <span>{message.role === "user" ? "You" : message.insufficient ? "Insufficient evidence" : "Seedy Notebook"}</span>
                <div><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
                {message.citations.length ? (
                  <div className="notebookMessageCitations" aria-label="Notebook exact-page citations">
                    {message.citations.map((citation) => (
                      <button key={`${message.messageId}-${citation.id}`} type="button" onClick={() => onOpenPaper(citation.source, { id: citation.evidenceId, pageStart: citation.pageStart, pageEnd: citation.pageEnd, sectionTitle: citation.sectionTitle })}>
                        <strong>[{citation.id}] p.{citation.pageStart}{citation.pageEnd !== citation.pageStart ? `–${citation.pageEnd}` : ""}</strong>
                        <span>{citation.sectionTitle || sourceLabel(citation.source, paperMap)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" ? <button className="notebookPinAction" type="button" onClick={() => void saveNote(message)} disabled={noteBusy}><Pin size={13} aria-hidden /> Save to Notes</button> : null}
              </article>
            )) : (
              <div className="notebookChatWelcome">
                <Sparkles size={21} aria-hidden />
                <h2>Ask across this Research Case.</h2>
                <p>Responses use only selected exact-page sources and reviewed Workspace packs. Missing evidence produces a refusal, not a guess.</p>
              </div>
            )}
          </div>

          <div className="notebookComposer">
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={800} rows={3} aria-label="Ask Research Notebook" placeholder="What do these sources agree on, where do they conflict, and what should be validated next?" />
            <div><span>{selectedSources.length} sources · exact-page grounding</span><button type="button" onClick={() => void ask().catch(() => undefined)} disabled={busy || Boolean(studioBusy) || question.trim().length < 8 || !selectedSources.length}>{busy ? <LoaderCircle className="workspaceSpinner" size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />}{busy ? "Reading…" : "Ask sources"}</button></div>
          </div>
          {latestFinding && !latestFinding.insufficient && latestFinding.citations.length ? (
            <footer className="notebookContinuityActions">
              <button type="button" onClick={() => onPromoteFinding(latestFinding)} disabled={latestFinding.citations.some((citation) => !citation.shareable)}>Promote to Passport</button>
              <button type="button" onClick={() => onContinuePath(latestFinding)}>Continue to Research Path <ArrowRight size={14} aria-hidden /></button>
            </footer>
          ) : null}
        </main>

        <aside className="notebookStudioPane" aria-label="Notebook Studio">
          <header><span><Sparkles size={15} aria-hidden /> Studio</span><small>Versioned outputs</small></header>
          <div className="notebookArtifactActions">
            {ARTIFACTS.map((item) => {
              const Icon = item.icon;
              return <button key={item.kind} type="button" onClick={() => void generateArtifact(item.kind).catch(() => undefined)} disabled={busy || Boolean(studioBusy) || !selectedSources.length}><Icon size={15} aria-hidden /><span><strong>{item.label}</strong><small>{studioBusy === item.kind ? "Generating…" : item.description}</small></span>{studioBusy === item.kind ? <LoaderCircle className="workspaceSpinner" size={14} aria-hidden /> : <Plus size={14} aria-hidden />}</button>;
            })}
          </div>

          <section className="notebookQuickNote">
            <header><span>Notes</span><strong>{notebook.notes.length}</strong></header>
            <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} maxLength={160} placeholder="Note title" aria-label="Notebook note title" />
            <textarea value={noteContent} onChange={(event) => setNoteContent(event.target.value)} maxLength={12_000} rows={3} placeholder="Write a finding, decision, or unresolved question…" aria-label="Notebook note" />
            <button type="button" onClick={() => void saveNote()} disabled={noteBusy || !noteContent.trim()}>{noteBusy ? "Saving…" : "Save note"}</button>
            {notebook.notes.slice(0, 3).map((note) => <article key={note.noteId} className={note.stale ? "stale" : ""}><strong>{note.title}</strong><p>{note.content}</p><small>{note.stale ? "Source set changed · review needed" : `v${note.version}`}</small></article>)}
          </section>

          <section className="notebookArtifacts">
            <header><span>Generated artifacts</span><strong>{notebook.artifacts.length}</strong></header>
            {notebook.artifacts.map((artifact) => (
              <article key={artifact.artifactId} className={artifact.stale ? "stale" : ""}>
                <button type="button" onClick={() => setExpandedArtifact((current) => current === artifact.artifactId ? "" : artifact.artifactId)}>
                  <span><strong>{artifact.title}</strong><small>{artifact.kind.replaceAll("_", " ")} · v{artifact.version}{artifact.stale ? " · stale" : ""}</small></span>
                  <ArrowRight size={14} aria-hidden />
                </button>
                {expandedArtifact === artifact.artifactId ? <div className="notebookArtifactBody"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown></div> : null}
              </article>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}
