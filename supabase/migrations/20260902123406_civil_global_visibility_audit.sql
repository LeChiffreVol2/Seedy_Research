begin;

-- A visibility audit is a dated comparison against one external index. It is
-- neither a source-ingest run nor a permanent assertion that a work is absent.
create table if not exists public.civil_visibility_audit_runs (
  audit_run_id          uuid primary key default gen_random_uuid(),
  audit_key             text not null unique,
  provider              text not null,
  external_index        text not null,
  audit_snapshot_date   date not null,
  strategy              text not null,
  run_status            text not null default 'planned',
  method_version        text not null,
  config_hash           text not null,
  code_commit           text,
  cohort_filter         jsonb not null default '{}'::jsonb,
  denominator           bigint not null,
  resume_after_id       text,
  error_summary         text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (provider ~ '^[a-z0-9_:-]+$'),
  check (external_index in ('openalex')),
  check (strategy in ('identifiers', 'full')),
  check (run_status in ('planned', 'running', 'partial', 'complete', 'failed')),
  check (char_length(btrim(audit_key)) between 8 and 255),
  check (char_length(btrim(method_version)) between 3 and 100),
  check (config_hash ~ '^[0-9a-f]{64}$'),
  check (code_commit is null or code_commit ~ '^[0-9a-f]{7,64}$'),
  check (jsonb_typeof(cohort_filter) = 'object'),
  check (denominator >= 0),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (run_status <> 'failed' or nullif(btrim(coalesce(error_summary, '')), '') is not null)
);

create index if not exists civil_visibility_audit_runs_provider_date_idx
  on public.civil_visibility_audit_runs (provider, external_index, audit_snapshot_date desc, created_at desc);

-- One result per local provider record and audit run. Candidate and provider
-- failure states remain explicit so neither can inflate the not-found count.
create table if not exists public.civil_external_index_matches (
  match_id                  uuid primary key default gen_random_uuid(),
  audit_run_id              uuid not null references public.civil_visibility_audit_runs(audit_run_id) on delete cascade,
  source_catalog_id         text not null references public.civil_source_catalog(id) on delete cascade,
  work_id                   uuid references public.civil_works(work_id) on delete set null,
  provider                  text not null,
  external_index            text not null,
  visibility_state          text not null,
  match_basis               text not null,
  external_work_id          text,
  external_doi              text,
  external_title            text,
  external_year             integer,
  external_url              text,
  confidence                numeric(6,5),
  title_similarity          numeric(6,5),
  year_delta                integer,
  requires_human_review     boolean not null default false,
  metadata_gaps             jsonb not null default '[]'::jsonb,
  candidate_snapshot        jsonb not null default '{}'::jsonb,
  query_fingerprint         text not null,
  provider_error_code       text,
  provider_error_detail     text,
  checked_at                timestamptz not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (audit_run_id, source_catalog_id),
  check (provider ~ '^[a-z0-9_:-]+$'),
  check (external_index in ('openalex')),
  check (visibility_state in (
    'globally_indexed', 'under_indexed', 'candidate_match',
    'not_found_in_audit', 'audit_unavailable'
  )),
  check (match_basis in (
    'exact_doi', 'exact_title_year', 'title_author_year', 'fuzzy_title',
    'reviewed_identity', 'none', 'provider_unavailable'
  )),
  check (external_year is null or external_year between 1600 and 2200),
  check (confidence is null or confidence between 0 and 1),
  check (title_similarity is null or title_similarity between 0 and 1),
  check (year_delta is null or year_delta >= 0),
  check (jsonb_typeof(metadata_gaps) = 'array'),
  check (jsonb_typeof(candidate_snapshot) = 'object'),
  check (query_fingerprint ~ '^[0-9a-f]{64}$'),
  check (external_url is null or external_url ~ '^https://'),
  check (
    (visibility_state in ('globally_indexed', 'under_indexed')
      and external_work_id is not null
      and match_basis in ('exact_doi', 'reviewed_identity')
      and requires_human_review = false)
    or (visibility_state = 'candidate_match'
      and external_work_id is not null
      and match_basis in ('exact_title_year', 'title_author_year', 'fuzzy_title')
      and requires_human_review = true)
    or (visibility_state = 'not_found_in_audit'
      and external_work_id is null
      and match_basis = 'none'
      and requires_human_review = false)
    or (visibility_state = 'audit_unavailable'
      and external_work_id is null
      and match_basis = 'provider_unavailable'
      and requires_human_review = false
      and provider_error_code is not null)
  )
);

