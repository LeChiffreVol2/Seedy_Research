-- Seedy Notebook Light Mode keeps durable research state normalized and small.
-- It deliberately references the canonical corpus instead of duplicating text,
-- chunks, or embeddings. All access is mediated by owner-scoped server routes.

alter table public.civil_paper_workspaces
  add column if not exists case_id text references public.civil_research_cases(case_id) on delete set null;

create index if not exists civil_paper_workspaces_case_updated_idx
  on public.civil_paper_workspaces (case_id, updated_at desc)
  where case_id is not null;

create table if not exists public.civil_research_notebooks (
  notebook_id text primary key check (notebook_id ~ '^notebook_[a-z0-9_-]{8,80}$'),
  case_id text not null unique references public.civil_research_cases(case_id) on delete cascade,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  source_fingerprint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists civil_research_notebooks_owner_updated_idx
  on public.civil_research_notebooks (owner_id, updated_at desc);

create table if not exists public.civil_research_notebook_threads (
  thread_id uuid primary key default gen_random_uuid(),
  notebook_id text not null references public.civil_research_notebooks(notebook_id) on delete cascade,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  title text not null default 'New research thread' check (char_length(title) between 1 and 160),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists civil_research_notebook_threads_notebook_updated_idx
  on public.civil_research_notebook_threads (notebook_id, updated_at desc);

create table if not exists public.civil_research_notebook_messages (
  message_id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.civil_research_notebook_threads(thread_id) on delete cascade,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 6000),
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  source_snapshot text[] not null default '{}'::text[] check (cardinality(source_snapshot) <= 12),
  insufficient boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists civil_research_notebook_messages_thread_created_idx
  on public.civil_research_notebook_messages (thread_id, created_at);

create table if not exists public.civil_research_notebook_notes (
  note_id uuid primary key default gen_random_uuid(),
  notebook_id text not null references public.civil_research_notebooks(notebook_id) on delete cascade,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 12000),
  source_snapshot text[] not null default '{}'::text[] check (cardinality(source_snapshot) <= 12),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  pinned boolean not null default false,
  stale boolean not null default false,
  version integer not null default 1 check (version between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists civil_research_notebook_notes_notebook_updated_idx
  on public.civil_research_notebook_notes (notebook_id, pinned desc, updated_at desc);

create table if not exists public.civil_research_notebook_artifacts (
  artifact_id uuid primary key default gen_random_uuid(),
  notebook_id text not null references public.civil_research_notebooks(notebook_id) on delete cascade,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  kind text not null check (kind in ('source_guide', 'evidence_brief', 'evidence_matrix', 'literature_synthesis', 'candidate_gap', 'next_study_protocol', 'manuscript_package')),
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 30000),
  source_snapshot text[] not null default '{}'::text[] check (cardinality(source_snapshot) <= 12),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  stale boolean not null default false,
  version integer not null default 1 check (version between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists civil_research_notebook_artifacts_notebook_created_idx
  on public.civil_research_notebook_artifacts (notebook_id, created_at desc);

create table if not exists public.civil_workspace_evidence_packs (
  pack_id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.civil_paper_workspaces(workspace_id) on delete cascade,
  notebook_id text not null references public.civil_research_notebooks(notebook_id) on delete cascade,
  case_id text not null references public.civil_research_cases(case_id) on delete cascade,
  owner_id text not null references public.civil_chat_users(user_id) on delete cascade,
  version integer not null check (version between 1 and 1000),
  source_snapshot text[] not null default '{}'::text[] check (cardinality(source_snapshot) <= 12),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 120000),
  created_at timestamptz not null default now(),
  unique (workspace_id, notebook_id, version)
);

create index if not exists civil_workspace_evidence_packs_notebook_created_idx
  on public.civil_workspace_evidence_packs (notebook_id, created_at desc);

alter table public.civil_research_notebooks enable row level security;
alter table public.civil_research_notebook_threads enable row level security;
alter table public.civil_research_notebook_messages enable row level security;
alter table public.civil_research_notebook_notes enable row level security;
alter table public.civil_research_notebook_artifacts enable row level security;
alter table public.civil_workspace_evidence_packs enable row level security;

revoke all on table public.civil_research_notebooks from public, anon, authenticated;
revoke all on table public.civil_research_notebook_threads from public, anon, authenticated;
revoke all on table public.civil_research_notebook_messages from public, anon, authenticated;
revoke all on table public.civil_research_notebook_notes from public, anon, authenticated;
revoke all on table public.civil_research_notebook_artifacts from public, anon, authenticated;
revoke all on table public.civil_workspace_evidence_packs from public, anon, authenticated;

grant select, insert, update, delete on table public.civil_research_notebooks to service_role;
grant select, insert, update, delete on table public.civil_research_notebook_threads to service_role;
grant select, insert, update, delete on table public.civil_research_notebook_messages to service_role;
grant select, insert, update, delete on table public.civil_research_notebook_notes to service_role;
grant select, insert, update, delete on table public.civil_research_notebook_artifacts to service_role;
grant select, insert, update, delete on table public.civil_workspace_evidence_packs to service_role;
