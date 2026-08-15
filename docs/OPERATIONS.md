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
- `MCP_HARNESS_API_KEY`; for protected candidates use `MCP_VERCEL_AUTOMATION_BYPASS_SECRET` and `WEB_VERCEL_AUTOMATION_BYPASS_SECRET` (the shared `VERCEL_AUTOMATION_BYPASS_SECRET` remains a fallback)

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
- MCP `/metrics` for `embedding_circuit`, `retrieval_fallbacks_total`,
  `embedding_unavailable_total`, tool error rate, and error codes.
- Vercel logs for structured events `civilmcp_retrieval_degraded`,
  `civilmcp_retrieval_unavailable`, `civilmcp_zero_evidence`, and
  `civilmcp_answer_fallback`.

Router calls are bounded by `ROUTER_TIMEOUT_MS` (6 seconds by default). Answer
generation is bounded by `ANSWER_TIMEOUT_MS` (35 seconds by default), below the
60-second function limit. Debug/evaluation requests publish a deterministic,
citation-allowlisted brief and request a refund of the reserved product credit
when the answer provider times out. A response may say credits were restored
only after `civil_refund_answer_credits` confirms the refund ledger row. A
`creditRecovery=pending` response includes a trace for support reconciliation.

Treat `retrieval_unavailable` or sustained MCP 5xx as page-worthy for the
preview. Treat a lexical fallback as degraded but usable: verify page links,
restore provider capacity, then confirm `retrievalMode=semantic` in strict
smoke. The embedding circuit retries after `EMBEDDING_CIRCUIT_SECONDS` (300 by
default), so adding provider credits does not require a redeploy (recovery is
automatic within five minutes on a warm instance).

The current OpenAI `429 credit_balance_exhausted` response is billing/quota
exhaustion, not ordinary request pacing. Restore the API balance in
`https://platform.openai.com/settings/organization/billing/`; inspect spend
limits at `https://platform.openai.com/settings/organization/limits`.

## Preview support and activation review

Review unresolved requests daily during rollout:

```sql
select request_id, category, email, subject, source_url, created_at
from public.civil_support_requests
where status in ('new', 'reviewing')
order by created_at;
```

Review the activation funnel without storing raw search text:

```sql
select event_name, count(*) as events, count(distinct user_id) as users
from public.civil_product_events
where created_at >= now() - interval '7 days'
group by event_name
order by event_name;
```

Start with alerts or manual stop conditions for any fabricated citation,
source-rights incident, account-deletion failure, support write failure,
semantic outage without fallback, or evidence-open rate below the launch goal.

Exclude automated traffic when reviewing activation:

```sql
select event_name, count(*) as events, count(distinct user_id) as users
from public.civil_product_events
where created_at >= now() - interval '7 days'
  and properties->>'trafficClass' = 'human'
group by event_name
order by event_name;
```

## Secrets
Server-only keys must remain in Vercel/server env only: `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_KEY`, `MCP_SERVER_API_KEY`, `MCP_CLIENT_KEYS_JSON`, `MCP_WEB_API_KEY_SHA256`, `GUEST_SESSION_HMAC_KEY`, `CRON_SECRET`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. `MCP_WEB_API_KEY_SHA256` is additive: it authorizes only the CivilMCP web client without replacing legacy or CityMCP credentials.

Supabase Auth additionally requires `SUPABASE_ANON_KEY` (or
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) to contain a valid anon/publishable key. Auth
fails closed when that key is absent or malformed and never falls back to
`SUPABASE_SERVICE_KEY`.

## Founder Pro billing

1. Apply the billing migration chain through `20260725205900_civil_founder_pro_500_credits.sql`, then apply `20260813120000_civil_stripe_event_idempotency.sql`, `20260814090000_civil_luna_free_credit_ladder.sql`, and `20260814100000_civil_terra_sol_credit_correction.sql` before deploying Stripe-enabled web code. The additive migrations preserve existing accounts and credit history.
2. In Supabase Auth, enable Google and allow `https://civil-mcp-web.vercel.app/auth/callback` plus the local callback.
3. Create a recurring THB 299/month Stripe Price for the 500-credit monthly Pro top-up and set `STRIPE_FOUNDER_PRO_PRICE_ID`.
4. Point a Stripe webhook at `/api/webhooks/stripe` for `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`; set its signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Set `NEXT_PUBLIC_APP_URL=https://civil-mcp-web.vercel.app` and the three server-only Stripe variables in Vercel.
6. Use a Vercel Pro (or higher) project before accepting payment; Hobby is for non-commercial use.

