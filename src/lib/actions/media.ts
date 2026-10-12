"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { MediaAsset, Post, PostTarget, oid, isOid } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { deleteObject } from "@/lib/storage";
import { audit } from "@/lib/audit";

/** Deletes a file unless a post that hasn't gone out yet still uses it. */
export async function deleteMediaAction(id: string): Promise<{ error?: string }> {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "editor") || !isOid(id)) return { error: "Not allowed" };
  await connectDB();
  const asset = await MediaAsset.findOne({ _id: oid(id), workspaceId: oid(ctx.workspace.id) });
  if (!asset) return { error: "Not found" };
  const inUse = await Post.countDocuments({
    workspaceId: oid(ctx.workspace.id),
    status: { $in: ["draft", "pending_approval", "scheduled", "publishing"] },
    $or: [{ "media.assetId": asset._id }, { "media.audioTrackId": asset._id }],
  });
  if (inUse) return { error: `Used by ${inUse} post${inUse > 1 ? "s" : ""} that haven't gone out yet.` };
  const trackInUse = asset.kind === "audio" ? await PostTarget.countDocuments({ workspaceId: oid(ctx.workspace.id), "editSpec.audioTrackId": asset._id, status: { $in: ["scheduled", "retrying", "needs_action"] } }) : 0;
  if (trackInUse) return { error: `A channel's own cut still uses this track in ${trackInUse} post${trackInUse > 1 ? "s" : ""}.` };
  // Its rendered cuts go with it.
  const variants = await MediaAsset.find({ variantOf: asset._id }, { storageKey: 1, storage: 1 }).lean();
  await Promise.all(variants.map((v) => deleteObject(v)));
  await MediaAsset.deleteMany({ variantOf: asset._id });
  await deleteObject(asset);
  await asset.deleteOne();
  await audit({ action: "media.deleted", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "media", entityId: id });
  revalidatePath("/media");
  return {};
}
