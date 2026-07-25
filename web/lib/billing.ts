import { createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { chatModelRequiresPro, type ChatModel } from "@/lib/chat-models";

export const FOUNDER_PRO_PRICE_THB = 199;
export const FREE_MONTHLY_CREDITS = 25;
export const PRO_MONTHLY_CREDITS = 150;

export type BillingPlan = "guest" | "free" | "founder_pro";

export type BillingState = {
  plan: BillingPlan;
  status: string;
  creditsIncluded: number | null;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  resetAt: string | null;
  premiumModels: boolean;
  billingConfigured: boolean;
  priceThb: number;
  hasStripeCustomer: boolean;
};

export type CreditReservation = {
  allowed: boolean;
  charged: number;
  plan: BillingPlan;
  creditsRemaining: number | null;
  resetAt: string | null;
  reason: "guest" | "consumed" | "already_consumed" | "pro_required" | "credits_exhausted";
};

type BillingRow = {
  plan?: unknown;
  status?: unknown;
  credits_included?: unknown;
  credits_used?: unknown;
  credits_remaining?: unknown;
  reset_at?: unknown;
  premium_models?: unknown;
  stripe_customer_id?: unknown;
  stripe_subscription_id?: unknown;
};

let supabaseAdminSingleton: any = null;

function getSupabaseAdmin(): any {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for billing.");
  }
  supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } }) as any;
  return supabaseAdminSingleton;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isStripeConfigured(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const price = process.env.STRIPE_FOUNDER_PRO_PRICE_ID?.trim() ?? "";
  return /^sk_(test|live)_[A-Za-z0-9]{16,}$/.test(secret)
    && /^whsec_[A-Za-z0-9]{16,}$/.test(webhook)
    && /^price_[A-Za-z0-9]{8,}$/.test(price);
}

export function guestBillingState(): BillingState {
  return {
    plan: "guest",
    status: "active",
    creditsIncluded: null,
    creditsUsed: null,
    creditsRemaining: null,
    resetAt: null,
    premiumModels: false,
    billingConfigured: isStripeConfigured(),
    priceThb: FOUNDER_PRO_PRICE_THB,
    hasStripeCustomer: false,
  };
}

export async function getBillingState(userId: string): Promise<BillingState> {
  const { data, error } = await getSupabaseAdmin().rpc("civil_get_billing_state", { p_user_id: userId });
  if (error) throw new Error(`Failed to read billing state: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as BillingRow | null;
  if (!row) throw new Error("Billing state was not created.");
  return {
    plan: text(row.plan) === "founder_pro" ? "founder_pro" : "free",
    status: text(row.status) || "active",
    creditsIncluded: number(row.credits_included),
    creditsUsed: number(row.credits_used),
    creditsRemaining: number(row.credits_remaining),
    resetAt: text(row.reset_at) || null,
    premiumModels: row.premium_models === true,
    billingConfigured: isStripeConfigured(),
    priceThb: FOUNDER_PRO_PRICE_THB,
    hasStripeCustomer: Boolean(text(row.stripe_customer_id)),
  };
}

export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("civil_billing_accounts")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read Stripe customer: ${error.message}`);
  return text(data?.stripe_customer_id) || null;
}

