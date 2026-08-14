begin;

-- Public discovery deliberately omits stored abstracts. The source catalog may
-- retain an abstract when its manifest permits storage, and the private search
-- function may use it for lexical matching, but snippet_display=false means the
-- text must not cross the Web or MCP response boundary.
create or replace function public.search_civil_source_catalog_public_v1(
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
set search_path = public
as $$
  select
    result.id,
    result.provider,
    result.provider_record_id,
    result.collection,
    result.source_type,
    result.title_local,
    result.title_en,
    result.authors,
    result.keywords,
    result.doi,
    result.canonical_url,
    result.journal_title,
    result.publisher,
    result.published_at,
    result.language,
    result.discipline,
    result.license,
    result.rights_status,
    result.access_level,
    result.evidence_status,
    result.document_id,
    result.source_updated_at,
    result.updated_at,
    result.match_score,
    result.total_count
  from public.search_civil_source_catalog_v1(
    search_query,
    filter_provider,
    filter_discipline,
    match_count,
    match_offset
  ) as result;
$$;

comment on function public.search_civil_source_catalog_public_v1(text, text, text, integer, integer)
is 'Rights-safe public catalog search. Stored abstracts are intentionally omitted from every result.';

revoke all on function public.search_civil_source_catalog_public_v1(text, text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.search_civil_source_catalog_public_v1(text, text, text, integer, integer)
to service_role;

notify pgrst, 'reload schema';

commit;
