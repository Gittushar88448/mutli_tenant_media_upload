import "server-only";
import { connectDB } from "@/lib/db";
import { MediaAsset, Post, PostTarget, SocialAccount, oid } from "@/lib/models";

/** Everything the workspace dashboard needs, in two aggregations. */
export async function getWorkspaceOverview(workspaceId: string, tz: string) {
  await connectDB();
  const ws = oid(workspaceId);
  const since = new Date(Date.now() - 13 * 24 * 3600 * 1000);
  since.setUTCHours(0, 0, 0, 0);

  const [targets] = await PostTarget.aggregate([
    { $match: { workspaceId: ws } },
    {
      $facet: {
        status: [{ $group: { _id: "$status", n: { $sum: 1 } } }],
        platforms: [
          {
            $group: {
              _id: "$platform",
              total: { $sum: 1 },
              published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $in: ["$status", ["failed", "needs_action"]] }, 1, 0] } },
              avgAttempts: { $avg: { $cond: [{ $eq: ["$status", "published"] }, "$attempts", null] } },
            },
          },
          {
            $addFields: {
              successRate: {
                $cond: [{ $gt: [{ $add: ["$published", "$failed"] }, 0] }, { $divide: ["$published", { $add: ["$published", "$failed"] }] }, null],
              },
            },
          },
          { $sort: { total: -1 } },
        ],
        daily: [
          { $match: { publishedAt: { $gte: since } } },
          {
            $group: {
              _id: { day: { $dateToString: { date: "$publishedAt", format: "%Y-%m-%d", timezone: tz } }, platform: "$platform" },
              n: { $sum: 1 },
            },
          },
          { $group: { _id: "$_id.day", total: { $sum: "$n" }, byPlatform: { $push: { k: "$_id.platform", v: "$n" } } } },
          { $project: { _id: 0, day: "$_id", total: 1, byPlatform: { $arrayToObject: "$byPlatform" } } },
          { $sort: { day: 1 } },
        ],
        // When posts actually go out: weekday x hour in the workspace's timezone.
        heatmap: [
          { $match: { publishedAt: { $ne: null } } },
          {
            $group: {
              _id: { d: { $isoDayOfWeek: { date: "$publishedAt", timezone: tz } }, h: { $hour: { date: "$publishedAt", timezone: tz } } },
              n: { $sum: 1 },
            },
          },
          { $project: { _id: 0, d: "$_id.d", h: "$_id.h", n: 1 } },
        ],
        attention: [
          { $match: { status: { $in: ["failed", "needs_action"] } } },
          { $sort: { updatedAt: -1 } },
          { $limit: 5 },
          { $lookup: { from: "socialaccounts", localField: "socialAccountId", foreignField: "_id", as: "account", pipeline: [{ $project: { handle: 1 } }] } },
          { $project: { postId: 1, platform: 1, status: 1, lastErrorCode: 1, lastErrorMessage: 1, updatedAt: 1, handle: { $first: "$account.handle" } } },
        ],
      },
    },
  ]);

  const upcoming = await Post.aggregate([
    { $match: { workspaceId: ws, status: { $in: ["scheduled", "pending_approval"] }, scheduledAt: { $gte: new Date() } } },
    { $sort: { scheduledAt: 1 } },
    { $limit: 6 },
    { $lookup: { from: "posttargets", localField: "_id", foreignField: "postId", as: "targets", pipeline: [{ $project: { platform: 1 } }] } },
    { $lookup: { from: "mediaassets", localField: "media.0.assetId", foreignField: "_id", as: "cover", pipeline: [{ $project: { kind: 1 } }] } },
    {
      $project: {
        baseCaption: 1,
        title: 1,
        scheduledAt: 1,
        status: 1,
        platforms: { $setUnion: ["$targets.platform", []] },
        coverId: { $first: "$cover._id" },
        coverKind: { $first: "$cover.kind" },
      },
    },
  ]);

  const [counts] = await Promise.all([
    Promise.all([
      SocialAccount.countDocuments({ workspaceId: ws, status: "active" }),
      SocialAccount.countDocuments({ workspaceId: ws, status: "needs_reauth" }),
      MediaAsset.aggregate([{ $match: { workspaceId: ws } }, { $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: "$sizeBytes" } } }]),
      Post.countDocuments({ workspaceId: ws, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } }),
    ]),
  ]);

  return {
    status: Object.fromEntries((targets?.status ?? []).map((s: { _id: string; n: number }) => [s._id, s.n])) as Record<string, number>,
    platforms: (targets?.platforms ?? []) as { _id: string; total: number; published: number; failed: number; successRate: number | null; avgAttempts: number | null }[],
    daily: fillDays((targets?.daily ?? []) as { day: string; total: number; byPlatform: Record<string, number> }[], tz),
    heatmap: (targets?.heatmap ?? []) as { d: number; h: number; n: number }[],
    attention: (targets?.attention ?? []) as { _id: unknown; postId: unknown; platform: string; status: string; lastErrorCode?: string; lastErrorMessage?: string; handle?: string; updatedAt: Date }[],
    upcoming: upcoming as { _id: unknown; baseCaption: string; title?: string; scheduledAt: Date; status: string; platforms: string[]; coverId?: unknown; coverKind?: string }[],
    accounts: { active: counts[0], needsReauth: counts[1] },
    media: { count: counts[2][0]?.n ?? 0, bytes: counts[2][0]?.bytes ?? 0 },
    postsLast30: counts[3],
  };
}

