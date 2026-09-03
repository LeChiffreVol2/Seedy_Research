begin;

-- Provider membership and topical/identity facets are deliberately separate.
-- NULL means the facet has not been assessed; false is an explicit negative.
alter table public.civil_source_catalog
  add column if not exists publication_country text,
  add column if not exists thai_published boolean,
  add column if not exists thailand_context boolean,
  add column if not exists thai_language boolean,
  add column if not exists thai_affiliated boolean,
  add column if not exists research_facets_basis jsonb not null default '{}'::jsonb,
  add column if not exists search_text text not null default '';

update public.civil_source_catalog
set
  publication_country = case
    when provider in ('tci_thaijo', 'tci_citation', 'tnrr', 'thailis_tdc', 'thai_conference', 'thai_ir', 'ncce', 'student_transport_projects') then 'TH'
    else publication_country
  end,
  thai_published = case
    when provider in ('tci_thaijo', 'tci_citation', 'tnrr', 'thailis_tdc', 'thai_conference', 'thai_ir', 'ncce', 'student_transport_projects') then true
    when provider = 'pmc_oa' then false
    else thai_published
  end,
  thai_language = case
    when lower(coalesce(language, '')) in ('th', 'tha', 'thai') then true
    when language is not null and btrim(language) <> '' then false
    else thai_language
  end,
  thai_affiliated = case
    when provider = 'pmc_oa' then true
    else thai_affiliated
  end,
  research_facets_basis = research_facets_basis || jsonb_strip_nulls(jsonb_build_object(
    'thai_published', case
      when provider in ('tci_thaijo', 'tci_citation', 'tnrr', 'thailis_tdc', 'thai_conference', 'thai_ir', 'ncce', 'student_transport_projects') then 'provider_membership'
      when provider = 'pmc_oa' then 'global_comparison_provider'
      else null
    end,
    'thai_language', case when language is not null and btrim(language) <> '' then 'provider_language' else null end,
    'thai_affiliated', case when provider = 'pmc_oa' then 'validated_pmc_affiliation_cohort' else null end
  ));

create or replace function public.civil_source_catalog_refresh_search_text()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_text := lower(concat_ws(' ',
    new.title_local,
    new.title_en,
    new.journal_title,
    new.publisher,
    new.authors::text,
    new.keywords::text,
    new.abstract_local,
    new.abstract_en
  ));
  return new;
end;
$$;

drop trigger if exists civil_source_catalog_refresh_search_text_trigger
  on public.civil_source_catalog;
create trigger civil_source_catalog_refresh_search_text_trigger
before insert or update of title_local, title_en, journal_title, publisher,
  authors, keywords, abstract_local, abstract_en
on public.civil_source_catalog
for each row execute function public.civil_source_catalog_refresh_search_text();

update public.civil_source_catalog
set search_text = lower(concat_ws(' ',
  title_local,
  title_en,
  journal_title,
  publisher,
  authors::text,
  keywords::text,
  abstract_local,
  abstract_en
));

create index if not exists civil_source_catalog_search_vector_idx
  on public.civil_source_catalog
  using gin (to_tsvector('simple', search_text))
  where evidence_status <> 'removed';

create index if not exists civil_source_catalog_thai_published_idx
  on public.civil_source_catalog (thai_published, provider, published_at desc)
  where evidence_status <> 'removed';
create index if not exists civil_source_catalog_thailand_context_idx
  on public.civil_source_catalog (thailand_context, published_at desc)
  where thailand_context is true and evidence_status <> 'removed';

create table if not exists public.civil_research_cases (
  case_id text primary key check (case_id ~ '^case_[a-z0-9_-]{8,80}$'),
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  question text not null check (char_length(question) between 8 and 500),
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  selected_sources text[] not null default '{}'::text[] check (cardinality(selected_sources) <= 50),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_typeof(state) = 'object')
);

create index if not exists civil_research_cases_owner_updated_idx
  on public.civil_research_cases (owner_id, updated_at desc);

