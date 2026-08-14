begin;

create extension if not exists pg_trgm with schema extensions;

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
    ranked.id,
    ranked.provider,
    ranked.provider_record_id,
    ranked.collection,
    ranked.source_type,
    ranked.title_local,
    ranked.title_en,
    ranked.abstract_local,
    ranked.abstract_en,
    ranked.authors,
    ranked.keywords,
    ranked.doi,
    ranked.canonical_url,
    ranked.journal_title,
    ranked.publisher,
    ranked.published_at,
    ranked.language,
    ranked.discipline,
    ranked.license,
    ranked.rights_status,
    ranked.access_level,
    ranked.evidence_status,
    ranked.document_id,
    ranked.source_updated_at,
    ranked.updated_at,
    ranked.score,
    ranked.total
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

notify pgrst, 'reload schema';

commit;
