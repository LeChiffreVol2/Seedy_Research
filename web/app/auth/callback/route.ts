import { NextRequest, NextResponse } from "next/server";

import { createRouteAuthClient } from "@/lib/chat-auth";
import { clearGuestCookie, signedGuestIdFromRequest } from "@/lib/chat-cookies";
import { ensureChatUser, transferChatSessions } from "@/lib/chat-store";
import { transferWorkspaceItems } from "@/lib/paper-workspace";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const redirectUrl = new URL(safeNext, requestUrl.origin);

  const response = NextResponse.redirect(redirectUrl);
  if (!code) return response;

  const auth = createRouteAuthClient(request);
  const previousOwnerId = signedGuestIdFromRequest(request);
  const { data, error } = await auth.supabase.auth.exchangeCodeForSession(code);
  if (!error && data.user) {
    await ensureChatUser(data.user.id, {
      displayName:
        (typeof data.user.user_metadata?.display_name === "string" && data.user.user_metadata.display_name) ||
        (typeof data.user.user_metadata?.name === "string" && data.user.user_metadata.name) ||
        data.user.email?.split("@")[0] ||
        "Researcher",
      email: data.user.email ?? null,
      isGuest: false,
    });
    await transferChatSessions(previousOwnerId, data.user.id);
    try {
      await transferWorkspaceItems(previousOwnerId, data.user.id);
    } catch (transferError) {
      console.warn(
        "civilmcp_workspace_transfer_failed",
        transferError instanceof Error ? transferError.message : String(transferError),
      );
    }
    clearGuestCookie(response);
  }
  return auth.applyCookies(response);
}
