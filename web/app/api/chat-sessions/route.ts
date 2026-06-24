import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveChatIdentity } from "@/lib/chat-auth";
import {
  SESSION_COOKIE_NAME,
  USER_COOKIE_NAME,
  archiveChatSession,
  createChatSession,
  listChatSessions,
} from "@/lib/chat-store";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const createPayloadSchema = z.object({
  action: z.enum(["create"]).default("create"),
});

function setCookies(response: NextResponse, sessionId: string, userId?: string) {
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
    user: identity.user,
    isNew: identity.isNewGuest,
    isAuthenticated: identity.isAuthenticated,
    applyAuthCookies,
  };
}

export async function GET(request: NextRequest) {
  const { userId, user, isNew, isAuthenticated, applyAuthCookies } = await resolveUser(request);
  const sessions = await listChatSessions(userId);
  const response = NextResponse.json({ user, sessions, authenticated: isAuthenticated });
  if (isNew || isAuthenticated) {
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
  return applyAuthCookies(response);
}

export async function POST(request: NextRequest) {
  const payload = createPayloadSchema.parse(await request.json().catch(() => ({})));
  const { userId, user, isNew, isAuthenticated, applyAuthCookies } = await resolveUser(request);
  if (payload.action !== "create") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const session = await createChatSession(userId);
  const sessions = await listChatSessions(userId);
  const response = NextResponse.json({ user, session, sessions, authenticated: isAuthenticated });
  setCookies(response, session.sessionId, isNew || isAuthenticated ? userId : undefined);
  return applyAuthCookies(response);
}

export async function DELETE(request: NextRequest) {
  const { userId, isNew, isAuthenticated, applyAuthCookies } = await resolveUser(request);
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }
  await archiveChatSession(sessionId, userId);
  const sessions = await listChatSessions(userId);
  const response = NextResponse.json({ ok: true, sessions, authenticated: isAuthenticated });
  if (isNew || isAuthenticated) {
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
  return applyAuthCookies(response);
}
