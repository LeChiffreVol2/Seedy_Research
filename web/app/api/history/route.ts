import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import {
  DEFAULT_CHAT_MODE,
  SESSION_COOKIE_NAME,
  createEmptyChatSession,
  createSessionId,
  getChatSessionForOwner,
  getChatSessionByShareId,
  isValidSessionId,
  normalizeChatMode,
  normalizeCollectionFilter,
  saveChatSession,
  consumeChatQuota,
  ensureChatUser,
} from "@/lib/chat-store";
import { normalizeChatModel } from "@/lib/chat-models";
import { setSessionCookie } from "@/lib/chat-cookies";
import { clampEnvNumber, getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const HISTORY_MAX_BODY_BYTES = clampEnvNumber(process.env.HISTORY_MAX_BODY_BYTES, 8_192, 1_000_000, 220_000);
const HISTORY_MAX_MESSAGES = clampEnvNumber(process.env.HISTORY_MAX_MESSAGES, 2, 200, 80);

const historyPayloadSchema = z.object({
  sessionId: z.string().uuid().optional(),
  title: z.string().max(120).optional(),
  mode: z.enum(["baseline", "mcp"]).default(DEFAULT_CHAT_MODE),
  model: z.string().optional().transform(normalizeChatModel),
  collection: z.string().optional().transform(normalizeCollectionFilter),
  messages: z.array(z.any()).max(HISTORY_MAX_MESSAGES).default([]),
});

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

async function resolveUserOrResponse(request: NextRequest) {
  try {
    return { resolved: await resolveUser(request), response: null };
  } catch (error) {
    return { resolved: null, response: chatIdentityErrorResponse(error, request) };
  }
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

  const result = await resolveUserOrResponse(request);
  if (result.response) return result.response;
  const { userId, profile, isNew, isAuthenticated, applyAuthCookies } = result.resolved!;
  const requestedSessionId = request.nextUrl.searchParams.get("session")?.trim();
  if (requestedSessionId) {
    const requested = await getChatSessionForOwner(requestedSessionId, userId);
    if (!requested) {
      return NextResponse.json({ error: "Chat session not found." }, { status: 404 });
    }
    const response = NextResponse.json({ ...requested, user: profile, authenticated: isAuthenticated });
    setSessionCookie(response, requested.sessionId);
    return applyChatIdentityCookies(response, { userId, isAuthenticated }, applyAuthCookies);
  }

  const existingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let snapshot = isValidSessionId(existingSessionId) ? await getChatSessionForOwner(existingSessionId, userId) : null;
  if (!snapshot) {
    snapshot = createEmptyChatSession(isValidSessionId(existingSessionId) ? existingSessionId : createSessionId());
  }
  const response = NextResponse.json({ ...snapshot, user: profile, authenticated: isAuthenticated });

  if (!existingSessionId || existingSessionId !== snapshot.sessionId || isNew || isAuthenticated) {
    setSessionCookie(response, snapshot.sessionId);
  }

  return applyChatIdentityCookies(response, { userId, isAuthenticated }, applyAuthCookies);
}

export async function POST(request: NextRequest) {
  let rawPayload: unknown;
  try {
    rawPayload = await readBoundedJson(request, HISTORY_MAX_BODY_BYTES);
  } catch (error) {
    const status = Number((error as { statusCode?: unknown }).statusCode) || 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid history payload." }, { status });
  }
  const parsed = historyPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid history payload." }, { status: 400 });

  const result = await resolveUserOrResponse(request);
  if (result.response) return result.response;
  const { userId, isNew, isAuthenticated, applyAuthCookies } = result.resolved!;
  const payload = parsed.data;
  let rate: Awaited<ReturnType<typeof consumeChatQuota>>;
  try {
    rate = await consumeChatQuota({
      scope: "history_write",
      userId,
      ipAddress: getRequestIp(request),
      isAuthenticated,
      guestMinuteLimit: 30,
      guestHourLimit: 300,
      authenticatedMinuteLimit: 60,
      authenticatedHourLimit: 600,
    });
  } catch {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "History quota service is temporarily unavailable." }, { status: 503 }),
      { userId, isAuthenticated },
      applyAuthCookies,
    );
  }
  if (!rate.allowed) {
    return applyChatIdentityCookies(
      NextResponse.json(
        { error: "Too many history updates. Please retry later." },
        { status: 429, headers: rateLimitHeaders(rate) },
      ),
      { userId, isAuthenticated },
      applyAuthCookies,
    );
  }
  if (!isAuthenticated) await ensureChatUser(userId, { isGuest: true });
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

  const response = NextResponse.json({ ok: true, sessionId }, { headers: rateLimitHeaders(rate) });
  if (!existingSessionId || existingSessionId !== sessionId || isNew || isAuthenticated) {
    setSessionCookie(response, sessionId);
  }
  return applyChatIdentityCookies(response, { userId, isAuthenticated }, applyAuthCookies);
}
