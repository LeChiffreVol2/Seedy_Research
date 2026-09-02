# Seedy Research

**Seedy Research turns overlooked Thai research into a traceable path from exact-page evidence to global connections and a testable next study.** SeedyMCP is the shared human-agent layer. The existing CivilMCP identifiers remain as a compatibility substrate, while the Civil Research Pack is the first rights-reviewed proof vertical—not the product boundary.

[Open the public preview](https://seedresearch.vercel.app/) · [WebMCP Challenge package](docs/WEBMCP_CHALLENGE_SUBMISSION.md) · [Connect an AI agent](https://seedresearch.vercel.app/developers) · [Product thesis](docs/PRODUCT_THESIS.md) · [Full-text and national coverage system](docs/THAI_RESEARCH_FULL_TEXT_SYSTEM.md) · [Launch readiness](docs/LAUNCH_READINESS.md) · [Data sources and rights](DATA_SOURCES.md)

> Research evidence, not professional engineering or clinical advice.

Civil engineering is the proof vertical for a broader Thai-first research,
learning, and deep-tech translation platform. Expansion happens through
reviewed domain packs and source partnerships—not by mixing unverified papers
into the citable evidence index.

## Corpus

| Collection | Papers | Coverage |
| --- | ---: | --- |
| Student Transport Projects | 67 | Student transport research projects, 2019–2024 |
| NCCE | 1,230 | NCCE25, NCCE26, NCCE29, and NCCE31 proceedings |
| Rights-reviewed ThaiJO reader | 103 | 3 LEARN + 100 BSCM TCI Group 1 CC BY 4.0 full papers |
| Thai-affiliated global OA reader | 897 | Version-of-record PMC papers with explicit Thai affiliation and item-level CC BY |
| **Total page-citable** | **2,297** | **26,008 active, page-linked sections/pages** |

The page-linked section count is the current public passage-level proof metric.
The underlying index still has 1,064 active rows without page ranges plus nine
paged rows beyond document-declared chunk counts, so the product no longer
presents every active chunk as exact-page evidence. A staged NCCE31 boundary
repair now produces 1,300 local markdown paper files and 1,299 index-eligible
papers after one reviewed duplicate exclusion. The database-backed Civil Research
Pack remains at 1,297 while 1,000 separately rights-reviewed reader papers
bring the public page-citable total to 2,297; the broader embedding refresh and
exact duplicate cleanup remain separately gated.

The ThaiJO catalog currently contains **2,681 active records**: **2,578
metadata-only discovery records** plus **103 rights-reviewed native papers**.
Together with 1,297 legacy evidence records and 897 Thai-affiliated global OA
native papers, Explore exposes **4,875 searchable records** without conflating
discovery metadata with evidence. The metadata-only
slice spans 16 contributing OAI set specs in two official endpoint families. The
August 31 `sc01` metadata expansion contributed 198 net-new active records after duplicate and
whole-issue filtering. All 2,578 have a publisher link, 833 have a DOI, and none
is eligible for AI answers or citations until full-text rights and page
provenance pass the evidence promotion gates. Another 44 provider-deleted
records remain only as non-discoverable audit tombstones: 38 from `ph01` and
six added by the `sc01` metadata expansion.

The deployed application can search this corpus, synthesize findings across
papers, reopen exact-page evidence targets, and translate bounded Thai evidence
to English. Production also exposes the rights-verified native full-paper reader
described below.

Production includes a deliberately bounded native-reader corpus of exactly
**1,000 papers and 14,485 page-addressable pages**. It keeps two cohorts visible
rather than presenting them as one national denominator: 103 ThaiJO-hosted
papers (three LEARN fixtures plus 100 BSCM Original/Review Articles from a
current TCI Group 1 journal) and 897 Thai-affiliated global OA papers from PMC.
Every promoted item carries exact item/version CC BY evidence; every
version-of-record asset is checksum-pinned and page-verified.
The reader provides native page
reading, outline and in-paper search, stable anchors, highlights, browser-local
notes, and citation/source export. It fails closed across `native_verified`,
`source_hosted`, `restricted`, `metadata_only`, and `unavailable`; only the
rights-verified native mode receives full page text. The canonical graph
migration and reader packs are applied to Supabase production, and the matching
web/MCP releases are deployed on Vercel. Production database checks report 1,000
native assets over 1,000 canonical works, 14,485 pages, zero page-count
mismatches, Thailand-affiliation evidence on all 897 PMC records, RLS on all six graph
tables, and no direct `anon` or `authenticated` table reads. The production
build, rights/integrity units, focused reader/WebMCP browser suites, and repository
invariants pass. This fixed 1,000-paper corpus is not a claim of ThaiJO, TCI,
TNRR, TDC, conference, or national completeness.

The read path and promotion tooling have a separate **5,000-native-paper
capacity contract**: a synthetic deep page at offset 4,990 remains one bounded
catalog RPC, reader responses remain capped at 10 pages, and a projected
5,000-paper/72,425-page ingest stays within 499 conservative batched PostgREST
requests across ten providers. This does not change the live count of 1,000.
The Thai-local partnership expansion wave has 1,685
screening records and needs item-level rights plus publisher/institution-approved
asset delivery. The identified public-policy queue totals 4,030 gross net-new
screening records—867 short even before failures—so the 5,000 target is
agreement-backed rather than a PDF-crawling
claim. See [the source plan](docs/research/NATIVE_FULL_TEXT_1000_TO_5000_SOURCE_PLAN.md).

The rights-aware reader and provider-completeness contract is defined in
[Thai Research Full-Text System](docs/THAI_RESEARCH_FULL_TEXT_SYSTEM.md). General
source PDFs and the existing extracted corpus remain local-only and are not
redistributed through Git. Git retains the three-paper deterministic fixture and
reproducible ThaiJO/PMC cohort builders; production page text is ingested DB-first
from an ignored, reproducible local pack and PDF binaries are not committed; see
[DATA_SOURCES.md](DATA_SOURCES.md).

## WebMCP: research with a shared human-agent view

Seedy Research exposes six browser-native SeedyMCP site tools from the top-level page with `document.modelContext.registerTool(...)`. The tools reuse the same application APIs, signed-in session, validation, evidence boundary, and visible UI that a person uses:

| Site tool | Shared result |
| --- | --- |
| `discover_research` | Searches Thai evidence and optional OpenAlex metadata, then updates Explore without confusing discovery records with citable evidence. |
| `inspect_paper_evidence` | Opens the paper drawer and highlights bounded evidence with its original page for human verification. For a rights-verified reader paper it also reports the lawful access mode and a reopenable verified page anchor, but never returns full page text through WebMCP. |
| `trace_research_connections` | Matches the active Thai paper to OpenAlex by exact DOI, exposes cites/cited-by/related leads on the shared page, and keeps title-based matches as review-only candidates with no graph. Every returned relation remains metadata-only and non-citable. |
| `draft_research_passport` | Turns one to three exact-page anchors already opened in the active Thai paper into a visible Thai → Global Research Passport with bounded English renderings when needed, at most four non-citable OpenAlex leads, and one candidate validation gap. Every selected page must be reopened before the person can acknowledge page review and export Markdown. |
| `build_research_path` | Creates or adapts a visible Thai-to-global path: map the Thai field, inspect full-paper/page evidence, connect selected metadata-only global leads, then frame a candidate gap and falsifiable Next-Study Protocol. |
| `inspect_learning_progress` | Reads checkpoint status and reviewed learning gaps without returning the learner's private free-text answers. |

This is complementary to the remote MCP service: remote MCP works without an open page, while WebMCP lets a browser agent and a person collaborate in the same live research workspace. Inputs are validated again in application code; paper and external metadata outputs are marked as untrusted content; read-only tools are annotated explicitly; registration and in-flight work support cancellation.

### Challenge hero flow: Passport Trust Gate

The repeatable Challenge flow begins with a rights-reviewed Thai paper, not a
generated summary. The Site tools menu exposes all six capabilities, while the
timed proof invokes only the three calls needed to produce a consequential
human-agent handoff:

1. `discover_research` finds the rights-reviewed ThaiJO paper;
2. `inspect_paper_evidence` opens its exact page and lawful reader state;
3. `draft_research_passport` creates a one-anchor Passport with non-citable
   global metadata and one unvalidated validation gap; and
4. the person reopens the page, acknowledges review, and exports Markdown.

Research Path, connection tracing, and progress inspection remain available
outside the 75-second must-pass flow. The Passport is the trust checkpoint
inside the broader Thai-to-Global Research Path. It renders
three deliberately separate layers:

1. page-linked Thai evidence with exact original pages, retaining the source excerpt and adding a bounded English rendering when translation is available;
2. up to four OpenAlex discovery leads labelled `metadata only` and never used
   as Seedy Research evidence; and
3. one candidate validation gap labelled as inference, with novelty and
   transferability explicitly not established.

Export stays disabled until the person reopens every selected exact-page anchor
and acknowledges the page review. That acknowledgment does not validate the
candidate inference. The exported Markdown preserves the same evidence,
metadata, and inference boundaries. The Passport audits provenance and frames
a next verification step; it does not prove scientific correctness, novelty,
global transferability, or a comprehensive literature gap.

In ChatGPT's built-in browser, use a current account/model configuration where
the Site tools control is visibly available and record that configuration in
the run manifest. OpenAI does not publish a fixed build/account/model matrix;
the app's server-side model settings are a separate concern.

Run the browser contract test with:

```bash
cd web
npx playwright test tests/e2e/webmcp.spec.ts
```

## Flagship: Auditably agentic evidence

With MCP on, the default run is a bounded, inspectable Evidence Review:

1. plan the research intent and retrieval query;
2. search and rerank page-linked evidence under fixed tool/context budgets;
3. compare sources and surface limited or conflicting coverage;
4. verify exact-page provenance;
5. publish a linked Evidence Brief with an evidence matrix, Thailand → World transfer checks, and Socratic learning checkpoints.

Every cited answer also includes a deterministic Evidence Audit: it shows the interpreted query, bilingual Thai/English civil-engineering term expansion, discipline, collection and retrieval mode, resolves every `[E#]` marker to the supplied packet, reports exact-page coverage, and exports a portable claim ledger. Selecting a citation opens and highlights the exact packet used; the URL preserves the source, page, section, and chunk target. The audit verifies provenance, not scientific correctness, so the UI keeps the human-review boundary explicit.

The brief is stored in the existing chat history/share transcript and exports as portable Markdown. `Guided Learning` emphasizes checkpoints; `Quick Answer` preserves the streaming answer path. Agent activity is inspectable, but private reasoning and raw tool payloads are never exposed. See [docs/AGENTIC_EVIDENCE_MISSIONS.md](docs/AGENTIC_EVIDENCE_MISSIONS.md).

Explore remains the feed-first discovery surface: search, filter, inspect a paper, open its evidence, and continue into chat. Its dated Coverage Ledger separates searchable metadata, page-citable evidence, rights-reviewed native pages, source-hosted links, and providers that are not yet connected; a provider filter never turns catalog presence into evidence. It learns a lightweight `For you` ranking from saved papers and syncs a personal library with notes, labels/folders, BibTeX, RIS/Zotero export, and related Thai evidence. Users can explicitly expand a query to bounded OpenAlex metadata, inspect a citation neighborhood, and save the query as a Living Review that reports what changed on the next check. OpenAlex records never become CivilMCP evidence implicitly. By default, indexable `/papers/{source}` pages expose rights-safe metadata, page ranges, and outlines without publishing raw full text. The 103 production reader papers are the bounded exception because each asset has an explicit reviewed native-display decision.

`Research Workspace` is a separate Verified Review Project rather than a chat mode. Papers are rows and bounded AI instructions are columns. Its Research Notebook can answer against only the explicitly selected saved sources, returns allow-listed exact-page locators, keeps private-source answers non-shareable, and can promote a public finding into a review-gated Passport or continue it into a Research Path. Notebook answers are intentionally not persisted in the workspace record. OpenRAG is only an optional, disabled adapter behind this boundary; it cannot become the identity, rights, or evidence authority until its Thai retrieval, page fidelity, isolation, latency, and cost pass the documented release gates. Open Access unlocks batch extraction and every model without answer credits or a plan gate; authentication is required so every run has a durable owner. A project accepts up to 50 CivilMCP or account-private sources and processes six papers per server request, saving account-scoped progress after every completed batch. The Scientific Evidence Snapshot template extracts study design, context, method, results, limitations, and Thai applicability with allow-listed page evidence and human-review state. The PRISMA-ScR guided template captures protocol, search strategy, screening decisions, exclusion reasons, extraction matrix, provenance, and review state in a reproducible Markdown pack. PDF uploads stay account-private; DOI and BibTeX/RIS (including Zotero exports) remain metadata-only until page text is available. The current browser orchestrator supports stop-after-batch and durable saved progress, but is not an unattended background job.

`Research Path` is the primary end-to-end research loop. A reviewed Passport can continue into the path with its Passport ID, public source, exact evidence IDs, gap lens, and selected global leads intact; the server revalidates those locators against the current citable paper before planning. GPT-5.6 Luna builds each stage from allow-listed retrieved papers and bounded page-linked excerpts, while a deterministic retrieval plan remains available if the provider is unavailable. The stages map the Thai field and coverage limit, inspect methods against exact pages or rights-cleared full text, connect selected OpenAlex relations as non-citable comparison leads, and frame one explicitly provisional gap as a Next-Study Protocol with a bounded question, context, data, method, validation step, and falsification condition. Luna evaluates learner reasoning only against allow-listed page packets and links feedback back to the source pages. Adaptive rebuilds preserve mastered work and selected global leads; sparse topics expose limited coverage without unrelated filler.

Signed-in users can create revocable personal MCP keys from Account or authorize an OAuth-capable client. The public stateless endpoint at `https://civil-mcp-server.vercel.app/v2/mcp` exposes 14 high-level tools for discovery, exact-page reading, selected-paper queries, comparison, citation mapping, private PDFs, and folder-based library workflows. The existing 19-tool low-level contract remains available for CivilMCP web and CityMCP compatibility. Personal tokens are shown once and stored only as SHA-256 hashes.

## Model behavior

- GPT-5.6 Luna is the default for answers, optional model routing, memory compaction, paper translation, checkpoints, and Research Workspace runs. Deterministic routing is the low-latency default.
- GPT-5.6 Terra and GPT-5.6 Sol are available for deeper reasoning; DeepSeek Flash and Pro remain optional server-side fallbacks.
- Open Access removes answer-credit, model, Deep Research, Research Workspace, and public MCP Research Unit plan gates.
- Retrieval remains bounded by `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, and `MAX_CONTEXT_TOKENS`.

## Open Access

- Guests can use Explore, Chat, Research Workspace, Research Path, local history, and Share/Export through a signed guest identity and bounded guest quotas.
- Open Access includes every answer model and research mode without a paid plan. Sign-in is an identity/privacy boundary for cross-device sync and private research sources, not a model entitlement.
- Each product surface has independent `enabled` and `requiresAuth` flags. Operators can restore an authenticated-only deployment without changing code.
- Public per-minute/hour limits and bounded agent, tool, context, paper, and column limits remain operational reliability controls rather than commercial quotas.
- Billing and Research Unit ledgers remain dormant compatibility infrastructure and can be re-enabled only by setting Open Access off deliberately.

Supabase Auth remains the identity source. Google OAuth and email/password are the primary sign-in paths, with email recovery links for forgotten passwords. Stripe endpoints fail closed while Open Access is active.

## Architecture

```text
question
  -> Next.js /api/chat
  -> OpenAI GPT-5.6 Luna retrieval plan
  -> MCP evidence/discovery tools
  -> bounded evidence packet with exact pages
  -> selected answer model / structured Evidence Brief
  -> cited answer + artifact + trace/feedback metadata
```

- `web/`: Next.js Research Path, research feed, chat, Research Workspace, paper detail, translation, history, and feedback.
- `mcp-server/`: FastAPI MCP service with a 14-tool public v2 contract plus the 19-tool compatibility contract used by existing first-party consumers.
- `pipeline/`: provider registry, metadata harvesting, page-preserving PDF/OCR extraction, normalization, chunking, and indexing.
- `supabase/`: shared schema and additive migration ledger.
- `harness/` and `eval/`: CivilMCP release, security, retrieval, citation, and memory gates.
- `citymcp/`: archived / maintenance-only CityMCP consumer; excluded from Seedy Research release gates and quality score. Its ingest, CI, and preview/promotion workflows require explicit manual dispatch.

CityMCP shares only the read-only MCP contract and applied Supabase migration history. Its retained application, harness, manual workflows, and archive/recovery instructions live under [citymcp/](citymcp/).

## Quick start

Requirements: Python 3.10, Node.js 20, npm, and a Supabase project containing the indexed corpus.

```bash
cp .env.example .env
python3.10 -m venv .venv310
source .venv310/bin/activate
pip install -r mcp-server/requirements.txt
cd web && npm ci
```

Required server-only environment variables:

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_ANON_KEY`
- `MCP_SERVER_API_KEY`
- `GUEST_SESSION_HMAC_KEY`

The OAuth consent page additionally requires browser-safe
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. They must point
to the same Supabase project and the latter must be an anon/publishable key,
never the service-role key.

Public MCP v2 also uses `MCP_PUBLIC_URL`, `MCP_OAUTH_AUDIENCE`,
`MCP_DOCUMENTATION_URL`, and `MCP_OAUTH_ENABLED`. Keep OAuth disabled until the
Supabase OAuth server and `civil_mcp_access_token_hook` are enabled together.

`OPENAI_API_KEY` powers the default GPT-5.6 Luna chat, Research Path planning and assessment, translation, Workspace generation, and embedding jobs. `DEEPSEEK_API_KEY` is an optional server-side fallback. `OPENALEX_API_KEY` is optional and server-only; without it, Explore and Research Path keep a safe link-only bridge unless the operator explicitly enables the bounded `OPENALEX_ALLOW_ANONYMOUS=true` Challenge fallback. Anonymous access is for low-volume verification, not the approved 100-user/20-workflow capacity target; sustained traffic requires a free or paid server-side OpenAlex key. Never expose provider, service-role, or MCP keys through `NEXT_PUBLIC_*` variables.

Semantic retrieval automatically degrades to a bounded keyword fallback when
the embedding provider is unavailable. Fallback answers keep exact-page
evidence but are labeled as narrower coverage in the chat UI and traces.

Public product controls are available at `/privacy`, `/terms`, and `/support`.
Signed-in users can permanently delete their account and synced research data
from Account settings; active subscriptions must be canceled first. Auth fails
closed unless `SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) is a valid
Supabase anon/publishable key; the service-role key is never used to create an
Auth session client. Apply
`supabase/migrations/20260813110000_civil_transactional_account_deletion.sql`
before enabling account deletion so all first-party account data is removed in
one database transaction before the Supabase Auth user is deleted.

Open Access is enabled by default with `CIVILMCP_OPEN_ACCESS=true` and `NEXT_PUBLIC_CIVILMCP_OPEN_ACCESS=true`; authenticated feature access is enabled with `NEXT_PUBLIC_CIVILMCP_REQUIRE_AUTH=true`. Stripe variables are dormant compatibility settings and should remain absent. Configure Google as a Supabase Auth provider and allow `/auth/callback` on the deployed application origin before exposing the demo.

Run the services in separate terminals:

```bash
cd mcp-server
uvicorn server:app --reload --port 8000
```

```bash
cd web
npm run dev
```

Open `http://localhost:3000`.

## Data setup

Raw PDFs and extracted markdown are local-only and ignored by Git. The default locations are:

```text
CE Project Database/
NCCE Project Database/
pipeline/data/markdown/
```

Extract and index only when you have lawful local access to the source documents:

```bash
python3.10 pipeline/extract.py --engine hybrid
python3.10 pipeline/extract_ncce.py --source-glob 'Proceedings_NCCE31.pdf'
python3.10 pipeline/index.py --mode batch
```

ThaiJO begins as bounded OAI metadata from reviewed official endpoints in
`civil_source_catalog`; set-scoped sources remain allowlisted, while an
endpoint-wide family requires an explicit operator opt-in and the same
metadata-only release gates. The legacy provider ID `tci_thaijo` does not mean
that this is the separate TCI citation index; TCI requires its own official
export or partnership. It is not page-linked evidence until rights and
full-text quality gates pass. NCCE31 entered production as 356 page-citable
papers on 24 July 2026 after the then-current extraction, discipline, title,
page, embedding, and data-quality checks. A later stricter audit found three
reused footer codes that had merged non-contiguous papers and one duplicate;
the staged repair described above corrects both before the next refresh. The
indexer is incremental, does not re-embed unchanged chunks, can resume multiple
completed Batch API parts, and automatically reduces database upsert size after
a statement timeout. A synthetic, redistributable schema example is available at
[fixtures/synthetic-civil-paper.json](fixtures/synthetic-civil-paper.json).

## Demo prompts

1. `Compare NCCE25_CEM14, NCCE25_CEM28, and NCCE25_CEM04. What delay, financial, and scheduling risks do they report? Cite exact pages and distinguish findings from inference.`
2. `Compare NCCE29_TRL40 and NCCE29_TRL42. What truck-crash and road-system factors lead to serious injury or death, where do findings agree or differ, and which findings are site-specific? Cite exact pages.`
3. `Compare NCCE25_MAT06, NCCE25_MAT13, and NCCE25_MAT18. Contrast materials, test methods, performance measures, and limitations with exact-page citations.`
4. After an answer: `Use E1 and explain what a follow-up study should verify.`

## Verification

```bash
python3.10 harness/check_invariants.py
python3.10 harness/test_ga_security.py
python3.10 harness/run_data_quality.py --strict
python3.10 -m unittest pipeline.test_reader_pack
(cd web && node --test lib/paper-reader.test.mjs)
(cd web && npx playwright test tests/e2e/paper-reader.spec.ts)
(cd web && npm run build && npm run test:e2e)
python3.10 harness/run_smoke.py --strict
python3.10 harness/run_eval.py --mode smoke
python3.10 harness/run_memory_eval.py
python3.10 harness/score_quality.py
```

Generated reports are written to ignored `harness/reports/`. Reports must match the candidate source fingerprint and be no older than 24 hours.

## Release and rollback

`.github/workflows/preview-release.yml` builds CivilMCP MCP and web artifacts from one commit, verifies the preview, stages production artifacts without assigning domains, verifies them again, and promotes the same artifacts.

Rollback controls:

- Promote the previous Vercel deployment.
- Set `AGENTIC_CONTEXT_ENABLED=false` to return to simple RAG.
- Set `RETRIEVAL_VERSION=v1` to use the previous retrieval path.
- Filter to `collection=ce_project` to exclude NCCE without changing data.

Operational details are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## License

Source code is available under the [MIT License](LICENSE). The license does not grant rights to source papers, extracted text, previews, or third-party datasets.
