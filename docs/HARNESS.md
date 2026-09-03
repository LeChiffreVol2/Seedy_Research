# CivilMCP Harness

The harness is the engineering feedback loop for agentic development. It verifies architecture invariants, live retrieval health, answer/evidence behavior, and product quality score without changing user-facing behavior.

## Commands
```bash
make local-gate
make prod-smoke
make native-scale
make release-gate

python3.10 harness/check_invariants.py
python3.10 harness/run_smoke.py
python3.10 harness/run_smoke.py --strict
python3.10 harness/run_native_scale.py --strict
python3.10 harness/run_memory_eval.py
python3.10 harness/run_eval.py --mode smoke
python3.10 harness/score_quality.py
python3.10 -m unittest pipeline.test_reader_pack
python3.10 -m unittest pipeline.test_native_portfolio harness.test_native_scale
python3.10 -m unittest pipeline.test_source_registry harness.test_ga_security
(cd web && npm run harness:web-smoke)
(cd web && node --test lib/paper-reader.test.mjs)
(cd web && npx playwright test tests/e2e/paper-reader.spec.ts)
(cd web && npx playwright test tests/e2e/webmcp.spec.ts)
(cd web && PERF_BASE_URL=http://127.0.0.1:3210 npm run perf:probe)
```

Use the root `Makefile` for normal release work. The direct harness commands remain useful when debugging a specific failing suite.

## WebMCP browser contract

`web/tests/e2e/webmcp.spec.ts` installs a deterministic browser-side `document.modelContext` host before application hydration. It requires the exact eight-tool contract, checks read-only and untrusted-content annotations, then executes persistent Research Case start/resume, Thai discovery, dated visibility audit, exact-page evidence opening, fail-closed OpenAlex connection tracing, Research Passport drafting/review/export, Thai-to-global Research Path creation, and progress inspection. The test must verify the corresponding visible UI state; a source-string assertion alone is not sufficient.

The same suite has a focused Challenge regression that uses the committed
`thaijo:learn:291631` rights-reviewed reader route rather than the synthetic
road-safety fixture. It proves the four-call Visibility-to-Passport Trust Gate:
Thai-only discovery, dated visibility audit, page-2 inspection, Passport drafting, locked export,
human page reopening, claim-level accept/reject review, Markdown download, and an exact
four-call run trace. Catalog, visibility-audit, and OpenAlex responses remain boundary mocks;
paper detail and reader access use the real committed pack.

The Passport assertions are part of the release contract: a metadata-only
record cannot be opened as evidence; the draft must reject an evidence ID that
is not visible in the active paper; returned OpenAlex leads remain
`citable: false`; the UI states that novelty and transferability are not
established; claim decisions are disabled until their selected anchors have
been reopened; export is enabled only after every claim is decided and at least
one is accepted while the
candidate inference remains unvalidated; bounded Thai-to-English rendering retains both source and translation; and the downloaded Markdown plus visible WebMCP activity trace
preserve the same boundary.

The same browser suite verifies Passport-to-Path continuity: reviewed source
and exact evidence IDs are revalidated server-side and remain visible in the
path while arbitrary or stale context fails closed. The global frontend suite
also exercises the Coverage Ledger/provider filter and the selected-source
Research Notebook, including private non-shareability and public promotion.
`pipeline.test_source_registry` pins the deployed provider, record, reader, and
eight-tool counts so submission copy cannot drift from the machine-readable
registry. `harness.test_ga_security` pins the Notebook owner/membership,
non-persistence, citation allow-list, and private-source boundaries.

Before a challenge release, also run one manual pass in ChatGPT's built-in
browser with Site tools visibly available and one pass in Chrome with native
WebMCP testing enabled. Record the deployed URL, candidate SHA, exact host
build/account/model configuration, eight-tool inventory, prompt, calls, timings,
result, and every confirmation shown. The deterministic E2E proves application
behavior; the manual pass proves compatibility with the actual challenge host.

## Rights-reviewed paper-reader contract

`pipeline.test_reader_pack` verifies the local CC BY 4.0 candidate contains
exactly three distinct ThaiJO papers and 68 checksum-bound pages, that every
page has a stable anchor and integrity hash, and that native display fails unless
all required asset actions and rights provenance are present. It also validates
the canonical work, provider record, asset, and page rows without writing a
database.

