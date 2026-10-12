"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { MediaAsset, Membership, Notification, PLAN_LIMITS, Post, PostTarget, SocialAccount, oid, isOid } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { validateTargets } from "@/lib/publishing/validate";
import { recordTargetEvent, rollupPostStatus } from "@/lib/publishing/engine";
import { demoMode, n8nConfigured, triggerN8nPublishNow } from "@/lib/publishing/n8n";
import { runSimulatedDispatch } from "@/lib/publishing/simulator";
import { audit } from "@/lib/audit";
import { ALL_TARGET_PLATFORMS, PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { planFeatures, planFor, PLAN_INFO, type Feature } from "@/lib/plans";
import { editLive } from "@/lib/publishing/direct";
import { ensureRendered, effectiveSpec, isNoopSpec, type EditSpec } from "@/lib/media/render";

const EditSpecSchema = z.object({
  crop: z.enum(["original", "9:16", "4:5", "1:1", "16:9"]).optional(),
  audioTrackId: z.string().optional(),
  audioVolume: z.number().min(0).max(2).optional(),
  keepOriginalAudio: z.boolean().optional(),
  trimStartMs: z.number().min(0).optional(),
  trimEndMs: z.number().min(0).optional(),
});

const PollSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(10),
  allowMultiple: z.boolean().optional(),
  durationHours: z.number().int().min(1).max(768).optional(),
});

const PayloadSchema = z.object({
  postId: z.string().optional(),
  mode: z.enum(["draft", "schedule", "now"]),
  title: z.string().max(140).optional(),
  caption: z.string().max(100_000),
  scheduledAt: z.iso.datetime().optional(),
  media: z
    .array(
      z.object({
        assetId: z.string(),
        audioTrackId: z.string().optional(),
        editSpec: z
          .object({
            crop: z.enum(["original", "9:16", "4:5", "1:1", "16:9"]).optional(),
            audioVolume: z.number().min(0).max(2).optional(),
            audioOffsetMs: z.number().min(0).optional(),
            keepOriginalAudio: z.boolean().optional(),
            trimStartMs: z.number().min(0).optional(),
            trimEndMs: z.number().min(0).optional(),
          })
          .optional(),
      })
    )
    .max(35),
  targets: z
    .array(
      z.object({
        accountId: z.string(),
        platform: z.enum(ALL_TARGET_PLATFORMS as [string, ...string[]]),
        postType: z.string().max(30),
        captionOverride: z.string().max(100_000).optional(),
        options: z.record(z.string(), z.unknown()).optional(),
        editSpec: EditSpecSchema.optional(),
      })
    )
    .max(100),
  poll: PollSchema.optional(),
});

export type ComposePayload = z.infer<typeof PayloadSchema>;
export type ComposeResult = { ok: true; postId: string; status: string; message: string } | { ok: false; error: string; targetErrors?: Record<string, string[]>; upgrade?: string };

function locked(feature: Feature) {
  const plan = planFor(feature);
  return { ok: false as const, error: `That needs the ${PLAN_INFO[plan].name} plan or above.`, upgrade: plan };
}

/** True when channels in this post carry different text (an own caption, or headlines that differ). */
function usesChannelText(targets: { captionOverride?: string; options?: Record<string, unknown> }[]) {
  if (targets.some((t) => t.captionOverride?.trim())) return true;
  return new Set(targets.map((t) => String(t.options?.headline ?? "").trim())).size > 1;
}

const hasSpec = (s?: EditSpec | null) => !!s && !isNoopSpec(s);

