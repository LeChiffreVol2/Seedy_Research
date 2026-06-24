# CivilMCP Operations

## Local Services
```bash
cd mcp-server && uvicorn server:app --reload --port 8000
cd web && npm run dev -- --port 3000
```

## Production URLs
- Web: `https://civil-mcp-web.vercel.app`
- MCP: `https://civil-mcp-server.vercel.app`
- CityMCP Ops: `https://citymcp.vercel.app`

Run the local release gate before promotion:
```bash
make local-gate
```

Run production smoke by overriding URLs:
```bash
make prod-smoke
```

Strict smoke uses the same checks as local smoke, but `--strict`/`--fail-on-warn` exits non-zero on `warn`. Use it for deploy promotion so unreachable production services, missing auth, or degraded live checks block the promotion path. Keep plain `python3.10 harness/run_smoke.py` for offline local development because unreachable local services remain warnings.

For a full local + production release gate:
```bash
make release-gate
```

## CI Deploy Gate
`.github/workflows/ci.yml` runs:
- Python `py_compile`.
- Harness invariants.
- Web `npm run build`.
- Optional strict production smoke.

Production smoke is opt-in for CI. Configure these GitHub repository values before enabling it:
- Variable `RUN_PRODUCTION_SMOKE=true`.
- Variable `PRODUCTION_MCP_URL=https://civil-mcp-server.vercel.app`.
- Variable `PRODUCTION_WEB_URL=https://civil-mcp-web.vercel.app`.
- Secret `MCP_SERVER_API_KEY` matching the deployed MCP server.

If `RUN_PRODUCTION_SMOKE` is not `true`, CI skips production smoke after build. If it is `true` and any required URL/secret is missing, CI fails before calling production.

## Rollback
- Disable agentic orchestration: `AGENTIC_CONTEXT_ENABLED=false`.
- Return MCP retrieval to v1: `RETRIEVAL_VERSION=v1`.
- Exclude NCCE without DB changes: use `collection=ce_project`.
- Web deployments can be rolled back in Vercel if a UI/API regression appears.

## Incident Checks
- MCP `/health` for service status.
- MCP `/metrics` for request/tool error counters.
- Web `/api/research-feed?filter=ncce` for Supabase feed health.
- Web `/api/chat` debug mode for context/evidence traces.
- CityMCP `/api/ops/sources/sla` for source SLA, freshness, and ingest health.
- CityMCP `/api/ops/layers/registry` and `/api/ops/tiles/{z}/{x}/{y}.mvt` for spatial read-model health.
- CityMCP `/api/ops/commands/log` and `/api/ops/actions/log` for command/action audit trails.

## Secrets
Server-only keys must remain in Vercel/server env only: `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_KEY`, `MCP_SERVER_API_KEY`.

## Backbone Hardening Notes
- Production MCP transport must require `MCP_SERVER_API_KEY` for every mounted MCP path except public status/list endpoints.
- `/api/chat` is bounded by body/message caps and per-session/IP rate limits before any paid model or MCP call.
- Chat traces are stored in `civil_chat_traces` when the operational schema is applied. Trace persistence is fail-soft so chat does not break during migration.
- User feedback is stored in `civil_chat_feedback` and can be exported with `python3.10 harness/export_feedback_eval.py` to seed future eval cases.
- The ops dashboard fails closed in production unless `OPS_DASHBOARD_BASIC_AUTH_USER` and `OPS_DASHBOARD_BASIC_AUTH_PASSWORD` are set. Use `OPS_DASHBOARD_AUTH_DISABLED=true` only for local development.
- CityMCP action authority is server-derived. Clients must not provide `actor`; action records require persisted CivilMCP `researchRunId`, `proposalId`, direct/indirect `mcp:*` evidence, and a non-stale real object.
- CityMCP command execution is audited in `smart_city_commands`/`smart_city_command_events`; action lifecycle changes are audited in `smart_city_action_events`.
