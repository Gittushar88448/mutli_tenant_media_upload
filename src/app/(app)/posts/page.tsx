import type { Metadata } from "next";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { PenLineIcon } from "lucide-react";
import { getWorkspaceContext } from "@/lib/auth/session";
import { listWorkspacePosts, type PostListTab } from "@/lib/queries/workspace";
import { PageHeader } from "@/components/shell/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { MediaThumb } from "@/components/media/thumb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SearchBox } from "./search-box";

export const metadata: Metadata = { title: "Queue" };

const TABS: { id: PostListTab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
  { id: "drafts", label: "Drafts" },
  { id: "all", label: "All" },
];

const DOT: Record<string, string> = {
  published: "bg-ok",
  failed: "bg-destructive",
  needs_action: "bg-warn",
  retrying: "bg-warn",
  cancelled: "bg-muted-foreground/40",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await getWorkspaceContext();
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.id === sp.tab)?.id ?? "upcoming") as PostListTab;
  const tz = ctx.workspace.timezone;
  const posts = await listWorkspacePosts(ctx.workspace.id, tab, sp.q ?? "");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Queue"
        title="Everything going out"
        actions={
          <Button variant="signal" asChild>
            <Link href="/compose">
              <PenLineIcon /> New post
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <nav className="flex gap-5 border-b">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/posts?tab=${t.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={cn("-mb-px border-b-2 pb-2.5 text-sm font-medium text-muted-foreground hover:text-foreground", tab === t.id ? "border-signal text-foreground" : "border-transparent")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <SearchBox defaultValue={sp.q} />
      </div>

      {posts.length === 0 ? (
        <div className="grain rounded-xl border border-dashed p-14 text-center">
          <p className="font-serif text-2xl">Nothing in {TABS.find((t) => t.id === tab)!.label.toLowerCase()}.</p>
          <p className="mt-1 text-sm text-muted-foreground">Posts you create show up here with each channel&apos;s delivery state.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {posts.map((p) => (
            <Link key={String(p._id)} href={`/posts/${String(p._id)}`} className="grid grid-cols-[56px_1fr] gap-4 border-b px-4 py-3.5 last:border-0 hover:bg-accent/30 md:grid-cols-[56px_1fr_220px_150px_130px]">
              {p.coverId ? (
                <MediaThumb item={{ id: String(p.coverId), kind: p.coverKind }} className="size-14 rounded-[5px] border" />
              ) : (
                <div className="flex size-14 items-center justify-center rounded-[5px] border bg-secondary font-mono text-[10px] text-muted-foreground">TEXT</div>
              )}
              <div className="min-w-0 self-center">
                <p className="truncate text-[14px] font-medium">{p.title || p.baseCaption || <span className="text-muted-foreground italic">No caption</span>}</p>
                {p.title && <p className="truncate text-xs text-muted-foreground">{p.baseCaption}</p>}
                <p className="mt-1 font-mono text-[10.5px] text-muted-foreground uppercase">
                  {p.author} · {p.mediaCount} media
                </p>
              </div>
              <div className="col-span-2 flex flex-wrap items-center gap-1.5 self-center md:col-span-1">
                {p.targets.map((t: { _id: unknown; platform: string; status: string; handle: string }) => (
                  <span key={String(t._id)} title={`${t.handle}: ${t.status}`} className="relative">
                    <PlatformIcon platform={t.platform} tone="chip" className="size-6" />
                    <span className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card", DOT[t.status] ?? "bg-foreground/30")} />
                  </span>
                ))}
              </div>
              <div className="hidden self-center md:block">
                <StatusBadge status={p.status} />
              </div>
              <div className="hidden self-center text-right md:block">
                {p.scheduledAt ? (
                  <>
                    <p className="font-mono text-[13px] tabular-nums">{formatInTimeZone(p.scheduledAt, tz, "HH:mm")}</p>
                    <p className="font-mono text-[10.5px] text-muted-foreground uppercase">{formatInTimeZone(p.scheduledAt, tz, "EEE d MMM")}</p>
                  </>
                ) : (
                  <p className="font-mono text-[11px] text-muted-foreground">Unscheduled</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
