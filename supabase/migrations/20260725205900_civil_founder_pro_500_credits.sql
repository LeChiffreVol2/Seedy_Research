begin;

alter table public.civil_billing_accounts
  add column if not exists free_credits_included integer not null default 100
    check (free_credits_included between 0 and 100000),
  add column if not exists free_credits_used integer not null default 0
    check (free_credits_used between 0 and 100000),
  add column if not exists free_period_start timestamptz not null default date_trunc('week', now()),
  add column if not exists free_period_end timestamptz not null default date_trunc('week', now()) + interval '1 week',
  add column if not exists pro_credits_included integer not null default 0
    check (pro_credits_included between 0 and 100000),
  add column if not exists pro_credits_used integer not null default 0
    check (pro_credits_used between 0 and 100000),
  add constraint civil_billing_accounts_free_period_check
    check (free_period_end > free_period_start);

alter table public.civil_credit_ledger
  add column if not exists credit_pool text not null default 'legacy'
    check (credit_pool in ('free', 'pro', 'legacy'));

update public.civil_billing_accounts
set free_credits_included = 100,
    free_credits_used = case when plan = 'free' then least(credits_used, 100) else 0 end,
    free_period_start = case
      when plan = 'free' and current_period_end > clock_timestamp()
        then current_period_start
      else date_trunc('week', clock_timestamp())
    end,
    free_period_end = case
      when plan = 'free' and current_period_end > clock_timestamp()
        then current_period_end
      else date_trunc('week', clock_timestamp()) + interval '1 week'
    end,
    pro_credits_included = case when plan = 'founder_pro' then 500 else 0 end,
    pro_credits_used = 0,
    credits_included = case when plan = 'founder_pro' then 600 else 100 end,
    credits_used = case when plan = 'free' then least(credits_used, 100) else 0 end,
    updated_at = clock_timestamp();

