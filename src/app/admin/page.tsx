import type { Metadata } from "next";
import Link from "next/link";
import { getAdminOverview } from "@/lib/queries/admin";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { formatBytes } from "@/lib/utils";
import { demoMode, n8nConfigured } from "@/lib/publishing/n8n";
import { PublishVolumeChart, SignupSpark } from "./charts";
import { RunDispatcherButton } from "./run-dispatcher";

export const metadata: Metadata = { title: "Control room" };

export default async function AdminHome() {
  const o = await getAdminOverview();
  const delivered = o.platforms.reduce((a, p) => a + p.published, 0);
  const failed = o.platforms.reduce((a, p) => a + p.failed, 0);
  const rate = delivered + failed ? Math.round((delivered / (delivered + failed)) * 100) : null;
  const storage = o.storage.reduce((a, s) => a + s.bytes, 0);
  const planTotal = o.plans.reduce((a, p) => a + p.n, 0);
  const signups30 = o.users.signups.reduce((a, s) => a + s.n, 0);
  const needsReauth = o.accounts.filter((a) => a._id.status === "needs_reauth").reduce((a, b) => a + b.n, 0);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Admin · Control room"
        title="Every workspace, one view"
        description="Live numbers from MongoDB aggregation pipelines across all tenants."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={n8nConfigured() ? "ok" : "warn"}>n8n {n8nConfigured() ? "connected" : "not configured"}</Badge>
            {demoMode() && <RunDispatcherButton />}
          </div>
        }
      />

      <section className="grid grid-cols-2 border-y md:grid-cols-3 md:divide-x xl:grid-cols-6">
        <Stat label="Users" value={o.users.total} foot={`${o.users.activeWeek} active this week`} href="/admin/users" />
        <Stat label="Suspended" value={o.users.byStatus.suspended ?? 0} foot={`${o.users.admins} admins`} href="/admin/users?status=suspended" />
        <Stat label="Workspaces" value={planTotal} foot={o.plans.map((p) => `${p.n} ${p._id}`).join(" · ")} href="/admin/workspaces" />
        <Stat label="Delivered" value={delivered} foot={rate === null ? "no deliveries yet" : `${rate}% success`} href="/admin/publishing?status=published" />
        <Stat label="Queue" value={o.due + o.inFlight} foot={`${o.due} due · ${o.inFlight} in flight`} accent={o.due > 50} href="/admin/publishing?status=scheduled,retrying,queued" />
        <Stat label="Storage" value={formatBytes(storage)} foot={`${needsReauth} channels need reconnecting`} accent={needsReauth > 0} href="/admin/accounts?status=needs_reauth" />
      </section>

      <div className="grid gap-10 xl:grid-cols-[1.5fr_1fr]">
        <section>
          <SectionTitle n="01" aside={<span className="font-mono text-[11px] text-muted-foreground">30 days · UTC</span>}>
            Delivery volume
          </SectionTitle>
          <div className="rounded-md border bg-card p-4">
            <PublishVolumeChart data={o.daily} />
          </div>
        </section>
        <section>
          <SectionTitle n="02" aside={<span className="font-mono text-[11px] text-muted-foreground">{signups30} in 30 days</span>}>
            Sign-ups
          </SectionTitle>
          <div className="rounded-md border bg-card p-4">
            <SignupSpark data={o.users.signups} />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-md border bg-border">
            {["free", "creator", "studio", "agency"].map((plan) => {
              const n = o.plans.find((p) => p._id === plan)?.n ?? 0;
              return (
                <Link key={plan} href={`/admin/workspaces?plan=${plan}`} className="bg-card p-3 hover:bg-accent/40">
                  <p className="eyebrow">{plan}</p>
                  <p className="mt-1 font-serif text-3xl tabular-nums">{n}</p>
                  <div className="mt-2 h-1 rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${planTotal ? (n / planTotal) * 100 : 0}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid gap-10 xl:grid-cols-3">
        <section className="xl:col-span-1">
          <SectionTitle n="03">By platform</SectionTitle>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="eyebrow py-2 text-left font-medium">Platform</th>
                <th className="eyebrow py-2 text-right font-medium">Sent</th>
                <th className="eyebrow py-2 text-right font-medium">Failed</th>
                <th className="eyebrow py-2 text-right font-medium">Queued</th>
              </tr>
            </thead>
            <tbody>
              {o.platforms.map((p) => (
                <tr key={p._id} className="border-b last:border-0">
                  <td className="py-2.5">
                    <Link href={`/admin/publishing?platform=${p._id}`} className="flex items-center gap-2 hover:underline">
                      <PlatformIcon platform={p._id} /> {PLATFORMS[p._id as TargetPlatform]?.name ?? p._id}
                    </Link>
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums">{p.published}</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-signal">{p.failed || ""}</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-muted-foreground">{p.queued}</td>
                </tr>
              ))}
              {o.platforms.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">No deliveries yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section>
          <SectionTitle n="04">Top error codes</SectionTitle>
          <ul className="divide-y rounded-md border bg-card">
            {o.errors.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No errors recorded.</li>}
            {o.errors.map((e) => (
              <li key={e._id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="font-mono text-xs">{e._id}</span>
                <span className="flex gap-1">
                  {e.platforms.map((p) => (
                    <PlatformIcon key={p} platform={p} className="size-3.5" />
                  ))}
                </span>
                <span className="ml-auto font-mono text-sm tabular-nums">{e.n}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <SectionTitle n="05">Busiest workspaces</SectionTitle>
          <ol className="divide-y rounded-md border bg-card">
            {o.topWorkspaces.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nothing published yet.</li>}
            {o.topWorkspaces.map((w, i) => (
              <li key={String(w._id)} className="flex items-center gap-3 px-4 py-2.5">
                <span className="font-mono text-[11px] text-signal">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate text-sm">{w.name}</span>
                <Badge variant="outline">{w.plan}</Badge>
                <span className="ml-auto font-mono text-sm tabular-nums">{w.published}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, foot, accent, href }: { label: string; value: React.ReactNode; foot: string; accent?: boolean; href: string }) {
  return (
    <Link href={href} className="border-b px-1 py-5 transition-colors hover:bg-accent/30 md:border-b-0 md:px-5 md:first:pl-1">
      <p className="eyebrow">{label}</p>
      <p className={`mt-2 font-serif text-[40px] leading-none tabular-nums ${accent ? "text-signal" : ""}`}>{value}</p>
      <p className="mt-2 truncate text-xs text-muted-foreground">{foot}</p>
    </Link>
  );
}
