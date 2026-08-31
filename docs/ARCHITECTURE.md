# Seedy Research Architecture

## System Shape
Seedy Research has three production surfaces. Existing CivilMCP identifiers remain as compatibility contracts through the Challenge release:
- `web/`: Next.js 15 app with research feed, chat UI, bounded Agentic Context Engine orchestration in `/api/chat`, adaptive Thai-to-global path assembly in `/api/research-path`, a bounded Verified Review matrix in `/api/research-workspaces`, and six browser-native SeedyMCP tools registered from the top-level page.
- `mcp-server/`: Python FastAPI service exposing the public stateless MCP v2 endpoint at `/v2/mcp`, OAuth protected-resource metadata, and the existing `/tools/list`, `/tools/call`, and legacy MCP transport used by first-party consumers.
- `pipeline/` + `supabase/`: provider registry, metadata harvesting, page-preserving PDF/OCR extraction, markdown/preview generation, v2 section/chunk embedding, and Supabase pgvector readiness checks.

## Browser-native WebMCP surface

`web/lib/webmcp.ts` registers `discover_research`, `inspect_paper_evidence`, `trace_research_connections`, `draft_research_passport`, `build_research_path`, and `inspect_learning_progress` through the imperative `document.modelContext.registerTool(...)` API after the page session is ready. This SeedyMCP surface is distinct from the remote MCP server: remote MCP can operate independently of an open webpage, while SeedyMCP lets an agent and person share the live page, identity, and UI state.

The browser tools call only existing same-origin APIs and reuse their authorization, distributed quota, provider timeout, bounded retrieval, and evidence-rights controls. Schemas are narrow and validated again in application code. Paper text and external metadata carry `untrustedContentHint`; discovery/evidence/progress declare `readOnlyHint`; Research Passport drafting and Research Path creation declare state changes. Registration uses `AbortController`, and network handlers honor execution cancellation.

```text
person + browser agent on the same Seedy Research page
-> SeedyMCP discovers a bounded site tool
-> existing same-origin API and server guardrails
-> concise structured tool result
-> visible Explore / evidence drawer / connection map / Research Path / Research Passport state
-> person verifies, answers, corrects, or continues
```

### Thai-to-Global Research Path

The hero journey uses the browser tools as one stateful chain: bounded Thai
discovery, exact-page or lawful full-paper inspection, an exact-DOI OpenAlex
connection trace, selected metadata-only global leads, a four-stage Research
Path ending in a candidate gap and falsifiable Next-Study Protocol, and the
Research Passport review/export checkpoint. Title-only and title/year OpenAlex
matches remain candidates and return no relationship graph; an incompatible or
unresolved DOI never falls through to automatic identity promotion.

### Evidence-bounded Research Passport trust checkpoint

`draft_research_passport` is stateful by design. It accepts an active indexed
Thai paper source, an 8–180 character focus, one to three evidence IDs already
visible in that paper, and one of five gap lenses. Application validation
rejects private papers, discovery-only records, evidence outside the active
paper, and packets without original page provenance.

The browser reuses `/api/global-discovery` for a bounded OpenAlex lookup and
stores no global record as CivilMCP evidence. A Passport contains the selected
Thai anchors, at most four OpenAlex metadata-only leads, and one deterministic
candidate validation statement. The visible artifact and concise tool result
state that the global records are non-citable and that novelty and
transferability are not established. If OpenAlex is unavailable, the Thai
evidence remains usable and the artifact carries a public search link.

Passport state is local to the current page. Export remains disabled until the
person reopens every selected exact-page anchor and acknowledges page review; for Thai excerpts, a bounded translation request runs alongside global discovery and retains the original when translation is unavailable; the candidate inference remains unvalidated, and the resulting Markdown repeats
the evidence/metadata/inference boundary. This is a provenance and
human-agent-review workflow, not scientific validation, novelty detection, or
a comprehensive literature review.

