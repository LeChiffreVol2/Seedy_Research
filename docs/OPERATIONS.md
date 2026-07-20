# CivilMCP Operations

## Local Services
```bash
cd mcp-server && uvicorn server:app --reload --port 8000
cd web && npm run dev -- --port 3000
```

## Production URLs
- Web: `https://civil-mcp-web.vercel.app`
- MCP: `https://civil-mcp-server.vercel.app`

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
Use `.github/workflows/preview-release.yml` for releases. Pull requests get Preview-environment deployments and smoke tests. Keep `SUPABASE_PREVIEW_DB_URL` in the protected GitHub `preview` environment. A manual, protected release then creates staged Production deployments with `--prod --skip-domain`, tests those exact URLs, and promotes them without rebuilding. Set `GA_PROMOTION_ENABLED=true` in the protected `production` environment; the workflow validates it only after environment approval.

Required GitHub secrets:
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`
- `VERCEL_WEB_PROJECT_ID`, `VERCEL_MCP_PROJECT_ID`
- `SUPABASE_PREVIEW_DB_URL`, `SUPABASE_DB_URL`
- `MCP_HARNESS_API_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET`

Required variables:
- `CORPUS_FINGERPRINT`
- `PRODUCTION_MCP_URL`, `PRODUCTION_WEB_URL`
- `GA_PROMOTION_ENABLED=true` only after GA data-quality gates pass

`SUPABASE_PREVIEW_DB_URL` must target the same Supabase project configured in the Vercel Preview environments. Keep it separate from production unless an explicitly reviewed additive migration is intentionally shared.

## Rollback
- Disable agentic orchestration: `AGENTIC_CONTEXT_ENABLED=false`.
- Return MCP retrieval to v1: `RETRIEVAL_VERSION=v1`.
- Exclude NCCE without DB changes: use `collection=ce_project`.
- Web deployments can be rolled back in Vercel if a UI/API regression appears.

## Incident Checks
- MCP `/health` for service status.
- MCP `/health/ready` for Supabase, schema, and distributed-quota readiness.
- MCP `/metrics` for request/tool error counters.
- Web `/api/research-feed?filter=ncce` for Supabase feed health.
- Web `/api/chat` debug mode for context/evidence traces.

## Secrets
Server-only keys must remain in Vercel/server env only: `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_KEY`, `MCP_SERVER_API_KEY`, `MCP_CLIENT_KEYS_JSON`, `GUEST_SESSION_HMAC_KEY`, and `CRON_SECRET`.

## Backbone Hardening Notes
- Production MCP transport accepts named consumer keys from `MCP_CLIENT_KEYS_JSON`; keep `MCP_SERVER_API_KEY` for one compatibility release only.
- `/api/chat` uses an HMAC-signed guest identity and atomic Supabase minute/hour quotas before any paid model or MCP call.
- Unsigned legacy `civilmcp_user` cookies are intentionally reset. Authenticated Supabase identity always wins and never falls back to a legacy owner cookie.
- Expired/invalid Supabase sessions return `401` and clear stale auth cookies; transient auth outages return `503` without silently switching ownership.
- Production traces default to metadata-only. Debug content and explicit negative-feedback snapshots expire after 30 days through `/api/internal/maintenance`.
- Share links expire after 30 days and can be revoked with `DELETE /api/share?sessionId=<uuid>`.
- User feedback is stored in `civil_chat_feedback` and can be exported with `python3.10 harness/export_feedback_eval.py` to seed future eval cases.

CityMCP operational procedures are maintained in `citymcp/README.md` and its separate release workflow.
