begin;

-- Bound candidate work per term before ranking. The first fallback version
-- could join every matching row for broad terms and hit PostgREST's statement
-- timeout. These functions cap intermediate rows while preserving the public
-- result contract and exact-page provenance.
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
      select
        s.id,
        (lower(s.section_title) like '%' || t.term || '%')::int as title_hit
      from public.civil_sections_v2 s
      where not s.is_stale
        and (filter_disc is null or s.discipline = filter_disc)
        and (filter_collection is null or s.collection = filter_collection)
        and lower(s.section_title || ' ' || s.content || ' ' || s.source) like '%' || t.term || '%'
      order by title_hit desc, s.page_start nulls last, s.id
      limit 160
    ) candidate
  ),
  ranked as (
    select
      h.id,
      count(*)::float as matched_terms,
      sum(h.title_hit)::float as title_hits
    from candidate_hits h
    group by h.id
  ),
  term_total as (
    select greatest(1, count(*))::float as value from terms
  )
  select
    s.id,
    s.document_id,
    s.source,
    s.collection,
    s.source_type,
    s.parent_source_pdf,
    s.paper_code,
    s.page_start,
    s.page_end,
    s.proceeding_no,
    s.proceeding_year,
    s.discipline,
    s.section_index,
    s.section_title,
    s.content,
    least(0.95, 0.25 + 0.55 * (r.matched_terms / tt.value) + 0.15 * least(1, r.title_hits))::float as similarity
  from ranked r
  join public.civil_sections_v2 s on s.id = r.id
  cross join term_total tt
  order by similarity desc, r.title_hits desc, s.page_start nulls last, s.source
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
      select
        c.id,
        (lower(c.section_title) like '%' || t.term || '%')::int as title_hit
      from public.civil_chunks_v2 c
      where not c.is_stale
        and (filter_disc is null or c.discipline = filter_disc)
        and (filter_document_ids is null or c.document_id = any(filter_document_ids))
        and (filter_section_ids is null or c.section_id = any(filter_section_ids))
        and (filter_collection is null or c.collection = filter_collection)
        and lower(c.section_title || ' ' || c.content || ' ' || c.source) like '%' || t.term || '%'
      order by title_hit desc, c.page_start nulls last, c.id
      limit 200
    ) candidate
  ),
  ranked as (
    select
      h.id,
      count(*)::float as matched_terms,
      sum(h.title_hit)::float as title_hits
    from candidate_hits h
    group by h.id
  ),
  term_total as (
    select greatest(1, count(*))::float as value from terms
  )
  select
    c.id,
    c.document_id,
    c.section_id,
    c.source,
    c.collection,
    c.source_type,
    c.parent_source_pdf,
    c.paper_code,
    c.page_start,
    c.page_end,
    c.proceeding_no,
    c.proceeding_year,
    c.discipline,
    c.section_index,
    c.section_title,
    c.chunk_index,
    c.content,
    least(0.95, 0.25 + 0.55 * (r.matched_terms / tt.value) + 0.15 * least(1, r.title_hits))::float as similarity
  from ranked r
  join public.civil_chunks_v2 c on c.id = r.id
  cross join term_total tt
  order by similarity desc, r.title_hits desc, c.page_start nulls last, c.source, c.chunk_index
  limit greatest(1, least(match_count, 50));
$$;

notify pgrst, 'reload schema';

commit;
