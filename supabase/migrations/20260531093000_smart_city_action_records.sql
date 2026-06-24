create table if not exists smart_city_action_records (
  id                  text primary key,
  action_type         text not null check (action_type in ('verify_camera', 'audit_signal', 'queue_control_review', 'dispatch_field_check', 'monitor_watchlist')),
  title               text not null,
  actor               text not null,
  source_object_ids   text[] not null,
  evidence_ids        text[] not null,
  risk_before         numeric(5,2) not null check (risk_before >= 0 and risk_before <= 100),
  expected_risk_after numeric(5,2) not null check (expected_risk_after >= 0 and expected_risk_after <= 100),
  status              text not null default 'recorded' check (status in ('recorded', 'approved', 'cancelled')),
  execution_scope     text not null default 'controlled_action_record' check (execution_scope = 'controlled_action_record'),
  limitations         jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.smart_city_action_drafts') is not null then
    insert into smart_city_action_records (
      id,
      action_type,
      title,
      actor,
      source_object_ids,
      evidence_ids,
      risk_before,
      expected_risk_after,
      status,
      execution_scope,
      limitations,
      created_at,
      updated_at
    )
    select
      id,
      action_type,
      title,
      actor,
      source_object_ids,
      evidence_ids,
      risk_before,
      expected_risk_after,
      case when status = 'draft' then 'recorded' else status end,
      'controlled_action_record',
      limitations,
      created_at,
      updated_at
    from smart_city_action_drafts
    on conflict (id) do nothing;
  end if;
end $$;

create index if not exists smart_city_action_records_source_objects_gin
on smart_city_action_records using gin (source_object_ids);

create index if not exists smart_city_action_records_evidence_gin
on smart_city_action_records using gin (evidence_ids);

create index if not exists smart_city_action_records_status_idx
on smart_city_action_records (status);

create index if not exists smart_city_action_records_created_idx
on smart_city_action_records (created_at desc);

alter table smart_city_action_records enable row level security;

notify pgrst, 'reload schema';
