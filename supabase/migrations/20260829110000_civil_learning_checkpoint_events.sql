begin;

alter table public.civil_product_events
  drop constraint if exists civil_product_events_event_name_check;

alter table public.civil_product_events
  add constraint civil_product_events_event_name_check check (event_name in (
    'explore_search', 'paper_open', 'evidence_open', 'paper_save',
    'research_path_created', 'path_stage_completed',
    'checkpoint_answered', 'checkpoint_mastered', 'path_adapted',
    'workspace_started', 'workspace_run_completed',
    'session_export', 'evidence_export', 'review_exported', 'verified_research_outcome',
    'first_answer', 'onboarding_completed', 'user_returned', 'upgrade_intent'
  ));

notify pgrst, 'reload schema';

commit;
