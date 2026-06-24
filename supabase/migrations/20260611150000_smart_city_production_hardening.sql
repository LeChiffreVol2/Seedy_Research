create extension if not exists postgis;

alter table smart_city_sources
  add column if not exists sla_freshness_seconds integer,
  add column if not exists sla_latency_ms integer,
  add column if not exists sla_min_success_rate_24h numeric(5,4),
  add column if not exists sla_min_record_count integer;

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
    coalesce(s.sla_freshness_seconds, greatest(coalesce(s.refresh_seconds, 300) * 3, 900)) as sla_freshness_seconds,
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

create or replace function smart_city_get_layer_mvt(
  p_z integer,
  p_x integer,
  p_y integer,
  p_layer_ids text[] default null,
  p_since timestamptz default null,
  p_include_stale boolean default false,
  p_extent integer default 4096,
  p_buffer integer default 64,
  p_limit integer default 5000
)
returns table (
  tile_base64 text,
  feature_count integer,
  truncated boolean,
  generated_at timestamptz
)
language sql
stable
as $$
  with bounds as (
    select st_tileenvelope(p_z, p_x, p_y) as geom
  ),
  filtered as (
    select
      item.id,
      item.layer_id,
      item.row_kind,
      item.object_type,
      item.source_id,
      item.source_ids,
      item.title,
      item.severity,
      item.confidence,
      item.observed_at,
      item.updated_at,
      item.data_class,
      item.status,
      item.freshness_seconds,
      item.is_stale,
      item.stale_reason,
      item.provenance,
      st_asmvtgeom(st_transform(item.geometry, 3857), bounds.geom, greatest(256, least(coalesce(p_extent, 4096), 8192)), greatest(0, least(coalesce(p_buffer, 64), 512)), true) as geom
    from smart_city_layer_items_v item
    cross join bounds
    where item.geometry && st_transform(bounds.geom, 4326)
      and st_intersects(item.geometry, st_transform(bounds.geom, 4326))
      and (p_layer_ids is null or item.layer_id = any(p_layer_ids))
      and (p_since is null or item.updated_at >= p_since)
      and (p_include_stale or (not item.is_stale and item.is_eligible_for_layers))
    order by
      case item.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end,
      item.updated_at desc,
      item.id asc
    limit greatest(1, least(coalesce(p_limit, 5000), 20000)) + 1
  ),
  tile_rows as (
    select *
    from filtered
    where geom is not null
    limit greatest(1, least(coalesce(p_limit, 5000), 20000))
  )
  select
    encode(coalesce(st_asmvt(tile_rows, 'citymcp', greatest(256, least(coalesce(p_extent, 4096), 8192)), 'geom'), '\x'::bytea), 'base64') as tile_base64,
    (select count(*)::integer from tile_rows) as feature_count,
    (select count(*) from filtered) > greatest(1, least(coalesce(p_limit, 5000), 20000)) as truncated,
    now() as generated_at
  from tile_rows;
$$;

