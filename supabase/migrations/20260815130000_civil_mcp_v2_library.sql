-- First-class MCP library folders. Existing flat labels remain untouched.

begin;

create table if not exists public.civil_mcp_library_folders (
  folder_id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  parent_folder_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, folder_id)
);

alter table public.civil_mcp_library_folders
  drop constraint if exists civil_mcp_library_folders_owner_parent_fk,
  add constraint civil_mcp_library_folders_owner_parent_fk
    foreign key (owner_id, parent_folder_id)
    references public.civil_mcp_library_folders(owner_id, folder_id);

create unique index if not exists civil_mcp_library_folders_owner_name_uq
on public.civil_mcp_library_folders (owner_id, lower(name), coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists civil_mcp_library_folders_owner_updated_idx
on public.civil_mcp_library_folders (owner_id, updated_at desc);

alter table public.civil_paper_workspace_items
  add column if not exists folder_ids uuid[] not null default '{}'::uuid[];

alter table public.civil_mcp_library_folders enable row level security;
revoke all on table public.civil_mcp_library_folders from public, anon, authenticated;
grant all on table public.civil_mcp_library_folders to service_role;

create or replace function public.civil_mcp_delete_library_folder(
  p_owner_id text,
  p_folder_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  update public.civil_mcp_library_folders
  set parent_folder_id = null,
      updated_at = now()
  where owner_id = p_owner_id and parent_folder_id = p_folder_id;

  update public.civil_paper_workspace_items
  set folder_ids = array_remove(folder_ids, p_folder_id),
      updated_at = now()
  where owner_id = p_owner_id
    and p_folder_id = any(folder_ids);

  delete from public.civil_mcp_library_folders
  where owner_id = p_owner_id and folder_id = p_folder_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

create or replace function public.civil_mcp_move_library_papers(
  p_owner_id text,
  p_sources text[],
  p_to_folder_id uuid default null,
  p_from_folder_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if coalesce(array_length(p_sources, 1), 0) = 0 or array_length(p_sources, 1) > 50 then
    raise exception 'p_sources must contain between 1 and 50 values';
  end if;

  if p_to_folder_id is not null and not exists (
    select 1 from public.civil_mcp_library_folders
    where owner_id = p_owner_id and folder_id = p_to_folder_id
  ) then
    raise exception 'destination folder not found';
  end if;

  if p_from_folder_id is not null and not exists (
    select 1 from public.civil_mcp_library_folders
    where owner_id = p_owner_id and folder_id = p_from_folder_id
  ) then
    raise exception 'source folder not found';
  end if;

  update public.civil_paper_workspace_items
  set folder_ids = case
        when p_to_folder_id is null then array_remove(folder_ids, p_from_folder_id)
        when p_from_folder_id is null then array_append(array_remove(folder_ids, p_to_folder_id), p_to_folder_id)
        else array_append(array_remove(array_remove(folder_ids, p_from_folder_id), p_to_folder_id), p_to_folder_id)
      end,
      updated_at = now()
  where owner_id = p_owner_id
    and source = any(p_sources)
    and (p_from_folder_id is null or p_from_folder_id = any(folder_ids));
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.civil_mcp_delete_library_folder(text, uuid) from public, anon, authenticated;
revoke all on function public.civil_mcp_move_library_papers(text, text[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.civil_mcp_delete_library_folder(text, uuid) to service_role;
grant execute on function public.civil_mcp_move_library_papers(text, text[], uuid, uuid) to service_role;

comment on table public.civil_mcp_library_folders is
  'Owner-scoped folders exposed by the public CivilMCP v2 MCP contract.';

notify pgrst, 'reload schema';

commit;
