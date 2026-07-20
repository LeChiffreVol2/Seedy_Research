# CivilMCP Harness

The harness is the engineering feedback loop for agentic development. It verifies architecture invariants, live retrieval health, answer/evidence behavior, and product quality score without changing user-facing behavior.

## Commands
```bash
make local-gate
make prod-smoke
make release-gate

python3.10 harness/check_invariants.py
python3.10 harness/run_smoke.py
python3.10 harness/run_smoke.py --strict
python3.10 harness/run_memory_eval.py
python3.10 harness/run_eval.py --mode smoke
python3.10 harness/score_quality.py
cd web && npm run harness:web-smoke
```

Use the root `Makefile` for normal release work. The direct harness commands remain useful when debugging a specific failing suite.

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
`.github/workflows/ci.yml` runs CivilMCP source checks only. `.github/workflows/preview-release.yml` builds the CivilMCP MCP and web Vercel Preview deployments from the same commit, runs strict cross-service smoke, and stores harness reports as workflow artifacts.

The workflow first applies the additive CivilMCP migrations to `SUPABASE_PREVIEW_DB_URL` from the protected GitHub `preview` environment. Production release is manual through `workflow_dispatch` with `promote=true`, `GA_PROMOTION_ENABLED=true` in the protected GitHub `production` environment. After approval it migrates `SUPABASE_DB_URL`, creates staged Production deployments, smokes those exact URLs, then promotes MCP followed by CivilMCP web. The final gate compares canonical aliases with the staged deployment IDs. No rebuild occurs between production-candidate smoke and promotion.

Source checks include:
- Python syntax: `py_compile` over harness, MCP server, pipeline, Supabase, and eval Python files.
- Architecture/product invariants: `python harness/check_invariants.py`.
- Web build: `cd web && npm ci && npm run build` with server-only placeholder env values.
- Candidate smoke: `python harness/run_smoke.py --strict` using `MCP_HARNESS_API_KEY` and optional `VERCEL_AUTOMATION_BYPASS_SECRET`.

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

The smoke suite now includes negative checks for unauthenticated MCP `/tools/call`, unauthenticated mounted MCP transport, and invalid/oversized `/api/chat` payloads. Eval now checks citation correctness by ensuring `[E#]` markers map back to returned evidence items, not only that citation markers exist.

Latency SLOs are report-first by default. Set `HARNESS_ENFORCE_SLO=true` to make latency violations fail eval.

## CityMCP boundary

CityMCP has a separate harness and release surface under `citymcp/`:

```bash
cd citymcp
make local-gate
make release-gate
```

These gates do not contribute to the CivilMCP quality score or Build Week release.
