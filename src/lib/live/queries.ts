import "server-only";
import { connectDB } from "@/lib/db";
import { Post, PostTarget, SocialAccount, oid, type PostTargetDoc, type SocialAccountDoc } from "@/lib/models";
import { LiveSnapshot } from "@/lib/models/live";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { liveFor, mergeReplies, repliesFor } from "./index";
import { liveCaps, type LiveComment, type LiveMetrics, type LiveStatus } from "./types";

/** How many recent deliveries the Live view watches. Each is one or two platform calls. */
export const LIVE_WINDOW = 30;

export type LivePostRow = {
  id: string;
  postId: string;
  platform: string;
  account: { id: string; handle: string; sandbox: boolean };
  caption: string;
  publishedAt: string | null;
  permalink: string | null;
  status: LiveStatus;
  metrics: LiveMetrics;
  checkedAt: string | null;
  error: string | null;
  note: string | null;
};

export type LiveInboxRow = {
  targetId: string;
  platform: string;
  handle: string;
  caption: string;
  permalink: string | null;
  comment: LiveComment;
  canReply: boolean;
};

export type LiveChannelRow = {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  profileUrl: string | null;
  sandbox: boolean;
  status: string;
  needsReconnect: boolean;
  audienceSize: number | null;
  lastPostAt: string | null;
  published30: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastCheckedAt: string | null;
};

const excerpt = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const strip = (c: LiveComment): LiveComment => ({ ...c, ref: undefined, replies: c.replies?.map(strip) });

/**
 * Everything the Live view shows. Stale snapshots are refreshed within `budgetMs`; the
 * rest finish in the background (see `pending`) and show up on the next auto-refresh.
 */
