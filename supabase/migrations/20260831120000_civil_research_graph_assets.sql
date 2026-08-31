begin;

-- Canonical research identity is separate from provider records. One work may
-- have ThaiJO, TCI, TNRR, TDC, conference, DOI, and global-index records without
-- being counted as several papers. This migration intentionally performs no
-- backfill; reconciliation must attach source records only after identity review.
create table if not exists public.civil_works (
  work_id                 uuid primary key default gen_random_uuid(),
  canonical_key           text not null unique,
  work_type               text not null default 'journal_article',
  title_local             text,
  title_en                text,
  doi_normalized          text,
  publication_year        integer,
  primary_language        text,
  identity_strategy       text not null,
  identity_evidence       jsonb not null default '{}'::jsonb,
  canonical_metadata      jsonb not null default '{}'::jsonb,
  work_status             text not null default 'active',
  merged_into_work_id     uuid references public.civil_works(work_id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (char_length(btrim(canonical_key)) between 3 and 512),
  check (work_type in (
    'journal_article', 'conference_paper', 'thesis', 'dissertation',
    'research_report', 'preprint', 'book_chapter', 'dataset', 'other'
  )),
  check (
    nullif(btrim(coalesce(title_local, '')), '') is not null
    or nullif(btrim(coalesce(title_en, '')), '') is not null
  ),
  check (
    doi_normalized is null
    or (
      doi_normalized = lower(btrim(doi_normalized))
      and doi_normalized like '10.%/%'
      and doi_normalized !~ '^https?://'
      and char_length(doi_normalized) <= 255
    )
  ),
  check (publication_year is null or publication_year between 1600 and 2200),
  check (primary_language is null or primary_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  check (identity_strategy in ('doi', 'provider_identifier', 'title_author_year', 'curated_merge')),
  check (jsonb_typeof(identity_evidence) = 'object' and identity_evidence <> '{}'::jsonb),
  check (jsonb_typeof(canonical_metadata) = 'object'),
  check (work_status in ('active', 'merged', 'retracted', 'removed')),
  check (
    (work_status = 'merged' and merged_into_work_id is not null)
    or (work_status <> 'merged' and merged_into_work_id is null)
  ),
  check (merged_into_work_id is null or merged_into_work_id <> work_id)
);

create unique index if not exists civil_works_doi_uq
  on public.civil_works (doi_normalized)
  where doi_normalized is not null;

create index if not exists civil_works_type_year_idx
  on public.civil_works (work_type, publication_year desc nulls last);

create index if not exists civil_works_status_updated_idx
  on public.civil_works (work_status, updated_at desc);

comment on table public.civil_works is
  'Canonical deduplicated research works. Provider records and legal asset manifestations attach to this identity.';
comment on column public.civil_works.identity_evidence is
  'Auditable evidence for the canonical identity decision; never infer a merge from title similarity alone.';

-- Additive and nullable by design: existing discovery/evidence records remain
-- valid until a reconciliation job has made a defensible canonical match.
alter table public.civil_source_catalog
  add column if not exists work_id uuid;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'civil_source_catalog_work_id_fk'
      and conrelid = 'public.civil_source_catalog'::regclass
  ) then
    alter table public.civil_source_catalog
      add constraint civil_source_catalog_work_id_fk
      foreign key (work_id)
      references public.civil_works(work_id)
      on delete set null;
  end if;
end
$migration$;

create index if not exists civil_source_catalog_work_id_idx
  on public.civil_source_catalog (work_id)
  where work_id is not null;

comment on column public.civil_source_catalog.work_id is
  'Nullable canonical-work link assigned only by an auditable reconciliation process.';

-- Historical endpoint observations make "complete Thai coverage" measurable.
-- They record what was checked, when, and with which cursor/status; they do not
-- turn endpoint capability into article-level content rights.
create table if not exists public.civil_source_endpoint_coverage (
  coverage_id             uuid primary key default gen_random_uuid(),
  provider                text not null,
  source_family           text not null,
  endpoint_key            text not null,
  endpoint_url            text,
  protocol                text not null,
  set_spec                text,
  observation_kind        text not null default 'inventory',
  coverage_status         text not null,
  completeness_status     text not null default 'unknown',
  fulltext_access_mode    text not null default 'metadata_only',
  coverage_scope          jsonb not null default '{}'::jsonb,
  capability_manifest     jsonb not null default '{
    "metadata_harvest": false,
    "abstract_storage": false,
    "fulltext_link_discovery": false,
    "fulltext_download": false,
    "partner_delivery": false
  }'::jsonb,
  capability_provenance   jsonb not null default '{}'::jsonb,
  capability_checked_at   timestamptz,
  ingest_run_id           uuid references public.civil_ingest_runs(id) on delete set null,
  harvest_cursor          text,
  records_seen            bigint not null default 0,
  records_active          bigint not null default 0,
  records_deleted         bigint not null default 0,
  records_with_doi        bigint not null default 0,
  records_with_fulltext_link bigint not null default 0,
  records_rights_verified bigint not null default 0,
  coverage_started_at     timestamptz,
  coverage_ended_at       timestamptz,
  observed_at             timestamptz not null default now(),
  error_detail            text,
  created_at              timestamptz not null default now(),
  check (provider ~ '^[a-z0-9_:-]+$'),
  check (source_family ~ '^[a-z0-9_:-]+$'),
  check (char_length(btrim(endpoint_key)) between 1 and 255),
  check (endpoint_url is null or endpoint_url ~ '^https?://'),
  check (protocol in (
    'oai_pmh', 'rest_api', 'z3950', 'web_service', 'partner_export',
    'manual_deposit', 'web_page', 'other'
  )),
  check (observation_kind in ('inventory', 'harvest', 'reconciliation', 'rights_review')),
  check (coverage_status in (
    'planned', 'probing', 'active', 'partial', 'blocked',
    'permission_required', 'failed', 'retired'
  )),
  check (completeness_status in (
    'unknown', 'sample', 'partial', 'provider_declared_complete', 'reconciled_complete'
  )),
  check (fulltext_access_mode in (
    'metadata_only', 'per_record_rights', 'authenticated_member',
    'partner_delivery', 'unavailable'
  )),
  check (jsonb_typeof(coverage_scope) = 'object'),
  check (
    jsonb_typeof(capability_manifest) = 'object'
    and capability_manifest - array[
      'metadata_harvest', 'abstract_storage', 'fulltext_link_discovery',
      'fulltext_download', 'partner_delivery'
    ] = '{}'::jsonb
    and capability_manifest ?& array[
      'metadata_harvest', 'abstract_storage', 'fulltext_link_discovery',
      'fulltext_download', 'partner_delivery'
    ]
    and jsonb_typeof(capability_manifest -> 'metadata_harvest') = 'boolean'
    and jsonb_typeof(capability_manifest -> 'abstract_storage') = 'boolean'
    and jsonb_typeof(capability_manifest -> 'fulltext_link_discovery') = 'boolean'
    and jsonb_typeof(capability_manifest -> 'fulltext_download') = 'boolean'
    and jsonb_typeof(capability_manifest -> 'partner_delivery') = 'boolean'
  ),
  check (jsonb_typeof(capability_provenance) = 'object'),
  check (
    capability_manifest = '{
      "metadata_harvest": false,
      "abstract_storage": false,
      "fulltext_link_discovery": false,
      "fulltext_download": false,
      "partner_delivery": false
    }'::jsonb
    or (
      capability_checked_at is not null
      and capability_provenance <> '{}'::jsonb
      and capability_provenance ? 'basis'
      and capability_provenance ? 'source'
    )
  ),
  check (
    records_seen >= 0
    and records_active >= 0
    and records_deleted >= 0
    and records_with_doi >= 0
    and records_with_fulltext_link >= 0
    and records_rights_verified >= 0
  ),
  check (
    coverage_started_at is null
    or coverage_ended_at is null
    or coverage_ended_at >= coverage_started_at
  ),
  check (
    coverage_status not in ('blocked', 'permission_required', 'failed')
    or nullif(btrim(coalesce(error_detail, '')), '') is not null
  )
);

