"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  AppSettings,
  AuditEvent,
  MediaAsset,
  Membership,
  Notification,
  OAuthCredential,
  PLANS,
  Post,
  PostTarget,
  PublishAttempt,
  SocialAccount,
  User,
  Workspace,
  oid,
  isOid,
} from "@/lib/models";
import { requireAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { deleteObject } from "@/lib/storage";
import { slugify } from "@/lib/slug";
import { rollupPostStatus } from "@/lib/publishing/engine";
import { runSimulatedDispatch } from "@/lib/publishing/simulator";
import { demoMode } from "@/lib/publishing/n8n";
import { ALL_TARGET_PLATFORMS } from "@/lib/platforms";
import type { FormState } from "./auth";

type Result = { ok: boolean; message: string; secret?: string };
const ids = (list: string[]) => list.filter(isOid).map(oid);

/* ---------------- Users ---------------- */

export async function adminSetUserRole(userIds: string[], role: "user" | "admin"): Promise<Result> {
  const admin = await requireAdmin();
  const targets = userIds.filter((id) => id !== admin.id);
  if (role === "user" && targets.length !== userIds.length) return { ok: false, message: "You can't remove your own admin role." };
  const r = await User.updateMany({ _id: { $in: ids(targets) } }, { $set: { role } });
  await audit({ action: `admin.user.role_${role}`, actor: admin, entity: "user", meta: { userIds: targets } });
  revalidatePath("/admin/users");
  return { ok: true, message: `${r.modifiedCount} user${r.modifiedCount === 1 ? "" : "s"} now ${role === "admin" ? "admins" : "regular users"}` };
}

export async function adminSetUserStatus(userIds: string[], status: "active" | "suspended"): Promise<Result> {
  const admin = await requireAdmin();
  const targets = userIds.filter((id) => id !== admin.id);
  if (targets.length === 0) return { ok: false, message: "You can't suspend yourself." };
  const r = await User.updateMany({ _id: { $in: ids(targets) } }, { $set: { status } });
  await audit({ action: `admin.user.${status === "active" ? "activated" : "suspended"}`, actor: admin, entity: "user", meta: { userIds: targets } });
  revalidatePath("/admin/users");
  return { ok: true, message: `${r.modifiedCount} user${r.modifiedCount === 1 ? "" : "s"} ${status === "active" ? "reactivated" : "suspended"}` };
}

export async function adminResetPassword(userId: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!isOid(userId)) return { ok: false, message: "Unknown user" };
  const temp = `Relay-${randomToken(6)}`;
  await User.updateOne({ _id: oid(userId) }, { $set: { passwordHash: await bcrypt.hash(temp, 11) } });
  await audit({ action: "admin.user.password_reset", actor: admin, entity: "user", entityId: userId });
  return { ok: true, message: "Temporary password created. Share it securely; it is shown once.", secret: temp };
}

/**
 * Deletes users. Workspaces they own alone are deleted with everything in them;
 * shared workspaces they own are handed to the next admin member.
 */
export async function adminDeleteUsers(userIds: string[]): Promise<Result> {
  const admin = await requireAdmin();
  const targets = ids(userIds.filter((id) => id !== admin.id));
  if (!targets.length) return { ok: false, message: "You can't delete yourself." };
  await connectDB();

  const owned = await Workspace.aggregate<{ _id: Types.ObjectId; others: { userId: Types.ObjectId; role: string }[] }>([
    { $match: { ownerId: { $in: targets } } },
    { $lookup: { from: "memberships", localField: "_id", foreignField: "workspaceId", as: "m" } },
    { $project: { others: { $filter: { input: "$m", cond: { $not: { $in: ["$$this.userId", targets] } } } } } },
  ]);
  for (const w of owned) {
    if (w.others.length === 0) await deleteWorkspaceCascade(String(w._id));
    else {
      const heir = w.others.find((o) => o.role === "admin") ?? w.others[0]!;
      await Workspace.updateOne({ _id: w._id }, { $set: { ownerId: heir.userId } });
      await Membership.updateOne({ workspaceId: w._id, userId: heir.userId }, { $set: { role: "owner" } });
    }
  }
  await Membership.deleteMany({ userId: { $in: targets } });
  await Notification.deleteMany({ userId: { $in: targets } });
  const r = await User.deleteMany({ _id: { $in: targets } });
  await audit({ action: "admin.user.deleted", actor: admin, entity: "user", meta: { userIds } });
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true, message: `${r.deletedCount} user${r.deletedCount === 1 ? "" : "s"} deleted` };
}

const CreateUser = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(["user", "admin"]),
  plan: z.enum(PLANS),
});