export async function savePostAction(payload: ComposePayload): Promise<ComposeResult> {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "editor")) return { ok: false, error: "Your role in this workspace can't create posts." };
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Some fields are invalid. Reload and try again." };
  const p = parsed.data;
  const features = planFeatures(ctx.workspace.plan);
  if (!features.channelCaptions && usesChannelText(p.targets)) return locked("channelCaptions");
  if (!features.channelVideoEdits && p.targets.some((t) => hasSpec(t.editSpec))) return locked("channelVideoEdits");
  if (!features.polls && p.targets.some((t) => t.postType === "poll")) return locked("polls");
  await connectDB();
  const ws = oid(ctx.workspace.id);

  // Everything referenced must belong to this workspace.
  const accountIds = [...new Set(p.targets.map((t) => t.accountId))].filter(isOid);
  const accounts = await SocialAccount.find({ _id: { $in: accountIds.map(oid) }, workspaceId: ws }).lean();
  const assetIds = [
    ...new Set([...p.media.flatMap((m) => [m.assetId, m.audioTrackId]), ...p.targets.map((t) => t.editSpec?.audioTrackId)].filter((x): x is string => !!x && isOid(x))),
  ];
  const assets = await MediaAsset.find({ _id: { $in: assetIds.map(oid) }, workspaceId: ws }).lean();
  if (accounts.length !== accountIds.length || assets.length !== assetIds.length) return { ok: false, error: "A channel or file no longer exists. Reload and try again." };

  if (p.mode !== "draft") {
    if (p.targets.length === 0) return { ok: false, error: "Pick at least one channel." };
    const inactive = accounts.filter((a) => a.status !== "active");
    if (inactive.length) return { ok: false, error: `${inactive.map((a) => a.handle).join(", ")} ${inactive.length > 1 ? "are" : "is"} not active. Reconnect or deselect.` };
    const byId = new Map(assets.map((a) => [String(a._id), a]));
    const v = validateTargets({
      caption: p.caption,
      media: p.media.map((m) => byId.get(m.assetId)!).map((a) => ({ kind: a.kind as "image" | "video", durationMs: a.durationMs, width: a.width, height: a.height })),
      targets: p.targets.map((t) => ({ key: t.accountId, platform: t.platform as never, postType: t.postType, captionOverride: t.captionOverride, options: t.options, editSpec: hasSpec(t.editSpec) ? t.editSpec : p.media[0]?.editSpec })),
      poll: p.poll,
    });
    if (!v.ok) return { ok: false, error: "Some channels need changes before this can go out.", targetErrors: v.errors };
    if (p.mode === "schedule") {
      if (!p.scheduledAt) return { ok: false, error: "Pick a date and time." };
      if (new Date(p.scheduledAt).getTime() < Date.now() - 60_000) return { ok: false, error: "That time is in the past." };
    }
    // Plan limit: posts per month.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const limit = PLAN_LIMITS[ctx.workspace.plan as keyof typeof PLAN_LIMITS]?.postsPerMonth ?? 30;
    const used = await Post.countDocuments({ workspaceId: ws, createdAt: { $gte: monthStart }, status: { $ne: "draft" }, ...(p.postId && isOid(p.postId) ? { _id: { $ne: oid(p.postId) } } : {}) });
    if (used >= limit) return { ok: false, error: `You've used all ${limit} posts in your plan this month.` };
  }

  // Load or create the post. Only posts that haven't started publishing can be edited.
  let post = p.postId && isOid(p.postId) ? await Post.findOne({ _id: oid(p.postId), workspaceId: ws }) : null;
  if (post && !["draft", "scheduled", "pending_approval"].includes(post.status)) return { ok: false, error: "This post has already started publishing and can't be edited." };
  if (!post) post = new Post({ workspaceId: ws, authorId: oid(ctx.user.id) });

  const needsApproval = p.mode !== "draft" && ctx.workspace.requireApproval && !can(ctx.role, "approver");
  const when = p.mode === "now" ? new Date() : p.scheduledAt ? new Date(p.scheduledAt) : undefined;

  post.title = p.title || undefined;
  post.baseCaption = p.caption;
  post.media = p.media.map((m, i) => ({
    assetId: oid(m.assetId),
    position: i,
    audioTrackId: m.audioTrackId && isOid(m.audioTrackId) ? oid(m.audioTrackId) : undefined,
    editSpec: m.editSpec,
  })) as never;
  post.poll = (p.targets.some((t) => t.postType === "poll") && p.poll ? p.poll : undefined) as never;
  post.scheduledAt = when;
  post.timezone = ctx.workspace.timezone;
  post.status = p.mode === "draft" ? "draft" : needsApproval ? "pending_approval" : "scheduled";
  post.approval = { status: needsApproval ? "pending" : "not_required" } as never;
  post.targetCount = p.targets.length;
  await post.save();

  // Replace undelivered targets with the new selection.
  await PostTarget.deleteMany({ postId: post._id, status: { $in: ["scheduled", "cancelled"] } });
  if (p.targets.length) {
    await PostTarget.insertMany(
      p.targets.map((t) => ({
        workspaceId: ws,
        postId: post._id,
        socialAccountId: oid(t.accountId),
        platform: t.platform,
        postType: t.postType,
        captionOverride: t.captionOverride?.trim() || undefined,
        options: t.options ?? {},
        editSpec: hasSpec(t.editSpec) ? { ...t.editSpec, audioTrackId: t.editSpec?.audioTrackId && isOid(t.editSpec.audioTrackId) ? oid(t.editSpec.audioTrackId) : undefined } : undefined,
        status: "scheduled",
        nextAttemptAt: when ?? new Date(8.64e15),
      }))
    );
  }

  await audit({
    action: p.mode === "draft" ? "post.draft_saved" : p.mode === "now" ? "post.publish_now" : "post.scheduled",
    actor: ctx.user,
    workspaceId: ctx.workspace.id,
    entity: "post",
    entityId: String(post._id),
    meta: { targets: p.targets.length, scheduledAt: when },
  });

  if (needsApproval) {
    const approvers = await Membership.find({ workspaceId: ws, role: { $in: ["owner", "admin", "approver"] } }).lean();
    await Notification.insertMany(
      approvers.map((a) => ({
        workspaceId: ws,
        userId: a.userId,
        kind: "approval_requested",
        title: "A post is waiting for approval",
        body: `${ctx.user.name}: ${p.caption.slice(0, 90)}`,
        href: `/posts/${String(post._id)}`,
      }))
    );
  }

  let message = p.mode === "draft" ? "Draft saved" : needsApproval ? "Sent for approval" : p.mode === "now" ? "Publishing now" : "Scheduled";
  if (p.mode === "now" && !needsApproval) message = await kick(String(post._id));

  revalidatePath("/posts");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  return { ok: true, postId: String(post._id), status: post.status, message };
}

