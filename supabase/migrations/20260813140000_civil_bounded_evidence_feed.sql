begin;

-- Feed pagination and previews stay in Postgres so growing the corpus does not
-- turn one Explore request into a catalog-wide read plus N+1 evidence queries.
create or replace function public.list_civil_evidence_feed_v1(
  filter_name text default 'hot',
  filter_collection text default null,
  match_count integer default 12,
  match_offset integer default 0
)
returns table (
  id text,
  source text,
  source_pdf text,
  collection text,
  source_type text,
  parent_source_pdf text,
  paper_code text,
  page_start integer,
  page_end integer,
  proceeding_no integer,
  proceeding_year integer,
  discipline text,
  section_count integer,
  chunk_count integer,
  indexed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with input as (
    select
      case when filter_name in ('hot', 'recent', 'evidence') then filter_name else 'hot' end as safe_filter,
      least(greatest(coalesce(match_count, 12), 1), 30) as safe_count,
      least(greatest(coalesce(match_offset, 0), 0), 10000) as safe_offset
  ),
  eligible as (
    select
      document.*,
      count(*) over () as total,
      (
        coalesce(document.chunk_count, 0) * 2.0
        + coalesce(document.section_count, 0) * 1.2
        + greatest(
          0,
          45 - least(
            greatest(extract(epoch from (now() - document.indexed_at)) / 86400.0, 0),
            45
          )
        )
      ) as hot_score
    from public.civil_documents_v2 document, input
    where (filter_collection is null or filter_collection = '' or document.collection = filter_collection)
      and (input.safe_filter <> 'recent' or document.indexed_at >= now() - interval '45 days')
      and (input.safe_filter <> 'evidence' or document.chunk_count >= 6)
  )
  select
    eligible.id,
    eligible.source,
    eligible.source_pdf,
    eligible.collection,
    eligible.source_type,
    eligible.parent_source_pdf,
    eligible.paper_code,
    eligible.page_start,
    eligible.page_end,
    eligible.proceeding_no,
    eligible.proceeding_year,
    eligible.discipline,
    eligible.section_count,
    eligible.chunk_count,
    eligible.indexed_at,
    eligible.created_at,
    eligible.updated_at,
    eligible.total
  from eligible, input
  order by
    case when input.safe_filter = 'recent' then eligible.indexed_at end desc nulls last,
    case when input.safe_filter = 'evidence' then eligible.chunk_count end desc,
    case when input.safe_filter = 'evidence' then eligible.section_count end desc,
    case when input.safe_filter = 'hot' then eligible.hot_score end desc,
    eligible.id
  limit (select safe_count from input)
  offset (select safe_offset from input);
$$;

create or replace function public.civil_evidence_feed_facets_v1()
returns table (
  total bigint,
  total_sections bigint,
  total_chunks bigint,
  recent bigint,
  evidence bigint,
  ncce bigint,
  ce_project bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(document.section_count), 0)::bigint,
    coalesce(sum(document.chunk_count), 0)::bigint,
    count(*) filter (where document.indexed_at >= now() - interval '45 days')::bigint,
    count(*) filter (where document.chunk_count >= 6)::bigint,
    count(*) filter (where document.collection = 'ncce')::bigint,
    count(*) filter (where document.collection = 'ce_project')::bigint
  from public.civil_documents_v2 document;
$$;

create or replace function public.civil_evidence_feed_previews_v1(
  document_ids text[],
  sections_per_document integer default 8,
  chunks_per_document integer default 3
)
returns table (
  preview_kind text,
  document_id text,
  payload jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with requested as (
    select request.document_id, request.ordinality
    from unnest(coalesce(document_ids, array[]::text[])) with ordinality as request(document_id, ordinality)
    where request.ordinality <= 100
  ),
  limits as (
    select
      least(greatest(coalesce(sections_per_document, 8), 0), 10) as section_limit,
      least(greatest(coalesce(chunks_per_document, 3), 0), 5) as chunk_limit
  )
  select
    'section'::text,
    section.document_id,
    jsonb_build_object(
      'id', section.id,
      'document_id', section.document_id,
      'source', section.source,
      'collection', section.collection,
      'paper_code', section.paper_code,
      'page_start', section.page_start,
      'page_end', section.page_end,
      'discipline', section.discipline,
      'section_index', section.section_index,
      'section_title', section.section_title,
      'content', section.content
    )
  from requested
  cross join limits
  cross join lateral (
    select item.*
    from public.civil_sections_v2 item
    where item.document_id = requested.document_id and item.is_stale = false
    order by item.section_index
    limit limits.section_limit
  ) section
  union all
  select
    'chunk'::text,
    chunk.document_id,
    jsonb_build_object(
      'id', chunk.id,
      'document_id', chunk.document_id,
      'section_id', chunk.section_id,
      'source', chunk.source,
      'collection', chunk.collection,
      'paper_code', chunk.paper_code,
      'page_start', chunk.page_start,
      'page_end', chunk.page_end,
      'section_index', chunk.section_index,
      'section_title', chunk.section_title,
      'chunk_index', chunk.chunk_index,
      'content', chunk.content
    )
  from requested
  cross join limits
  cross join lateral (
    select item.*
    from public.civil_chunks_v2 item
    where item.document_id = requested.document_id and item.is_stale = false
    order by item.section_index, item.chunk_index
    limit limits.chunk_limit
  ) chunk;
$$;

revoke all on function public.list_civil_evidence_feed_v1(text, text, integer, integer)
from public, anon, authenticated;
revoke all on function public.civil_evidence_feed_facets_v1()
from public, anon, authenticated;
revoke all on function public.civil_evidence_feed_previews_v1(text[], integer, integer)
from public, anon, authenticated;

grant execute on function public.list_civil_evidence_feed_v1(text, text, integer, integer)
to service_role;
grant execute on function public.civil_evidence_feed_facets_v1()
to service_role;
grant execute on function public.civil_evidence_feed_previews_v1(text[], integer, integer)
to service_role;

notify pgrst, 'reload schema';

commit;
