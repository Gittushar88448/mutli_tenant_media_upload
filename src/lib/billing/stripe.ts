import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, type Plan } from "@/lib/plans";

/**
 * Minimal Stripe client over fetch (no SDK): Checkout for upgrades, the Billing Portal for
 * changes and cancellation, and webhook signature checks. Prices come from env, one per
 * plan and interval: STRIPE_PRICE_CREATOR_MONTH, STRIPE_PRICE_CREATOR_YEAR, …
 */
export type Interval = "month" | "year";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export function priceId(plan: Plan, interval: Interval) {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`] ?? null;
}

/** Maps a Stripe price back to the plan and interval it sells. */
export function planFromPrice(price: string): { plan: Plan; interval: Interval } | null {
  for (const plan of PLANS) {
    for (const interval of ["month", "year"] as const) {
      if (priceId(plan, interval) === price) return { plan, interval };
    }
  }
  return null;
}

/** Stripe wants form encoding with bracketed keys for nested objects. */
function encode(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? encode(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") encode(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>, method = body ? "POST" : "GET"): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: body ? encode(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Stripe returned ${res.status}`);
  return json;
}

export async function createCustomer(opts: { email: string; name: string; workspaceId: string }) {
  return stripe<{ id: string }>("/customers", { email: opts.email, name: opts.name, metadata: { workspaceId: opts.workspaceId } });
}

export async function createCheckoutSession(opts: { customerId: string; price: string; workspaceId: string; plan: Plan; successUrl: string; cancelUrl: string }) {
  return stripe<{ id: string; url: string }>("/checkout/sessions", {
    mode: "subscription",
    customer: opts.customerId,
    line_items: [{ price: opts.price, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: opts.workspaceId,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: { workspaceId: opts.workspaceId, plan: opts.plan },
    subscription_data: { metadata: { workspaceId: opts.workspaceId, plan: opts.plan } },
  });
}

export async function createPortalSession(customerId: string, returnUrl: string) {
  return stripe<{ url: string }>("/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
}

export async function getSubscription(id: string) {
  return stripe<StripeSubscription>(`/subscriptions/${id}`);
}

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: { price: { id: string }; current_period_end?: number }[] };
};

/** Verifies the Stripe-Signature header (t=…,v1=…) against the raw body, with a 5-minute tolerance. */
export function verifyWebhook(rawBody: string, header: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3), "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
