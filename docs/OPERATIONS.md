# Seedy Research Operations

## Local Services

For credential-free verification, use [the fixture gate](HARNESS.md) first.
A live development environment additionally needs a Supabase development
project, lawful indexed data, and provider credentials; cloning the repository
does not reproduce the production corpus.

1. Copy `.env.example` to `.env` and configure server-only values. Install
   `mcp-server/requirements.txt` in a Python 3.10 virtual environment and run
   `npm ci --prefix web`.
2. Review [the base schema](../supabase/schema.sql) and ordered
   [migration ledger](../supabase/migrations/) to prepare a separate
   development database. Review every migration before applying it; do not
   run production migration commands as a quick-start shortcut.
3. Load the root env explicitly in each local terminal before starting the
   services. Next.js does not automatically read the parent `.env`:

```bash
set -a
. ./.env
set +a
cd mcp-server && uvicorn server:app --reload --port 8000
```

In a second terminal, starting from the repository root:

```bash
set -a
. ./.env
set +a
cd web && npm run dev -- --port 3000
```

Configure Supabase Auth redirect origins for local and deployed callback URLs.
Only anon/publishable project identifiers may use `NEXT_PUBLIC_*`; provider,
service-role, signing, and MCP keys must remain server-only. Keep dormant Stripe
credentials absent while Open Access is enabled. The full OpenRAG runtime is
optional; Notebook Light Mode does not require a separate sidecar.

## Production URLs
- Web: `https://seedresearch.vercel.app`
- MCP: `https://civil-mcp-server.vercel.app`

Run the local release gate before promotion:
```bash
make local-gate
```

Run production smoke by overriding URLs:
```bash
make prod-smoke
```

Run the bounded 5,000-paper request-path smoke after deploying web. It uses the
deepest complete live page until production actually reaches the target:

```bash
make native-scale
```

Strict smoke uses the same checks as local smoke, but `--strict`/`--fail-on-warn` exits non-zero on `warn`. Use it for deploy promotion so unreachable production services, missing auth, or degraded live checks block the promotion path. Keep plain `python3.10 harness/run_smoke.py` for offline local development because unreachable local services remain warnings.

For a full local + production release gate:
```bash
make release-gate
```

## CI Deploy Gate
Use `.github/workflows/preview-release.yml` for releases. Same-repository pull requests get Preview deployments and smoke tests only when `PREVIEW_RELEASE_ENABLED=true`; otherwise only source/fixture gates run. Keep `SUPABASE_PREVIEW_DB_URL` in the protected GitHub `preview` environment. A manual, protected release then creates staged Production deployments with `--prod --skip-domain`, tests those exact URLs, and promotes them without rebuilding. Set `GA_PROMOTION_ENABLED=true` in the protected `production` environment; the workflow validates it only after environment approval.

