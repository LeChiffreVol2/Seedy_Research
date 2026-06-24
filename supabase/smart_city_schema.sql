create extension if not exists postgis;

create table if not exists smart_city_sources (
  id              text primary key,
  name            text not null,
  provider        text not null,
  category        text not null,
  region          text not null default 'thailand',
  source_url      text,
  refresh_seconds integer not null default 300,
  is_enabled      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists smart_city_source_health (
  source_id          text primary key references smart_city_sources(id) on delete cascade,
  status             text not null check (status in ('ok', 'degraded', 'stale', 'needs_config', 'offline')),
  last_success_at    timestamptz,
  last_attempt_at    timestamptz,
  latency_ms         integer,
  record_count       integer not null default 0,
  freshness_seconds  integer,
  message            text,
  updated_at         timestamptz not null default now()
);

create table if not exists smart_city_assets (
  id          text primary key,
  source_id   text references smart_city_sources(id) on delete set null,
  asset_type  text not null,
  name        text not null,
  region      text not null default 'bangkok',
  geometry    geometry(Geometry, 4326) not null,
  attributes  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists smart_city_events (
  id           text primary key,
  source_id    text references smart_city_sources(id) on delete set null,
  event_type   text not null,
  severity     text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence   numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  observed_at  timestamptz not null,
  expires_at   timestamptz,
  region       text not null default 'bangkok',
  geometry     geometry(Geometry, 4326) not null,
  title        text not null,
  description  text,
  source_url   text,
  attributes   jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists smart_city_hotspots (
  id             text primary key,
  region         text not null default 'bangkok',
  name           text not null,
  corridor       text,
  risk_score     numeric(5,2) not null check (risk_score >= 0 and risk_score <= 100),
  trend          text not null check (trend in ('rising', 'flat', 'falling')),
  severity       text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence     numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  geometry       geometry(Point, 4326) not null,
  evidence       jsonb not null default '[]'::jsonb,
  recommended_action text,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists smart_city_assets_geometry_gix
on smart_city_assets using gist (geometry);

create index if not exists smart_city_events_geometry_gix
on smart_city_events using gist (geometry);

create index if not exists smart_city_events_observed_at_idx
on smart_city_events (observed_at desc);

create index if not exists smart_city_hotspots_geometry_gix
on smart_city_hotspots using gist (geometry);

create index if not exists smart_city_hotspots_risk_idx
on smart_city_hotspots (risk_score desc);

create table if not exists smart_city_objects (
  id           text primary key,
  object_type  text not null check (object_type in ('rail_crossing', 'road_segment', 'intersection', 'camera', 'weather_station', 'incident', 'hotspot')),
  source_id    text references smart_city_sources(id) on delete set null,
  display_name text not null,
  region       text not null default 'thailand',
  geometry     geometry(Geometry, 4326) not null,
  severity     text check (severity in ('critical', 'high', 'medium', 'low')),
  confidence   numeric(4,3) check (confidence >= 0 and confidence <= 1),
  observed_at  timestamptz,
  source_url   text,
  properties   jsonb not null default '{}'::jsonb,
  provenance   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists smart_city_object_links (
  id              text primary key,
  link_type       text not null check (link_type in ('incident_near_asset', 'camera_observes_crossing', 'hotspot_contains_event', 'research_supports_action')),
  from_object_id  text not null references smart_city_objects(id) on delete cascade,
  to_object_id    text not null references smart_city_objects(id) on delete cascade,
  confidence      numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  distance_meters numeric,
  reason          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists smart_city_insights (
  id                  text primary key,
  domain              text not null default 'transport',
  object_id           text not null references smart_city_objects(id) on delete cascade,
  title               text not null,
  why_now             text not null,
  evidence            jsonb not null default '[]'::jsonb,
  recommended_action  text not null,
  next_verification_step text not null,
  severity            text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence          numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  risk_before         numeric(5,2) not null check (risk_before >= 0 and risk_before <= 100),
  expected_risk_after numeric(5,2) not null check (expected_risk_after >= 0 and expected_risk_after <= 100),
  delta               numeric(5,2) not null,
  source_object_ids   text[] not null default '{}',
  evidence_ids        text[] not null default '{}',
  caveat              text not null,
  requires_research   boolean not null default true,
  generated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists smart_city_action_drafts (
  id                  text primary key,
  action_type         text not null check (action_type in ('verify_camera', 'audit_signal', 'queue_control_review', 'dispatch_field_check', 'monitor_watchlist')),
  title               text not null,
  actor               text not null,
  source_object_ids   text[] not null,
  evidence_ids        text[] not null,
  risk_before         numeric(5,2) not null check (risk_before >= 0 and risk_before <= 100),
  expected_risk_after numeric(5,2) not null check (expected_risk_after >= 0 and expected_risk_after <= 100),
  status              text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  execution_scope     text not null default 'local_ops_draft' check (execution_scope = 'local_ops_draft'),
  limitations         jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists smart_city_action_records (
  id                  text primary key,
  action_type         text not null check (action_type in ('verify_camera', 'audit_signal', 'queue_control_review', 'dispatch_field_check', 'monitor_watchlist')),
  title               text not null,
  actor               text not null,
  source_object_ids   text[] not null,
  evidence_ids        text[] not null,
  risk_before         numeric(5,2) not null check (risk_before >= 0 and risk_before <= 100),
  expected_risk_after numeric(5,2) not null check (expected_risk_after >= 0 and expected_risk_after <= 100),
  status              text not null default 'recorded' check (status in ('recorded', 'approved', 'cancelled')),
  execution_scope     text not null default 'controlled_action_record' check (execution_scope = 'controlled_action_record'),
  limitations         jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.smart_city_action_drafts') is not null then
    insert into smart_city_action_records (
      id,
      action_type,
      title,
      actor,
      source_object_ids,
      evidence_ids,
      risk_before,
      expected_risk_after,
      status,
      execution_scope,
      limitations,
      created_at,
      updated_at
    )
    select
      id,
      action_type,
      title,
      actor,
      source_object_ids,
      evidence_ids,
      risk_before,
      expected_risk_after,
      case when status = 'draft' then 'recorded' else status end,
      'controlled_action_record',
      limitations,
      created_at,
      updated_at
    from smart_city_action_drafts
    on conflict (id) do nothing;
  end if;
end $$;

create index if not exists smart_city_objects_geometry_gix
on smart_city_objects using gist (geometry);

create index if not exists smart_city_objects_type_idx
on smart_city_objects (object_type);

create index if not exists smart_city_objects_type_observed_idx
on smart_city_objects (object_type, observed_at desc);

create index if not exists smart_city_objects_source_idx
on smart_city_objects (source_id);

create index if not exists smart_city_objects_severity_idx
on smart_city_objects (severity);

create index if not exists smart_city_object_links_from_idx
on smart_city_object_links (from_object_id);

create index if not exists smart_city_object_links_to_idx
on smart_city_object_links (to_object_id);

create index if not exists smart_city_object_links_type_idx
on smart_city_object_links (link_type);

create index if not exists smart_city_insights_domain_idx
on smart_city_insights (domain);

create index if not exists smart_city_insights_object_idx
on smart_city_insights (object_id);

create index if not exists smart_city_insights_severity_idx
on smart_city_insights (severity);

create index if not exists smart_city_insights_generated_idx
on smart_city_insights (generated_at desc);

create index if not exists smart_city_action_drafts_source_objects_gin
on smart_city_action_drafts using gin (source_object_ids);

create index if not exists smart_city_action_drafts_evidence_gin
on smart_city_action_drafts using gin (evidence_ids);

create index if not exists smart_city_action_drafts_status_idx
on smart_city_action_drafts (status);

create index if not exists smart_city_action_drafts_created_idx
on smart_city_action_drafts (created_at desc);

create index if not exists smart_city_action_records_source_objects_gin
on smart_city_action_records using gin (source_object_ids);

create index if not exists smart_city_action_records_evidence_gin
on smart_city_action_records using gin (evidence_ids);

create index if not exists smart_city_action_records_status_idx
on smart_city_action_records (status);

create index if not exists smart_city_action_records_created_idx
on smart_city_action_records (created_at desc);

alter table smart_city_action_records enable row level security;

insert into smart_city_sources (id, name, provider, category, region, source_url, refresh_seconds)
values
  ('bma-traffic', 'Bangkok traffic and transport references', 'Bangkok Metropolitan Administration', 'traffic', 'bangkok', 'https://traffic.bangkok.go.th/AboutUS/dev.html', 300),
  ('doh-travel', 'DOH to Travel road signals', 'Department of Highways', 'road_status', 'thailand', 'https://www.thailand.go.th/public/issue-focus-detail/001_08_028', 300),
  ('itic-open-data', 'iTIC historical traffic and incident data', 'iTIC Foundation', 'incident_archive', 'thailand', 'https://itic.longdo.com/data/', 3600),
  ('data-goth-traffic', 'Open Government traffic datasets', 'Open Government Data of Thailand', 'open_data', 'thailand', 'https://www.data.go.th/th/dataset/index-traffic', 86400)
on conflict (id) do update
set name = excluded.name,
    provider = excluded.provider,
    category = excluded.category,
    region = excluded.region,
    source_url = excluded.source_url,
    refresh_seconds = excluded.refresh_seconds,
    updated_at = now();

notify pgrst, 'reload schema';
