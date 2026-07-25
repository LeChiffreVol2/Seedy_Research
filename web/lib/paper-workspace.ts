import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { normalizeCollectionFilter, type CollectionFilter } from "@/lib/chat-store";

let supabaseAdminSingleton: any = null;

function getSupabaseAdmin(): any {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for paper workspace.");
  }
  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } }) as any;
  return supabaseAdminSingleton;
}

export type PaperWorkspaceItem = {
  id: string;
  ownerId: string;
  documentId?: string | null;
  source: string;
  collection: CollectionFilter;
  paperCode?: string | null;
  note: string;
  labels: string[];
  createdAt?: string;
  updatedAt?: string;
};

type PaperWorkspaceRow = {
  id: string;
  owner_id: string;
  document_id?: string | null;
  source: string;
  collection?: string | null;
  paper_code?: string | null;
  note?: string | null;
  labels?: unknown;
  created_at?: string;
  updated_at?: string;
};

function normalizeRow(row: PaperWorkspaceRow): PaperWorkspaceItem {
  return {
    id: row.id,
    ownerId: row.owner_id,
    documentId: row.document_id ?? null,
    source: row.source,
    collection: normalizeCollectionFilter(row.collection),
    paperCode: row.paper_code ?? null,
    note: row.note ?? "",
    labels: Array.isArray(row.labels) ? row.labels.map(String).slice(0, 20) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function workspaceItemId(ownerId: string, source: string): string {
  return createHash("sha256").update(`${ownerId}\n${source}`).digest("hex").slice(0, 32);
}

export async function listWorkspaceItems(ownerId: string, limit = 100): Promise<PaperWorkspaceItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("civil_paper_workspace_items")
    .select("id, owner_id, document_id, source, collection, paper_code, note, labels, created_at, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));
  if (error) throw new Error(`Failed to list workspace items: ${error.message}`);
  return ((data ?? []) as PaperWorkspaceRow[]).map(normalizeRow);
}

export async function upsertWorkspaceItem(input: {
  ownerId: string;
  documentId?: string | null;
  source: string;
  collection?: string | null;
  paperCode?: string | null;
  note?: string | null;
  labels?: string[];
}): Promise<PaperWorkspaceItem> {
  const source = input.source.trim().slice(0, 320);
  if (!source) throw new Error("source is required.");
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("civil_paper_workspace_items")
    .upsert(
      {
        id: workspaceItemId(input.ownerId, source),
        owner_id: input.ownerId,
        document_id: input.documentId ?? null,
        source,
        collection: normalizeCollectionFilter(input.collection),
        paper_code: input.paperCode?.trim().slice(0, 80) || null,
        note: input.note?.trim().slice(0, 2000) || "",
        labels: [...new Set(input.labels ?? [])].map(String).slice(0, 20),
        updated_at: now,
      },
      { onConflict: "owner_id,source" },
    )
    .select("id, owner_id, document_id, source, collection, paper_code, note, labels, created_at, updated_at")
    .single();
  if (error) throw new Error(`Failed to save workspace item: ${error.message}`);
  return normalizeRow(data as PaperWorkspaceRow);
}

export async function deleteWorkspaceItem(ownerId: string, source: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("civil_paper_workspace_items")
    .delete()
    .eq("owner_id", ownerId)
    .eq("source", source.trim());
  if (error) throw new Error(`Failed to delete workspace item: ${error.message}`);
}

export async function transferWorkspaceItems(fromOwnerId: string | null | undefined, toOwnerId: string): Promise<void> {
  const from = fromOwnerId?.trim();
  const to = toOwnerId.trim();
  if (!from || !to || from === to) return;

  const supabase = getSupabaseAdmin();
  const { data: guestItems, error: guestError } = await supabase
    .from("civil_paper_workspace_items")
    .select("id, owner_id, document_id, source, collection, paper_code, note, labels, created_at, updated_at")
    .eq("owner_id", from);
  if (guestError) throw new Error(`Failed to read guest workspace items: ${guestError.message}`);

  const sourceItems = (guestItems ?? []) as PaperWorkspaceRow[];
  if (!sourceItems.length) return;

  const sources = [...new Set(sourceItems.map((item) => item.source))];
  const { data: accountItems, error: accountError } = await supabase
    .from("civil_paper_workspace_items")
    .select("id, owner_id, document_id, source, collection, paper_code, note, labels, created_at, updated_at")
    .eq("owner_id", to)
    .in("source", sources);
  if (accountError) throw new Error(`Failed to read account workspace items: ${accountError.message}`);

  const accountBySource = new Map(
    ((accountItems ?? []) as PaperWorkspaceRow[]).map((item) => [item.source, item]),
  );
  const labels = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  const now = new Date().toISOString();
  const mergedItems = sourceItems.map((guestItem) => {
    const accountItem = accountBySource.get(guestItem.source);
    return {
      id: accountItem?.id ?? workspaceItemId(to, guestItem.source),
      owner_id: to,
      document_id: accountItem?.document_id ?? guestItem.document_id ?? null,
      source: guestItem.source,
      collection: normalizeCollectionFilter(accountItem?.collection ?? guestItem.collection),
      paper_code: accountItem?.paper_code ?? guestItem.paper_code ?? null,
      note: accountItem?.note?.trim() ? accountItem.note : guestItem.note ?? "",
      labels: [...new Set([...labels(accountItem?.labels), ...labels(guestItem.labels)])].slice(0, 20),
      updated_at: now,
    };
  });

  const { error: mergeError } = await supabase
    .from("civil_paper_workspace_items")
    .upsert(mergedItems, { onConflict: "owner_id,source" });
  if (mergeError) throw new Error(`Failed to merge guest workspace items: ${mergeError.message}`);

  const { error: deleteError } = await supabase
    .from("civil_paper_workspace_items")
    .delete()
    .eq("owner_id", from);
  if (deleteError) throw new Error(`Failed to clear transferred guest workspace items: ${deleteError.message}`);
}