Required GitHub secrets:
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`
- `VERCEL_WEB_PROJECT_ID`, `VERCEL_MCP_PROJECT_ID`
- `SUPABASE_PREVIEW_DB_URL`, `SUPABASE_DB_URL`
- `MCP_HARNESS_API_KEY`; for protected candidates use `MCP_VERCEL_AUTOMATION_BYPASS_SECRET` and `WEB_VERCEL_AUTOMATION_BYPASS_SECRET` (the shared `VERCEL_AUTOMATION_BYPASS_SECRET` remains a fallback)

Required variables:
- `PREVIEW_RELEASE_ENABLED=true` to enable preview migration/deployment jobs
- `CORPUS_FINGERPRINT`
- `PRODUCTION_MCP_URL`, `PRODUCTION_WEB_URL`
- `GA_PROMOTION_ENABLED=true` only after GA data-quality gates pass

`SUPABASE_PREVIEW_DB_URL` must target the same Supabase project configured in the Vercel Preview environments. Keep it separate from production unless an explicitly reviewed additive migration is intentionally shared.

## Thai–Global Visibility Audit

The visibility audit is a comparison layer inside Seedy Research. It does not
submit, repair, or synchronize records with OpenAlex. Apply migration
`20260902123406_civil_global_visibility_audit.sql` followed by
`20260902173000_civil_catalog_relevance_first.sql`, then preview a bounded run:

```bash
python3.10 pipeline/audit_openalex_visibility.py --provider tci_thaijo --strategy identifiers --max-records 25
```

Use `--apply` only after the dry-run output is reviewed. Production scheduling
is defined in `.github/workflows/visibility-audit.yml`; set `OPENALEX_API_KEY`
for higher quotas and full title-candidate auditing. Identifier-only runs may
use the explicitly bounded anonymous mode. Never report a partial-run ratio as
provider or national coverage.

The 2 September 2026 production v2 run is partial: 836 exact-DOI records were
attempted from a 2,681-record active ThaiJO cohort, yielding 27 exact identities,
805 under-indexed identities, four dated no-exact-match receipts, and zero
provider-unavailable receipts. Preserve the earlier v1 run as incident history;
its DOI OR-filter result is known to contain false negatives and must not be
used in product claims.

The relevance-first follow-up ensures an exact Thai-local metadata title ranks
ahead of loosely related native-reader records while native access remains the
tie-breaker for equally relevant results.

## Research Case and Thai-published facets

Apply `20260902221100_research_cases_and_thai_published_facets.sql` after the
visibility/relevance migrations and before deploying the eight-tool web client.
The migration is additive: it adds independent publication/context/language/
affiliation facets, service-only Research Case and claim-review tables, the
internal visibility-correction queue, and the bounded catalog search v3 RPC.
It does not submit or mutate records in OpenAlex.

After migration and staged deployment, verify:

```bash
python3.10 harness/run_challenge_research_benchmark.py --base-url "$STAGED_WEB_URL"
```

The benchmark must retain sparse results, never substitute PMC records into the
Thai-published cohort, and keep request p95 at or below five seconds. Treat a
missing `civil_research_cases` table or v3 RPC as an incomplete rollout, not an
application-level success.

## Research Notebook Light Mode

Apply `20260903164320_notebook_light_mode.sql` after the Research Case migration
and before deploying the separate Notebook surface. The migration adds compact
owner-scoped Notebook, thread, message, note, artifact, and Workspace Evidence
Pack tables plus an optional Workspace-to-Case link. It does not copy canonical
paper text, chunks, or embeddings.

Keep `OPENRAG_ADAPTER_ENABLED=false`. Light Mode uses the configured
`OPENAI_API_KEY` or `DEEPSEEK_API_KEY`, the existing Seedy exact-page corpus,
and server-enforced budgets. `NOTEBOOK_MAX_CONTEXT_PACKETS` defaults to 12,
`NOTEBOOK_GENERATION_TIMEOUT_MS` to 35 seconds, and
`MAX_ACTIVE_NOTEBOOK_ASKS` to 6 for the new route. Do not raise these limits on
Vercel Hobby without a measured concurrency and latency test.

## Rollback
- Return to the legacy section-then-chunk recipe: `FAST_RETRIEVAL_ENABLED=false`.
- Restore model-based routing for otherwise-unclassified prompts: `LLM_ROUTER_ENABLED=true`.
- Disable agentic orchestration: `AGENTIC_CONTEXT_ENABLED=false`.
- Return MCP retrieval to v1: `RETRIEVAL_VERSION=v1`.
- Keep the optional OpenRAG sidecar disabled: `OPENRAG_ADAPTER_ENABLED=false`.
- Exclude NCCE without DB changes: use `collection=ce_project`.
- Web deployments can be rolled back in Vercel if a UI/API regression appears.

## Incident Checks
- MCP `/health` for service status.
- MCP `/health/ready` for Supabase, schema, and distributed-quota readiness.
- MCP `/metrics` for request/tool error counters.
- Web `/api/research-feed?filter=ncce` for Supabase feed health.
- Web `/api/research-feed?filter=thai` for the primary Thai-first feed; verify it
  starts independently of session and history hydration.
- Web `/api/visibility` for the latest dated audit summary; missing RPCs must
  degrade to `not_audited`, and provider failures to `audit_unavailable`, never
  to a no-exact-match claim.
- Web `/api/research-cases` for persistent case state and claim decisions; a
  schema-cache missing-table response means the latest Supabase migration has
  not reached that environment.
- Web `/api/visibility-corrections` for the internal steward queue. Suggestions
  are review records inside Seedy Research and must never be described as an
  OpenAlex update.
- Web `/api/chat` debug mode for context/evidence traces.
- MCP `/metrics` for `embedding_circuit`, `retrieval_fallbacks_total`,
  `embedding_unavailable_total`, tool error rate, and error codes.
- Vercel logs for structured events `civilmcp_retrieval_degraded`,
  `civilmcp_retrieval_unavailable`, `civilmcp_zero_evidence`, and
  `civilmcp_answer_fallback`.
- Vercel logs for `civilmcp_research_path_complete` and
  `civilmcp_checkpoint_assessment_degraded`; `research_path_busy` and
  `checkpoint_busy` are deliberate backpressure responses with `Retry-After`.

The deterministic router is the default. Set `LLM_ROUTER_ENABLED=true` only
when model classification is worth the extra request; those calls remain bounded by
`ROUTER_TIMEOUT_MS` (6 seconds by default). MCP web calls are bounded by
`MCP_TOOL_TIMEOUT_MS` (18 seconds by default). Answer
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

Research Path limits active work per web instance with
`MAX_ACTIVE_PATH_BUILDS` (8) and `MAX_ACTIVE_CHECKPOINTS` (6), in addition to
the distributed per-user/IP quota. A busy response is retryable and should not
be converted into an immediate client retry loop. Sparse but relevant coverage
is returned with `coverage.status=limited`; zero relevant evidence remains a
recoverable `422 insufficient_path_evidence` response.

Legacy Workspace-bound Notebook asks use `research_notebook_ask`; the separate
Notebook Light Mode route uses `research_notebook_light` and
`MAX_ACTIVE_NOTEBOOK_ASKS` per-instance cap (6 by default). A `429`
or `503` is deliberate backpressure and must not trigger an immediate retry
loop. Confirm that the authenticated owner owns the Research Case, Notebook,
thread, and every selected Case Source before investigating provider output.
Private-source responses must be `Cache-Control: no-store`, `shareable: false`,
and excluded from Passport promotion. Keep `OPENRAG_ADAPTER_ENABLED=false`;
no OpenSearch/Langflow/Docling service is required by this release.

If OpenAI returns `429 credit_balance_exhausted`, investigate billing/quota
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

## Dormant Founder Pro billing

Open Access is the production default. Keep `CIVILMCP_OPEN_ACCESS=true` and `NEXT_PUBLIC_CIVILMCP_OPEN_ACCESS=true`; checkout returns a closed response and answer/MCP credit reservation is a no-op. Keep `NEXT_PUBLIC_CIVILMCP_REQUIRE_AUTH=true` for the demo and verify every per-feature `enabled`/`requiresAuth` flag from `.env.example` before release. Open Access removes payment gates, while Supabase authentication remains required for product features. The steps below apply only if product policy explicitly re-enables billing later.

1. Apply the billing migration chain through `20260725205900_civil_founder_pro_500_credits.sql`, then apply `20260813120000_civil_stripe_event_idempotency.sql`, `20260814090000_civil_luna_free_credit_ladder.sql`, and `20260814100000_civil_terra_sol_credit_correction.sql` before deploying Stripe-enabled web code. The additive migrations preserve existing accounts and credit history.
2. In Supabase Auth, enable Google and allow `https://seedresearch.vercel.app/auth/callback` plus the local callback. Keep the former CivilMCP alias during the migration window.
3. Create a recurring THB 299/month Stripe Price for the 500-credit monthly Pro top-up and set `STRIPE_FOUNDER_PRO_PRICE_ID`.
4. Point a Stripe webhook at `/api/webhooks/stripe` for `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`; set its signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Set `NEXT_PUBLIC_APP_URL=https://seedresearch.vercel.app` and the three server-only Stripe variables in Vercel.
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
`20260815120000_civil_personal_mcp_access.sql`,
`20260815130000_civil_mcp_v2_library.sql`, and
`20260815140000_civil_mcp_oauth_audience_hook.sql`, and
`20260815150000_civil_mcp_research_units.sql` before deploying the matching
web/MCP code. Verify the tables and folder RPCs through the release readiness probe.
Personal MCP tokens are shown once; revoke a suspected token from Account and
confirm its hash row has `revoked_at` before rotating client configuration.

