# OpenAI Build Week 2026 — CivilMCP

## Competition scope

CivilMCP is submitted to the Education track as a Public Research Preview. The competition product consists of `web/`, `mcp-server/`, `pipeline/`, `supabase/`, `harness/`, `eval/`, and the CivilMCP documentation.

`citymcp/` is a separately managed consumer and is excluded from the competition scope, CivilMCP quality score, and Civil release workflow. It shares only the read-only MCP contract and the applied Supabase migration ledger.

## Build Week provenance

- Pre-event baseline: `639c63c3556a86471cff64465b767e6538ccd077`, committed June 25, 2026.
- Build Week development began July 18, 2026.
- Build Week branch: `codex/build-week-civilmcp`.
- Primary Codex task/session: `019f7eb2-9fd5-7eb1-ba9e-3999c59189fe`.
- Devpost `/feedback` ID: pending until the final verified implementation task is submitted through `/feedback`; do not substitute or fabricate an ID.

All competition commits are created after July 13 with their real timestamps. No history is backdated.

## Meaningful extension after the baseline

| Baseline | Build Week extension |
| --- | --- |
| Generic civil-paper search narrative | Dataset-first Education narrative with live corpus proof |
| GPT-5 mini/nano or DeepSeek defaults | GPT-5.6 Luna default for answer, planning, memory, and translation |
| Generic or code-like CE titles | Shared curated title source and effective-title quality gate |
| Four canonical disciplines | Ten canonical disciplines and additive database cleanup |
| Civil and City release gates coupled | Separate CivilMCP and CityMCP app, harness, CI, and release scopes |
| Feed-level citations | Public Research Preview positioning, exact-page demo prompts, feedback, and release evidence |
| Paper-code queries relied on semantic similarity | Bounded exact-paper retrieval followed by full-candidate reranking before the 8-chunk context limit |
| One-shot cited answers | Bounded Agentic Evidence Missions, Founder Pro Deep Research, and a separate spreadsheet-style Research Workspace Pro with batch AI columns, cell-level exact-page evidence, human review, sync, and CSV export |

## GPT-5.6 use

GPT-5.6 Luna is the default model for:

- answer generation;
- bounded retrieval classification and query planning;
- conversation-memory compaction;
- Thai-to-English paper translation;
- smoke, memory, and citation eval requests.

GPT-5.6 Terra and Sol remain selectable answer models. DeepSeek Flash and Pro are optional answer providers and are not required for the default path.

The implementation keeps the existing Chat Completions-compatible AI SDK integration and uses low reasoning effort for latency-sensitive Luna calls. Retrieval budgets remain bounded independently of the model context window.

## Agentic education extension

The flagship experience is fully agentic within explicit product limits, not autonomous without bounds. CivilMCP can plan, retrieve iteratively, compare sources, verify page coverage, and publish a durable artifact. `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, and `MAX_CONTEXT_TOKENS` remain hard server-side limits.

Two product references informed the extension without adding their code or frameworks:

- [Tau](https://twotimespi.dev/) inspired the inspectable agent-run and learning checkpoints: users can see the useful stages and evidence, never private reasoning.
- [OpenWiki](https://github.com/langchain-ai/openwiki) inspired the durable, linked Evidence Brief: the artifact lives with history/share and exports as Markdown instead of disappearing as a one-shot answer.

The existing AI SDK, MCP retrieval layer, Supabase transcript, and visual system remain in place.

## Automated research workspace

Research Workspace Pro is intentionally separate from Chat. It applies a spreadsheet mental model to the unique CivilMCP corpus: papers are rows; Method, Sample, Finding, Limitation, Gap, or custom research instructions are columns. Each request is capped at six papers by six columns and each supported cell carries allow-listed evidence from its own paper. Users can inspect the source page, mark a cell Verified or Needs review, retry one cell, save the workspace, and export a source-bearing CSV. This is the scalable automated-research workflow; Deep Research remains the focused one-question workflow.

## Dataset contribution

The differentiator is the curated structure, not ownership of the underlying papers:

- 941 Thai civil-engineering papers;
- 8,148 active, page-linked sections;
- 48,370 active, page-linked evidence chunks;
- CE Project research from 2019–2024;
- NCCE25, NCCE26, and NCCE29;
- bilingual paper exploration and exact-page evidence.

The table-level index also contains 9,413 section records and 50,588 chunk
records. CivilMCP deliberately excludes legacy/stale or non-page-linked rows
from the public proof metric so the headline remains reproducible from active
evidence with page provenance.

The source papers are not redistributed. See [DATA_SOURCES.md](DATA_SOURCES.md).

## Reproduce the submission candidate

```bash
make local-gate
cd web && npm run test:e2e
cd ..
python3.10 harness/run_smoke.py --strict
python3.10 harness/run_eval.py --mode smoke
python3.10 harness/run_memory_eval.py
python3.10 harness/score_quality.py
```

Use the public deployment for judging because the copyrighted source corpus is intentionally absent from the repository. The repository contains a synthetic fixture showing the data shape.
