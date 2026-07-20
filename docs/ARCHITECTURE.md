# CivilMCP Architecture

## System Shape
CivilMCP has three production surfaces:
- `web/`: Next.js 15 app with research feed, chat UI, bounded Agentic Context Engine orchestration in `/api/chat`, deterministic learning-path assembly in `/api/research-path`, and a bounded batch matrix in `/api/research-workspaces`.
- `mcp-server/`: Python FastAPI MCP-style retrieval service exposing `/health`, `/metrics`, `/tools/list`, `/tools/call`, and MCP ASGI transport.
- `pipeline/` + `supabase/`: PDF extraction, markdown/preview generation, v2 section/chunk embedding, and Supabase pgvector readiness checks.

## Runtime Flow
```text
user question
-> web /api/chat
-> router/context planner (gpt-5.6-luna by default)
-> MCP retrieval tools
-> evidence packet builder + dedupe + context budget
-> selected answer model
-> Fast Answer or structured Agentic Evidence Mission
-> markdown answer + context/mission annotations
```

## Agentic Evidence Mission

`experience=mission|learn|research|automated` reuses the same bounded retrieval loop and produces a `civilmcp_mission` message annotation. The artifact contains an evidence verdict, linked matrix rows, transfer checks, learning checkpoints, trust metrics, and an inspectable stage summary. `research` adds a conservative multi-paper analyst prompt. `automated` additionally decomposes the goal into subquestions, records a bounded execution program, and publishes an audit-ready dossier. Both Pro modes are server-gated before credit reservation. Evidence IDs are allow-listed against retrieved packets before publication; invalid model-proposed IDs are removed and weak/failed structured output falls back to a conservative deterministic brief and automation plan.

The artifact is transcript data, so the existing history and share paths persist it without a new table. The browser can export it as Markdown. `experience=answer` keeps the existing streaming response path. The legacy `automated` transcript shape remains readable for compatibility, but new automated batch work starts from Research Workspace Pro instead of the Chat experience picker. No private chain of thought, raw MCP payload, API key, or similarity score is exposed.

## Research Workspace Pro

`/api/research-workspaces` is the Founder Pro batch-research boundary. It accepts at most six selected CivilMCP papers and six AI columns, loads at most six page-linked packets per paper, and generates a typed matrix with GPT-5.6 Luna, Terra, or Sol. Evidence IDs use per-paper allow lists (`P1E1`, `P1E2`, and so on); the server removes any ID that belongs to another row or was not supplied. Unsupported cells are marked for review instead of receiving fabricated citations.

Entitlement, distributed run quota, and weighted credit reservation are server-enforced. Credits are reserved once per selected paper and refunded if the batch fails. Local browser state provides the free preview. Founder Pro workspaces serialize into the existing `civil_paper_workspaces.notes` field, and every database read, write, and delete is scoped to the authenticated owner. CSV export includes the generated value, exact-page source list, and human-review state for each AI column.

The `PRISMA scoping review` template reuses this boundary instead of adding a review service or database schema. Its local/synced workspace state adds a bounded protocol, per-paper human screening decisions and exclusion reasons, live candidate/screened/excluded/included counts, PRISMA readiness checks, and a Markdown review-log export. Only papers marked included are eligible for the batch evidence extraction. The product labels the workflow `PRISMA-ScR guided` and explicitly limits the claim to the selected CivilMCP candidate set; comprehensive multi-database systematic-review claims remain out of scope until external search, deduplication, and independent reviewer reconciliation exist.

## Research Path and OpenAlex

`/api/research-path` accepts a bounded goal, level, outcome, and optional collection. It tokenizes the goal, expands a small bilingual civil-engineering vocabulary, and ranks matching feed cards by title/source hits, discipline alignment, and section evidence. Only documents with a direct goal-token match are eligible; the route returns a recoverable specificity error instead of filling a sparse result with generic papers. It selects at most eight existing CivilMCP feed cards and distributes them across four deterministic stages; it does not create a new agent loop or store a new server-side record. Browser progress is local-first and each stage can continue into Tutor Mission with an evidence-bounded prompt.

When a server-only `OPENALEX_API_KEY` is configured, the route adds up to four global work records from OpenAlex with an eight-second timeout. OpenAlex is treated as a discovery/metadata bridge, never as page-level evidence for CivilMCP answers. Missing or unavailable OpenAlex access degrades to a normal public search link.

## Retrieval Substrate
- Embeddings: `text-embedding-3-small` with `EMBEDDING_DIMENSIONS=768`.
- Collections: `ce_project` and `ncce` in v2 tables.
- MCP tools are read-only and must keep `readOnlyHint=true`, `openWorldHint=false`, `destructiveHint=false`.
- Rollback paths: `AGENTIC_CONTEXT_ENABLED=false`, `RETRIEVAL_VERSION=v1`, or collection filtering.

## Shared MCP Consumers
- CivilMCP Research (`web/app/api/chat/route.ts`) uses the MCP server as the retrieval tool layer behind the bounded Agentic Context Engine.
- CityMCP Ops (`citymcp/ops-dashboard/lib/mcp.ts`) uses the same MCP server as a read-only evidence service, primarily through `search_civil_chunks`.
- Keep the `collection`, `discipline`, and read-only tool contracts backward compatible. CityMCP currently relies on `discipline="transport"` with `collection=""` for civil evidence gating.
- Data-quality cleanup can change source text, titles, summaries, pages, hashes, and embeddings, but must not rename existing tool names or remove v2 fields used by either consumer.
- CityMCP application code, harnesses, CI, release, and operations docs live under `citymcp/` and are excluded from CivilMCP competition scoring.

## Boundary Rules
- Browser never receives service-role Supabase key, OpenAI key, DeepSeek key, OpenAlex key, or MCP server key.
- Web app orchestrates chat/model behavior; MCP server remains retrieval-only.
- Pipeline/indexing jobs do not run on Vercel request paths.
- Harness scripts may call live services but must skip with `warn` when required endpoints or keys are absent.