create index if not exists civil_source_endpoint_coverage_provider_idx
  on public.civil_source_endpoint_coverage (provider, endpoint_key, observed_at desc);

create index if not exists civil_source_endpoint_coverage_status_idx
  on public.civil_source_endpoint_coverage (coverage_status, observed_at desc);

create index if not exists civil_source_endpoint_coverage_run_idx
  on public.civil_source_endpoint_coverage (ingest_run_id)
  where ingest_run_id is not null;

comment on table public.civil_source_endpoint_coverage is
  'Append-oriented endpoint coverage observations. Completeness is an evidence-backed status, never inferred from record volume.';
comment on column public.civil_source_endpoint_coverage.capability_manifest is
  'Endpoint transport capabilities only; per-asset storage, processing, and display rights remain default-deny in civil_work_assets.';

-- A work may have several manifestations. Rights are attached to each asset,
-- not inherited from its provider, journal, work, URL, or license-looking text.
create table if not exists public.civil_work_assets (
  asset_id                uuid primary key default gen_random_uuid(),
  work_id                 uuid not null references public.civil_works(work_id) on delete cascade,
  source_catalog_id       text references public.civil_source_catalog(id) on delete set null,
  provider                text not null,
  provider_asset_id       text not null,
  asset_kind              text not null,
  version_kind            text not null default 'unknown',
  origin_url              text,
  storage_bucket          text,
  storage_object_path     text,
  mime_type               text,
  language                text,
  content_sha256          text,
  byte_size               bigint,
  page_count              integer,
  license_expression      text,
  rights_status           text not null default 'unverified',
  rights_actions          jsonb not null default '{
    "metadata_indexing": false,
    "source_download": false,
    "asset_storage": false,
    "text_extraction": false,
    "native_fulltext_display": false,
    "publisher_embedding": false,
    "user_download": false,
    "snippet_display": false,
    "embedding": false,
    "summarization": false,
    "translation": false,
    "annotation": false,
    "redistribution": false,
    "commercial_use": false,
    "model_training": false
  }'::jsonb,
  rights_provenance       jsonb not null default '{}'::jsonb,
  rights_checked_at       timestamptz,
  rights_verified_at      timestamptz,
  reader_access_mode      text not null default 'metadata_only',
  access_notes            text,
  asset_status            text not null default 'active',
  source_updated_at       timestamptz,
  last_verified_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (provider, provider_asset_id),
  unique (work_id, asset_id),
  check (provider ~ '^[a-z0-9_:-]+$'),
  check (char_length(btrim(provider_asset_id)) between 1 and 1024),
  check (asset_kind in (
    'publisher_landing', 'metadata_record', 'abstract_html', 'fulltext_html',
    'fulltext_pdf', 'accepted_manuscript', 'preprint', 'supplementary_file',
    'dataset', 'code', 'other'
  )),
  check (version_kind in (
    'version_of_record', 'accepted_manuscript', 'submitted_manuscript',
    'preprint', 'thesis', 'proceedings', 'supplement', 'unknown'
  )),
  check (origin_url is null or origin_url ~ '^https?://'),
  check (
    (storage_bucket is null and storage_object_path is null)
    or (
      nullif(btrim(coalesce(storage_bucket, '')), '') is not null
      and nullif(btrim(coalesce(storage_object_path, '')), '') is not null
      and position('..' in storage_object_path) = 0
    )
  ),
  check (language is null or language ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  check (byte_size is null or byte_size >= 0),
  check (page_count is null or page_count between 1 and 100000),
  check (rights_status in (
    'unverified', 'open_license_verified', 'permission_granted',
    'restricted_verified', 'withdrawn'
  )),
  check (
    jsonb_typeof(rights_actions) = 'object'
    and rights_actions - array[
      'metadata_indexing', 'source_download', 'asset_storage',
      'text_extraction', 'native_fulltext_display', 'publisher_embedding',
      'user_download', 'snippet_display', 'embedding', 'summarization',
      'translation', 'annotation', 'redistribution', 'commercial_use',
      'model_training'
    ] = '{}'::jsonb
    and rights_actions ?& array[
      'metadata_indexing', 'source_download', 'asset_storage',
      'text_extraction', 'native_fulltext_display', 'publisher_embedding',
      'user_download', 'snippet_display', 'embedding', 'summarization',
      'translation', 'annotation', 'redistribution', 'commercial_use',
      'model_training'
    ]
    and jsonb_typeof(rights_actions -> 'metadata_indexing') = 'boolean'
    and jsonb_typeof(rights_actions -> 'source_download') = 'boolean'
    and jsonb_typeof(rights_actions -> 'asset_storage') = 'boolean'
    and jsonb_typeof(rights_actions -> 'text_extraction') = 'boolean'
    and jsonb_typeof(rights_actions -> 'native_fulltext_display') = 'boolean'
    and jsonb_typeof(rights_actions -> 'publisher_embedding') = 'boolean'
    and jsonb_typeof(rights_actions -> 'user_download') = 'boolean'
    and jsonb_typeof(rights_actions -> 'snippet_display') = 'boolean'
    and jsonb_typeof(rights_actions -> 'embedding') = 'boolean'
    and jsonb_typeof(rights_actions -> 'summarization') = 'boolean'
    and jsonb_typeof(rights_actions -> 'translation') = 'boolean'
    and jsonb_typeof(rights_actions -> 'annotation') = 'boolean'
    and jsonb_typeof(rights_actions -> 'redistribution') = 'boolean'
    and jsonb_typeof(rights_actions -> 'commercial_use') = 'boolean'
    and jsonb_typeof(rights_actions -> 'model_training') = 'boolean'
  ),
  check (jsonb_typeof(rights_provenance) = 'object'),
  check (
    rights_actions = '{
      "metadata_indexing": false,
      "source_download": false,
      "asset_storage": false,
      "text_extraction": false,
      "native_fulltext_display": false,
      "publisher_embedding": false,
      "user_download": false,
      "snippet_display": false,
      "embedding": false,
      "summarization": false,
      "translation": false,
      "annotation": false,
      "redistribution": false,
      "commercial_use": false,
      "model_training": false
    }'::jsonb
    or (
      rights_status in (
        'open_license_verified', 'permission_granted', 'restricted_verified'
      )
      and rights_checked_at is not null
      and rights_verified_at is not null
      and rights_verified_at >= rights_checked_at
      and rights_provenance <> '{}'::jsonb
      and rights_provenance ? 'basis'
      and rights_provenance ? 'source'
    )
  ),
  check (
    rights_status = 'unverified'
    or (
      rights_checked_at is not null
      and rights_verified_at is not null
      and rights_verified_at >= rights_checked_at
      and rights_provenance <> '{}'::jsonb
      and rights_provenance ? 'basis'
      and rights_provenance ? 'source'
    )
  ),
  check (
    not (
      (rights_actions ->> 'source_download')::boolean
      or (rights_actions ->> 'asset_storage')::boolean
      or (rights_actions ->> 'text_extraction')::boolean
      or (rights_actions ->> 'native_fulltext_display')::boolean
      or (rights_actions ->> 'publisher_embedding')::boolean
      or (rights_actions ->> 'user_download')::boolean
      or (rights_actions ->> 'snippet_display')::boolean
      or (rights_actions ->> 'embedding')::boolean
      or (rights_actions ->> 'summarization')::boolean
      or (rights_actions ->> 'translation')::boolean
      or (rights_actions ->> 'annotation')::boolean
      or (rights_actions ->> 'redistribution')::boolean
      or (rights_actions ->> 'commercial_use')::boolean
      or (rights_actions ->> 'model_training')::boolean
    )
    or rights_status in ('open_license_verified', 'permission_granted')
  ),
  check (
    storage_object_path is null
    or (
      content_sha256 is not null
      and (rights_actions ->> 'asset_storage')::boolean
      and rights_status in ('open_license_verified', 'permission_granted')
    )
  ),
  check (reader_access_mode in (
    'metadata_only', 'external_access', 'publisher_embed',
    'native_verified', 'restricted', 'removed'
  )),
  check (
    reader_access_mode <> 'external_access'
    or origin_url is not null
  ),
  check (
    reader_access_mode <> 'publisher_embed'
    or (
      origin_url is not null
      and (rights_actions ->> 'publisher_embedding')::boolean
      and rights_status in ('open_license_verified', 'permission_granted')
      and rights_verified_at is not null
      and rights_provenance <> '{}'::jsonb
    )
  ),
  check (
    reader_access_mode <> 'native_verified'
    or (
      asset_kind in ('fulltext_html', 'fulltext_pdf', 'accepted_manuscript', 'preprint')
      and (origin_url is not null or storage_object_path is not null)
      and (rights_actions ->> 'asset_storage')::boolean
      and (rights_actions ->> 'native_fulltext_display')::boolean
      and rights_status in ('open_license_verified', 'permission_granted')
      and rights_checked_at is not null
      and rights_verified_at is not null
      and rights_provenance <> '{}'::jsonb
      and rights_provenance ? 'basis'
      and rights_provenance ? 'source'
    )
  ),
  check (
    reader_access_mode <> 'restricted'
    or rights_status = 'restricted_verified'
  ),
  check (
    (asset_status = 'removed' and reader_access_mode = 'removed')
    or (asset_status <> 'removed' and reader_access_mode <> 'removed')
  ),
  check (
    rights_status <> 'withdrawn'
    or (asset_status = 'removed' and reader_access_mode = 'removed')
  ),
  check (
    asset_status = 'active'
    or rights_actions = '{
      "metadata_indexing": false,
      "source_download": false,
      "asset_storage": false,
      "text_extraction": false,
      "native_fulltext_display": false,
      "publisher_embedding": false,
      "user_download": false,
      "snippet_display": false,
      "embedding": false,
      "summarization": false,
      "translation": false,
      "annotation": false,
      "redistribution": false,
      "commercial_use": false,
      "model_training": false
    }'::jsonb
  ),
  check (asset_status in ('active', 'unavailable', 'removed'))
);