export async function reserveAnswerCredits(input: {
  userId: string;
  isAuthenticated: boolean;
  model: ChatModel;
  requestId: string;
  contextOnly?: boolean;
}): Promise<CreditReservation> {
  if (input.contextOnly) {
    return { allowed: true, charged: 0, plan: input.isAuthenticated ? "free" : "guest", creditsRemaining: null, resetAt: null, reason: "guest" };
  }
  if (!input.isAuthenticated) {
    return {
      allowed: !chatModelRequiresPro(input.model),
      charged: 0,
      plan: "guest",
      creditsRemaining: null,
      resetAt: null,
      reason: chatModelRequiresPro(input.model) ? "pro_required" : "guest",
    };
  }
  if (chatModelRequiresPro(input.model)) {
    const billing = await getBillingState(input.userId);
    if (!billing.premiumModels) {
      return {
        allowed: false,
        charged: 0,
        plan: billing.plan,
        creditsRemaining: billing.creditsRemaining,
        resetAt: billing.resetAt,
        reason: "pro_required",
      };
    }
  }

  const { data, error } = await getSupabaseAdmin().rpc("civil_consume_answer_credits", {
    p_user_id: input.userId,
    p_model: input.model,
    p_request_id: input.requestId,
  });
  if (error) throw new Error(`Failed to reserve answer credits: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("Credit reservation returned no state.");
  const reason = text(row.reason) as CreditReservation["reason"];
  return {
    allowed: row.allowed === true,
    charged: number(row.charged),
    plan: text(row.plan) === "founder_pro" ? "founder_pro" : "free",
    creditsRemaining: number(row.credits_remaining),
    resetAt: text(row.reset_at) || null,
    reason,
  };
}

export async function refundAnswerCredits(userId: string, requestId: string, charged: number): Promise<void> {
  if (charged <= 0) return;
  const { error } = await getSupabaseAdmin().rpc("civil_refund_answer_credits", {
    p_user_id: userId,
    p_request_id: requestId,
  });
  if (error) console.error("civilmcp_credit_refund_failed", error.message);
}

async function stripeRequest(path: string, body: URLSearchParams): Promise<Record<string, any>> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Founder Pro checkout is not configured yet.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(text(payload.error?.message) || `Stripe request failed (${response.status}).`);
  }
  return payload;
}

export async function createFounderCheckout(input: {
  userId: string;
  email?: string | null;
  customerId?: string | null;
  appOrigin: string;
}): Promise<string> {
  const priceId = process.env.STRIPE_FOUNDER_PRO_PRICE_ID?.trim();
  if (!priceId) throw new Error("Founder Pro checkout is not configured yet.");
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${input.appOrigin}/?billing=success`,
    cancel_url: `${input.appOrigin}/?billing=cancelled`,
    client_reference_id: input.userId,
    "metadata[user_id]": input.userId,
    "subscription_data[metadata][user_id]": input.userId,
    allow_promotion_codes: "false",
    locale: "auto",
  });
  if (input.customerId) body.set("customer", input.customerId);
  else if (input.email) body.set("customer_email", input.email);
  const session = await stripeRequest("checkout/sessions", body);
  const url = text(session.url);
  if (!url) throw new Error("Stripe did not return a checkout URL.");
  return url;
}

export async function createBillingPortal(customerId: string, appOrigin: string): Promise<string> {
  const session = await stripeRequest(
    "billing_portal/sessions",
    new URLSearchParams({ customer: customerId, return_url: `${appOrigin}/?billing=portal` }),
  );
  const url = text(session.url);
  if (!url) throw new Error("Stripe did not return a billing portal URL.");
  return url;
}

export function verifyStripeSignature(payload: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return false;
  const parts = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean);
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  return signatures.some((signature) => {
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

function stripeDate(value: unknown): string | null {
  const seconds = number(value);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

export async function syncStripeSubscription(event: Record<string, any>): Promise<void> {
  const subscription = event.data?.object as Record<string, any> | undefined;
  if (!subscription || !text(subscription.id) || !text(subscription.customer)) {
    throw new Error("Stripe subscription payload is incomplete.");
  }
  const firstItem = subscription.items?.data?.[0] as Record<string, any> | undefined;
  const priceId = text(firstItem?.price?.id);
  const expectedPriceId = process.env.STRIPE_FOUNDER_PRO_PRICE_ID?.trim();
  if (expectedPriceId && priceId !== expectedPriceId) return;
  const status = event.type === "customer.subscription.deleted" ? "canceled" : text(subscription.status);
  const { error } = await getSupabaseAdmin().rpc("civil_sync_stripe_subscription", {
    p_user_id: text(subscription.metadata?.user_id) || null,
    p_customer_id: text(subscription.customer),
    p_subscription_id: text(subscription.id),
    p_status: status,
    p_period_start: stripeDate(subscription.current_period_start ?? firstItem?.current_period_start),
    p_period_end: stripeDate(subscription.current_period_end ?? firstItem?.current_period_end),
    p_price_id: priceId || null,
    p_event_created_at: stripeDate(event.created),
  });
  if (error) throw new Error(`Failed to sync Stripe subscription: ${error.message}`);
}
