import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  AppSettings,
  Notification,
  Post,
  PostTarget,
  PublishAttempt,
  SocialAccount,
  Membership,
  oid,
  type TargetStatus,
} from "@/lib/models";

/**
 * The publishing state machine from the architecture doc:
 *   scheduled → queued → preparing → uploading → processing → published
 * with exits retrying, needs_action and failed. MongoDB is the schedule; n8n only ever
 * sees targets this module hands it through claimDueTargets().
 */

export const ACTIVE_STATES: TargetStatus[] = ["queued", "preparing", "uploading", "processing"];
export const DUE_STATES: TargetStatus[] = ["scheduled", "retrying"];
const BACKOFF_MINUTES = [1, 4, 15, 60];
export const MAX_ATTEMPTS = 5;

/** Per-account daily publish caps (approximate platform limits). */
const DAILY_CAP: Record<string, number> = {
  instagram: 100,
  threads: 250,
  youtube: 6, // shared quota; raised once Google grants more units
  tiktok: 15,
  facebook: 200,
  linkedin: 100,
  x: 100,
  pinterest: 100,
  webhook: 10_000,
  manual: 10_000,
};
const PER_WORKSPACE_CONCURRENCY = 10;

export type ClaimedTarget = {
  id: string;
  postId: string;
  workspaceId: string;
  platform: string;
  postType: string;
  caption: string;
  options: Record<string, unknown>;
  account: { id: string; handle: string; externalId: string; sandbox: boolean; accountType?: string };
  attempt: number;
  resume: { platformContainerId?: string; uploadSessionUrl?: string };
};

/**
 * Picks due targets fairly and marks them queued. MongoDB has no SKIP LOCKED, so the
 * aggregation proposes candidates and each one is then taken with an atomic
 * findOneAndUpdate guarded on its current status: two n8n dispatchers can never claim
 * the same target.
 */
