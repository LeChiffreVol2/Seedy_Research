-- New research sessions default to the OpenAI-first, high-volume model.
-- Existing sessions keep the model explicitly selected by their owner.

alter table public.civil_chat_sessions
  alter column model set default 'gpt-5.6-luna';
