"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowUpRightIcon,
  CableIcon,
  CornerDownRightIcon,
  FlaskConicalIcon,
  HeartIcon,
  MessageCircleIcon,
  PenLineIcon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { METRIC_LABEL, liveCaps, type LiveComment, type LiveStatus, type MetricKey } from "@/lib/live/types";
import type { LiveChannelRow, LiveInboxRow, LiveOverview, LivePostRow } from "@/lib/live/queries";
import { refreshLiveAction, replyToCommentAction } from "@/lib/actions/live";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { TimeAgo } from "@/components/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const AUTO_REFRESH_MS = 60_000;
const name = (p: string) => PLATFORMS[p as TargetPlatform]?.name ?? p;

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

/** Re-renders the page every minute, but only while someone is looking at it. */
function useAutoRefresh() {
  const router = useRouter();
  const last = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      last.current = Date.now();
      router.refresh();
    };
    const t = setInterval(tick, AUTO_REFRESH_MS);
    // Coming back to a tab that's been hidden a while: catch up straight away.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current > AUTO_REFRESH_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
}

export function RefreshAllButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await refreshLiveAction();
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      <RefreshCwIcon className={cn(pending && "animate-spin")} /> {pending ? "Checking…" : "Refresh all"}
    </Button>
  );
}