export async function claimDueTargets(opts: { limit?: number; workerId?: string; onlyIds?: string[] } = {}) {
  await connectDB();
  const now = new Date();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);

  await sweepStuckTargets();
  // Admin maintenance flag pauses all publishing; due targets simply wait.
  const settings = await AppSettings.findOne({ key: "global" }, { maintenanceMode: 1 }).lean();
  if (settings?.maintenanceMode) return [];

  const match: Record<string, unknown> = { status: { $in: DUE_STATES }, nextAttemptAt: { $lte: now } };
  if (opts.onlyIds?.length) {
    match._id = { $in: opts.onlyIds.filter((x) => Types.ObjectId.isValid(x)).map((x) => oid(x)) };
  }

  const candidates = await PostTarget.aggregate<{ _id: Types.ObjectId }>([
    { $match: match },
    { $sort: { nextAttemptAt: 1 } },
    { $limit: limit * 10 },
    // Only posts that are actually live (not drafts, cancelled or awaiting approval).
    {
      $lookup: {
        from: "posts",
        localField: "postId",
        foreignField: "_id",
        pipeline: [{ $project: { status: 1 } }],
        as: "post",
      },
    },
    { $match: { "post.status": { $in: ["scheduled", "publishing", "partially_failed"] } } },
    // Only healthy accounts.
    {
      $lookup: {
        from: "socialaccounts",
        localField: "socialAccountId",
        foreignField: "_id",
        pipeline: [{ $project: { status: 1 } }],
        as: "account",
      },
    },
    { $match: { "account.status": "active" } },
    // Rate limit: how many targets this account published in the last 24 hours.
    {
      $lookup: {
        from: "posttargets",
        let: { acc: "$socialAccountId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$socialAccountId", "$$acc"] }, publishedAt: { $gte: dayAgo } } },
          { $count: "n" },
        ],
        as: "recent",
      },
    },
    { $addFields: { publishedToday: { $ifNull: [{ $first: "$recent.n" }, 0] } } },
    {
      $match: {
        $expr: {
          $lt: [
            "$publishedToday",
            { $switch: { branches: Object.entries(DAILY_CAP).map(([p, cap]) => ({ case: { $eq: ["$platform", p] }, then: cap })), default: 100 } },
          ],
        },
      },
    },
    // Fairness: at most N per workspace per tick, so one agency's 500 posts at 9:00 don't starve everyone else.
    { $group: { _id: "$workspaceId", items: { $push: { _id: "$_id", at: "$nextAttemptAt" } } } },
    { $project: { items: { $slice: ["$items", PER_WORKSPACE_CONCURRENCY] } } },
    { $unwind: "$items" },
    { $replaceRoot: { newRoot: "$items" } },
    { $sort: { at: 1 } },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]);

  const claimed: ClaimedTarget[] = [];
  for (const c of candidates) {
    const t = await PostTarget.findOneAndUpdate(
      { _id: c._id, status: { $in: DUE_STATES } },
      { $set: { status: "queued", claimedAt: now, claimedBy: opts.workerId ?? "n8n" }, $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    if (!t) continue;
    await Post.updateOne({ _id: t.postId, status: "scheduled" }, { $set: { status: "publishing" } });
    claimed.push(await describeTarget(t._id));
  }
  return claimed;
}

export async function describeTarget(id: Types.ObjectId | string): Promise<ClaimedTarget> {
  const [row] = await PostTarget.aggregate([
    { $match: { _id: oid(id) } },
    { $lookup: { from: "posts", localField: "postId", foreignField: "_id", as: "post" } },
    { $unwind: "$post" },
    { $lookup: { from: "socialaccounts", localField: "socialAccountId", foreignField: "_id", as: "account" } },
    { $unwind: "$account" },
  ]);
  if (!row) throw new Error("target not found");
  return {
    id: String(row._id),
    postId: String(row.postId),
    workspaceId: String(row.workspaceId),
    platform: row.platform,
    postType: row.postType,
    caption: (row.captionOverride ?? "").trim() || row.post.baseCaption || "",
    options: row.options ?? {},
    account: {
      id: String(row.account._id),
      handle: row.account.handle,
      externalId: row.account.externalId,
      sandbox: Boolean(row.account.sandbox),
      accountType: row.account.accountType,
    },
    attempt: row.attempts,
    resume: { platformContainerId: row.platformContainerId, uploadSessionUrl: row.uploadSessionUrl },
  };
}

/** Watchdog: anything stuck mid-flight for 30 minutes goes back to retrying. */
export async function sweepStuckTargets() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  await PostTarget.updateMany(
    { status: { $in: ACTIVE_STATES }, updatedAt: { $lt: cutoff } },
    { $set: { status: "retrying", nextAttemptAt: new Date(), lastErrorCode: "WATCHDOG_TIMEOUT" } }
  );
}

export type TargetEvent = {
  step: "preparing" | "uploading" | "processing" | "published" | "failed" | "retrying" | "needs_action";
  executionId?: string;
  platformContainerId?: string;
  uploadSessionUrl?: string;
  platformPostId?: string;
  permalink?: string;
  errorCode?: string;
  message?: string;
  httpStatus?: number;
  retryable?: boolean;
  authError?: boolean;
  responseExcerpt?: string;
};