/** Starts delivery right away: n8n's webhook in production, the simulator in demo mode. */
async function kick(postId: string) {
  const ids = (await PostTarget.find({ postId: oid(postId), status: { $in: ["scheduled", "retrying"] } }, { _id: 1 }).lean()).map((t) => String(t._id));
  if (n8nConfigured()) {
    const r = await triggerN8nPublishNow(ids);
    return r.ok ? "Publishing now" : "Queued. n8n didn't answer, so it goes out on the next scheduler tick.";
  }
  if (demoMode()) {
    await runSimulatedDispatch(ids);
    return "Published through the sandbox simulator";
  }
  return "Queued for the next scheduler tick";
}

async function ownTarget(targetId: string) {
  const ctx = await getWorkspaceContext();
  if (!isOid(targetId)) throw new Error("bad id");
  const t = await PostTarget.findOne({ _id: oid(targetId), workspaceId: oid(ctx.workspace.id) });
  if (!t) throw new Error("not found");
  return { ctx, t };
}

export async function retryTargetAction(targetId: string) {
  const { ctx, t } = await ownTarget(targetId);
  if (!can(ctx.role, "editor") || !["failed", "needs_action"].includes(t.status)) return;
  t.status = "retrying";
  t.nextAttemptAt = new Date();
  t.attempts = Math.min(t.attempts, 3);
  await t.save();
  await Post.updateOne({ _id: t.postId, status: { $in: ["failed", "partially_failed", "done"] } }, { $set: { status: "publishing" } });
  await audit({ action: "target.retried", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post_target", entityId: targetId });
  await kick(String(t.postId));
  revalidatePath(`/posts/${String(t.postId)}`);
}

export async function markManualDoneAction(targetId: string, permalink?: string) {
  const { ctx, t } = await ownTarget(targetId);
  if (!can(ctx.role, "editor") || (t.platform !== "manual" && t.lastErrorCode !== "ASSISTED_POST_DUE")) return;
  await recordTargetEvent(targetId, { step: "published", permalink: permalink && /^https?:\/\//.test(permalink) ? permalink : undefined, platformPostId: "manual" });
  await audit({ action: "target.marked_done", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post_target", entityId: targetId });
  revalidatePath(`/posts/${String(t.postId)}`);
}

export async function cancelPostAction(postId: string) {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "editor") || !isOid(postId)) return;
  const post = await Post.findOne({ _id: oid(postId), workspaceId: oid(ctx.workspace.id) });
  if (!post) return;
  // Anything not yet uploading can be cancelled; in-flight deliveries finish.
  await PostTarget.updateMany({ postId: post._id, status: { $in: ["scheduled", "retrying", "queued", "preparing", "needs_action"] } }, { $set: { status: "cancelled" } });
  if (["draft", "scheduled", "pending_approval"].includes(post.status)) {
    post.status = "cancelled";
    await post.save();
  } else await rollupPostStatus(postId);
  await audit({ action: "post.cancelled", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post", entityId: postId });
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
}

export async function deletePostAction(postId: string) {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "editor") || !isOid(postId)) return;
  const post = await Post.findOne({ _id: oid(postId), workspaceId: oid(ctx.workspace.id), status: { $in: ["draft", "cancelled"] } });
  if (!post) return;
  await PostTarget.deleteMany({ postId: post._id });
  await post.deleteOne();
  await audit({ action: "post.deleted", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post", entityId: postId });
  revalidatePath("/posts");
}

export async function reviewPostAction(postId: string, decision: "approved" | "rejected", note?: string) {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "approver") || !isOid(postId)) return;
  const post = await Post.findOne({ _id: oid(postId), workspaceId: oid(ctx.workspace.id), status: "pending_approval" });
  if (!post) return;
  post.approval = { status: decision, by: oid(ctx.user.id), at: new Date(), note } as never;
  post.status = decision === "approved" ? "scheduled" : "draft";
  if (decision === "approved" && post.scheduledAt && post.scheduledAt < new Date()) post.scheduledAt = new Date();
  await post.save();
  if (decision === "approved") await PostTarget.updateMany({ postId: post._id, status: "scheduled" }, { $set: { nextAttemptAt: post.scheduledAt ?? new Date() } });
  await Notification.create({
    workspaceId: post.workspaceId,
    userId: post.authorId,
    kind: "system",
    title: decision === "approved" ? "Your post was approved" : "Your post was sent back",
    body: note || (decision === "approved" ? "It will go out as scheduled." : "It's back in drafts."),
    href: `/posts/${postId}`,
  });
  await audit({ action: `post.${decision}`, actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post", entityId: postId });
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/posts");
}

/* ---------- One channel at a time ---------- */

const TargetPatchSchema = z.object({
  postType: z.string().max(30).optional(),
  captionOverride: z.string().max(100_000).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  editSpec: EditSpecSchema.nullable().optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
});
export type TargetPatch = z.infer<typeof TargetPatchSchema>;

const EDITABLE_TARGET = ["scheduled", "retrying", "failed", "needs_action", "cancelled"];

/**
 * Changes one channel of a post without touching the others, even after some of them
 * went live. A failed or cancelled channel is re-queued with the new content. On a
 * delivered message, platforms that allow it (Telegram, Discord, Slack, Mastodon,
 * Reddit) are edited in place.
 */
export async function updateTargetAction(targetId: string, patch: TargetPatch, opts: { requeue?: boolean } = {}): Promise<{ ok: boolean; message?: string; error?: string; upgrade?: string }> {
  const { ctx, t } = await ownTarget(targetId);
  if (!can(ctx.role, "editor")) return { ok: false, error: "Your role can't edit posts." };
  const parsed = TargetPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Some fields are invalid." };
  const p = parsed.data;
  const features = planFeatures(ctx.workspace.plan);
  const post = await Post.findById(t.postId);
  if (!post) return { ok: false, error: "Post not found." };
  const live = t.status === "published";
  const postLocked = !["draft", "scheduled", "pending_approval"].includes(post.status);

  if (postLocked && !features.editAfterPublish) return locked("editAfterPublish");
  if (live && !features.liveEdits) return locked("liveEdits");
  if (live && !PLATFORMS[t.platform as TargetPlatform]?.liveEdit) return { ok: false, error: `${PLATFORMS[t.platform as TargetPlatform]?.name ?? t.platform} doesn't allow editing after posting.` };
  if (!live && !EDITABLE_TARGET.includes(t.status)) return { ok: false, error: "This channel is uploading right now. Try again when it finishes." };
  if (!features.channelCaptions && (p.captionOverride?.trim() || (p.options && String(p.options.headline ?? "") !== String((t.options as Record<string, unknown>)?.headline ?? "")))) return locked("channelCaptions");
  if (!features.channelVideoEdits && hasSpec(p.editSpec)) return locked("channelVideoEdits");

  const spec = PLATFORMS[t.platform as TargetPlatform];
  if (!live && p.postType && !spec?.postTypes.some((x) => x.id === p.postType)) return { ok: false, error: "Pick a post type." };
  if (p.editSpec?.audioTrackId && !(isOid(p.editSpec.audioTrackId) && (await MediaAsset.exists({ _id: oid(p.editSpec.audioTrackId), workspaceId: oid(ctx.workspace.id), kind: "audio" })))) {
    return { ok: false, error: "That soundtrack is no longer in the library." };
  }

  const next = {
    postType: live ? t.postType : (p.postType ?? t.postType),
    captionOverride: p.captionOverride !== undefined ? p.captionOverride.trim() || undefined : (t.captionOverride ?? undefined),
    options: p.options ?? (t.options as Record<string, unknown>) ?? {},
  };
  // Re-validate this one channel against its platform's rules.
  const assets = await MediaAsset.find({ _id: { $in: (post.media ?? []).map((m) => m.assetId) } }).lean();
  const byId = new Map(assets.map((a) => [String(a._id), a]));
  const v = validateTargets({
    caption: post.baseCaption ?? "",
    media: (post.media ?? []).map((m) => byId.get(String(m.assetId))).filter(Boolean).map((a) => ({ kind: a!.kind as "image" | "video", durationMs: a!.durationMs, width: a!.width, height: a!.height })),
    targets: [{ key: "t", platform: t.platform as TargetPlatform, ...next }],
    poll: post.poll?.question ? { question: post.poll.question, options: post.poll.options ?? [] } : undefined,
  });
  if (!v.ok) return { ok: false, error: v.errors.t!.join(". ") };

  t.postType = next.postType;
  t.captionOverride = next.captionOverride;
  t.options = next.options;
  t.markModified("options");
  if (!live && p.editSpec !== undefined) {
    t.editSpec = (hasSpec(p.editSpec) ? { ...p.editSpec, audioTrackId: p.editSpec?.audioTrackId ? oid(p.editSpec.audioTrackId) : undefined } : undefined) as never;
    t.renderedAssetId = undefined;
  }

  let message = "Channel updated";
  if (live) {
    await t.save();
    const err = await editLive(targetId, ctx.user.id);
    await audit({ action: "target.live_edited", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post_target", entityId: targetId, meta: { platform: t.platform, ok: !err } });
    revalidatePath(`/posts/${String(t.postId)}`);
    return err ? { ok: false, error: `Saved in Relay, but ${spec?.name} refused the edit: ${err}` } : { ok: true, message: `Updated on ${spec?.name}` };
  }

  if (p.scheduledAt !== undefined && t.status === "scheduled" && p.scheduledAt) {
    const at = new Date(p.scheduledAt);
    if (at.getTime() < Date.now() - 60_000) return { ok: false, error: "That time is in the past." };
    t.nextAttemptAt = at;
  }
  if (opts.requeue && ["failed", "needs_action", "cancelled"].includes(t.status)) {
    t.status = "retrying";
    t.nextAttemptAt = new Date();
    t.attempts = Math.min(t.attempts, 3);
    t.lastErrorCode = undefined;
    t.lastErrorMessage = undefined;
    message = "Updated and sent again";
  }
  await t.save();
  if (opts.requeue) {
    await Post.updateOne({ _id: t.postId, status: { $in: ["failed", "partially_failed", "done", "cancelled"] } }, { $set: { status: "publishing" } });
    await kick(String(t.postId));
  }
  await audit({ action: "target.updated", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post_target", entityId: targetId, meta: { platform: t.platform, requeue: Boolean(opts.requeue) } });
  revalidatePath(`/posts/${String(t.postId)}`);
  return { ok: true, message };
}

/** Renders this channel's cut of the video now, so it can be checked before it goes out. */
export async function renderTargetPreviewAction(targetId: string): Promise<{ ok: boolean; url?: string; error?: string; same?: boolean }> {
  const { ctx, t } = await ownTarget(targetId);
  const post = await Post.findById(t.postId).lean();
  const first = [...(post?.media ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  if (!first) return { ok: false, error: "This post has no media." };
  const source = await MediaAsset.findOne({ _id: first.assetId, workspaceId: oid(ctx.workspace.id) }).lean();
  if (!source || source.kind !== "video") return { ok: false, error: "Only videos are rendered per channel." };
  const spec = effectiveSpec(t.editSpec as EditSpec, { audioTrackId: first.audioTrackId, editSpec: first.editSpec as EditSpec });
  try {
    const out = await ensureRendered(source as never, spec);
    if (String(out._id) !== String(source._id)) await PostTarget.updateOne({ _id: t._id }, { $set: { renderedAssetId: out._id } });
    return { ok: true, url: `/api/media/${String(out._id)}/file`, same: String(out._id) === String(source._id) };
  } catch (e) {
    return { ok: false, error: `Rendering failed: ${(e as Error).message}` };
  }
}
