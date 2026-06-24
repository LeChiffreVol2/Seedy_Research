create extension if not exists vector;

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
  mode         text not null default 'mcp',
  model        text not null default 'gpt-5-mini-2025-08-07',
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

create table if not exists civil_chat_feedback (
  feedback_id    text primary key,
  trace_id       text references civil_chat_traces(trace_id) on delete set null,
  session_id     text references civil_chat_sessions(session_id) on delete set null,
  user_id        text references civil_chat_users(user_id) on delete set null,
  message_id     text,
  rating         text not null check (rating in ('up', 'down')),
  categories     text[] not null default '{}'::text[],
  correction     text,
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

notify pgrst, 'reload schema';
