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
python3.10 harness/check_ops_invariants.py --strict
python3.10 harness/run_ops_api_contracts.py
python3.10 harness/run_ops_browser_e2e.py
```

Use the root `Makefile` for normal release work. The direct harness commands remain useful when debugging a specific failing suite.

## Report Contract
Every harness command writes JSON to `harness/reports/` with:
- `status`: `pass | warn | fail`
- `suite`: suite name
- `generatedAt`: ISO timestamp
- `checks`: named checks with status, details, remediation, optional latency and metrics
- `metrics`: suite-level metrics

`harness/reports/latest_<suite>.json` is the stable handoff path for agents and CI.

## Live Service Defaults
- `MCP_URL` defaults to `http://localhost:8000`.
- `WEB_URL` defaults to `http://localhost:3000`.
- Unreachable services return `warn` by default so offline local development is not blocked.
- Contract failures from reachable services return `fail`.
- `--strict` and `--fail-on-warn` are aliases. They preserve the report's `warn` status for diagnosis but exit non-zero when any check warns.

## CI And Deploy Readiness
The CI workflow runs syntax and deploy-readiness gates without requiring live local services:
- Python syntax: `py_compile` over harness, MCP server, pipeline, Supabase, and eval Python files.
- Architecture/product invariants: `python harness/check_invariants.py`.
- Web build: `cd web && npm ci && npm run build` with server-only placeholder env values.
- Optional production smoke: `python harness/run_smoke.py --strict`, enabled only when repository variable `RUN_PRODUCTION_SMOKE=true` and `PRODUCTION_MCP_URL`, `PRODUCTION_WEB_URL`, and secret `MCP_SERVER_API_KEY` are configured.

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

## CityMCP Ops Gates
`ops-dashboard/` has a separate harness surface so the chatbot `web/` release path remains isolated:

```bash
python3.10 harness/check_ops_invariants.py --strict
OPS_DASHBOARD_URL=https://citymcp.vercel.app python3.10 harness/run_ops_api_contracts.py
OPS_E2E_BASE_URL=https://citymcp.vercel.app python3.10 harness/run_ops_browser_e2e.py
```

The ops gates verify real-data-only policy, PostGIS read-model contracts, MVT tile availability, source SLA, server-derived RBAC, persisted command audit, action lifecycle, and non-destructive browser interactions. Browser E2E uses an isolated Playwright profile; if Playwright is not installed it reports `warn` unless `--strict` is used.
