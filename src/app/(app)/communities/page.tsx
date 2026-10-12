import type { Metadata } from "next";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowUpRightIcon, FlaskConicalIcon, HandIcon, PenLineIcon, PencilIcon, UsersIcon, VoteIcon } from "lucide-react";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { AppSettings } from "@/lib/models";
import { getCommunityOverview } from "@/lib/queries/communities";
import { COMMUNITY_PLATFORMS, PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { planFeatures } from "@/lib/plans";
import { demoMode } from "@/lib/publishing/n8n";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { TimeAgo } from "@/components/time-ago";
import { DailyPlatformBars } from "@/components/charts/daily-bars";
import { CommunityConnectGrid } from "@/components/community/connect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuickMessage } from "./quick-message";

export const metadata: Metadata = { title: "Communities" };

export default async function CommunitiesPage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
  const ctx = await getWorkspaceContext();
  const { connect } = await searchParams;
  const tz = ctx.workspace.timezone;
  const [o, settings] = await Promise.all([getCommunityOverview(ctx.workspace.id, tz), AppSettings.findOne({ key: "global" }).lean()]);
  const disabled = new Set(settings?.disabledPlatforms ?? []);
  const reach = o.groups.reduce((n, g) => n + (g.audienceSize ?? 0), 0);
  const active = o.groups.filter((g) => g.status === "active");
  const platformsInChart = [...new Set(o.daily.flatMap((d) => Object.keys(d.byPlatform)))];
  const features = planFeatures(ctx.workspace.plan);

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Communities"
        title="Talk to your people"
        description="Groups, channels and servers in one place. Send a message or a poll to all of them at once, schedule announcements, and fix a typo after it's sent."
        actions={
          <Button variant="signal" asChild>
            <Link href="/compose">
              <PenLineIcon /> Full composer
            </Link>
          </Button>
        }
      />

      <section className="grid grid-cols-2 border-y md:grid-cols-4 md:divide-x">
        <Stat label="Reach" value={reach.toLocaleString()} foot={`members across ${o.groups.length} ${o.groups.length === 1 ? "community" : "communities"}`} />
        <Stat label="Sent" value={o.totals.sent30} foot="messages in 30 days" />
        <Stat label="Scheduled" value={o.totals.scheduled} foot="waiting to go out" />
        <Stat label="Attention" value={o.totals.attention} foot="failed or waiting on you" accent={o.totals.attention > 0} />
      </section>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="min-w-0">
          <SectionTitle n="01" aside={<span className="font-mono text-[11px] text-muted-foreground">to {active.length} active</span>}>
            Quick message
          </SectionTitle>
          {active.length === 0 ? (
            <div className="grain rounded-xl border border-dashed p-10 text-center">
              <p className="font-serif text-2xl">No communities yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">Connect a Telegram channel, WhatsApp group, Discord server or another community below.</p>
            </div>
          ) : (
            <QuickMessage
              groups={active.map((g) => ({ id: g.id, platform: g.platform, handle: g.handle, audienceSize: g.audienceSize, sandbox: g.sandbox, assisted: g.assisted }))}
              timezone={tz}
              canPost={can(ctx.role, "editor")}
              pollsUnlocked={features.polls}
              needsApproval={ctx.workspace.requireApproval && !can(ctx.role, "approver")}
            />
          )}
        </section>

        <section>
          <SectionTitle n="02">Last 14 days</SectionTitle>
          <div className="rounded-xl border bg-card p-4">
            {platformsInChart.length ? <DailyPlatformBars data={o.daily} platforms={platformsInChart} /> : <p className="py-16 text-center text-sm text-muted-foreground">Nothing sent yet.</p>}
          </div>
        </section>
      </div>

      <section>
        <SectionTitle n="03" aside={<span className="font-mono text-[11px] text-muted-foreground">{o.groups.length} connected</span>}>
          Your communities
        </SectionTitle>
        {o.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connected communities show up here with their member counts and last message.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {o.groups.map((g) => {
              const spec = PLATFORMS[g.platform as TargetPlatform];
              return (
                <article key={g.id} className="flex flex-col rounded-xl border bg-card">
                  <div className="flex items-center gap-3 border-b px-4 py-3" style={{ backgroundColor: `color-mix(in oklab, ${spec.color} 8%, transparent)` }}>
                    <PlatformIcon platform={g.platform} tone="chip" className="size-9 rounded-full p-2" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        {g.handle}
                        {g.sandbox && <FlaskConicalIcon className="size-3.5 text-muted-foreground" />}
                      </p>
                      <p className="font-mono text-[10.5px] text-muted-foreground uppercase">
                        {spec.name} · {g.assisted ? "assisted" : (g.accountType ?? spec.noun)}
                      </p>
                    </div>
                    {g.status !== "active" && <StatusBadge status={g.status} />}
                  </div>
                  <dl className="grid grid-cols-3 divide-x border-b text-center">
                    <Metric label="Members" value={g.audienceSize != null ? compact(g.audienceSize) : "—"} />
                    <Metric label="Sent 30d" value={g.sent30} />
                    <Metric label="Queued" value={g.scheduled} />
                  </dl>
                  <div className="flex-1 px-4 py-3">
                    {g.lastText ? (
                      <>
                        <p className="line-clamp-3 text-[13px] leading-snug whitespace-pre-wrap">{g.lastText}</p>
                        <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">{g.lastAt && <TimeAgo prefix="Last message " date={g.lastAt} />}</p>
                      </>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">Nothing sent here yet.</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 border-t px-4 py-2.5 text-sm">
                    {g.attention > 0 && <span className="font-mono text-[11px] text-signal">{g.attention} need a look</span>}
                    {g.assisted && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <HandIcon className="size-3" /> You send these
                      </span>
                    )}
                    {g.profileUrl && (
                      <a href={g.profileUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs underline decoration-signal decoration-2 underline-offset-4">
                        Open <ArrowUpRightIcon className="size-3" />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle n="04">Message log</SectionTitle>
        {o.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Messages you send or schedule appear here.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {o.recent.map((r) => {
              const spec = PLATFORMS[r.platform as TargetPlatform];
              return (
                <div key={r.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 border-b px-4 py-3 last:border-0 md:grid-cols-[auto_180px_1fr_120px_auto]">
                  <PlatformIcon platform={r.platform} tone="chip" className="mt-0.5 size-7 p-1.5" />
                  <div className="hidden min-w-0 md:block">
                    <p className="truncate text-sm font-medium">{r.handle}</p>
                    <p className="font-mono text-[10.5px] text-muted-foreground uppercase">{spec?.postTypes.find((t) => t.id === r.postType)?.label}</p>
                  </div>
                  <Link href={`/posts/${r.postId}`} className="min-w-0 group">
                    <p className="line-clamp-2 text-[13px] leading-snug group-hover:underline">
                      {r.postType === "poll" && <VoteIcon className="mr-1 inline size-3.5 text-muted-foreground" />}
                      {r.postType === "poll" ? r.pollQuestion : r.text || <span className="text-muted-foreground">No text</span>}
                    </p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground md:hidden">{r.handle}</p>
                    {r.error && r.status !== "published" && <p className="mt-1 line-clamp-1 text-xs text-signal">{r.error}</p>}
                  </Link>
                  <div className="hidden font-mono text-[11px] text-muted-foreground md:block">{r.at ? formatInTimeZone(r.at, tz, "d MMM, HH:mm") : "—"}</div>
                  <div className="flex items-center gap-2">
                    {r.edits > 0 && (
                      <Badge variant="outline" className="gap-1">
                        <PencilIcon /> edited
                      </Badge>
                    )}
                    <StatusBadge status={r.status} />
                    {r.permalink && (
                      <a href={r.permalink} target="_blank" rel="noreferrer" aria-label="Open message" className="text-muted-foreground hover:text-foreground">
                        <ArrowUpRightIcon className="size-4" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="add" className="scroll-mt-20">
        <SectionTitle
          n="05"
          aside={
            <Link href="/guide#communities" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <UsersIcon className="size-3.5" /> Step-by-step setup →
            </Link>
          }
        >
          Add a community
        </SectionTitle>
        <CommunityConnectGrid
          tiles={COMMUNITY_PLATFORMS.filter((p) => !disabled.has(p.id)).map((p) => ({ id: p.id, connected: o.groups.filter((g) => g.platform === p.id).length }))}
          demo={demoMode()}
          canManage={can(ctx.role, "admin")}
          initial={COMMUNITY_PLATFORMS.find((p) => p.id === connect)?.id}
        />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Facebook Groups, Instagram broadcast channels and WhatsApp Channels have no posting API. Add them as a manual or assisted channel and Relay reminds you with the text ready to paste. Reddit is under Social feeds on the Channels page.
        </p>
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

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-2 py-2.5">
      <dt className="font-mono text-[9.5px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 font-serif text-2xl tabular-nums">{value}</dd>
    </div>
  );
}

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}
