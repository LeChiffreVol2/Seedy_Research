create extension if not exists postgis;

create table if not exists smart_city_ingest_runs (
  id                    uuid primary key default gen_random_uuid(),
  run_type              text not null default 'spatial_core',
  status                text not null check (status in ('running', 'succeeded', 'partial', 'failed', 'cancelled', 'skipped')),
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  requested_by          text,
  request_id            text,
  source_ids            text[] not null default array[]::text[],
  succeeded_source_ids  text[] not null default array[]::text[],
  failed_source_ids     text[] not null default array[]::text[],
  stale_source_ids      text[] not null default array[]::text[],
  counts                jsonb not null default '{}'::jsonb,
  error_code            text,
  error_message         text,
  metadata              jsonb not null default '{}'::jsonb
);

create unique index if not exists smart_city_ingest_runs_one_running_idx
on smart_city_ingest_runs (run_type)
where status = 'running';

create index if not exists smart_city_ingest_runs_status_idx
on smart_city_ingest_runs (run_type, status, started_at desc);

create table if not exists smart_city_ingest_run_sources (
  run_id           uuid not null references smart_city_ingest_runs(id) on delete cascade,
  source_id        text not null references smart_city_sources(id) on delete cascade,
  status           text not null check (status in ('running', 'succeeded', 'partial', 'failed', 'stale', 'skipped')),
  attempted_at     timestamptz not null default now(),
  last_success_at  timestamptz,
  record_count     integer not null default 0,
  stale_count      integer not null default 0,
  latency_ms       integer,
  message          text,
  error_message    text,
  primary key (run_id, source_id)
);

create index if not exists smart_city_ingest_run_sources_source_idx
on smart_city_ingest_run_sources (source_id, attempted_at desc);

alter table smart_city_events
  add column if not exists last_seen_ingest_run_id uuid references smart_city_ingest_runs(id) on delete set null,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_at timestamptz,
  add column if not exists stale_reason text;

alter table smart_city_assets
  add column if not exists last_seen_ingest_run_id uuid references smart_city_ingest_runs(id) on delete set null,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_at timestamptz,
  add column if not exists stale_reason text;

alter table smart_city_hotspots
  add column if not exists source_ids text[] not null default array[]::text[],
  add column if not exists last_seen_ingest_run_id uuid references smart_city_ingest_runs(id) on delete set null,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_at timestamptz,
  add column if not exists stale_reason text;

alter table smart_city_objects
  add column if not exists last_seen_ingest_run_id uuid references smart_city_ingest_runs(id) on delete set null,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_at timestamptz,
  add column if not exists stale_reason text;

alter table smart_city_links
  add column if not exists last_seen_ingest_run_id uuid references smart_city_ingest_runs(id) on delete set null,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_at timestamptz,
  add column if not exists stale_reason text;

alter table smart_city_insights
  add column if not exists last_seen_ingest_run_id uuid references smart_city_ingest_runs(id) on delete set null,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_at timestamptz,
  add column if not exists stale_reason text;

alter table smart_city_action_records
  add column if not exists research_run_id text references smart_city_research_runs(id) on delete set null,
  add column if not exists proposal_id text,
  add column if not exists insight_id text,
  add column if not exists evidence_strengths jsonb not null default '{}'::jsonb,
  add column if not exists evidence_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists permission_state text not null default 'operator_acknowledged',
  add column if not exists acknowledgements jsonb not null default '[]'::jsonb,
  add column if not exists acknowledged_by text,
  add column if not exists acknowledged_at timestamptz;

