import { createClient } from "@supabase/supabase-js";

const embedModel = process.env.EMBED_MODEL ?? "text-embedding-3-small";
let supabaseSingleton: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (supabaseSingleton) return supabaseSingleton;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY are required.");
  }

  supabaseSingleton = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  return supabaseSingleton;
}

async function embedQuery(text: string): Promise<number[]> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for embedding queries.");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: embedModel,
      input: text,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Embedding API failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding API returned empty data.");
  }
  return embedding;
}

const validDisciplines = new Set([
  "",
  "transport",
  "structural",
  "geotechnical",
  "construction_mgmt",
]);

export async function searchChunks(
  query: string,
  discipline = "",
  maxResults = 5,
): Promise<string> {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) {
    return "No query provided.";
  }

  const cleanedDiscipline = validDisciplines.has(discipline) ? discipline : "";
  const safeMax = Math.min(Math.max(maxResults, 1), 10);
  const embedding = await embedQuery(cleanedQuery);
  const supabase = getSupabaseClient();

  const { data, error } = await (supabase as any).rpc("match_civil_chunks", {
    query_embedding: embedding,
    match_count: safeMax,
    filter_disc: cleanedDiscipline || null,
  });

  if (error) {
    throw new Error(`Supabase RPC failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return "No relevant content found in the knowledge base.";
  }

  return (data as Array<{ source: string; discipline: string; content: string; similarity: number }>)
    .map((row) => `[${row.similarity.toFixed(3)}] ${row.source} · ${row.discipline}\n${row.content}`)
    .join("\n\n---\n\n");
}