`web/lib/paper-reader.test.mjs` covers source/alias resolution, fail-closed native
rights, bounded page pagination, and the reader response contract.
`web/tests/e2e/paper-reader.spec.ts` exercises native reading, outline/search,
page navigation, stable anchors, highlighting, browser-local notes, citation
copy/export, mobile controls, reduced motion, and non-native fallbacks. The mode
matrix is `native_verified`, `source_hosted`, `restricted`, `metadata_only`, and
`unavailable`; only a rights-verified native asset may return full page text.

These suites verify the implementation contract; by themselves they are not
evidence of a database apply, deployment, or national Thai research coverage.
The September 2 production promotion records migrations `20260831120000` and
`20260902010000`, 1,000 rights-verified assets, 14,485 checksum-valid pages, zero
page-count/hash mismatches, service-only table grants, and authoritative
coverage/facet RPCs. The native total is 103 Thai-local/ThaiJO papers plus 897
Thai-affiliated global OA PMC papers; it is not a national-completeness count.
For later releases, rerun the focused
suites against the frozen candidate and manually
confirm that `inspect_paper_evidence` reports the lawful access state and verified reader anchor without
including full page text and that the page still registers exactly eight WebMCP
site tools.

## Challenge Research Case contract

`harness/run_challenge_research_benchmark.py` evaluates 30 committed questions:
20 answerable cases across engineering, education, and health, plus 10 sparse or
negative controls. It reports top-three source relevance, page-citable evidence,
honest sparse-result behavior, visibility receipts, and request p95; the release
target is p95 at or below five seconds. `harness/lighthouse_research_cases.json`
pins the three cross-discipline cases used to verify that one question can move
through discovery, visibility, evidence review, candidate-gap framing, and the
Next-Study Protocol without changing its evidence boundary.

## Thai–Global Visibility Audit contract

`pipeline/audit_openalex_visibility.py` compares a dated Thai provider cohort
with OpenAlex without sending or mutating records in OpenAlex. Exact DOI checks
use singleton entity lookup because the documented DOI OR-filter was observed
to omit valid Thai DOI records. Runs are resumable, default to dry-run, keep the
full provider cohort as the denominator, and distinguish exact identity,
under-indexed metadata, candidate review, dated no-exact-match, not-audited,
and provider-unavailable states. Only a complete audit may expose a coverage
percentage; partial runs show counts and denominator separately.

Run the deterministic contracts with:

```bash
python3.10 -m unittest pipeline.test_audit_openalex_visibility harness.test_research_graph_migration
(cd web && node --test lib/visibility-audit.test.mjs)
(cd web && npx playwright test tests/e2e/performance.spec.ts)
```

The performance contract requires the Thai feed request to begin independently
of session and history hydration, and prevents automatic translation work before a
person explicitly asks for it. `npm run perf:probe` adds a production-build interaction
gate over the real feed: feed-visible p95 at or below 3,000 ms, immediate composer and
filter response at or below 75 ms, scroll-frame p95 at or below 25 ms, no frame above
80 ms, no long task above 100 ms, and no console errors. The probe records the actual
scroll container, DOM card count, and viewport height so an empty or non-scrolling page
cannot produce a false pass.

`harness/run_native_scale.py` is the bounded 5,000-paper capacity smoke. It
exercises `pmc_oa` by default and derives the total native count from the dated
coverage ledger. Its
target cursor is 4,990; before production contains that many rows it automatically
uses the deepest complete live catalog page and reports
`targetCursorExercised=false`. The independent synthetic web contract exercises
offset 4,990 against a 5,000-native/7,578-catalog state and requires exactly one
catalog RPC. The live smoke loads that bounded catalog page and a rights-verified
reader page in parallel, rejects unbounded response shapes or non-200 responses,
and records median/p95 latency. Defaults remain modest (24 requests per endpoint,
concurrency 6); this is not a 5,000-concurrent-user load claim. Increase traffic
only in a dedicated preview environment with agreed Supabase and Vercel limits.

## Report Contract
Every harness command writes JSON to `harness/reports/` with:
- `status`: `pass | warn | fail`
- `suite`: suite name
- `generatedAt`: ISO timestamp
- `checks`: named checks with status, details, remediation, optional latency and metrics
- `metrics`: suite-level metrics
- `provenance`: report format, Git SHA/dirty state, source fingerprint, latest schema migration, corpus fingerprint, target, and deployment URLs

