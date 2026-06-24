# CivilMCP Quality Score

`python3.10 harness/score_quality.py` converts latest harness reports into a product readiness score.

## Gates
- Architecture invariants: docs, env contract, secret boundaries, MCP annotations, agent limits, generated feed artifacts.
- Retrieval/feed health: MCP health, tools list, CE/NCCE chunk search, NCCE feed, chat context debug.
- Answer/citation quality: fixed eval suite must stay within tool/chunk/token budgets and include evidence/citation markers where required.
- Memory continuity: `latest_memory_eval.json` must pass.
- Deploy readiness: CI workflow must exist and the latest smoke report must be a strict production pass.

## Status Meaning
- `pass`: ready for this gate.
- `warn`: usable for local/research preview but needs hardening before GA.
- `fail`: blocks limited rollout for the affected surface.

## Current Release Bar
For limited rollout, `check_invariants.py` must pass, `run_smoke.py` should pass against the target environment, and `run_eval.py --mode smoke` should pass before promotion.
