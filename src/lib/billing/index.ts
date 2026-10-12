import "server-only";
import { Workspace, isOid, oid } from "@/lib/models";
import { demoMode } from "@/lib/publishing/n8n";
import { audit } from "@/lib/audit";
import { PLANS, listPrices, type PriceTable } from "@/lib/plans";
import { cancelSubscription, fetchSubscription, planFromRazorpayPlan, razorpayConfigured, razorpayPrices, subscriptionNotes, type RazorpaySubscription } from "./razorpay";

export type BillingProvider = "razorpay" | "demo" | "none";

/** Razorpay takes payment once its keys are set; until then demo mode switches plans for free. */
export function billingProvider(): BillingProvider {
  if (razorpayConfigured()) return "razorpay";
  return demoMode() ? "demo" : "none";
}

const LIVE = new Set(["authenticated", "active"]);
const ENDED = new Set(["cancelled", "completed", "expired"]);

/**
 * Writes a Razorpay subscription's state onto its workspace. Always called with a freshly
 * fetched subscription, so late or repeated webhooks can't roll the state back.
 *
 * Switching plans creates a new subscription; once it's live, the old one is cancelled
 * here. Events for subscriptions that aren't the workspace's current one (the replaced
 * one, or a checkout that was abandoned) only ever matter if they just went live.
 */
export async function applyRazorpaySubscription(sub: RazorpaySubscription) {
  const notes = subscriptionNotes(sub);
  if (!notes.workspaceId || !isOid(notes.workspaceId)) return null;
  const ws = await Workspace.findById(oid(notes.workspaceId));
  if (!ws) return null;
  const mapped = planFromRazorpayPlan(sub.plan_id);
  if (!mapped) return null;

  const current = ws.billing?.provider === "razorpay" ? ws.billing.subscriptionId : undefined;
  const isCurrent = current === sub.id;
  const from = ws.plan;
  const periodEnd = sub.current_end ? new Date(sub.current_end * 1000) : sub.charge_at ? new Date(sub.charge_at * 1000) : undefined;

  if (LIVE.has(sub.status)) {
    if (current && !isCurrent) {
      await cancelSubscription(current, false).catch(() => undefined);
    }
    ws.plan = mapped.plan;
    ws.set("billing", {
      provider: "razorpay",
      customerId: sub.customer_id ?? ws.billing?.customerId,
      subscriptionId: sub.id,
      status: "active",
      interval: mapped.interval,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: isCurrent ? Boolean(ws.billing?.cancelAtPeriodEnd) : false,
    });
  } else if (!isCurrent) {
    return ws;
  } else if (sub.status === "pending") {
    // A renewal charge failed; Razorpay retries, and the plan stays until it gives up.
    ws.set("billing.status", "past_due");
  } else if (sub.status === "halted" || sub.status === "paused") {
    // Retries ran out (or the customer paused): back to Free until a charge succeeds again.
    ws.plan = "free";
    ws.set("billing.status", "past_due");
  } else if (ENDED.has(sub.status)) {
    ws.plan = "free";
    ws.set("billing", { provider: "razorpay", customerId: ws.billing?.customerId, status: "canceled", cancelAtPeriodEnd: false });
  } else {
    return ws;
  }
  await ws.save();
  if (from !== ws.plan) {
    await audit({ action: "billing.plan_changed", workspaceId: String(ws._id), entity: "workspace", entityId: String(ws._id), meta: { from, to: ws.plan, provider: "razorpay", status: sub.status } });
  }
  return ws;
}

/**
 * Catches up a Razorpay subscription whose period has passed, in case a webhook never
 * arrived (or none is configured). Cheap: one API call, only when the period is over.
 */
export async function syncRazorpayIfStale(workspaceId: string) {
  if (!razorpayConfigured()) return;
  const ws = await Workspace.findById(oid(workspaceId)).lean();
  const b = ws?.billing;
  if (b?.provider !== "razorpay" || !b.subscriptionId) return;
  if (b.status === "active" && b.currentPeriodEnd && b.currentPeriodEnd.getTime() > Date.now()) return;
  try {
    await applyRazorpaySubscription(await fetchSubscription(b.subscriptionId));
  } catch {
    // Razorpay unreachable; try again on the next visit.
  }
}

/** Prices to show: Razorpay's live plan amounts, with the INR list prices as a fallback. */
export async function displayPrices(provider: BillingProvider): Promise<PriceTable> {
  const table = listPrices();
  if (provider !== "razorpay") return table;
  const live = await razorpayPrices();
  for (const p of PLANS) {
    for (const i of ["month", "year"] as const) {
      const v = live[p]?.[i];
      if (v) table[p][i] = v;
    }
  }
  return table;
}
