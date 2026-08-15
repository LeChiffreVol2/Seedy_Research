import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { deletePrivateLibraryItem, listPrivateLibraryItems, savePrivateLibraryItem, type PrivateLibraryPage } from "@/lib/private-library";
import { getRequestIp, rateLimitHeaders, readBoundedJson, safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const metadataSchema = z.object({
  importType: z.enum(["doi", "bibtex", "ris", "manual"]),
  value: z.string().trim().min(3).max(40_000),
  title: z.string().trim().max(320).optional(),
  authors: z.array(z.string().trim().max(160)).max(40).optional(),
  publicationYear: z.number().int().min(1600).max(2200).optional().nullable(),
  canonicalUrl: z.string().url().max(500).optional().nullable(),
});

function compact(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function year(value: unknown): number | null {
  const match = compact(value, 40).match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function bibtexField(value: string, name: string): string {
  return compact(value.match(new RegExp(`${name}\\s*=\\s*[\\{\"]([\\s\\S]*?)[\\}\"]\\s*,?`, "i"))?.[1], 500);
}

function parseCitationText(importType: "bibtex" | "ris", value: string) {
  if (importType === "bibtex") {
    const authorText = bibtexField(value, "author");
    return {
      title: bibtexField(value, "title"),
      authors: authorText.split(/\s+and\s+/i).map((author) => compact(author, 160)).filter(Boolean),
      publicationYear: year(bibtexField(value, "year")),
      doi: bibtexField(value, "doi"),
      canonicalUrl: bibtexField(value, "url") || null,
    };
  }
  const fields = new Map<string, string[]>();
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9]{2})\s*-\s*(.+)$/);
    if (!match) continue;
    fields.set(match[1], [...(fields.get(match[1]) ?? []), compact(match[2], 500)]);
  }
  return {
    title: fields.get("TI")?.[0] || fields.get("T1")?.[0] || "",
    authors: [...(fields.get("AU") ?? []), ...(fields.get("A1") ?? [])].slice(0, 40),
    publicationYear: year(fields.get("PY")?.[0] || fields.get("Y1")?.[0]),
    doi: fields.get("DO")?.[0] || "",
    canonicalUrl: fields.get("UR")?.[0] || null,
  };
}

async function crossrefMetadata(rawDoi: string) {
  const doi = compact(rawDoi, 240).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": "CivilMCP/1.0 (mailto:support@civilmcp.app)" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("DOI metadata was not found.");
  const payload = await response.json() as { message?: Record<string, unknown> };
  const message = payload.message ?? {};
  const dateParts = (message.published as { [key: string]: unknown } | undefined)?.["date-parts"];
  const publicationYear = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? Number(dateParts[0][0]) : null;
  return {
    title: compact(Array.isArray(message.title) ? message.title[0] : message.title, 320),
    authors: (Array.isArray(message.author) ? message.author : []).map((author) => {
      const item = author as Record<string, unknown>;
      return compact(`${compact(item.given, 80)} ${compact(item.family, 100)}`, 160);
    }).filter(Boolean).slice(0, 40),
    publicationYear: Number.isInteger(publicationYear) ? publicationYear : null,
    doi,
    canonicalUrl: compact(message.URL, 500) || `https://doi.org/${doi}`,
  };
}

async function extractPdf(file: File): Promise<{ title: string; pages: PrivateLibraryPage[] }> {
  if (file.size > 12 * 1024 * 1024) throw new Error("PDF must be 12 MB or smaller.");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useWorkerFetch: false });
  const document = await task.promise;
  if (document.numPages > 200) throw new Error("PDF must contain 200 pages or fewer.");
  const metadata = await document.getMetadata().catch(() => null);
  const pages: PrivateLibraryPage[] = [];
  let totalCharacters = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = compact(content.items.map((item) => "str" in item ? item.str : "").join(" "), 20_000);
    totalCharacters += text.length;
    if (totalCharacters > 300_000) throw new Error("Extracted PDF text exceeds the 300,000-character private-library limit.");
    if (text) pages.push({ page: pageNumber, text });
  }
  await document.destroy();
  const info = metadata?.info as Record<string, unknown> | undefined;
  return { title: compact(info?.Title, 320), pages };
}

