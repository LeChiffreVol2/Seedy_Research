begin;

create table if not exists public.civil_mcp_access_keys (
  key_id text primary key,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null,
  label text not null default 'Research client',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists civil_mcp_access_keys_owner_created_idx
on public.civil_mcp_access_keys (owner_id, created_at desc);

alter table public.civil_mcp_access_keys enable row level security;
revoke all on table public.civil_mcp_access_keys from public, anon, authenticated;
grant all on table public.civil_mcp_access_keys to service_role;

notify pgrst, 'reload schema';

commit;
