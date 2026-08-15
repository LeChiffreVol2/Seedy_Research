# CivilMCP Architecture

## System Shape
CivilMCP has three production surfaces:
- `web/`: Next.js 15 app with research feed, chat UI, bounded Agentic Context Engine orchestration in `/api/chat`, adaptive learning-path assembly in `/api/research-path`, and a bounded Verified Review matrix in `/api/research-workspaces`.
- `mcp-server/`: Python FastAPI service exposing the public stateless MCP v2 endpoint at `/v2/mcp`, OAuth protected-resource metadata, and the existing `/tools/list`, `/tools/call`, and legacy MCP transport used by first-party consumers.
- `pipeline/` + `supabase/`: provider registry, metadata harvesting, page-preserving PDF/OCR extraction, markdown/preview generation, v2 section/chunk embedding, and Supabase pgvector readiness checks.

## Runtime Flow
```text
user question
-> web /api/chat
-> router/context planner (deepseek-v4-flash by default)
-> MCP retrieval tools
-> evidence packet builder + dedupe + context budget
-> selected answer model
-> Fast Answer or structured Agentic Evidence Mission
-> markdown answer + context/mission annotations
```

## Agentic Evidence Mission

`experience=mission|learn|research|automated` reuses the same bounded retrieval loop and produces a `civilmcp_mission` message annotation. The artifact contains an evidence verdict, linked matrix rows, transfer checks, learning checkpoints, trust metrics, and an inspectable stage summary. `research` adds a conservative multi-paper analyst prompt. `automated` additionally decomposes the goal into subquestions, records a bounded execution program, and publishes an audit-ready dossier. Both Pro modes are server-gated before credit reservation. Evidence IDs are allow-listed against retrieved packets before publication; invalid model-proposed IDs are removed and weak/failed structured output falls back to a conservative deterministic brief and automation plan.

The artifact is transcript data, so the existing history and share paths persist it without a new table. The browser can export it as Markdown. `experience=answer` keeps the existing streaming response path. The legacy `automated` transcript shape remains readable for compatibility, but new automated batch work starts from Research Workspace Pro instead of the Chat experience picker. No private chain of thought, raw MCP payload, API key, or similarity score is exposed.

## Evidence Audit and exact-packet links

Every MCP answer receives the same `civilmcp_context` annotation, including its interpreted search query, matched bilingual civil-engineering concepts, intent, discipline, collection, retrieval mode, bounded context counts, and allow-listed evidence packets. A deterministic query interpreter appends a small curated Thai/English synonym set for high-risk domain concepts such as plastic pipes, construction delay, road safety, flood resilience, foundations, pavements, and Thai engineering standards; the final interpreted scope is visible rather than hidden. The browser derives an Evidence Audit deterministically from the answer and this annotation: it reports whether every `[E#]` marker resolves, whether the cited packets have exact pages, which papers were cited, and which answer lines carry each marker. This is a provenance/link-integrity check, not a second model judgment and not a claim of scientific correctness.

Evidence actions pass the packet identity rather than only the paper source. `/api/papers/[source]` accepts a bounded chunk ID or section/chunk/page fallback, fetches that packet even when it is outside the representative first page of results, and places it first in the detail response. The drawer highlights it, while `paper`, `evidence`, `section`, `chunk`, and `page` query parameters make the inspected packet reopenable. Reindex-safe fallback uses section/chunk/page when an internal chunk ID changes.

## Research Workspace Pro

`/api/research-workspaces` is the Founder Pro batch-research boundary. Each server request accepts at most six selected papers and six AI columns, loads at most six page-linked packets per paper, and generates a typed matrix with the selected model. The browser may sequence up to 50 project papers through those bounded requests and saves the owner-scoped project after every completed batch. Evidence IDs use per-paper allow lists (`P1E1`, `P1E2`, and so on); the server removes any ID that belongs to another row or was not supplied. Unsupported cells are marked for review instead of receiving fabricated citations.

