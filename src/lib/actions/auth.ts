"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { AppSettings, Membership, User, Workspace } from "@/lib/models";
import { SESSION_COOKIE, WORKSPACE_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/jwt";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/slug";

export type FormState = { error?: string; fieldErrors?: Record<string, string[]>; ok?: boolean; message?: string } | undefined;

const RegisterSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name").max(80),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  workspace: z.string().trim().min(2, "Name your workspace").max(80),
});

export async function registerAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = RegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  await connectDB();

  const settings = await AppSettings.findOne({ key: "global" }).lean();
  const isFirstUser = (await User.estimatedDocumentCount()) === 0;
  if (settings && !settings.registrationOpen && !isFirstUser) return { error: "New sign-ups are closed right now." };
  if (await User.exists({ email: parsed.data.email })) return { fieldErrors: { email: ["An account with this email already exists"] } };

  const tz = String(formData.get("timezone") || "UTC");
  // The very first account on a fresh install becomes the platform admin.
  const user = await User.create({
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash: await bcrypt.hash(parsed.data.password, 11),
    role: isFirstUser ? "admin" : "user",
    timezone: tz,
    lastLoginAt: new Date(),
  });
  const ws = await Workspace.create({
    name: parsed.data.workspace,
    slug: slugify(parsed.data.workspace),
    ownerId: user._id,
    timezone: tz,
    plan: settings?.defaultPlan ?? "free",
  });
  await Membership.create({ workspaceId: ws._id, userId: user._id, role: "owner" });
  user.defaultWorkspaceId = ws._id;
  await user.save();

  await audit({ action: "user.registered", actor: { id: String(user._id), email: user.email }, workspaceId: String(ws._id), entity: "user", entityId: String(user._id) });
  await startSession(String(user._id), user.role as "user" | "admin", String(ws._id));
  redirect("/dashboard");
}

const LoginSchema = z.object({ email: z.email().transform((e) => e.toLowerCase()), password: z.string().min(1) });

export async function loginAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  await connectDB();
  const user = await User.findOne({ email: parsed.data.email }).select("+passwordHash");
  if (user && !user.passwordHash) return { error: "This account signs in with Google. Use Continue with Google above." };
  const ok = user?.passwordHash && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!user || !ok) return { error: "That email and password don't match." };
  if (user.status === "suspended") return { error: "This account is suspended. Contact support." };

  user.lastLoginAt = new Date();
  await user.save();
  await audit({ action: "user.login", actor: { id: String(user._id), email: user.email }, entity: "user", entityId: String(user._id) });
  await startSession(String(user._id), user.role as "user" | "admin", user.defaultWorkspaceId ? String(user.defaultWorkspaceId) : undefined);

  const next = String(formData.get("next") || "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(WORKSPACE_COOKIE);
  redirect("/login");
}

async function startSession(userId: string, role: "user" | "admin", workspaceId?: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession({ sub: userId, role, v: 1 }), sessionCookieOptions);
  if (workspaceId) store.set(WORKSPACE_COOKIE, workspaceId, { ...sessionCookieOptions, httpOnly: false });
}
