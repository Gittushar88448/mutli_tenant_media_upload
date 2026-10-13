"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  HeartIcon,
  InfoIcon,
  Loader2Icon,
  MessageCircleIcon,
  PenLineIcon,
  PlayIcon,
  RefreshCwIcon,
  Repeat2Icon,
  SearchIcon,
  SlidersHorizontalIcon,
  EyeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PlatformIcon } from "@/components/platform-icon";
import { TimeAgo } from "@/components/time-ago";
import { discoverAction } from "@/lib/actions/discover";
import { itemKeywords } from "@/lib/discover/keywords";
import { NO_SEARCH_API, SOURCE_INFO, engagement, type ContentType, type DiscoverItem, type DiscoverQuery, type DiscoverResult, type DiscoverSource, type Keyword, type Period, type SortKey } from "@/lib/discover/types";
import { cn } from "@/lib/utils";

const TYPES: { id: ContentType; label: string }[] = [
  { id: "short", label: "Shorts & Reels" },
  { id: "video", label: "Videos" },
  { id: "post", label: "Posts" },
];
const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "Last 24 hours" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
  { id: "year", label: "Last year" },
  { id: "any", label: "Any time" },
];
const SORTS: { id: SortKey; label: string }[] = [
  { id: "views", label: "Most views" },
  { id: "likes", label: "Most likes" },
  { id: "comments", label: "Most comments" },
  { id: "engagement", label: "Best engagement rate" },
  { id: "recent", label: "Newest" },
];
const PRESETS = [
  { label: "Any", v: 0 },
  { label: "1K+", v: 1_000 },
  { label: "10K+", v: 10_000 },
  { label: "100K+", v: 100_000 },
  { label: "1M+", v: 1_000_000 },
];