create table if not exists smart_city_research_proposals (
  id                         text primary key,
  run_id                     text not null references smart_city_research_runs(id) on delete cascade,
  proposal_id                text not null,
  insight_id                 text,
  action_type                text not null check (action_type in ('verify_camera', 'audit_signal', 'queue_control_review', 'dispatch_field_check', 'monitor_watchlist')),
  title                      text not null,
  rationale                  text not null,
  confidence                 numeric(4,3) not null default 0.5,
  risk_before                numeric(5,2) not null check (risk_before >= 0 and risk_before <= 100),
  expected_risk_after        numeric(5,2) not null check (expected_risk_after >= 0 and expected_risk_after <= 100),
  delta                      numeric(5,2) not null,
  evidence_ids               text[] not null default array[]::text[],
  source_object_ids          text[] not null default array[]::text[],
  evidence_strengths         jsonb not null default '{}'::jsonb,
  required_acknowledgements  text[] not null default array[]::text[],
  normalized_hash            text not null,
  caveat                     text not null,
  created_at                 timestamptz not null default now(),
  unique (run_id, proposal_id)
);

create index if not exists smart_city_events_geometry_active_gix
on smart_city_events using gist (geometry)
where is_stale = false;

create index if not exists smart_city_assets_geometry_active_gix
on smart_city_assets using gist (geometry)
where is_stale = false;

create index if not exists smart_city_hotspots_geometry_active_gix
on smart_city_hotspots using gist (geometry)
where is_stale = false;

create index if not exists smart_city_objects_geometry_active_gix
on smart_city_objects using gist (geometry)
where is_stale = false;

create index if not exists smart_city_events_source_stale_observed_idx
on smart_city_events (source_id, is_stale, observed_at desc);

create index if not exists smart_city_assets_source_stale_updated_idx
on smart_city_assets (source_id, is_stale, updated_at desc);

create index if not exists smart_city_hotspots_source_ids_gin
on smart_city_hotspots using gin (source_ids);

create index if not exists smart_city_objects_source_stale_updated_idx
on smart_city_objects (source_id, is_stale, updated_at desc);

create index if not exists smart_city_links_stale_updated_idx
on smart_city_links (is_stale, updated_at desc);

create index if not exists smart_city_insights_stale_generated_idx
on smart_city_insights (is_stale, generated_at desc);

create index if not exists smart_city_action_records_research_idx
on smart_city_action_records (research_run_id);

create unique index if not exists smart_city_action_records_research_proposal_uidx
on smart_city_action_records (research_run_id, proposal_id)
where research_run_id is not null and proposal_id is not null;

create index if not exists smart_city_research_proposals_run_idx
on smart_city_research_proposals (run_id);

create index if not exists smart_city_research_proposals_evidence_gin
on smart_city_research_proposals using gin (evidence_ids);

alter table smart_city_sources enable row level security;
alter table smart_city_source_health enable row level security;
alter table smart_city_assets enable row level security;
alter table smart_city_ingest_runs enable row level security;
alter table smart_city_ingest_run_sources enable row level security;
alter table smart_city_research_proposals enable row level security;

create or replace view smart_city_source_freshness_v as
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
  h.last_success_at + make_interval(secs => greatest(60, coalesce(s.refresh_seconds, 300))) as fresh_until,
  h.message,
  h.updated_at,
  (
    s.is_enabled
    and coalesce(h.status, 'needs_config') in ('ok', 'degraded')
    and coalesce(h.data_class, s.data_class, 'needs_config') not in ('stale', 'needs_config')
    and h.last_success_at is not null
    and now() <= h.last_success_at + make_interval(secs => greatest(60, coalesce(s.refresh_seconds, 300)))
  ) as is_eligible_for_layers,
  (
    s.is_enabled
    and coalesce(h.status, 'needs_config') in ('ok', 'degraded')
    and coalesce(h.data_class, s.data_class, 'needs_config') not in ('stale', 'needs_config')
    and h.last_success_at is not null
    and now() <= h.last_success_at + make_interval(secs => greatest(60, coalesce(s.refresh_seconds, 300)))
  ) as is_eligible_for_insights,
  case
    when not s.is_enabled then 'source_disabled'
    when h.source_id is null then 'missing_source_health'
    when coalesce(h.status, 'needs_config') not in ('ok', 'degraded') then coalesce(h.status, 'needs_config')
    when coalesce(h.data_class, s.data_class, 'needs_config') in ('stale', 'needs_config') then coalesce(h.data_class, s.data_class, 'needs_config')
    when h.last_success_at is null then 'never_successful'
    when now() > h.last_success_at + make_interval(secs => greatest(60, coalesce(s.refresh_seconds, 300))) then 'freshness_expired'
    else 'eligible'
  end as ineligible_reason
