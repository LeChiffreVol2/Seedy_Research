import { NextRequest, NextResponse } from "next/server";

import { createRouteAuthClient } from "@/lib/chat-auth";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/";
  const redirectUrl = new URL(next.startsWith("/") ? next : "/", requestUrl.origin);

  const response = NextResponse.redirect(redirectUrl);
  if (!code) return response;

  const auth = createRouteAuthClient(request);
  await auth.supabase.auth.exchangeCodeForSession(code);
  return auth.applyCookies(response);
}