Apply `20260812160000_civil_lexical_retrieval_fallback.sql`,
`20260812170000_civil_public_support.sql`, and
`20260812180000_civil_product_events.sql` and
`20260812190000_bound_civil_lexical_fallback.sql` and
`20260812200000_remove_lexical_candidate_sort.sql` before deploying the matching web/MCP
code. The release workflow applies the complete ordered set before staging services.

Apply `20260813110000_civil_transactional_account_deletion.sql` before enabling
account deletion. The API calls its service-role-only RPC first; PostgreSQL
removes all CivilMCP-owned account rows in one transaction, then the API removes
the Supabase Auth user. If either operation fails, treat it as a launch-blocking
privacy incident and follow the support escalation path.

Apply `20260815100000_civil_activation_events.sql`,
`20260815110000_civil_private_library_and_watches.sql`, and
`20260815120000_civil_personal_mcp_access.sql` before deploying the matching
web/MCP code. Verify all three tables exist through the release readiness probe.
Personal MCP tokens are shown once; revoke a suspected token from Account and
confirm its hash row has `revoked_at` before rotating client configuration.

Private PDF extraction is capped before persistence. Investigate unusual
`private_library_import` quota volume, and treat any cross-owner read as a P0
privacy incident. Living Reviews run only on an explicit create/check request;
there is no background crawler or email delivery to monitor in this release.

The production dependency audit currently has no high or critical finding.
Five low AI SDK advisories require a breaking SDK major migration and are
deferred; the affected file-upload whitelist is not used for the private PDF
route, which parses and validates uploads independently with `pdfjs-dist`.

Research Workspace batch runs share the Founder Pro entitlement and credit ledger. A run reserves the selected model weight once per selected paper, caps each request at six papers by six columns, and uses the separate `research_workspace_run` quota. Check `/api/research-workspaces` for `402`, `429`, or `503` responses when diagnosing access, quota, or provider failures. Failed runs attempt to restore every reservation; `creditRecovery=restored` is ledger-confirmed, while `creditRecovery=pending` requires reconciliation using the returned trace.

Stripe webhook delivery is idempotent by `event.id`. For events with the same second-level `event.created`, the database uses subscription lifecycle rank and event ID as a deterministic tie-breaker under an account row lock. Inspect `civil_stripe_event_ledger` for `applied` or `stale` outcomes; repeated event IDs return `duplicate` without changing entitlement. Keep all Stripe variables absent on Vercel Hobby. Do not enable Checkout until the project is on a commercial hosting plan and this migration is verified in the target database.

Rollback billing without affecting the free preview by removing the Stripe variables. Existing subscriptions must still be canceled or refunded through Stripe; removing variables only disables new checkout and portal sessions. Never edit credit balances manually—use the signed subscription webhook and credit ledger.

## Backbone Hardening Notes
- Production MCP transport accepts named consumer keys from `MCP_CLIENT_KEYS_JSON`; keep `MCP_SERVER_API_KEY` for one compatibility release only.
- `/api/chat` uses an HMAC-signed guest identity and atomic Supabase minute/hour quotas before any paid model or MCP call.
- Unsigned legacy `civilmcp_user` cookies are intentionally reset. Authenticated Supabase identity always wins and never falls back to a legacy owner cookie.
- Expired/invalid Supabase sessions return `401` and clear stale auth cookies; transient auth outages return `503` without silently switching ownership.
- Production traces default to metadata-only. Debug content and explicit negative-feedback snapshots expire after 30 days through `/api/internal/maintenance`.
- Share links expire after 30 days and can be revoked with `DELETE /api/share?sessionId=<uuid>`.
- User feedback is stored in `civil_chat_feedback` and can be exported with `python3.10 harness/export_feedback_eval.py` to seed future eval cases.

CityMCP operational procedures are maintained in `citymcp/README.md` and its separate release workflow.
