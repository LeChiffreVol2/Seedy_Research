-- Correct the premium GPT credit weights without rewriting the applied Luna migration.

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
    when 'deepseek-v4-pro' then 2
    when 'gpt-5.6-terra' then 5
    when 'gpt-5.6-sol' then 10
    else 1
  end;
  v_is_premium_model := p_model in ('deepseek-v4-pro', 'gpt-5.6-terra', 'gpt-5.6-sol');

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

revoke all on function public.civil_consume_answer_credits(text, text, text) from public, anon, authenticated;
grant execute on function public.civil_consume_answer_credits(text, text, text) to service_role;

comment on function public.civil_consume_answer_credits(text, text, text) is
  'Atomically reserves weighted credits: Flash/Luna 1, DeepSeek Pro 2, Terra 5, Sol 10.';