create index if not exists civil_work_assets_work_idx
  on public.civil_work_assets (work_id, asset_status, reader_access_mode);

create index if not exists civil_work_assets_source_catalog_idx
  on public.civil_work_assets (source_catalog_id)
  where source_catalog_id is not null;

create index if not exists civil_work_assets_reader_idx
  on public.civil_work_assets (reader_access_mode, rights_status, updated_at desc);

create index if not exists civil_work_assets_content_sha_idx
  on public.civil_work_assets (content_sha256)
  where content_sha256 is not null;

comment on table public.civil_work_assets is
  'Rights-gated manifestations of canonical works. Every processing and display action is explicit and defaults to false.';
comment on column public.civil_work_assets.reader_access_mode is
  'UI access contract. native_verified and publisher_embed fail closed unless the corresponding asset-level right is verified.';
comment on column public.civil_work_assets.rights_provenance is
  'Machine-readable evidence with required basis and source fields for every non-default right.';

-- Faithful page text is a source artifact, not a summary or translation. It is
-- private to service-side evidence workflows and is never granted to Data API
-- roles. A trigger below refuses storage unless the asset explicitly authorizes
-- both storage and extraction with verified provenance.
create table if not exists public.civil_fulltext_pages (
  page_id                 uuid primary key default gen_random_uuid(),
  asset_id                uuid not null references public.civil_work_assets(asset_id) on delete cascade,
  page_number             integer not null,
  page_label              text,
  text_role               text not null default 'faithful_page_extraction',
  source_text             text not null,
  source_text_sha256      text not null,
  source_locator          jsonb not null default '{}'::jsonb,
  extraction_provenance   jsonb not null,
  bbox_map                jsonb,
  ocr_confidence          numeric(5,4),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (asset_id, page_number),
  unique (asset_id, page_id),
  check (page_number between 1 and 100000),
  check (page_label is null or char_length(page_label) <= 100),
  check (text_role = 'faithful_page_extraction'),
  check (char_length(source_text) between 1 and 2000000),
  check (source_text_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(source_locator) = 'object' and source_locator <> '{}'::jsonb),
  check (
    jsonb_typeof(extraction_provenance) = 'object'
    and extraction_provenance <> '{}'::jsonb
    and extraction_provenance ? 'method'
    and extraction_provenance ? 'source_asset_sha256'
  ),
  check (bbox_map is null or jsonb_typeof(bbox_map) in ('array', 'object')),
  check (ocr_confidence is null or ocr_confidence between 0 and 1)
);

