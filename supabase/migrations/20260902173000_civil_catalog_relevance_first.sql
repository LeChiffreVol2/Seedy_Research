begin;

-- A rights-cleared item should win a tie, but it must not outrank a much more
-- relevant Thai discovery record. The previous native-first ordering made an
-- exact metadata title effectively undiscoverable whenever any extracted item
-- shared one generic query term.
create or replace function public.search_civil_source_catalog_public_v2(
  search_query text,
  filter_provider text default null,
  filter_discipline text default null,
  filter_evidence_status text default null,
  native_first boolean default false,
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
  terms as materialized (
    select distinct token
    from input,
    lateral unnest(regexp_split_to_array(btrim(phrase), '[[:space:]]+')) as token
    where char_length(token) >= 2
    limit 8
  ),
  candidates as materialized (
    select
      catalog.id,
      catalog.provider,
      catalog.provider_record_id,
      catalog.collection,
      catalog.source_type,
      catalog.title_local,
      catalog.title_en,
      catalog.authors,
      catalog.keywords,
      catalog.doi,
      catalog.canonical_url,
      catalog.journal_title,
      catalog.publisher,
      catalog.published_at,
      catalog.language,
      catalog.discipline,
      catalog.license,
      catalog.rights_status,
      catalog.access_level,
      catalog.evidence_status,
      catalog.document_id,
      catalog.source_updated_at,
      catalog.updated_at,
      (
        case when exists (
          select 1 from terms
          where lower(coalesce(catalog.title_local, '') || ' ' || coalesce(catalog.title_en, ''))
            like '%' || token || '%'
        ) then 12 else 0 end
        + 4 * (select count(*) from terms where lower(coalesce(catalog.title_local, '') || ' ' || coalesce(catalog.title_en, '')) like '%' || token || '%')
        + 3 * (select count(*) from terms where lower(coalesce(catalog.keywords::text, '') || ' ' || coalesce(catalog.authors::text, '')) like '%' || token || '%')
        + 2 * (select count(*) from terms where lower(coalesce(catalog.journal_title, '') || ' ' || coalesce(catalog.publisher, '')) like '%' || token || '%')
        + 1 * (select count(*) from terms where lower(coalesce(catalog.abstract_local, '') || ' ' || coalesce(catalog.abstract_en, '')) like '%' || token || '%')
      )::double precision as score,
      case
        when catalog.evidence_status in ('extracted', 'indexed') then 0
        when catalog.evidence_status = 'metadata_only' then 1
        else 2
      end as native_rank
    from public.civil_source_catalog catalog, input
    where catalog.evidence_status <> 'removed'
      and (filter_provider is null or filter_provider = '' or catalog.provider = filter_provider)
      and (filter_discipline is null or filter_discipline = '' or catalog.discipline = filter_discipline)
      and (filter_evidence_status is null or filter_evidence_status = '' or catalog.evidence_status = filter_evidence_status)
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
  order by
    ranked.score desc,
    case when native_first then ranked.native_rank else 0 end,
    ranked.published_at desc nulls last,
    ranked.id
  limit (select safe_count from input)
  offset (select safe_offset from input);
$$;

comment on function public.search_civil_source_catalog_public_v2(text,text,text,text,boolean,integer,integer)
is 'Bounded rights-safe catalog search ordered by relevance, with native-reader status used only as a tie-breaker.';

revoke all on function public.search_civil_source_catalog_public_v2(text,text,text,text,boolean,integer,integer)
from public, anon, authenticated;
grant execute on function public.search_civil_source_catalog_public_v2(text,text,text,text,boolean,integer,integer)
to service_role;

notify pgrst, 'reload schema';

commit;
