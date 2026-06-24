import { NextRequest, NextResponse } from "next/server";

import { resolveChatIdentity } from "@/lib/chat-auth";
import {
  SESSION_COOKIE_NAME,
  USER_COOKIE_NAME,
  createSessionId,
  ensureChatSession,
  ensureShareableSession,
  getChatSessionForOwner,
} from "@/lib/chat-store";

import { z } from "zod";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const sharePayloadSchema = z.object({
  sessionId: z.string().uuid().optional(),
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

export async function POST(request: NextRequest) {
  const payload = sharePayloadSchema.parse(await request.json().catch(() => ({})));
  const { identity, applyAuthCookies } = await resolveChatIdentity(request);

  const existingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const requestedSessionId = payload.sessionId || existingSessionId;
  let sessionId = requestedSessionId || createSessionId();

  const existing = requestedSessionId ? await getChatSessionForOwner(requestedSessionId, identity.userId) : null;
  if (!existing) {
    if (requestedSessionId) {
      sessionId = createSessionId();
    }
    const created = await ensureChatSession(sessionId, identity.userId);
    sessionId = created.sessionId;
  }
  const shareId = await ensureShareableSession(sessionId);
  const baseUrl = request.nextUrl.origin;
  const response = NextResponse.json({
    shareId,
    shareUrl: `${baseUrl}/?share=${shareId}`,
  });

  if (!existingSessionId || existingSessionId !== sessionId || identity.isNewGuest || identity.isAuthenticated) {
    setSessionCookie(response, sessionId, identity.isNewGuest || identity.isAuthenticated ? identity.userId : undefined);
  }

  return applyAuthCookies(response);
}