export async function getLiveOverview(workspaceId: string, opts: { force?: boolean; budgetMs?: number } = {}) {
  await connectDB();
  const ws = oid(workspaceId);
  const since30 = new Date(Date.now() - 30 * 86400_000);

  const [targets, accounts] = await Promise.all([
    PostTarget.find({ workspaceId: ws, status: "published" })
      .sort({ publishedAt: -1 })
      .limit(LIVE_WINDOW)
      .select("workspaceId postId socialAccountId platform postType platformPostId permalink platformMessageIds publishedAt status captionOverride")
      .lean<(PostTargetDoc & { captionOverride?: string })[]>(),
    SocialAccount.find({ workspaceId: ws }).sort({ platform: 1, handle: 1 }).lean<SocialAccountDoc[]>(),
  ]);
  const accountMap = new Map(accounts.map((a) => [String(a._id), a]));
  const [posts, live, replies] = await Promise.all([
    Post.find({ _id: { $in: [...new Set(targets.map((t) => String(t.postId)))].map(oid) } }).select("title baseCaption poll").lean(),
    liveFor(targets, accountMap, opts),
    repliesFor(targets.map((t) => t._id)),
  ]);
  const postMap = new Map(posts.map((p) => [String(p._id), p]));

  const rows: LivePostRow[] = [];
  const inbox: LiveInboxRow[] = [];
  for (const t of targets) {
    const a = accountMap.get(String(t.socialAccountId));
    if (!a) continue;
    const p = postMap.get(String(t.postId));
    const caption = excerpt(((t.captionOverride ?? "").trim() || p?.baseCaption || p?.title || p?.poll?.question || "").replace(/\s+/g, " ").trim());
    const snap = live.snapshots.get(String(t._id));
    rows.push({
      id: String(t._id),
      postId: String(t.postId),
      platform: t.platform,
      account: { id: String(a._id), handle: a.handle, sandbox: Boolean(a.sandbox) },
      caption,
      publishedAt: t.publishedAt?.toISOString() ?? null,
      permalink: t.permalink ?? null,
      status: snap?.payload?.status ?? "unknown",
      metrics: snap?.payload?.metrics ?? {},
      checkedAt: snap?.fetchedAt.toISOString() ?? null,
      error: snap?.error ?? null,
      note: snap?.payload?.note ?? null,
    });
    const canReply = liveCaps(t.platform).reply && a.status === "active";
    for (const c of mergeReplies(snap?.payload?.comments ?? [], replies.get(String(t._id)))) {
      inbox.push({ targetId: String(t._id), platform: t.platform, handle: a.handle, caption, permalink: t.permalink ?? null, comment: strip(c), canReply });
    }
  }
  inbox.sort((x, y) => y.comment.at.localeCompare(x.comment.at));

  // Channel health: last delivery, last failure and the newest live-check error per account.
  const [lastPosts, lastFailures, lastChecks] = await Promise.all([
    PostTarget.aggregate<{ _id: unknown; lastAt: Date; n30: number }>([
      { $match: { workspaceId: ws, status: "published" } },
      { $group: { _id: "$socialAccountId", lastAt: { $max: "$publishedAt" }, n30: { $sum: { $cond: [{ $gte: ["$publishedAt", since30] }, 1, 0] } } } },
    ]),
    PostTarget.aggregate<{ _id: unknown; message: string; at: Date }>([
      { $match: { workspaceId: ws, status: { $in: ["failed", "needs_action"] }, lastErrorMessage: { $exists: true, $ne: null } } },
      { $sort: { updatedAt: -1 } },
      { $group: { _id: "$socialAccountId", message: { $first: "$lastErrorMessage" }, at: { $first: "$updatedAt" } } },
    ]),
    LiveSnapshot.aggregate<{ _id: unknown; at: Date; error: string | null; authError: boolean | null; errorAt: Date | null }>([
      { $match: { workspaceId: ws } },
      { $sort: { fetchedAt: -1 } },
      { $group: { _id: "$socialAccountId", at: { $first: "$fetchedAt" }, error: { $first: "$error" }, authError: { $first: "$authError" }, errorAt: { $first: "$fetchedAt" } } },
    ]),
  ]);
  const byId = <T extends { _id: unknown }>(xs: T[]) => new Map(xs.map((x) => [String(x._id), x]));
  const lp = byId(lastPosts);
  const lf = byId(lastFailures);
  const lc = byId(lastChecks);

  const channels: LiveChannelRow[] = accounts.map((a) => {
    const id = String(a._id);
    const check = lc.get(id);
    const fail = lf.get(id);
    // Prefer whichever problem is newer: a failed delivery or a failed live check.
    const checkErr = check?.error ? { message: check.error, at: check.errorAt! } : null;
    const err = checkErr && (!fail || checkErr.at > fail.at) ? checkErr : fail ? { message: fail.message, at: fail.at } : null;
    return {
      id,
      platform: a.platform,
      handle: a.handle,
      displayName: a.displayName ?? null,
      profileUrl: a.profileUrl ?? null,
      sandbox: Boolean(a.sandbox),
      status: a.status ?? "active",
      needsReconnect: a.status === "needs_reauth" || a.status === "revoked" || Boolean(check?.authError),
      audienceSize: a.audienceSize ?? null,
      lastPostAt: lp.get(id)?.lastAt?.toISOString() ?? null,
      published30: lp.get(id)?.n30 ?? 0,
      lastError: err?.message ?? null,
      lastErrorAt: err?.at?.toISOString() ?? null,
      lastCheckedAt: check?.at?.toISOString() ?? a.lastHealthCheckAt?.toISOString() ?? null,
    };
  });

  const platforms = [...new Set([...rows.map((r) => r.platform), ...channels.map((c) => c.platform)])].sort((x, y) =>
    (PLATFORMS[x as TargetPlatform]?.name ?? x).localeCompare(PLATFORMS[y as TargetPlatform]?.name ?? y)
  );
  return { posts: rows, inbox: inbox.slice(0, 150), channels, platforms, pending: live.pending, refreshed: live.refreshed };
}

export type LiveOverview = Omit<Awaited<ReturnType<typeof getLiveOverview>>, "pending">;
