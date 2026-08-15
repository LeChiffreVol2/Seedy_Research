import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { chatIdentityErrorResponse, createRouteAuthClient } from "@/lib/chat-auth";
import { readBoundedJson } from "@/lib/server-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const revokeSchema = z.object({ clientId: z.string().uuid() });

async function authenticated(request: NextRequest) {
  const auth = createRouteAuthClient(request);
  const { data, error } = await auth.supabase.auth.getUser();
  if (error || !data.user) {
    return { auth, response: auth.applyCookies(NextResponse.json({ error: "Sign in to manage connected apps." }, { status: 401 })) };
  }
  return { auth, response: null };
}
export async function GET(request: NextRequest) {
  try {
    const result = await authenticated(request);
    if (result.response) return result.response;
    const { data, error } = await result.auth.supabase.auth.oauth.listGrants();
    if (error) return result.auth.applyCookies(NextResponse.json({ grants: [], oauthAvailable: false }));
    return result.auth.applyCookies(NextResponse.json({ grants: data ?? [], oauthAvailable: true }));
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
}

export async function DELETE(request: NextRequest) {
  const parsed = revokeSchema.safeParse(await readBoundedJson(request, 2_048).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid OAuth client id is required." }, { status: 422 });
  try {
    const result = await authenticated(request);
    if (result.response) return result.response;
    const { error } = await result.auth.supabase.auth.oauth.revokeGrant({ clientId: parsed.data.clientId });
    if (error) return result.auth.applyCookies(NextResponse.json({ error: "Connected app access could not be revoked." }, { status: 503 }));
    return result.auth.applyCookies(NextResponse.json({ ok: true }));
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
}