export async function adminCreateUser(_: FormState, formData: FormData): Promise<FormState & { secret?: string }> {
  const admin = await requireAdmin();
  const p = CreateUser.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Check the name, email, role and plan." };
  await connectDB();
  if (await User.exists({ email: p.data.email })) return { error: "That email is already registered." };
  const temp = `Relay-${randomToken(6)}`;
  const user = await User.create({ name: p.data.name, email: p.data.email, role: p.data.role, passwordHash: await bcrypt.hash(temp, 11) });
  const ws = await Workspace.create({ name: `${p.data.name.split(" ")[0]}'s workspace`, slug: slugify(p.data.name), ownerId: user._id, plan: p.data.plan });
  await Membership.create({ workspaceId: ws._id, userId: user._id, role: "owner" });
  user.defaultWorkspaceId = ws._id;
  await user.save();
  await audit({ action: "admin.user.created", actor: admin, entity: "user", entityId: String(user._id), meta: { role: p.data.role } });
  revalidatePath("/admin/users");
  return { ok: true, message: `${p.data.name} created`, secret: temp };
}

/* ---------------- Workspaces ---------------- */

export async function adminSetWorkspacePlan(workspaceIds: string[], plan: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!PLANS.includes(plan as never)) return { ok: false, message: "Unknown plan" };
  // An admin override is recorded as a manual plan, so the billing page says who set it.
  const r = await Workspace.updateMany({ _id: { $in: ids(workspaceIds) } }, { $set: { plan, "billing.provider": "manual", "billing.status": "active" } });
  await audit({ action: "admin.workspace.plan_changed", actor: admin, entity: "workspace", meta: { workspaceIds, plan } });
  revalidatePath("/admin/workspaces");
  return { ok: true, message: `${r.modifiedCount} workspace${r.modifiedCount === 1 ? "" : "s"} moved to ${plan}` };
}

export async function adminSetWorkspaceStatus(workspaceIds: string[], status: "active" | "suspended"): Promise<Result> {
  const admin = await requireAdmin();
  const r = await Workspace.updateMany({ _id: { $in: ids(workspaceIds) } }, { $set: { status } });
  // Suspending a workspace also pauses its queue.
  if (status === "suspended") {
    await PostTarget.updateMany({ workspaceId: { $in: ids(workspaceIds) }, status: { $in: ["scheduled", "retrying"] } }, { $set: { status: "needs_action", lastErrorCode: "WORKSPACE_SUSPENDED", lastErrorMessage: "Workspace suspended by an administrator" } });
  }
  await audit({ action: `admin.workspace.${status}`, actor: admin, entity: "workspace", meta: { workspaceIds } });
  revalidatePath("/admin/workspaces");
  return { ok: true, message: `${r.modifiedCount} workspace${r.modifiedCount === 1 ? "" : "s"} ${status}` };
}

async function deleteWorkspaceCascade(workspaceId: string) {
  const ws = oid(workspaceId);
  const assets = await MediaAsset.find({ workspaceId: ws }, { storageKey: 1, storage: 1 }).lean();
  await Promise.all(assets.map((a) => deleteObject(a)));
  const accounts = await SocialAccount.find({ workspaceId: ws }, { _id: 1 }).lean();
  await Promise.all([
    OAuthCredential.deleteMany({ socialAccountId: { $in: accounts.map((a) => a._id) } }),
    SocialAccount.deleteMany({ workspaceId: ws }),
    MediaAsset.deleteMany({ workspaceId: ws }),
    Post.deleteMany({ workspaceId: ws }),
    PostTarget.deleteMany({ workspaceId: ws }),
    PublishAttempt.deleteMany({ workspaceId: ws }),
    Notification.deleteMany({ workspaceId: ws }),
    Membership.deleteMany({ workspaceId: ws }),
  ]);
  await Workspace.deleteOne({ _id: ws });
}

export async function adminDeleteWorkspaces(workspaceIds: string[]): Promise<Result> {
  const admin = await requireAdmin();
  for (const id of workspaceIds.filter(isOid)) await deleteWorkspaceCascade(id);
  await audit({ action: "admin.workspace.deleted", actor: admin, entity: "workspace", meta: { workspaceIds } });
  revalidatePath("/admin/workspaces");
  return { ok: true, message: `${workspaceIds.length} workspace${workspaceIds.length === 1 ? "" : "s"} deleted with all their data` };
}

/* ---------------- Publishing ---------------- */

export async function adminRetryTargets(targetIds: string[]): Promise<Result> {
  const admin = await requireAdmin();
  const r = await PostTarget.updateMany(
    { _id: { $in: ids(targetIds) }, status: { $in: ["failed", "needs_action", "cancelled"] } },
    { $set: { status: "retrying", nextAttemptAt: new Date(), attempts: 0 } }
  );
  const posts = await PostTarget.distinct("postId", { _id: { $in: ids(targetIds) } });
  await Post.updateMany({ _id: { $in: posts }, status: { $in: ["failed", "partially_failed", "cancelled", "done"] } }, { $set: { status: "publishing" } });
  await audit({ action: "admin.target.retried", actor: admin, entity: "post_target", meta: { targetIds } });
  revalidatePath("/admin/publishing");
  return { ok: true, message: `${r.modifiedCount} deliver${r.modifiedCount === 1 ? "y" : "ies"} queued for retry` };
}