Entitlement, distributed run quota, and weighted credit reservation are server-enforced. Credits are reserved once per selected paper. A failed batch reports credits as restored only after the refund ledger confirms every reservation; otherwise the API returns a pending-recovery state and support trace. Explore can hand off two to six saved paper sources into Workspace; the merge preserves existing rows and reviewed cells instead of reseeding an unrelated feed set. Local browser state provides the free preview. Founder Pro workspaces serialize into the existing `civil_paper_workspaces.notes` field, and every database read, write, and delete is scoped to the authenticated owner. CSV export includes the generated value, exact-page source list, and human-review state for each AI column.

The `PRISMA scoping review` template reuses this boundary instead of adding a review service or database schema. Its local/synced workspace state adds a bounded protocol and search strategy, per-paper human screening decisions and exclusion reasons, live candidate/screened/excluded/included counts, PRISMA readiness checks, and a Markdown research-pack export containing the screening log, extraction matrix, exact-page provenance, and review state. Only papers marked included are eligible for the batch evidence extraction. The product labels the workflow `PRISMA-ScR guided` and explicitly limits the claim to the selected CivilMCP candidate set; comprehensive multi-database systematic-review claims remain out of scope until external search, deduplication, and independent reviewer reconciliation exist.

`/api/private-library` accepts authenticated PDF, DOI, BibTeX, RIS, or manual imports. PDFs are capped at 12 MB, 200 pages, and 300,000 extracted characters; the binary is discarded and bounded page text is stored under the owner only. Private sources never enter the public corpus. Citation-only imports remain metadata-only. `civil_private_library_items` cascades on account deletion.

`/api/living-reviews` stores an owner-scoped search fingerprint and up to 200 current result keys. A check compares bounded CivilMCP results and OpenAlex metadata with the prior set and returns the new-record count. It is an in-app retention loop, not an email subscription or unattended crawler.

## Research Path and OpenAlex

`/api/research-path` accepts a bounded goal, level, outcome, optional collection, and up to four explicit knowledge gaps. It ranks matching feed cards and distributes at most eight CivilMCP papers across four stages. Each stage includes a checkpoint and concepts; `Need review` rebuilds the path with those concepts in retrieval and prompts, while `Understood` advances local mastery. It does not infer mastery from private reasoning or add another agent loop.

When a server-only `OPENALEX_API_KEY` is configured, the route adds up to four global work records from OpenAlex with an eight-second timeout. Explore also exposes `/api/global-discovery` only after an explicit user action; it returns at most six metadata records under its own distributed quota and stores no raw query. OpenAlex is treated as a discovery/metadata bridge, never as page-level evidence for CivilMCP answers. Missing or unavailable OpenAlex access degrades to a normal public search link.

`/api/citation-map` resolves a bounded OpenAlex seed and at most 12 incoming, referenced, or related nodes. `/papers/{source}` is the indexable acquisition surface for CivilMCP papers: it emits canonical metadata and ScholarlyArticle JSON-LD while showing only record metadata, section labels, and page ranges. `/sitemap.xml` lists at most 2,000 public evidence records. Raw source text remains inside the controlled evidence workflow.

