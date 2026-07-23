begin;

update public.civil_documents_v2
set discipline = case
  when upper(coalesce(paper_code, id)) ~ '^(NCCE31_)?AIC-?' then 'ai_engineering'
  when upper(coalesce(paper_code, id)) ~ '^(NCCE31_)?WER-?' then 'water_resources'
  else discipline
end
where upper(coalesce(paper_code, id)) ~ '^(NCCE31_)?(AIC|WER)-?';

update public.civil_sections_v2
set discipline = case
  when upper(coalesce(paper_code, document_id)) ~ '^(NCCE31_)?AIC-?' then 'ai_engineering'
  when upper(coalesce(paper_code, document_id)) ~ '^(NCCE31_)?WER-?' then 'water_resources'
  else discipline
end
where upper(coalesce(paper_code, document_id)) ~ '^(NCCE31_)?(AIC|WER)-?';

update public.civil_chunks_v2
set discipline = case
  when upper(coalesce(paper_code, document_id)) ~ '^(NCCE31_)?AIC-?' then 'ai_engineering'
  when upper(coalesce(paper_code, document_id)) ~ '^(NCCE31_)?WER-?' then 'water_resources'
  else discipline
end
where upper(coalesce(paper_code, document_id)) ~ '^(NCCE31_)?(AIC|WER)-?';

update public.civil_source_catalog
set discipline = case
  when upper(provider_record_id) ~ '^(NCCE31_)?AIC-?' then 'ai_engineering'
  when upper(provider_record_id) ~ '^(NCCE31_)?WER-?' then 'water_resources'
  else discipline
end,
updated_at = now()
where provider = 'ncce'
  and upper(provider_record_id) ~ '^(NCCE31_)?(AIC|WER)-?';

notify pgrst, 'reload schema';
commit;
