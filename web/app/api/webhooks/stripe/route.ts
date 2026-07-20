import { NextRequest, NextResponse } from "next/server";

import { syncStripeSubscription, verifyStripeSignature } from "@/lib/billing";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(request: NextRequest) {
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(payload) as Record<string, any>;
  } catch {
    return NextResponse.json({ error: "Invalid Stripe payload." }, { status: 400 });
  }
  if (!SUBSCRIPTION_EVENTS.has(String(event.type ?? ""))) {
    return NextResponse.json({ received: true });
  }

  try {
    await syncStripeSubscription(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("civilmcp_stripe_webhook_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Stripe subscription sync failed." }, { status: 500 });
  }
}
