begin;

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

alter table public.civil_private_library_items enable row level security;
alter table public.civil_living_review_watches enable row level security;
revoke all on table public.civil_private_library_items from public, anon, authenticated;
revoke all on table public.civil_living_review_watches from public, anon, authenticated;
grant all on table public.civil_private_library_items to service_role;
grant all on table public.civil_living_review_watches to service_role;

notify pgrst, 'reload schema';

commit;
