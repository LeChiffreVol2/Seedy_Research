begin;

alter table public.civil_billing_accounts
  alter column credits_included set default 100,
  alter column current_period_start set default date_trunc('week', now()),
  alter column current_period_end set default date_trunc('week', now()) + interval '1 week';

update public.civil_billing_accounts
set credits_included = 100,
    credits_used = 0,
    current_period_start = date_trunc('week', clock_timestamp()),
    current_period_end = date_trunc('week', clock_timestamp()) + interval '1 week',
    updated_at = clock_timestamp()
where plan = 'free';

create or replace function public.civil_expire_billing_account(p_user_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.civil_billing_accounts
  set plan = 'free',
      status = 'active',
      credits_included = 100,
      credits_used = 0,
      current_period_start = date_trunc('week', clock_timestamp()),
      current_period_end = date_trunc('week', clock_timestamp()) + interval '1 week',
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and plan = 'founder_pro'
    and current_period_end <= clock_timestamp();
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

  if v_account.plan = 'free' and v_account.current_period_end <= v_now then
    update public.civil_billing_accounts
    set credits_used = 0,
        credits_included = 100,
        current_period_start = date_trunc('week', v_now),
        current_period_end = date_trunc('week', v_now) + interval '1 week',
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

  perform public.civil_expire_billing_account(p_user_id);

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
        credits_included = 100,
        current_period_start = date_trunc('week', v_now),
        current_period_end = date_trunc('week', v_now) + interval '1 week',
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_account;
  end if;

  v_is_pro := v_account.plan = 'founder_pro'
    and v_account.status in ('active', 'trialing')
    and v_account.current_period_end > v_now;

  if p_model in ('deepseek-v4-pro', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol') and not v_is_pro then
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

revoke all on function public.civil_expire_billing_account(text) from public, anon, authenticated, service_role;
revoke all on function public.civil_get_billing_state(text) from public, anon, authenticated;
revoke all on function public.civil_consume_answer_credits(text, text, text) from public, anon, authenticated;
grant execute on function public.civil_get_billing_state(text) to service_role;
grant execute on function public.civil_consume_answer_credits(text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
