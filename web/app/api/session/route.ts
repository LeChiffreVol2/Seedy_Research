import { NextRequest, NextResponse } from "next/server";

import { resolveChatIdentity } from "@/lib/chat-auth";
import {
  SESSION_COOKIE_NAME,
  USER_COOKIE_NAME,
  createSessionId,
  ensureChatSession,
  getChatSessionForOwner,
} from "@/lib/chat-store";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

function applySessionCookie(response: NextResponse, sessionId: string, userId?: string) {
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

export async function GET(request: NextRequest) {
  const { identity, applyAuthCookies } = await resolveChatIdentity(request);
  const existingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let snapshot = existingSessionId ? await getChatSessionForOwner(existingSessionId, identity.userId) : null;
  if (!snapshot) {
    snapshot = await ensureChatSession(createSessionId(), identity.userId);
  }

  const response = NextResponse.json({
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    user: identity.user,
    authenticated: identity.isAuthenticated,
    mode: snapshot.mode,
    model: snapshot.model,
    collection: snapshot.collection,
    messages: snapshot.messages,
  });

  if (!existingSessionId || existingSessionId !== snapshot.sessionId || identity.isNewGuest || identity.isAuthenticated) {
    applySessionCookie(response, snapshot.sessionId, identity.isNewGuest || identity.isAuthenticated ? identity.userId : undefined);
  }

  return applyAuthCookies(response);
}
