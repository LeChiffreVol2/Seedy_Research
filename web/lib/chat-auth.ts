import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import {
  createUserId,
  ensureChatUser,
  getChatUser,
  type ChatUserProfile,
} from "@/lib/chat-store";
import {
  applyIdentityCookie,
  assertGuestCookieConfigured,
  signedGuestIdFromRequest,
} from "@/lib/chat-cookies";
import { isPlaceholderSecret } from "@/lib/server-guards";

type CookieSet = {
  name: string;
  value: string;
  options?: any;
};

export type ChatIdentity = {
  userId: string;
  user: ChatUserProfile;
  isAuthenticated: boolean;
  isNewGuest: boolean;
};

export class ChatIdentityError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 503,
  ) {
    super(message);
    this.name = "ChatIdentityError";
  }
}

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}

export function chatIdentityErrorResponse(error: unknown, request?: NextRequest): NextResponse {
  let response: NextResponse;
  if (error instanceof ChatIdentityError) {
    response = NextResponse.json({ error: error.message }, { status: error.statusCode });
  } else {
    console.error("civilmcp_identity_resolution_failed", error instanceof Error ? error.message : String(error));
    response = NextResponse.json({ error: "Chat identity service is temporarily unavailable." }, { status: 503 });
  }
  if (error instanceof ChatIdentityError && error.statusCode === 401) {
    for (const { name } of request?.cookies.getAll() ?? []) {
      if (/^sb-.+-auth-token(?:\.\d+)?$/.test(name)) response.cookies.delete(name);
    }
  }
  return response;
}

function getSupabaseAuthConfig() {
  const normalizeEnv = (value: string | undefined) => value?.trim().replace(/^['"]|['"]$/g, "");
  const isHttpUrl = (value: string | undefined) => {
    if (!value) return false;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };
  const isSupabaseAnonKey = (value: string | undefined) => {
    if (!value || value.length < 32 || isPlaceholderSecret(value)) return false;
    if (value.startsWith("sb_publishable_")) return true;

    const segments = value.split(".");
    if (segments.length !== 3) return false;
    try {
      const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as { role?: unknown };
      return payload.role === "anon";
    } catch {
      return false;
    }
  };
  const supabaseUrl = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL]
    .map(normalizeEnv)
    .find(isHttpUrl);
  const supabaseAnonKey = [
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
  ]
    .map(normalizeEnv)
    .find(isSupabaseAnonKey);

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new ChatIdentityError("Authentication is temporarily unavailable.", 503);
  }

  return { supabaseUrl, supabaseAnonKey };
}

export function createRouteAuthClient(request: NextRequest) {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseAuthConfig();
  const cookiesToSet: CookieSet[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(nextCookies) {
        cookiesToSet.push(...nextCookies);
      },
    },
  });

  return {
    supabase,
    applyCookies(response: NextResponse) {
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
      return response;
    },
  };
}

function authDisplayName(user: User): string {
  const metadata = user.user_metadata ?? {};
  const name =
    (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata.name === "string" && metadata.name.trim()) ||
    (typeof metadata.display_name === "string" && metadata.display_name.trim()) ||
    user.email?.split("@")[0] ||
    "Researcher";
  return name.slice(0, 80);
}

export async function getAuthenticatedChatUser(request: NextRequest): Promise<{
  authUser: User | null;
  user: ChatUserProfile | null;
  applyCookies: (response: NextResponse) => NextResponse;
}> {
  const auth = createRouteAuthClient(request);
  const hadAuthCookie = hasSupabaseAuthCookie(request);
  const { data, error } = await auth.supabase.auth.getUser();
  const authUser = error ? null : data.user;

  if (!authUser) {
    if (hadAuthCookie) {
      const status = Number((error as { status?: unknown } | null)?.status);
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const rejected = status === 401 || status === 403 || /expired|jwt|session|token/.test(message);
      throw new ChatIdentityError(
        rejected ? "Your sign-in session has expired. Please sign in again." : "Authentication is temporarily unavailable.",
        rejected ? 401 : 503,
      );
    }
    return { authUser: null, user: null, applyCookies: auth.applyCookies };
  }

  const user = await ensureChatUser(authUser.id, {
    displayName: authDisplayName(authUser),
    email: authUser.email ?? null,
    isGuest: false,
  });

  return { authUser, user, applyCookies: auth.applyCookies };
}

export function applyChatIdentityCookies(
  response: NextResponse,
  identity: Pick<ChatIdentity, "userId" | "isAuthenticated">,
  applyAuthCookies: (response: NextResponse) => NextResponse,
): NextResponse {
  applyAuthCookies(response);
  return applyIdentityCookie(response, identity);
}

export async function resolveChatIdentity(request: NextRequest): Promise<{
  identity: ChatIdentity;
  applyAuthCookies: (response: NextResponse) => NextResponse;
}> {
  assertGuestCookieConfigured();
  const authenticated = await getAuthenticatedChatUser(request);
  if (authenticated.authUser && authenticated.user) {
    return {
      identity: {
        userId: authenticated.authUser.id,
        user: authenticated.user,
        isAuthenticated: true,
        isNewGuest: false,
      },
      applyAuthCookies: authenticated.applyCookies,
    };
  }

  const existingUserId = signedGuestIdFromRequest(request);
  const userId = existingUserId || createUserId();
  const storedUser = existingUserId ? await getChatUser(userId) : null;
  const user: ChatUserProfile = storedUser ?? {
    userId,
    displayName: "Guest researcher",
    email: null,
    isGuest: true,
  };

  return {
    identity: {
      userId,
      user,
      isAuthenticated: false,
      isNewGuest: !existingUserId,
    },
    applyAuthCookies: authenticated.applyCookies,
  };
}

export async function getKnownChatUser(userId: string): Promise<ChatUserProfile | null> {
  return getChatUser(userId);
}
