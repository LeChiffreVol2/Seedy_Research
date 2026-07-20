-- CityMCP production hardening: read eligibility matches truth labels, ingest
-- audit stops marking every successful source as stale, and the mutating
-- action-transition RPC is service-role only.

create or replace view smart_city_source_freshness_v as
with enriched as (
  select
    s.id as source_id,
    s.name,
    s.provider,
    s.category,
    s.region,
    s.source_url,
    coalesce(h.data_class, s.data_class, 'needs_config') as data_class,
    coalesce(h.refresh_policy, s.refresh_policy) as refresh_policy,
    coalesce(h.upstream_cadence, s.upstream_cadence) as upstream_cadence,
    s.refresh_seconds,
    s.is_enabled,
    coalesce(h.status, 'needs_config') as status,
    h.last_success_at,
    h.last_attempt_at,
    h.latency_ms,
    coalesce(h.record_count, 0) as record_count,
    coalesce(h.freshness_seconds, greatest(0, floor(extract(epoch from (now() - h.last_success_at)))::integer)) as freshness_seconds,
    coalesce(
      s.sla_freshness_seconds,
      case coalesce(h.data_class, s.data_class, 'needs_config')
        when 'live' then greatest(coalesce(s.refresh_seconds, 300) * 3, 900)
        when 'near_real_time' then greatest(coalesce(s.refresh_seconds, 300) * 6, 1800)
        when 'official_baseline' then greatest(coalesce(s.refresh_seconds, 86400) * 45, 2592000)
        when 'historical' then greatest(coalesce(s.refresh_seconds, 86400) * 90, 7776000)
        else greatest(coalesce(s.refresh_seconds, 300) * 3, 900)
      end
    ) as eligibility_seconds,
    h.message,
    h.updated_at
  from smart_city_sources s
  left join smart_city_source_health h on h.source_id = s.id
)
select
  source_id,
  name,
  provider,
  category,
  region,
  source_url,
  data_class,
  refresh_policy,
  upstream_cadence,
  refresh_seconds,
  is_enabled,
  status,
  last_success_at,
  last_attempt_at,
  latency_ms,
  record_count,
  freshness_seconds,
  last_success_at + make_interval(secs => eligibility_seconds) as fresh_until,
  message,
  updated_at,
  (
    is_enabled
    and status in ('ok', 'degraded')
    and data_class not in ('stale', 'needs_config')
    and last_success_at is not null
    and now() <= last_success_at + make_interval(secs => eligibility_seconds)
  ) as is_eligible_for_layers,
  (
    is_enabled
    and status in ('ok', 'degraded')
    and data_class not in ('stale', 'needs_config')
    and last_success_at is not null
    and now() <= last_success_at + make_interval(secs => eligibility_seconds)
  ) as is_eligible_for_insights,
  case
    when not is_enabled then 'source_disabled'
    when last_attempt_at is null then 'missing_source_health'
    when status not in ('ok', 'degraded') then status
    when data_class in ('stale', 'needs_config') then data_class
    when last_success_at is null then 'never_successful'
    when now() > last_success_at + make_interval(secs => eligibility_seconds) then 'freshness_expired'
    else 'eligible'
  end as ineligible_reason
from enriched;

create or replace function smart_city_finish_ingest_run(
  p_run_id uuid,
  p_status text,
  p_succeeded_source_ids text[] default array[]::text[],
  p_failed_source_ids text[] default array[]::text[],
  p_counts jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_stale jsonb;
begin
  if p_status not in ('succeeded', 'partial', 'failed', 'cancelled', 'skipped') then
    raise exception 'invalid ingest status %', p_status using errcode = '22023';
  end if;

  with stale_rows as (
    select * from smart_city_mark_missing_rows_stale(p_run_id, coalesce(p_succeeded_source_ids, array[]::text[]))
  )
  select coalesce(jsonb_object_agg(table_name, stale_count), '{}'::jsonb) into v_stale
  from stale_rows;

  update smart_city_ingest_runs
  set
    status = p_status,
    finished_at = now(),
    succeeded_source_ids = coalesce(p_succeeded_source_ids, array[]::text[]),
    failed_source_ids = coalesce(p_failed_source_ids, array[]::text[]),
    stale_source_ids = array[]::text[],
    counts = coalesce(p_counts, '{}'::jsonb) || jsonb_build_object('stale', v_stale),
    error_code = p_error_code,
    error_message = p_error_message
  where id = p_run_id and status = 'running';

  if not found then
    raise exception 'running ingest run % was not found', p_run_id using errcode = '22023';
  end if;

  return v_stale;
end;
$$;

revoke all on function public.smart_city_transition_action_record(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.smart_city_transition_action_record(text, text, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
