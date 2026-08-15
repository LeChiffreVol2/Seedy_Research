import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { normalizeCollectionFilter, type CollectionFilter } from "@/lib/chat-store";

let supabaseAdminSingleton: any = null;

function getSupabaseAdmin(): any {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Living Review storage is not configured.");
  supabaseAdminSingleton = createClient(url, key, { auth: { persistSession: false } }) as any;
  return supabaseAdminSingleton;
}

export type LivingReviewWatch = {
  watchId: string;
  query: string;
  collection: CollectionFilter;
  resultCount: number;
  newCount: number;
  active: boolean;
  lastCheckedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type WatchRow = {
  watch_id: string;
  query: string;
  collection?: string | null;
  result_count?: number | null;
  new_count?: number | null;
  active?: boolean | null;
  last_checked_at?: string | null;
  created_at?: string;
  updated_at?: string;
  result_keys?: unknown;
};

function normalize(row: WatchRow): LivingReviewWatch {
  return {
    watchId: row.watch_id,
    query: row.query,
    collection: normalizeCollectionFilter(row.collection),
    resultCount: row.result_count ?? 0,
    newCount: row.new_count ?? 0,
    active: row.active !== false,
    lastCheckedAt: row.last_checked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FIELDS = "watch_id, query, collection, result_count, new_count, active, last_checked_at, created_at, updated_at";

export async function listLivingReviewWatches(ownerId: string): Promise<LivingReviewWatch[]> {
  const { data, error } = await getSupabaseAdmin().from("civil_living_review_watches")
    .select(FIELDS).eq("owner_id", ownerId).order("updated_at", { ascending: false }).limit(50);
  if (error) throw new Error(`Living Reviews could not be loaded: ${error.message}`);
  return ((data ?? []) as WatchRow[]).map(normalize);
}

export async function createLivingReviewWatch(input: {
  ownerId: string;
  query: string;
  collection: CollectionFilter;
  resultKeys: string[];
}): Promise<LivingReviewWatch> {
  const now = new Date().toISOString();
  const client = getSupabaseAdmin();
  const { data: existing, error: existingError } = await client.from("civil_living_review_watches")
    .select("watch_id").eq("owner_id", input.ownerId).eq("query", input.query).eq("collection", input.collection).maybeSingle();
  if (existingError) throw new Error(`Living Review could not be checked: ${existingError.message}`);
  const values = {
    result_keys: [...new Set(input.resultKeys)].slice(0, 200), result_count: input.resultKeys.length,
    new_count: 0, active: true, last_checked_at: now, updated_at: now,
  };
  const operation = existing?.watch_id
    ? client.from("civil_living_review_watches").update(values).eq("owner_id", input.ownerId).eq("watch_id", existing.watch_id)
    : client.from("civil_living_review_watches").insert({ watch_id: randomUUID(), owner_id: input.ownerId, query: input.query, collection: input.collection, ...values });
  const { data, error } = await operation.select(FIELDS).single();
  if (error) throw new Error(`Living Review could not be saved: ${error.message}`);
  return normalize(data as WatchRow);
}

export async function getLivingReviewWatch(ownerId: string, watchId: string): Promise<WatchRow | null> {
  const { data, error } = await getSupabaseAdmin().from("civil_living_review_watches")
    .select(`${FIELDS}, result_keys`).eq("owner_id", ownerId).eq("watch_id", watchId).maybeSingle();
  if (error) throw new Error(`Living Review could not be loaded: ${error.message}`);
  return data as WatchRow | null;
}

export async function updateLivingReviewWatch(input: {
  ownerId: string;
  watchId: string;
  resultKeys: string[];
  previousKeys: string[];
}): Promise<LivingReviewWatch> {
  const nextKeys = [...new Set(input.resultKeys)].slice(0, 200);
  const previous = new Set(input.previousKeys);
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin().from("civil_living_review_watches").update({
    result_keys: nextKeys,
    result_count: nextKeys.length,
    new_count: nextKeys.filter((key) => !previous.has(key)).length,
    last_checked_at: now,
    updated_at: now,
  }).eq("owner_id", input.ownerId).eq("watch_id", input.watchId).select(FIELDS).single();
  if (error) throw new Error(`Living Review could not be refreshed: ${error.message}`);
  return normalize(data as WatchRow);
}

export async function deleteLivingReviewWatch(ownerId: string, watchId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("civil_living_review_watches")
    .delete().eq("owner_id", ownerId).eq("watch_id", watchId);
  if (error) throw new Error(`Living Review could not be removed: ${error.message}`);
}
