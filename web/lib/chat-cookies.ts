import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { isPlaceholderSecret, isStrictProductionRuntime } from "@/lib/server-guards";

export const SESSION_COOKIE_NAME = "civilmcp_session";
export const GUEST_COOKIE_NAME = "civilmcp_user";

const GUEST_COOKIE_VERSION = "g1";
const GUEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function deriveCivilSecurityKey(purpose: "guest-session" | "quota"): string | undefined {
  const source = process.env.MCP_SERVER_API_KEY?.trim();
  if (!source || source.length < 32 || isPlaceholderSecret(source)) return undefined;
  return createHmac("sha256", source).update(`civilmcp:${purpose}:v1`).digest("hex");
}

function guestCookieSecret(): string {
  // ponytail: domain-separated compatibility key; dedicated keys still take priority.
  const configured = process.env.GUEST_SESSION_HMAC_KEY?.trim() || deriveCivilSecurityKey("guest-session");
  if (configured && !isPlaceholderSecret(configured) && (!isStrictProductionRuntime() || configured.length >= 32)) {
    return configured;
  }
  if (isStrictProductionRuntime()) {
    throw new Error("GUEST_SESSION_HMAC_KEY must be a non-placeholder secret with at least 32 characters in production.");
  }
  return "civilmcp-local-guest-cookie-development-key";
}

function signatureFor(payload: string): string {
  return createHmac("sha256", guestCookieSecret()).update(payload).digest("base64url");
}

export function assertGuestCookieConfigured(): void {
  guestCookieSecret();
}

export function createSignedGuestCookie(userId: string, now = Date.now()): string {
  if (!UUID_PATTERN.test(userId)) throw new Error("Guest user id must be a UUID.");
  const expiresAt = Math.floor(now / 1000) + GUEST_COOKIE_MAX_AGE_SECONDS;
  const payload = `${GUEST_COOKIE_VERSION}.${userId}.${expiresAt}`;
  return `${payload}.${signatureFor(payload)}`;
}

export function verifySignedGuestCookie(value: string | undefined | null, now = Date.now()): string | null {
  const parts = (value ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== GUEST_COOKIE_VERSION) return null;
  const [, userId, rawExpiresAt, providedSignature] = parts;
  if (!UUID_PATTERN.test(userId)) return null;
  const expiresAt = Number.parseInt(rawExpiresAt, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;

  const payload = `${GUEST_COOKIE_VERSION}.${userId}.${rawExpiresAt}`;
  const expected = Buffer.from(signatureFor(payload));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return userId;
}

export function signedGuestIdFromRequest(request: NextRequest): string | null {
  return verifySignedGuestCookie(request.cookies.get(GUEST_COOKIE_NAME)?.value);
}

export function setGuestCookie(response: NextResponse, userId: string): void {
  response.cookies.set({
    name: GUEST_COOKIE_NAME,
    value: createSignedGuestCookie(userId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearGuestCookie(response: NextResponse): void {
  response.cookies.delete(GUEST_COOKIE_NAME);
}

export function setSessionCookie(response: NextResponse, sessionId: string): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearChatCookies(response: NextResponse): void {
  response.cookies.delete(GUEST_COOKIE_NAME);
  response.cookies.delete(SESSION_COOKIE_NAME);
}

export function applyIdentityCookie(
  response: NextResponse,
  identity: { userId: string; isAuthenticated: boolean },
): NextResponse {
  if (identity.isAuthenticated) clearGuestCookie(response);
  else setGuestCookie(response, identity.userId);
  return response;
}
