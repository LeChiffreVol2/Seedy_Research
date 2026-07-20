import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  applyChatIdentityCookies,
  chatIdentityErrorResponse,
  createRouteAuthClient,
  getAuthenticatedChatUser,
  resolveChatIdentity,
} from "@/lib/chat-auth";
import {
  SESSION_COOKIE_NAME,
  ensureChatUser,
  transferChatSessions,
} from "@/lib/chat-store";
import { clearChatCookies, signedGuestIdFromRequest } from "@/lib/chat-cookies";
import { transferWorkspaceItems } from "@/lib/paper-workspace";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(8).max(128);
const displayNameSchema = z.string().trim().min(1).max(80);

const authPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("oauth"),
    provider: z.literal("google"),
  }),
  z.object({
    action: z.literal("signin"),
    email: emailSchema,
    password: passwordSchema,
  }),
  z.object({
    action: z.literal("signup"),
    displayName: displayNameSchema,
    email: emailSchema,
    password: passwordSchema,
  }),
  z.object({
    action: z.literal("magic-link"),
    email: emailSchema,
  }),
  z.object({
    action: z.literal("forgot-password"),
    email: emailSchema,
  }),
  z.object({
    action: z.literal("update-password"),
    password: passwordSchema,
  }),
  z.object({
    action: z.literal("profile"),
    displayName: displayNameSchema,
  }),
]);

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function finalizeAuthenticatedResponse(
  request: NextRequest,
  authUserId: string,
  profile: { displayName: string; email?: string | null },
  applyCookies: (response: NextResponse) => NextResponse,
) {
  const previousOwnerId = signedGuestIdFromRequest(request);
  const user = await ensureChatUser(authUserId, {
    displayName: profile.displayName,
    email: profile.email ?? null,
    isGuest: false,
  });
  await transferChatSessions(previousOwnerId, authUserId);
  try {
    await transferWorkspaceItems(previousOwnerId, authUserId);
  } catch (error) {
    console.warn("civilmcp_workspace_transfer_failed", error instanceof Error ? error.message : String(error));
  }
  const response = NextResponse.json({ user, authenticated: true });
  return applyChatIdentityCookies(response, { userId: authUserId, isAuthenticated: true }, applyCookies);
}

export async function GET(request: NextRequest) {
  let authenticated: Awaited<ReturnType<typeof getAuthenticatedChatUser>>;
  try {
    authenticated = await getAuthenticatedChatUser(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  if (authenticated.authUser && authenticated.user) {
    const response = NextResponse.json({ user: authenticated.user, authenticated: true });
    return applyChatIdentityCookies(
      response,
      { userId: authenticated.authUser.id, isAuthenticated: true },
      authenticated.applyCookies,
    );
  }

  let guest: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    guest = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  return applyChatIdentityCookies(
    NextResponse.json({ user: guest.identity.user, authenticated: false }),
    guest.identity,
    guest.applyAuthCookies,
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = authPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid auth payload.");
  }

  const auth = createRouteAuthClient(request);
  const payload = parsed.data;

  if (payload.action === "oauth") {
    const callbackUrl = new URL("/auth/callback", request.nextUrl.origin);
    const { data, error } = await auth.supabase.auth.signInWithOAuth({
      provider: payload.provider,
      options: {
        redirectTo: callbackUrl.toString(),
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) {
      return auth.applyCookies(errorResponse(error?.message ?? "Google sign-in is unavailable."));
    }
    return auth.applyCookies(NextResponse.json({ url: data.url }));
  }

  if (payload.action === "forgot-password") {
    const callbackUrl = new URL("/auth/callback", request.nextUrl.origin);
    callbackUrl.searchParams.set("next", "/?auth=recovery");
    const { error } = await auth.supabase.auth.resetPasswordForEmail(payload.email, {
      redirectTo: callbackUrl.toString(),
    });
    if (error) {
      console.warn("civilmcp_password_recovery_request_failed", error.message);
    }
    return auth.applyCookies(NextResponse.json({ ok: true, pendingEmail: true }));
  }

  if (payload.action === "update-password") {
    const { data: currentUser, error: userError } = await auth.supabase.auth.getUser();
    if (userError || !currentUser.user) {
      return auth.applyCookies(errorResponse("This recovery session has expired. Request a new recovery link.", 401));
    }
    const { data, error } = await auth.supabase.auth.updateUser({ password: payload.password });
    if (error || !data.user) {
      return auth.applyCookies(errorResponse(error?.message ?? "Password could not be updated."));
    }
    const displayName =
      (typeof data.user.user_metadata?.display_name === "string" && data.user.user_metadata.display_name) ||
      (typeof data.user.user_metadata?.name === "string" && data.user.user_metadata.name) ||
      data.user.email?.split("@")[0] ||
      "Researcher";
    const user = await ensureChatUser(data.user.id, {
      displayName,
      email: data.user.email ?? null,
      isGuest: false,
    });
    const response = NextResponse.json({ user, authenticated: true });
    return applyChatIdentityCookies(response, { userId: data.user.id, isAuthenticated: true }, auth.applyCookies);
  }

  if (payload.action === "magic-link") {
    const { error } = await auth.supabase.auth.signInWithOtp({
      email: payload.email,
      options: {
        emailRedirectTo: `${request.nextUrl.origin}/auth/callback`,
      },
    });
    if (error) {
      return errorResponse(error.message);
    }
    return auth.applyCookies(NextResponse.json({ ok: true, pendingEmail: true }));
  }

  if (payload.action === "profile") {
    const { data, error } = await auth.supabase.auth.getUser();
    if (error || !data.user) {
      return auth.applyCookies(errorResponse("Sign in before updating your profile.", 401));
    }
    const user = await ensureChatUser(data.user.id, {
      displayName: payload.displayName,
      email: data.user.email ?? null,
      isGuest: false,
    });
    const response = NextResponse.json({ user, authenticated: true });
    return applyChatIdentityCookies(response, { userId: data.user.id, isAuthenticated: true }, auth.applyCookies);
  }

  if (payload.action === "signup") {
    const { data, error } = await auth.supabase.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: {
          display_name: payload.displayName,
          name: payload.displayName,
        },
      },
    });
    if (error) {
      return auth.applyCookies(errorResponse(error.message));
    }
    if (!data.session || !data.user) {
      return auth.applyCookies(NextResponse.json({ ok: true, pendingEmail: true }));
    }
    return finalizeAuthenticatedResponse(request, data.user.id, {
      displayName: payload.displayName,
      email: data.user.email ?? payload.email,
    }, auth.applyCookies);
  }

  const { data, error } = await auth.supabase.auth.signInWithPassword({
    email: payload.email,
    password: payload.password,
  });
  if (error || !data.user) {
    return auth.applyCookies(errorResponse(error?.message ?? "Sign in failed."));
  }

  return finalizeAuthenticatedResponse(request, data.user.id, {
    displayName:
      (typeof data.user.user_metadata?.display_name === "string" && data.user.user_metadata.display_name) ||
      (typeof data.user.user_metadata?.name === "string" && data.user.user_metadata.name) ||
      data.user.email?.split("@")[0] ||
      "Researcher",
    email: data.user.email ?? payload.email,
  }, auth.applyCookies);
}

export async function DELETE(request: NextRequest) {
  const auth = createRouteAuthClient(request);
  await auth.supabase.auth.signOut();

  const response = NextResponse.json({ ok: true });
  auth.applyCookies(response);
  clearChatCookies(response);
  return response;
}