create table if not exists public.civil_research_case_reviews (
  review_id uuid primary key default gen_random_uuid(),
  case_id text not null references public.civil_research_cases(case_id) on delete cascade,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  source text not null check (char_length(source) between 1 and 320),
  evidence_id text not null check (char_length(evidence_id) between 1 and 120),
  page_anchor text not null check (char_length(page_anchor) between 1 and 180),
  decision text not null check (decision in ('accepted', 'rejected')),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, source, evidence_id)
);

create index if not exists civil_research_case_reviews_case_updated_idx
  on public.civil_research_case_reviews (case_id, updated_at desc);

create table if not exists public.civil_visibility_correction_suggestions (
  suggestion_id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  source text not null check (char_length(source) between 1 and 320),
  kind text not null check (kind in ('match', 'metadata_correction', 'review_request')),
  proposed_external_work_id text check (proposed_external_work_id is null or char_length(proposed_external_work_id) <= 180),
  proposed_doi text check (proposed_doi is null or char_length(proposed_doi) <= 180),
  note text not null default '' check (char_length(note) <= 1500),
  status text not null default 'pending' check (status in ('pending', 'under_review', 'accepted', 'rejected', 'duplicate')),
  steward_note text not null default '' check (char_length(steward_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists civil_visibility_corrections_owner_updated_idx
  on public.civil_visibility_correction_suggestions (owner_id, updated_at desc);
create index if not exists civil_visibility_corrections_steward_queue_idx
  on public.civil_visibility_correction_suggestions (status, updated_at)
  where status in ('pending', 'under_review');

alter table public.civil_research_cases enable row level security;
alter table public.civil_research_case_reviews enable row level security;
alter table public.civil_visibility_correction_suggestions enable row level security;
revoke all on table public.civil_research_cases from public, anon, authenticated;
revoke all on table public.civil_research_case_reviews from public, anon, authenticated;
revoke all on table public.civil_visibility_correction_suggestions from public, anon, authenticated;
grant select, insert, update, delete on table public.civil_research_cases to service_role;
grant select, insert, update, delete on table public.civil_research_case_reviews to service_role;
grant select, insert, update, delete on table public.civil_visibility_correction_suggestions to service_role;

-- Search v3 adds the explicit membership facets and removes generic stop words.
-- It returns a bounded candidate window; the application applies the stricter
-- shared relevance contract before results become visible or agent-readable.
create or replace function public.search_civil_source_catalog_public_v3(
  search_query text,
  filter_provider text default null,
  filter_discipline text default null,
  filter_evidence_status text default null,
  filter_thailand_context boolean default null,
  filter_thai_language boolean default null,
  filter_thai_affiliated boolean default null,
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
  publication_country text,
  thai_published boolean,
  thailand_context boolean,
  thai_language boolean,
  thai_affiliated boolean,
  research_facets_basis jsonb,
  match_score double precision,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with input as (
    select
      left(regexp_replace(lower(coalesce(search_query, '')), '[^[:alnum:]ก-๙]+', ' ', 'g'), 180) as phrase,
      least(greatest(coalesce(match_count, 20), 1), 30) as safe_count,
      least(greatest(coalesce(match_offset, 0), 0), 10000) as safe_offset
  ),
  terms as materialized (
    select distinct token
    from input,
    lateral unnest(regexp_split_to_array(btrim(phrase), '[[:space:]]+')) as token
    where char_length(token) >= 2
      and token <> all (array[
        'a','an','and','are','as','at','be','beyond','by','can','current','do','does',
        'for','from','how','in','into','is','it','of','on','or','paper','papers',
        'research','should','studies','study','test','testing','the','this','to','use',
        'using','what','with','การ','ของ','จาก','ด้วย','ที่','และ','ใน','เป็น','เพื่อ',
        'ศึกษา','การศึกษา','งานวิจัย','วิจัย','อย่างไร'
      ]::text[])
    limit 12
  ),
  search_expression as materialized (
    select case
      when count(*) = 0 then null::tsquery
      else to_tsquery('simple', string_agg(token || ':*', ' | ' order by token))
    end as query
    from terms
  ),
  scored as materialized (
    select
      catalog.*,
      (select count(*) from terms where lower(
        coalesce(catalog.title_local, '') || ' ' || coalesce(catalog.title_en, '') || ' ' ||
        coalesce(catalog.keywords::text, '') || ' ' || coalesce(catalog.abstract_local, '') || ' ' ||
        coalesce(catalog.abstract_en, '')
      ) like '%' || token || '%')::integer as matched_terms,
      (select count(*) from terms)::integer as query_terms,
      (
        case when btrim((select phrase from input)) <> '' and lower(
          coalesce(catalog.title_local, '') || ' ' || coalesce(catalog.title_en, '')
        ) like '%' || btrim((select phrase from input)) || '%' then 24 else 0 end
        + 6 * (select count(*) from terms where lower(coalesce(catalog.title_local, '') || ' ' || coalesce(catalog.title_en, '')) like '%' || token || '%')
        + 3 * (select count(*) from terms where lower(coalesce(catalog.keywords::text, '')) like '%' || token || '%')
        + 1 * (select count(*) from terms where lower(coalesce(catalog.abstract_local, '') || ' ' || coalesce(catalog.abstract_en, '')) like '%' || token || '%')
      )::double precision as score,
      case when catalog.evidence_status in ('extracted', 'indexed') then 0 when catalog.evidence_status = 'metadata_only' then 1 else 2 end as native_rank
    from public.civil_source_catalog catalog
    cross join search_expression
    where catalog.evidence_status <> 'removed'
      and (search_expression.query is null or to_tsvector('simple', catalog.search_text) @@ search_expression.query)
      and (filter_provider is null or filter_provider = '' or catalog.provider = filter_provider)
      and (filter_discipline is null or filter_discipline = '' or catalog.discipline = filter_discipline)
      and (filter_evidence_status is null or filter_evidence_status = '' or catalog.evidence_status = filter_evidence_status)
      and (filter_thailand_context is null or catalog.thailand_context = filter_thailand_context)
      and (filter_thai_language is null or catalog.thai_language = filter_thai_language)
      and (filter_thai_affiliated is null or catalog.thai_affiliated = filter_thai_affiliated)
  ),
  candidates as (
    select scored.*, count(*) over () as total
    from scored
    where query_terms = 0
       or (query_terms < 5 and matched_terms >= 1)
       or (query_terms >= 5 and matched_terms >= 2)
  )
  select
    candidates.id, candidates.provider, candidates.provider_record_id,
    candidates.collection, candidates.source_type, candidates.title_local,
    candidates.title_en, candidates.authors, candidates.keywords,
    candidates.doi, candidates.canonical_url, candidates.journal_title,
    candidates.publisher, candidates.published_at, candidates.language,
    candidates.discipline, candidates.license, candidates.rights_status,
    candidates.access_level, candidates.evidence_status, candidates.document_id,
    candidates.source_updated_at, candidates.updated_at,
    candidates.publication_country, candidates.thai_published,
    candidates.thailand_context, candidates.thai_language,
    candidates.thai_affiliated, candidates.research_facets_basis,
    candidates.score, candidates.total
  from candidates, input
  order by candidates.score desc,
    case when native_first then candidates.native_rank else 0 end,
    candidates.published_at desc nulls last,
    candidates.id
  limit (select safe_count from input)
  offset (select safe_offset from input);
$$;

comment on function public.search_civil_source_catalog_public_v3(text,text,text,text,boolean,boolean,boolean,boolean,integer,integer)
is 'Bounded Thai-published catalog candidate search with independent context, language, and affiliation facets.';

revoke all on function public.search_civil_source_catalog_public_v3(text,text,text,text,boolean,boolean,boolean,boolean,integer,integer)
from public, anon, authenticated;
grant execute on function public.search_civil_source_catalog_public_v3(text,text,text,text,boolean,boolean,boolean,boolean,integer,integer)
to service_role;

notify pgrst, 'reload schema';

commit;
