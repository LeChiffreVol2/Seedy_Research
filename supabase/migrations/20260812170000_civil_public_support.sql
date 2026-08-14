begin;

create table if not exists public.civil_support_requests (
  request_id text primary key,
  user_id text,
  email text not null,
  category text not null check (category in ('product_support', 'data_request', 'account_deletion', 'source_takedown', 'copyright')),
  subject text not null,
  message text not null,
  source_url text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists civil_support_requests_status_created_idx
on public.civil_support_requests (status, created_at desc);

alter table public.civil_support_requests enable row level security;
revoke all on table public.civil_support_requests from public, anon, authenticated;
grant all on table public.civil_support_requests to service_role;

notify pgrst, 'reload schema';

commit;
