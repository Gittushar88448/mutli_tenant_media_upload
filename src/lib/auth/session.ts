import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Membership, User, Workspace, oid, isOid } from "@/lib/models";
import { SESSION_COOKIE, WORKSPACE_COOKIE, verifySession } from "./jwt";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  timezone: string;
  avatarUrl?: string | null;
};

/** The signed-in user, re-read from the database so suspensions and role changes apply at once. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session || !isOid(session.sub)) return null;
  await connectDB();
  const user = await User.findById(session.sub).lean();
  if (!user || user.status !== "active") return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as "user" | "admin",
    timezone: user.timezone ?? "UTC",
    avatarUrl: user.avatarUrl,
  };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

export type WorkspaceContext = {
  user: CurrentUser;
  workspace: { id: string; name: string; slug: string; plan: string; timezone: string; requireApproval: boolean };
  role: "owner" | "admin" | "editor" | "approver" | "viewer";
  workspaces: { id: string; name: string; role: string; plan: string }[];
};

/**
 * Resolves the active workspace for the request: the one in the workspace cookie if the
 * user is a member of it, otherwise their first membership. Every tenant query starts here.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const store = await cookies();
  const wanted = store.get(WORKSPACE_COOKIE)?.value;

  const memberships = await Membership.aggregate<{
    workspaceId: unknown;
    role: string;
    ws: { _id: unknown; name: string; slug: string; plan: string; timezone: string; status: string; requireApproval: boolean };
  }>([
    { $match: { userId: oid(user.id) } },
    { $lookup: { from: "workspaces", localField: "workspaceId", foreignField: "_id", as: "ws" } },
    { $unwind: "$ws" },
    { $match: { "ws.status": "active" } },
    { $sort: { "ws.name": 1 } },
  ]);

  if (memberships.length === 0) redirect("/onboarding");

  const active = memberships.find((m) => String(m.workspaceId) === wanted) ?? memberships[0]!;
  return {
    user,
    role: active.role as WorkspaceContext["role"],
    workspace: {
      id: String(active.ws._id),
      name: active.ws.name,
      slug: active.ws.slug,
      plan: active.ws.plan,
      timezone: active.ws.timezone ?? "UTC",
      requireApproval: Boolean(active.ws.requireApproval),
    },
    workspaces: memberships.map((m) => ({ id: String(m.ws._id), name: m.ws.name, role: m.role, plan: m.ws.plan })),
  };
});

const RANK = { viewer: 0, approver: 1, editor: 2, admin: 3, owner: 4 } as const;
export function can(role: WorkspaceContext["role"], needed: keyof typeof RANK) {
  if (needed === "approver") return role === "approver" || RANK[role] >= RANK.admin;
  return RANK[role] >= RANK[needed];
}

export async function workspaceExists(id: string) {
  await connectDB();
  return Boolean(await Workspace.exists({ _id: oid(id) }));
}
