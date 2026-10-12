"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { AppSettings, Membership, Notification, User, Workspace, WORKSPACE_ROLES, oid, isOid } from "@/lib/models";
import { WORKSPACE_COOKIE, sessionCookieOptions } from "@/lib/auth/jwt";
import { can, getWorkspaceContext, requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/slug";
import type { FormState } from "./auth";

export async function switchWorkspaceAction(workspaceId: string) {
  const user = await requireUser();
  if (!isOid(workspaceId)) return;
  await connectDB();
  if (!(await Membership.exists({ workspaceId: oid(workspaceId), userId: oid(user.id) }))) return;
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, { ...sessionCookieOptions, httpOnly: false });
  await User.updateOne({ _id: oid(user.id) }, { $set: { defaultWorkspaceId: oid(workspaceId) } });
  revalidatePath("/", "layout");
}

export async function createWorkspaceAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = z.string().trim().min(2).max(80).safeParse(formData.get("name"));
  if (!name.success) return { error: "Give the workspace a name (2–80 characters)." };
  await connectDB();
  const settings = await AppSettings.findOne({ key: "global" }).lean();
  const ws = await Workspace.create({ name: name.data, slug: slugify(name.data), ownerId: oid(user.id), timezone: user.timezone, plan: settings?.defaultPlan ?? "free" });
  await Membership.create({ workspaceId: ws._id, userId: oid(user.id), role: "owner" });
  await User.updateOne({ _id: oid(user.id), defaultWorkspaceId: null }, { $set: { defaultWorkspaceId: ws._id } });
  await audit({ action: "workspace.created", actor: user, workspaceId: String(ws._id), entity: "workspace", entityId: String(ws._id) });
  (await cookies()).set(WORKSPACE_COOKIE, String(ws._id), { ...sessionCookieOptions, httpOnly: false });
  redirect("/dashboard");
}

const SettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: z.string().min(1).max(64),
  requireApproval: z.enum(["on"]).optional(),
});

export async function updateWorkspaceAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "admin")) return { error: "Only workspace admins can change settings." };
  const parsed = SettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the name and timezone." };
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone });
  } catch {
    return { error: "Unknown timezone." };
  }
  await Workspace.updateOne(
    { _id: oid(ctx.workspace.id) },
    { $set: { name: parsed.data.name, timezone: parsed.data.timezone, requireApproval: parsed.data.requireApproval === "on" } }
  );
  await audit({ action: "workspace.updated", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "workspace", entityId: ctx.workspace.id, meta: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true, message: "Workspace saved" };
}

export async function inviteMemberAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "admin")) return { error: "Only workspace admins can add members." };
  const email = z.email().safeParse(String(formData.get("email") ?? "").toLowerCase());
  const role = z.enum(WORKSPACE_ROLES).safeParse(formData.get("role"));
  if (!email.success || !role.success) return { error: "Enter an email and pick a role." };
  if (role.data === "owner") return { error: "A workspace has one owner." };
  const user = await User.findOne({ email: email.data }).lean();
  if (!user) return { error: "No Relay account uses that email yet. Ask them to sign up first." };
  const exists = await Membership.exists({ workspaceId: oid(ctx.workspace.id), userId: user._id });
  if (exists) return { error: "They're already in this workspace." };
  await Membership.create({ workspaceId: oid(ctx.workspace.id), userId: user._id, role: role.data });
  await Notification.create({
    workspaceId: oid(ctx.workspace.id),
    userId: user._id,
    kind: "system",
    title: `You were added to ${ctx.workspace.name}`,
    body: `${ctx.user.name} added you as ${role.data}.`,
    href: "/dashboard",
  });
  await audit({ action: "member.added", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "user", entityId: String(user._id), meta: { role: role.data } });
  revalidatePath("/settings");
  return { ok: true, message: `${user.name} added as ${role.data}` };
}

export async function changeMemberRoleAction(userId: string, role: string) {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "admin") || !isOid(userId) || role === "owner") return;
  const r = z.enum(WORKSPACE_ROLES).safeParse(role);
  if (!r.success) return;
  await Membership.updateOne({ workspaceId: oid(ctx.workspace.id), userId: oid(userId), role: { $ne: "owner" } }, { $set: { role: r.data } });
  await audit({ action: "member.role_changed", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "user", entityId: userId, meta: { role } });
  revalidatePath("/settings");
}

export async function removeMemberAction(userId: string) {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "admin") || !isOid(userId)) return;
  await Membership.deleteOne({ workspaceId: oid(ctx.workspace.id), userId: oid(userId), role: { $ne: "owner" } });
  await audit({ action: "member.removed", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "user", entityId: userId });
  revalidatePath("/settings");
}

export async function markNotificationsReadAction() {
  const user = await requireUser();
  await connectDB();
  await Notification.updateMany({ userId: oid(user.id), readAt: null }, { $set: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

const ProfileSchema = z.object({ name: z.string().trim().min(2).max(80), timezone: z.string().min(1).max(64) });
export async function updateProfileAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = ProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check your name and timezone." };
  await User.updateOne({ _id: oid(user.id) }, { $set: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved" };
}