from smart_city_sources s
left join smart_city_source_health h on h.source_id = s.id;

create or replace view smart_city_layer_items_v as
select
  e.id,
  'event'::text as row_kind,
  case
    when coalesce(e.source_id, '') ilike '%osiris%' then 'osiris'
    when e.event_type like 'rail_%' then 'rail'
    when e.event_type = 'congestion' then 'congestion'
    when e.event_type = 'weather_risk' then 'weather'
    when e.event_type = 'roadwork' then 'roadworks'
    else 'incidents'
  end as layer_id,
  e.event_type as object_type,
  e.source_id,
  array_remove(array[e.source_id], null)::text[] as source_ids,
  e.title,
  e.severity,
  e.confidence,
  e.observed_at,
  e.updated_at,
  e.source_url,
  e.geometry,
  array_remove(array['source:' || e.source_id, 'url:' || coalesce(e.source_url, '')], 'url:')::text[] as provenance,
  e.is_stale,
  e.stale_reason,
  e.last_seen_at,
  coalesce(sf.status, 'needs_config') as status,
  coalesce(sf.data_class, 'needs_config') as data_class,
  sf.freshness_seconds,
  coalesce(sf.is_eligible_for_layers, false) as is_eligible_for_layers,
  coalesce(sf.ineligible_reason, 'missing_source_health') as eligibility_reason
from smart_city_events e
left join smart_city_source_freshness_v sf on sf.source_id = e.source_id
union all
select
  a.id,
  'asset'::text as row_kind,
  case
    when coalesce(a.source_id, '') ilike '%osiris%' then 'osiris'
    when a.asset_type = 'camera' then 'cameras'
    when a.asset_type like 'rail_%' then 'rail'
    else 'assets'
  end as layer_id,
  a.asset_type as object_type,
  a.source_id,
  array_remove(array[a.source_id], null)::text[] as source_ids,
  a.name as title,
  null::text as severity,
  null::numeric as confidence,
  null::timestamptz as observed_at,
  a.updated_at,
  nullif(a.attributes->>'sourceUrl', '') as source_url,
  st_force2d(a.geometry) as geometry,
  array_remove(array['source:' || a.source_id, 'url:' || coalesce(nullif(a.attributes->>'sourceUrl', ''), '')], 'url:')::text[] as provenance,
  a.is_stale,
  a.stale_reason,
  a.last_seen_at,
  coalesce(sf.status, 'needs_config') as status,
  coalesce(sf.data_class, 'needs_config') as data_class,
  sf.freshness_seconds,
  coalesce(sf.is_eligible_for_layers, false) as is_eligible_for_layers,
  coalesce(sf.ineligible_reason, 'missing_source_health') as eligibility_reason
from smart_city_assets a
left join smart_city_source_freshness_v sf on sf.source_id = a.source_id
where st_geometrytype(a.geometry) = 'ST_Point'
union all
select
  h.id,
  'hotspot'::text as row_kind,
  'hotspots'::text as layer_id,
  'hotspot'::text as object_type,
  h.source_ids[1] as source_id,
  h.source_ids,
  h.name as title,
  h.severity,
  h.confidence,
  null::timestamptz as observed_at,
  h.updated_at,
  null::text as source_url,
  h.geometry,
  array_cat(array['derived:hotspot'], coalesce(h.source_ids, array[]::text[])) as provenance,
  h.is_stale,
  h.stale_reason,
  h.last_seen_at,
  coalesce(hs.status, 'needs_config') as status,
  coalesce(hs.data_class, 'needs_config') as data_class,
  hs.freshness_seconds,
  coalesce(hs.is_eligible_for_layers, false) as is_eligible_for_layers,
  coalesce(hs.ineligible_reason, 'missing_source_health') as eligibility_reason
