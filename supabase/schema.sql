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
  folder_ids  uuid[] not null default '{}'::uuid[],
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
    'research_path_created', 'path_stage_completed',
    'workspace_started', 'workspace_run_completed',
    'session_export', 'evidence_export', 'review_exported', 'verified_research_outcome',
    'first_answer', 'onboarding_completed', 'user_returned', 'upgrade_intent'
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

create table if not exists public.civil_private_library_items (
  item_id text primary key,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  source text not null,
  title text not null,
  authors jsonb not null default '[]'::jsonb check (jsonb_typeof(authors) = 'array'),
  publication_year integer check (publication_year between 1600 and 2200),
  doi text,
  canonical_url text,
  import_type text not null check (import_type in ('pdf', 'doi', 'bibtex', 'ris', 'manual')),
  pages jsonb not null default '[]'::jsonb check (jsonb_typeof(pages) = 'array'),
  page_count integer not null default 0 check (page_count between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source)
);

create index if not exists civil_private_library_owner_updated_idx
on public.civil_private_library_items (owner_id, updated_at desc);

create unique index if not exists civil_private_library_owner_doi_idx
on public.civil_private_library_items (owner_id, lower(doi))
where doi is not null;

create table if not exists public.civil_living_review_watches (
  watch_id text primary key,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  query text not null,
  collection text not null default '' check (collection in ('', 'ce_project', 'ncce')),
  result_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(result_keys) = 'array'),
  result_count integer not null default 0 check (result_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  active boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, query, collection)
);

create index if not exists civil_living_review_owner_updated_idx
on public.civil_living_review_watches (owner_id, updated_at desc);

create table if not exists public.civil_mcp_access_keys (
  key_id text primary key,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null,
  label text not null default 'Research client',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists civil_mcp_access_keys_owner_created_idx
on public.civil_mcp_access_keys (owner_id, created_at desc);

create table if not exists public.civil_mcp_library_folders (
  folder_id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  parent_folder_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, folder_id),
  constraint civil_mcp_library_folders_owner_parent_fk
    foreign key (owner_id, parent_folder_id)
    references public.civil_mcp_library_folders(owner_id, folder_id)
);

