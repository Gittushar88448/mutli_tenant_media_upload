import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { applyRazorpaySubscription } from "@/lib/billing";
import { fetchSubscription, verifyRazorpayWebhook } from "@/lib/billing/razorpay";

/**
 * POST /api/billing/razorpay/webhook — keeps each workspace's plan in step with its Razorpay
 * subscription. In the Razorpay dashboard add this URL as a webhook with the subscription.*
 * events and put its secret in RAZORPAY_WEBHOOK_SECRET.
 *
 * The event body only says which subscription changed; its current state is fetched from
 * Razorpay, so retries and out-of-order deliveries can't set an old state.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyRazorpayWebhook(raw, req.headers.get("x-razorpay-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 400 });
  const event = JSON.parse(raw) as { event?: string; payload?: { subscription?: { entity?: { id?: string } } } };
  const id = event.payload?.subscription?.entity?.id;
  if (!event.event?.startsWith("subscription.") || !id) return NextResponse.json({ received: true, ignored: true });
  await connectDB();
  try {
    await applyRazorpaySubscription(await fetchSubscription(id));
  } catch (e) {
    // A 5xx makes Razorpay retry the delivery later.
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ received: true });
}
