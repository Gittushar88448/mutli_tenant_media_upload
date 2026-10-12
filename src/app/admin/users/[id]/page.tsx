/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped aggregation output */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowLeftIcon } from "lucide-react";
import { getAdminUserDetail } from "@/lib/queries/admin";
import { isOid } from "@/lib/models";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/status-badge";
import { PlatformIcon, PlatformStack } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { UserDetailActions } from "./user-actions";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isOid(id)) notFound();
  const u = await getAdminUserDetail(id);
  if (!u) notFound();
  return (
    <div className="space-y-10">
      <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> All users
      </Link>
      <PageHeader
        eyebrow={`User · joined ${format(new Date(u.createdAt), "d MMM yyyy")}`}
        title={u.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {u.email} <StatusBadge status={u.status} /> <Badge variant={u.role === "admin" ? "signal" : "secondary"}>{u.role}</Badge>
            <span className="font-mono text-xs">{u.lastLoginAt ? `last seen ${formatDistanceToNowStrict(new Date(u.lastLoginAt), { addSuffix: true })}` : "never signed in"}</span>
          </span>
        }
        actions={<UserDetailActions id={id} role={u.role} status={u.status} email={u.email} />}
      />
      <div className="grid gap-10 xl:grid-cols-2">
        <section>
          <SectionTitle n="01">Workspaces</SectionTitle>
          <div className="space-y-2">
            {u.memberships.length === 0 && <p className="text-sm text-muted-foreground">Not a member of any workspace.</p>}
            {u.memberships.map((m: any) => (
              <div key={String(m._id)} className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.ws.name}</span>
                  <Badge variant="outline">{m.role}</Badge>
                  <Badge variant="secondary">{m.ws.plan}</Badge>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{m.ws.members} members</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.ws.accounts.map((a: any) => (
                    <span key={String(a._id)} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                      <PlatformIcon platform={a.platform} className="size-3" /> {a.handle}
                      {a.status !== "active" && <span className="text-signal">· {a.status}</span>}
                    </span>
                  ))}
                  {m.ws.accounts.length === 0 && <span className="text-xs text-muted-foreground">No channels</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle n="02">Recent posts</SectionTitle>
          <ul className="divide-y rounded-xl border bg-card">
            {u.recentPosts.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No posts.</li>}
            {u.recentPosts.map((p: any) => (
              <li key={String(p._id)} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{p.baseCaption || "Untitled"}</p>
                  <p className="font-mono text-[10.5px] text-muted-foreground">{format(new Date(p.createdAt), "d MMM yyyy HH:mm")}</p>
                </div>
                <PlatformStack platforms={[...new Set<string>(p.targets.map((t: any) => t.platform))]} />
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section>
        <SectionTitle n="03">Activity</SectionTitle>
        <ol className="space-y-1 border-l pl-4">
          {u.activity.length === 0 && <li className="text-sm text-muted-foreground">No recorded activity.</li>}
          {u.activity.map((a: any) => (
            <li key={String(a._id)} className="font-mono text-xs">
              <span className="text-muted-foreground">{format(new Date(a.createdAt), "d MMM HH:mm")}</span> {a.action}
              {a.ip && <span className="text-muted-foreground"> · {a.ip}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
