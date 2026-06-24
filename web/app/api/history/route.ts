import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveChatIdentity } from "@/lib/chat-auth";
import {
  DEFAULT_CHAT_MODE,
  SESSION_COOKIE_NAME,
  USER_COOKIE_NAME,
  createSessionId,
  ensureChatSession,
  getChatSessionForOwner,
  getChatSessionByShareId,
  normalizeChatMode,
  normalizeCollectionFilter,
  saveChatSession,
} from "@/lib/chat-store";
import { normalizeChatModel } from "@/lib/chat-models";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const historyPayloadSchema = z.object({
  sessionId: z.string().uuid().optional(),
  title: z.string().max(120).optional(),
  mode: z.enum(["baseline", "mcp"]).default(DEFAULT_CHAT_MODE),
  model: z.string().optional().transform(normalizeChatModel),
  collection: z.string().optional().transform(normalizeCollectionFilter),
  messages: z.array(z.any()).default([]),
});

function setSessionCookie(response: NextResponse, sessionId: string, userId?: string) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  if (userId) {
    response.cookies.set({
      name: USER_COOKIE_NAME,
      value: userId,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
}

async function resolveUser(request: NextRequest) {
  const { identity, applyAuthCookies } = await resolveChatIdentity(request);
  return {
    userId: identity.userId,
    profile: identity.user,
    isNew: identity.isNewGuest,
    isAuthenticated: identity.isAuthenticated,
    applyAuthCookies,
  };
}

export async function GET(request: NextRequest) {
  const shareId = request.nextUrl.searchParams.get("share")?.trim();
  if (shareId) {
    const shared = await getChatSessionByShareId(shareId);
    if (!shared) {
      return NextResponse.json({ error: "Shared session not found." }, { status: 404 });
    }
    return NextResponse.json(shared);
  }

  const { userId, profile, isNew, isAuthenticated, applyAuthCookies } = await resolveUser(request);
  const requestedSessionId = request.nextUrl.searchParams.get("session")?.trim();
  if (requestedSessionId) {
    const requested = await getChatSessionForOwner(requestedSessionId, userId);
    if (!requested) {
      return NextResponse.json({ error: "Chat session not found." }, { status: 404 });
    }
    const response = NextResponse.json({ ...requested, user: profile, authenticated: isAuthenticated });
    setSessionCookie(response, requested.sessionId, isNew || isAuthenticated ? userId : undefined);
    return applyAuthCookies(response);
  }

  const existingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let snapshot = existingSessionId ? await getChatSessionForOwner(existingSessionId, userId) : null;
  if (!snapshot) {
    snapshot = await ensureChatSession(createSessionId(), userId);
  }
  const response = NextResponse.json({ ...snapshot, user: profile, authenticated: isAuthenticated });

  if (!existingSessionId || existingSessionId !== snapshot.sessionId || isNew || isAuthenticated) {
    setSessionCookie(response, snapshot.sessionId, isNew || isAuthenticated ? userId : undefined);
  }

  return applyAuthCookies(response);
}

export async function POST(request: NextRequest) {
  const { userId, isNew, isAuthenticated, applyAuthCookies } = await resolveUser(request);
  const payload = historyPayloadSchema.parse(await request.json());
  const existingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let sessionId = payload.sessionId || existingSessionId || createSessionId();
  const ownedSession = await getChatSessionForOwner(sessionId, userId);
  if ((payload.sessionId || existingSessionId) && !ownedSession) {
    sessionId = createSessionId();
  }

  await saveChatSession(sessionId, {
    sessionId,
    title: payload.title || "Untitled chat",
    mode: normalizeChatMode(payload.mode),
    model: normalizeChatModel(payload.model),
    collection: normalizeCollectionFilter(payload.collection),
    messages: payload.messages,
  }, userId);

  const response = NextResponse.json({ ok: true, sessionId });
  if (!existingSessionId || existingSessionId !== sessionId || isNew || isAuthenticated) {
    setSessionCookie(response, sessionId, isNew || isAuthenticated ? userId : undefined);
  }
  return applyAuthCookies(response);
}
