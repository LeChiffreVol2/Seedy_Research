create extension if not exists postgis;

create table if not exists smart_city_events (
  id            text primary key,
  source_id     text references smart_city_sources(id) on delete set null,
  event_type    text not null,
  severity      text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence    numeric(4,3) not null default 0.5,
  observed_at   timestamptz not null,
  expires_at    timestamptz,
  region        text not null default 'thailand',
  geometry      geometry(Point, 4326) not null,
  title         text not null,
  description   text not null,
  source_url    text,
  attributes    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists smart_city_hotspots (
  id                  text primary key,
  region              text not null default 'thailand',
  name                text not null,
  corridor            text not null default 'unknown',
  risk_score          integer not null check (risk_score >= 0 and risk_score <= 100),
  trend               text not null check (trend in ('rising', 'flat', 'falling')),
  severity            text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence          numeric(4,3) not null default 0.5,
  geometry            geometry(Point, 4326) not null,
  attributes          jsonb not null default '{}'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  recommended_action  text not null,
  source_object_ids   text[] not null default array[]::text[],
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

alter table smart_city_hotspots
add column if not exists attributes jsonb not null default '{}'::jsonb;

create table if not exists smart_city_objects (
  id            text primary key,
  object_type   text not null,
  display_name  text not null,
  source_id     text references smart_city_sources(id) on delete set null,
  region        text not null default 'thailand',
  geometry      geometry(Point, 4326) not null,
  severity      text check (severity in ('critical', 'high', 'medium', 'low')),
  confidence    numeric(4,3),
  observed_at   timestamptz,
  updated_at    timestamptz not null default now(),
  source_url    text,
  properties    jsonb not null default '{}'::jsonb,
  provenance    text[] not null default array[]::text[],
  created_at    timestamptz not null default now()
);

create table if not exists smart_city_links (
  id               text primary key,
  link_type        text not null,
  from_object_id   text not null references smart_city_objects(id) on delete cascade,
  to_object_id     text not null references smart_city_objects(id) on delete cascade,
  confidence       numeric(4,3) not null default 0.5,
  reason           text not null,
  distance_meters  integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists smart_city_insights (
  id                    text primary key,
  domain                text not null default 'transport',
  object_id             text references smart_city_objects(id) on delete cascade,
  object_type           text not null,
  title                 text not null,
  why_now               text not null,
  evidence              jsonb not null default '[]'::jsonb,
  recommended_action    text not null,
  next_verification_step text not null,
  severity              text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence            numeric(4,3) not null default 0.5,
  risk_before           integer not null check (risk_before >= 0 and risk_before <= 100),
  expected_risk_after   integer not null check (expected_risk_after >= 0 and expected_risk_after <= 100),
  delta                 integer not null,
  source_object_ids     text[] not null default array[]::text[],
  evidence_ids          text[] not null default array[]::text[],
  caveat                text not null,
  requires_research     boolean not null default true,
  generated_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists smart_city_research_runs (
  id              text primary key,
  mode            text not null,
  insight_id      text,
  object_ids      text[] not null default array[]::text[],
  workflow_trace  jsonb not null default '[]'::jsonb,
  map_commands    jsonb not null default '[]'::jsonb,
  limitations     text[] not null default array[]::text[],
  generated_at    timestamptz not null,
  created_at      timestamptz not null default now()
);

create table if not exists smart_city_research_evidence (
  id                  text primary key,
  run_id              text references smart_city_research_runs(id) on delete cascade,
  evidence_id         text not null,
  citation            text not null,
  source              text not null,
  section_title       text,
  evidence_strength   text not null check (evidence_strength in ('direct', 'indirect', 'context_only')),
  matched_terms       text[] not null default array[]::text[],
  object_ids          text[] not null default array[]::text[],
  action_implication  text,
  operator_check      text,
  created_at          timestamptz not null default now()
);

create index if not exists smart_city_events_geometry_gix on smart_city_events using gist (geometry);
create index if not exists smart_city_events_source_idx on smart_city_events (source_id);
create index if not exists smart_city_events_type_idx on smart_city_events (event_type);
create index if not exists smart_city_events_severity_idx on smart_city_events (severity);
create index if not exists smart_city_events_observed_idx on smart_city_events (observed_at desc);
create index if not exists smart_city_events_updated_idx on smart_city_events (updated_at desc);

create index if not exists smart_city_hotspots_geometry_gix on smart_city_hotspots using gist (geometry);
create index if not exists smart_city_hotspots_severity_idx on smart_city_hotspots (severity);
create index if not exists smart_city_hotspots_updated_idx on smart_city_hotspots (updated_at desc);

create index if not exists smart_city_objects_geometry_gix on smart_city_objects using gist (geometry);
create index if not exists smart_city_objects_source_idx on smart_city_objects (source_id);
create index if not exists smart_city_objects_type_idx on smart_city_objects (object_type);
create index if not exists smart_city_objects_severity_idx on smart_city_objects (severity);
create index if not exists smart_city_objects_observed_idx on smart_city_objects (observed_at desc);
create index if not exists smart_city_objects_updated_idx on smart_city_objects (updated_at desc);
create index if not exists smart_city_objects_provenance_gin on smart_city_objects using gin (provenance);

create index if not exists smart_city_links_from_idx on smart_city_links (from_object_id);
create index if not exists smart_city_links_to_idx on smart_city_links (to_object_id);
create index if not exists smart_city_links_type_idx on smart_city_links (link_type);

create index if not exists smart_city_insights_domain_idx on smart_city_insights (domain);
create index if not exists smart_city_insights_object_idx on smart_city_insights (object_id);
create index if not exists smart_city_insights_severity_idx on smart_city_insights (severity);
create index if not exists smart_city_insights_generated_idx on smart_city_insights (generated_at desc);
create index if not exists smart_city_insights_source_objects_gin on smart_city_insights using gin (source_object_ids);
create index if not exists smart_city_insights_evidence_gin on smart_city_insights using gin (evidence_ids);

create index if not exists smart_city_research_runs_insight_idx on smart_city_research_runs (insight_id);
create index if not exists smart_city_research_runs_generated_idx on smart_city_research_runs (generated_at desc);
create index if not exists smart_city_research_runs_object_ids_gin on smart_city_research_runs using gin (object_ids);
create index if not exists smart_city_research_evidence_run_idx on smart_city_research_evidence (run_id);
create index if not exists smart_city_research_evidence_evidence_idx on smart_city_research_evidence (evidence_id);

alter table smart_city_events enable row level security;
alter table smart_city_hotspots enable row level security;
alter table smart_city_objects enable row level security;
alter table smart_city_links enable row level security;
alter table smart_city_insights enable row level security;
alter table smart_city_research_runs enable row level security;
alter table smart_city_research_evidence enable row level security;

notify pgrst, 'reload schema';