create or replace function smart_city_get_layer_features_page(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_zoom double precision default null,
  p_layer_ids text[] default null,
  p_since timestamptz default null,
  p_cursor_rank integer default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id text default null,
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
  geometry jsonb,
  cursor_rank integer,
  cursor_updated_at timestamptz,
  cursor_id text
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
    st_asgeojson(item.geometry)::jsonb as geometry,
    case item.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end as cursor_rank,
    coalesce(item.updated_at, item.observed_at, item.last_seen_at, '-infinity'::timestamptz) as cursor_updated_at,
    item.id as cursor_id
  from smart_city_layer_items_v item
  where item.geometry && st_makeenvelope(p_west, p_south, p_east, p_north, 4326)
    and st_intersects(item.geometry, st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
    and (p_layer_ids is null or item.layer_id = any(p_layer_ids))
    and (p_since is null or item.updated_at >= p_since)
    and (p_include_stale or (not item.is_stale and item.is_eligible_for_layers))
    and (
      p_cursor_rank is null
      or case item.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end > p_cursor_rank
      or (
        case item.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end = p_cursor_rank
        and
        coalesce(item.updated_at, item.observed_at, item.last_seen_at, '-infinity'::timestamptz) < p_cursor_updated_at
      )
      or (
        case item.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end = p_cursor_rank
        and coalesce(item.updated_at, item.observed_at, item.last_seen_at, '-infinity'::timestamptz) = p_cursor_updated_at
        and item.id > coalesce(p_cursor_id, '')
      )
    )
  order by
    case item.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end,
    coalesce(item.updated_at, item.observed_at, item.last_seen_at, '-infinity'::timestamptz) desc,
    item.id asc
  limit greatest(1, least(coalesce(p_limit, 1200), 5000)) + 1;
$$;

do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'smart_city_action_records'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%'
    and pg_get_constraintdef(oid) like '%recorded%'
    and pg_get_constraintdef(oid) like '%approved%'
    and pg_get_constraintdef(oid) like '%cancelled%'
  limit 1;

  if v_constraint is not null then
    execute format('alter table smart_city_action_records drop constraint %I', v_constraint);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'smart_city_action_records'::regclass
      and conname = 'smart_city_action_records_status_lifecycle_check'
  ) then
    alter table smart_city_action_records
      add constraint smart_city_action_records_status_lifecycle_check
      check (status in (
        'proposed',
        'acknowledged',
        'recorded',
        'pending_approval',
        'approved',
        'assigned',
        'in_progress',
        'verified',
        'closed',
        'rejected',
        'cancelled',
        'expired',
        'superseded',
        'failed'
      ));
  end if;
end $$;

alter table smart_city_action_records
  add column if not exists assigned_to text,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists outcome_summary text;

create table if not exists smart_city_action_events (
  id               uuid primary key default gen_random_uuid(),
  action_record_id text not null references smart_city_action_records(id) on delete cascade,
  from_status      text,
  to_status        text not null,
  actor            text not null,
  role             text not null,
  reason           text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists smart_city_action_events_record_idx
on smart_city_action_events (action_record_id, created_at desc);

insert into smart_city_action_events (action_record_id, from_status, to_status, actor, role, reason, created_at)
select
  r.id,
  null,
  r.status,
  r.actor,
  'operator',
  'Backfilled lifecycle event from existing action record.',
  r.created_at
from smart_city_action_records r
where not exists (
  select 1 from smart_city_action_events e where e.action_record_id = r.id
);

create table if not exists smart_city_command_batches (
  id              text primary key,
  actor           text not null,
  role            text not null,
  research_run_id text references smart_city_research_runs(id) on delete set null,
  proposal_id     text,
  insight_id      text,
  object_ids      text[] not null default array[]::text[],
  created_at      timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb
);

create table if not exists smart_city_commands (
  id                         text primary key,
  batch_id                   text not null references smart_city_command_batches(id) on delete cascade,
  actor                      text not null,
  role                       text not null,
  research_run_id            text references smart_city_research_runs(id) on delete set null,
  proposal_id                text,
  insight_id                 text,
  object_ids                 text[] not null default array[]::text[],
  command_type               text not null,
  command_payload            jsonb not null,
  reason                     text not null,
  permission                 text not null check (permission in ('auto', 'requires_ack', 'blocked')),
  ack_state                  text not null check (ack_state in ('not_required', 'pending', 'acknowledged')),
  required_acknowledgements  text[] not null default array[]::text[],
  status                     text not null check (status in ('pending', 'applied', 'rejected', 'failed')),
  idempotency_hash           text not null unique,
  error                      text,
  created_at                 timestamptz not null default now(),
  applied_at                 timestamptz
);

create table if not exists smart_city_command_events (
  id           uuid primary key default gen_random_uuid(),
  command_id   text not null references smart_city_commands(id) on delete cascade,
  actor        text not null,
  role         text not null,
  event_type   text not null,
  from_status  text,
  to_status    text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists smart_city_commands_batch_idx
on smart_city_commands (batch_id, created_at desc);

create index if not exists smart_city_commands_object_ids_gin
on smart_city_commands using gin (object_ids);

create index if not exists smart_city_commands_research_idx
on smart_city_commands (research_run_id);

create index if not exists smart_city_command_events_command_idx
on smart_city_command_events (command_id, created_at desc);

alter table smart_city_command_batches enable row level security;
alter table smart_city_commands enable row level security;
alter table smart_city_command_events enable row level security;
alter table smart_city_action_events enable row level security;

notify pgrst, 'reload schema';