export async function adminCancelTargets(targetIds: string[]): Promise<Result> {
  const admin = await requireAdmin();
  const r = await PostTarget.updateMany({ _id: { $in: ids(targetIds) }, status: { $in: ["scheduled", "retrying", "queued", "needs_action"] } }, { $set: { status: "cancelled" } });
  const posts = await PostTarget.distinct("postId", { _id: { $in: ids(targetIds) } });
  for (const p of posts) await rollupPostStatus(String(p));
  await audit({ action: "admin.target.cancelled", actor: admin, entity: "post_target", meta: { targetIds } });
  revalidatePath("/admin/publishing");
  return { ok: true, message: `${r.modifiedCount} deliver${r.modifiedCount === 1 ? "y" : "ies"} cancelled` };
}

export async function adminRunDispatcher(): Promise<Result> {
  const admin = await requireAdmin();
  if (!demoMode()) return { ok: false, message: "In production the dispatcher runs in n8n." };
  const n = await runSimulatedDispatch();
  await audit({ action: "admin.dispatcher.run", actor: admin, meta: { claimed: n } });
  revalidatePath("/admin");
  revalidatePath("/admin/publishing");
  return { ok: true, message: n ? `Simulator delivered ${n} target${n === 1 ? "" : "s"}` : "Nothing was due" };
}

/* ---------------- Channels ---------------- */

export async function adminSetAccountStatus(accountIds: string[], status: "active" | "disabled" | "needs_reauth"): Promise<Result> {
  const admin = await requireAdmin();
  const r = await SocialAccount.updateMany({ _id: { $in: ids(accountIds) } }, { $set: { status } });
  await audit({ action: `admin.channel.${status}`, actor: admin, entity: "social_account", meta: { accountIds } });
  revalidatePath("/admin/accounts");
  return { ok: true, message: `${r.modifiedCount} channel${r.modifiedCount === 1 ? "" : "s"} set to ${status.replace("_", " ")}` };
}

export async function adminRevokeAccounts(accountIds: string[]): Promise<Result> {
  const admin = await requireAdmin();
  const list = ids(accountIds);
  await OAuthCredential.deleteMany({ socialAccountId: { $in: list } });
  await PostTarget.updateMany({ socialAccountId: { $in: list }, status: { $in: ["scheduled", "retrying", "needs_action"] } }, { $set: { status: "cancelled", lastErrorCode: "CHANNEL_REVOKED" } });
  const r = await SocialAccount.updateMany({ _id: { $in: list } }, { $set: { status: "revoked" } });
  await audit({ action: "admin.channel.revoked", actor: admin, entity: "social_account", meta: { accountIds } });
  revalidatePath("/admin/accounts");
  return { ok: true, message: `${r.modifiedCount} channel${r.modifiedCount === 1 ? "" : "s"} revoked and tokens deleted` };
}

/* ---------------- Settings ---------------- */

const SettingsSchema = z.object({
  registrationOpen: z.enum(["on"]).optional(),
  maintenanceMode: z.enum(["on"]).optional(),
  maxUploadMb: z.coerce.number().int().min(1).max(5000),
  defaultPlan: z.enum(PLANS),
  announcement: z.string().max(240).optional(),
});

export async function adminUpdateSettings(_: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const p = SettingsSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Check the values." };
  const disabledPlatforms = ALL_TARGET_PLATFORMS.filter((pl) => formData.get(`platform_${pl}`) !== "on");
  await AppSettings.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        registrationOpen: p.data.registrationOpen === "on",
        maintenanceMode: p.data.maintenanceMode === "on",
        maxUploadMb: p.data.maxUploadMb,
        defaultPlan: p.data.defaultPlan,
        announcement: p.data.announcement ?? "",
        disabledPlatforms,
      },
    },
    { upsert: true }
  );
  await audit({ action: "admin.settings.updated", actor: admin, meta: { ...p.data, disabledPlatforms } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Platform settings saved" };
}

export async function adminPruneAudit(days: number): Promise<Result> {
  const admin = await requireAdmin();
  const r = await AuditEvent.deleteMany({ createdAt: { $lt: new Date(Date.now() - Math.max(30, days) * 86400000) } });
  await audit({ action: "admin.audit.pruned", actor: admin, meta: { days, deleted: r.deletedCount } });
  revalidatePath("/admin/audit");
  return { ok: true, message: `${r.deletedCount} old events removed` };
}