from smart_city_hotspots h
left join lateral (
  select
    case
      when bool_or(not sf.is_eligible_for_layers) then false
      else count(sf.source_id) > 0
    end as is_eligible_for_layers,
    min(sf.freshness_seconds) as freshness_seconds,
    (array_agg(sf.status order by case sf.status when 'offline' then 1 when 'needs_config' then 2 when 'stale' then 3 when 'degraded' then 4 else 5 end))[1] as status,
    (array_agg(sf.data_class order by case sf.data_class when 'live' then 1 when 'near_real_time' then 2 when 'official_baseline' then 3 when 'historical' then 4 when 'stale' then 5 else 6 end))[1] as data_class,
    (array_agg(sf.ineligible_reason order by case when sf.is_eligible_for_layers then 2 else 1 end))[1] as ineligible_reason
  from smart_city_source_freshness_v sf
  where sf.source_id = any(h.source_ids)
) hs on true;

create or replace view smart_city_layer_registry_v as
select
  layer_id,
  count(*) filter (where not is_stale and is_eligible_for_layers) as active_count,
  count(*) filter (where is_stale) as stale_count,
  count(*) as total_count,
  array_remove(array_agg(distinct source_id), null)::text[] as source_ids,
  (array_agg(status order by case status when 'offline' then 1 when 'needs_config' then 2 when 'stale' then 3 when 'degraded' then 4 else 5 end))[1] as status,
  (array_agg(data_class order by case data_class when 'live' then 1 when 'near_real_time' then 2 when 'official_baseline' then 3 when 'historical' then 4 when 'stale' then 5 else 6 end))[1] as data_class,
  min(freshness_seconds) as freshness_seconds,
  max(updated_at) as last_refresh_at,
  array_agg(distinct replace(st_geometrytype(geometry), 'ST_', '')) as geometry_types
from smart_city_layer_items_v
group by layer_id;

create or replace function smart_city_get_layer_features(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_zoom double precision default null,
  p_layer_ids text[] default null,
  p_since timestamptz default null,
  p_include_stale boolean default false,
  p_limit integer default 1200
)
returns table (
  id text,
  row_kind text,
  layer_id text,
  object_type text,
  source_id text,
  source_ids text[],
  title text,
  severity text,
  confidence numeric,
  observed_at timestamptz,
  updated_at timestamptz,
  source_url text,
  data_class text,
  status text,
  freshness_seconds integer,
  eligibility_reason text,
  is_stale boolean,
  stale_reason text,
  last_seen_at timestamptz,
  provenance text[],
  geometry jsonb
)
language sql
stable
as $$
  select
    item.id,
    item.row_kind,
    item.layer_id,
    item.object_type,
    item.source_id,
    item.source_ids,
    item.title,
    item.severity,
    item.confidence,
    item.observed_at,
    item.updated_at,
    item.source_url,
    item.data_class,
    item.status,
    item.freshness_seconds,
    item.eligibility_reason,
    item.is_stale,
    item.stale_reason,
    item.last_seen_at,
    item.provenance,
    st_asgeojson(item.geometry)::jsonb as geometry
  from smart_city_layer_items_v item
  where item.geometry && st_makeenvelope(p_west, p_south, p_east, p_north, 4326)
    and st_intersects(item.geometry, st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
    and (p_layer_ids is null or item.layer_id = any(p_layer_ids))
    and (p_since is null or item.updated_at >= p_since)
    and (p_include_stale or (not item.is_stale and item.is_eligible_for_layers))
  order by
    case item.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end,
    item.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 1200), 5000)) + 1;
$$;

