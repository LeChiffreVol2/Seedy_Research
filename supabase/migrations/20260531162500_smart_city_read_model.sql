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
  data_class      text,
  refresh_policy  text,
  upstream_cadence text,
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
  data_class         text,
  refresh_policy     text,
  last_modified      timestamptz,
  upstream_cadence   text,
  updated_at         timestamptz not null default now()
);

create table if not exists smart_city_assets (
  id          text primary key,
  source_id   text references smart_city_sources(id) on delete set null,
  asset_type  text not null,
  name        text not null,
  region      text not null default 'thailand',
  geometry    geometry(Geometry, 4326) not null,
  attributes  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists smart_city_assets_geometry_gix
on smart_city_assets using gist (geometry);

create index if not exists smart_city_assets_type_idx
on smart_city_assets (asset_type);

create index if not exists smart_city_assets_source_idx
on smart_city_assets (source_id);
