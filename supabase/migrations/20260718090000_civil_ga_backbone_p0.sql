begin;

alter table public.civil_chat_sessions
  add column if not exists share_expires_at timestamptz,
  add column if not exists share_revoked_at timestamptz;

update public.civil_chat_sessions
set share_expires_at = coalesce(share_expires_at, now() + interval '30 days')
where share_id is not null
  and share_revoked_at is null;

create index if not exists civil_chat_sessions_active_share_idx
on public.civil_chat_sessions (share_id, share_expires_at)
where share_id is not null and share_revoked_at is null;

alter table public.civil_chat_traces
  add column if not exists question_hash text,
  -- Old writers may still persist raw content during a migration-first rollout.
  -- Default to the conservative label; the new writer always sets metadata explicitly.
  add column if not exists content_mode text not null default 'debug',
  add column if not exists retention_expires_at timestamptz;

alter table public.civil_chat_traces
  alter column content_mode set default 'debug';

update public.civil_chat_traces
set retention_expires_at = coalesce(retention_expires_at, created_at + interval '30 days'),
    content_mode = case
      when question is not null or answer is not null then 'debug'
      else 'metadata'
    end;

create index if not exists civil_chat_traces_retention_idx
on public.civil_chat_traces (retention_expires_at);

alter table public.civil_chat_feedback
  add column if not exists question_snapshot text,
  add column if not exists answer_snapshot text,
  add column if not exists content_expires_at timestamptz;

create table if not exists public.civil_api_rate_limits (
  scope           text not null,
  identity_hash   text not null,
  bucket_start    timestamptz not null,
  window_seconds  integer not null check (window_seconds between 1 and 86400),
  request_count   integer not null default 0,
  expires_at      timestamptz not null,
  primary key (scope, identity_hash, bucket_start, window_seconds)
);

create index if not exists civil_api_rate_limits_expires_idx
on public.civil_api_rate_limits (expires_at);

alter table public.civil_api_rate_limits enable row level security;
revoke all on table public.civil_api_rate_limits from public, anon, authenticated;
grant all on table public.civil_api_rate_limits to service_role;

create or replace function public.consume_civil_quota(
  p_identity_hash text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  request_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket_start timestamptz;
  v_reset_at timestamptz;
  v_count integer;
begin
  if p_identity_hash is null or length(p_identity_hash) < 16 then
    raise exception 'identity hash is required';
  end if;
  if p_scope is null or p_scope !~ '^[a-z0-9_:-]{1,80}$' then
    raise exception 'invalid quota scope';
  end if;
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid quota limit';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid quota window';
  end if;

  v_bucket_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_reset_at := v_bucket_start + make_interval(secs => p_window_seconds);

  insert into public.civil_api_rate_limits (
    scope,
    identity_hash,
    bucket_start,
    window_seconds,
    request_count,
    expires_at
  ) values (
    p_scope,
    p_identity_hash,
    v_bucket_start,
    p_window_seconds,
    1,
    v_reset_at + interval '1 day'
  )
  on conflict (scope, identity_hash, bucket_start, window_seconds)
  do update set
    request_count = civil_api_rate_limits.request_count + 1,
    expires_at = excluded.expires_at
  returning civil_api_rate_limits.request_count into v_count;

  return query select
    v_count <= p_limit,
    greatest(0, p_limit - v_count),
    v_reset_at,
    v_count;
end;
$$;

revoke all on function public.consume_civil_quota(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_civil_quota(text, text, integer, integer) to service_role;

create or replace function public.prune_civil_operational_data()
returns table (
  deleted_rate_buckets bigint,
  deleted_traces bigint,
  cleared_feedback_snapshots bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate bigint;
  v_traces bigint;
  v_feedback bigint;
begin
  delete from public.civil_api_rate_limits where expires_at < now();
  get diagnostics v_rate = row_count;

  update public.civil_chat_feedback
  set question_snapshot = null,
      answer_snapshot = null,
      content_expires_at = null
  where content_expires_at is not null and content_expires_at < now();
  get diagnostics v_feedback = row_count;

  delete from public.civil_chat_traces
  where retention_expires_at is not null and retention_expires_at < now();
  get diagnostics v_traces = row_count;

  return query select v_rate, v_traces, v_feedback;
end;
$$;

revoke all on function public.prune_civil_operational_data() from public, anon, authenticated;
grant execute on function public.prune_civil_operational_data() to service_role;

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
    'retention_rpc', to_regprocedure('public.prune_civil_operational_data()') is not null
  );
$$;

revoke all on function public.civil_backbone_readiness() from public, anon, authenticated;
grant execute on function public.civil_backbone_readiness() to service_role;

notify pgrst, 'reload schema';
commit;
