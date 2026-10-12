"use server";

import { revalidatePath } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";
import { connectDB } from "@/lib/db";
import { Workspace, oid } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { PLANS, PLAN_INFO, type Plan } from "@/lib/plans";
import { audit } from "@/lib/audit";
import { applyRazorpaySubscription, billingProvider } from "@/lib/billing";
import { cancelSubscription, createSubscription, fetchSubscription, razorpayKeyId, razorpayPlanId, subscriptionNotes, verifyCheckoutSignature, type Interval } from "@/lib/billing/razorpay";

async function guard() {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "admin")) throw new Error("Only workspace owners and admins can change the plan.");
  return ctx;
}

/** What the browser needs to open Razorpay Checkout for a new subscription. */
export type RazorpayCheckout = { key: string; subscriptionId: string; name: string; description: string; prefill: { name: string; email: string } };
export type ChoosePlanResult = { error?: string; message?: string; razorpay?: RazorpayCheckout } | void;

/**
 * Upgrade or switch plan.
 * - Razorpay: creates a subscription and returns it for Checkout; Free cancels at period end.
 * - Demo (no Razorpay keys): switches the plan at once so every paid feature can be tried locally.
 */
export async function choosePlanAction(plan: Plan, interval: Interval): Promise<ChoosePlanResult> {
  const ctx = await guard();
  if (!PLANS.includes(plan) || !["month", "year"].includes(interval)) return { error: "Unknown plan." };
  await connectDB();
  const ws = await Workspace.findById(oid(ctx.workspace.id));
  if (!ws) return { error: "Workspace not found." };
  if (ws.plan === plan && (ws.billing?.interval ?? "month") === interval && plan !== "free") return { message: `You're already on ${PLAN_INFO[plan].name}.` };
  const provider = billingProvider();

  if (provider === "razorpay") {
    const b = ws.billing;
    const current = b?.provider === "razorpay" && b.subscriptionId && b.status !== "canceled" ? b.subscriptionId : null;
    const until = b?.currentPeriodEnd ? formatInTimeZone(b.currentPeriodEnd, ctx.workspace.timezone, "d MMM yyyy") : null;

    if (plan === "free") {
      if (!current) return switchNow(ws, plan, interval, ctx);
      if (b?.cancelAtPeriodEnd) return { message: until ? `Already cancelled. You move to Free on ${until}.` : "Already cancelled." };
      try {
        await cancelSubscription(current, true);
      } catch (e) {
        return { error: `Razorpay couldn't cancel the subscription: ${(e as Error).message}` };
      }
      ws.set("billing.cancelAtPeriodEnd", true);
      await ws.save();
      await audit({ action: "billing.cancelled", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "workspace", entityId: ctx.workspace.id, meta: { provider: "razorpay", subscriptionId: current } });
      revalidatePath("/billing");
      return { message: until ? `Subscription cancelled. You keep ${PLAN_INFO[ws.plan as Plan].name} until ${until}, then move to Free.` : "Subscription cancelled." };
    }

    if (current && b?.cancelAtPeriodEnd && ws.plan === plan) {
      return { error: until ? `This subscription ends on ${until}. You can subscribe again from that day.` : "This subscription is ending. Subscribe again once it has." };
    }
    const planId = razorpayPlanId(plan, interval);
    if (!planId) return { error: `No Razorpay plan is set for ${PLAN_INFO[plan].name} (${interval}ly). Add RAZORPAY_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}.` };
    try {
      // A plan change is a new subscription; the old one is cancelled once this one is paid.
      const sub = await createSubscription({ planId, interval, notes: { workspaceId: String(ws._id), plan, interval, ...(current ? { replaces: current } : {}) } });
      await audit({ action: "billing.checkout_started", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "workspace", entityId: ctx.workspace.id, meta: { plan, interval, provider: "razorpay", subscriptionId: sub.id } });
      return {
        razorpay: {
          key: razorpayKeyId(),
          subscriptionId: sub.id,
          name: `Relay ${PLAN_INFO[plan].name}`,
          description: `${ws.name} · billed ${interval}ly`,
          prefill: { name: ctx.user.name, email: ctx.user.email },
        },
      };
    } catch (e) {
      return { error: `Razorpay couldn't start the subscription: ${(e as Error).message}` };
    }
  }

  if (provider === "none") return { error: "Payments aren't set up on this server yet. Ask the administrator to add the Razorpay keys." };
  return switchNow(ws, plan, interval, ctx);
}

/** Demo switches, and moving to Free when there's no subscription to cancel. */
async function switchNow(ws: InstanceType<typeof Workspace>, plan: Plan, interval: Interval, ctx: Awaited<ReturnType<typeof guard>>) {
  const from = ws.plan;
  const demo = plan !== "free";
  ws.plan = plan;
  ws.set("billing", {
    provider: demo ? "demo" : (ws.billing?.provider ?? "demo"),
    customerId: ws.billing?.customerId,
    status: "active",
    interval,
    currentPeriodEnd: demo ? new Date(Date.now() + (interval === "year" ? 365 : 30) * 86400_000) : undefined,
    cancelAtPeriodEnd: false,
  });
  await ws.save();
  await audit({ action: "billing.plan_changed", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "workspace", entityId: ctx.workspace.id, meta: { from, to: plan, interval, provider: demo ? "demo" : "none" } });
  revalidatePath("/", "layout");
  return { message: plan === "free" ? "Moved to Free" : `You're on ${PLAN_INFO[plan].name}. Paid features are unlocked.` };
}

/**
 * Razorpay Checkout's success handler posts here. The signature proves the payment came
 * from Razorpay for this subscription; the plan comes from the subscription itself.
 */
export async function confirmRazorpayAction(resp: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }): Promise<{ error?: string; message?: string }> {
  const ctx = await guard();
  const { razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature } = resp ?? {};
  if (typeof paymentId !== "string" || typeof subscriptionId !== "string" || typeof signature !== "string" || !verifyCheckoutSignature(paymentId, subscriptionId, signature)) {
    return { error: "We couldn't verify that payment. If you were charged, your plan updates as soon as Razorpay confirms it." };
  }
  await connectDB();
  const sub = await fetchSubscription(subscriptionId);
  if (subscriptionNotes(sub).workspaceId !== ctx.workspace.id) return { error: "That subscription belongs to another workspace." };
  const ws = await applyRazorpaySubscription(sub);
  await audit({ action: "billing.payment_confirmed", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "workspace", entityId: ctx.workspace.id, meta: { provider: "razorpay", subscriptionId, paymentId, status: sub.status } });
  revalidatePath("/", "layout");
  if (!ws || !["authenticated", "active"].includes(sub.status)) return { message: "Payment received. Your plan updates as soon as Razorpay confirms it." };
  return { message: `You're on ${PLAN_INFO[ws.plan as Plan].name}. Paid features are unlocked.` };
}
