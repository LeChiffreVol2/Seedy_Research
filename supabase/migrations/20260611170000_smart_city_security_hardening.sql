-- Production hardening follow-up for CityMCP ops.
-- Keeps all objects under smart_city_* and closes alternate action/command audit gaps.

begin;

do $$
begin
  alter table smart_city_commands
  add constraint smart_city_commands_command_type_check
  check (command_type in (
    'set_view',
    'toggle_layer',
    'style_layer',
    'apply_spatial_filter',
    'select_object',
    'open_evidence_panel',
    'run_research_gate'
  ));
exception
  when duplicate_object then null;
end $$;

create or replace function smart_city_transition_action_record(
  p_action_id text,
  p_to_status text,
  p_actor text,
  p_role text,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  action_record_id text,
  from_status text,
  to_status text,
  actor text,
  role text,
  reason text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record smart_city_action_records%rowtype;
  v_allowed text[];
  v_now timestamptz := now();
begin
  select *
  into v_record
  from smart_city_action_records
  where smart_city_action_records.id = p_action_id
  for update;

  if not found then
    raise exception 'Action record not found.' using errcode = 'P0002';
  end if;

  v_allowed := case v_record.status
    when 'proposed' then array['acknowledged', 'rejected', 'cancelled']
    when 'acknowledged' then array['recorded', 'rejected', 'cancelled']
    when 'recorded' then array['pending_approval', 'approved', 'cancelled', 'expired', 'superseded']
    when 'pending_approval' then array['approved', 'rejected', 'cancelled', 'expired']
    when 'approved' then array['assigned', 'in_progress', 'closed', 'superseded']
    when 'assigned' then array['in_progress', 'cancelled', 'superseded']
    when 'in_progress' then array['verified', 'failed', 'cancelled', 'superseded']
    when 'verified' then array['closed', 'failed', 'superseded']
    else array[]::text[]
  end;

  if not (p_to_status = any(v_allowed)) then
    raise exception 'Invalid action transition from % to %.', v_record.status, p_to_status using errcode = 'P0001';
  end if;

  update smart_city_action_records
  set
    status = p_to_status,
    updated_at = v_now,
    approved_by = case when p_to_status = 'approved' then p_actor else approved_by end,
    approved_at = case when p_to_status = 'approved' then v_now else approved_at end,
    closed_at = case when p_to_status = 'closed' then v_now else closed_at end,
    outcome_summary = case when p_to_status = 'closed' then p_reason else outcome_summary end
  where smart_city_action_records.id = p_action_id;

  return query
  insert into smart_city_action_events (
    action_record_id,
    from_status,
    to_status,
    actor,
    role,
    reason,
    metadata,
    created_at
  )
  values (
    p_action_id,
    v_record.status,
    p_to_status,
    p_actor,
    p_role,
    p_reason,
    coalesce(p_metadata, '{}'::jsonb),
    v_now
  )
  returning
    smart_city_action_events.id,
    smart_city_action_events.action_record_id,
    smart_city_action_events.from_status,
    smart_city_action_events.to_status,
    smart_city_action_events.actor,
    smart_city_action_events.role,
    smart_city_action_events.reason,
    smart_city_action_events.metadata,
    smart_city_action_events.created_at;
end;
$$;

notify pgrst, 'reload schema';

commit;
