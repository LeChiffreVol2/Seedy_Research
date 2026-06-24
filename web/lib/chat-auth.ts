import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import {
  USER_COOKIE_NAME,
  createUserId,
  ensureChatUser,
  getChatUser,
  type ChatUserProfile,
} from "@/lib/chat-store";

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

function getSupabaseAuthConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for Supabase Auth.");
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
  const { data, error } = await auth.supabase.auth.getUser();
  const authUser = error ? null : data.user;

  if (!authUser) {
    return { authUser: null, user: null, applyCookies: auth.applyCookies };
  }

  const user = await ensureChatUser(authUser.id, {
    displayName: authDisplayName(authUser),
    email: authUser.email ?? null,
    isGuest: false,
  });

  return { authUser, user, applyCookies: auth.applyCookies };
}

export function setLegacyUserCookie(response: NextResponse, userId: string) {
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

export async function resolveChatIdentity(request: NextRequest): Promise<{
  identity: ChatIdentity;
  applyAuthCookies: (response: NextResponse) => NextResponse;
}> {
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

  const existingUserId = request.cookies.get(USER_COOKIE_NAME)?.value;
  const userId = existingUserId || createUserId();
  const storedUser = existingUserId ? await ensureChatUser(userId) : await ensureChatUser(userId, { isGuest: true });
  const user = { ...storedUser, isGuest: true };

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