## Runtime Flow
```text
user question
-> web /api/chat
-> deterministic router/context planner (optional GPT-5.6 Luna fallback)
-> one bounded combined MCP retrieval call by default
-> evidence packet builder + dedupe + context budget
-> selected answer model
-> Fast Answer or structured Agentic Evidence Mission
-> markdown answer + context/mission annotations
```

## Agentic Evidence Mission

`experience=mission|learn|research|automated` reuses the same bounded retrieval loop and produces a `civilmcp_mission` message annotation. The artifact contains an evidence verdict, linked matrix rows, transfer checks, learning checkpoints, trust metrics, and an inspectable stage summary. `research` adds a conservative multi-paper analyst prompt. `automated` additionally decomposes the goal into subquestions, records a bounded execution program, and publishes an audit-ready dossier. Open Access enables both modes without credit reservation. Evidence IDs are allow-listed against retrieved packets before publication; invalid model-proposed IDs are removed and weak/failed structured output falls back to a conservative deterministic brief and automation plan.

The artifact is transcript data, so the existing history and share paths persist it without a new table. The browser can export it as Markdown. `experience=answer` keeps the existing streaming response path. The legacy `automated` transcript shape remains readable for compatibility, but new automated batch work starts from Research Workspace instead of the Chat experience picker. No private chain of thought, raw MCP payload, API key, or similarity score is exposed.

## Evidence Audit and exact-packet links

Every MCP answer receives the same `civilmcp_context` annotation, including its interpreted search query, matched bilingual civil-engineering concepts, intent, discipline, collection, retrieval mode, bounded context counts, and allow-listed evidence packets. A deterministic query interpreter appends a small curated Thai/English synonym set for high-risk domain concepts such as plastic pipes, construction delay, road safety, flood resilience, foundations, pavements, and Thai engineering standards; the final interpreted scope is visible rather than hidden. The browser derives an Evidence Audit deterministically from the answer and this annotation: it reports whether every `[E#]` marker resolves, whether the cited packets have exact pages, which papers were cited, and which answer lines carry each marker. This is a provenance/link-integrity check, not a second model judgment and not a claim of scientific correctness.

Evidence actions pass the packet identity rather than only the paper source. `/api/papers/[source]` accepts a bounded chunk ID or section/chunk/page fallback, fetches that packet even when it is outside the representative first page of results, and places it first in the detail response. The drawer highlights it, while `paper`, `evidence`, `section`, `chunk`, and `page` query parameters make the inspected packet reopenable. Reindex-safe fallback uses section/chunk/page when an internal chunk ID changes.

## Research Workspace

`/api/research-workspaces` is an open-access bounded batch-research boundary. Each server request accepts at most six selected papers and six AI columns, loads at most six page-linked packets per paper, and generates a typed matrix with the selected model. The browser may sequence up to 50 project papers through those bounded requests and saves the owner-scoped project after every completed batch when signed in. Evidence IDs use per-paper allow lists (`P1E1`, `P1E2`, and so on); the server removes any ID that belongs to another row or was not supplied. Unsupported cells are marked for review instead of receiving fabricated citations.

Distributed abuse limits and fixed paper/column/evidence budgets are server-enforced; weighted credit reservation becomes a no-op while Open Access is active. Explore can hand off two to six saved paper sources into Workspace; the merge preserves existing rows and reviewed cells instead of reseeding an unrelated feed set. The demo requires authentication for product features, and workspaces serialize into the existing `civil_paper_workspaces.notes` field with every database read, write, and delete scoped to the authenticated owner. CSV export includes the generated value, exact-page source list, and human-review state for each AI column.

Feature access is centralized in `web/lib/product-access.ts`. Explore, Chat, Research Workspace, Research Path, Chat History, and Share/Export each expose independent `enabled` and `requiresAuth` flags. Client navigation redirects unauthenticated intent to Account and resumes the requested feature after sign-in; the corresponding API routes repeat the feature and authentication check server-side. Research Path browser persistence is namespaced by authenticated user id.

