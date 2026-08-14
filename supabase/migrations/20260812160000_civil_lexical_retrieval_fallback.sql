begin;

create extension if not exists pg_trgm with schema extensions;

create index if not exists civil_sections_v2_lexical_trgm_idx
on public.civil_sections_v2
using gin ((lower(section_title || ' ' || content || ' ' || source)) extensions.gin_trgm_ops)
where is_stale = false;

create index if not exists civil_chunks_v2_lexical_trgm_idx
on public.civil_chunks_v2
using gin ((lower(section_title || ' ' || content || ' ' || source)) extensions.gin_trgm_ops)
where is_stale = false;

create or replace function public.search_civil_sections_lexical_v2(
  search_query      text,
  match_count       int  default 20,
  filter_disc       text default null,
  filter_collection text default null
)
returns table (
  id               text,
  document_id      text,
  source           text,
  collection       text,
  source_type      text,
  parent_source_pdf text,
  paper_code       text,
  page_start       integer,
  page_end         integer,
  proceeding_no    integer,
  proceeding_year  integer,
  discipline       text,
  section_index    integer,
  section_title    text,
  content          text,
  similarity       float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with terms as (
    select distinct lower(term) as term
    from regexp_split_to_table(left(trim(search_query), 500), '[[:space:][:punct:]]+') as term
    where length(term) >= 2
    limit 12
  ),
  term_total as (
    select greatest(1, count(*))::float as value from terms
  ),
  ranked as (
    select
      s.*,
      count(*)::float as matched_terms,
      count(*) filter (where lower(s.section_title) like '%' || t.term || '%')::float as title_hits
    from public.civil_sections_v2 s
    join terms t
      on lower(s.section_title || ' ' || s.content || ' ' || s.source) like '%' || t.term || '%'
    where not s.is_stale
      and (filter_disc is null or s.discipline = filter_disc)
      and (filter_collection is null or s.collection = filter_collection)
    group by s.id
  )
  select
    r.id,
    r.document_id,
    r.source,
    r.collection,
    r.source_type,
    r.parent_source_pdf,
    r.paper_code,
    r.page_start,
    r.page_end,
    r.proceeding_no,
    r.proceeding_year,
    r.discipline,
    r.section_index,
    r.section_title,
    r.content,
    least(0.95, 0.25 + 0.55 * (r.matched_terms / tt.value) + 0.15 * least(1, r.title_hits))::float as similarity
  from ranked r
  cross join term_total tt
  order by similarity desc, r.title_hits desc, r.page_start nulls last, r.source
  limit greatest(1, least(match_count, 50));
$$;

create or replace function public.search_civil_chunks_lexical_v2(
  search_query        text,
  match_count         int    default 8,
  filter_disc         text   default null,
  filter_document_ids text[] default null,
  filter_section_ids  text[] default null,
  filter_collection   text   default null
)
returns table (
  id               text,
  document_id      text,
  section_id       text,
  source           text,
  collection       text,
  source_type      text,
  parent_source_pdf text,
  paper_code       text,
  page_start       integer,
  page_end         integer,
  proceeding_no    integer,
  proceeding_year  integer,
  discipline       text,
  section_index    integer,
  section_title    text,
  chunk_index      integer,
  content          text,
  similarity       float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with terms as (
    select distinct lower(term) as term
    from regexp_split_to_table(left(trim(search_query), 500), '[[:space:][:punct:]]+') as term
    where length(term) >= 2
    limit 12
  ),
  term_total as (
    select greatest(1, count(*))::float as value from terms
  ),
  ranked as (
    select
      c.*,
      count(*)::float as matched_terms,
      count(*) filter (where lower(c.section_title) like '%' || t.term || '%')::float as title_hits
    from public.civil_chunks_v2 c
    join terms t
      on lower(c.section_title || ' ' || c.content || ' ' || c.source) like '%' || t.term || '%'
    where not c.is_stale
      and (filter_disc is null or c.discipline = filter_disc)
      and (filter_document_ids is null or c.document_id = any(filter_document_ids))
      and (filter_section_ids is null or c.section_id = any(filter_section_ids))
      and (filter_collection is null or c.collection = filter_collection)
    group by c.id
  )
  select
    r.id,
    r.document_id,
    r.section_id,
    r.source,
    r.collection,
    r.source_type,
    r.parent_source_pdf,
    r.paper_code,
    r.page_start,
    r.page_end,
    r.proceeding_no,
    r.proceeding_year,
    r.discipline,
    r.section_index,
    r.section_title,
    r.chunk_index,
    r.content,
    least(0.95, 0.25 + 0.55 * (r.matched_terms / tt.value) + 0.15 * least(1, r.title_hits))::float as similarity
  from ranked r
  cross join term_total tt
  order by similarity desc, r.title_hits desc, r.page_start nulls last, r.source, r.chunk_index
  limit greatest(1, least(match_count, 50));
$$;

revoke all on function public.search_civil_sections_lexical_v2(text, int, text, text) from public, anon, authenticated;
revoke all on function public.search_civil_chunks_lexical_v2(text, int, text, text[], text[], text) from public, anon, authenticated;
grant execute on function public.search_civil_sections_lexical_v2(text, int, text, text) to service_role;
grant execute on function public.search_civil_chunks_lexical_v2(text, int, text, text[], text[], text) to service_role;

create or replace function public.civil_backbone_readiness()
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

revoke all on function public.civil_backbone_readiness() from public, anon, authenticated;
grant execute on function public.civil_backbone_readiness() to service_role;

notify pgrst, 'reload schema';

commit;
