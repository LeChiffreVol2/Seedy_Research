begin;

-- DeepSeek V4 Flash was the product default before the Build Week extension.
-- Migrate only sessions created before the Luna production cutover so users can
-- still explicitly select and persist DeepSeek after the Research Preview launch.
update public.civil_chat_sessions
set model = 'gpt-5.6-luna',
    updated_at = now()
where model = 'deepseek-v4-flash'
  and created_at < timestamptz '2026-07-20 13:35:00+00';

commit;
