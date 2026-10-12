import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, type Plan } from "@/lib/plans";

/**
 * Minimal Razorpay client over fetch (no SDK): Subscriptions for recurring plans, signature
 * checks for Checkout and webhooks. Each plan and interval maps to a Razorpay plan id from
 * env: RAZORPAY_PLAN_CREATOR_MONTH, RAZORPAY_PLAN_CREATOR_YEAR, … (`npm run razorpay:plans`
 * creates them and prints the lines to paste).
 */
export type Interval = "month" | "year";

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function razorpayKeyId() {
  return process.env.RAZORPAY_KEY_ID ?? "";
}

export function razorpayPlanId(plan: Plan, interval: Interval) {
  return process.env[`RAZORPAY_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`] ?? null;
}

export function planFromRazorpayPlan(id: string): { plan: Plan; interval: Interval } | null {
  for (const plan of PLANS) {
    for (const interval of ["month", "year"] as const) {
      if (razorpayPlanId(plan, interval) === id) return { plan, interval };
    }
  }
  return null;
}

/** How many billing cycles a subscription runs before Razorpay marks it completed. */
export const TOTAL_COUNT: Record<Interval, number> = { month: 120, year: 10 };

async function razorpay<T>(path: string, body?: Record<string, unknown>, method = body ? "POST" : "GET"): Promise<T> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new Error(json.error?.description ?? `Razorpay returned ${res.status}`);
  return json;
}

export type RazorpaySubscription = {
  id: string;
  plan_id: string;
  customer_id?: string | null;
  status: "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed" | "expired" | "paused";
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  ended_at?: number | null;
  short_url?: string;
  notes?: Record<string, string> | [];
};

export type RazorpayPlan = { id: string; period: string; interval: number; item: { name: string; amount: number; currency: string } };

export function createSubscription(opts: { planId: string; interval: Interval; notes: Record<string, string> }) {
  return razorpay<RazorpaySubscription>("/subscriptions", {
    plan_id: opts.planId,
    total_count: TOTAL_COUNT[opts.interval],
    quantity: 1,
    customer_notify: 1,
    notes: opts.notes,
  });
}

export function fetchSubscription(id: string) {
  return razorpay<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(id)}`);
}

/** Cancels now, or at the end of the paid period with `atCycleEnd`. */
export function cancelSubscription(id: string, atCycleEnd: boolean) {
  return razorpay<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
}

export function fetchPlan(id: string) {
  return razorpay<RazorpayPlan>(`/plans/${encodeURIComponent(id)}`);
}

export function createPlan(opts: { period: "monthly" | "yearly"; name: string; amountPaise: number; currency: string; description: string }) {
  return razorpay<RazorpayPlan>("/plans", {
    period: opts.period,
    interval: 1,
    item: { name: opts.name, amount: opts.amountPaise, currency: opts.currency, description: opts.description },
  });
}

let priceCache: { at: number; prices: LivePrices } | null = null;
export type LivePrices = Partial<Record<Plan, Partial<Record<Interval, { amount: number; currency: string }>>>>;

/** Live prices of the configured Razorpay plans (major units), cached for ten minutes. */
export async function razorpayPrices(): Promise<LivePrices> {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.prices;
  const prices: LivePrices = {};
  await Promise.all(
    PLANS.flatMap((plan) =>
      (["month", "year"] as const).map(async (interval) => {
        const id = razorpayPlanId(plan, interval);
        if (!id) return;
        try {
          const p = await fetchPlan(id);
          prices[plan] = { ...prices[plan], [interval]: { amount: p.item.amount / 100, currency: p.item.currency } };
        } catch {
          // Fall back to the static price for this one.
        }
      })
    )
  );
  priceCache = { at: Date.now(), prices };
  return prices;
}

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout's handler signature for a subscription: HMAC-SHA256 of "payment_id|subscription_id". */
export function verifyCheckoutSignature(paymentId: string, subscriptionId: string, signature: string) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

/** X-Razorpay-Signature: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyRazorpayWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  return safeEqualHex(createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
}

export function subscriptionNotes(sub: RazorpaySubscription): Record<string, string> {
  return Array.isArray(sub.notes) ? {} : (sub.notes ?? {});
}
