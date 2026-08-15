begin;

create table if not exists public.civil_mcp_usage_accounts (
  owner_id text primary key references public.civil_chat_users(user_id) on delete cascade,
  plan_snapshot text not null default 'free' check (plan_snapshot in ('free', 'founder_pro')),
  included_units integer not null default 500 check (included_units in (500, 5000)),
  used_units integer not null default 0 check (used_units >= 0),
  period_start timestamptz not null default date_trunc('month', now()),
  period_end timestamptz not null default date_trunc('month', now()) + interval '1 month',
  updated_at timestamptz not null default now(),
  check (period_end > period_start)
);

create table if not exists public.civil_mcp_usage_ledger (
  request_id text primary key check (char_length(request_id) between 8 and 128),
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  tool_name text not null check (char_length(tool_name) between 1 and 80),
  charged_units integer not null check (charged_units between 1 and 10),
  period_start timestamptz not null,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists civil_mcp_usage_ledger_owner_created_idx
on public.civil_mcp_usage_ledger (owner_id, created_at desc);

create or replace function public.civil_get_mcp_usage(p_owner_id text)
returns table (
  plan text,
  included_units integer,
  used_units integer,
  remaining_units integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_plan text := 'free';
  v_included integer := 500;
  v_account public.civil_mcp_usage_accounts%rowtype;
begin
  if p_owner_id is null or length(trim(p_owner_id)) < 1 or length(p_owner_id) > 128 then
    raise exception 'valid owner id is required';
  end if;

  if exists (
    select 1 from public.civil_billing_accounts b
    where b.user_id = p_owner_id
      and b.plan = 'founder_pro'
      and b.status in ('active', 'trialing')
      and b.current_period_end > v_now
  ) then
    v_plan := 'founder_pro';
    v_included := 5000;
  end if;

  insert into public.civil_mcp_usage_accounts (owner_id, plan_snapshot, included_units)
  values (p_owner_id, v_plan, v_included)
  on conflict (owner_id) do nothing;

  select * into v_account
  from public.civil_mcp_usage_accounts
  where owner_id = p_owner_id
  for update;

  update public.civil_mcp_usage_accounts as a
  set plan_snapshot = v_plan,
      included_units = v_included,
      used_units = case when a.period_end <= v_now then 0 else a.used_units end,
      period_start = case when a.period_end <= v_now then date_trunc('month', v_now) else a.period_start end,
      period_end = case when a.period_end <= v_now then date_trunc('month', v_now) + interval '1 month' else a.period_end end,
      updated_at = v_now
  where a.owner_id = p_owner_id
  returning a.* into v_account;

  return query select
    v_account.plan_snapshot,
    v_account.included_units,
    v_account.used_units,
    greatest(0, v_account.included_units - v_account.used_units),
    v_account.period_end;
end;
$$;

create or replace function public.civil_consume_mcp_units(
  p_owner_id text,
  p_tool_name text,
  p_request_id text
)
returns table (
  allowed boolean,
  charged integer,
  plan text,
  included_units integer,
  used_units integer,
  remaining_units integer,
  reset_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cost integer;
  v_plan text := 'free';
  v_included integer := 500;
  v_account public.civil_mcp_usage_accounts%rowtype;
begin
  if p_owner_id is null or length(trim(p_owner_id)) < 1 or length(p_owner_id) > 128 then
    raise exception 'valid owner id is required';
  end if;
  if p_request_id is null or char_length(p_request_id) not between 8 and 128 then
    raise exception 'valid server request id is required';
  end if;

  v_cost := case p_tool_name
    when 'discover_research' then 3
    when 'get_paper' then 1
    when 'query_papers' then 2
    when 'compare_papers' then 5
    when 'map_citation_network' then 3
    when 'get_evidence_snapshot' then 2
    when 'list_library' then 1
    when 'list_private_sources' then 1
    when 'create_library_folder' then 0
    when 'rename_library_folder' then 0
    when 'delete_library_folder' then 0
    when 'save_papers' then 0
    when 'move_papers' then 0
    when 'remove_papers' then 0
    else null
  end;
  if v_cost is null then raise exception 'unknown public MCP tool'; end if;

  if exists (
    select 1 from public.civil_billing_accounts b
    where b.user_id = p_owner_id
      and b.plan = 'founder_pro'
      and b.status in ('active', 'trialing')
      and b.current_period_end > v_now
  ) then
    v_plan := 'founder_pro';
    v_included := 5000;
  end if;

  insert into public.civil_mcp_usage_accounts (owner_id, plan_snapshot, included_units)
  values (p_owner_id, v_plan, v_included)
  on conflict (owner_id) do nothing;

  select * into v_account
  from public.civil_mcp_usage_accounts
  where owner_id = p_owner_id
  for update;

  update public.civil_mcp_usage_accounts as a
  set plan_snapshot = v_plan,
      included_units = v_included,
      used_units = case when a.period_end <= v_now then 0 else a.used_units end,
      period_start = case when a.period_end <= v_now then date_trunc('month', v_now) else a.period_start end,
      period_end = case when a.period_end <= v_now then date_trunc('month', v_now) + interval '1 month' else a.period_end end,
      updated_at = v_now
  where a.owner_id = p_owner_id
  returning a.* into v_account;

  if exists (select 1 from public.civil_mcp_usage_ledger where request_id = p_request_id) then
    return query select false, 0, v_account.plan_snapshot, v_account.included_units,
      v_account.used_units, greatest(0, v_account.included_units - v_account.used_units),
      v_account.period_end, 'already_consumed'::text;
    return;
  end if;

  if v_account.used_units + v_cost > v_account.included_units then
    return query select false, 0, v_account.plan_snapshot, v_account.included_units,
      v_account.used_units, greatest(0, v_account.included_units - v_account.used_units),
      v_account.period_end, 'units_exhausted'::text;
    return;
  end if;

  if v_cost > 0 then
    insert into public.civil_mcp_usage_ledger (
      request_id, owner_id, tool_name, charged_units, period_start
    ) values (
      p_request_id, p_owner_id, p_tool_name, v_cost, v_account.period_start
    );
    update public.civil_mcp_usage_accounts as a
    set used_units = a.used_units + v_cost, updated_at = v_now
    where a.owner_id = p_owner_id
    returning a.* into v_account;
  end if;

  return query select true, v_cost, v_account.plan_snapshot, v_account.included_units,
    v_account.used_units, greatest(0, v_account.included_units - v_account.used_units),
    v_account.period_end, 'consumed'::text;
end;
$$;

create or replace function public.civil_refund_mcp_units(p_owner_id text, p_request_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.civil_mcp_usage_ledger%rowtype;
begin
  select * into v_entry
  from public.civil_mcp_usage_ledger
  where request_id = p_request_id and owner_id = p_owner_id
  for update;

  if not found or v_entry.refunded_at is not null then return false; end if;

  update public.civil_mcp_usage_ledger
  set refunded_at = clock_timestamp()
  where request_id = p_request_id;

  update public.civil_mcp_usage_accounts
  set used_units = greatest(0, used_units - v_entry.charged_units), updated_at = clock_timestamp()
  where owner_id = p_owner_id and period_start = v_entry.period_start;

  return true;
end;
$$;

create or replace function public.civil_mcp_usage_readiness()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'usage_accounts_table', to_regclass('public.civil_mcp_usage_accounts') is not null,
    'usage_ledger_table', to_regclass('public.civil_mcp_usage_ledger') is not null,
    'get_usage_rpc', to_regprocedure('public.civil_get_mcp_usage(text)') is not null,
    'consume_units_rpc', to_regprocedure('public.civil_consume_mcp_units(text,text,text)') is not null,
    'refund_units_rpc', to_regprocedure('public.civil_refund_mcp_units(text,text)') is not null
  );
$$;

alter table public.civil_mcp_usage_accounts enable row level security;
alter table public.civil_mcp_usage_ledger enable row level security;
revoke all on table public.civil_mcp_usage_accounts from public, anon, authenticated;
revoke all on table public.civil_mcp_usage_ledger from public, anon, authenticated;
grant all on table public.civil_mcp_usage_accounts to service_role;
grant all on table public.civil_mcp_usage_ledger to service_role;
revoke all on function public.civil_get_mcp_usage(text) from public, anon, authenticated;
revoke all on function public.civil_consume_mcp_units(text, text, text) from public, anon, authenticated;
revoke all on function public.civil_refund_mcp_units(text, text) from public, anon, authenticated;
revoke all on function public.civil_mcp_usage_readiness() from public, anon, authenticated;
grant execute on function public.civil_get_mcp_usage(text) to service_role;
grant execute on function public.civil_consume_mcp_units(text, text, text) to service_role;
grant execute on function public.civil_refund_mcp_units(text, text) to service_role;
grant execute on function public.civil_mcp_usage_readiness() to service_role;

notify pgrst, 'reload schema';

commit;