async function resolveIdentity(request: NextRequest) {
  try {
    return { resolved: await resolveChatIdentity(request), response: null };
  } catch (error) {
    return { resolved: null, response: chatIdentityErrorResponse(error, request) };
  }
}

export async function GET(request: NextRequest) {
  const result = await resolveIdentity(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to use a private library." }, { status: 401 }));
  try {
    return finalize(NextResponse.json({ items: await listPrivateLibraryItems(identity.userId) }));
  } catch {
    return finalize(NextResponse.json({ error: "Private library is temporarily unavailable." }, { status: 503 }));
  }
}

export async function POST(request: NextRequest) {
  const result = await resolveIdentity(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to import private research." }, { status: 401 }));
  const quota = await consumeChatQuota({
    scope: "private_library_import", userId: identity.userId, ipAddress: getRequestIp(request), isAuthenticated: true,
    guestMinuteLimit: 1, guestHourLimit: 1, authenticatedMinuteLimit: 3, authenticatedHourLimit: 20,
  }).catch(() => null);
  if (!quota) return finalize(NextResponse.json({ error: "Private import quota is temporarily unavailable." }, { status: 503 }));
  if (!quota.allowed) return finalize(NextResponse.json({ error: "Private import limit reached." }, { status: 429, headers: rateLimitHeaders(quota) }));

  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.type !== "application/pdf") {
        return finalize(NextResponse.json({ error: "Choose a PDF file." }, { status: 422 }));
      }
      const extracted = await extractPdf(file);
      const title = compact(form.get("title"), 320) || extracted.title || file.name.replace(/\.pdf$/i, "");
      const item = await savePrivateLibraryItem({ ownerId: identity.userId, title, importType: "pdf", pages: extracted.pages });
      return finalize(NextResponse.json({ item }, { status: 201, headers: rateLimitHeaders(quota) }));
    }

    const parsed = metadataSchema.safeParse(await readBoundedJson(request, 50_000).catch(() => null));
    if (!parsed.success) return finalize(NextResponse.json({ error: "Invalid private-library import." }, { status: 422 }));
    const metadata = parsed.data.importType === "doi"
      ? await crossrefMetadata(parsed.data.value)
      : parsed.data.importType === "manual"
        ? { title: parsed.data.title || parsed.data.value, authors: parsed.data.authors ?? [], publicationYear: parsed.data.publicationYear ?? null, doi: "", canonicalUrl: parsed.data.canonicalUrl ?? null }
        : parseCitationText(parsed.data.importType, parsed.data.value);
    if (!metadata.title) return finalize(NextResponse.json({ error: "The import does not contain a readable title." }, { status: 422 }));
    const item = await savePrivateLibraryItem({ ownerId: identity.userId, importType: parsed.data.importType, ...metadata });
    return finalize(NextResponse.json({ item }, { status: 201, headers: rateLimitHeaders(quota) }));
  } catch (error) {
    const traceId = safeTraceId();
    const message = error instanceof Error ? error.message : "";
    console.error("civilmcp_private_import_failed", { traceId, error: message || "Unknown error" });
    const safeMessage = /^(?:PDF must|Extracted PDF text exceeds|DOI metadata was not found)/.test(message)
      ? message
      : "Private research could not be imported.";
    return finalize(NextResponse.json({ error: safeMessage, traceId }, { status: 422 }));
  }
}

export async function DELETE(request: NextRequest) {
  const result = await resolveIdentity(request);
  if (result.response) return result.response;
  const { identity, applyAuthCookies } = result.resolved!;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) return finalize(NextResponse.json({ error: "Sign in to edit a private library." }, { status: 401 }));
  const itemId = request.nextUrl.searchParams.get("itemId")?.trim();
  if (!itemId) return finalize(NextResponse.json({ error: "itemId is required." }, { status: 400 }));
  try {
    await deletePrivateLibraryItem(identity.userId, itemId);
    return finalize(NextResponse.json({ ok: true }));
  } catch {
    return finalize(NextResponse.json({ error: "Private source could not be removed." }, { status: 503 }));
  }
}