create index if not exists civil_fulltext_pages_asset_page_idx
  on public.civil_fulltext_pages (asset_id, page_number);

create index if not exists civil_fulltext_pages_source_sha_idx
  on public.civil_fulltext_pages (source_text_sha256);

comment on table public.civil_fulltext_pages is
  'Faithful, page-addressable source text. No translated, summarized, or model-generated text belongs in this table.';
comment on column public.civil_fulltext_pages.source_text_sha256 is
  'SHA-256 of the exact stored page text for integrity and annotation-anchor drift detection.';

create or replace function public.civil_assert_fulltext_page_asset_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_asset public.civil_work_assets%rowtype;
begin
  select *
  into v_asset
  from public.civil_work_assets
  where asset_id = new.asset_id
  for key share;

  if not found then
    raise exception 'full-text asset not found';
  end if;

  if v_asset.asset_status <> 'active'
     or v_asset.asset_kind not in (
       'fulltext_html', 'fulltext_pdf', 'accepted_manuscript', 'preprint'
     )
     or v_asset.rights_status not in ('open_license_verified', 'permission_granted')
     or v_asset.rights_verified_at is null
     or v_asset.rights_provenance = '{}'::jsonb
     or not (v_asset.rights_actions ->> 'asset_storage')::boolean
     or not (v_asset.rights_actions ->> 'text_extraction')::boolean then
    raise exception 'full-text page storage is not authorized for asset %', new.asset_id;
  end if;

  if v_asset.content_sha256 is null
     or new.extraction_provenance ->> 'source_asset_sha256' <> v_asset.content_sha256 then
    raise exception 'full-text page provenance does not match asset checksum';
  end if;

  return new;
