import { createClient } from "@supabase/supabase-js";

export type VisibilityCorrectionSuggestion = {
  suggestionId: string;
  source: string;
  kind: "match" | "metadata_correction" | "review_request";
  proposedExternalWorkId: string | null;
  proposedDoi: string | null;
  note: string;
  status: "pending" | "under_review" | "accepted" | "rejected" | "duplicate";
  stewardNote: string;
  createdAt: string;
  updatedAt: string;
};

let adminClient: ReturnType<typeof createClient> | null = null;

function getAdmin() {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase server credentials are required for visibility corrections.");
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function normalize(row: Record<string, unknown>): VisibilityCorrectionSuggestion {
  return {
    suggestionId: boundedText(row.suggestion_id, 80),
    source: boundedText(row.source, 320),
    kind: row.kind as VisibilityCorrectionSuggestion["kind"],
    proposedExternalWorkId: boundedText(row.proposed_external_work_id, 180) || null,
    proposedDoi: boundedText(row.proposed_doi, 180) || null,
    note: boundedText(row.note, 1500),
    status: row.status as VisibilityCorrectionSuggestion["status"],
    stewardNote: boundedText(row.steward_note, 2000),
    createdAt: boundedText(row.created_at, 80),
    updatedAt: boundedText(row.updated_at, 80),
  };
}

const SELECT = "suggestion_id, source, kind, proposed_external_work_id, proposed_doi, note, status, steward_note, created_at, updated_at";

export async function listVisibilityCorrectionSuggestions(ownerId: string, source?: string): Promise<VisibilityCorrectionSuggestion[]> {
  const client = getAdmin() as any;
  let query = client
    .from("civil_visibility_correction_suggestions")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (source) query = query.eq("source", boundedText(source, 320));
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list visibility suggestions: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => normalize(row));
}

export async function createVisibilityCorrectionSuggestion(input: {
  ownerId: string;
  source: string;
  kind: VisibilityCorrectionSuggestion["kind"];
  proposedExternalWorkId?: string | null;
  proposedDoi?: string | null;
  note?: string;
}): Promise<VisibilityCorrectionSuggestion> {
  const source = boundedText(input.source, 320);
  if (!source) throw new Error("A source is required.");
  const client = getAdmin() as any;
  const { data, error } = await client
    .from("civil_visibility_correction_suggestions")
    .insert({
      owner_id: input.ownerId,
      source,
      kind: input.kind,
      proposed_external_work_id: boundedText(input.proposedExternalWorkId, 180) || null,
      proposed_doi: boundedText(input.proposedDoi, 180) || null,
      note: boundedText(input.note, 1500),
      status: "pending",
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(`Failed to create visibility suggestion: ${error.message}`);
  return normalize(data as Record<string, unknown>);
}
