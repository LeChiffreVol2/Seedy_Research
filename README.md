# CivilMCP

**CivilMCP is the evidence layer for Thai civil engineering education.** It is a Public Research Preview that turns a uniquely structured corpus of Thai civil-engineering research into searchable, bilingual, page-linked evidence for students, instructors, and researchers.

[Open the public preview](https://civil-mcp-web.vercel.app/) · [Launch readiness](docs/LAUNCH_READINESS.md) · [Data expansion](docs/DATA_EXPANSION.md) · [Data sources and rights](DATA_SOURCES.md)

> Research evidence, not professional engineering advice.

## Corpus

| Collection | Papers | Coverage |
| --- | ---: | --- |
| Student Transport Projects | 67 | Student transport research projects, 2019–2024 |
| NCCE | 1,230 | NCCE25, NCCE26, NCCE29, and NCCE31 proceedings |
| **Total** | **1,297** | **11,523 active, page-linked sections · 68,614 page-linked evidence chunks** |

These public proof metrics intentionally exclude stale or non-page-linked rows.
The underlying index contains 69,687 active chunk rows; the headline excludes
1,073 legacy/non-page-linked rows that are not counted as corpus proof.

The application can search this corpus, synthesize findings across papers, open the exact evidence pages, and translate Thai paper content to English. The source PDFs and extracted corpus are intentionally not redistributed through Git; see [DATA_SOURCES.md](DATA_SOURCES.md).

## Flagship: Agentic Evidence Mission

With MCP on, the default run is a bounded, fully-agentic Evidence Mission:

1. plan the research intent and retrieval query;
2. search and rerank page-linked evidence under fixed tool/context budgets;
3. compare sources and surface limited or conflicting coverage;
4. verify exact-page provenance;
5. publish a linked Evidence Brief with an evidence matrix, Thailand → World transfer checks, and Socratic learning checkpoints.

The brief is stored in the existing chat history/share transcript and exports as portable Markdown. `Tutor Mission` emphasizes guided checkpoints; `Fast Answer` preserves the existing streaming brief. Agent activity is inspectable, but private reasoning and raw tool payloads are never exposed. See [docs/AGENTIC_EVIDENCE_MISSIONS.md](docs/AGENTIC_EVIDENCE_MISSIONS.md).

Explore remains the feed-first discovery surface: search, filter, inspect a paper, open its evidence, and continue into chat. It keeps page-citable evidence separate from ThaiJO discovery metadata, learns a lightweight `For you` ranking from saved papers, and syncs a personal library with notes, labels/folders, BibTeX, RIS/Zotero export, and related Thai evidence. Paper detail and `Research Path` bridge to global metadata through OpenAlex without presenting external metadata as CivilMCP evidence. `Deep Research` is the Founder Pro workflow for a rigorous one-question brief.

`Research Workspace Pro` is a separate, spreadsheet-style automated-research surface rather than a chat mode. Papers are rows and bounded AI instructions are columns. A run can process up to six selected papers across six columns, attaches allow-listed exact-page evidence to every supported cell, exposes confidence and human-review states, and exports a source-bearing CSV. The browser keeps a local draft; Founder Pro adds account sync and batch execution. Models consume weighted credits per selected paper.

## Model behavior

- `deepseek-v4-flash` is the default for answers, retrieval planning, memory compaction, paper translation, and Research Workspace runs.
- The model picker also offers `deepseek-v4-pro` and the GPT-5.6 family. Every model except DeepSeek Flash requires Founder Pro.
- Paper translation uses the same server-side model catalog and defaults to DeepSeek Flash.
- Retrieval remains bounded by `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, and `MAX_CONTEXT_TOKENS`.

## Research Preview plans

- Guest preview: DeepSeek Flash with the public rate limit; no login required.
- Free account: DeepSeek Flash, synced history, and 100 weighted answer credits per week, resetting Monday at 00:00 UTC.
- Founder Pro: ฿199/month, 150 credits, DeepSeek Pro, and GPT-5.6 family access; credits do not roll over.

Deep Research and Research Workspace batch execution require Founder Pro. Workspace runs charge the selected model weight once per selected paper and remain capped at six papers by six columns per request; there is no unlimited or unattended background-agent quota.

Supabase Auth remains the identity source. Google OAuth and email magic links are the primary sign-in paths, with password sign-in available as a fallback. Billing uses Stripe-hosted Checkout and Customer Portal; entitlement and credit checks are always enforced on the server.

The current Vercel Hobby launch is a free Research Preview. Founder Pro pricing
and gates are product-preview surfaces only; Stripe checkout must remain
unconfigured until the deployment moves to a paid Vercel plan and commercial
data-rights review is complete.

## Architecture

```text
question
  -> Next.js /api/chat
  -> DeepSeek V4 Flash retrieval plan
  -> read-only MCP retrieval tools
  -> bounded evidence packet with exact pages
  -> selected answer model / structured Evidence Brief
  -> cited answer + artifact + trace/feedback metadata
```

- `web/`: Next.js research feed, chat, Research Workspace Pro, paper detail, translation, history, and feedback.
- `mcp-server/`: FastAPI MCP service with 11 read-only evidence, catalog, related-paper, and provider tools.
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

`DEEPSEEK_API_KEY` powers the default chat, router, translation, and Workspace path. `OPENAI_API_KEY` remains server-only for Pro GPT models and embedding jobs. `OPENALEX_API_KEY` is optional and server-only; without it, Research Path keeps a safe link-only bridge to OpenAlex search. Never expose provider, service-role, or MCP keys through `NEXT_PUBLIC_*` variables.

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

TCI/ThaiJO begins as bounded OAI metadata in `civil_source_catalog`; it is not
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
