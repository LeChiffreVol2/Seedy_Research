-- Additive Build Week metadata cleanup. No schema or embedding changes.

do $$
declare
  table_name text;
begin
  foreach table_name in array array['civil_documents_v2', 'civil_sections_v2', 'civil_chunks_v2']
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        $sql$
          update public.%I
          set discipline = case
            when upper(coalesce(paper_code, source, '')) ~ '(^|_)WRE[0-9_-]' then 'water_resources'
            when upper(coalesce(paper_code, source, '')) ~ '(^|_)SGI[0-9_-]' then 'surveying_gis'
            when upper(coalesce(paper_code, source, '')) ~ '(^|_)ENV[0-9_-]' then 'environmental'
            when upper(coalesce(paper_code, source, '')) ~ '(^|_)(INF|EEC|DET)[0-9_-]' then 'infrastructure'
            when upper(coalesce(paper_code, source, '')) ~ '(^|_)CEE[0-9_-]' then 'civil_education'
            when upper(coalesce(paper_code, source, '')) ~ '(^|_)AIE[0-9_-]' then 'ai_engineering'
            else discipline
          end
          where coalesce(discipline, 'unknown') = 'unknown'
            and upper(coalesce(paper_code, source, '')) ~ '(^|_)(WRE|SGI|ENV|INF|EEC|DET|CEE|AIE)[0-9_-]'
        $sql$,
        table_name
      );
    end if;
  end loop;
end
$$;

do $$
begin
  if to_regclass('public.civil_chat_sessions') is not null then
    alter table public.civil_chat_sessions alter column model set default 'gpt-5.6-luna';
    update public.civil_chat_sessions
    set model = 'gpt-5.6-luna'
    where model in ('gpt-5-mini-2025-08-07', 'gpt-5-nano');
  end if;
end
$$;