end;
$$;

drop trigger if exists civil_fulltext_pages_asset_rights_guard
  on public.civil_fulltext_pages;
create trigger civil_fulltext_pages_asset_rights_guard
before insert or update
on public.civil_fulltext_pages
for each row
execute function public.civil_assert_fulltext_page_asset_v1();

create or replace function public.civil_assert_asset_retained_pages_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.civil_fulltext_pages page
    where page.asset_id = old.asset_id
  ) and (
    new.asset_status <> 'active'
    or new.rights_status not in ('open_license_verified', 'permission_granted')
    or new.rights_verified_at is null
    or new.rights_provenance = '{}'::jsonb
    or not (new.rights_actions ->> 'asset_storage')::boolean
    or not (new.rights_actions ->> 'text_extraction')::boolean
    or new.content_sha256 is distinct from old.content_sha256
  ) then
    raise exception 'delete retained pages before revoking, removing, or replacing asset %', old.asset_id;
  end if;

  return new;
end;
$$;

drop trigger if exists civil_work_assets_retained_pages_guard
  on public.civil_work_assets;
create trigger civil_work_assets_retained_pages_guard
before update of asset_kind, asset_status, rights_status, rights_actions,
  rights_provenance, rights_checked_at, rights_verified_at, content_sha256
on public.civil_work_assets
for each row
execute function public.civil_assert_asset_retained_pages_v1();

