begin;

-- Discovery metadata lives separately from page-linked evidence. A TCI record
-- is not eligible for retrieval/citation until rights and full-text provenance
-- have been verified and document_id points to the evidence index.
create table if not exists public.civil_source_catalog (
  id                    text primary key,
  provider              text not null,
  provider_record_id    text not null,
  collection            text not null,
  source_type           text not null,
  title_local           text,
  title_en              text,
  abstract_local        text,
  abstract_en           text,
  authors               jsonb not null default '[]'::jsonb,
  keywords              jsonb not null default '[]'::jsonb,
  doi                   text,
  canonical_url         text,
  pdf_url               text,
  publisher             text,
  journal_title         text,
  issn                  text,
  published_at          date,
  language              text,
  discipline            text not null default 'unknown',
  license               text,
  rights_status         text not null,
  access_level          text not null,
  evidence_status       text not null,
  document_id           text references public.civil_documents_v2(id) on delete set null,
  record_hash           text not null,
  raw_metadata          jsonb not null default '{}'::jsonb,
  source_updated_at     timestamptz,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (provider, provider_record_id),
  check (provider ~ '^[a-z0-9_:-]+$'),
  check (collection ~ '^[a-z0-9_:-]+$'),
  check (rights_status in (
    'metadata_only_unverified',
    'public_source_no_redistribution',
    'open_license_verified',
    'permission_granted',
    'restricted',
    'removed'
  )),
  check (access_level in ('metadata_only', 'full_text_local', 'full_text_licensed', 'restricted')),
  check (evidence_status in ('metadata_only', 'extracted', 'indexed', 'quarantined', 'removed')),
  check (
    evidence_status not in ('extracted', 'indexed')
    or access_level in ('full_text_local', 'full_text_licensed')
  )
);

create index if not exists civil_source_catalog_provider_idx
  on public.civil_source_catalog (provider, last_seen_at desc);
create index if not exists civil_source_catalog_collection_idx
  on public.civil_source_catalog (collection, published_at desc);
create index if not exists civil_source_catalog_evidence_idx
  on public.civil_source_catalog (evidence_status, discipline);
create index if not exists civil_source_catalog_doi_idx
  on public.civil_source_catalog (lower(doi))
  where doi is not null and btrim(doi) <> '';

create table if not exists public.civil_ingest_runs (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null,
  endpoint              text,
  mode                  text not null,
  status                text not null,
  cursor                text,
  counts                jsonb not null default '{}'::jsonb,
  error                 text,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  created_at            timestamptz not null default now(),
  check (status in ('running', 'completed', 'failed', 'cancelled')),
  check (mode in ('metadata', 'full_text', 'reconcile'))
);

create index if not exists civil_ingest_runs_provider_idx
  on public.civil_ingest_runs (provider, started_at desc);

alter table public.civil_source_catalog enable row level security;
alter table public.civil_ingest_runs enable row level security;
revoke all on table public.civil_source_catalog from public, anon, authenticated;
revoke all on table public.civil_ingest_runs from public, anon, authenticated;
grant all on table public.civil_source_catalog to service_role;
grant all on table public.civil_ingest_runs to service_role;

insert into public.civil_source_catalog (
  id,
  provider,
  provider_record_id,
  collection,
  source_type,
  title_local,
  canonical_url,
  discipline,
  rights_status,
  access_level,
  evidence_status,
  document_id,
  record_hash,
  raw_metadata,
  source_updated_at
)
select
  case
    when d.collection = 'ce_project' then 'student_transport_projects:' || d.id
    else 'ncce:' || d.id
  end,
  case
    when d.collection = 'ce_project' then 'student_transport_projects'
    else 'ncce'
  end,
  d.id,
  d.collection,
  d.source_type,
  coalesce(nullif(d.paper_code, ''), d.id),
  null,
  d.discipline,
  'public_source_no_redistribution',
  'full_text_local',
  'indexed',
  d.id,
  d.doc_hash,
  jsonb_build_object(
    'source', d.source,
    'source_pdf', d.source_pdf,
    'parent_source_pdf', d.parent_source_pdf,
    'page_start', d.page_start,
    'page_end', d.page_end,
    'proceeding_no', d.proceeding_no,
    'proceeding_year', d.proceeding_year,
    'section_count', d.section_count,
    'chunk_count', d.chunk_count
  ),
  d.updated_at
from public.civil_documents_v2 d
where d.collection in ('ce_project', 'ncce')
on conflict (provider, provider_record_id) do update set
  collection = excluded.collection,
  source_type = excluded.source_type,
  discipline = excluded.discipline,
  rights_status = excluded.rights_status,
  access_level = excluded.access_level,
  evidence_status = excluded.evidence_status,
  document_id = excluded.document_id,
  record_hash = excluded.record_hash,
  raw_metadata = excluded.raw_metadata,
  source_updated_at = excluded.source_updated_at,
  last_seen_at = now(),
  updated_at = now();

notify pgrst, 'reload schema';
commit;
