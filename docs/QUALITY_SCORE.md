# CivilMCP Quality Score

`python3.10 harness/score_quality.py` converts latest harness reports into a product readiness score.

## Gates
- Architecture invariants: docs, env contract, secret boundaries, MCP annotations, agent limits, generated feed artifacts.
- Retrieval/feed health: MCP health, tools list, CE/NCCE chunk search, NCCE feed, chat context debug.
- Answer/citation quality: fixed eval suite must stay within tool/chunk/token budgets and include evidence/citation markers where required.
- Memory continuity: `latest_memory_eval.json` must pass.
- Report provenance: all required reports must be no older than 24 hours and match Git SHA/source fingerprint, schema migration, corpus fingerprint, target, and deployment URLs.
- Deploy readiness: preview/promote workflow must exist and latest smoke must be a full strict preview or production run.
- Thai–global visibility: migration and runner contracts must preserve dated
  audit state, partial denominators, exact-identity matching, and fail-closed
  provider-unavailable behavior. A partial audit cannot produce a national
  coverage percentage.
- Interaction performance: the initial Thai feed must not wait for session or
  history hydration, and translation must not run until the person explicitly requests
  it. These browser regressions are release-blocking because they add both
  latency and unnecessary provider work to the primary judge path.
- Notebook continuity: Workspace and Notebook must remain distinct surfaces;
  only verified exact-page Workspace cells may enter a versioned Evidence Pack;
  Chat and Studio must use admitted Case Sources, persist bounded owner-scoped
  state, mark source-dependent artifacts stale, and keep OpenRAG visibly
  inactive while Seedy Light Retrieval is the runtime.
- CityMCP reports are excluded; CityMCP has its own readiness score under `citymcp/harness/`.

## Status Meaning
- `pass`: ready for this gate.
- `warn`: usable for local/research preview but needs hardening before GA.
- `fail`: blocks limited rollout for the affected surface.

## Current Release Bar
For the Public Research Preview, score must be at least `90`, no gate may fail, citation correctness must be `100%`, and data quality must meet unknown discipline `0`, weak title `0`, and missing embeddings `0`. GA candidacy keeps the stricter score target of `95`.