-- Work graph assertions carry their own provenance. Parsed citation edges are
-- not treated as peer-reviewed claims merely because both endpoints exist.
create table if not exists public.civil_work_relations (
  relation_id             uuid primary key default gen_random_uuid(),
  subject_work_id         uuid not null references public.civil_works(work_id) on delete cascade,
  relation_type           text not null,
  object_work_id          uuid not null references public.civil_works(work_id) on delete cascade,
  source_asset_id         uuid,
  source_catalog_id       text references public.civil_source_catalog(id) on delete set null,
  assertion_method        text not null,
  confidence              numeric(5,4) not null default 1,
  source_locator          jsonb not null default '{}'::jsonb,
  provenance              jsonb not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (subject_work_id, source_asset_id)
    references public.civil_work_assets(work_id, asset_id)
    on delete cascade,
  check (subject_work_id <> object_work_id),
  check (relation_type in (
    'cites', 'extends', 'replicates', 'corrects', 'retracts',
    'supplements', 'derived_from', 'contrasts_with', 'related'
  )),
  check (assertion_method in (
    'provider_metadata', 'parsed_reference', 'curator_review', 'author_deposit', 'user_import'
  )),
  check (confidence between 0 and 1),
  check (jsonb_typeof(source_locator) = 'object'),
  check (
    jsonb_typeof(provenance) = 'object'
    and provenance <> '{}'::jsonb
    and provenance ? 'source'
  )
);

