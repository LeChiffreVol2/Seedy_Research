import { createClient } from "@supabase/supabase-js";

import { normalizeCollectionFilter, type CollectionFilter } from "@/lib/chat-store";

let supabaseAdminSingleton: any = null;

function getSupabaseAdmin(): any {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for research workspaces.");
  }
  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } }) as any;
  return supabaseAdminSingleton;
}

export type SavedResearchWorkspace = {
  workspaceId: string;
  ownerId: string;
  title: string;
  collection: CollectionFilter;
  paperSources: string[];
  state: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

type WorkspaceRow = {
  workspace_id: string;
  owner_id: string;
  title?: string | null;
  collection?: string | null;
  paper_sources?: unknown;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

function parseState(notes: string | null | undefined): Record<string, unknown> {
  if (!notes) return {};
  try {
    const value = JSON.parse(notes) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeRow(row: WorkspaceRow): SavedResearchWorkspace {
  return {
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    title: row.title?.trim() || "Research workspace",
    collection: normalizeCollectionFilter(row.collection),
    paperSources: Array.isArray(row.paper_sources) ? row.paper_sources.map(String).slice(0, 24) : [],
    state: parseState(row.notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listResearchWorkspaces(ownerId: string, limit = 20): Promise<SavedResearchWorkspace[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("civil_paper_workspaces")
    .select("workspace_id, owner_id, title, collection, paper_sources, notes, created_at, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new Error(`Failed to list research workspaces: ${error.message}`);
  return ((data ?? []) as WorkspaceRow[]).map(normalizeRow);
}

export async function upsertResearchWorkspace(input: {
  workspaceId: string;
  ownerId: string;
  title: string;
  collection?: string | null;
  paperSources: string[];
  state: Record<string, unknown>;
}): Promise<SavedResearchWorkspace> {
  const notes = JSON.stringify(input.state);
  if (notes.length > 550_000) throw new Error("Research workspace state is too large.");
  const now = new Date().toISOString();
  const workspaceId = input.workspaceId.trim().slice(0, 96);
  const client = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await client
    .from("civil_paper_workspaces")
    .select("owner_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (lookupError) throw new Error(`Failed to verify research workspace ownership: ${lookupError.message}`);
  if (existing && existing.owner_id !== input.ownerId) throw new Error("Research workspace belongs to another account.");

  const values = {
    title: input.title.trim().slice(0, 160) || "Research workspace",
    collection: normalizeCollectionFilter(input.collection),
    paper_sources: [...new Set(input.paperSources.map((source) => source.trim()).filter(Boolean))].slice(0, 24),
    notes,
    updated_at: now,
  };
  const query = existing
    ? client.from("civil_paper_workspaces").update(values).eq("workspace_id", workspaceId).eq("owner_id", input.ownerId)
    : client.from("civil_paper_workspaces").insert({ ...values, workspace_id: workspaceId, owner_id: input.ownerId });
  const { data, error } = await query
    .select("workspace_id, owner_id, title, collection, paper_sources, notes, created_at, updated_at")
    .single();
  if (error) throw new Error(`Failed to save research workspace: ${error.message}`);
  return normalizeRow(data as WorkspaceRow);
}

export async function deleteResearchWorkspace(ownerId: string, workspaceId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("civil_paper_workspaces")
    .delete()
    .eq("owner_id", ownerId)
    .eq("workspace_id", workspaceId.trim());
  if (error) throw new Error(`Failed to delete research workspace: ${error.message}`);
}
