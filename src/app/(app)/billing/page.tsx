import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { Workspace, oid } from "@/lib/models";
import { getPlanUsage } from "@/lib/queries/shell";
import { FEATURE_LABELS, PLAN_INFO, planFeatures, type Feature, type Plan } from "@/lib/plans";
import { billingProvider, displayPrices, syncRazorpayIfStale } from "@/lib/billing";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PlanPicker } from "./plan-picker";

export const metadata: Metadata = { title: "Plan & billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ feature?: string }> }) {
  const ctx = await getWorkspaceContext();
  const sp = await searchParams;
  const provider = billingProvider();
  if (provider === "razorpay") await syncRazorpayIfStale(ctx.workspace.id);
  const ws = await Workspace.findById(oid(ctx.workspace.id)).lean();
  const plan = (ws?.plan ?? ctx.workspace.plan) as Plan;
  const usage = await getPlanUsage(ctx.workspace.id, plan);
  const billing = ws?.billing;
  const features = planFeatures(plan);
  const highlight = sp.feature && sp.feature in FEATURE_LABELS ? (sp.feature as Feature) : undefined;
  const prices = await displayPrices(provider);
  const endsAt = billing?.cancelAtPeriodEnd && billing.currentPeriodEnd && plan !== "free" ? formatInTimeZone(billing.currentPeriodEnd, ctx.workspace.timezone, "d MMM") : undefined;

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Plan & billing"
        title={
          <>
            You&apos;re on <span className="text-signal">{PLAN_INFO[plan]?.name ?? plan}</span>
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {PLAN_INFO[plan]?.pitch}
            {billing?.status && billing.status !== "active" && <Badge variant="outline">{billing.status.replace("_", " ")}</Badge>}
            {billing?.currentPeriodEnd && plan !== "free" && (
              <span className="font-mono text-xs">
                {billing.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatInTimeZone(billing.currentPeriodEnd, ctx.workspace.timezone, "d MMM yyyy")}
                {billing.interval ? ` · billed ${billing.interval}ly` : ""}
              </span>
            )}
            {billing?.provider === "manual" && <span className="font-mono text-xs">set by a Relay administrator</span>}
            {billing?.provider === "razorpay" && billing.subscriptionId && <span className="font-mono text-xs">paid with Razorpay</span>}
          </span>
        }
      />

      <section>
        <SectionTitle n="01">This month</SectionTitle>
        <div className="grid gap-4 md:grid-cols-3">
          {usage.usage.map((u) => {
            const pct = Math.min(100, Math.round((u.used / Math.max(u.limit, 1)) * 100));
            return (
              <div key={u.label} className="rounded-md border bg-card p-4">
                <p className="eyebrow">{u.label}</p>
                <p className="mt-2 font-serif text-4xl tabular-nums">
                  {u.used.toLocaleString()} <span className="text-lg text-muted-foreground">/ {u.limit.toLocaleString()}</span>
                </p>
                <Progress value={pct} className="mt-3 h-1.5" />
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle n="02">Plans</SectionTitle>
        <PlanPicker
          current={plan}
          currentInterval={(billing?.interval as "month" | "year" | undefined) ?? "month"}
          canManage={can(ctx.role, "admin")}
          provider={provider}
          prices={prices}
          hasSubscription={Boolean(billing?.provider === provider && billing.subscriptionId && billing.status !== "canceled")}
          endsAt={endsAt}
          highlight={highlight}
        />
      </section>

      <section>
        <SectionTitle n="03">What your plan unlocks</SectionTitle>
        <ul className="grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-2">
          {(Object.keys(FEATURE_LABELS) as Feature[]).map((f) => (
            <li key={f} className={`flex gap-3 bg-card p-4 ${highlight === f ? "ring-2 ring-signal ring-inset" : ""}`}>
              <span className={`mt-1 size-2 shrink-0 rounded-full ${features[f] ? "bg-ok" : "bg-muted-foreground/30"}`} />
              <div>
                <p className="text-sm font-medium">
                  {FEATURE_LABELS[f].title} <span className="font-mono text-[10.5px] text-muted-foreground uppercase">{features[f] ? "included" : "locked"}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{FEATURE_LABELS[f].body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
