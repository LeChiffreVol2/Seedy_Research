create extension if not exists vector;
create extension if not exists pg_trgm with schema extensions;

set maintenance_work_mem = '64MB';

create table if not exists civil_chunks (
  id           text primary key,
  source       text not null,
  discipline   text not null,
  chunk_index  integer not null,
  content      text not null,
  embedding    vector(1536),
  created_at   timestamptz default now()
);

create index if not exists civil_chunks_embedding_ivfflat_idx
on civil_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 50);

create or replace function match_civil_chunks(
  query_embedding vector(1536),
  match_count     int  default 5,
  filter_disc     text default null
)
returns table (
  id          text,
  source      text,
  discipline  text,
  content     text,
  similarity  float
)
language sql stable as $$
  select
    id,
    source,
    discipline,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from civil_chunks
  where filter_disc is null or discipline = filter_disc
  order by embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

create table if not exists civil_chat_sessions (
  session_id   text primary key,
  share_id     text unique,
  share_expires_at timestamptz,
  share_revoked_at timestamptz,
  mode         text not null default 'mcp',
  model        text not null default 'deepseek-v4-flash',
  collection   text not null default '',
  transcript   jsonb not null default '[]'::jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists civil_chat_users (
  user_id       text primary key,
  display_name  text not null default 'Guest researcher',
  email         text,
  is_guest      boolean not null default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table civil_chat_sessions
add column if not exists collection text not null default '';

alter table civil_chat_sessions
add column if not exists owner_id text;

alter table civil_chat_sessions
add column if not exists title text not null default 'Untitled chat';

alter table civil_chat_sessions
add column if not exists archived boolean not null default false;

alter table civil_chat_sessions
add column if not exists last_message_at timestamptz;

alter table civil_chat_sessions add column if not exists share_expires_at timestamptz;
alter table civil_chat_sessions add column if not exists share_revoked_at timestamptz;

create index if not exists civil_chat_sessions_updated_at_idx
on civil_chat_sessions (updated_at desc);

create index if not exists civil_chat_sessions_owner_updated_idx
on civil_chat_sessions (owner_id, archived, updated_at desc);

create index if not exists civil_chat_users_email_idx
on civil_chat_users (lower(email))
where email is not null;

create table if not exists civil_documents_v2 (
  id                    text primary key,
  source                text not null unique,
  source_pdf            text,
  collection            text not null default 'ce_project',
  source_type           text not null default 'paper',
  parent_source_pdf     text,
  paper_code            text,
  page_start            integer,
  page_end              integer,
  proceeding_no         integer,
  proceeding_year       integer,
  discipline            text not null,
  doc_hash              text not null,
  embedding_model       text not null default 'text-embedding-3-small',
  embedding_dimensions  integer not null default 768,
  section_count         integer not null default 0,
  chunk_count           integer not null default 0,
  indexed_at            timestamptz default now(),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists civil_documents_v2_discipline_idx
on civil_documents_v2 (discipline);

alter table civil_documents_v2 add column if not exists collection text not null default 'ce_project';
alter table civil_documents_v2 add column if not exists source_type text not null default 'paper';
alter table civil_documents_v2 add column if not exists parent_source_pdf text;
alter table civil_documents_v2 add column if not exists paper_code text;
alter table civil_documents_v2 add column if not exists page_start integer;
alter table civil_documents_v2 add column if not exists page_end integer;
alter table civil_documents_v2 add column if not exists proceeding_no integer;
alter table civil_documents_v2 add column if not exists proceeding_year integer;

update civil_documents_v2
set collection = coalesce(nullif(collection, ''), 'ce_project'),
    source_type = coalesce(nullif(source_type, ''), 'paper')
where collection is null or collection = '' or source_type is null or source_type = '';

create index if not exists civil_documents_v2_collection_idx
on civil_documents_v2 (collection);

create index if not exists civil_documents_v2_collection_discipline_idx
on civil_documents_v2 (collection, discipline);

create index if not exists civil_documents_v2_parent_page_idx
on civil_documents_v2 (parent_source_pdf, page_start);

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
  rights_manifest_version smallint not null default 1,
  rights_manifest       jsonb not null default '{
    "metadata_indexing": false,
    "abstract_storage": false,
    "abstract_embedding": false,
    "full_text_download": false,
    "full_text_embedding": false,
    "summarization": false,
    "translation": false,
    "snippet_display": false,
    "redistribution": false,
    "commercial_use": false,
    "model_training": false
  }'::jsonb,
  rights_provenance     jsonb not null default '{}'::jsonb,
  rights_checked_at     timestamptz,
  rights_verified_at    timestamptz,
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
  ),
  constraint civil_source_catalog_rights_manifest_version_check
    check (rights_manifest_version = 1),
  constraint civil_source_catalog_rights_manifest_shape_check
    check (
      jsonb_typeof(rights_manifest) = 'object'
      and rights_manifest ?& array[
        'metadata_indexing', 'abstract_storage', 'abstract_embedding',
        'full_text_download', 'full_text_embedding', 'summarization',
        'translation', 'snippet_display', 'redistribution',
        'commercial_use', 'model_training'
      ]
      and jsonb_typeof(rights_manifest -> 'metadata_indexing') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'abstract_storage') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'abstract_embedding') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'full_text_download') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'full_text_embedding') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'summarization') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'translation') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'snippet_display') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'redistribution') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'commercial_use') = 'boolean'
      and jsonb_typeof(rights_manifest -> 'model_training') = 'boolean'
    ),
  constraint civil_source_catalog_rights_provenance_check
    check (jsonb_typeof(rights_provenance) = 'object'),
  constraint civil_source_catalog_rights_grant_provenance_check
    check (
      rights_provenance <> '{}'::jsonb
      or rights_manifest = '{
        "metadata_indexing": false,
        "abstract_storage": false,
        "abstract_embedding": false,
        "full_text_download": false,
        "full_text_embedding": false,
        "summarization": false,
        "translation": false,
        "snippet_display": false,
        "redistribution": false,
        "commercial_use": false,
        "model_training": false
      }'::jsonb
    ),
  constraint civil_source_catalog_rights_verification_time_check
    check (
      rights_verified_at is null
      or (
        rights_checked_at is not null
        and rights_provenance <> '{}'::jsonb
        and rights_status in ('open_license_verified', 'permission_granted', 'restricted')
      )
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

alter table public.civil_source_catalog enable row level security;
revoke all on table public.civil_source_catalog from public, anon, authenticated;
grant all on table public.civil_source_catalog to service_role;

create table if not exists civil_sections_v2 (
  id                    text primary key,
  document_id           text not null references civil_documents_v2(id) on delete cascade,
  source                text not null,
  collection            text not null default 'ce_project',
  source_type           text not null default 'paper',
  parent_source_pdf     text,
  paper_code            text,
  page_start            integer,
  page_end              integer,
  proceeding_no         integer,
  proceeding_year       integer,
  discipline            text not null,
  section_index         integer not null,
  section_title         text not null,
  content               text not null,
  content_hash          text not null,
  embedding             vector(768),
  embedding_model       text not null default 'text-embedding-3-small',
  embedding_dimensions  integer not null default 768,
  is_stale              boolean not null default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (document_id, section_index)
);

create index if not exists civil_sections_v2_document_idx
on civil_sections_v2 (document_id, section_index);

create index if not exists civil_sections_v2_source_idx
on civil_sections_v2 (source);

alter table civil_sections_v2 add column if not exists collection text not null default 'ce_project';
alter table civil_sections_v2 add column if not exists source_type text not null default 'paper';
alter table civil_sections_v2 add column if not exists parent_source_pdf text;
alter table civil_sections_v2 add column if not exists paper_code text;
alter table civil_sections_v2 add column if not exists page_start integer;
alter table civil_sections_v2 add column if not exists page_end integer;
alter table civil_sections_v2 add column if not exists proceeding_no integer;
alter table civil_sections_v2 add column if not exists proceeding_year integer;

update civil_sections_v2
set collection = coalesce(nullif(collection, ''), 'ce_project'),
    source_type = coalesce(nullif(source_type, ''), 'paper')
where collection is null or collection = '' or source_type is null or source_type = '';

create index if not exists civil_sections_v2_collection_idx
on civil_sections_v2 (collection);

create index if not exists civil_sections_v2_collection_discipline_idx
on civil_sections_v2 (collection, discipline);

create index if not exists civil_sections_v2_parent_page_idx
on civil_sections_v2 (parent_source_pdf, page_start);

drop index if exists civil_sections_v2_embedding_ivfflat_idx;

create index if not exists civil_sections_v2_embedding_ivfflat_idx
on civil_sections_v2
using ivfflat (embedding vector_cosine_ops)
with (lists = 50)
where embedding is not null and is_stale = false;

create table if not exists civil_chunks_v2 (
  id                    text primary key,
  document_id           text not null references civil_documents_v2(id) on delete cascade,
  section_id            text not null references civil_sections_v2(id) on delete cascade,
  source                text not null,
  collection            text not null default 'ce_project',
  source_type           text not null default 'paper',
  parent_source_pdf     text,
  paper_code            text,
  page_start            integer,
  page_end              integer,
  proceeding_no         integer,
  proceeding_year       integer,
  discipline            text not null,
  section_index         integer not null,
  section_title         text not null,
  chunk_index           integer not null,
  content               text not null,
  content_hash          text not null,
  embedding             vector(768),
  embedding_model       text not null default 'text-embedding-3-small',
  embedding_dimensions  integer not null default 768,
  is_stale              boolean not null default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (section_id, chunk_index)
);

create index if not exists civil_chunks_v2_document_idx
on civil_chunks_v2 (document_id, section_index, chunk_index);

create index if not exists civil_chunks_v2_section_idx
on civil_chunks_v2 (section_id);

create index if not exists civil_chunks_v2_source_idx
on civil_chunks_v2 (source);

alter table civil_chunks_v2 add column if not exists collection text not null default 'ce_project';
alter table civil_chunks_v2 add column if not exists source_type text not null default 'paper';
alter table civil_chunks_v2 add column if not exists parent_source_pdf text;
alter table civil_chunks_v2 add column if not exists paper_code text;
alter table civil_chunks_v2 add column if not exists page_start integer;
alter table civil_chunks_v2 add column if not exists page_end integer;
alter table civil_chunks_v2 add column if not exists proceeding_no integer;
alter table civil_chunks_v2 add column if not exists proceeding_year integer;

update civil_chunks_v2
set collection = coalesce(nullif(collection, ''), 'ce_project'),
    source_type = coalesce(nullif(source_type, ''), 'paper')
where collection is null or collection = '' or source_type is null or source_type = '';

create index if not exists civil_chunks_v2_collection_idx
on civil_chunks_v2 (collection);

create index if not exists civil_chunks_v2_collection_discipline_idx
on civil_chunks_v2 (collection, discipline);

create index if not exists civil_chunks_v2_parent_page_idx
on civil_chunks_v2 (parent_source_pdf, page_start);

drop index if exists civil_chunks_v2_embedding_ivfflat_idx;

create index if not exists civil_chunks_v2_embedding_ivfflat_idx
on civil_chunks_v2
using ivfflat (embedding vector_cosine_ops)
with (lists = 100)
where embedding is not null and is_stale = false;

create or replace view civil_sections_v2_index_status as
select
  id,
  document_id,
  content_hash,
  is_stale,
  embedding is not null as has_embedding
from civil_sections_v2;

create or replace view civil_chunks_v2_index_status as
select
  id,
  document_id,
  content_hash,
  is_stale,
  embedding is not null as has_embedding
from civil_chunks_v2;

drop function if exists match_civil_sections_v2(vector(768), int, text);
create or replace function match_civil_sections_v2(
  query_embedding vector(768),
  match_count     int    default 20,
  filter_disc     text   default null,
  filter_collection text default null
)
returns table (
  id             text,
  document_id    text,
  source         text,
  collection     text,
  source_type    text,
  parent_source_pdf text,
  paper_code     text,
  page_start     integer,
  page_end       integer,
  proceeding_no  integer,
  proceeding_year integer,
  discipline     text,
  section_index  integer,
  section_title  text,
  content        text,
  similarity     float
)
language sql stable as $$
  select
    id,
    document_id,
    source,
    collection,
    source_type,
    parent_source_pdf,
    paper_code,
    page_start,
    page_end,
    proceeding_no,
    proceeding_year,
    discipline,
    section_index,
    section_title,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from civil_sections_v2
  where
    embedding is not null
    and is_stale = false
    and (filter_disc is null or discipline = filter_disc)
    and (filter_collection is null or collection = filter_collection)
  order by embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

drop function if exists match_civil_chunks_v2(vector(768), int, text, text[], text[]);
create or replace function match_civil_chunks_v2(
  query_embedding       vector(768),
  match_count           int    default 8,
  filter_disc           text   default null,
  filter_document_ids   text[] default null,
  filter_section_ids    text[] default null,
  filter_collection     text   default null
)
returns table (
  id             text,
  document_id    text,
  section_id     text,
  source         text,
  collection     text,
  source_type    text,
  parent_source_pdf text,
  paper_code     text,
  page_start     integer,
  page_end       integer,
  proceeding_no  integer,
  proceeding_year integer,
  discipline     text,
  section_index  integer,
  section_title  text,
  chunk_index    integer,
  content        text,
  similarity     float
)
language sql stable as $$
  select
    id,
    document_id,
    section_id,
    source,
    collection,
    source_type,
    parent_source_pdf,
    paper_code,
    page_start,
    page_end,
    proceeding_no,
    proceeding_year,
    discipline,
    section_index,
    section_title,
    chunk_index,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from civil_chunks_v2
  where
    embedding is not null
    and is_stale = false
    and (filter_disc is null or discipline = filter_disc)
    and (filter_document_ids is null or document_id = any(filter_document_ids))
    and (filter_section_ids is null or section_id = any(filter_section_ids))
    and (filter_collection is null or collection = filter_collection)
  order by embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

create index if not exists civil_sections_v2_lexical_trgm_idx
on civil_sections_v2
using gin ((lower(section_title || ' ' || content || ' ' || source)) extensions.gin_trgm_ops)
where is_stale = false;

create index if not exists civil_chunks_v2_lexical_trgm_idx
on civil_chunks_v2
using gin ((lower(section_title || ' ' || content || ' ' || source)) extensions.gin_trgm_ops)
where is_stale = false;

create or replace function search_civil_sections_lexical_v2(
  search_query text,
  match_count int default 20,
  filter_disc text default null,
  filter_collection text default null
)
returns table (
  id text, document_id text, source text, collection text, source_type text,
  parent_source_pdf text, paper_code text, page_start integer, page_end integer,
  proceeding_no integer, proceeding_year integer, discipline text,
  section_index integer, section_title text, content text, similarity float
)
language sql stable security definer set search_path = public, extensions as $$
  with terms as materialized (
    select distinct lower(term) as term
    from regexp_split_to_table(left(trim(search_query), 500), '[[:space:][:punct:]]+') as term
    where length(term) >= 2
    limit 8
  ),
  candidate_hits as materialized (
    select candidate.id, t.term, candidate.title_hit
    from terms t
    cross join lateral (
      select s.id, (lower(s.section_title) like '%' || t.term || '%')::int as title_hit
      from civil_sections_v2 s
      where not s.is_stale
        and (filter_disc is null or s.discipline = filter_disc)
        and (filter_collection is null or s.collection = filter_collection)
        and lower(s.section_title || ' ' || s.content || ' ' || s.source) like '%' || t.term || '%'
      limit 80
    ) candidate
  ),
  ranked as (
    select h.id, count(*)::float as matched_terms, sum(h.title_hit)::float as title_hits
    from candidate_hits h group by h.id
  ),
  term_total as (select greatest(1, count(*))::float as value from terms)
  select s.id, s.document_id, s.source, s.collection, s.source_type,
    s.parent_source_pdf, s.paper_code, s.page_start, s.page_end, s.proceeding_no,
    s.proceeding_year, s.discipline, s.section_index, s.section_title, s.content,
    least(0.95, 0.25 + 0.55 * (r.matched_terms / tt.value) + 0.15 * least(1, r.title_hits))::float
  from ranked r
  join civil_sections_v2 s on s.id = r.id
  cross join term_total tt
  order by 16 desc, r.title_hits desc, s.page_start nulls last, s.source
  limit greatest(1, least(match_count, 50));
$$;

create or replace function search_civil_chunks_lexical_v2(
  search_query text,
  match_count int default 8,
  filter_disc text default null,
  filter_document_ids text[] default null,
  filter_section_ids text[] default null,
  filter_collection text default null
)
returns table (
  id text, document_id text, section_id text, source text, collection text,
  source_type text, parent_source_pdf text, paper_code text, page_start integer,
  page_end integer, proceeding_no integer, proceeding_year integer, discipline text,
  section_index integer, section_title text, chunk_index integer, content text, similarity float
)
language sql stable security definer set search_path = public, extensions as $$
  with terms as materialized (
    select distinct lower(term) as term
    from regexp_split_to_table(left(trim(search_query), 500), '[[:space:][:punct:]]+') as term
    where length(term) >= 2
    limit 8
  ),
  candidate_hits as materialized (
    select candidate.id, t.term, candidate.title_hit
    from terms t
    cross join lateral (
      select c.id, (lower(c.section_title) like '%' || t.term || '%')::int as title_hit
      from civil_chunks_v2 c
      where not c.is_stale
        and (filter_disc is null or c.discipline = filter_disc)
        and (filter_document_ids is null or c.document_id = any(filter_document_ids))
        and (filter_section_ids is null or c.section_id = any(filter_section_ids))
        and (filter_collection is null or c.collection = filter_collection)
        and lower(c.section_title || ' ' || c.content || ' ' || c.source) like '%' || t.term || '%'
      limit 120
    ) candidate
  ),
  ranked as (
    select h.id, count(*)::float as matched_terms, sum(h.title_hit)::float as title_hits
    from candidate_hits h group by h.id
  ),
  term_total as (select greatest(1, count(*))::float as value from terms)
  select c.id, c.document_id, c.section_id, c.source, c.collection, c.source_type,
    c.parent_source_pdf, c.paper_code, c.page_start, c.page_end, c.proceeding_no,
    c.proceeding_year, c.discipline, c.section_index, c.section_title, c.chunk_index,
    c.content,
    least(0.95, 0.25 + 0.55 * (r.matched_terms / tt.value) + 0.15 * least(1, r.title_hits))::float
  from ranked r
  join civil_chunks_v2 c on c.id = r.id
  cross join term_total tt
  order by 18 desc, r.title_hits desc, c.page_start nulls last, c.source, c.chunk_index
  limit greatest(1, least(match_count, 50));
$$;

revoke all on function search_civil_sections_lexical_v2(text, int, text, text) from public, anon, authenticated;
revoke all on function search_civil_chunks_lexical_v2(text, int, text, text[], text[], text) from public, anon, authenticated;
grant execute on function search_civil_sections_lexical_v2(text, int, text, text) to service_role;
grant execute on function search_civil_chunks_lexical_v2(text, int, text, text[], text[], text) to service_role;


create table if not exists civil_chat_traces (
  trace_id      text primary key,
  request_id    text,
  session_id    text references civil_chat_sessions(session_id) on delete set null,
  user_id       text references civil_chat_users(user_id) on delete set null,
  message_id    text,
  mode          text not null default 'mcp',
  model         text not null,
  collection    text not null default '',
  question      text,
  answer        text,
  question_hash text,
  content_mode  text not null default 'debug',
  retention_expires_at timestamptz,
  context_stats jsonb not null default '{}'::jsonb,
  evidence_items jsonb not null default '[]'::jsonb,
  tool_trace    jsonb not null default '[]'::jsonb,
  plan          jsonb,
  usage         jsonb,
  timings       jsonb not null default '{}'::jsonb,
  cost_usd      numeric,
  status        text not null default 'ok',
  error_class   text,
  created_at    timestamptz not null default now()
);

create index if not exists civil_chat_traces_session_created_idx
on civil_chat_traces (session_id, created_at desc);

create index if not exists civil_chat_traces_user_created_idx
on civil_chat_traces (user_id, created_at desc);

create index if not exists civil_chat_traces_status_created_idx
on civil_chat_traces (status, created_at desc);

update civil_chat_traces
set content_mode = case
  when question is not null or answer is not null then 'debug'
  else 'metadata'
end
where content_mode = 'metadata';

create table if not exists civil_chat_feedback (
  feedback_id    text primary key,
  trace_id       text references civil_chat_traces(trace_id) on delete set null,
  session_id     text references civil_chat_sessions(session_id) on delete set null,
  user_id        text references civil_chat_users(user_id) on delete set null,
  message_id     text,
  rating         text not null check (rating in ('up', 'down')),
  categories     text[] not null default '{}'::text[],
  correction     text,
  question_snapshot text,
  answer_snapshot text,
  content_expires_at timestamptz,
  citation_issue boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists civil_chat_feedback_trace_idx
on civil_chat_feedback (trace_id);

create index if not exists civil_chat_feedback_rating_created_idx
on civil_chat_feedback (rating, created_at desc);

create table if not exists civil_paper_workspaces (
  workspace_id text primary key,
  owner_id     text references civil_chat_users(user_id) on delete cascade,
  title        text not null default 'Research workspace',
  collection   text not null default '',
  paper_sources text[] not null default '{}'::text[],
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists civil_paper_workspaces_owner_updated_idx
on civil_paper_workspaces (owner_id, updated_at desc);

alter table civil_chat_sessions enable row level security;
alter table civil_chat_users enable row level security;
alter table civil_chat_traces enable row level security;
alter table civil_chat_feedback enable row level security;
alter table civil_paper_workspaces enable row level security;

create table if not exists civil_paper_workspace_items (
  id          text primary key,
  owner_id    text not null references civil_chat_users(user_id) on delete cascade,
  document_id text,
  source      text not null,
  collection  text not null default '',
  paper_code  text,
  note        text not null default '',
  labels      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(owner_id, source)
);

create index if not exists civil_paper_workspace_items_owner_updated_idx
on civil_paper_workspace_items (owner_id, updated_at desc);

alter table civil_paper_workspace_items enable row level security;

create table if not exists civil_support_requests (
  request_id text primary key,
  user_id text,
  email text not null,
  category text not null check (category in ('product_support', 'data_request', 'account_deletion', 'source_takedown', 'copyright')),
  subject text not null,
  message text not null,
  source_url text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists civil_support_requests_status_created_idx
on civil_support_requests (status, created_at desc);

alter table civil_support_requests enable row level security;
revoke all on table civil_support_requests from public, anon, authenticated;
grant all on table civil_support_requests to service_role;

create table if not exists civil_product_events (
  event_id text primary key,
  user_id text not null,
  event_name text not null check (event_name in (
    'explore_search', 'paper_open', 'evidence_open', 'paper_save',
    'research_path_created', 'session_export', 'evidence_export'
  )),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists civil_product_events_name_created_idx
on civil_product_events (event_name, created_at desc);

create index if not exists civil_product_events_user_created_idx
on civil_product_events (user_id, created_at desc);

alter table civil_product_events enable row level security;
revoke all on table civil_product_events from public, anon, authenticated;
grant all on table civil_product_events to service_role;

create table if not exists civil_api_rate_limits (
  scope text not null,
  identity_hash text not null,
  bucket_start timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  request_count integer not null default 0,
  expires_at timestamptz not null,
  primary key (scope, identity_hash, bucket_start, window_seconds)
);

create index if not exists civil_api_rate_limits_expires_idx
on civil_api_rate_limits (expires_at);

alter table civil_api_rate_limits enable row level security;
revoke all on table civil_api_rate_limits from public, anon, authenticated;
grant all on table civil_api_rate_limits to service_role;

create or replace function consume_civil_quota(
  p_identity_hash text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz, request_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket_start timestamptz;
  v_reset_at timestamptz;
  v_count integer;
begin
  if p_identity_hash is null or length(p_identity_hash) < 16 then raise exception 'identity hash is required'; end if;
  if p_scope is null or p_scope !~ '^[a-z0-9_:-]{1,80}$' then raise exception 'invalid quota scope'; end if;
  if p_limit < 1 or p_limit > 10000 then raise exception 'invalid quota limit'; end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then raise exception 'invalid quota window'; end if;
  v_bucket_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_reset_at := v_bucket_start + make_interval(secs => p_window_seconds);
  insert into civil_api_rate_limits (scope, identity_hash, bucket_start, window_seconds, request_count, expires_at)
  values (p_scope, p_identity_hash, v_bucket_start, p_window_seconds, 1, v_reset_at + interval '1 day')
  on conflict (scope, identity_hash, bucket_start, window_seconds)
  do update set request_count = civil_api_rate_limits.request_count + 1, expires_at = excluded.expires_at
  returning civil_api_rate_limits.request_count into v_count;
  return query select v_count <= p_limit, greatest(0, p_limit - v_count), v_reset_at, v_count;
end;
$$;

revoke all on function consume_civil_quota(text, text, integer, integer) from public, anon, authenticated;
grant execute on function consume_civil_quota(text, text, integer, integer) to service_role;

create or replace function prune_civil_operational_data()
returns table (deleted_rate_buckets bigint, deleted_traces bigint, cleared_feedback_snapshots bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate bigint;
  v_traces bigint;
  v_feedback bigint;
begin
  delete from civil_api_rate_limits where expires_at < now();
  get diagnostics v_rate = row_count;
  update civil_chat_feedback
  set question_snapshot = null, answer_snapshot = null, content_expires_at = null
  where content_expires_at is not null and content_expires_at < now();
  get diagnostics v_feedback = row_count;
  delete from civil_chat_traces where retention_expires_at is not null and retention_expires_at < now();
  get diagnostics v_traces = row_count;
  return query select v_rate, v_traces, v_feedback;
end;
$$;

revoke all on function prune_civil_operational_data() from public, anon, authenticated;
grant execute on function prune_civil_operational_data() to service_role;

create or replace function civil_backbone_readiness()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quota_table', to_regclass('public.civil_api_rate_limits') is not null,
    'quota_rpc', to_regprocedure('public.consume_civil_quota(text,text,integer,integer)') is not null,
    'retention_rpc', to_regprocedure('public.prune_civil_operational_data()') is not null,
    'lexical_section_rpc', to_regprocedure('public.search_civil_sections_lexical_v2(text,integer,text,text)') is not null,
    'lexical_chunk_rpc', to_regprocedure('public.search_civil_chunks_lexical_v2(text,integer,text,text[],text[],text)') is not null
  );
$$;

revoke all on function civil_backbone_readiness() from public, anon, authenticated;
grant execute on function civil_backbone_readiness() to service_role;

create index if not exists civil_source_catalog_search_trgm_idx
on public.civil_source_catalog
using gin ((lower(
  coalesce(title_local, '') || ' ' ||
  coalesce(title_en, '') || ' ' ||
  coalesce(journal_title, '') || ' ' ||
  coalesce(publisher, '') || ' ' ||
  coalesce(authors::text, '') || ' ' ||
  coalesce(keywords::text, '') || ' ' ||
  coalesce(abstract_local, '') || ' ' ||
  coalesce(abstract_en, '')
)) extensions.gin_trgm_ops);

create or replace function public.search_civil_source_catalog_v1(
  search_query text,
  filter_provider text default null,
  filter_discipline text default null,
  match_count integer default 20,
  match_offset integer default 0
)
returns table (
  id text,
  provider text,
  provider_record_id text,
  collection text,
  source_type text,
  title_local text,
  title_en text,
  abstract_local text,
  abstract_en text,
  authors jsonb,
  keywords jsonb,
  doi text,
  canonical_url text,
  journal_title text,
  publisher text,
  published_at date,
  language text,
  discipline text,
  license text,
  rights_status text,
  access_level text,
  evidence_status text,
  document_id text,
  source_updated_at timestamptz,
  updated_at timestamptz,
  match_score double precision,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with input as (
    select
      left(regexp_replace(lower(coalesce(search_query, '')), '[^[:alnum:]ก-๙]+', ' ', 'g'), 160) as phrase,
      least(greatest(coalesce(match_count, 20), 1), 30) as safe_count,
      least(greatest(coalesce(match_offset, 0), 0), 10000) as safe_offset
  ),
  terms as (
    select distinct token
    from input,
    lateral unnest(regexp_split_to_array(btrim(phrase), '[[:space:]]+')) as token
    where char_length(token) >= 2
    limit 8
  ),
  candidates as (
    select
      catalog.*,
      (
        case when exists (
          select 1 from terms where lower(coalesce(catalog.title_local, '') || ' ' || coalesce(catalog.title_en, '')) like '%' || token || '%'
        ) then 12 else 0 end
        + 4 * (select count(*) from terms where lower(coalesce(catalog.title_local, '') || ' ' || coalesce(catalog.title_en, '')) like '%' || token || '%')
        + 3 * (select count(*) from terms where lower(coalesce(catalog.keywords::text, '') || ' ' || coalesce(catalog.authors::text, '')) like '%' || token || '%')
        + 2 * (select count(*) from terms where lower(coalesce(catalog.journal_title, '') || ' ' || coalesce(catalog.publisher, '')) like '%' || token || '%')
        + 1 * (select count(*) from terms where lower(coalesce(catalog.abstract_local, '') || ' ' || coalesce(catalog.abstract_en, '')) like '%' || token || '%')
      )::double precision as score
    from public.civil_source_catalog catalog, input
    where catalog.evidence_status <> 'removed'
      and (filter_provider is null or filter_provider = '' or catalog.provider = filter_provider)
      and (filter_discipline is null or filter_discipline = '' or catalog.discipline = filter_discipline)
      and (
        not exists (select 1 from terms)
        or exists (
          select 1
          from terms
          where lower(
            coalesce(catalog.title_local, '') || ' ' ||
            coalesce(catalog.title_en, '') || ' ' ||
            coalesce(catalog.journal_title, '') || ' ' ||
            coalesce(catalog.publisher, '') || ' ' ||
            coalesce(catalog.authors::text, '') || ' ' ||
            coalesce(catalog.keywords::text, '') || ' ' ||
            coalesce(catalog.abstract_local, '') || ' ' ||
            coalesce(catalog.abstract_en, '')
          ) like '%' || token || '%'
        )
      )
  ),
  ranked as (
    select candidates.*, count(*) over () as total
    from candidates
  )
  select
    ranked.id, ranked.provider, ranked.provider_record_id, ranked.collection,
    ranked.source_type, ranked.title_local, ranked.title_en,
    ranked.abstract_local, ranked.abstract_en, ranked.authors, ranked.keywords,
    ranked.doi, ranked.canonical_url, ranked.journal_title, ranked.publisher,
    ranked.published_at, ranked.language, ranked.discipline, ranked.license,
    ranked.rights_status, ranked.access_level, ranked.evidence_status,
    ranked.document_id, ranked.source_updated_at, ranked.updated_at,
    ranked.score, ranked.total
  from ranked, input
  order by ranked.score desc, ranked.published_at desc nulls last, ranked.id
  limit (select safe_count from input)
  offset (select safe_offset from input);
$$;

revoke all on function public.search_civil_source_catalog_v1(text, text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.search_civil_source_catalog_v1(text, text, text, integer, integer)
to service_role;

create or replace function public.civil_source_catalog_facets_v1()
returns table (
  provider text,
  records bigint,
  citable bigint,
  metadata_only bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    catalog.provider,
    count(*)::bigint as records,
    count(*) filter (
      where catalog.evidence_status = 'indexed' and catalog.document_id is not null
    )::bigint as citable,
    count(*) filter (
      where catalog.evidence_status = 'metadata_only'
    )::bigint as metadata_only
  from public.civil_source_catalog catalog
  where catalog.evidence_status <> 'removed'
  group by catalog.provider
  order by catalog.provider;
$$;

revoke all on function public.civil_source_catalog_facets_v1()
from public, anon, authenticated;
grant execute on function public.civil_source_catalog_facets_v1()
to service_role;

create or replace function public.civil_delete_account_data(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or length(trim(p_user_id)) < 1 or length(p_user_id) > 128 then
    raise exception 'valid user id is required';
  end if;

  if exists (
    select 1
    from public.civil_billing_accounts
    where user_id = p_user_id
      and stripe_subscription_id is not null
      and status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused')
    for update
  ) then
    raise exception 'active subscription must be canceled before account deletion';
  end if;

  delete from public.civil_chat_feedback
  where user_id = p_user_id
     or trace_id in (
       select trace_id from public.civil_chat_traces
       where user_id = p_user_id
          or session_id in (select session_id from public.civil_chat_sessions where owner_id = p_user_id)
     )
     or session_id in (select session_id from public.civil_chat_sessions where owner_id = p_user_id);
  delete from public.civil_chat_traces
  where user_id = p_user_id
     or session_id in (select session_id from public.civil_chat_sessions where owner_id = p_user_id);
  delete from public.civil_chat_sessions where owner_id = p_user_id;
  delete from public.civil_paper_workspace_items where owner_id = p_user_id;
  delete from public.civil_paper_workspaces where owner_id = p_user_id;
  delete from public.civil_support_requests where user_id = p_user_id;
  delete from public.civil_product_events where user_id = p_user_id;
  delete from public.civil_credit_ledger where user_id = p_user_id;
  delete from public.civil_billing_accounts where user_id = p_user_id;
  delete from public.civil_chat_users where user_id = p_user_id;
end;
$$;

revoke all on function public.civil_delete_account_data(text) from public, anon, authenticated;
grant execute on function public.civil_delete_account_data(text) to service_role;

notify pgrst, 'reload schema';