create index if not exists civil_external_index_matches_source_checked_idx
  on public.civil_external_index_matches (source_catalog_id, external_index, checked_at desc);
create index if not exists civil_external_index_matches_run_state_idx
  on public.civil_external_index_matches (audit_run_id, visibility_state);
create index if not exists civil_external_index_matches_external_work_idx
  on public.civil_external_index_matches (external_index, external_work_id)
  where external_work_id is not null;
create index if not exists civil_source_catalog_provider_record_lookup_idx
  on public.civil_source_catalog (provider_record_id);

-- Researcher decisions are suggestions. Only an explicit steward review may
-- become canonical, and this history is append-only at the application layer.
create table if not exists public.civil_visibility_review_decisions (
  decision_id             uuid primary key default gen_random_uuid(),
  match_id                uuid not null references public.civil_external_index_matches(match_id) on delete cascade,
  reviewer_user_id        uuid,
  reviewer_kind           text not null,
  decision                text not null,
  rationale               text not null,
  evidence                jsonb not null default '{}'::jsonb,
  supersedes_decision_id  uuid references public.civil_visibility_review_decisions(decision_id) on delete set null,
  created_at              timestamptz not null default now(),
  check (reviewer_kind in ('researcher_suggestion', 'institution_steward', 'seedy_operator')),
  check (decision in ('accept', 'reject')),
  check (char_length(btrim(rationale)) between 8 and 2000),
  check (jsonb_typeof(evidence) = 'object')
);

create index if not exists civil_visibility_review_match_created_idx
  on public.civil_visibility_review_decisions (match_id, created_at desc);
create index if not exists civil_visibility_review_user_created_idx
  on public.civil_visibility_review_decisions (reviewer_user_id, created_at desc)
  where reviewer_user_id is not null;

alter table public.civil_visibility_audit_runs enable row level security;
alter table public.civil_external_index_matches enable row level security;
alter table public.civil_visibility_review_decisions enable row level security;

revoke all on table public.civil_visibility_audit_runs from public, anon, authenticated;
revoke all on table public.civil_external_index_matches from public, anon, authenticated;
revoke all on table public.civil_visibility_review_decisions from public, anon, authenticated;
grant all on table public.civil_visibility_audit_runs to service_role;
grant all on table public.civil_external_index_matches to service_role;
grant all on table public.civil_visibility_review_decisions to service_role;

