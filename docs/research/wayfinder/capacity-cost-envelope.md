# Capacity and cost envelope for the WebMCP Challenge

**Research date:** 2026-09-01

**Decision ticket:** [#4 — Establish the THB 2,000–5,000 capacity and cost envelope](https://github.com/LeChiffreVol2/Seedy_Research/issues/4)

**Scope:** Vercel, Supabase, observability, caching, and traffic. Model and external API usage is excluded.

## Recommendation

Reserve the Challenge production candidate on **one Vercel Pro team, one Supabase Pro production project on Medium compute, and Vercel Observability Plus**. The fixed list price is **USD 105/month**:

- Vercel Pro: USD 20/month, including one deploying seat and USD 20/month of managed-infrastructure credit.
- Supabase Pro plus one Medium project: USD 25 + USD 60 compute - USD 10 compute credit = USD 75/month.
- Vercel Observability Plus: USD 10/month plus metered events.

At the conservative planning rate of **THB 38/USD**, fixed cost is **THB 3,990/month**. Set Vercel Spend Management to **USD 14 of metered spend after included allocations and the Pro credit**, with alerts at 50%, 75%, and 100% and production pause at 100%. Keep the Supabase Spend Cap on. Fixed cost plus the Vercel cap is USD 119, or THB 4,522; a further 10% planning contingency for exchange-rate spread, tax, and rounding produces **THB 4,974**, just inside the THB 5,000 ceiling.

This is a **budgeted capacity candidate, not a capacity claim**. Do not state that Seedy Research supports 100 simultaneous public users or 20 concurrent agent workflows until the production-safe profile in [#8](https://github.com/LeChiffreVol2/Seedy_Research/issues/8) passes the approved SLOs and saturation gates on the frozen candidate. Medium is preferred over Small for the Challenge because it buys 4 GB rather than 2 GB of database memory, 120 rather than 90 direct connections, 600 rather than 400 pooler clients, and twice the documented baseline disk throughput/IOPS. Those limits still do not predict query throughput.

Do **not** add a Supabase Log Drain for the Challenge. Its USD 60/month base charge alone would take the recommended fixed stack from USD 105 to USD 165 and outside this envelope. The current built-in Vercel and Supabase telemetry is enough to run the capacity decision.

## Approved target and the missing traffic definition

[Issue #1](https://github.com/LeChiffreVol2/Seedy_Research/issues/1) is the decision record for these targets:

| Surface | Approved target |
| --- | ---: |
| Feed/search | p95 <= 800 ms |
| Evidence/WebMCP read | p95 <= 2 s |
| Research Path | p95 <= 12 s; 20 s hard timeout |
| Full judge flow | <= 75 s without retry |
| Public concurrency | 100 simultaneous users |
| Agent concurrency | 20 simultaneous workflows |
| Read errors | < 1% |
| AI workflow errors | < 3% |

“100 users” and “20 workflows” are concurrency populations. They do not specify requests per second, session duration, think time, route mix, cache temperature, workflow tool-call count, response bytes, or monthly duty cycle. Therefore they cannot be converted honestly into throughput or a monthly variable bill. The load run must report the **achieved** arrival rate and completed workflow rate; neither should be assumed in advance.

The cost envelope consequently has two layers:

1. a fixed provider configuration that stays inside the ceiling even before throughput is known; and
2. measured variable usage from #8, projected through the official unit prices and constrained by provider spend controls.

## What the current implementation proves

### Placement and request bounds

- Both the web and remote MCP Vercel projects declare Singapore `sin1`: [`web/vercel.json`](../../../web/vercel.json) and [`mcp-server/vercel.json`](../../../mcp-server/vercel.json).
- The application bounds agentic retrieval at three agent steps, four tool calls, eight context chunks, and 8,000 context tokens in [`.env.example`](../../../.env.example). The remote MCP default rate limit is 240 calls per 60 seconds and uses a Supabase RPC for distributed enforcement.
- Research Path has an 18-second planning timeout and a 60-second Vercel function duration, but the handler does not impose one 20-second end-to-end deadline. Its default guards allow eight active path builds and six checkpoint assessments **per function instance**, returning retryable 503 responses above those values: [`web/app/api/research-path/route.ts`](../../../web/app/api/research-path/route.ts).
- Per-user/IP Research Path quotas are distributed through Supabase, but instance-local active counters are not a global 20-workflow admission controller: [`web/lib/chat-store.ts`](../../../web/lib/chat-store.ts).
- The current harness latency defaults are p95 25 seconds, maximum 30 seconds, and context p95 8 seconds; latency is report-first unless `HARNESS_ENFORCE_SLO=true`: [`docs/HARNESS.md`](../../HARNESS.md). Those defaults are looser than the approved Research Path target and cannot be used as SLO evidence.

### Existing cache and rights boundaries

- The open-access research feed and paper metadata APIs already return `s-maxage=60, stale-while-revalidate=300`, so repeated public reads can avoid function and database work: [`web/app/api/research-feed/route.ts`](../../../web/app/api/research-feed/route.ts) and [`web/app/api/papers/route.ts`](../../../web/app/api/papers/route.ts).
- Full-page reader responses are deliberately `private, no-store` so a takedown or rights change takes effect on the next request: [`web/app/api/papers/[source]/reader/route.ts`](../../../web/app/api/papers/%5Bsource%5D/reader/route.ts). This traffic must be measured as uncached application/database work and must not be “optimized” into a shared cache.
- Research Path, global discovery, translation, and private or user-specific routes are private/no-store. Their latency and cost cannot be inferred from public feed cache behavior.
- The public proof corpus is currently 1,297 papers and 11,523 active page-linked sections, with three rights-reviewed native reader papers and 68 pages: [`README.md`](../../../README.md). Row counts are not a proxy for database working-set size or query capacity.

### Existing telemetry

Operations already names the signals needed for a decision: MCP health/readiness/metrics, tool error codes, retrieval fallback and embedding circuit counters, Research Path completion/degradation/busy events, and structured Vercel logs: [`docs/OPERATIONS.md`](../../OPERATIONS.md). This is enough for the Challenge capacity run without buying a separate log pipeline.

## Current official provider envelope

Prices below are public list prices as checked on 2026-09-01. They exclude model/API providers, optional domains, extra Vercel seats, a persistent paid preview database, and unapproved add-ons.

### Vercel

The [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan) is USD 20/month for one deploying seat, with USD 20/month in managed-infrastructure credit, 1 TB Fast Data Transfer, and 10 million Edge Requests before credit/on-demand usage. [Pro supports unlimited projects](https://vercel.com/docs/limits), so one team can contain both current Vercel projects; there is no need to budget a second platform fee.

For the deployed Singapore region, current unit rates are:

| Resource | Included or unit price |
| --- | ---: |
| Fast Data Transfer | first 1 TB, then USD 0.16/GB |
| Edge Requests | first 10 million, then USD 2.60/million |
| Function invocations | first 1 million, then USD 0.60/million |
| Fluid Active CPU | USD 0.160/CPU-hour |
| Fluid provisioned memory | USD 0.0133/GB-hour |

Sources: [Singapore regional pricing](https://vercel.com/docs/pricing/regional-pricing/sin1) and [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing). Active CPU stops billing while a function waits on external I/O, but provisioned memory continues billing until the last in-flight request completes. That distinction is material for long agent workflows and prevents a reliable estimate without observed CPU time, allocated memory, and wall duration.

[Vercel's Pro concurrency ceiling](https://vercel.com/docs/functions/concurrency-scaling) is up to 30,000 function executions, with an initial burst of 1,000 new executions per ten seconds in a region. That platform ceiling is above this test population, but it is not end-to-end evidence: Seedy's instance-local admission guards, Supabase, query behavior, and external-provider waits can saturate first.

[Vercel Observability](https://vercel.com/docs/observability/observability-plus) is available at no additional cost on Pro but retains runtime logs for one day. Observability Plus costs USD 10/month plus USD 1.20 per million data events and extends retention to 30 days. The longer window and path-level latency data make it a justified Challenge-month expense.

[Vercel Spend Management](https://vercel.com/docs/spend-management) applies to metered resources beyond Pro credits/allocations, not seats or fixed add-ons. It can notify, call a webhook, or pause every production deployment. The pause action is intentionally availability-destructive, so alert at 50% and 75%, investigate before 100%, and use automatic pause only as the final budget guard.

### Supabase

The [Supabase Pro plan](https://supabase.com/pricing) is USD 25/month and includes USD 10/month in compute credits for the organization. For one continuously running production project, [official compute prices](https://supabase.com/docs/guides/platform/manage-your-usage/compute) produce:

| Compute candidate | Plan calculation | Fixed Supabase cost | Published resources | Status |
| --- | --- | ---: | --- | --- |
| Micro | 25 + 10 - 10 | USD 25 | 2 shared cores, 1 GB RAM, 60 direct / 200 pooler | Cheapest, no capacity evidence |
| Small | 25 + 15 - 10 | USD 30 | 2 shared cores, 2 GB RAM, 90 direct / 400 pooler | Lower-cost test candidate |
| **Medium** | 25 + 60 - 10 | **USD 75** | 2 shared cores, 4 GB RAM, 120 direct / 600 pooler | Recommended Challenge reservation |

The [compute and disk limits](https://supabase.com/docs/guides/platform/compute-and-disk) say Micro through Medium use shared CPU and can burst above baseline only for short periods. Medium publishes 43 MB/s baseline disk throughput and 2,000 baseline IOPS; Small publishes 22 MB/s and 1,000 IOPS. These are infrastructure limits, not Seedy Research latency guarantees.

Pro includes 8 GB database disk, 250 GB egress, 250 GB cached egress, 100 GB file storage, daily backups retained seven days, and seven-day log retention before published overages. Actual database bytes, egress, cache egress, and auth MAU must be captured in #8 and the Supabase usage dashboard.

Keep the [Supabase Spend Cap](https://supabase.com/docs/guides/platform/cost-control) on. It covers disk, egress, MAU, storage, Edge Function, Realtime, and the forthcoming logs SKUs, but does **not** cover compute or Log Drains. Fixed Medium compute is already included in the envelope. [Supabase says log-ingest and log-query pricing is still being rolled out](https://supabase.com/docs/guides/platform/manage-your-usage/logs), so that is a future price risk rather than a number to invent.

### Monthly package comparison

All THB figures use the conservative 38 THB/USD planning rate and exclude the separate 10% invoice contingency except where shown.

| Package | Vercel | Supabase | Observability Plus | Fixed USD | Fixed THB | Decision use |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Minimum production | 20 | 25 (Micro) | 10 | 55 | 2,090 | Fits the range; no capacity claim |
| Lean candidate | 20 | 30 (Small) | 10 | 60 | 2,280 | Test if savings matter |
| **Recommended reservation** | **20** | **75 (Medium)** | **10** | **105** | **3,990** | Freeze for #8 |
| Recommended + USD 14 Vercel metered cap | 34 | 75 | 10 | 119 | 4,522 | Maximum planned pre-contingency bill |
| Previous row + 10% invoice contingency | — | — | — | — | **4,974** | Strict planning ceiling |

A second paid Supabase Micro project in the same organization adds about USD 10/month because the organization has only USD 10 total compute credit. If a persistent paid preview database is required, fixed cost becomes USD 115 before metered usage; either omit Observability Plus outside the evidence-collection month, use Small after it passes #8, or fund preview separately. Do not silently count a persistent preview database inside the USD 105 recommendation.

## Defensible cache and traffic profile

This section is the profile to measure, not a statement of achieved throughput.

### Cache classes

| Class | Examples | Required behavior | Capacity implication |
| --- | --- | --- | --- |
| Public, rights-safe metadata | feed, paper cards/detail | Preserve existing 60 s shared TTL + 300 s stale window | Measure hit ratio and origin suppression |
| Static application assets | JS/CSS/images | Vercel CDN/immutable asset caching | Measure transfer, not origin DB load |
| Rights-sensitive full pages | native reader page text | Keep private/no-store | Every page open is origin work |
| Identity or mutable state | library, notes, history, workspace | Private/no-store | Every action is origin/database work |
| Agent workflows | chat, Research Path, checkpoint, translation | Private/no-store with bounded tool/context limits | Measure function memory/wall time, provider wait, DB calls, and errors |

Any new cache key, TTL, or invalidation design belongs to architecture ticket [#10](https://github.com/LeChiffreVol2/Seedy_Research/issues/10), after measurement. This ticket does not authorize caching private or rights-sensitive payloads.

### Production-safe test profile for #8

Run the frozen commit and exact production compute tier in `sin1`; verify the Supabase project region rather than assuming it is colocated. Use real provider calls for latency/error evidence while excluding their monetary charges from this infrastructure analysis.

1. Record a cold baseline, then warm the public metadata cache with one complete judge flow.
2. Hold **100 closed-loop public sessions**. Each session repeats the scripted public judge journey (feed/search, paper detail, exact-page evidence or reader, and visible WebMCP interaction) with the actual captured human/automation think times. Do not inject a guessed RPS.
3. Start **20 complete agent workflows** within the same ten-second window. Preserve the configured step/tool/context bounds and do not retry 429/503 responses inside the measured flow. Use 20 independent authenticated sessions if the target represents 20 users; if it represents 20 workflows from one identity, record that as a separate requirement because the current per-identity quota intentionally rejects it.
4. Hold the concurrent population for at least 15 minutes after ramp-up, then run one synchronized judge-flow burst. Record achieved request rate and workflow completions per minute.
5. Run the same profile twice: first with a warm public metadata cache, then with deliberate metadata-cache misses. Do not alter the reader's private/no-store contract.
6. Project monthly usage only after an explicit duty cycle is approved (event hours/day and days/month). Concurrency alone is insufficient.

This profile still needs two decisions before execution: the exact scripted route mix/think-time trace and whether the 20 workflows use independent identities or one identity. The judge journey should define them; an arbitrary 70/20/10 percentage split or an unstated identity distribution would create a false capacity number.

## Promotion gates and measurements

The Medium candidate may be described as “validated for the approved Challenge load” only when three consecutive #8 runs on the same frozen deployment meet all of the following and publish the sample count for every percentile:

- every approved p95, hard-timeout, judge-flow, read-error, and AI-error target;
- zero unplanned 429/503 responses at the approved population, including `research_path_busy` and `checkpoint_busy`;
- p99 and timeout counts reported even though they are not yet decision thresholds;
- no sustained CPU, memory, connection, disk throughput, IOPS, lock-wait, or slow-query signal above **70% of its applicable limit** during steady state; 70% is an internal headroom policy, not a provider guarantee;
- Vercel function invocations, Active CPU hours, provisioned GB-hours, transfer, Edge Requests, event count, and per-route latency exported for the test window;
- Supabase database bytes, egress, cache egress, connection/pooler peaks, CPU, memory, IOPS/throughput, slow queries, and quota RPC latency exported for the same window;
- public cache hit ratio and origin request suppression reported separately from no-store reader/private/agent traffic;
- infrastructure cost per public judge flow and per completed agent workflow calculated from observed units, with model/API cost explicitly excluded;
- the measured monthly projection fits the USD 14 Vercel on-demand cap and Supabase included quotas for the approved duty cycle.

If Medium fails, do not raise the claim or spend past the ceiling. Identify the saturated route/query, apply the minimal cache/admission/query decision through #10, and rerun #8. If Small passes the identical gate with the same headroom, it may replace Medium and reduce fixed cost by USD 45/month.

## Claims allowed now

Safe wording before #8 passes:

> The production candidate has a provider-priced infrastructure envelope of USD 105 fixed per month (about THB 3,990 at a conservative THB 38/USD), with a hard planned ceiling of about THB 4,974 including metered headroom and invoice contingency. Vercel and Supabase limits are compatible with testing the approved 100-user/20-workflow scenario, but application capacity and SLO compliance remain unverified pending a concurrent production-safe load run.

Claims that are **not** supportable now:

- “Seedy Research supports 100 concurrent users and 20 concurrent agents.”
- “The system sustains N requests or workflows per second.”
- “The judge flow is always under 75 seconds” or “Research Path p95 is under 12 seconds.”
- “Medium is sufficient” or “Micro/Small is insufficient.”
- “The full monthly bill is THB X at the target load” without a duty cycle and observed usage units.
- “Caching removes reader or agent load”; the rights-sensitive reader and private/agent routes intentionally bypass shared cache.
- “Vercel autoscaling proves end-to-end capacity”; database, application admission, provider latency, and shared-CPU saturation remain independent constraints.

## Decision

Use the **USD 105 / approximately THB 3,990 Medium package** as the frozen Challenge capacity candidate; cap additional Vercel metered spend at USD 14, keep the Supabase Spend Cap on, and buy no Supabase Log Drain. The THB 2,000–5,000 budget is defensible. The target-load capacity claim is not yet defensible and must remain blocked on #8.