The `PRISMA scoping review` template reuses this boundary instead of adding a review service or database schema. Its local/synced workspace state adds a bounded protocol and search strategy, per-paper human screening decisions and exclusion reasons, live candidate/screened/excluded/included counts, PRISMA readiness checks, and a Markdown research-pack export containing the screening log, extraction matrix, exact-page provenance, and review state. Only papers marked included are eligible for the batch evidence extraction. The product labels the workflow `PRISMA-ScR guided` and explicitly limits the claim to the selected CivilMCP candidate set; comprehensive multi-database systematic-review claims remain out of scope until external search, deduplication, and independent reviewer reconciliation exist.

`/api/private-library` accepts authenticated PDF, DOI, BibTeX, RIS, or manual imports. PDFs are capped at 12 MB, 200 pages, and 300,000 extracted characters; the binary is discarded and bounded page text is stored under the owner only. Private sources never enter the public corpus. Citation-only imports remain metadata-only. `civil_private_library_items` cascades on account deletion.

`/api/living-reviews` stores an owner-scoped search fingerprint and up to 200 current result keys. A check compares bounded CivilMCP results and OpenAlex metadata with the prior set and returns the new-record count. It is an in-app retention loop, not an email subscription or unattended crawler.

## Research Path and OpenAlex

`/api/research-path` accepts a bounded goal, level, outcome, optional collection, up to four assessed knowledge gaps, and at most four validated OpenAlex work records selected from the active exact-DOI connection map. Selected global records enter the planner only as untrusted metadata comparison targets; they never enter the Thai evidence allow list. Corpus search and OpenAlex discovery start in parallel, and the internal feed call skips unused facet aggregation. It ranks at most eight matching papers, loads bounded page-linked excerpts, and asks GPT-5.6 Luna for a typed four-stage plan: map the Thai field and coverage limit; inspect methods and findings on exact pages or rights-cleared full text; connect Thai evidence to metadata-only global leads; then frame one candidate gap and a falsifiable Next-Study Protocol. The typed result contains a `candidate_unvalidated` gap with `noveltyEstablished: false` and a `draft_framework` protocol with question, context/population, data, method, validation, falsification, and evidence boundary. Paper identifiers are validated against the retrieved allow list; provider failure returns both artifacts from a conservative deterministic fallback rather than dropping them. One to three directly relevant papers produce an explicit limited-coverage path instead of unrelated filler. Checkpoint evidence is allow-listed, global records never enter the evidence set, and candidate gaps are never represented as proven novelty. Adaptive rebuilds preserve mastered stages and selected connection leads.

When a server-only `OPENALEX_API_KEY` is configured, Research Path adds up to four global work records with a 2.5-second path-specific budget while Explore discovery retains the general eight-second timeout. A low-volume Challenge environment may explicitly set `OPENALEX_ALLOW_ANONYMOUS=true` when no key is available; the default remains off, and the anonymous allowance is not capacity evidence. Explore exposes `/api/global-discovery` only after an explicit user action; it returns at most six metadata records under its own distributed quota and stores no raw query. OpenAlex is treated as a discovery/metadata bridge, never as page-level evidence for Seedy Research answers. Missing, disabled, rate-limited, or unavailable OpenAlex access degrades to a normal public search link.

`/api/citation-map` accepts structured DOI/title/year input and resolves a bounded OpenAlex seed plus at most 12 incoming, referenced, or related nodes. Only exact DOI matches are automatically verified. Exact title/year, fuzzy, ambiguous, and DOI-fallback matches remain candidates or unmatched and return no graph until richer bibliographic identity is reviewed. Every node is metadata-only. Relationship enrichment is best-effort after seed verification: a transient optional-node failure preserves the DOI-verified seed and labels the relationship layer `partial` or `unavailable` instead of erasing the verified identity. `/papers/{source}` is the indexable acquisition surface for CivilMCP papers: it emits canonical metadata and ScholarlyArticle JSON-LD while showing only record metadata, section labels, and page ranges. `/sitemap.xml` lists at most 2,000 public evidence records. Raw source text remains inside the controlled evidence workflow.

