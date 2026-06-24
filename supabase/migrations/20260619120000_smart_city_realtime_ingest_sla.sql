-- Make source SLA truth-label aware for scheduled ingest.
-- Live/NRT sources stay strict. Official baseline and historical sources use
-- dataset-cadence thresholds so they are not mislabeled as realtime failures.

create or replace view smart_city_source_sla_v as
with source_runs as (
  select
    s.id as source_id,
    count(*) filter (where irs.attempted_at >= now() - interval '24 hours') as attempts_24h,
    count(*) filter (
      where irs.attempted_at >= now() - interval '24 hours'
        and irs.status in ('succeeded', 'partial', 'stale')
    ) as successes_24h,
    percentile_disc(0.95) within group (order by irs.latency_ms) filter (
      where irs.attempted_at >= now() - interval '24 hours' and irs.latency_ms is not null
    ) as p95_latency_ms_24h,
    count(*) filter (
      where irs.attempted_at >= now() - interval '24 hours'
        and irs.status = 'failed'
    ) as failures_24h
  from smart_city_sources s
  left join smart_city_ingest_run_sources irs on irs.source_id = s.id
  group by s.id
),
enriched as (
  select
    s.id as source_id,
    s.name,
    s.provider,
    s.category,
    s.region,
    s.source_url,
    coalesce(h.status, 'needs_config') as status,
    h.last_success_at,
    h.last_attempt_at,
    h.latency_ms,
    coalesce(h.record_count, 0) as record_count,
    h.freshness_seconds,
    h.message,
    coalesce(h.data_class, s.data_class, 'needs_config') as data_class,
    coalesce(h.refresh_policy, s.refresh_policy) as refresh_policy,
    h.last_modified,
    coalesce(h.upstream_cadence, s.upstream_cadence) as upstream_cadence,
    coalesce(
      s.sla_freshness_seconds,
      case coalesce(h.data_class, s.data_class, 'needs_config')
        when 'live' then greatest(coalesce(s.refresh_seconds, 300) * 3, 900)
        when 'near_real_time' then greatest(coalesce(s.refresh_seconds, 300) * 6, 1800)
        when 'official_baseline' then greatest(coalesce(s.refresh_seconds, 86400) * 45, 2592000)
        when 'historical' then greatest(coalesce(s.refresh_seconds, 86400) * 90, 7776000)
        else greatest(coalesce(s.refresh_seconds, 300) * 3, 900)
      end
    ) as sla_freshness_seconds,
    coalesce(s.sla_latency_ms, 3000) as sla_latency_ms,
    coalesce(s.sla_min_success_rate_24h, 0.80) as sla_min_success_rate_24h,
    coalesce(s.sla_min_record_count, 0) as sla_min_record_count,
    coalesce(sr.attempts_24h, 0) as attempts_24h,
    coalesce(sr.successes_24h, 0) as successes_24h,
    sr.p95_latency_ms_24h,
    coalesce(sr.failures_24h, 0) as failures_24h,
    case
      when h.last_success_at is null then null
      else extract(epoch from now() - h.last_success_at)::integer
    end as seconds_since_success
  from smart_city_sources s
  left join smart_city_source_health h on h.source_id = s.id
  left join source_runs sr on sr.source_id = s.id
)
select
  *,
  case
    when status in ('offline', 'needs_config') then 'breach'
    when seconds_since_success is not null and seconds_since_success > sla_freshness_seconds then 'breach'
    when latency_ms is not null and latency_ms > sla_latency_ms then 'breach'
    when record_count < sla_min_record_count then 'breach'
    when attempts_24h >= 3 and (successes_24h::numeric / greatest(attempts_24h, 1)) < sla_min_success_rate_24h then 'breach'
    when status in ('degraded', 'stale') then 'warn'
    when seconds_since_success is not null and seconds_since_success > floor(sla_freshness_seconds * 0.8) then 'warn'
    else 'ok'
  end as sla_state,
  array_remove(array[
    case when status in ('offline', 'needs_config') then status end,
    case when seconds_since_success is not null and seconds_since_success > sla_freshness_seconds then 'freshness_breach' end,
    case when latency_ms is not null and latency_ms > sla_latency_ms then 'latency_breach' end,
    case when record_count < sla_min_record_count then 'record_count_breach' end,
    case when attempts_24h >= 3 and (successes_24h::numeric / greatest(attempts_24h, 1)) < sla_min_success_rate_24h then 'success_rate_breach' end
  ], null)::text[] as breach_reasons,
  case
    when seconds_since_success is null then null
    else greatest(sla_freshness_seconds - seconds_since_success, 0)
  end as seconds_until_breach,
  case
    when attempts_24h = 0 then null
    else round(successes_24h::numeric / greatest(attempts_24h, 1), 4)
  end as success_rate_24h
from enriched;

notify pgrst, 'reload schema';