create unique index if not exists civil_work_relations_assertion_uq
  on public.civil_work_relations (
    subject_work_id,
    relation_type,
    object_work_id,
    coalesce(source_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
    assertion_method
  );

create index if not exists civil_work_relations_object_idx
  on public.civil_work_relations (object_work_id, relation_type);

create index if not exists civil_work_relations_source_catalog_idx
  on public.civil_work_relations (source_catalog_id)
  where source_catalog_id is not null;

comment on table public.civil_work_relations is
  'Provenance-bearing canonical-work graph edges; confidence describes extraction/assertion confidence, not scientific validity.';

-- Private annotation anchors follow the existing service-layer owner model.
-- No authenticated policy is added because owner_id is application text rather
-- than auth.uid(); the trusted server must verify ownership before every write.
create table if not exists public.civil_user_annotation_anchors (
  annotation_id           uuid primary key default gen_random_uuid(),
  owner_id                text not null references public.civil_chat_users(user_id) on delete cascade,
  work_id                 uuid not null references public.civil_works(work_id) on delete cascade,
  asset_id                uuid,
  page_id                 uuid,
  anchor_schema_version   smallint not null default 1,
  anchor_type             text not null,
  selector                jsonb not null,
  selected_text           text,
  note_markdown           text,
  color                   text,
  tags                    text[] not null default '{}'::text[],
  visibility              text not null default 'private',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  foreign key (work_id, asset_id)
    references public.civil_work_assets(work_id, asset_id)
    on delete cascade,
  foreign key (asset_id, page_id)
    references public.civil_fulltext_pages(asset_id, page_id)
    on delete cascade,
  check (anchor_schema_version = 1),
  check (anchor_type in ('whole_work', 'section', 'page_text_quote', 'pdf_rect')),
  check (jsonb_typeof(selector) = 'object' and selector <> '{}'::jsonb),
  check (selected_text is null or char_length(selected_text) <= 20000),
  check (note_markdown is null or char_length(note_markdown) <= 100000),
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  check (cardinality(tags) <= 50),
  check (visibility = 'private'),
  check (page_id is null or asset_id is not null),
  check (
    anchor_type <> 'whole_work'
    or (asset_id is null and page_id is null)
  ),
  check (
    anchor_type <> 'section'
    or (asset_id is not null and selector ? 'section_key')
  ),
  check (
    anchor_type <> 'page_text_quote'
    or (
      page_id is not null
      and selected_text is not null
      and jsonb_typeof(selector -> 'start_char') = 'number'
      and jsonb_typeof(selector -> 'end_char') = 'number'
      and (selector ->> 'start_char')::integer >= 0
      and (selector ->> 'end_char')::integer > (selector ->> 'start_char')::integer
    )
  ),
  check (
    anchor_type <> 'pdf_rect'
    or (
      page_id is not null
      and jsonb_typeof(selector -> 'rects') = 'array'
      and jsonb_array_length(selector -> 'rects') between 1 and 100
    )
  )
);

create index if not exists civil_user_annotation_owner_updated_idx
  on public.civil_user_annotation_anchors (owner_id, updated_at desc)
  where deleted_at is null;

create index if not exists civil_user_annotation_work_idx
  on public.civil_user_annotation_anchors (owner_id, work_id, created_at desc)
  where deleted_at is null;

create index if not exists civil_user_annotation_page_idx
  on public.civil_user_annotation_anchors (page_id)
  where page_id is not null and deleted_at is null;

comment on table public.civil_user_annotation_anchors is
  'Private owner-scoped research annotations with versioned selectors anchored to a canonical work and optional verified asset/page.';

create or replace function public.civil_assert_annotation_anchor_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_asset public.civil_work_assets%rowtype;
begin
  -- Whole-work notes contain no publisher-asset text and remain available even
  -- when no legal full-text manifestation exists.
  if new.asset_id is null then
    return new;
  end if;

  select *
  into v_asset
  from public.civil_work_assets
  where asset_id = new.asset_id
  for key share;

  if not found or v_asset.work_id <> new.work_id then
    raise exception 'annotation asset does not belong to canonical work';
  end if;

  if v_asset.asset_status <> 'active'
     or v_asset.rights_status not in ('open_license_verified', 'permission_granted')
     or v_asset.rights_verified_at is null
     or v_asset.rights_provenance = '{}'::jsonb
     or not (v_asset.rights_actions ->> 'annotation')::boolean then
    raise exception 'asset-anchored annotation is not authorized for asset %', new.asset_id;
  end if;

  return new;
end;
$$;

drop trigger if exists civil_user_annotation_asset_rights_guard
  on public.civil_user_annotation_anchors;
create trigger civil_user_annotation_asset_rights_guard
before insert or update
on public.civil_user_annotation_anchors
for each row
execute function public.civil_assert_annotation_anchor_v1();

create or replace function public.civil_assert_asset_retained_annotations_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.civil_user_annotation_anchors annotation
    where annotation.asset_id = old.asset_id
  ) and (
    new.asset_status <> 'active'
    or new.rights_status not in ('open_license_verified', 'permission_granted')
    or new.rights_verified_at is null
    or new.rights_provenance = '{}'::jsonb
    or not (new.rights_actions ->> 'annotation')::boolean
  ) then
    raise exception 'remove or de-anchor annotations before revoking asset %', old.asset_id;
  end if;

  return new;
