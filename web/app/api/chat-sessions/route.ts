import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import {
  archiveChatSession,
  createChatSession,
  listChatSessions,
} from "@/lib/chat-store";
import { setSessionCookie } from "@/lib/chat-cookies";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const createPayloadSchema = z.object({
  action: z.enum(["create"]).default("create"),
});

async function resolveUser(request: NextRequest) {
  const { identity, applyAuthCookies } = await resolveChatIdentity(request);
  return {
    userId: identity.userId,
    user: identity.user,
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
  const result = await resolveUserOrResponse(request);
  if (result.response) return result.response;
  const { userId, user, isAuthenticated, applyAuthCookies } = result.resolved!;
  const sessions = await listChatSessions(userId);
  const response = NextResponse.json({ user, sessions, authenticated: isAuthenticated });
  return applyChatIdentityCookies(response, { userId, isAuthenticated }, applyAuthCookies);
}

export async function POST(request: NextRequest) {
  const payload = createPayloadSchema.parse(await request.json().catch(() => ({})));
  const result = await resolveUserOrResponse(request);
  if (result.response) return result.response;
  const { userId, user, isAuthenticated, applyAuthCookies } = result.resolved!;
  if (payload.action !== "create") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const session = await createChatSession(userId);
  const sessions = await listChatSessions(userId);
  const response = NextResponse.json({ user, session, sessions, authenticated: isAuthenticated });
  setSessionCookie(response, session.sessionId);
  return applyChatIdentityCookies(response, { userId, isAuthenticated }, applyAuthCookies);
}

export async function DELETE(request: NextRequest) {
  const result = await resolveUserOrResponse(request);
  if (result.response) return result.response;
  const { userId, isAuthenticated, applyAuthCookies } = result.resolved!;
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }
  await archiveChatSession(sessionId, userId);
  const sessions = await listChatSessions(userId);
  const response = NextResponse.json({ ok: true, sessions, authenticated: isAuthenticated });
  return applyChatIdentityCookies(response, { userId, isAuthenticated }, applyAuthCookies);
}
