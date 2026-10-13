import "server-only";
import { createHash } from "node:crypto";
import { connectDB } from "@/lib/db";
import { SocialAccount, oid } from "@/lib/models";
import { DiscoverSearch } from "@/lib/models/discover";
import { demoMode } from "@/lib/publishing/n8n";
import { loadSecrets } from "@/lib/live";
import { signDownloadUrl } from "@/lib/crypto";
import { extractKeywords } from "./keywords";
import { DiscoverError, searchBluesky, searchInstagram, searchMastodon, searchReddit, searchX, searchYouTube, type ProviderCtx } from "./providers";
import { sampleResults } from "./sample";
import { PERIOD_DAYS, SOURCE_INFO, engagement, type DiscoverItem, type DiscoverQuery, type DiscoverResult, type DiscoverSource } from "./types";

export const CACHE_MS = 30 * 60_000;

const PROVIDERS: Record<DiscoverSource, (q: DiscoverQuery, ctx: ProviderCtx) => Promise<DiscoverItem[]>> = {
  youtube: searchYouTube,
  instagram: searchInstagram,
  reddit: searchReddit,
  bluesky: searchBluesky,
  mastodon: searchMastodon,
  x: searchX,
};

/** The workspace's Instagram account, whose token can search hashtags. */
async function instagramCtx(workspaceId: string): Promise<ProviderCtx["instagram"]> {
  const acc = await SocialAccount.findOne({ workspaceId: oid(workspaceId), platform: "instagram", status: "active", sandbox: { $ne: true } }).lean();
  if (!acc) return null;
  try {
    const s = await loadSecrets(acc as never);
    return s.accessToken ? { userId: acc.externalId, accessToken: s.accessToken } : null;
  } catch {
    return null;
  }
}

export function queryKey(q: DiscoverQuery) {
  const norm = { ...q, q: q.q.trim().toLowerCase(), sources: [...q.sources].sort(), types: [...q.types].sort() };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 32);
}

export function applyFilters(items: DiscoverItem[], q: DiscoverQuery) {
  const days = PERIOD_DAYS[q.period];
  const since = days ? Date.now() - days * 86400_000 : 0;
  // A threshold only applies where the platform publishes that number.
  const pass = (v: number | undefined, min?: number) => !min || v === undefined || v >= min;
  const out = items.filter((i) => q.types.includes(i.type) && new Date(i.publishedAt).getTime() >= since && pass(i.views, q.minViews) && pass(i.likes, q.minLikes) && pass(i.comments, q.minComments));
  const key: Record<DiscoverQuery["sort"], (i: DiscoverItem) => number> = {
    views: (i) => i.views ?? (i.likes ?? 0) * 25,
    likes: (i) => i.likes ?? 0,
    comments: (i) => i.comments ?? 0,
    engagement: (i) => (i.views ? engagement(i) : -1 + engagement(i) / 1e9),
    recent: (i) => new Date(i.publishedAt).getTime(),
  };
  return out.sort((a, b) => key[q.sort](b) - key[q.sort](a)).slice(0, 200);
}

function sign(items: DiscoverItem[]) {
  for (const i of items) for (const m of i.media) m.href = `/api/discover/download?u=${encodeURIComponent(m.url)}&s=${signDownloadUrl(m.url)}&n=${encodeURIComponent(`${i.source}-${i.id.split(":")[1]}`)}`;
  return items;
}

export async function runDiscover(workspaceId: string, q: DiscoverQuery): Promise<DiscoverResult> {
  const ctx: ProviderCtx = { instagram: q.sources.includes("instagram") ? await instagramCtx(workspaceId) : null };
  const demo = demoMode();
  const notes: DiscoverResult["notes"] = [];
  const demoSources: DiscoverSource[] = [];
  const batches = await Promise.all(
    q.sources.map(async (source) => {
      try {
        return await PROVIDERS[source](q, ctx);
      } catch (e) {
        const msg = (e as Error).message;
        const notSetUp = e instanceof DiscoverError && /^(Add|Connect) /.test(msg);
        if (demo) {
          demoSources.push(source);
          notes.push({ source, message: notSetUp ? `Showing sample results: ${SOURCE_INFO[source].name} needs ${SOURCE_INFO[source].needs}.` : `${msg} Showing sample results instead.` });
          return sampleResults(source, q);
        }
        notes.push({ source, message: msg });
        return [];
      }
    })
  );
  const items = sign(applyFilters(batches.flat(), q));
  return { items, keywords: extractKeywords(items, { query: q.q }), notes, demo: demoSources, fetchedAt: new Date().toISOString() };
}

/** Cached for half an hour per workspace and query; only fresh searches count toward the daily limit. */
export async function discover(workspaceId: string, userId: string, q: DiscoverQuery, opts: { fresh?: boolean; dailyLimit: number }) {
  await connectDB();
  const key = queryKey(q);
  if (!opts.fresh) {
    const hit = await DiscoverSearch.findOne({ workspaceId: oid(workspaceId), key, createdAt: { $gte: new Date(Date.now() - CACHE_MS) } }).sort({ createdAt: -1 }).lean();
    if (hit) return { result: hit.result as DiscoverResult, cached: true, used: await usedToday(workspaceId) };
  }
  const used = await usedToday(workspaceId);
  if (used >= opts.dailyLimit) return { error: `You've used today's ${opts.dailyLimit} searches. Cached searches still work, and the count resets at midnight UTC.`, used };
  const result = await runDiscover(workspaceId, q);
  await DiscoverSearch.create({ workspaceId: oid(workspaceId), userId: oid(userId), key, query: q, result });
  return { result, cached: false, used: used + 1 };
}

export async function usedToday(workspaceId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return DiscoverSearch.countDocuments({ workspaceId: oid(workspaceId), createdAt: { $gte: start } });
}

export async function recentSearches(workspaceId: string) {
  await connectDB();
  const rows = await DiscoverSearch.find({ workspaceId: oid(workspaceId) }, { query: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(30).lean();
  const seen = new Set<string>();
  return rows
    .map((r) => r.query as DiscoverQuery)
    .filter((q) => {
      const k = q.q.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}
