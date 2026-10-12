import Link from "next/link";
import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowRightIcon, ArrowUpRightIcon, BookOpenIcon, CableIcon, PenLineIcon, TriangleAlertIcon } from "lucide-react";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getWorkspaceOverview } from "@/lib/queries/workspace";
import { getSetupProgress } from "@/lib/queries/guide";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { PlatformIcon, PlatformStack } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { DailyPlatformBars } from "@/components/charts/daily-bars";
import { PublishHeatmap } from "@/components/charts/heatmap";
import { Button } from "@/components/ui/button";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { formatBytes } from "@/lib/utils";
import { msFromNow } from "@/lib/time";

export const metadata: Metadata = { title: "Overview" };

export default async function Dashboard() {
  const ctx = await getWorkspaceContext();
  const tz = ctx.workspace.timezone;
  const [o, setup] = await Promise.all([getWorkspaceOverview(ctx.workspace.id, tz), getSetupProgress(ctx.workspace.id, ctx.workspace.plan)]);
  // New workspaces get a pointer to the guide until the basics are in place.
  const nextStep = setup.steps.find((s) => !s.done && (s.key === "social" || s.key === "community" || s.key === "post"));

  const published = o.status.published ?? 0;
  const failed = (o.status.failed ?? 0) + (o.status.needs_action ?? 0);
  const inQueue = (o.status.scheduled ?? 0) + (o.status.retrying ?? 0) + (o.status.queued ?? 0) + (o.status.processing ?? 0) + (o.status.uploading ?? 0);
  const rate = published + failed > 0 ? Math.round((published / (published + failed)) * 100) : null;
  const next24 = o.upcoming.filter((p) => msFromNow(p.scheduledAt) < 86400000).length;
  const platformsInChart = [...new Set(o.daily.flatMap((d) => Object.keys(d.byPlatform)))];

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={`Overview · ${formatInTimeZone(new Date(), tz, "EEEE d MMMM")} · ${tz}`}
        title={ctx.workspace.name}
        description={
          <>
            {next24 === 0 ? "Nothing is going out in the next 24 hours." : `${next24} post${next24 === 1 ? "" : "s"} going out in the next 24 hours.`}{" "}
            {failed > 0 && <span className="text-signal">{failed} {failed === 1 ? "delivery needs" : "deliveries need"} a look.</span>}
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/accounts">
                <CableIcon /> Channels
              </Link>
            </Button>
            <Button variant="signal" asChild>
              <Link href="/compose">
                <PenLineIcon /> Compose
              </Link>
            </Button>
          </>
        }
      />

      {nextStep && (
        <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-dashed px-5 py-4">
          <BookOpenIcon className="size-5 text-signal" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Getting started · {setup.done} of {setup.steps.length} done
            </p>
            <p className="text-[13px] text-muted-foreground">
              Next: {nextStep.title.toLowerCase()}. The guide walks through every platform, community and plan.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={nextStep.href}>{nextStep.cta}</Link>
          </Button>
          <Button variant="signal" size="sm" asChild>
            <Link href="/guide">
              Open the guide <ArrowRightIcon />
            </Link>
          </Button>
        </section>
      )}

      {/* Ledger strip */}
      <section className="grid grid-cols-2 border-y md:grid-cols-4 md:divide-x">
        <Stat label="Delivered" value={published} foot="all time" />
        <Stat label="Success rate" value={rate === null ? "—" : `${rate}%`} foot={`${failed} failed or blocked`} accent={rate !== null && rate < 90} />
        <Stat label="In the queue" value={inQueue} foot={`${o.postsLast30} posts made in 30 days`} />
        <Stat
          label="Channels live"
          value={o.accounts.active}
          foot={o.accounts.needsReauth ? `${o.accounts.needsReauth} need reconnecting` : `${o.media.count} files · ${formatBytes(o.media.bytes)}`}
          accent={o.accounts.needsReauth > 0}
        />
      </section>

      <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr]">
        <section>
          <SectionTitle n="01" aside={<Link href="/calendar" className="text-xs text-muted-foreground hover:text-foreground">Calendar →</Link>}>
            Up next
          </SectionTitle>
          {o.upcoming.length === 0 ? (
            <Empty text="No scheduled posts." cta={{ href: "/compose", label: "Schedule one" }} />
          ) : (
            <ol className="divide-y border-y">
              {o.upcoming.map((p) => (
                <li key={String(p._id)}>
                  <Link href={`/posts/${String(p._id)}`} className="group grid grid-cols-[84px_1fr_auto] items-center gap-4 py-3.5 hover:bg-accent/30">
                    <div className="pl-1">
                      <p className="font-mono text-[22px] leading-none tabular-nums">{formatInTimeZone(p.scheduledAt, tz, "HH:mm")}</p>
                      <p className="mt-1 font-mono text-[10.5px] uppercase text-muted-foreground">{formatInTimeZone(p.scheduledAt, tz, "EEE d MMM")}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14px]">{p.title || p.baseCaption || <span className="text-muted-foreground italic">No caption</span>}</p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <PlatformStack platforms={p.platforms} />
                        {p.status === "pending_approval" && <StatusBadge status="pending_approval" />}
                      </div>
                    </div>
                    <ArrowUpRightIcon className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <SectionTitle n="02">Needs attention</SectionTitle>
          {o.attention.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Every delivery went through. Nothing to fix.</div>
          ) : (
            <ul className="space-y-2">
              {o.attention.map((a) => (
                <li key={String(a._id)}>
                  <Link href={`/posts/${String(a.postId)}`} className="flex gap-3 rounded-xl border bg-card p-3 hover:border-foreground/30">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-signal" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={a.platform} />
                        <span className="truncate text-[13px] font-medium">{a.handle}</span>
                        <span className="ml-auto">
                          <StatusBadge status={a.status} />
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.lastErrorMessage ?? a.lastErrorCode}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr]">
        <section>
          <SectionTitle n="03" aside={<span className="font-mono text-[11px] text-muted-foreground">14 days</span>}>
            Deliveries by channel
          </SectionTitle>
          <div className="rounded-xl border bg-card p-4">
            {platformsInChart.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Published posts will show up here.</p>
            ) : (
              <DailyPlatformBars data={o.daily} platforms={platformsInChart} />
            )}
          </div>
        </section>
        <section>
          <SectionTitle n="04">Channel reliability</SectionTitle>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="eyebrow py-2 text-left font-medium">Channel</th>
                <th className="eyebrow py-2 text-right font-medium">Sent</th>
                <th className="eyebrow py-2 text-right font-medium">Failed</th>
                <th className="eyebrow w-[38%] py-2 pl-4 text-left font-medium">Success</th>
              </tr>
            </thead>
            <tbody>
              {o.platforms.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">No deliveries yet.</td>
                </tr>
              )}
              {o.platforms.map((p) => (
                <tr key={p._id} className="border-b last:border-0">
                  <td className="py-2.5">
                    <span className="flex items-center gap-2">
                      <PlatformIcon platform={p._id} /> {PLATFORMS[p._id as TargetPlatform]?.name ?? p._id}
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums">{p.published}</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-muted-foreground">{p.failed}</td>
                  <td className="py-2.5 pl-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.round((p.successRate ?? 0) * 100)}%` }} />
                      </div>
                      <span className="w-9 text-right font-mono text-[11px] tabular-nums">{p.successRate === null ? "—" : `${Math.round(p.successRate * 100)}%`}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <SectionTitle n="05" aside={<span className="font-mono text-[11px] text-muted-foreground">{tz}</span>}>
          When your posts go out
        </SectionTitle>
        <div className="rounded-xl border bg-card p-4">
          <PublishHeatmap cells={o.heatmap} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, foot, accent }: { label: string; value: React.ReactNode; foot: string; accent?: boolean }) {
  return (
    <div className="border-b px-1 py-5 md:border-b-0 md:px-6 md:first:pl-1">
      <p className="eyebrow">{label}</p>
      <p className={`mt-2 font-serif text-[46px] leading-none tabular-nums ${accent ? "text-signal" : ""}`}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{foot}</p>
    </div>
  );
}

function Empty({ text, cta }: { text: string; cta: { href: string; label: string } }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
      {text}
      <Link href={cta.href} className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4">
        {cta.label}
      </Link>
    </div>
  );
}
