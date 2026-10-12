import "server-only";
import { connectDB } from "@/lib/db";
import { PostTarget, SocialAccount, oid } from "@/lib/models";
import type { PipelineStage } from "mongoose";
import { COMMUNITY_PLATFORMS } from "@/lib/platforms";

const COMMUNITY_IDS = COMMUNITY_PLATFORMS.map((p) => p.id);

/**
 * Everything the Communities page shows, in two round trips: the connected groups with
 * their own delivery stats and last message ($lookup sub-pipelines), and a $facet over
 * deliveries for totals, a 14-day series per platform and the recent message log.
 */
export async function getCommunityOverview(workspaceId: string, tz: string) {
  await connectDB();
  const ws = oid(workspaceId);
  const since30 = new Date(Date.now() - 30 * 86400_000);
  const since14 = new Date(Date.now() - 14 * 86400_000);
  const now = new Date();
  // Shared tail for both halves of the message log.
  const logRow: PipelineStage.FacetPipelineStage[] = [
    { $lookup: { from: "posts", localField: "postId", foreignField: "_id", as: "post", pipeline: [{ $project: { baseCaption: 1, title: 1, poll: 1, status: 1, scheduledAt: 1 } }] } },
    { $lookup: { from: "socialaccounts", localField: "socialAccountId", foreignField: "_id", as: "account", pipeline: [{ $project: { handle: 1, sandbox: 1 } }] } },
    { $unwind: "$post" },
    { $unwind: "$account" },
    {
      $project: {
        platform: 1,
        postType: 1,
        status: 1,
        permalink: 1,
        publishedAt: 1,
        scheduledAt: "$post.scheduledAt",
        postId: 1,
        text: { $ifNull: ["$captionOverride", "$post.baseCaption"] },
        pollQuestion: "$post.poll.question",
        handle: "$account.handle",
        sandbox: "$account.sandbox",
        edits: { $size: { $ifNull: ["$liveEdits", []] } },
        lastErrorMessage: 1,
      },
    },
  ];

  const [groups, [facets]] = await Promise.all([
    SocialAccount.aggregate([
      { $match: { workspaceId: ws, platform: { $in: COMMUNITY_IDS }, status: { $ne: "revoked" } } },
      {
        $lookup: {
          from: "posttargets",
          localField: "_id",
          foreignField: "socialAccountId",
          as: "stats",
          pipeline: [
            {
              $group: {
                _id: null,
                sent30: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "published"] }, { $gte: ["$publishedAt", since30] }] }, 1, 0] } },
                scheduled: { $sum: { $cond: [{ $in: ["$status", ["scheduled", "retrying", "queued"]] }, 1, 0] } },
                attention: { $sum: { $cond: [{ $in: ["$status", ["failed", "needs_action"]] }, 1, 0] } },
                polls: { $sum: { $cond: [{ $eq: ["$postType", "poll"] }, 1, 0] } },
                last: { $max: "$publishedAt" },
              },
            },
          ],
        },
      },
      {
        $lookup: {
          from: "posttargets",
          localField: "_id",
          foreignField: "socialAccountId",
          as: "lastMsg",
          pipeline: [
            { $match: { status: "published" } },
            { $sort: { publishedAt: -1 } },
            { $limit: 1 },
            { $lookup: { from: "posts", localField: "postId", foreignField: "_id", as: "post", pipeline: [{ $project: { baseCaption: 1, poll: 1 } }] } },
            { $project: { text: { $ifNull: ["$captionOverride", { $first: "$post.baseCaption" }] }, poll: { $first: "$post.poll.question" }, postType: 1, permalink: 1, postId: 1 } },
          ],
        },
      },
      { $addFields: { s: { $ifNull: [{ $first: "$stats" }, {}] }, lastMsg: { $first: "$lastMsg" } } },
      { $sort: { "s.last": -1, platform: 1, handle: 1 } },
    ]),
    PostTarget.aggregate([
      { $match: { workspaceId: ws, platform: { $in: COMMUNITY_IDS } } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                sent30: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "published"] }, { $gte: ["$publishedAt", since30] }] }, 1, 0] } },
                scheduled: { $sum: { $cond: [{ $in: ["$status", ["scheduled", "retrying", "queued"]] }, 1, 0] } },
                attention: { $sum: { $cond: [{ $in: ["$status", ["failed", "needs_action"]] }, 1, 0] } },
                edited: { $sum: { $size: { $ifNull: ["$liveEdits", []] } } },
              },
            },
          ],
          daily: [
            { $match: { publishedAt: { $gte: since14 } } },
            { $group: { _id: { day: { $dateToString: { date: "$publishedAt", format: "%Y-%m-%d", timezone: tz } }, platform: "$platform" }, n: { $sum: 1 } } },
            { $group: { _id: "$_id.day", total: { $sum: "$n" }, byPlatform: { $push: { k: "$_id.platform", v: "$n" } } } },
            { $project: { _id: 0, day: "$_id", total: 1, byPlatform: { $arrayToObject: "$byPlatform" } } },
          ],
          // The next few scheduled messages, soonest first…
          upcoming: [
            { $match: { publishedAt: null, status: { $in: ["scheduled", "queued"] }, nextAttemptAt: { $gt: now, $lt: new Date(8e15) } } },
            { $sort: { nextAttemptAt: 1 } },
            { $limit: 5 },
            ...logRow,
          ],
          // …then what already went out or needs a look, newest first.
          recent: [
            { $match: { status: { $nin: ["cancelled", "scheduled", "queued"] } } },
            { $addFields: { sortAt: { $ifNull: ["$publishedAt", "$updatedAt"] } } },
            { $sort: { sortAt: -1 } },
            { $limit: 25 },
            ...logRow,
          ],
        },
      },
    ]),
  ]);

  const map = new Map(((facets?.daily ?? []) as { day: string; total: number; byPlatform: Record<string, number> }[]).map((r) => [r.day, r]));
  const daily = Array.from({ length: 14 }, (_, n) => {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - (13 - n) * 86400_000));
    return map.get(key) ?? { day: key, total: 0, byPlatform: {} };
  });

  return {
    groups: groups.map((g) => ({
      id: String(g._id),
      platform: g.platform as string,
      handle: g.handle as string,
      displayName: (g.displayName as string) ?? null,
      accountType: (g.accountType as string) ?? null,
      profileUrl: (g.profileUrl as string) ?? null,
      audienceSize: (g.audienceSize as number) ?? null,
      sandbox: Boolean(g.sandbox),
      status: g.status as string,
      assisted: g.connector?.mode === "assisted",
      sent30: g.s.sent30 ?? 0,
      scheduled: g.s.scheduled ?? 0,
      attention: g.s.attention ?? 0,
      lastAt: g.s.last ? new Date(g.s.last).toISOString() : null,
      lastText: (g.lastMsg?.postType === "poll" ? `Poll: ${g.lastMsg?.poll ?? ""}` : g.lastMsg?.text) ?? null,
      lastPostId: g.lastMsg?.postId ? String(g.lastMsg.postId) : null,
    })),
    totals: { sent30: 0, scheduled: 0, attention: 0, edited: 0, ...(facets?.totals?.[0] ?? {}) } as { sent30: number; scheduled: number; attention: number; edited: number },
    daily,
    recent: ([...(facets?.upcoming ?? []), ...(facets?.recent ?? [])] as Record<string, unknown>[]).map((r) => ({
      id: String(r._id),
      postId: String(r.postId),
      platform: r.platform as string,
      postType: r.postType as string,
      status: r.status as string,
      permalink: (r.permalink as string) ?? null,
      at: r.publishedAt ? new Date(r.publishedAt as Date).toISOString() : r.scheduledAt ? new Date(r.scheduledAt as Date).toISOString() : null,
      text: (r.text as string) ?? "",
      pollQuestion: (r.pollQuestion as string) ?? null,
      handle: r.handle as string,
      sandbox: Boolean(r.sandbox),
      edits: (r.edits as number) ?? 0,
      error: (r.lastErrorMessage as string) ?? null,
    })),
  };
}
