# CivilMCP

**Turn Thai civil-engineering research into a defensible literature review—with every supported claim linked to the exact page.** CivilMCP is a Public Research Preview for finding local work global indexes miss, comparing methods and findings, and exporting an auditable review pack.

[Open the public preview](https://civil-mcp-web.vercel.app/) · [Connect an AI agent](https://civil-mcp-web.vercel.app/developers) · [Product thesis](docs/PRODUCT_THESIS.md) · [Deep-tech roadmap](docs/THAI_DEEP_TECH_ROADMAP.md) · [Launch readiness](docs/LAUNCH_READINESS.md) · [Data sources and rights](DATA_SOURCES.md)

> Research evidence, not professional engineering advice.

Civil engineering is the proof vertical for a broader Thai-first research,
learning, and deep-tech translation platform. Expansion happens through
reviewed domain packs and source partnerships—not by mixing unverified papers
into the citable evidence index.

## Corpus

| Collection | Papers | Coverage |
| --- | ---: | --- |
| Student Transport Projects | 67 | Student transport research projects, 2019–2024 |
| NCCE | 1,230 | NCCE25, NCCE26, NCCE29, and NCCE31 proceedings |
| **Total** | **1,297** | **11,523 active, page-linked sections · 68,614 page-linked evidence chunks** |

These public proof metrics intentionally exclude stale or non-page-linked rows.
The underlying index contains 69,687 active chunk rows; the headline excludes
1,073 legacy/non-page-linked rows that are not counted as corpus proof.

The separate discovery catalog currently adds **2,380 active ThaiJO journal
records** from 11 reviewed civil-engineering and multidisciplinary-engineering
sets, bringing Explore to **3,677 Thai research records**. All 2,380 have a
publisher link, 818 have a DOI, and none is eligible for AI answers or citations
until full-text rights and page provenance pass the evidence promotion gates.
Another 38 provider-deleted records remain only as non-discoverable audit
tombstones.

The application can search this corpus, synthesize findings across papers, open the exact evidence pages, and translate Thai paper content to English. The source PDFs and extracted corpus are intentionally not redistributed through Git; see [DATA_SOURCES.md](DATA_SOURCES.md).

## Flagship: Auditably agentic evidence

With MCP on, the default run is a bounded, inspectable Evidence Review:

1. plan the research intent and retrieval query;
2. search and rerank page-linked evidence under fixed tool/context budgets;
3. compare sources and surface limited or conflicting coverage;
4. verify exact-page provenance;
5. publish a linked Evidence Brief with an evidence matrix, Thailand → World transfer checks, and Socratic learning checkpoints.

Every cited answer also includes a deterministic Evidence Audit: it shows the interpreted query, bilingual Thai/English civil-engineering term expansion, discipline, collection and retrieval mode, resolves every `[E#]` marker to the supplied packet, reports exact-page coverage, and exports a portable claim ledger. Selecting a citation opens and highlights the exact packet used; the URL preserves the source, page, section, and chunk target. The audit verifies provenance, not scientific correctness, so the UI keeps the human-review boundary explicit.

The brief is stored in the existing chat history/share transcript and exports as portable Markdown. `Guided Learning` emphasizes checkpoints; `Quick Answer` preserves the streaming answer path. Agent activity is inspectable, but private reasoning and raw tool payloads are never exposed. See [docs/AGENTIC_EVIDENCE_MISSIONS.md](docs/AGENTIC_EVIDENCE_MISSIONS.md).

Explore remains the feed-first discovery surface: search, filter, inspect a paper, open its evidence, and continue into chat. It keeps page-citable evidence separate from ThaiJO discovery metadata, learns a lightweight `For you` ranking from saved papers, and syncs a personal library with notes, labels/folders, BibTeX, RIS/Zotero export, and related Thai evidence. Users can explicitly expand a query to bounded OpenAlex metadata, inspect a citation neighborhood, and save the query as a Living Review that reports what changed on the next check. OpenAlex records never become CivilMCP evidence implicitly. Indexable `/papers/{source}` pages expose rights-safe metadata, page ranges, and outlines without publishing raw full text.

`Research Workspace Pro` is a separate Verified Review Project rather than a chat mode. Papers are rows and bounded AI instructions are columns. A project accepts up to 50 CivilMCP or account-private sources and processes six papers per server request, saving the project after every completed batch. The Scientific Evidence Snapshot template extracts study design, context, method, results, limitations, and Thai applicability with allow-listed page evidence and human-review state. The PRISMA-ScR guided template captures protocol, search strategy, screening decisions, exclusion reasons, extraction matrix, provenance, and review state in a reproducible Markdown pack. PDF uploads stay account-private; DOI and BibTeX/RIS (including Zotero exports) remain metadata-only until page text is available. The current browser orchestrator supports stop-after-batch and durable saved progress, but is not an unattended background job.

`Research Path` adds a different outcome: evidence-grounded learning. Each stage now has a checkpoint; learners mark a concept understood or needing review, and CivilMCP rebuilds the path around those explicit knowledge gaps while keeping the cited Thai evidence visible.

Signed-in users can create revocable personal MCP keys from Account or authorize an OAuth-capable client. The public stateless endpoint at `https://civil-mcp-server.vercel.app/v2/mcp` exposes 14 high-level tools for discovery, exact-page reading, selected-paper queries, comparison, citation mapping, private PDFs, and folder-based library workflows. The existing 19-tool low-level contract remains available for CivilMCP web and CityMCP compatibility. Personal tokens are shown once and stored only as SHA-256 hashes.

## Model behavior

- `deepseek-v4-flash` is the default for answers, retrieval planning, memory compaction, paper translation, and Research Workspace runs.
- The model picker also offers GPT-5.6 Luna on Free, plus `deepseek-v4-pro`, GPT-5.6 Terra, and GPT-5.6 Sol on Founder Pro.
- Paper translation uses the same server-side model catalog and defaults to DeepSeek Flash.
- Retrieval remains bounded by `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, and `MAX_CONTEXT_TOKENS`.

## Research Preview plans

- Guest preview: DeepSeek Flash with the public rate limit; no login required.
- Free account: DeepSeek Flash and GPT-5.6 Luna at 1 credit per answer, synced history, and 100 weighted answer credits per week, resetting Monday at 00:00 UTC.
- Founder Pro: ฿299/month, the same 100 weekly free credits plus a 500-credit monthly Pro top-up, DeepSeek Pro at 2 credits, GPT-5.6 Terra at 5 credits, GPT-5.6 Sol at 10 credits, and Pro research workflows; unused Pro credits do not roll over.

Public MCP/API use has a separate monthly Research Unit wallet so API traffic
cannot consume chat credits: Free includes 500 units and Founder Pro includes
5,000. Library organization costs 0; paper/library reads cost 1, evidence
queries and snapshots cost 2, discovery and citation mapping cost 3, and a
multi-paper comparison costs 5. Units are reserved atomically before a public
v2 tool call and restored if that call fails. The planned API Scale launch
price is ฿999/month for 50,000 units, with 10,000-unit blocks targeted at ฿199;
it is not purchasable while the service remains on non-commercial Hobby hosting.

Deep Research and Research Workspace batch execution require Founder Pro. Workspace runs charge the selected model weight once per selected paper and remain capped at six papers by six columns per request; there is no unlimited or unattended background-agent quota.

Supabase Auth remains the identity source. Google OAuth and email/password are the primary sign-in paths, with email recovery links for forgotten passwords. Billing uses Stripe-hosted Checkout and Customer Portal; entitlement and credit checks are always enforced on the server.

The current Vercel Hobby launch is a free Research Preview. Founder Pro pricing
and gates are product-preview surfaces only; Stripe checkout must remain
unconfigured until the deployment moves to a paid Vercel plan and commercial
data-rights review is complete.

## Architecture

```text
question
  -> Next.js /api/chat
  -> DeepSeek V4 Flash retrieval plan
  -> MCP evidence/discovery tools
  -> bounded evidence packet with exact pages
  -> selected answer model / structured Evidence Brief
  -> cited answer + artifact + trace/feedback metadata
```

- `web/`: Next.js research feed, chat, Research Workspace Pro, paper detail, translation, history, and feedback.
- `mcp-server/`: FastAPI MCP service with a 14-tool public v2 contract plus the 19-tool compatibility contract used by existing first-party consumers.
- `pipeline/`: provider registry, metadata harvesting, page-preserving PDF/OCR extraction, normalization, chunking, and indexing.
- `supabase/`: shared schema and additive migration ledger.
- `harness/` and `eval/`: CivilMCP release, security, retrieval, citation, and memory gates.
- `citymcp/`: separately managed CityMCP consumer; excluded from CivilMCP release gates and quality score.

CityMCP shares only the read-only MCP contract and applied Supabase migration history. Its application, harness, CI, and release live under [citymcp/](citymcp/).

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

`DEEPSEEK_API_KEY` powers the default chat, router, translation, and Workspace path. `OPENAI_API_KEY` remains server-only for Pro GPT models and embedding jobs. `OPENALEX_API_KEY` is optional and server-only; without it, Explore and Research Path keep a safe link-only bridge to OpenAlex search. Never expose provider, service-role, or MCP keys through `NEXT_PUBLIC_*` variables.

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

Founder Pro additionally requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_FOUNDER_PRO_PRICE_ID`. Without them, the free Research Preview remains fully available and the upgrade control shows “opening soon”. Configure Google as a Supabase Auth provider and allow `/auth/callback` on the deployed application origin.

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

TCI/ThaiJO begins as bounded, allowlisted OAI metadata in `civil_source_catalog`; it is not
page-linked evidence until rights and full-text quality gates pass. NCCE31 is
indexed as 356 page-citable papers after its extraction, discipline, title,
page, embedding, and strict data-quality gates passed on 24 July 2026. The
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
cd web && npm run build && npm run test:e2e
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
