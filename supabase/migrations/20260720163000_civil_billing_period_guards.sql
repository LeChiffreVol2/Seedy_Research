begin;

alter function public.civil_get_billing_state(text)
rename to civil_get_billing_state_unchecked;

alter function public.civil_consume_answer_credits(text, text, text)
rename to civil_consume_answer_credits_unchecked;

create or replace function public.civil_expire_billing_account(p_user_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.civil_billing_accounts
  set plan = 'free',
      status = 'active',
      credits_included = 25,
      credits_used = 0,
      current_period_start = date_trunc('month', clock_timestamp()),
      current_period_end = date_trunc('month', clock_timestamp()) + interval '1 month',
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
begin
  perform public.civil_expire_billing_account(p_user_id);
  return query
  select * from public.civil_get_billing_state_unchecked(p_user_id);
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
begin
  perform public.civil_expire_billing_account(p_user_id);
  return query
  select * from public.civil_consume_answer_credits_unchecked(p_user_id, p_model, p_request_id);
end;
$$;

revoke all on function public.civil_expire_billing_account(text) from public, anon, authenticated, service_role;
revoke all on function public.civil_get_billing_state_unchecked(text) from public, anon, authenticated, service_role;
revoke all on function public.civil_consume_answer_credits_unchecked(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.civil_get_billing_state(text) from public, anon, authenticated;
revoke all on function public.civil_consume_answer_credits(text, text, text) from public, anon, authenticated;
grant execute on function public.civil_get_billing_state(text) to service_role;
grant execute on function public.civil_consume_answer_credits(text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
