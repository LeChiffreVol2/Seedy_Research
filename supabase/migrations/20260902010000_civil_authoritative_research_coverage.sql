begin;

-- Coverage must be derived from production evidence, never from the three-paper
-- deterministic Web fixture. A native paper counts only when its active asset
-- passes the rights gate and the stored page cardinality matches its manifest.
create or replace function public.civil_research_coverage_v1()
returns table (
  provider text,
  records bigint,
  metadata_only bigint,
  page_citable bigint,
  native_full_paper bigint,
  source_hosted_full_paper bigint,
  endpoint_observed bigint,
  freshness date
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with catalog as (
    select
      c.provider,
      count(*)::bigint as records,
      count(*) filter (where c.evidence_status = 'metadata_only')::bigint as metadata_only,
      count(*) filter (
        where c.evidence_status = 'metadata_only'
          and c.pdf_url ~ '^https://'
      )::bigint as source_hosted_full_paper,
      count(distinct split_part(c.provider_record_id, ':', 2)) filter (
        where c.provider_record_id ~ '^oai:[a-z0-9.-]+:'
      )::bigint as endpoint_observed,
      max(c.updated_at)::date as freshness
    from public.civil_source_catalog c
    where c.evidence_status <> 'removed'
    group by c.provider
  ),
  page_counts as (
    select p.asset_id, count(*)::integer as stored_pages
    from public.civil_fulltext_pages p
    group by p.asset_id
  ),
  native as (
    select
      a.provider,
      count(*)::bigint as native_full_paper,
      max(a.updated_at)::date as freshness
    from public.civil_work_assets a
    join page_counts p on p.asset_id = a.asset_id and p.stored_pages = a.page_count
    where a.asset_status = 'active'
      and a.reader_access_mode = 'native_verified'
      and a.asset_kind in ('fulltext_pdf', 'accepted_manuscript', 'repository_copy', 'author_manuscript', 'publisher_html')
      and a.rights_status in ('open_license_verified', 'permission_granted')
      and a.rights_checked_at is not null
      and a.rights_verified_at >= a.rights_checked_at
      and nullif(btrim(coalesce(a.license_expression, '')), '') is not null
      and nullif(btrim(coalesce(a.rights_provenance ->> 'basis', '')), '') is not null
      and nullif(btrim(coalesce(a.rights_provenance ->> 'source', '')), '') is not null
      and a.rights_actions ->> 'asset_storage' = 'true'
      and a.rights_actions ->> 'text_extraction' = 'true'
      and a.rights_actions ->> 'native_fulltext_display' = 'true'
      and a.content_sha256 ~ '^[0-9a-f]{64}$'
      and (a.origin_url ~ '^https://' or a.storage_object_path is not null)
      and a.page_count > 0
    group by a.provider
  ),
  legacy_endpoints as (
    select
      case
        when d.collection = 'ncce' then 'ncce'
        when d.collection = 'ce_project' then 'student_transport_projects'
        else null
      end as provider,
      count(distinct case
        when d.collection = 'ncce' then d.proceeding_no::text
        when d.collection = 'ce_project' then d.collection
        else null
      end)::bigint as endpoint_observed
    from public.civil_documents_v2 d
    where d.collection in ('ncce', 'ce_project')
    group by 1
  )
  select
    c.provider,
    c.records,
    c.metadata_only,
    coalesce(n.native_full_paper, 0)::bigint as page_citable,
    coalesce(n.native_full_paper, 0)::bigint as native_full_paper,
    c.source_hosted_full_paper,
    greatest(c.endpoint_observed, coalesce(e.endpoint_observed, 0))::bigint as endpoint_observed,
    greatest(c.freshness, n.freshness) as freshness
  from catalog c
  left join native n using (provider)
  left join legacy_endpoints e using (provider)
  order by c.provider;
$$;

comment on function public.civil_research_coverage_v1()
is 'Server-only authoritative provider coverage derived from active catalog, asset-rights, and exact page-cardinality evidence.';

revoke all on function public.civil_research_coverage_v1()
from public, anon, authenticated;
grant execute on function public.civil_research_coverage_v1()
to service_role;

-- Extracted native-reader records are page-citable even when they do not have
-- a legacy civil_documents_v2 row. Metadata-only records remain non-citable.
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
      where catalog.evidence_status in ('extracted', 'indexed')
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