create or replace function public.civil_visibility_summary_v1(
  provider_name text default 'tci_thaijo',
  index_name text default 'openalex'
)
returns table (
  audit_run_id uuid,
  provider text,
  external_index text,
  audit_snapshot_date date,
  run_status text,
  strategy text,
  denominator bigint,
  attempted_count bigint,
  globally_indexed_count bigint,
  under_indexed_count bigint,
  candidate_count bigint,
  not_found_count bigint,
  unavailable_count bigint,
  method_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest_run as (
    select run.*
    from public.civil_visibility_audit_runs run
    where run.provider = provider_name
      and run.external_index = index_name
    order by run.audit_snapshot_date desc, run.created_at desc
    limit 1
  ), counts as (
    select
      match.audit_run_id,
      count(*)::bigint as attempted_count,
      count(*) filter (where match.visibility_state = 'globally_indexed')::bigint as globally_indexed_count,
      count(*) filter (where match.visibility_state = 'under_indexed')::bigint as under_indexed_count,
      count(*) filter (where match.visibility_state = 'candidate_match')::bigint as candidate_count,
      count(*) filter (where match.visibility_state = 'not_found_in_audit')::bigint as not_found_count,
      count(*) filter (where match.visibility_state = 'audit_unavailable')::bigint as unavailable_count
    from public.civil_external_index_matches match
    join latest_run run on run.audit_run_id = match.audit_run_id
    group by match.audit_run_id
  )
  select
    run.audit_run_id,
    run.provider,
    run.external_index,
    run.audit_snapshot_date,
    run.run_status,
    run.strategy,
    run.denominator,
    coalesce(counts.attempted_count, 0),
    coalesce(counts.globally_indexed_count, 0),
    coalesce(counts.under_indexed_count, 0),
    coalesce(counts.candidate_count, 0),
    coalesce(counts.not_found_count, 0),
    coalesce(counts.unavailable_count, 0),
    run.method_version
  from latest_run run
  left join counts on counts.audit_run_id = run.audit_run_id;
$$;

create or replace function public.civil_visibility_receipts_v1(
  source_identifiers text[],
  index_name text default 'openalex'
)
returns table (
  source text,
  source_catalog_id text,
  provider text,
  external_index text,
  visibility_state text,
  match_basis text,
  external_work_id text,
  external_url text,
  confidence numeric,
  requires_human_review boolean,
  metadata_gaps jsonb,
  checked_at timestamptz,
  audit_snapshot_date date,
  method_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select distinct left(btrim(value), 512) as source
    from unnest(coalesce(source_identifiers, array[]::text[])) as value
    where nullif(btrim(value), '') is not null
    limit 30
  ), resolved as (
    select requested.source, catalog.id as source_catalog_id, catalog.provider
    from requested
    cross join lateral (
      select candidate.id, candidate.provider
      from public.civil_source_catalog candidate
      where candidate.id = requested.source
         or candidate.provider_record_id = requested.source
         or lower(coalesce(candidate.doi, '')) = lower(regexp_replace(requested.source, '^(doi:|https?://(dx\\.)?doi\\.org/)', '', 'i'))
      order by
        case
          when candidate.id = requested.source then 0
          when candidate.provider_record_id = requested.source then 1
          else 2
        end,
        candidate.id
      limit 1
    ) catalog
  )
  select
    resolved.source,
    resolved.source_catalog_id,
    resolved.provider,
    match.external_index,
    match.visibility_state,
    match.match_basis,
    match.external_work_id,
    match.external_url,
    match.confidence,
    match.requires_human_review,
    match.metadata_gaps,
    match.checked_at,
    run.audit_snapshot_date,
    run.method_version
  from resolved
  cross join lateral (
    select candidate.*
    from public.civil_external_index_matches candidate
    where candidate.source_catalog_id = resolved.source_catalog_id
      and candidate.external_index = index_name
    order by candidate.checked_at desc, candidate.created_at desc
    limit 1
  ) match
  join public.civil_visibility_audit_runs run on run.audit_run_id = match.audit_run_id;
$$;

create or replace function public.civil_visibility_receipt_v1(
  source_identifier text,
  index_name text default 'openalex'
)
returns table (
  source text,
  source_catalog_id text,
  provider text,
  external_index text,
  visibility_state text,
  match_basis text,
  external_work_id text,
  external_url text,
  confidence numeric,
  requires_human_review boolean,
  metadata_gaps jsonb,
  checked_at timestamptz,
  audit_snapshot_date date,
  method_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.civil_visibility_receipts_v1(array[source_identifier], index_name);
$$;

comment on table public.civil_visibility_audit_runs is
  'Dated, resumable external-index comparisons with an explicit bounded denominator.';
comment on table public.civil_external_index_matches is
  'Work-level visibility receipts; candidate and unavailable states never count as not found.';
comment on table public.civil_visibility_review_decisions is
  'Append-only researcher suggestions and steward decisions for unresolved identity candidates.';
comment on function public.civil_visibility_summary_v1(text, text) is
  'Latest dated provider audit summary; unavailable records remain outside the audited denominator.';
comment on function public.civil_visibility_receipts_v1(text[], text) is
  'Bounded service-only visibility receipts for up to 30 visible research records.';

revoke all on function public.civil_visibility_summary_v1(text, text) from public, anon, authenticated;
revoke all on function public.civil_visibility_receipts_v1(text[], text) from public, anon, authenticated;
revoke all on function public.civil_visibility_receipt_v1(text, text) from public, anon, authenticated;
grant execute on function public.civil_visibility_summary_v1(text, text) to service_role;
grant execute on function public.civil_visibility_receipts_v1(text[], text) to service_role;
grant execute on function public.civil_visibility_receipt_v1(text, text) to service_role;

notify pgrst, 'reload schema';

commit;
