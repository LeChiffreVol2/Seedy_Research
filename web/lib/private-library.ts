import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

let supabaseAdminSingleton: any = null;

function getSupabaseAdmin(): any {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Private library storage is not configured.");
  supabaseAdminSingleton = createClient(url, key, { auth: { persistSession: false } }) as any;
  return supabaseAdminSingleton;
}

export type PrivateLibraryPage = { page: number; text: string };
export type PrivateLibraryItem = {
  itemId: string;
  source: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  doi: string | null;
  canonicalUrl: string | null;
  importType: "pdf" | "doi" | "bibtex" | "ris" | "manual";
  pageCount: number;
  pages?: PrivateLibraryPage[];
  createdAt?: string;
  updatedAt?: string;
};

type PrivateLibraryRow = {
  item_id: string;
  source: string;
  title: string;
  authors?: unknown;
  publication_year?: number | null;
  doi?: string | null;
  canonical_url?: string | null;
  import_type: PrivateLibraryItem["importType"];
  pages?: unknown;
  page_count?: number | null;
  created_at?: string;
  updated_at?: string;
};

function normalizeRow(row: PrivateLibraryRow, includePages = false): PrivateLibraryItem {
  const pages = Array.isArray(row.pages)
    ? row.pages.flatMap((value) => value && typeof value === "object"
      ? [{ page: Number((value as Record<string, unknown>).page), text: String((value as Record<string, unknown>).text ?? "") }]
      : []).filter((page) => Number.isInteger(page.page) && page.page > 0 && page.text)
    : [];
  return {
    itemId: row.item_id,
    source: row.source,
    title: row.title,
    authors: Array.isArray(row.authors) ? row.authors.map(String).slice(0, 40) : [],
    publicationYear: row.publication_year ?? null,
    doi: row.doi ?? null,
    canonicalUrl: row.canonical_url ?? null,
    importType: row.import_type,
    pageCount: row.page_count ?? pages.length,
    ...(includePages ? { pages } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PUBLIC_FIELDS = "item_id, source, title, authors, publication_year, doi, canonical_url, import_type, page_count, created_at, updated_at";

export async function listPrivateLibraryItems(ownerId: string): Promise<PrivateLibraryItem[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("civil_private_library_items")
    .select(PUBLIC_FIELDS)
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Private library could not be loaded: ${error.message}`);
  return ((data ?? []) as PrivateLibraryRow[]).map((row) => normalizeRow(row));
}

export async function getPrivateLibraryItem(ownerId: string, source: string): Promise<PrivateLibraryItem | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("civil_private_library_items")
    .select(`${PUBLIC_FIELDS}, pages`)
    .eq("owner_id", ownerId)
    .eq("source", source)
    .maybeSingle();
  if (error) throw new Error(`Private source could not be loaded: ${error.message}`);
  return data ? normalizeRow(data as PrivateLibraryRow, true) : null;
}

export async function savePrivateLibraryItem(input: {
  ownerId: string;
  title: string;
  authors?: string[];
  publicationYear?: number | null;
  doi?: string | null;
  canonicalUrl?: string | null;
  importType: PrivateLibraryItem["importType"];
  pages?: PrivateLibraryPage[];
}): Promise<PrivateLibraryItem> {
  const itemId = randomUUID();
  const source = `private:${itemId}`;
  const pages = (input.pages ?? []).slice(0, 500).map((page) => ({ page: page.page, text: page.text.slice(0, 20_000) }));
  const values = {
    item_id: itemId,
    owner_id: input.ownerId,
    source,
    title: input.title.trim().slice(0, 320),
    authors: [...new Set(input.authors ?? [])].map((author) => author.trim()).filter(Boolean).slice(0, 40),
    publication_year: input.publicationYear ?? null,
    doi: input.doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").slice(0, 240) || null,
    canonical_url: input.canonicalUrl?.trim().slice(0, 500) || null,
    import_type: input.importType,
    pages,
    page_count: pages.length,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getSupabaseAdmin()
    .from("civil_private_library_items")
    .insert(values)
    .select(PUBLIC_FIELDS)
    .single();
  if (error) throw new Error(`Private source could not be saved: ${error.message}`);
  return normalizeRow(data as PrivateLibraryRow);
}

export async function deletePrivateLibraryItem(ownerId: string, itemId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("civil_private_library_items")
    .delete()
    .eq("owner_id", ownerId)
    .eq("item_id", itemId);
  if (error) throw new Error(`Private source could not be removed: ${error.message}`);
}
