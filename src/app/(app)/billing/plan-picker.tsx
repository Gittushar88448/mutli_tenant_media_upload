"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, FlaskConicalIcon, Loader2Icon, MinusIcon, ShieldCheckIcon } from "lucide-react";
import { choosePlanAction, confirmRazorpayAction, type RazorpayCheckout } from "@/lib/actions/billing";
import { FEATURE_LABELS, PLANS, PLAN_INFO, PLAN_LIMITS, formatPrice, planFeatures, type Feature, type Plan, type PriceTable } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type RazorpayResponse = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: "payment.failed", cb: (e: { error: { description?: string } }) => void): void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

/** Loads Razorpay's Checkout script once, on first use. */
function loadRazorpay() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const el = document.createElement("script");
    el.src = "https://checkout.razorpay.com/v1/checkout.js";
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Couldn't load Razorpay Checkout. Check your connection and try again."));
    document.body.appendChild(el);
  });
}

export function PlanPicker({
  current,
  currentInterval,
  canManage,
  provider,
  prices,
  hasSubscription,
  endsAt,
  highlight,
}: {
  current: Plan;
  currentInterval: "month" | "year";
  canManage: boolean;
  provider: "razorpay" | "demo" | "none";
  prices: PriceTable;
  hasSubscription: boolean;
  /** Set when the paid plan is cancelled and runs out on this date. */
  endsAt?: string;
  highlight?: Feature;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<"month" | "year">(currentInterval);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Plan | null>(null);
  const rank = (p: Plan) => PLANS.indexOf(p);
  const c = prices.creator;
  const yearlySaving = c.month.amount ? Math.round((1 - c.year.amount / (c.month.amount * 12)) * 100) : 0;

  function choose(plan: Plan) {
    setBusy(plan);
    start(async () => {
      const r = await choosePlanAction(plan, interval);
      if (r?.razorpay) {
        try {
          await openRazorpay(r.razorpay);
        } catch (e) {
          toast.error((e as Error).message);
        }
      } else if (r?.error) toast.error(r.error);
      else if (r?.message) toast.success(r.message);
      setBusy(null);
      router.refresh();
    });
  }

  async function openRazorpay(o: RazorpayCheckout) {
    await loadRazorpay();
    await new Promise<void>((resolve) => {
      const rz = new window.Razorpay!({
        key: o.key,
        subscription_id: o.subscriptionId,
        name: o.name,
        description: o.description,
        prefill: o.prefill,
        theme: { color: "#B5173F" },
        handler: async (resp: RazorpayResponse) => {
          const r = await confirmRazorpayAction(resp);
          if (r.error) toast.error(r.error);
          else toast.success(r.message);
          resolve();
        },
        modal: {
          ondismiss: () => {
            toast("Checkout closed. Nothing was charged.");
            resolve();
          },
        },
      });
      rz.on("payment.failed", (e) => toast.error(e.error.description ?? "The payment didn't go through."));
      rz.open();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={interval} onValueChange={(v) => v && setInterval(v as "month" | "year")}>
          <ToggleGroupItem value="month">Monthly</ToggleGroupItem>
          <ToggleGroupItem value="year">
            Yearly {yearlySaving > 0 && <span className="font-mono text-[10px] text-signal">−{yearlySaving}%</span>}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center gap-3">
          {provider === "razorpay" && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <ShieldCheckIcon className="size-3.5" /> Secure payment by Razorpay: UPI, cards, netbanking
            </span>
          )}
          {provider === "demo" && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <FlaskConicalIcon className="size-3.5" /> Demo mode: plans switch instantly, no card needed
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const info = PLAN_INFO[p];
          const limits = PLAN_LIMITS[p];
          const f = planFeatures(p);
          const isCurrent = p === current;
          const pr = prices[p];
          const perMonth = { amount: interval === "month" ? pr.month.amount : Math.round(pr.year.amount / 12), currency: pr.month.currency };
          const unlocksHighlight = highlight && f[highlight] && !planFeatures(current)[highlight];
          return (
            <div key={p} className={cn("relative flex flex-col bg-card p-5", isCurrent && "bg-accent/40", unlocksHighlight && "ring-2 ring-signal ring-inset")}>
              {p === "studio" && <span className="absolute top-4 right-4 rounded-[6px] bg-signal px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-wider text-signal-foreground uppercase">Popular</span>}
              <p className="eyebrow">{info.name}</p>
              <p className="mt-3 font-serif text-5xl leading-none tabular-nums">
                {formatPrice(perMonth)}
                <span className="ml-1 font-sans text-sm text-muted-foreground">/ mo</span>
              </p>
              <p className="mt-1 h-4 font-mono text-[10.5px] text-muted-foreground">{interval === "year" && pr.year.amount ? `${formatPrice(pr.year)} billed yearly` : ""}</p>
              <p className="mt-3 min-h-10 text-[13px] text-muted-foreground">{info.pitch}</p>
              <ul className="mt-4 space-y-1.5 border-t pt-4 text-[13px]">
                <li>{limits.accounts} channels</li>
                <li>{limits.postsPerMonth.toLocaleString()} posts a month</li>
                <li>{limits.storageMb >= 1000 ? `${limits.storageMb / 1000} GB` : `${limits.storageMb} MB`} media</li>
                <li>
                  {limits.seats} {limits.seats === 1 ? "seat" : "seats"}
                </li>
                <li>{limits.discoverPerDay.toLocaleString()} Discover searches a day</li>
              </ul>
              <ul className="mt-4 flex-1 space-y-1.5 border-t pt-4 text-[13px]">
                {(Object.keys(FEATURE_LABELS) as Feature[]).map((k) => (
                  <li key={k} className={cn("flex items-start gap-2", !f[k] && "text-muted-foreground/60", highlight === k && f[k] && "font-medium")}>
                    {f[k] ? <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <MinusIcon className="mt-0.5 size-3.5 shrink-0" />}
                    {FEATURE_LABELS[k].title}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-5 w-full"
                variant={isCurrent ? "outline" : rank(p) > rank(current) ? "signal" : "outline"}
                disabled={!canManage || pending || (isCurrent && (p === "free" || interval === currentInterval)) || provider === "none" || (p === "free" && !!endsAt)}
                onClick={() => choose(p)}
              >
                {busy === p && <Loader2Icon className="animate-spin" />}
                {isCurrent && (p === "free" || interval === currentInterval)
                  ? endsAt
                    ? `Ends ${endsAt}`
                    : "Current plan"
                  : isCurrent
                    ? `Switch to ${interval}ly`
                    : rank(p) > rank(current)
                      ? `Upgrade to ${info.name}`
                      : p === "free" && provider === "razorpay" && hasSubscription
                        ? endsAt
                          ? `Free from ${endsAt}`
                          : "Cancel subscription"
                        : `Move to ${info.name}`}
              </Button>
            </div>
          );
        })}
      </div>
      {!canManage && <p className="text-xs text-muted-foreground">Only workspace owners and admins can change the plan.</p>}
      {provider === "razorpay" && hasSubscription && !endsAt && canManage && (
        <p className="text-xs text-muted-foreground">Switching plans starts a new subscription and ends the current one once it&apos;s paid. Cancelling keeps your plan until the end of the period you paid for.</p>
      )}
      {provider === "none" && <p className="text-xs text-muted-foreground">Payments aren&apos;t set up on this server yet. The administrator adds the Razorpay keys to turn on upgrades.</p>}
    </div>
  );
}