export function LiveView({ data, initialTab, initialPlatform, canReply }: { data: LiveOverview; initialTab: string; initialPlatform: string; canReply: boolean }) {
  useAutoRefresh();
  const [tab, setTab] = useState(initialTab);
  const [platform, setPlatform] = useState(data.platforms.includes(initialPlatform) ? initialPlatform : "all");

  // Keep tab and filter in the URL so a refresh or a shared link lands in the same place.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    if (platform === "all") url.searchParams.delete("platform");
    else url.searchParams.set("platform", platform);
    window.history.replaceState(null, "", url);
  }, [tab, platform]);

  const { posts, inbox, channels } = useMemo(() => {
    const match = (r: { platform: string }) => platform === "all" || r.platform === platform;
    return { posts: data.posts.filter(match), inbox: data.inbox.filter(match), channels: data.channels.filter(match) };
  }, [data, platform]);

  if (data.channels.length === 0) {
    return (
      <Empty title="No channels connected yet." body="Connect Instagram, YouTube, a Telegram channel or any other destination, and its posts show up here once they go out.">
        <Button variant="signal" asChild>
          <Link href="/accounts">
            <CableIcon /> Connect a channel
          </Link>
        </Button>
      </Empty>
    );
  }

  const sum = (k: MetricKey) => posts.reduce((n, r) => n + (r.metrics[k] ?? 0), 0);
  const attention = channels.filter((c) => c.needsReconnect || c.status !== "active").length;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 border-y md:grid-cols-4 md:divide-x">
        <Stat label="Watching" value={posts.length} foot={`recent ${posts.length === 1 ? "post" : "posts"} across channels`} />
        <Stat label="Views" value={compact(sum("views"))} foot="where the platform shares them" />
        <Stat label="Engagement" value={compact(sum("likes") + sum("reactions") + sum("shares") + sum("saves"))} foot="likes, reactions, shares, saves" />
        <Stat label="Attention" value={attention} foot="channels to reconnect or check" accent={attention > 0} />
      </section>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by platform">
        <FilterChip active={platform === "all"} onClick={() => setPlatform("all")}>
          All
        </FilterChip>
        {data.platforms.map((p) => (
          <FilterChip key={p} active={platform === p} onClick={() => setPlatform(p)}>
            <PlatformIcon platform={p} className="size-3.5" /> {name(p)}
          </FilterChip>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="posts">
            Posts <Count n={posts.length} />
          </TabsTrigger>
          <TabsTrigger value="comments">
            Comments <Count n={inbox.length} />
          </TabsTrigger>
          <TabsTrigger value="channels">
            Channels <Count n={channels.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-2">
          {posts.length === 0 ? (
            <Empty title={platform === "all" ? "Nothing published yet." : `Nothing published to ${name(platform)} lately.`} body="Once a post goes out, its live numbers and comments are tracked here.">
              <Button variant="signal" asChild>
                <Link href="/compose">
                  <PenLineIcon /> Write a post
                </Link>
              </Button>
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {posts.map((r) => (
                <PostRow key={r.id} row={r} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="comments" className="mt-2">
          <CommentsTab rows={inbox} posts={posts} canReply={canReply} platform={platform} />
        </TabsContent>

        <TabsContent value="channels" className="mt-2">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {channels.map((c) => (
              <ChannelCard key={c.id} c={c} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
      <p className="font-mono text-[10.5px] text-muted-foreground">Numbers are cached for 5 minutes and this page checks again every minute while it&apos;s open.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ posts */

function LiveBadge({ status }: { status: LiveStatus }) {
  if (status === "live")
    return (
      <Badge variant="ok">
        <span className="size-1.5 rounded-full bg-current" /> Live
      </Badge>
    );
  if (status === "removed") return <Badge variant="destructive">Removed</Badge>;
  return <Badge variant="secondary">Unknown</Badge>;
}

function PostRow({ row: r }: { row: LivePostRow }) {
  const [pending, start] = useTransition();
  const caps = liveCaps(r.platform);
  const shown = caps.metrics.filter((k) => r.metrics[k] != null);
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b px-4 py-3.5 last:border-0 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,300px)_auto] md:items-center">
      <PlatformIcon platform={r.platform} tone="chip" className="mt-0.5 size-8 p-1.5 md:mt-0" />
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{r.account.handle}</span>
          {r.account.sandbox && <FlaskConicalIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Sandbox" />}
          <LiveBadge status={r.status} />
        </p>
        <Link href={`/posts/${r.postId}`} className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground hover:text-foreground hover:underline">
          {r.caption || <span className="italic">No text</span>}
        </Link>
        <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
          {r.publishedAt && <TimeAgo prefix="Published " date={r.publishedAt} />}
          {r.checkedAt && <TimeAgo prefix=" · checked " date={r.checkedAt} />}
        </p>
        {r.error && (
          <p className="mt-1 flex items-start gap-1 text-xs text-signal">
            <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" /> <span className="min-w-0 break-words">{r.error}</span>
          </p>
        )}
        {!r.error && r.note && !shown.length && <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>}
      </div>
      <dl className="col-span-2 flex flex-wrap gap-x-5 gap-y-1 md:col-span-1">
        {shown.length ? (
          shown.map((k) => (
            <div key={k}>
              <dt className="font-mono text-[9.5px] tracking-wider text-muted-foreground uppercase">{METRIC_LABEL[k]}</dt>
              <dd className="font-serif text-xl tabular-nums">{compact(r.metrics[k]!)}</dd>
            </div>
          ))
        ) : (
          <div className="font-mono text-[10.5px] text-muted-foreground uppercase">{caps.metrics.length ? "No numbers yet" : "Status only"}</div>
        )}
      </dl>
      <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:justify-end">
        {r.permalink && (
          <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs whitespace-nowrap underline decoration-signal decoration-2 underline-offset-4">
            Open on {name(r.platform)} <ArrowUpRightIcon className="size-3" />
          </a>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto md:ml-0"
          aria-label="Refresh this post"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await refreshLiveAction(r.id);
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
            })
          }
        >
          <RefreshCwIcon className={cn(pending && "animate-spin")} />
        </Button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ comments */

function CommentsTab({ rows, posts, canReply, platform }: { rows: LiveInboxRow[]; posts: LivePostRow[]; canReply: boolean; platform: string }) {
  // Platforms in view that never hand comments to apps, so an empty inbox isn't misleading.
  const silent = [...new Set(posts.map((p) => p.platform))].filter((p) => !liveCaps(p).comments);
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <Empty
          title="No comments yet."
          body={posts.length ? "New comments on your recent posts land here, newest first." : "Publish something and the conversation around it shows up here."}
        >
          {!posts.length && (
            <Button variant="signal" asChild>
              <Link href="/compose">
                <PenLineIcon /> Write a post
              </Link>
            </Button>
          )}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {rows.map((r) => (
            <CommentItem key={`${r.targetId}:${r.comment.id}`} row={r} canReply={canReply} />
          ))}
        </div>
      )}
      {silent.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {platform === "all" ? "Not shown: " : ""}
          {silent.map(name).join(", ")} {silent.length === 1 ? "doesn't" : "don't"} share comments with apps. Use &ldquo;Open on…&rdquo; in the Posts tab to read them there.
        </p>
      )}
    </div>
  );
}

function CommentItem({ row: r, canReply }: { row: LiveInboxRow; canReply: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const c = r.comment;
  const send = () =>
    start(async () => {
      const res = await replyToCommentAction({ targetId: r.targetId, commentId: c.id, text });
      if (res.ok) {
        toast.success(res.message);
        setText("");
        setOpen(false);
      } else toast.error(res.error);
    });

  return (
    <article className="border-b px-4 py-3.5 last:border-0">
      <div className="flex items-start gap-3">
        <PlatformIcon platform={r.platform} tone="chip" className="mt-0.5 size-7 p-1.5" />
        <div className="min-w-0 flex-1">
          <CommentBody c={c} />
          <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
            on {r.handle} · {r.caption || "a post"}
          </p>
          {(c.replies ?? []).length > 0 && (
            <div className="mt-2 space-y-2 border-l-2 pl-3">
              {c.replies!.map((rep) => (
                <div key={rep.id} className="flex gap-1.5">
                  <CornerDownRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <CommentBody c={rep} small />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {r.canReply && canReply ? (
              !open && (
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  <MessageCircleIcon /> Reply
                </Button>
              )
            ) : (
              <span className="text-xs text-muted-foreground">
                {!liveCaps(r.platform).reply ? `${name(r.platform)} doesn't allow replies from apps.` : !canReply ? "Editors can reply from here." : "Reconnect this channel to reply."}
              </span>
            )}
            {r.permalink && (
              <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                Open on {name(r.platform)} <ArrowUpRightIcon className="size-3" />
              </a>
            )}
          </div>
          {open && (
            <div className="mt-2 grid gap-2">
              <Textarea
                autoFocus
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) send();
                }}
                placeholder={`Reply to ${c.author}`}
                className="min-h-16"
              />
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button size="sm" variant="signal" onClick={send} disabled={pending || !text.trim()}>
                  <SendIcon /> {pending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function CommentBody({ c, small }: { c: LiveComment; small?: boolean }) {
  return (
    <>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        {c.authorUrl ? (
          <a href={c.authorUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium hover:underline">
            {c.author}
          </a>
        ) : (
          <span className="min-w-0 truncate font-medium">{c.author}</span>
        )}
        {c.fromRelay && <Badge variant="signal">Relay</Badge>}
        <TimeAgo date={c.at} className="font-mono text-[10.5px] text-muted-foreground" />
        {c.likes ? (
          <span className="inline-flex items-center gap-0.5 font-mono text-[10.5px] text-muted-foreground">
            <HeartIcon className="size-3" /> {c.likes}
          </span>
        ) : null}
      </p>
      <p className={cn("mt-0.5 leading-snug break-words whitespace-pre-wrap", small ? "text-[13px]" : "text-[14px]")}>{c.text}</p>
    </>
  );
}

/* ------------------------------------------------------------------ channels */

function ChannelCard({ c }: { c: LiveChannelRow }) {
  const spec = PLATFORMS[c.platform as TargetPlatform];
  const caps = liveCaps(c.platform);
  const reads = [caps.metrics.length ? caps.metrics.map((k) => METRIC_LABEL[k].toLowerCase()).join(", ") : null, caps.comments ? "comments" : null, caps.reply ? "replies" : null].filter(Boolean);
  return (
    <article className="flex min-w-0 flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-3 border-b px-4 py-3" style={{ backgroundColor: spec ? `color-mix(in oklab, ${spec.color} 8%, transparent)` : undefined }}>
        <PlatformIcon platform={c.platform} tone="chip" className="size-9 rounded-full p-2" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-medium">
            <span className="truncate">{c.handle}</span>
            {c.sandbox && <FlaskConicalIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Sandbox" />}
          </p>
          <p className="truncate font-mono text-[10.5px] text-muted-foreground uppercase">{spec?.name ?? c.platform}</p>
        </div>
        {c.needsReconnect && c.status === "active" ? <Badge variant="warn">Reconnect</Badge> : <StatusBadge status={c.status} />}
      </div>
      <dl className="grid grid-cols-3 divide-x border-b text-center">
        <Metric label="Audience" value={c.audienceSize != null ? compact(c.audienceSize) : "—"} />
        <Metric label="Posts 30d" value={c.published30} />
        <Metric label="Last post" value={c.lastPostAt ? <TimeAgo date={c.lastPostAt} className="text-[13px]" /> : "—"} small />
      </dl>
      <div className="flex-1 space-y-1.5 px-4 py-3 text-[13px]">
        {c.lastError ? (
          <p className="flex items-start gap-1.5 text-signal">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {c.lastError}
              {c.lastErrorAt && <TimeAgo prefix=" · " date={c.lastErrorAt} className="font-mono text-[10.5px] text-muted-foreground" />}
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground">No recent errors.</p>
        )}
        <p className="text-xs text-muted-foreground">{reads.length ? `Reads ${reads.join(" · ")}` : "Status from Relay's delivery records only"}</p>
      </div>
      <div className="flex items-center gap-3 border-t px-4 py-2.5 text-xs">
        <span className="font-mono text-[10.5px] text-muted-foreground">{c.lastCheckedAt ? <TimeAgo prefix="Checked " date={c.lastCheckedAt} /> : "Not checked yet"}</span>
        {c.needsReconnect ? (
          <Link href="/accounts" className="ml-auto inline-flex items-center gap-1 underline decoration-signal decoration-2 underline-offset-4">
            Reconnect <ArrowUpRightIcon className="size-3" />
          </Link>
        ) : (
          c.profileUrl && (
            <a href={c.profileUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 underline decoration-signal decoration-2 underline-offset-4">
              Open <ArrowUpRightIcon className="size-3" />
            </a>
          )
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ bits */

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">{n}</span>;
}

function Stat({ label, value, foot, accent }: { label: string; value: React.ReactNode; foot: string; accent?: boolean }) {
  return (
    <div className="border-b px-1 py-5 md:border-b-0 md:px-6 md:first:pl-1">
      <p className="eyebrow">{label}</p>
      <p className={cn("mt-2 font-serif text-[40px] leading-none tabular-nums md:text-[46px]", accent && "text-signal")}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{foot}</p>
    </div>
  );
}

function Metric({ label, value, small }: { label: string; value: React.ReactNode; small?: boolean }) {
  return (
    <div className="min-w-0 px-2 py-2.5">
      <dt className="font-mono text-[9.5px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-serif tabular-nums", small ? "text-base leading-8" : "text-2xl")}>{value}</dd>
    </div>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="grain rounded-xl border border-dashed p-10 text-center md:p-14">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div>
  );
}