end;
$$;

drop trigger if exists civil_work_assets_retained_annotations_guard
  on public.civil_work_assets;
create trigger civil_work_assets_retained_annotations_guard
before update of asset_status, rights_status, rights_actions, rights_provenance,
  rights_checked_at, rights_verified_at
on public.civil_work_assets
for each row
execute function public.civil_assert_asset_retained_annotations_v1();

-- Defense in depth for every new exposed-schema table. No direct Data API role
-- receives table access; the service layer remains the only authority boundary.
alter table public.civil_works enable row level security;
alter table public.civil_source_endpoint_coverage enable row level security;
alter table public.civil_work_assets enable row level security;
alter table public.civil_fulltext_pages enable row level security;
alter table public.civil_work_relations enable row level security;
alter table public.civil_user_annotation_anchors enable row level security;

revoke all on table public.civil_works from public, anon, authenticated;
revoke all on table public.civil_source_endpoint_coverage from public, anon, authenticated;
revoke all on table public.civil_work_assets from public, anon, authenticated;
revoke all on table public.civil_fulltext_pages from public, anon, authenticated;
revoke all on table public.civil_work_relations from public, anon, authenticated;
revoke all on table public.civil_user_annotation_anchors from public, anon, authenticated;

grant all on table public.civil_works to service_role;
grant all on table public.civil_source_endpoint_coverage to service_role;
grant all on table public.civil_work_assets to service_role;
grant all on table public.civil_fulltext_pages to service_role;
grant all on table public.civil_work_relations to service_role;
grant all on table public.civil_user_annotation_anchors to service_role;

-- Trigger helpers are not public RPCs and return no content. Revoke PostgreSQL's
-- default PUBLIC execute grant explicitly before granting only service_role.
revoke all on function public.civil_assert_fulltext_page_asset_v1()
  from public, anon, authenticated;
revoke all on function public.civil_assert_asset_retained_pages_v1()
  from public, anon, authenticated;
revoke all on function public.civil_assert_annotation_anchor_v1()
  from public, anon, authenticated;
revoke all on function public.civil_assert_asset_retained_annotations_v1()
  from public, anon, authenticated;
grant execute on function public.civil_assert_fulltext_page_asset_v1()
  to service_role;
grant execute on function public.civil_assert_asset_retained_pages_v1()
  to service_role;
grant execute on function public.civil_assert_annotation_anchor_v1()
  to service_role;
grant execute on function public.civil_assert_asset_retained_annotations_v1()
  to service_role;

notify pgrst, 'reload schema';

commit;