## Retrieval Substrate
- Embeddings: `text-embedding-3-small` with `EMBEDDING_DIMENSIONS=768`.
- Web chat defaults to `FAST_RETRIEVAL_ENABLED=true`, which calls the existing `search_civil_knowledge` tool once so section and chunk RPCs share one query embedding. The legacy two-tool recipe remains available by setting the flag false.
- Semantic search is the normal path. If the embedding provider is unavailable, the MCP server opens a short circuit breaker and calls bounded Supabase lexical RPCs backed by trigram indexes. Responses declare `retrieval_mode=lexical_fallback`, keep the same page-linked evidence shape, and never silently claim semantic coverage.
- Page-linked evidence collections: `ce_project` (legacy internal ID for Student Transport Projects) and `ncce` in v2 tables.
- Discovery catalog: `civil_source_catalog` stores provider records for Student Transport, NCCE, ThaiJO, and future TCI, TNRR, ThaiLIS/TDC, conference, and institutional-repository connectors. ThaiJO and the TCI citation index are separate providers even though deployed ThaiJO rows retain the legacy `tci_thaijo` ID. Server-side search avoids loading the growing catalog into the web process. The versioned rights manifest records permitted metadata, abstract, full-text, transformation, display, redistribution, commercial, and training actions; unspecified actions default to denied. Catalog presence never makes a record citable evidence.
- Explore feed: bounded SQL RPCs paginate evidence documents, aggregate corpus facets, and return per-document preview packets as set operations. The rolling-deploy fallback is bounded and does not issue one query per card.
- Promotion gate: external metadata becomes evidence only after full-text rights, stable provenance, page mapping, OCR quality, deduplication, and embedding checks pass.
- MCP declares 19 tools with explicit safety annotations. Seventeen evidence/discovery/private-read tools keep `readOnlyHint=true`; `save_library_item` is a non-destructive write and `remove_library_item` is destructive. Existing retrieval tools remain backward compatible and read-only for CityMCP.
- Rollback paths: `FAST_RETRIEVAL_ENABLED=false`, `LLM_ROUTER_ENABLED=true`, `AGENTIC_CONTEXT_ENABLED=false`, `RETRIEVAL_VERSION=v1`, or collection filtering.

## Public Product Controls

- Supabase Auth owns Google and email/password identity. Its route client accepts only a valid anon/publishable key and fails closed; the service-role key is reserved for explicit server administration. Every chat, workspace, billing, feedback, and deletion operation is server-scoped to the resolved user or signed guest identity.
- `/api/events` records an allow-listed set of activation events without raw research queries. `/api/support` stores rate-limited support, privacy, copyright, and source-takedown requests for operator review.
- Event properties are server-stamped with `trafficClass`, environment, release SHA, and deployment ID so human activation is not mixed with E2E, smoke, or eval traffic.
- Personal MCP tokens use the `cvmcp_` prefix, are displayed once, stored only as SHA-256 hashes, owner-scoped, revocable, rate-limited, and cascaded on account deletion.
- Public MCP v2 exposes 14 task-level tools rather than the retrieval plumbing used by the web app. It reuses the same bounded evidence, OpenAlex, private-PDF, and library implementations. The legacy 19-tool contract remains unchanged for CivilMCP web and CityMCP.
- Personal-key and OAuth calls to public MCP v2 bypass the dormant Research Unit ledger while Open Access is active. Per-client distributed safety rate limits and tool budgets still apply. The PostgreSQL unit schedule remains compatibility infrastructure for a future explicitly gated mode.
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