create or replace function public.civil_expire_billing_account(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update public.civil_billing_accounts
  set plan = 'free',
      status = 'active',
      free_credits_included = 100,
      free_credits_used = case when free_period_end > v_now then free_credits_used else 0 end,
      free_period_start = case when free_period_end > v_now then free_period_start else date_trunc('week', v_now) end,
      free_period_end = case when free_period_end > v_now then free_period_end else date_trunc('week', v_now) + interval '1 week' end,
      pro_credits_included = 0,
      pro_credits_used = 0,
      credits_included = 100,
      credits_used = case when free_period_end > v_now then free_credits_used else 0 end,
      current_period_start = case when free_period_end > v_now then free_period_start else date_trunc('week', v_now) end,
      current_period_end = case when free_period_end > v_now then free_period_end else date_trunc('week', v_now) + interval '1 week' end,
      updated_at = v_now
  where user_id = p_user_id
    and plan = 'founder_pro'
    and current_period_end <= v_now;
end;
$$;

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
  v_is_pro boolean;
begin
  if p_user_id is null or length(p_user_id) > 128 then
    raise exception 'valid user id is required';
  end if;

  perform public.civil_expire_billing_account(p_user_id);

  insert into public.civil_billing_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_account
  from public.civil_billing_accounts
  where user_id = p_user_id
  for update;

  if v_account.free_period_end <= v_now then
    update public.civil_billing_accounts
    set free_credits_included = 100,
        free_credits_used = 0,
        free_period_start = date_trunc('week', v_now),
        free_period_end = date_trunc('week', v_now) + interval '1 week',
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_account;
  end if;

  v_is_pro := v_account.plan = 'founder_pro'
    and v_account.status in ('active', 'trialing')
    and v_account.current_period_end > v_now;

  update public.civil_billing_accounts
  set credits_included = free_credits_included + case when v_is_pro then pro_credits_included else 0 end,
      credits_used = free_credits_used + case when v_is_pro then pro_credits_used else 0 end,
      updated_at = v_now
  where user_id = p_user_id
  returning * into v_account;

  return query select
    v_account.plan,
    v_account.status,
    v_account.credits_included,
    v_account.credits_used,
    greatest(0, v_account.credits_included - v_account.credits_used),
    case
      when v_is_pro then least(v_account.free_period_end, v_account.current_period_end)
      else v_account.free_period_end
    end,
    v_is_pro,
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
  v_existing_pool text;
  v_is_pro boolean;
  v_is_premium_model boolean;
  v_pool text;
  v_remaining integer;
begin
  if p_user_id is null or length(p_user_id) > 128 then
    raise exception 'valid user id is required';
  end if;
  if p_request_id is null or length(p_request_id) < 8 or length(p_request_id) > 160 then
    raise exception 'valid request id is required';
  end if;

  v_weight := case p_model
    when 'gpt-5.6-luna' then 3
    when 'gpt-5.6-terra' then 6
    when 'gpt-5.6-sol' then 10
    when 'deepseek-v4-pro' then 3
    else 1
  end;
  v_is_premium_model := p_model in ('deepseek-v4-pro', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol');

  perform public.civil_expire_billing_account(p_user_id);

  insert into public.civil_billing_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_account
  from public.civil_billing_accounts
  where user_id = p_user_id
  for update;

  if v_account.free_period_end <= v_now then
    update public.civil_billing_accounts
    set free_credits_included = 100,
        free_credits_used = 0,
        free_period_start = date_trunc('week', v_now),
        free_period_end = date_trunc('week', v_now) + interval '1 week',
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_account;
  end if;

  v_is_pro := v_account.plan = 'founder_pro'
    and v_account.status in ('active', 'trialing')
    and v_account.current_period_end > v_now;

  if v_is_premium_model and not v_is_pro then
    v_remaining := greatest(0, v_account.free_credits_included - v_account.free_credits_used);
    return query select false, 0, v_account.plan, v_remaining, v_account.free_period_end, 'pro_required'::text;
    return;
  end if;

  select -credits_delta, credit_pool into v_existing, v_existing_pool
  from public.civil_credit_ledger
  where user_id = p_user_id and request_id = p_request_id and kind = 'consume';

  v_remaining := greatest(0, v_account.free_credits_included - v_account.free_credits_used)
    + case when v_is_pro then greatest(0, v_account.pro_credits_included - v_account.pro_credits_used) else 0 end;

  if v_existing is not null then
    return query select true, v_existing, v_account.plan, v_remaining,
      case when v_existing_pool = 'pro' then v_account.current_period_end else v_account.free_period_end end,
      'already_consumed'::text;
    return;
  end if;

  if v_is_premium_model then
    v_pool := 'pro';
  elsif v_account.free_credits_used + v_weight <= v_account.free_credits_included then
    v_pool := 'free';
  elsif v_is_pro and v_account.pro_credits_used + v_weight <= v_account.pro_credits_included then
    v_pool := 'pro';
  else
    v_pool := null;
  end if;

  if v_pool is null
     or (v_pool = 'pro' and v_account.pro_credits_used + v_weight > v_account.pro_credits_included) then
    return query select false, 0, v_account.plan, v_remaining,
      case when v_is_premium_model then v_account.current_period_end else v_account.free_period_end end,
      'credits_exhausted'::text;
    return;
  end if;

  insert into public.civil_credit_ledger (user_id, request_id, model, kind, credits_delta, credit_pool)
  values (p_user_id, p_request_id, p_model, 'consume', -v_weight, v_pool);

  update public.civil_billing_accounts
  set free_credits_used = free_credits_used + case when v_pool = 'free' then v_weight else 0 end,
      pro_credits_used = pro_credits_used + case when v_pool = 'pro' then v_weight else 0 end,
      credits_included = free_credits_included + case when v_is_pro then pro_credits_included else 0 end,
      credits_used = free_credits_used + case when v_pool = 'free' then v_weight else 0 end
        + case when v_is_pro then pro_credits_used + case when v_pool = 'pro' then v_weight else 0 end else 0 end,
      updated_at = v_now
  where user_id = p_user_id
  returning * into v_account;

  v_remaining := greatest(0, v_account.credits_included - v_account.credits_used);
  return query select true, v_weight, v_account.plan, v_remaining,
    case when v_pool = 'pro' then v_account.current_period_end else v_account.free_period_end end,
    'consumed'::text;
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
  v_pool text;
  v_inserted integer;
begin
  select -credits_delta, model, credit_pool into v_credits, v_model, v_pool
  from public.civil_credit_ledger
  where user_id = p_user_id and request_id = p_request_id and kind = 'consume';

  if v_credits is null then return false; end if;

  insert into public.civil_credit_ledger (user_id, request_id, model, kind, credits_delta, credit_pool)
  values (p_user_id, p_request_id, v_model, 'refund', v_credits, v_pool)
  on conflict (user_id, request_id, kind) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then return false; end if;

  update public.civil_billing_accounts
  set free_credits_used = greatest(0, free_credits_used - case when v_pool in ('free', 'legacy') then v_credits else 0 end),
      pro_credits_used = greatest(0, pro_credits_used - case when v_pool = 'pro' then v_credits else 0 end),
      credits_used = greatest(0, credits_used - v_credits),
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
  v_pro_credits_used integer := 0;
  v_free_credits_used integer := 0;
  v_free_period_start timestamptz := date_trunc('week', clock_timestamp());
  v_free_period_end timestamptz := date_trunc('week', clock_timestamp()) + interval '1 week';
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

  if v_account.user_id is not null then
    if v_account.free_period_end > v_now then
      v_free_credits_used := v_account.free_credits_used;
      v_free_period_start := v_account.free_period_start;
      v_free_period_end := v_account.free_period_end;
    end if;
    if v_period_start <= v_account.current_period_start then
      v_pro_credits_used := v_account.pro_credits_used;
    end if;
  end if;

  insert into public.civil_billing_accounts (
    user_id, plan, status, credits_included, credits_used,
    current_period_start, current_period_end,
    stripe_customer_id, stripe_subscription_id, stripe_price_id,
    stripe_event_created_at, updated_at,
    free_credits_included, free_credits_used, free_period_start, free_period_end,
    pro_credits_included, pro_credits_used
  ) values (
    v_user_id, 'founder_pro', p_status, 600, v_free_credits_used + v_pro_credits_used,
    v_period_start, v_period_end,
    p_customer_id, p_subscription_id, p_price_id,
    p_event_created_at, v_now,
    100, v_free_credits_used, v_free_period_start, v_free_period_end,
    500, v_pro_credits_used
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
    free_credits_included = excluded.free_credits_included,
    free_credits_used = excluded.free_credits_used,
    free_period_start = excluded.free_period_start,
    free_period_end = excluded.free_period_end,
    pro_credits_included = excluded.pro_credits_included,
    pro_credits_used = excluded.pro_credits_used,
    updated_at = excluded.updated_at;
  return true;
end;
$$;

revoke all on function public.civil_expire_billing_account(text) from public, anon, authenticated, service_role;
revoke all on function public.civil_get_billing_state(text) from public, anon, authenticated;
revoke all on function public.civil_consume_answer_credits(text, text, text) from public, anon, authenticated;
revoke all on function public.civil_refund_answer_credits(text, text) from public, anon, authenticated;
revoke all on function public.civil_sync_stripe_subscription(text, text, text, text, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.civil_get_billing_state(text) to service_role;
grant execute on function public.civil_consume_answer_credits(text, text, text) to service_role;
grant execute on function public.civil_refund_answer_credits(text, text) to service_role;
grant execute on function public.civil_sync_stripe_subscription(text, text, text, text, timestamptz, timestamptz, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