`harness/reports/latest_<suite>.json` is the stable handoff path for agents and CI.

Quality scoring rejects reports older than `HARNESS_MAX_REPORT_AGE_HOURS` (default `24`), reports from a different source fingerprint/schema, and partial web-only or MCP-only smoke runs. Set `HARNESS_TARGET=preview|production` and `HARNESS_EXPECTED_TARGET` in release gates. CI must provide `CORPUS_FINGERPRINT` because the source corpus is intentionally not committed.

## Live Service Defaults
- `MCP_URL` defaults to `http://localhost:8000`.
- `WEB_URL` defaults to `http://localhost:3000`.
- Unreachable services return `warn` by default so offline local development is not blocked.
- Contract failures from reachable services return `fail`.
- `--strict` and `--fail-on-warn` are aliases. They preserve the report's `warn` status for diagnosis but exit non-zero when any check warns.

## CI And Deploy Readiness
`.github/workflows/ci.yml` runs CivilMCP source checks only. `.github/workflows/preview-release.yml` builds the CivilMCP MCP and web Vercel Preview deployments from the same commit, runs strict cross-service smoke, and stores harness reports as workflow artifacts. Protected projects may use separate `MCP_VERCEL_AUTOMATION_BYPASS_SECRET` and `WEB_VERCEL_AUTOMATION_BYPASS_SECRET` values; the shared secret remains a fallback.

The workflow first applies the additive CivilMCP migrations, including the
native-reader scale migration, to `SUPABASE_PREVIEW_DB_URL` from the protected
GitHub `preview` environment. Production release is manual through
`workflow_dispatch` with `promote=true`, `GA_PROMOTION_ENABLED=true` in the
protected GitHub `production` environment. After approval it migrates
`SUPABASE_DB_URL`, creates staged Production deployments, smokes those exact
URLs, then promotes MCP followed by CivilMCP web. The final gate compares
canonical aliases with the staged deployment IDs. No rebuild occurs between
production-candidate smoke and promotion.

Source checks include:
- Python syntax: `py_compile` over harness, MCP server, pipeline, Supabase, and eval Python files.
- Architecture/product invariants: `python harness/check_invariants.py`.
- Web build: `cd web && npm ci && npm run build` with server-only placeholder env values.
- Candidate smoke: `python harness/run_smoke.py --strict` using `MCP_HARNESS_API_KEY` plus optional per-project Vercel automation bypass secrets.

## Eval Scope
`eval/harness_questions.json` is the fixed smoke suite. It covers CE Project, NCCE, and all-collection queries across simple lookup, compare, summarize, methodology, and citation search intents.

## Memory Continuity
`python3.10 harness/run_memory_eval.py` drives a multi-turn debug conversation:
- capture initial evidence from `/api/chat`
- force compaction on a synthetic longer transcript
- verify a follow-up that references `E1` anchors back to the original source

This keeps memory continuity measurable without adding database schema or user-facing autonomous behavior.

## Backbone Guardrails
Additional backbone checks added for GA hardening:

```bash
python3.10 harness/run_data_quality.py
python3.10 harness/export_feedback_eval.py
python3.10 harness/run_smoke.py --strict
```

The smoke suite now includes negative checks for unauthenticated MCP `/tools/call`, both unauthenticated mounted transports, and invalid/oversized `/api/chat` payloads. It also initializes the stateless public `/v2/mcp` transport and requires the exact 14-tool public contract before a candidate can be promoted. Eval checks citation correctness by ensuring `[E#]` markers map back to returned evidence items, not only that citation markers exist.

Latency SLOs are report-first by default. The demo/readiness defaults are
`HARNESS_MAX_P95_LATENCY_MS=25000`, `HARNESS_MAX_LATENCY_MS=30000`, and
`HARNESS_MAX_CONTEXT_P95_LATENCY_MS=8000`. The context-only threshold keeps a
slow retrieval layer visible even when model generation still fits inside the
end-to-end budget. Set `HARNESS_ENFORCE_SLO=true` to make latency violations
fail eval.

## CityMCP boundary

CityMCP has a separate harness and release surface under `citymcp/`:

```bash
cd citymcp
make local-gate
make release-gate
```

These gates do not contribute to the CivilMCP quality score or Build Week release.
