"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { MediaAsset, Post, oid, isOid } from "@/lib/models";
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
  await deleteObject(asset.storageKey);
  await asset.deleteOne();
  await audit({ action: "media.deleted", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "media", entityId: id });
  revalidatePath("/media");
  return {};
}