/** Applies one step reported by n8n (or the dev simulator). Idempotent for repeated "published". */
export async function recordTargetEvent(targetId: string, ev: TargetEvent) {
  await connectDB();
  const target = await PostTarget.findById(targetId);
  if (!target) return { ok: false as const, error: "not_found" };
  if (target.status === "published" || target.status === "cancelled") {
    return { ok: true as const, status: target.status, ignored: true };
  }

  await PublishAttempt.create({
    workspaceId: target.workspaceId,
    postTargetId: target._id,
    step: ev.step,
    status: ev.step,
    executionId: ev.executionId,
    httpStatus: ev.httpStatus,
    errorCode: ev.errorCode,
    message: ev.message,
    responseExcerpt: ev.responseExcerpt?.slice(0, 2000),
    finishedAt: new Date(),
  });

  if (ev.platformContainerId) target.platformContainerId = ev.platformContainerId;
  if (ev.uploadSessionUrl) target.uploadSessionUrl = ev.uploadSessionUrl;

  switch (ev.step) {
    case "preparing":
    case "uploading":
    case "processing":
      target.status = ev.step;
      break;
    case "published":
      target.status = "published";
      target.platformPostId = ev.platformPostId;
      target.permalink = ev.permalink;
      target.publishedAt = new Date();
      target.lastErrorCode = undefined;
      target.lastErrorMessage = undefined;
      break;
    case "needs_action":
      target.status = "needs_action";
      target.lastErrorCode = ev.errorCode ?? "NEEDS_ACTION";
      target.lastErrorMessage = ev.message;
      break;
    case "retrying":
    case "failed": {
      target.lastErrorCode = ev.errorCode ?? "UNKNOWN";
      target.lastErrorMessage = ev.message;
      if (ev.authError) {
        target.status = "needs_action";
        await SocialAccount.updateOne({ _id: target.socialAccountId }, { $set: { status: "needs_reauth" } });
      } else if (ev.step === "retrying" || (ev.retryable && target.attempts < MAX_ATTEMPTS)) {
        const minutes = BACKOFF_MINUTES[Math.min(target.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 60;
        const jitter = Math.random() * 0.25 * minutes;
        target.status = target.attempts >= MAX_ATTEMPTS ? "failed" : "retrying";
        target.nextAttemptAt = new Date(Date.now() + (minutes + jitter) * 60_000);
      } else {
        target.status = "failed";
      }
      break;
    }
  }
  await target.save();

  if (["published", "failed", "needs_action"].includes(target.status)) {
    const postStatus = await rollupPostStatus(String(target.postId));
    if (target.status !== "published") await notifyFailure(target, postStatus);
  }
  return { ok: true as const, status: target.status };
}

/**
 * Rolls target statuses up to the post: done, partially_failed, failed or still publishing.
 * One $group gives every count we need in a single round trip.
 */
export async function rollupPostStatus(postId: string) {
  const [agg] = await PostTarget.aggregate<{
    total: number;
    published: number;
    failed: number;
    cancelled: number;
    open: number;
  }>([
    { $match: { postId: oid(postId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ["$status", ["failed", "needs_action"]] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
      },
    },
    { $addFields: { open: { $subtract: ["$total", { $add: ["$published", "$failed", "$cancelled"] }] } } },
  ]);
  if (!agg) return null;

  let status: string;
  if (agg.cancelled === agg.total) status = "cancelled";
  else if (agg.open > 0) status = agg.published + agg.failed > 0 ? "publishing" : "scheduled";
  else if (agg.failed === 0) status = "done";
  else if (agg.published === 0) status = "failed";
  else status = "partially_failed";

  const post = await Post.findById(postId);
  if (post && !["draft", "pending_approval"].includes(post.status)) {
    // A post stays "scheduled" until its first target is claimed.
    if (!(status === "scheduled" && post.status === "scheduled")) {
      post.status = status as typeof post.status;
      await post.save();
    }
  }
  return status;
}

async function notifyFailure(target: InstanceType<typeof PostTarget>, postStatus: string | null) {
  const post = await Post.findById(target.postId).lean();
  if (!post) return;
  const managers = await Membership.find({ workspaceId: target.workspaceId, role: { $in: ["owner", "admin"] } }).lean();
  const recipients = new Set([String(post.authorId), ...managers.map((m) => String(m.userId))]);
  const label = target.status === "needs_action" ? "needs your attention" : "failed to publish";
  await Notification.insertMany(
    [...recipients].map((u) => ({
      workspaceId: target.workspaceId,
      userId: oid(u),
      kind: target.status === "needs_action" ? "needs_reauth" : "publish_failed",
      title: `${capitalize(target.platform)} post ${label}`,
      body: target.lastErrorMessage ?? target.lastErrorCode ?? postStatus ?? "",
      href: `/posts/${String(target.postId)}`,
    }))
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