Apply `20260815150000_civil_mcp_research_units.sql` before deploying metered
public MCP v2 code. `/health/ready` and the release database probe must confirm
both usage tables plus `civil_get_mcp_usage`, `civil_consume_mcp_units`, and
`civil_refund_mcp_units`. PostgreSQL is the tool-cost authority. Never adjust AI
answer-credit balances to correct MCP usage; the two ledgers are independent.

Apply `20260829072758_default_openai_luna.sql`,
`20260829110000_civil_learning_checkpoint_events.sql`, and
`20260831120000_civil_research_graph_assets.sql` before deploying the matching
OpenAI-first Research Path and native-reader release. The checkpoint migration
adds `checkpoint_answered`, `checkpoint_mastered`, and `path_adapted` while
preserving the existing event allow-list. Then run
`.venv310/bin/python pipeline/ingest_reader_pack.py --apply` once per target
database for the deterministic fixture. For the reviewed 100-paper cohort, run
`pipeline/build_native_reader_cohort.py` against
`pipeline/cohorts/bscm_tci1_100.json`, validate its ignored output pack, and
apply that pack explicitly. Apply `20260902010000_civil_authoritative_research_coverage.sql`,
then apply `20260902020000_civil_native_reader_scale_1000.sql`. Build the
Thai-affiliated PMC pack with `pipeline/build_pmc_thai_reader_pack.py`, validate
it with `pipeline/ingest_reader_pack.py`, and promote it in stable 100–250-paper
windows. Verify 1,000 native assets and canonical works, 14,485 checksum-valid
pages, 103 `tci_thaijo` plus 897 `pmc_oa` assets, zero asset/page-count
or page-hash mismatches, RLS on all graph tables, and no
`anon`/`authenticated` table grants.

