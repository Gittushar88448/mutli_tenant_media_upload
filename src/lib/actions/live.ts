"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { PostTarget, SocialAccount, oid, isOid, type PostTargetDoc, type SocialAccountDoc } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { liveFor, sendReply } from "@/lib/live";
import { LIVE_WINDOW } from "@/lib/live/queries";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Re-reads one delivery, or every recent one, from the platforms, ignoring the 5-minute cache. */
export async function refreshLiveAction(targetId?: string): Promise<Result> {
  const ctx = await getWorkspaceContext();
  if (targetId !== undefined && !isOid(targetId)) return { ok: false, error: "Unknown post." };
  await connectDB();
  const ws = oid(ctx.workspace.id);
  const targets = await PostTarget.find({ workspaceId: ws, status: "published", ...(targetId ? { _id: oid(targetId) } : {}) })
    .sort({ publishedAt: -1 })
    .limit(targetId ? 1 : LIVE_WINDOW)
    .lean<PostTargetDoc[]>();
  if (targetId && !targets.length) return { ok: false, error: "That post isn't live." };
  const accounts = await SocialAccount.find({ workspaceId: ws, _id: { $in: [...new Set(targets.map((t) => String(t.socialAccountId)))].map(oid) } }).lean<SocialAccountDoc[]>();
  const { snapshots } = await liveFor(targets, new Map(accounts.map((a) => [String(a._id), a])), { force: true });
  const failed = targets.filter((t) => snapshots.get(String(t._id))?.error).length;
  await audit({ action: "live.refreshed", actor: ctx.user, workspaceId: ctx.workspace.id, entity: targetId ? "post_target" : "workspace", entityId: targetId ?? ctx.workspace.id, meta: { count: targets.length, failed } });
  revalidatePath("/live");
  if (targetId) {
    const err = snapshots.get(targetId)?.error;
    return err ? { ok: false, error: err } : { ok: true, message: "Up to date" };
  }
  return { ok: true, message: failed ? `Checked ${targets.length} posts; ${failed} couldn't be read` : `Checked ${targets.length} posts` };
}

const ReplySchema = z.object({
  targetId: z.string().refine(isOid),
  commentId: z.string().min(1).max(300),
  text: z.string().trim().min(1, "Write a reply first.").max(2000),
});

export async function replyToCommentAction(input: z.input<typeof ReplySchema>): Promise<Result> {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "editor")) return { ok: false, error: "Your role in this workspace can't reply to comments." };
  const parsed = ReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That reply isn't valid." };
  const { targetId, commentId, text } = parsed.data;
  const error = await sendReply({ workspaceId: ctx.workspace.id, targetId, commentId, text, user: { id: ctx.user.id, name: ctx.user.name } });
  await audit({ action: error ? "live.reply_failed" : "live.replied", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "post_target", entityId: targetId, meta: { commentId, length: text.length, error: error ?? undefined } });
  revalidatePath("/live");
  return error ? { ok: false, error } : { ok: true, message: "Reply sent" };
}