function fillDays(rows: { day: string; total: number; byPlatform: Record<string, number> }[], tz: string) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: { day: string; total: number; byPlatform: Record<string, number> }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    out.push(map.get(key) ?? { day: key, total: 0, byPlatform: {} });
  }
  return out;
}

export type PostListTab = "upcoming" | "published" | "failed" | "drafts" | "all";

/** Posts list with their targets folded in, so one row shows every destination's state. */
export async function listWorkspacePosts(workspaceId: string, tab: PostListTab, q: string) {
  await connectDB();
  const match: Record<string, unknown> = { workspaceId: oid(workspaceId) };
  if (tab === "upcoming") match.status = { $in: ["scheduled", "publishing", "pending_approval"] };
  if (tab === "published") match.status = { $in: ["done", "partially_failed"] };
  if (tab === "failed") match.status = { $in: ["failed", "partially_failed"] };
  if (tab === "drafts") match.status = "draft";
  if (q) match.baseCaption = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  return Post.aggregate([
    { $match: match },
    { $sort: tab === "upcoming" ? { scheduledAt: 1 } : { updatedAt: -1 } },
    { $limit: 200 },
    {
      $lookup: {
        from: "posttargets",
        localField: "_id",
        foreignField: "postId",
        as: "targets",
        pipeline: [
          { $lookup: { from: "socialaccounts", localField: "socialAccountId", foreignField: "_id", as: "acc", pipeline: [{ $project: { handle: 1 } }] } },
          { $project: { platform: 1, status: 1, permalink: 1, handle: { $first: "$acc.handle" }, lastErrorMessage: 1 } },
        ],
      },
    },
    { $lookup: { from: "users", localField: "authorId", foreignField: "_id", as: "author", pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: "mediaassets", localField: "media.0.assetId", foreignField: "_id", as: "cover", pipeline: [{ $project: { kind: 1 } }] } },
    {
      $project: {
        title: 1,
        baseCaption: 1,
        status: 1,
        scheduledAt: 1,
        updatedAt: 1,
        approval: 1,
        targets: 1,
        mediaCount: { $size: { $ifNull: ["$media", []] } },
        author: { $first: "$author.name" },
        coverId: { $first: "$cover._id" },
        coverKind: { $first: "$cover.kind" },
      },
    },
  ]);
}

/** Calendar month: posts bucketed by local day, with platforms per post. */
export async function getCalendarMonth(workspaceId: string, from: Date, to: Date, tz: string) {
  await connectDB();
  return Post.aggregate<{ _id: string; posts: { id: unknown; at: Date; caption: string; status: string; platforms: string[] }[] }>([
    { $match: { workspaceId: oid(workspaceId), scheduledAt: { $gte: from, $lt: to }, status: { $ne: "cancelled" } } },
    { $lookup: { from: "posttargets", localField: "_id", foreignField: "postId", as: "t", pipeline: [{ $project: { platform: 1 } }] } },
    { $sort: { scheduledAt: 1 } },
    {
      $group: {
        _id: { $dateToString: { date: "$scheduledAt", format: "%Y-%m-%d", timezone: tz } },
        posts: { $push: { id: "$_id", at: "$scheduledAt", caption: { $ifNull: ["$title", "$baseCaption"] }, status: "$status", platforms: { $setUnion: ["$t.platform", []] } } },
      },
    },
  ]);
}

export async function getPostDetail(workspaceId: string, postId: string) {
  await connectDB();
  const [post] = await Post.aggregate([
    { $match: { _id: oid(postId), workspaceId: oid(workspaceId) } },
    { $lookup: { from: "users", localField: "authorId", foreignField: "_id", as: "author", pipeline: [{ $project: { name: 1, email: 1 } }] } },
    {
      $lookup: {
        from: "mediaassets",
        localField: "media.assetId",
        foreignField: "_id",
        as: "assets",
        pipeline: [{ $project: { kind: 1, filename: 1, width: 1, height: 1, durationMs: 1, mime: 1 } }],
      },
    },
    {
      $lookup: {
        from: "posttargets",
        localField: "_id",
        foreignField: "postId",
        as: "targets",
        pipeline: [
          { $lookup: { from: "socialaccounts", localField: "socialAccountId", foreignField: "_id", as: "account", pipeline: [{ $project: { handle: 1, displayName: 1, sandbox: 1 } }] } },
          { $unwind: "$account" },
          {
            $lookup: {
              from: "publishattempts",
              localField: "_id",
              foreignField: "postTargetId",
              as: "attemptsLog",
              pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 20 }, { $project: { step: 1, errorCode: 1, message: 1, httpStatus: 1, createdAt: 1 } }],
            },
          },
        ],
      },
    },
    { $addFields: { author: { $first: "$author" } } },
  ]);
  return post ?? null;
}