create unique index if not exists civil_mcp_library_folders_owner_name_uq
on public.civil_mcp_library_folders (owner_id, lower(name), coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.civil_mcp_delete_library_folder(p_owner_id text, p_folder_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  update public.civil_mcp_library_folders set parent_folder_id = null, updated_at = now()
  where owner_id = p_owner_id and parent_folder_id = p_folder_id;
  update public.civil_paper_workspace_items set folder_ids = array_remove(folder_ids, p_folder_id), updated_at = now()
  where owner_id = p_owner_id and p_folder_id = any(folder_ids);
  delete from public.civil_mcp_library_folders where owner_id = p_owner_id and folder_id = p_folder_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

create or replace function public.civil_mcp_move_library_papers(
  p_owner_id text, p_sources text[], p_to_folder_id uuid default null, p_from_folder_id uuid default null
)
returns integer language plpgsql security definer set search_path = public as $$
declare v_updated integer;
begin
  if coalesce(array_length(p_sources, 1), 0) = 0 or array_length(p_sources, 1) > 50 then
    raise exception 'p_sources must contain between 1 and 50 values';
  end if;
  if p_to_folder_id is not null and not exists (
    select 1 from public.civil_mcp_library_folders where owner_id = p_owner_id and folder_id = p_to_folder_id
  ) then raise exception 'destination folder not found'; end if;
  if p_from_folder_id is not null and not exists (
    select 1 from public.civil_mcp_library_folders where owner_id = p_owner_id and folder_id = p_from_folder_id
  ) then raise exception 'source folder not found'; end if;
  update public.civil_paper_workspace_items
  set folder_ids = case
        when p_to_folder_id is null then array_remove(folder_ids, p_from_folder_id)
        when p_from_folder_id is null then array_append(array_remove(folder_ids, p_to_folder_id), p_to_folder_id)
        else array_append(array_remove(array_remove(folder_ids, p_from_folder_id), p_to_folder_id), p_to_folder_id)
      end,
      updated_at = now()
  where owner_id = p_owner_id and source = any(p_sources)
    and (p_from_folder_id is null or p_from_folder_id = any(folder_ids));
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.civil_mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare claims jsonb;
begin
  claims := event->'claims';
  if nullif(claims->>'client_id', '') is not null then
    claims := jsonb_set(claims, '{aud}', to_jsonb('https://civil-mcp-server.vercel.app/v2/mcp'::text));
    claims := jsonb_set(claims, '{civilmcp_mcp}', 'true'::jsonb);
    claims := jsonb_set(claims, '{civilmcp_permissions}', '["evidence:read","private:read","library:read","library:write"]'::jsonb);
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

alter table public.civil_private_library_items enable row level security;
alter table public.civil_living_review_watches enable row level security;
alter table public.civil_mcp_access_keys enable row level security;
alter table public.civil_mcp_library_folders enable row level security;
revoke all on table public.civil_private_library_items from public, anon, authenticated;
revoke all on table public.civil_living_review_watches from public, anon, authenticated;
revoke all on table public.civil_mcp_access_keys from public, anon, authenticated;
revoke all on table public.civil_mcp_library_folders from public, anon, authenticated;
grant all on table public.civil_private_library_items to service_role;
grant all on table public.civil_living_review_watches to service_role;
grant all on table public.civil_mcp_access_keys to service_role;
grant all on table public.civil_mcp_library_folders to service_role;
revoke all on function public.civil_mcp_delete_library_folder(text, uuid) from public, anon, authenticated;
revoke all on function public.civil_mcp_move_library_papers(text, text[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.civil_mcp_delete_library_folder(text, uuid) to service_role;
grant execute on function public.civil_mcp_move_library_papers(text, text[], uuid, uuid) to service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.civil_mcp_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.civil_mcp_access_token_hook(jsonb) from public, anon, authenticated;

create table if not exists public.civil_mcp_usage_accounts (
  owner_id text primary key references public.civil_chat_users(user_id) on delete cascade,
  plan_snapshot text not null default 'free' check (plan_snapshot in ('free', 'founder_pro')),
  included_units integer not null default 500 check (included_units in (500, 5000)),
  used_units integer not null default 0 check (used_units >= 0),
  period_start timestamptz not null default date_trunc('month', now()),
  period_end timestamptz not null default date_trunc('month', now()) + interval '1 month',
  updated_at timestamptz not null default now(),
  check (period_end > period_start)
);

create table if not exists public.civil_mcp_usage_ledger (
  request_id text primary key check (char_length(request_id) between 8 and 128),
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  tool_name text not null check (char_length(tool_name) between 1 and 80),
  charged_units integer not null check (charged_units between 1 and 10),
  period_start timestamptz not null,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists civil_mcp_usage_ledger_owner_created_idx
on public.civil_mcp_usage_ledger (owner_id, created_at desc);

create or replace function public.civil_get_mcp_usage(p_owner_id text)
returns table (plan text, included_units integer, used_units integer, remaining_units integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_plan text := 'free';
  v_included integer := 500;
  v_account public.civil_mcp_usage_accounts%rowtype;
begin
  if p_owner_id is null or length(trim(p_owner_id)) < 1 or length(p_owner_id) > 128 then
    raise exception 'valid owner id is required';
  end if;
  if exists (
    select 1 from public.civil_billing_accounts b where b.user_id = p_owner_id
      and b.plan = 'founder_pro' and b.status in ('active', 'trialing') and b.current_period_end > v_now
  ) then v_plan := 'founder_pro'; v_included := 5000; end if;
  insert into public.civil_mcp_usage_accounts (owner_id, plan_snapshot, included_units)
  values (p_owner_id, v_plan, v_included) on conflict (owner_id) do nothing;
  select * into v_account from public.civil_mcp_usage_accounts where owner_id = p_owner_id for update;
  update public.civil_mcp_usage_accounts as a
  set plan_snapshot = v_plan, included_units = v_included,
      used_units = case when a.period_end <= v_now then 0 else a.used_units end,
      period_start = case when a.period_end <= v_now then date_trunc('month', v_now) else a.period_start end,
      period_end = case when a.period_end <= v_now then date_trunc('month', v_now) + interval '1 month' else a.period_end end,
      updated_at = v_now
  where a.owner_id = p_owner_id returning a.* into v_account;
  return query select v_account.plan_snapshot, v_account.included_units, v_account.used_units,
    greatest(0, v_account.included_units - v_account.used_units), v_account.period_end;
end;
$$;

create or replace function public.civil_consume_mcp_units(p_owner_id text, p_tool_name text, p_request_id text)
returns table (
  allowed boolean, charged integer, plan text, included_units integer, used_units integer,
  remaining_units integer, reset_at timestamptz, reason text
)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cost integer;
  v_plan text := 'free';
  v_included integer := 500;
  v_account public.civil_mcp_usage_accounts%rowtype;
begin
  if p_owner_id is null or length(trim(p_owner_id)) < 1 or length(p_owner_id) > 128 then
    raise exception 'valid owner id is required';
  end if;
  if p_request_id is null or char_length(p_request_id) not between 8 and 128 then
    raise exception 'valid server request id is required';
  end if;
  v_cost := case p_tool_name
    when 'discover_research' then 3 when 'get_paper' then 1 when 'query_papers' then 2
    when 'compare_papers' then 5 when 'map_citation_network' then 3
    when 'get_evidence_snapshot' then 2 when 'list_library' then 1
    when 'list_private_sources' then 1 when 'create_library_folder' then 0
    when 'rename_library_folder' then 0 when 'delete_library_folder' then 0
    when 'save_papers' then 0 when 'move_papers' then 0 when 'remove_papers' then 0
    else null end;
  if v_cost is null then raise exception 'unknown public MCP tool'; end if;
  if exists (
    select 1 from public.civil_billing_accounts b where b.user_id = p_owner_id
      and b.plan = 'founder_pro' and b.status in ('active', 'trialing') and b.current_period_end > v_now
  ) then v_plan := 'founder_pro'; v_included := 5000; end if;
  insert into public.civil_mcp_usage_accounts (owner_id, plan_snapshot, included_units)
  values (p_owner_id, v_plan, v_included) on conflict (owner_id) do nothing;
  select * into v_account from public.civil_mcp_usage_accounts where owner_id = p_owner_id for update;
  update public.civil_mcp_usage_accounts as a
  set plan_snapshot = v_plan, included_units = v_included,
      used_units = case when a.period_end <= v_now then 0 else a.used_units end,
      period_start = case when a.period_end <= v_now then date_trunc('month', v_now) else a.period_start end,
      period_end = case when a.period_end <= v_now then date_trunc('month', v_now) + interval '1 month' else a.period_end end,
      updated_at = v_now
  where a.owner_id = p_owner_id returning a.* into v_account;
  if exists (select 1 from public.civil_mcp_usage_ledger where request_id = p_request_id) then
    return query select false, 0, v_account.plan_snapshot, v_account.included_units, v_account.used_units,
      greatest(0, v_account.included_units - v_account.used_units), v_account.period_end, 'already_consumed'::text;
    return;
  end if;
  if v_account.used_units + v_cost > v_account.included_units then
    return query select false, 0, v_account.plan_snapshot, v_account.included_units, v_account.used_units,
      greatest(0, v_account.included_units - v_account.used_units), v_account.period_end, 'units_exhausted'::text;
    return;
  end if;
  if v_cost > 0 then
    insert into public.civil_mcp_usage_ledger (request_id, owner_id, tool_name, charged_units, period_start)
    values (p_request_id, p_owner_id, p_tool_name, v_cost, v_account.period_start);
    update public.civil_mcp_usage_accounts as a set used_units = a.used_units + v_cost, updated_at = v_now
    where a.owner_id = p_owner_id returning a.* into v_account;
  end if;
  return query select true, v_cost, v_account.plan_snapshot, v_account.included_units, v_account.used_units,
    greatest(0, v_account.included_units - v_account.used_units), v_account.period_end, 'consumed'::text;
end;
$$;

create or replace function public.civil_refund_mcp_units(p_owner_id text, p_request_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_entry public.civil_mcp_usage_ledger%rowtype;
begin
  select * into v_entry from public.civil_mcp_usage_ledger
  where request_id = p_request_id and owner_id = p_owner_id for update;
  if not found or v_entry.refunded_at is not null then return false; end if;
  update public.civil_mcp_usage_ledger set refunded_at = clock_timestamp() where request_id = p_request_id;
  update public.civil_mcp_usage_accounts
  set used_units = greatest(0, used_units - v_entry.charged_units), updated_at = clock_timestamp()
  where owner_id = p_owner_id and period_start = v_entry.period_start;
  return true;
end;
$$;

create or replace function public.civil_mcp_usage_readiness()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'usage_accounts_table', to_regclass('public.civil_mcp_usage_accounts') is not null,
    'usage_ledger_table', to_regclass('public.civil_mcp_usage_ledger') is not null,
    'get_usage_rpc', to_regprocedure('public.civil_get_mcp_usage(text)') is not null,
    'consume_units_rpc', to_regprocedure('public.civil_consume_mcp_units(text,text,text)') is not null,
    'refund_units_rpc', to_regprocedure('public.civil_refund_mcp_units(text,text)') is not null
  );
$$;

alter table public.civil_mcp_usage_accounts enable row level security;
alter table public.civil_mcp_usage_ledger enable row level security;
revoke all on table public.civil_mcp_usage_accounts from public, anon, authenticated;
revoke all on table public.civil_mcp_usage_ledger from public, anon, authenticated;
grant all on table public.civil_mcp_usage_accounts to service_role;
grant all on table public.civil_mcp_usage_ledger to service_role;
revoke all on function public.civil_get_mcp_usage(text) from public, anon, authenticated;
revoke all on function public.civil_consume_mcp_units(text, text, text) from public, anon, authenticated;
revoke all on function public.civil_refund_mcp_units(text, text) from public, anon, authenticated;
revoke all on function public.civil_mcp_usage_readiness() from public, anon, authenticated;
grant execute on function public.civil_get_mcp_usage(text) to service_role;
grant execute on function public.civil_consume_mcp_units(text, text, text) to service_role;
grant execute on function public.civil_refund_mcp_units(text, text) to service_role;
grant execute on function public.civil_mcp_usage_readiness() to service_role;

notify pgrst, 'reload schema';
