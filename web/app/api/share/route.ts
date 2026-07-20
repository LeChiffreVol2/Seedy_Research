import { NextRequest, NextResponse } from "next/server";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import {
  SESSION_COOKIE_NAME,
  consumeChatQuota,
  ensureShareableSession,
  getChatSessionForOwner,
  revokeShareableSession,
} from "@/lib/chat-store";
import { setSessionCookie } from "@/lib/chat-cookies";
import { getRequestIp, rateLimitHeaders, readBoundedJson } from "@/lib/server-guards";

import { z } from "zod";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const sharePayloadSchema = z.object({
  sessionId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = sharePayloadSchema.safeParse(await readBoundedJson(request, 4_096).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid share payload." }, { status: 400 });
  const payload = parsed.data;
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const rate = await consumeChatQuota({
    scope: "share_write",
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 10,
    guestHourLimit: 60,
    authenticatedMinuteLimit: 20,
    authenticatedHourLimit: 120,
  }).catch(() => null);
  if (!rate) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Share quota service is temporarily unavailable." }, { status: 503 }),
      identity,
      applyAuthCookies,
    );
  }
  if (!rate.allowed) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Too many share requests." }, { status: 429, headers: rateLimitHeaders(rate) }),
      identity,
      applyAuthCookies,
    );
  }

  const existingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const requestedSessionId = payload.sessionId || existingSessionId;
  const sessionId = requestedSessionId;

  const existing = sessionId ? await getChatSessionForOwner(sessionId, identity.userId) : null;
  if (!sessionId || !existing || existing.messages.length === 0) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Add a message before sharing this chat." }, { status: 409 }),
      identity,
      applyAuthCookies,
    );
  }
  const share = await ensureShareableSession(sessionId, identity.userId);
  const baseUrl = request.nextUrl.origin;
  const response = NextResponse.json({
    shareId: share.shareId,
    shareUrl: `${baseUrl}/?share=${share.shareId}`,
    expiresAt: share.expiresAt,
  }, { headers: rateLimitHeaders(rate) });

  if (!existingSessionId || existingSessionId !== sessionId || identity.isNewGuest || identity.isAuthenticated) {
    setSessionCookie(response, sessionId);
  }

  return applyChatIdentityCookies(response, identity, applyAuthCookies);
}

export async function DELETE(request: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const rate = await consumeChatQuota({
    scope: "share_write",
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: 10,
    guestHourLimit: 60,
    authenticatedMinuteLimit: 20,
    authenticatedHourLimit: 120,
  }).catch(() => null);
  if (!rate) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Share quota service is temporarily unavailable." }, { status: 503 }),
      identity,
      applyAuthCookies,
    );
  }
  if (!rate.allowed) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Too many share requests." }, { status: 429, headers: rateLimitHeaders(rate) }),
      identity,
      applyAuthCookies,
    );
  }
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return applyChatIdentityCookies(
      NextResponse.json({ error: "sessionId is required." }, { status: 400 }),
      identity,
      applyAuthCookies,
    );
  }
  await revokeShareableSession(sessionId, identity.userId);
  return applyChatIdentityCookies(
    NextResponse.json({ ok: true }, { headers: rateLimitHeaders(rate) }),
    identity,
    applyAuthCookies,
  );
}
