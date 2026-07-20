import { NextRequest, NextResponse } from "next/server";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import {
  SESSION_COOKIE_NAME,
  createEmptyChatSession,
  createSessionId,
  getChatSessionForOwner,
  isValidSessionId,
} from "@/lib/chat-store";
import { setSessionCookie } from "@/lib/chat-cookies";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

export async function GET(request: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const existingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let snapshot = isValidSessionId(existingSessionId)
    ? await getChatSessionForOwner(existingSessionId, identity.userId)
    : null;
  if (!snapshot) {
    snapshot = createEmptyChatSession(isValidSessionId(existingSessionId) ? existingSessionId : createSessionId());
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
    setSessionCookie(response, snapshot.sessionId);
  }

  return applyChatIdentityCookies(response, identity, applyAuthCookies);
}
