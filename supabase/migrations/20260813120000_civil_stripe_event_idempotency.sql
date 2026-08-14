begin;

alter table public.civil_billing_accounts
  add column if not exists stripe_event_id text,
  add column if not exists stripe_event_type text;

create table if not exists public.civil_stripe_event_ledger (
  event_id text primary key check (length(event_id) between 8 and 255),
  event_type text not null check (event_type in (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  )),
  event_created_at timestamptz not null,
  outcome text not null check (outcome in ('processing', 'applied', 'stale')),
  processed_at timestamptz not null default clock_timestamp()
);

create index if not exists civil_stripe_event_ledger_created_idx
on public.civil_stripe_event_ledger (event_created_at desc, event_id desc);

alter table public.civil_stripe_event_ledger enable row level security;
revoke all on table public.civil_stripe_event_ledger from public, anon, authenticated;
grant all on table public.civil_stripe_event_ledger to service_role;

-- A refund is successful when the refund ledger row exists. Returning true for
-- an already-present refund makes a retry safe after an ambiguous network error.
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
  if exists (
    select 1
    from public.civil_credit_ledger
    where user_id = p_user_id and request_id = p_request_id and kind = 'refund'
  ) then
    return true;
  end if;

  select -credits_delta, model, credit_pool into v_credits, v_model, v_pool
  from public.civil_credit_ledger
  where user_id = p_user_id and request_id = p_request_id and kind = 'consume';

  if v_credits is null then return false; end if;

  insert into public.civil_credit_ledger (user_id, request_id, model, kind, credits_delta, credit_pool)
  values (p_user_id, p_request_id, v_model, 'refund', v_credits, v_pool)
  on conflict (user_id, request_id, kind) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return exists (
      select 1
      from public.civil_credit_ledger
      where user_id = p_user_id and request_id = p_request_id and kind = 'refund'
    );
  end if;

  update public.civil_billing_accounts
  set free_credits_used = greatest(0, free_credits_used - case when v_pool in ('free', 'legacy') then v_credits else 0 end),
      pro_credits_used = greatest(0, pro_credits_used - case when v_pool = 'pro' then v_credits else 0 end),
      credits_used = greatest(0, credits_used - v_credits),
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  if not found then
    raise exception 'billing account not found for credit refund';
  end if;
  return true;
end;
$$;

-- Stripe event.created is only precise to one second. The lifecycle rank and
-- event id make equal-second delivery deterministic, while the event ledger
-- makes retries idempotent. Account locking keeps concurrent events ordered.
create or replace function public.civil_apply_stripe_subscription_event(
  p_user_id text,
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_price_id text,
  p_event_created_at timestamptz,
  p_event_id text,
  p_event_type text
)
returns text
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
  v_event_rank integer;
  v_previous_rank integer;
  v_inserted integer;
begin
  if p_status is null or p_status not in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused') then
    raise exception 'invalid subscription status';
  end if;
  if p_event_type is null or p_event_type not in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    raise exception 'invalid stripe event type';
  end if;
  if p_event_id is null or length(p_event_id) < 8 or length(p_event_id) > 255 then
    raise exception 'valid stripe event id is required';
  end if;
  if p_subscription_id is null or p_customer_id is null or p_event_created_at is null then
    raise exception 'stripe identifiers and event time are required';
  end if;

  insert into public.civil_stripe_event_ledger (
    event_id, event_type, event_created_at, outcome
  ) values (
    p_event_id, p_event_type, p_event_created_at, 'processing'
  )
  on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  select * into v_account
  from public.civil_billing_accounts
  where stripe_subscription_id = p_subscription_id
     or stripe_customer_id = p_customer_id
  order by case
    when stripe_subscription_id = p_subscription_id then 0
    when stripe_customer_id = p_customer_id then 1
    else 2
  end
  limit 1
  for update;

  if v_account.user_id is null then
    if p_user_id is null then
      raise exception 'stripe event is not linked to a CivilMCP user';
    end if;
    insert into public.civil_billing_accounts (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing;

    select * into v_account
    from public.civil_billing_accounts
    where user_id = p_user_id
    for update;
  end if;

  v_user_id := v_account.user_id;
  v_event_rank := case p_event_type
    when 'customer.subscription.created' then 10
    when 'customer.subscription.updated' then 20
    when 'customer.subscription.deleted' then 30
    else 0
  end;
  v_previous_rank := case v_account.stripe_event_type
    when 'customer.subscription.created' then 10
    when 'customer.subscription.updated' then 20
    when 'customer.subscription.deleted' then 30
    else 0
  end;

  if v_account.stripe_event_created_at is not null and (
    p_event_created_at < v_account.stripe_event_created_at
    or (
      p_event_created_at = v_account.stripe_event_created_at
      and (
        v_event_rank < v_previous_rank
        or (v_event_rank = v_previous_rank and p_event_id <= coalesce(v_account.stripe_event_id, ''))
      )
    )
  ) then
    update public.civil_stripe_event_ledger
    set outcome = 'stale', processed_at = v_now
    where event_id = p_event_id;
    return 'stale';
  end if;

  v_period_start := coalesce(p_period_start, v_account.current_period_start, date_trunc('month', v_now));
  v_period_end := coalesce(p_period_end, v_account.current_period_end, v_period_start + interval '1 month');
  if v_period_end <= v_period_start then v_period_end := v_period_start + interval '1 month'; end if;

  if v_account.free_period_end > v_now then
    v_free_credits_used := v_account.free_credits_used;
    v_free_period_start := v_account.free_period_start;
    v_free_period_end := v_account.free_period_end;
  end if;
  if v_period_start <= v_account.current_period_start then
    v_pro_credits_used := v_account.pro_credits_used;
  end if;

  update public.civil_billing_accounts
  set plan = 'founder_pro',
      status = p_status,
      credits_included = 600,
      credits_used = v_free_credits_used + v_pro_credits_used,
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      stripe_customer_id = p_customer_id,
      stripe_subscription_id = p_subscription_id,
      stripe_price_id = p_price_id,
      stripe_event_created_at = p_event_created_at,
      stripe_event_id = p_event_id,
      stripe_event_type = p_event_type,
      free_credits_included = 100,
      free_credits_used = v_free_credits_used,
      free_period_start = v_free_period_start,
      free_period_end = v_free_period_end,
      pro_credits_included = 500,
      pro_credits_used = v_pro_credits_used,
      updated_at = v_now
  where user_id = v_user_id;

  update public.civil_stripe_event_ledger
  set outcome = 'applied', processed_at = v_now
  where event_id = p_event_id;
  return 'applied';
end;
$$;

revoke all on function public.civil_refund_answer_credits(text, text) from public, anon, authenticated;
revoke all on function public.civil_apply_stripe_subscription_event(text, text, text, text, timestamptz, timestamptz, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.civil_refund_answer_credits(text, text) to service_role;
grant execute on function public.civil_apply_stripe_subscription_event(text, text, text, text, timestamptz, timestamptz, text, timestamptz, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