For a larger reviewed pack, always inspect the dry-run request budget before
writing:

```bash
.venv310/bin/python pipeline/ingest_reader_pack.py \
  --pack-dir /path/to/rights-reviewed-pack \
  --batch-size 100 \
  --page-batch-size 100
```

The same command with `--apply` performs bounded bulk reads/upserts. Keep both
batch sizes at 200 or below. After apply, compare `civil_work_assets.page_count`
to `civil_fulltext_pages`, recompute page hashes, confirm graph-table RLS/grants,
and run `make native-scale`. Scaling page storage does not authorize any new
asset and does not automatically promote its text into the vector index.

For public MCP OAuth, set the Supabase OAuth authorization path to
`/oauth/consent`, enable dynamic client registration, and select
`public.civil_mcp_access_token_hook` as the Custom Access Token hook. Then set
`MCP_PUBLIC_URL` and `MCP_OAUTH_AUDIENCE` to the exact production
`https://civil-mcp-server.vercel.app/v2/mcp` resource and enable
`MCP_OAUTH_ENABLED`. Verify protected-resource metadata, consent, token use, and
grant revocation from Account before rollout. Roll back OAuth without disabling
personal keys by setting `MCP_OAUTH_ENABLED=false`; revoke a compromised client
or grant in Supabase and from the user's Account panel.

Private PDF extraction is capped before persistence. Investigate unusual
`private_library_import` quota volume, and treat any cross-owner read as a P0
privacy incident. Living Reviews run only on an explicit create/check request;
there is no background crawler or email delivery to monitor in this release.

The historical dependency audit reported no high or critical finding; this is
not a current advisory check. Run `npm audit --omit=dev` in `web/` for each
release and record the date, revision, and result before relying on that status.
That historical audit recorded five low AI SDK advisories whose upgrade was
deferred pending a breaking major migration; the affected file-upload whitelist is not used for the private PDF
route, which parses and validates uploads independently with `pdfjs-dist`.

Research Workspace batch runs are open access and credit reservation is a no-op. Each request remains capped at six papers by six columns and uses the separate `research_workspace_run` abuse limit. Check `/api/research-workspaces` for `429` or `503` responses when diagnosing rate or provider failures. Legacy credit restoration fields remain for backward compatibility when Open Access is deliberately disabled.

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

CityMCP application code and workflows are no longer in the active tree.
Use [the published archive tag and recovery instructions](LEGACY_COMPATIBILITY.md).
Applied database history and existing MCP contracts remain intact.
