begin;

-- Rights are explicit and default-deny. A provider-supplied license string is
-- retained as evidence, but it never grants processing rights automatically.
alter table public.civil_source_catalog
  add column if not exists rights_manifest_version smallint not null default 1,
  add column if not exists rights_manifest jsonb not null default '{
    "metadata_indexing": false,
    "abstract_storage": false,
    "abstract_embedding": false,
    "full_text_download": false,
    "full_text_embedding": false,
    "summarization": false,
    "translation": false,
    "snippet_display": false,
    "redistribution": false,
    "commercial_use": false,
    "model_training": false
  }'::jsonb,
  add column if not exists rights_provenance jsonb not null default '{}'::jsonb,
  add column if not exists rights_checked_at timestamptz,
  add column if not exists rights_verified_at timestamptz;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'civil_source_catalog_rights_manifest_version_check'
      and conrelid = 'public.civil_source_catalog'::regclass
  ) then
    alter table public.civil_source_catalog
      add constraint civil_source_catalog_rights_manifest_version_check
      check (rights_manifest_version = 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'civil_source_catalog_rights_manifest_shape_check'
      and conrelid = 'public.civil_source_catalog'::regclass
  ) then
    alter table public.civil_source_catalog
      add constraint civil_source_catalog_rights_manifest_shape_check
      check (
        jsonb_typeof(rights_manifest) = 'object'
        and rights_manifest ?& array[
          'metadata_indexing', 'abstract_storage', 'abstract_embedding',
          'full_text_download', 'full_text_embedding', 'summarization',
          'translation', 'snippet_display', 'redistribution',
          'commercial_use', 'model_training'
        ]
        and jsonb_typeof(rights_manifest -> 'metadata_indexing') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'abstract_storage') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'abstract_embedding') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'full_text_download') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'full_text_embedding') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'summarization') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'translation') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'snippet_display') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'redistribution') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'commercial_use') = 'boolean'
        and jsonb_typeof(rights_manifest -> 'model_training') = 'boolean'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'civil_source_catalog_rights_provenance_check'
      and conrelid = 'public.civil_source_catalog'::regclass
  ) then
    alter table public.civil_source_catalog
      add constraint civil_source_catalog_rights_provenance_check
      check (jsonb_typeof(rights_provenance) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'civil_source_catalog_rights_grant_provenance_check'
      and conrelid = 'public.civil_source_catalog'::regclass
  ) then
    alter table public.civil_source_catalog
      add constraint civil_source_catalog_rights_grant_provenance_check
      check (
        rights_provenance <> '{}'::jsonb
        or rights_manifest = '{
          "metadata_indexing": false,
          "abstract_storage": false,
          "abstract_embedding": false,
          "full_text_download": false,
          "full_text_embedding": false,
          "summarization": false,
          "translation": false,
          "snippet_display": false,
          "redistribution": false,
          "commercial_use": false,
          "model_training": false
        }'::jsonb
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'civil_source_catalog_rights_verification_time_check'
      and conrelid = 'public.civil_source_catalog'::regclass
  ) then
    alter table public.civil_source_catalog
      add constraint civil_source_catalog_rights_verification_time_check
      check (
        rights_verified_at is null
        or (
          rights_checked_at is not null
          and rights_provenance <> '{}'::jsonb
          and rights_status in ('open_license_verified', 'permission_granted', 'restricted')
        )
      );
  end if;
end
$migration$;

-- Existing catalog rows remain discoverable, without inferring any right to
-- process their abstracts or full text. This records current catalog behavior,
-- not a license verification or evidence-processing grant.
update public.civil_source_catalog
set
  rights_manifest_version = 1,
  rights_manifest = '{
    "metadata_indexing": true,
    "abstract_storage": false,
    "abstract_embedding": false,
    "full_text_download": false,
    "full_text_embedding": false,
    "summarization": false,
    "translation": false,
    "snippet_display": false,
    "redistribution": false,
    "commercial_use": false,
    "model_training": false
  }'::jsonb,
  rights_provenance = jsonb_build_object(
    'policy', 'existing_catalog_metadata_only_v1',
    'basis', 'existing_catalog_record',
    'provider', provider,
    'declared_rights', coalesce(raw_metadata -> 'rights', '[]'::jsonb),
    'automated_rights_inference', false
  ),
  rights_checked_at = now(),
  rights_verified_at = null
where rights_provenance = '{}'::jsonb
  and rights_checked_at is null;

-- The official OAI feed supports discovery metadata. Descriptions remain
-- catalog metadata, but no downstream content-processing or commercial right
-- is inferred from dc:rights, including apparently open-license strings.
update public.civil_source_catalog
set
  rights_manifest_version = 1,
  rights_manifest = '{
    "metadata_indexing": true,
    "abstract_storage": true,
    "abstract_embedding": false,
    "full_text_download": false,
    "full_text_embedding": false,
    "summarization": false,
    "translation": false,
    "snippet_display": false,
    "redistribution": false,
    "commercial_use": false,
    "model_training": false
  }'::jsonb,
  rights_provenance = jsonb_build_object(
    'policy', 'tci_thaijo_oai_metadata_only_v1',
    'basis', 'official_oai_pmh_metadata_feed',
    'provider', provider,
    'endpoint', raw_metadata ->> 'endpoint',
    'declared_rights', coalesce(raw_metadata -> 'rights', '[]'::jsonb),
    'automated_rights_inference', false
  ),
  rights_checked_at = now(),
  rights_verified_at = null
where provider = 'tci_thaijo'
  and rights_provenance ->> 'policy' = 'existing_catalog_metadata_only_v1';

notify pgrst, 'reload schema';
commit;
