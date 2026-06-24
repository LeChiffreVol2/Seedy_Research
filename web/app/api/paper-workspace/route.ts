import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveChatIdentity } from "@/lib/chat-auth";
import { deleteWorkspaceItem, listWorkspaceItems, upsertWorkspaceItem } from "@/lib/paper-workspace";
import { checkRateLimit, rateLimitHeaders, requestIdentityKey } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const workspacePayloadSchema = z.object({
  documentId: z.string().trim().max(160).optional().nullable(),
  source: z.string().trim().min(1).max(320),
  collection: z.string().trim().max(40).optional().nullable(),
  paperCode: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  labels: z.array(z.string().trim().max(60)).max(20).optional(),
});

function checkWorkspaceRate(request: NextRequest) {
  return checkRateLimit(requestIdentityKey(request, "paper_workspace"), 60, 60);
}

export async function GET(request: NextRequest) {
  const rate = checkWorkspaceRate(request);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many workspace requests." }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  const { identity, applyAuthCookies } = await resolveChatIdentity(request);
  const items = await listWorkspaceItems(identity.userId);
  return applyAuthCookies(NextResponse.json({ items }, { headers: rateLimitHeaders(rate) }));
}

export async function POST(request: NextRequest) {
  const rate = checkWorkspaceRate(request);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many workspace requests." }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  const parsed = workspacePayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400, headers: rateLimitHeaders(rate) });
  }
  const { identity, applyAuthCookies } = await resolveChatIdentity(request);
  const item = await upsertWorkspaceItem({ ownerId: identity.userId, ...parsed.data });
  return applyAuthCookies(NextResponse.json({ item }, { headers: rateLimitHeaders(rate) }));
}

export async function DELETE(request: NextRequest) {
  const rate = checkWorkspaceRate(request);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many workspace requests." }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  const source = request.nextUrl.searchParams.get("source")?.trim();
  if (!source) {
    return NextResponse.json({ error: "source is required." }, { status: 400, headers: rateLimitHeaders(rate) });
  }
  const { identity, applyAuthCookies } = await resolveChatIdentity(request);
  await deleteWorkspaceItem(identity.userId, source);
  return applyAuthCookies(NextResponse.json({ ok: true }, { headers: rateLimitHeaders(rate) }));
}
