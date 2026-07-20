import type { McpEvidence } from "./types";
import { loadOpsEnv } from "./env";

type McpPayload = {
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
  _meta?: Record<string, unknown>;
};

type McpChunkResult = {
  id?: string;
  source?: string;
  section_title?: string;
  page_start?: number | null;
  page_end?: number | null;
  similarity?: number | null;
  content?: string;
};

function truncate(value: string, maxChars: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars - 1).trim()}…`;
}

function citationForResult(result: McpChunkResult): string {
  const pageStart = result.page_start;
  const pageEnd = result.page_end;
  const pagePart =
    pageStart == null || pageEnd == null ? "" : pageStart === pageEnd ? ` p.${pageStart}` : ` p.${pageStart}-${pageEnd}`;
  return `${result.source ?? "CivilMCP source"} · ${result.section_title ?? "Untitled section"}${pagePart}`;
}

export async function callMcpTool(name: string, argumentsPayload: Record<string, unknown>): Promise<McpPayload> {
  loadOpsEnv();
  const mcpUrl = (process.env.MCP_URL ?? "").replace(/\/+$/, "");
  if (!mcpUrl) {
    throw new Error("MCP_URL is not configured");
  }

  const response = await fetch(`${mcpUrl}/tools/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.MCP_SERVER_API_KEY ? { Authorization: `Bearer ${process.env.MCP_SERVER_API_KEY}` } : {}),
    },
    body: JSON.stringify({ name, arguments: argumentsPayload }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CivilMCP ${name} failed: ${response.status} ${truncate(text, 180)}`);
  }

  return (await response.json()) as McpPayload;
}

export function evidenceFromMcpPayload(payload: McpPayload): McpEvidence[] {
  const structured = payload.structuredContent;
  if (!structured || typeof structured !== "object" || !("results" in structured)) return [];

  const results = (structured as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results.slice(0, 5).map((result, index) => {
    const chunk = result as McpChunkResult;
    return {
      id: String(chunk.id ?? `mcp-evidence-${index + 1}`),
      source: String(chunk.source ?? "CivilMCP"),
      sectionTitle: String(chunk.section_title ?? "Untitled section"),
      pageStart: chunk.page_start,
      pageEnd: chunk.page_end,
      similarity: chunk.similarity,
      content: truncate(String(chunk.content ?? ""), 420),
      citation: citationForResult(chunk),
    };
  });
}

export async function searchTransportEvidence(query: string): Promise<McpEvidence[]> {
  return searchCivilEvidence(query, "transport", 5);
}

export async function searchCivilEvidence(query: string, discipline = "transport", maxResults = 5): Promise<McpEvidence[]> {
  const payload = await callMcpTool("search_civil_chunks", {
    query,
    discipline,
    max_results: maxResults,
    collection: "",
  });
  return evidenceFromMcpPayload(payload);
}
