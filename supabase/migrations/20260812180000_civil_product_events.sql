begin;

create table if not exists public.civil_product_events (
  event_id text primary key,
  user_id text not null,
  event_name text not null check (event_name in (
    'explore_search', 'paper_open', 'evidence_open', 'paper_save',
    'research_path_created', 'session_export', 'evidence_export'
  )),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists civil_product_events_name_created_idx
on public.civil_product_events (event_name, created_at desc);

create index if not exists civil_product_events_user_created_idx
on public.civil_product_events (user_id, created_at desc);

alter table public.civil_product_events enable row level security;
revoke all on table public.civil_product_events from public, anon, authenticated;
grant all on table public.civil_product_events to service_role;

notify pgrst, 'reload schema';

commit;
