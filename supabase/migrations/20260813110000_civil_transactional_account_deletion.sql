begin;

create or replace function public.civil_delete_account_data(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or length(trim(p_user_id)) < 1 or length(p_user_id) > 128 then
    raise exception 'valid user id is required';
  end if;

  if exists (
    select 1
    from public.civil_billing_accounts
    where user_id = p_user_id
      and stripe_subscription_id is not null
      and status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused')
    for update
  ) then
    raise exception 'active subscription must be canceled before account deletion';
  end if;

  delete from public.civil_chat_feedback
  where user_id = p_user_id
     or trace_id in (
       select trace_id from public.civil_chat_traces
       where user_id = p_user_id
          or session_id in (select session_id from public.civil_chat_sessions where owner_id = p_user_id)
     )
     or session_id in (select session_id from public.civil_chat_sessions where owner_id = p_user_id);
  delete from public.civil_chat_traces
  where user_id = p_user_id
     or session_id in (select session_id from public.civil_chat_sessions where owner_id = p_user_id);
  delete from public.civil_chat_sessions where owner_id = p_user_id;
  delete from public.civil_paper_workspace_items where owner_id = p_user_id;
  delete from public.civil_paper_workspaces where owner_id = p_user_id;
  delete from public.civil_support_requests where user_id = p_user_id;
  delete from public.civil_product_events where user_id = p_user_id;
  delete from public.civil_credit_ledger where user_id = p_user_id;
  delete from public.civil_billing_accounts where user_id = p_user_id;
  delete from public.civil_chat_users where user_id = p_user_id;
end;
$$;

revoke all on function public.civil_delete_account_data(text) from public, anon, authenticated;
grant execute on function public.civil_delete_account_data(text) to service_role;

notify pgrst, 'reload schema';

commit;
