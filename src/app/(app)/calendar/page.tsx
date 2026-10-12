import type { Metadata } from "next";
import Link from "next/link";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getCalendarMonth } from "@/lib/queries/workspace";
import { PageHeader } from "@/components/shell/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

const STATUS_BAR: Record<string, string> = {
  done: "border-l-ok",
  failed: "border-l-destructive",
  partially_failed: "border-l-warn",
  pending_approval: "border-l-warn",
  publishing: "border-l-signal",
  draft: "border-l-muted-foreground/40",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await getWorkspaceContext();
  const tz = ctx.workspace.timezone;
  const { m } = await searchParams;
  const todayKey = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const anchor = m && /^\d{4}-\d{2}$/.test(m) ? new Date(`${m}-01T12:00:00`) : new Date(`${todayKey.slice(0, 7)}-01T12:00:00`);

  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const from = fromZonedTime(`${format(gridStart, "yyyy-MM-dd")}T00:00:00`, tz);
  const to = fromZonedTime(`${format(gridEnd, "yyyy-MM-dd")}T23:59:59`, tz);
  const buckets = new Map((await getCalendarMonth(ctx.workspace.id, from, to, tz)).map((b) => [b._id, b.posts]));
  const total = [...buckets.values()].reduce((a, p) => a + p.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Calendar · ${tz}`}
        title={
          <>
            {format(anchor, "MMMM")} <span className="text-muted-foreground italic">{format(anchor, "yyyy")}</span>
          </>
        }
        description={`${total} post${total === 1 ? "" : "s"} in view, shown in your workspace timezone.`}
        actions={
          <>
            <Button variant="outline" size="icon" asChild>
              <Link href={`/calendar?m=${format(subMonths(anchor, 1), "yyyy-MM")}`} aria-label="Previous month">
                <ChevronLeftIcon />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/calendar">Today</Link>
            </Button>
            <Button variant="outline" size="icon" asChild>
              <Link href={`/calendar?m=${format(addMonths(anchor, 1), "yyyy-MM")}`} aria-label="Next month">
                <ChevronRightIcon />
              </Link>
            </Button>
          </>
        }
      />
      <div className="overflow-x-auto">
        <div className="min-w-[760px] overflow-hidden rounded-md border bg-card">
          <div className="grid grid-cols-7 border-b">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="eyebrow px-3 py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const key = format(d, "yyyy-MM-dd");
              const posts = buckets.get(key) ?? [];
              const isToday = key === todayKey;
              const past = key < todayKey;
              return (
                <div key={key} className={cn("group relative min-h-[128px] border-b p-2", i % 7 !== 6 && "border-r", !isSameMonth(d, anchor) && "bg-muted/40", past && "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--muted)_6px,var(--muted)_7px)]")}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className={cn("font-mono text-[12px] tabular-nums", isToday ? "flex size-6 items-center justify-center rounded-full bg-signal font-semibold text-signal-foreground" : !isSameMonth(d, anchor) ? "text-muted-foreground/60" : "text-muted-foreground")}>
                      {format(d, "d")}
                    </span>
                    {!past && (
                      <Link href="/compose" className="opacity-0 transition-opacity group-hover:opacity-100" aria-label="New post">
                        <PlusIcon className="size-3.5 text-muted-foreground" />
                      </Link>
                    )}
                  </div>
                  <div className="space-y-1">
                    {posts.slice(0, 4).map((p) => (
                      <Link
                        key={String(p.id)}
                        href={`/posts/${String(p.id)}`}
                        className={cn("block rounded-[4px] border border-l-[3px] bg-background px-1.5 py-1 text-[11.5px] hover:border-foreground/30", STATUS_BAR[p.status] ?? "border-l-foreground")}
                      >
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">{formatInTimeZone(p.at, tz, "HH:mm")}</span>
                          <span className="ml-auto flex gap-0.5">
                            {p.platforms.slice(0, 4).map((pl) => (
                              <PlatformIcon key={pl} platform={pl} className="size-3" />
                            ))}
                          </span>
                        </div>
                        <p className="truncate leading-tight">{p.caption || "Untitled"}</p>
                      </Link>
                    ))}
                    {posts.length > 4 && <p className="font-mono text-[10.5px] text-muted-foreground">+{posts.length - 4} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
