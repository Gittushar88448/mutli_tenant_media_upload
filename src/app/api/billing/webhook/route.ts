import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Workspace, isOid, oid } from "@/lib/models";
import { getSubscription, planFromPrice, verifyWebhook, type StripeSubscription } from "@/lib/billing/stripe";
import { audit } from "@/lib/audit";

/**
 * POST /api/billing/webhook — Stripe events keep each workspace's plan in step with its
 * subscription. Point a Stripe webhook at this URL with checkout.session.completed and
 * customer.subscription.created/updated/deleted, and put its secret in STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("stripe-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 400 });
  const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
  await connectDB();

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as { subscription?: string; client_reference_id?: string; customer?: string };
    if (s.subscription) await applySubscription(await getSubscription(s.subscription), s.client_reference_id);
  } else if (event.type.startsWith("customer.subscription.")) {
    await applySubscription(event.data.object as unknown as StripeSubscription);
  }
  return NextResponse.json({ received: true });
}

async function applySubscription(sub: StripeSubscription, workspaceHint?: string) {
  const wsId = sub.metadata?.workspaceId ?? workspaceHint;
  const ws = wsId && isOid(wsId) ? await Workspace.findById(oid(wsId)) : await Workspace.findOne({ "billing.customerId": sub.customer });
  if (!ws) return;
  const item = sub.items?.data?.[0];
  const mapped = item ? planFromPrice(item.price.id) : null;
  const ended = ["canceled", "incomplete_expired", "unpaid"].includes(sub.status);
  const from = ws.plan;
  // A cancelled or unpaid subscription drops to Free; past_due keeps the plan while Stripe retries.
  ws.plan = ended ? "free" : (mapped?.plan ?? ws.plan);
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  ws.set("billing", {
    provider: "stripe",
    customerId: sub.customer,
    subscriptionId: ended ? undefined : sub.id,
    status: ended ? "canceled" : (["active", "trialing", "past_due", "incomplete"].includes(sub.status) ? sub.status : "active"),
    interval: mapped?.interval ?? ws.billing?.interval,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
  await ws.save();
  if (from !== ws.plan) await audit({ action: "billing.plan_changed", workspaceId: String(ws._id), entity: "workspace", entityId: String(ws._id), meta: { from, to: ws.plan, provider: "stripe", status: sub.status } });
}