## Retrieval Substrate
- Embeddings: `text-embedding-3-small` with `EMBEDDING_DIMENSIONS=768`.
- Semantic search is the normal path. If the embedding provider is unavailable, the MCP server opens a short circuit breaker and calls bounded Supabase lexical RPCs backed by trigram indexes. Responses declare `retrieval_mode=lexical_fallback`, keep the same page-linked evidence shape, and never silently claim semantic coverage.
- Page-linked evidence collections: `ce_project` (legacy internal ID for Student Transport Projects) and `ncce` in v2 tables.
- Discovery catalog: `civil_source_catalog` stores Student Transport, NCCE, and metadata-only TCI/ThaiJO records. Server-side RPC search avoids loading the growing catalog into the web process. The versioned rights manifest records permitted metadata, abstract, full-text, transformation, display, redistribution, commercial, and training actions; unspecified actions default to denied. Catalog presence never makes a record citable evidence.
- Explore feed: bounded SQL RPCs paginate evidence documents, aggregate corpus facets, and return per-document preview packets as set operations. The rolling-deploy fallback is bounded and does not issue one query per card.
- Promotion gate: external metadata becomes evidence only after full-text rights, stable provenance, page mapping, OCR quality, deduplication, and embedding checks pass.
- MCP declares 19 tools with explicit safety annotations. Seventeen evidence/discovery/private-read tools keep `readOnlyHint=true`; `save_library_item` is a non-destructive write and `remove_library_item` is destructive. Existing retrieval tools remain backward compatible and read-only for CityMCP.
- Rollback paths: `AGENTIC_CONTEXT_ENABLED=false`, `RETRIEVAL_VERSION=v1`, or collection filtering.

## Public Product Controls

- Supabase Auth owns Google and email/password identity. Its route client accepts only a valid anon/publishable key and fails closed; the service-role key is reserved for explicit server administration. Every chat, workspace, billing, feedback, and deletion operation is server-scoped to the resolved user or signed guest identity.
- `/api/events` records an allow-listed set of activation events without raw research queries. `/api/support` stores rate-limited support, privacy, copyright, and source-takedown requests for operator review.
- Event properties are server-stamped with `trafficClass`, environment, release SHA, and deployment ID so human activation is not mixed with E2E, smoke, or eval traffic.
- Personal MCP tokens use the `cvmcp_` prefix, are displayed once, stored only as SHA-256 hashes, owner-scoped, revocable, rate-limited, and cascaded on account deletion.
- Public MCP v2 exposes 14 task-level tools rather than the retrieval plumbing used by the web app. It reuses the same bounded evidence, OpenAlex, private-PDF, and library implementations. The legacy 19-tool contract remains unchanged for CivilMCP web and CityMCP.
- OAuth-capable MCP clients use Supabase Auth as the authorization server. A custom access-token hook binds third-party tokens to the exact `/v2/mcp` audience and adds evidence/private/library permissions. The MCP server validates claims and verifies the live token with Supabase Auth; unverified JWT contents never grant access by themselves.
- V2 Streamable HTTP is stateless and both FastMCP session managers run under the parent FastAPI lifespan. Distributed quota is enforced before the mounted transport handles a request.
- Account deletion rejects active subscriptions, removes all first-party account rows through one service-role-only transactional RPC, and only then removes Supabase Auth access.
- Privacy, Terms, and Support are public static routes. They do not imply professional engineering approval or full-text redistribution rights.

## Shared MCP Consumers
- CivilMCP Research (`web/app/api/chat/route.ts`) uses the MCP server as the retrieval tool layer behind the bounded Agentic Context Engine.
- CityMCP Ops (`citymcp/ops-dashboard/lib/mcp.ts`) uses the same MCP server as a read-only evidence service, primarily through `search_civil_chunks`.
- Keep the `collection`, `discipline`, and read-only tool contracts backward compatible. CityMCP currently relies on `discipline="transport"` with `collection=""` for civil evidence gating.
- Data-quality cleanup can change source text, titles, summaries, pages, hashes, and embeddings, but must not rename existing tool names or remove v2 fields used by either consumer.
- CityMCP application code, harnesses, CI, release, and operations docs live under `citymcp/` and are excluded from CivilMCP competition scoring.

## Boundary Rules
- Browser never receives service-role Supabase key, OpenAI key, DeepSeek key, OpenAlex key, or MCP server key.
- Web app orchestrates chat/model behavior; MCP handles bounded evidence/discovery and explicit owner-scoped library operations, never billing or model generation.
- Pipeline/indexing jobs do not run on Vercel request paths.
- Harness scripts may call live services but must skip with `warn` when required endpoints or keys are absent.
- OAI harvesters remain bounded, respect provider rate limits, and never scrape full-text PDFs implicitly.
