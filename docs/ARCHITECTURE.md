# CivilMCP Architecture

## System Shape
CivilMCP has three production surfaces:
- `web/`: Next.js 15 app with research feed, chat UI, bounded Agentic Context Engine orchestration in `/api/chat`.
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

`experience=mission|learn` reuses the same bounded retrieval loop and produces a `civilmcp_mission` message annotation. The artifact contains an evidence verdict, linked matrix rows, transfer checks, learning checkpoints, trust metrics, and an inspectable stage summary. Evidence IDs are allow-listed against retrieved packets before publication; invalid model-proposed IDs are removed and weak/failed structured output falls back to a conservative deterministic brief.

The artifact is transcript data, so the existing history and share paths persist it without a new table. The browser can export it as Markdown. `experience=answer` keeps the existing streaming response path. No private chain of thought, raw MCP payload, API key, or similarity score is exposed.

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
- Browser never receives service-role Supabase key, OpenAI key, DeepSeek key, or MCP server key.
- Web app orchestrates chat/model behavior; MCP server remains retrieval-only.
- Pipeline/indexing jobs do not run on Vercel request paths.
- Harness scripts may call live services but must skip with `warn` when required endpoints or keys are absent.
