import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createBillingPortal,
  createFounderCheckout,
  getBillingState,
  getStripeCustomerId,
  guestBillingState,
  isStripeConfigured,
} from "@/lib/billing";
import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import { getRequestIp, rateLimitHeaders, safeTraceId } from "@/lib/server-guards";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const actionSchema = z.object({ action: z.enum(["checkout", "portal"]) });

function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.hostname === "localhost") return url.origin;
    } catch {
      // Fall back to the request origin below.
    }
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  try {
    const state = identity.isAuthenticated ? await getBillingState(identity.userId) : guestBillingState();
    return applyChatIdentityCookies(NextResponse.json(state), identity, applyAuthCookies);
  } catch (error) {
    console.error("civilmcp_billing_state_failed", error instanceof Error ? error.message : String(error));
    return applyChatIdentityCookies(
      NextResponse.json({ error: "Billing status is temporarily unavailable." }, { status: 503 }),
      identity,
      applyAuthCookies,
    );
  }
}

export async function POST(request: NextRequest) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid billing action." }, { status: 400 });

  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);
  if (!identity.isAuthenticated) {
    return finalize(NextResponse.json({ error: "Sign in before upgrading to Founder Pro." }, { status: 401 }));
  }
  if (!isStripeConfigured()) {
    return finalize(NextResponse.json({ error: "Founder Pro checkout is not configured yet." }, { status: 503 }));
  }

  try {
    const rate = await consumeChatQuota({
      scope: "billing_action",
      userId: identity.userId,
      ipAddress: getRequestIp(request),
      isAuthenticated: true,
      guestMinuteLimit: 1,
      guestHourLimit: 1,
      authenticatedMinuteLimit: 3,
      authenticatedHourLimit: 12,
    });
    if (!rate.allowed) {
      return finalize(NextResponse.json(
        { error: "Too many billing requests. Please try again shortly." },
        { status: 429, headers: rateLimitHeaders(rate) },
      ));
    }

    const customerId = await getStripeCustomerId(identity.userId);
    const origin = appOrigin(request);
    if (parsed.data.action === "portal") {
      if (!customerId) return finalize(NextResponse.json({ error: "No active billing profile was found." }, { status: 409 }));
      const url = await createBillingPortal(customerId, origin);
      return finalize(NextResponse.json({ url }, { headers: rateLimitHeaders(rate) }));
    }

    const state = await getBillingState(identity.userId);
    const url = state.premiumModels && customerId
      ? await createBillingPortal(customerId, origin)
      : await createFounderCheckout({
          userId: identity.userId,
          email: identity.user.email,
          customerId,
          appOrigin: origin,
        });
    return finalize(NextResponse.json({ url }, { headers: rateLimitHeaders(rate) }));
  } catch (error) {
    const traceId = safeTraceId();
    console.error("civilmcp_billing_action_failed", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return finalize(NextResponse.json(
      { error: "Billing is temporarily unavailable.", traceId },
      { status: 502 },
    ));
  }
}
