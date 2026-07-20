# CivilMCP

**CivilMCP is the evidence layer for Thai civil engineering education.** It is a Public Research Preview that turns a uniquely structured corpus of Thai civil-engineering research into searchable, bilingual, page-linked evidence for students, instructors, and researchers.

[Open the public preview](https://civil-mcp-web.vercel.app/) · [Build Week notes](BUILD_WEEK.md) · [Data sources and rights](DATA_SOURCES.md)

> Research evidence, not professional engineering advice.

## Corpus

| Collection | Papers | Coverage |
| --- | ---: | --- |
| CE Project | 67 | Civil-engineering research projects, 2019–2024 |
| NCCE | 874 | NCCE25, NCCE26, and NCCE29 proceedings |
| **Total** | **941** | **8,148 active, page-linked sections · 48,370 active, page-linked evidence chunks** |

These public proof metrics intentionally exclude legacy/stale or non-page-linked
rows. The underlying index currently contains 9,413 section records and 50,588
chunk records; only evidence with active page provenance is included above.

The application can search this corpus, synthesize findings across papers, open the exact evidence pages, and translate Thai paper content to English. The source PDFs and extracted corpus are intentionally not redistributed through Git; see [DATA_SOURCES.md](DATA_SOURCES.md).

## Model behavior

- `gpt-5.6-luna` is the default for answers, retrieval planning, memory compaction, and paper translation.
- The answer-model picker also offers `gpt-5.6-terra`, `gpt-5.6-sol`, `deepseek-v4-flash`, and `deepseek-v4-pro`. Terra and Sol require Founder Pro.
- DeepSeek is optional. The default product path only requires OpenAI.
- Retrieval remains bounded by `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, and `MAX_CONTEXT_TOKENS`.

## Research Preview plans

- Guest preview: Luna with the public judge/demo rate limit; no login required.
- Free account: Luna, synced history, and 25 weighted answer credits per month.
- Founder Pro: ฿199/month, 150 credits, and Terra/Sol access. Luna uses 1 credit, Terra 3, and Sol 5; credits do not roll over.

Supabase Auth remains the identity source. Google OAuth and email magic links are the primary sign-in paths, with password sign-in available as a fallback. Billing uses Stripe-hosted Checkout and Customer Portal; entitlement and credit checks are always enforced on the server.

## Architecture

```text
question
  -> Next.js /api/chat
  -> GPT-5.6 Luna retrieval plan
  -> read-only MCP retrieval tools
  -> bounded evidence packet with exact pages
  -> selected answer model
  -> cited answer + trace/feedback metadata
```

- `web/`: Next.js research feed, chat, paper detail, translation, history, and feedback.
- `mcp-server/`: FastAPI MCP-style retrieval service.
- `pipeline/`: PDF extraction, metadata normalization, chunking, and indexing.
- `supabase/`: shared schema and additive migration ledger.
- `harness/` and `eval/`: CivilMCP release, security, retrieval, citation, and memory gates.
- `citymcp/`: separately managed CityMCP consumer; excluded from the Build Week scope and Civil quality score.

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

`DEEPSEEK_API_KEY` is required only when a DeepSeek answer model is selected. Never expose provider, service-role, or MCP keys through `NEXT_PUBLIC_*` variables.

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
python3.10 pipeline/extract.py
python3.10 pipeline/extract_ncce.py
python3.10 pipeline/index.py --mode batch
```

The indexer is incremental and does not re-embed unchanged chunks. A synthetic, redistributable schema example is available at [fixtures/synthetic-civil-paper.json](fixtures/synthetic-civil-paper.json).

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
