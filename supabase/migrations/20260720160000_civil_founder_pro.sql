begin;

create table if not exists public.civil_billing_accounts (
  user_id                  text primary key references public.civil_chat_users(user_id) on delete cascade,
  plan                     text not null default 'free' check (plan in ('free', 'founder_pro')),
  status                   text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
  credits_included         integer not null default 25 check (credits_included between 0 and 100000),
  credits_used             integer not null default 0 check (credits_used between 0 and 100000),
  current_period_start     timestamptz not null default date_trunc('month', now()),
  current_period_end       timestamptz not null default date_trunc('month', now()) + interval '1 month',
  stripe_customer_id       text,
  stripe_subscription_id   text,
  stripe_price_id          text,
  stripe_event_created_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create unique index if not exists civil_billing_accounts_customer_idx
on public.civil_billing_accounts (stripe_customer_id)
where stripe_customer_id is not null;

create unique index if not exists civil_billing_accounts_subscription_idx
on public.civil_billing_accounts (stripe_subscription_id)
where stripe_subscription_id is not null;

create table if not exists public.civil_credit_ledger (
  ledger_id      bigint generated always as identity primary key,
  user_id        text not null references public.civil_chat_users(user_id) on delete cascade,
  request_id     text not null,
  model          text not null,
  kind           text not null check (kind in ('consume', 'refund')),
  credits_delta  integer not null check (credits_delta <> 0 and credits_delta between -100 and 100),
  created_at     timestamptz not null default now(),
  unique (user_id, request_id, kind)
);

create index if not exists civil_credit_ledger_user_created_idx
on public.civil_credit_ledger (user_id, created_at desc);

alter table public.civil_billing_accounts enable row level security;
alter table public.civil_credit_ledger enable row level security;
revoke all on table public.civil_billing_accounts from public, anon, authenticated;
revoke all on table public.civil_credit_ledger from public, anon, authenticated;
grant all on table public.civil_billing_accounts to service_role;
grant all on table public.civil_credit_ledger to service_role;

create or replace function public.civil_get_billing_state(p_user_id text)
returns table (
  plan text,
  status text,
  credits_included integer,
  credits_used integer,
  credits_remaining integer,
  reset_at timestamptz,
  premium_models boolean,
  stripe_customer_id text,
  stripe_subscription_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_account public.civil_billing_accounts%rowtype;
begin
  if p_user_id is null or length(p_user_id) > 128 then
    raise exception 'valid user id is required';
  end if;

  insert into public.civil_billing_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_account
  from public.civil_billing_accounts
  where user_id = p_user_id
  for update;

  if v_account.plan = 'free' and v_account.current_period_end <= v_now then
    update public.civil_billing_accounts
    set credits_used = 0,
        credits_included = 25,
        current_period_start = date_trunc('month', v_now),
        current_period_end = date_trunc('month', v_now) + interval '1 month',
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_account;
  end if;

  return query select
    v_account.plan,
    v_account.status,
    v_account.credits_included,
    v_account.credits_used,
    greatest(0, v_account.credits_included - v_account.credits_used),
    v_account.current_period_end,
    v_account.plan = 'founder_pro'
      and v_account.status in ('active', 'trialing')
      and v_account.current_period_end > v_now,
    v_account.stripe_customer_id,
    v_account.stripe_subscription_id;
end;
$$;

create or replace function public.civil_consume_answer_credits(
  p_user_id text,
  p_model text,
  p_request_id text
)
returns table (
  allowed boolean,
  charged integer,
  plan text,
  credits_remaining integer,
  reset_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_account public.civil_billing_accounts%rowtype;
  v_weight integer;
  v_existing integer;
  v_is_pro boolean;
begin
  if p_user_id is null or length(p_user_id) > 128 then
    raise exception 'valid user id is required';
  end if;
  if p_request_id is null or length(p_request_id) < 8 or length(p_request_id) > 160 then
    raise exception 'valid request id is required';
  end if;

  v_weight := case p_model
    when 'gpt-5.6-terra' then 3
    when 'gpt-5.6-sol' then 5
    when 'deepseek-v4-pro' then 3
    else 1
  end;

  insert into public.civil_billing_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_account
  from public.civil_billing_accounts
  where user_id = p_user_id
  for update;

  if v_account.plan = 'free' and v_account.current_period_end <= v_now then
    update public.civil_billing_accounts
    set credits_used = 0,
        credits_included = 25,
        current_period_start = date_trunc('month', v_now),
        current_period_end = date_trunc('month', v_now) + interval '1 month',
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_account;
  end if;

  v_is_pro := v_account.plan = 'founder_pro'
    and v_account.status in ('active', 'trialing')
    and v_account.current_period_end > v_now;

  if p_model in ('gpt-5.6-terra', 'gpt-5.6-sol') and not v_is_pro then
    return query select false, 0, v_account.plan,
      greatest(0, v_account.credits_included - v_account.credits_used),
      v_account.current_period_end, 'pro_required'::text;
    return;
  end if;

  select -credits_delta into v_existing
  from public.civil_credit_ledger
  where user_id = p_user_id and request_id = p_request_id and kind = 'consume';

  if v_existing is not null then
    return query select true, v_existing, v_account.plan,
      greatest(0, v_account.credits_included - v_account.credits_used),
      v_account.current_period_end, 'already_consumed'::text;
    return;
  end if;

  if v_account.credits_used + v_weight > v_account.credits_included then
    return query select false, 0, v_account.plan,
      greatest(0, v_account.credits_included - v_account.credits_used),
      v_account.current_period_end, 'credits_exhausted'::text;
    return;
  end if;

  insert into public.civil_credit_ledger (user_id, request_id, model, kind, credits_delta)
  values (p_user_id, p_request_id, p_model, 'consume', -v_weight);

  update public.civil_billing_accounts
  set credits_used = credits_used + v_weight,
      updated_at = v_now
  where user_id = p_user_id
  returning * into v_account;

  return query select true, v_weight, v_account.plan,
    greatest(0, v_account.credits_included - v_account.credits_used),
    v_account.current_period_end, 'consumed'::text;
end;
$$;

create or replace function public.civil_refund_answer_credits(
  p_user_id text,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_model text;
  v_inserted integer;
begin
  select -credits_delta, model into v_credits, v_model
  from public.civil_credit_ledger
  where user_id = p_user_id and request_id = p_request_id and kind = 'consume';

  if v_credits is null then return false; end if;

  insert into public.civil_credit_ledger (user_id, request_id, model, kind, credits_delta)
  values (p_user_id, p_request_id, v_model, 'refund', v_credits)
  on conflict (user_id, request_id, kind) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then return false; end if;

  update public.civil_billing_accounts
  set credits_used = greatest(0, credits_used - v_credits),
      updated_at = clock_timestamp()
  where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.civil_sync_stripe_subscription(
  p_user_id text,
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_price_id text,
  p_event_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_account public.civil_billing_accounts%rowtype;
  v_user_id text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_credits_used integer := 0;
begin
  if p_status not in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused') then
    raise exception 'invalid subscription status';
  end if;
  if p_subscription_id is null or p_customer_id is null or p_event_created_at is null then
    raise exception 'stripe identifiers and event time are required';
  end if;

  select * into v_account
  from public.civil_billing_accounts
  where (p_user_id is not null and user_id = p_user_id)
     or stripe_subscription_id = p_subscription_id
     or stripe_customer_id = p_customer_id
  order by case when user_id = p_user_id then 0 else 1 end
  limit 1
  for update;

  v_user_id := coalesce(v_account.user_id, p_user_id);
  if v_user_id is null then return false; end if;
  if v_account.stripe_event_created_at is not null and p_event_created_at < v_account.stripe_event_created_at then
    return false;
  end if;

  v_period_start := coalesce(p_period_start, v_account.current_period_start, date_trunc('month', v_now));
  v_period_end := coalesce(p_period_end, v_account.current_period_end, v_period_start + interval '1 month');
  if v_period_end <= v_period_start then v_period_end := v_period_start + interval '1 month'; end if;
  if v_account.user_id is not null and v_period_start <= v_account.current_period_start then
    v_credits_used := v_account.credits_used;
  end if;

  insert into public.civil_billing_accounts (
    user_id, plan, status, credits_included, credits_used,
    current_period_start, current_period_end,
    stripe_customer_id, stripe_subscription_id, stripe_price_id,
    stripe_event_created_at, updated_at
  ) values (
    v_user_id, 'founder_pro', p_status, 150, v_credits_used,
    v_period_start, v_period_end,
    p_customer_id, p_subscription_id, p_price_id,
    p_event_created_at, v_now
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = excluded.status,
    credits_included = excluded.credits_included,
    credits_used = excluded.credits_used,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    stripe_event_created_at = excluded.stripe_event_created_at,
    updated_at = excluded.updated_at;
  return true;
end;
$$;

revoke all on function public.civil_get_billing_state(text) from public, anon, authenticated;
revoke all on function public.civil_consume_answer_credits(text, text, text) from public, anon, authenticated;
revoke all on function public.civil_refund_answer_credits(text, text) from public, anon, authenticated;
revoke all on function public.civil_sync_stripe_subscription(text, text, text, text, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.civil_get_billing_state(text) to service_role;
grant execute on function public.civil_consume_answer_credits(text, text, text) to service_role;
grant execute on function public.civil_refund_answer_credits(text, text) to service_role;
grant execute on function public.civil_sync_stripe_subscription(text, text, text, text, timestamptz, timestamptz, text, timestamptz) to service_role;

create or replace function public.civil_backbone_readiness()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quota_table', to_regclass('public.civil_api_rate_limits') is not null,
    'quota_rpc', to_regprocedure('public.consume_civil_quota(text,text,integer,integer)') is not null,
    'retention_rpc', to_regprocedure('public.prune_civil_operational_data()') is not null,
    'billing_table', to_regclass('public.civil_billing_accounts') is not null,
    'credit_ledger', to_regclass('public.civil_credit_ledger') is not null,
    'credit_rpc', to_regprocedure('public.civil_consume_answer_credits(text,text,text)') is not null
  );
$$;

revoke all on function public.civil_backbone_readiness() from public, anon, authenticated;
grant execute on function public.civil_backbone_readiness() to service_role;

notify pgrst, 'reload schema';
commit;