const compact = (n?: number) => (n === undefined ? "–" : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n));
const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}%`;

export function DiscoverView({ ready, demo, used: initialUsed, limit, recent, sources }: { ready: Record<DiscoverSource, boolean>; demo: boolean; used: number; limit: number; recent: DiscoverQuery[]; sources: DiscoverSource[] }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<DiscoverSource[]>(sources.filter((s) => ready[s] || demo));
  const [types, setTypes] = useState<ContentType[]>(["short", "video", "post"]);
  const [period, setPeriod] = useState<Period>("week");
  const [sort, setSort] = useState<SortKey>("views");
  const [minViews, setMinViews] = useState(0);
  const [minLikes, setMinLikes] = useState(0);
  const [minComments, setMinComments] = useState(0);
  const [region, setRegion] = useState("");
  const [language, setLanguage] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [lastQuery, setLastQuery] = useState<DiscoverQuery | null>(null);
  const [cached, setCached] = useState(false);
  const [used, setUsed] = useState(initialUsed);
  const [pending, start] = useTransition();

  function query(overrides: Partial<DiscoverQuery> = {}): DiscoverQuery {
    return {
      q: q.trim(),
      sources: picked,
      types,
      period,
      sort,
      minViews: minViews || undefined,
      minLikes: minLikes || undefined,
      minComments: minComments || undefined,
      region: region || undefined,
      language: language || undefined,
      ...overrides,
    };
  }

  function search(overrides: Partial<DiscoverQuery> = {}, fresh = false) {
    const qy = query(overrides);
    if (!qy.q) return void toast.error("Type a keyword or hashtag to search for.");
    start(async () => {
      const r = await discoverAction(qy, fresh);
      if (r.used !== undefined) setUsed(r.used);
      if (r.error || !r.result) return void toast.error(r.error ?? "The search didn't work.");
      setResult(r.result);
      setLastQuery(qy);
      setCached(Boolean(r.cached));
    });
  }

  function applyRecent(r: DiscoverQuery) {
    setQ(r.q);
    setPicked(r.sources);
    setTypes(r.types);
    setPeriod(r.period);
    setSort(r.sort);
    setMinViews(r.minViews ?? 0);
    setMinLikes(r.minLikes ?? 0);
    setMinComments(r.minComments ?? 0);
    search(r);
  }

  const noViews = useMemo(() => (lastQuery?.minViews ? lastQuery.sources.filter((s) => !["youtube", "x"].includes(s)).map((s) => SOURCE_INFO[s].name) : []), [lastQuery]);

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Keyword or #hashtag, e.g. skincare, #streetfood, budget travel" className="h-11 pl-9 text-base" aria-label="Search" maxLength={100} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters}>
              <SlidersHorizontalIcon /> Filters
            </Button>
            <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />} Search
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => {
            const on = picked.includes(s);
            const usable = ready[s] || demo;
            return (
              <button
                key={s}
                type="button"
                disabled={!usable}
                title={ready[s] ? undefined : `Needs ${SOURCE_INFO[s].needs}${demo ? " (sample results until then)" : ""}`}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40", on ? "border-foreground bg-foreground text-background" : "hover:border-foreground/40")}
                aria-pressed={on}
              >
                <PlatformIcon platform={s} className="size-3.5" tone={on ? "plain" : "brand"} />
                {SOURCE_INFO[s].name}
                {!ready[s] && <span className={cn("font-mono text-[9.5px] uppercase", on ? "opacity-70" : "text-muted-foreground")}>{demo ? "sample" : "set up"}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((t) => {
              const on = types.includes(t.id);
              return (
                <button key={t.id} type="button" aria-pressed={on} onClick={() => setTypes((x) => (on ? (x.length > 1 ? x.filter((y) => y !== t.id) : x) : [...x, t.id]))} className={cn("rounded-lg border px-2.5 py-1 text-[12.5px]", on ? "border-signal bg-signal/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="h-8 w-[150px]" aria-label="Published">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-[190px]" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {used} of {limit.toLocaleString()} searches today
          </span>
        </div>

        {showFilters && (
          <div className="grid gap-4 border-t pt-4 md:grid-cols-3">
            <Threshold label="Minimum views" value={minViews} onChange={setMinViews} hint="YouTube and X publish views." />
            <Threshold label="Minimum likes" value={minLikes} onChange={setMinLikes} hint="Likes, upvotes or favourites." />
            <Threshold label="Minimum comments" value={minComments} onChange={setMinComments} />
            <div className="grid gap-1.5">
              <Label htmlFor="d-region">Country (YouTube)</Label>
              <Input id="d-region" value={region} onChange={(e) => setRegion(e.target.value.toUpperCase().slice(0, 2))} placeholder="IN, US, GB…" maxLength={2} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-lang">Language</Label>
              <Input id="d-lang" value={language} onChange={(e) => setLanguage(e.target.value.toLowerCase().slice(0, 2))} placeholder="en, hi, es…" maxLength={2} />
            </div>
          </div>
        )}

        {recent.length > 0 && !result && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <span className="eyebrow mr-1">Recent</span>
            {recent.map((r) => (
              <button key={r.q} type="button" onClick={() => applyRecent(r)} className="rounded-full border px-2.5 py-0.5 text-[12.5px] text-muted-foreground hover:text-foreground">
                {r.q}
              </button>
            ))}
          </div>
        )}
      </form>

      {!result && !pending && <Empty ready={ready} demo={demo} />}
      {pending && !result && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-16 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Searching {picked.length} platform{picked.length === 1 ? "" : "s"}
        </div>
      )}

      {result && lastQuery && (
        <Results result={result} query={lastQuery} cached={cached} pending={pending} onRefresh={() => search(lastQuery, true)} noViews={noViews} />
      )}
    </div>
  );
}

function Threshold({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  const id = `t-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => onChange(p.v)} className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px]", value === p.v ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
            {p.label}
          </button>
        ))}
      </div>
      <Input id={id} type="number" min={0} inputMode="numeric" value={value || ""} placeholder="Custom number" onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Empty({ ready, demo }: { ready: Record<DiscoverSource, boolean>; demo: boolean }) {
  const missing = (Object.keys(ready) as DiscoverSource[]).filter((s) => !ready[s]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-5">
        <p className="eyebrow mb-2">How it works</p>
        <ol className="list-decimal space-y-1.5 pl-4 text-[13.5px] leading-relaxed text-muted-foreground">
          <li>Search a topic or hashtag across platforms. Results come from each platform&apos;s public search, ranked by views or likes, not from anyone&apos;s personal feed.</li>
          <li>Set minimum views, likes or comments, or type your own number.</li>
          <li>The keyword panel ranks the hashtags, words and phrases used by the best-performing posts. Copy them or start a post with them.</li>
          <li>Download images, Reddit and Mastodon videos in the quality you pick, or the thumbnail where a platform doesn&apos;t allow video downloads.</li>
        </ol>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <p className="eyebrow mb-2">Platforms</p>
        <ul className="space-y-1.5 text-[13px]">
          {missing.map((s) => (
            <li key={s} className="flex gap-2">
              <PlatformIcon platform={s} className="mt-0.5 size-3.5" />
              <span className="text-muted-foreground">
                <b className="font-medium text-foreground">{SOURCE_INFO[s].name}</b> needs {SOURCE_INFO[s].needs}
                {demo ? ". Sample results until then." : "."}
                {s === "instagram" && (
                  <>
                    {" "}
                    <Link href="/accounts" className="underline underline-offset-2">
                      Connect
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
          {NO_SEARCH_API.map((n) => (
            <li key={n.name} className="flex gap-2 text-muted-foreground">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <b className="font-medium text-foreground">{n.name}</b>: {n.why}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Results({ result, query, cached, pending, onRefresh, noViews }: { result: DiscoverResult; query: DiscoverQuery; cached: boolean; pending: boolean; onRefresh: () => void; noViews: string[] }) {
  const [source, setSource] = useState<DiscoverSource | "all">("all");
  const items = source === "all" ? result.items : result.items.filter((i) => i.source === source);
  const counts = useMemo(() => {
    const c: Partial<Record<DiscoverSource, number>> = {};
    for (const i of result.items) c[i.source] = (c[i.source] ?? 0) + 1;
    return c;
  }, [result.items]);

  return (
    <div className="space-y-4">
      {result.notes.length > 0 && (
        <div className="space-y-1 rounded-xl border border-dashed bg-muted/40 px-4 py-3 text-[12.5px] text-muted-foreground">
          {result.notes.map((n) => (
            <p key={n.source} className="flex items-start gap-2">
              <PlatformIcon platform={n.source} className="mt-0.5 size-3.5" /> {n.message}
            </p>
          ))}
          {noViews.length > 0 && <p>The minimum-views filter was skipped for {noViews.join(", ")}: they don&apos;t publish view counts.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip on={source === "all"} onClick={() => setSource("all")}>
            All {result.items.length}
          </Chip>
          {(Object.keys(counts) as DiscoverSource[]).map((s) => (
            <Chip key={s} on={source === s} onClick={() => setSource(s)}>
              <PlatformIcon platform={s} className="size-3" tone={source === s ? "plain" : "brand"} /> {SOURCE_INFO[s].name} {counts[s]}
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">
            {cached ? "cached · " : ""}
            <TimeAgo date={result.fetchedAt} />
          </span>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={pending} aria-label="Search again">
            <RefreshCwIcon className={cn(pending && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCsv(items, query)}>
            <FileSpreadsheetIcon /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportJson(result, query)}>
            <FileJsonIcon /> JSON
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 min-w-0 xl:order-1">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">Nothing matched. Lower the minimums, widen the date range or try a broader word.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {items.map((i) => (
                <ResultCard key={i.id} item={i} />
              ))}
            </div>
          )}
        </div>
        <div className="order-1 xl:order-2">
          <KeywordPanel keywords={result.keywords} query={query.q} />
        </div>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}

function ResultCard({ item: i }: { item: DiscoverItem }) {
  const kw = useMemo(() => itemKeywords(i, 6), [i]);
  const rate = i.views ? engagement(i) : null;
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card" data-testid="discover-item">
      <a href={i.demo ? undefined : i.url} target="_blank" rel="noreferrer" className={cn("relative block bg-muted", i.type === "short" ? "aspect-[4/5]" : "aspect-video")}>
        {i.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={i.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-[linear-gradient(150deg,color-mix(in_oklch,var(--signal)_25%,var(--muted)),var(--muted))] p-4">
            <p className="line-clamp-4 text-center font-serif text-lg leading-snug">{i.title}</p>
          </div>
        )}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] text-white backdrop-blur">
          <PlatformIcon platform={i.source} className="size-3" tone="plain" /> {i.type === "short" ? "Short" : i.type === "video" ? "Video" : "Post"}
        </span>
        {i.durationSec ? (
          <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 font-mono text-[10.5px] text-white">
            {Math.floor(i.durationSec / 60)}:{String(i.durationSec % 60).padStart(2, "0")}
          </span>
        ) : null}
        {i.demo && <span className="absolute top-2 right-2 rounded-full bg-warn px-2 py-0.5 font-mono text-[9.5px] text-black uppercase">Sample</span>}
      </a>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className="line-clamp-2 text-[14px] leading-snug font-medium">{i.title || i.text.slice(0, 120)}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {i.author} · <TimeAgo date={i.publishedAt} />
        </p>
        <div className="grid grid-cols-4 gap-1 font-mono text-[11.5px]">
          <Metric icon={<EyeIcon />} v={i.views} label="views" />
          <Metric icon={<HeartIcon />} v={i.likes} label={i.source === "reddit" ? "upvotes" : "likes"} />
          <Metric icon={<MessageCircleIcon />} v={i.comments} label="comments" />
          <Metric icon={<Repeat2Icon />} v={i.shares} label="shares" />
        </div>
        {rate !== null && <p className="font-mono text-[10.5px] text-muted-foreground">Engagement {pct(rate)}</p>}
        {(kw.hashtags.length > 0 || kw.keywords.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {kw.hashtags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-signal/10 px-1.5 py-0.5 text-[11px] text-signal">
                #{t}
              </span>
            ))}
            {kw.keywords.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center gap-1 pt-1">
          {!i.demo && (
            <Button asChild variant="ghost" size="sm" className="px-2">
              <a href={i.url} target="_blank" rel="noreferrer">
                {i.type === "post" ? <ExternalLinkIcon /> : <PlayIcon />} Open
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            onClick={() => copy([...kw.hashtags.map((t) => `#${t}`), ...kw.keywords].join(" "), "Keywords copied")}
          >
            <CopyIcon /> Keywords
          </Button>
          <DownloadMenu item={i} />
        </div>
      </div>
    </article>
  );
}

function Metric({ icon, v, label }: { icon: React.ReactNode; v?: number; label: string }) {
  return (
    <span title={v === undefined ? `This platform doesn't publish ${label}` : `${v.toLocaleString()} ${label}`} className={cn("flex items-center gap-1 [&_svg]:size-3", v === undefined && "text-muted-foreground/60")}>
      {icon}
      {compact(v)}
    </span>
  );
}

function DownloadMenu({ item: i }: { item: DiscoverItem }) {
  const only = SOURCE_INFO[i.source].download === "thumbnail";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="ml-auto px-2" aria-label="Download">
          <DownloadIcon /> Save
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Download</DropdownMenuLabel>
        {i.media.length === 0 ? (
          <p className="px-2 pb-2 text-[12px] text-muted-foreground">{i.demo ? "Sample results have no files." : "This post has no image or video to download."}</p>
        ) : (
          i.media.map((m) => (
            <DropdownMenuItem key={m.url} asChild>
              <a href={m.href} download>
                <DownloadIcon /> {m.label}
              </a>
            </DropdownMenuItem>
          ))
        )}
        {only && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[11.5px] leading-snug text-muted-foreground">
              {SOURCE_INFO[i.source].name}&apos;s terms don&apos;t allow other apps to download its videos, so Relay offers the thumbnail. Open the post to watch it.
            </p>
          </>
        )}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11.5px] leading-snug text-muted-foreground">Content belongs to its creator. Ask before reposting, and credit them.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KeywordPanel({ keywords, query }: { keywords: Keyword[]; query: string }) {
  const by = (k: Keyword["kind"]) => keywords.filter((x) => x.kind === k);
  const hashtags = by("hashtag");
  const top = hashtags.slice(0, 15).map((h) => `#${h.term.replace(/\s+/g, "")}`);
  return (
    <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
      <div className="rounded-xl border bg-card p-4">
        <p className="eyebrow mb-1">Keywords that perform</p>
        <p className="text-[12px] leading-snug text-muted-foreground">Ranked by the reach and engagement of the posts that use them.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={!top.length} onClick={() => copy(top.join(" "), `${top.length} hashtags copied`)}>
            <CopyIcon /> Copy top hashtags
          </Button>
          <Button size="sm" asChild disabled={!top.length}>
            <Link href={`/compose?caption=${encodeURIComponent(`\n\n${top.slice(0, 10).join(" ")}`)}`}>
              <PenLineIcon /> Write a post
            </Link>
          </Button>
        </div>
        <Tabs defaultValue="hashtag" className="mt-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="hashtag">Hashtags</TabsTrigger>
            <TabsTrigger value="keyword">Words</TabsTrigger>
            <TabsTrigger value="phrase">Phrases</TabsTrigger>
          </TabsList>
          {(["hashtag", "keyword", "phrase"] as const).map((k) => (
            <TabsContent key={k} value={k} className="mt-2">
              <KeywordList list={by(k)} prefix={k === "hashtag" ? "#" : ""} query={query} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </aside>
  );
}

function KeywordList({ list, prefix, query }: { list: Keyword[]; prefix: string; query: string }) {
  if (!list.length) return <p className="py-4 text-center text-[12.5px] text-muted-foreground">None found in these results.</p>;
  return (
    <ul className="max-h-[520px] space-y-0.5 overflow-y-auto pr-1" data-testid="keyword-list">
      {list.slice(0, 30).map((k) => (
        <li key={k.term}>
          <button
            type="button"
            onClick={() => copy(`${prefix}${prefix ? k.term.replace(/\s+/g, "") : k.term}`, "Copied")}
            className="group relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            title={`Used in ${k.count} post${k.count === 1 ? "" : "s"}${k.avgViews ? ` · ${compact(k.avgViews)} average views` : ""} · ${pct(k.avgEngagement)} engagement. Click to copy.`}
          >
            <span className="absolute inset-y-1 left-0 rounded-r-md bg-signal/15" style={{ width: `${k.score}%` }} aria-hidden />
            <span className="relative min-w-0 flex-1 truncate">
              {prefix}
              {k.term}
              {query.toLowerCase().includes(k.term) && <Badge variant="outline" className="ml-1.5 text-[9px]">your search</Badge>}
            </span>
            <span className="relative font-mono text-[10.5px] text-muted-foreground">{k.avgViews ? compact(k.avgViews) : `${k.count}×`}</span>
            <span className="relative w-7 text-right font-mono text-[10.5px] font-medium">{k.score}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function copy(text: string, msg: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(msg),
    () => toast.error("Couldn't copy")
  );
}

function save(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (q: DiscoverQuery) => q.q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "discover";

function exportCsv(items: DiscoverItem[], q: DiscoverQuery) {
  const cols = ["platform", "type", "title", "author", "url", "published", "views", "likes", "comments", "shares", "engagement_rate", "duration_sec", "hashtags", "keywords"];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = items.map((i) => {
    const kw = itemKeywords(i, 10);
    return [SOURCE_INFO[i.source].name, i.type, i.title, i.author, i.url, i.publishedAt, i.views, i.likes, i.comments, i.shares, i.views ? engagement(i).toFixed(4) : "", i.durationSec, kw.hashtags.map((t) => `#${t}`).join(" "), kw.keywords.join(" ")].map(esc).join(",");
  });
  save(`relay-discover-${slug(q)}.csv`, [cols.join(","), ...rows].join("\n"), "text/csv");
}

function exportJson(result: DiscoverResult, q: DiscoverQuery) {
  const items = result.items.map(({ media, ...rest }) => ({ ...rest, media: media.map((m) => ({ label: m.label, url: m.url, width: m.width, height: m.height, kind: m.kind })) }));
  save(`relay-discover-${slug(q)}.json`, JSON.stringify({ query: q, fetchedAt: result.fetchedAt, keywords: result.keywords, items }, null, 2), "application/json");
}