create or replace function smart_city_get_layer_feature_stats(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_layer_ids text[] default null,
  p_since timestamptz default null
)
returns table (
  total_count bigint,
  active_count bigint,
  stale_excluded_count bigint,
  freshness_excluded_count bigint
)
language sql
stable
as $$
  select
    count(*) as total_count,
    count(*) filter (where not item.is_stale and item.is_eligible_for_layers) as active_count,
    count(*) filter (where item.is_stale) as stale_excluded_count,
    count(*) filter (where not item.is_stale and not item.is_eligible_for_layers) as freshness_excluded_count
  from smart_city_layer_items_v item
  where item.geometry && st_makeenvelope(p_west, p_south, p_east, p_north, 4326)
    and st_intersects(item.geometry, st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
    and (p_layer_ids is null or item.layer_id = any(p_layer_ids))
    and (p_since is null or item.updated_at >= p_since);
$$;

create or replace function smart_city_begin_ingest_run(
  p_run_type text default 'spatial_core',
  p_requested_by text default null,
  p_request_id text default null,
  p_source_ids text[] default array[]::text[],
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_run_id uuid;
begin
  insert into smart_city_ingest_runs (run_type, status, requested_by, request_id, source_ids, metadata)
  values (coalesce(p_run_type, 'spatial_core'), 'running', p_requested_by, p_request_id, coalesce(p_source_ids, array[]::text[]), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_run_id;

  return v_run_id;
exception
  when unique_violation then
    raise exception 'ingest run already running for %', coalesce(p_run_type, 'spatial_core') using errcode = '23505';
end;
$$;

create or replace function smart_city_mark_missing_rows_stale(
  p_run_id uuid,
  p_source_ids text[],
  p_reason text default 'missing_from_successful_ingest'
)
returns table (table_name text, stale_count integer)
language plpgsql
as $$
declare
  v_count integer;
begin
  update smart_city_events
  set is_stale = true, stale_at = now(), stale_reason = coalesce(p_reason, 'missing_from_successful_ingest')
  where source_id = any(coalesce(p_source_ids, array[]::text[]))
    and coalesce(last_seen_ingest_run_id::text, '') <> p_run_id::text
    and is_stale = false;
  get diagnostics v_count = row_count;
  table_name := 'smart_city_events'; stale_count := v_count; return next;

  update smart_city_assets
  set is_stale = true, stale_at = now(), stale_reason = coalesce(p_reason, 'missing_from_successful_ingest')
  where source_id = any(coalesce(p_source_ids, array[]::text[]))
    and coalesce(last_seen_ingest_run_id::text, '') <> p_run_id::text
    and is_stale = false;
  get diagnostics v_count = row_count;
  table_name := 'smart_city_assets'; stale_count := v_count; return next;

  update smart_city_hotspots
  set is_stale = true, stale_at = now(), stale_reason = coalesce(p_reason, 'missing_from_successful_ingest')
  where source_ids && coalesce(p_source_ids, array[]::text[])
    and coalesce(last_seen_ingest_run_id::text, '') <> p_run_id::text
    and is_stale = false;
  get diagnostics v_count = row_count;
  table_name := 'smart_city_hotspots'; stale_count := v_count; return next;

  update smart_city_objects
  set is_stale = true, stale_at = now(), stale_reason = coalesce(p_reason, 'missing_from_successful_ingest')
  where source_id = any(coalesce(p_source_ids, array[]::text[]))
    and coalesce(last_seen_ingest_run_id::text, '') <> p_run_id::text
    and is_stale = false;
  get diagnostics v_count = row_count;
  table_name := 'smart_city_objects'; stale_count := v_count; return next;

  update smart_city_insights i
  set is_stale = true, stale_at = now(), stale_reason = 'source_object_stale'
  where i.is_stale = false
    and exists (
      select 1
      from smart_city_objects o
      where o.is_stale = true
        and o.id = any(i.source_object_ids)
    );
  get diagnostics v_count = row_count;
  table_name := 'smart_city_insights'; stale_count := v_count; return next;
end;
$$;

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
    stale_source_ids = coalesce(p_succeeded_source_ids, array[]::text[]),
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

notify pgrst, 'reload schema';
