# CivilMCP

CivilMCP is a **Research Preview** for an Agentic Context Engine over civil engineering papers. It combines a production-style RAG v2 retrieval substrate with bounded orchestration, so the app can choose, compress, and cite context before answering.

Current production concept:

- Frontend: Next.js 15 chat UI on Vercel
- MCP server: Python FastAPI MCP-style tool endpoints on Vercel
- Retrieval: Supabase Postgres + pgvector
- Embeddings: `text-embedding-3-small` with `EMBEDDING_DIMENSIONS=768`
- Chat models: `gpt-5-mini-2025-08-07`, `gpt-5-nano`, `deepseek-v4-flash`, `deepseek-v4-pro`
- Router/context planner: `deepseek-v4-flash` by default
- Data pipeline: PDF -> Markdown -> sections/chunks -> embeddings -> Supabase

## Production Data Status

Indexed v2 corpus after the NCCE ingestion patch:

| Collection | Documents | Notes |
| --- | ---: | --- |
| `ce_project` | 67 | Existing CE Project Database papers |
| `ncce` | 874 | NCCE proceedings split into paper-level markdown with page metadata |
| Total | 941 | 9,412 sections and 49,965 chunks |

NCCE source PDFs currently ingested:

- `Proceedings_NCCE25.pdf`
- `Proceedings_NCCE26.pdf`
- `Proceedings_NCCE29.pdf`

## Project Structure

```text
.
├── CE Project Database/        # Existing CE PDFs
├── NCCE Project Database/      # NCCE proceedings PDFs
├── supabase/                   # Schema, migrations, readiness checks
├── pipeline/                   # PDF extraction and v2 indexing
├── mcp-server/                 # FastAPI MCP-style retrieval server
├── eval/                       # Baseline/simple RAG/agentic eval scripts
└── web/                        # Next.js chat UI
```

## Environment

Single source of truth:

```bash
/Users/lechiffre/Desktop/Civil_MCP/.env
```

Start from:

```bash
cp .env.example .env
```

Required server-side keys:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `MCP_SERVER_API_KEY`

Do not expose these as `NEXT_PUBLIC_*`. `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, and `MCP_SERVER_API_KEY` must stay server-side only.

## Supabase Setup

Apply the schema:

```bash
python3.10 supabase/recheck.py --apply --v2
```

Or run [supabase/schema.sql](/Users/lechiffre/Desktop/Civil_MCP/supabase/schema.sql) in Supabase SQL Editor.

Check readiness:

```bash
python3.10 supabase/recheck.py --v2
```

Rebuild IVFFlat indexes after large ingestion:

```bash
python3.10 supabase/recheck.py --reindex-v2 --v2
```

## Pipeline

Install once:

```bash
cd /Users/lechiffre/Desktop/Civil_MCP/pipeline
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements.index.txt
```

Extract CE PDFs:

```bash
python3.10 extract.py
```

Extract NCCE proceedings into paper-level markdown:

```bash
python3.10 extract_ncce.py
```

Index v2 with OpenAI Batch API:

```bash
python3.10 index.py --mode batch
```

For small debug runs:

```bash
python3.10 index.py --mode sync
```

Batch limits can be adjusted through `.env` or CLI, for example:

```bash
python3.10 index.py --mode batch --max-batch-estimated-tokens 750000
```

The indexer is incremental. It uses document/section/chunk hashes and does not re-embed unchanged rows.

## MCP Server

Local run:

```bash
cd /Users/lechiffre/Desktop/Civil_MCP/mcp-server
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

Useful endpoints:

- `/health`
- `/metrics`
- `/tools/list`
- `/tools/call`

Main read-only tools:

- `search_civil_knowledge`
- `search_civil_sections`
- `search_civil_chunks`
- `fetch_civil_paper`
- `fetch_chunk_neighbors`
- `fetch_paper_outline`
- `list_papers`
- `list_collections`

Tool calls support optional `collection`:

- `""` = all collections
- `"ce_project"` = CE Project only
- `"ncce"` = NCCE only

## Web App

Local run:

```bash
cd /Users/lechiffre/Desktop/Civil_MCP/web
npm install
npm run dev
```

UI supports:

- MCP/Context toggle
- Model dropdown
- Collection dropdown: `All | CE Project | NCCE`
- Shareable chat URL/export
- Local/cloud-backed chat session support depending on environment

`MCP ON` uses the bounded Agentic Context Engine. `MCP OFF` is model-only.

## Agentic Context Engine

Default flow:

```text
question
-> router/context planner
-> retrieval recipe
-> section search
-> chunk search / neighbors when needed
-> dedupe + budget + citations
-> selected answer model
```

Default limits:

- `MAX_AGENT_STEPS=3`
- `MAX_TOOL_CALLS=4`
- `MAX_CONTEXT_CHUNKS=8`
- `MAX_CONTEXT_TOKENS=8000`

Conversation memory:

- `AUTO_COMPACT_ENABLED=true` enables automatic compaction.
- `MEMORY_COMPACT_TRIGGER_PERCENT=75` compacts when estimated chat history reaches 75% of the selected model context window.
- Compaction keeps `running_summary`, `active_evidence_map`, and the most recent `MEMORY_RECENT_MESSAGES=8` messages.
- The UI shows `Memory compacted` or `Memory active` on assistant messages when compacted memory is used.
- `Clear chat` keeps the same session row but overwrites the transcript with `[]`, so compacted memory annotations are cleared with the chat.

Rollback options:

- `AGENTIC_CONTEXT_ENABLED=false` returns to simple RAG.
- `RETRIEVAL_VERSION=v1` returns MCP retrieval to the v1 rollback path.
- Filtering `collection=ce_project` excludes NCCE without schema changes.

## QA Commands

```bash
python3.10 -m py_compile mcp-server/server.py pipeline/index.py pipeline/extract.py pipeline/extract_ncce.py supabase/recheck.py
python3.10 supabase/recheck.py --v2
cd web && npm run build
```

## Harness Engineering

CivilMCP uses a harness-first agentic workflow. The harness keeps the bounded agentic product legible, measurable, and safe to extend before adding more autonomous product behavior.

System-of-record docs:

- [AGENTS.md](/Users/lechiffre/Desktop/Civil_MCP/AGENTS.md)
- [docs/ARCHITECTURE.md](/Users/lechiffre/Desktop/Civil_MCP/docs/ARCHITECTURE.md)
- [docs/HARNESS.md](/Users/lechiffre/Desktop/Civil_MCP/docs/HARNESS.md)
- [docs/QUALITY_SCORE.md](/Users/lechiffre/Desktop/Civil_MCP/docs/QUALITY_SCORE.md)
- [docs/OPERATIONS.md](/Users/lechiffre/Desktop/Civil_MCP/docs/OPERATIONS.md)
- [docs/GITHUB_PUSH_WRAPUP.md](/Users/lechiffre/Desktop/Civil_MCP/docs/GITHUB_PUSH_WRAPUP.md)

Harness commands:

```bash
make local-gate
make prod-smoke
make release-gate

python3.10 harness/check_invariants.py
python3.10 harness/run_smoke.py
python3.10 harness/run_eval.py --mode smoke
python3.10 harness/score_quality.py
cd web && npm run harness:web-smoke
```

Reports are written to `harness/reports/latest_<suite>.json` and are ignored by git.

Production smoke checklist:

- MCP `/health`
- MCP `/tools/list`
- MCP `list_collections`
- MCP `search_civil_chunks` with `collection='ncce'`
- MCP `search_civil_chunks` with `collection='ce_project'`
- Web `/api/chat` with Context ON and `collection='ncce'`
