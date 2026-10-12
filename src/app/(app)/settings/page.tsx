import type { Metadata } from "next";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { Membership, oid } from "@/lib/models";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { MembersTable, ProfileForm, WorkspaceForm, InviteForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getWorkspaceContext();
  const members = await Membership.aggregate([
    { $match: { workspaceId: oid(ctx.workspace.id) } },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "u", pipeline: [{ $project: { name: 1, email: 1, lastLoginAt: 1 } }] } },
    { $unwind: "$u" },
    { $lookup: { from: "posts", let: { uid: "$userId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$authorId", "$$uid"] }, { $eq: ["$workspaceId", oid(ctx.workspace.id)] }] } } }, { $count: "n" }], as: "p" } },
    { $project: { _id: 0, userId: { $toString: "$userId" }, role: 1, name: "$u.name", email: "$u.email", lastLoginAt: "$u.lastLoginAt", posts: { $ifNull: [{ $first: "$p.n" }, 0] } } },
    { $addFields: { order: { $indexOfArray: [["owner", "admin", "approver", "editor", "viewer"], "$role"] } } },
    { $sort: { order: 1, name: 1 } },
  ]);
  const zones = Intl.supportedValuesOf("timeZone");
  const isAdmin = can(ctx.role, "admin");

  return (
    <div className="space-y-12">
      <PageHeader eyebrow="Settings" title="Workspace & profile" description={`You are ${ctx.role === "admin" || ctx.role === "owner" || ctx.role === "approver" || ctx.role === "editor" ? "an" : "a"} ${ctx.role} in ${ctx.workspace.name}.`} />
      <div className="grid gap-12 lg:grid-cols-2">
        <section>
          <SectionTitle n="01">Workspace</SectionTitle>
          <WorkspaceForm name={ctx.workspace.name} timezone={ctx.workspace.timezone} requireApproval={ctx.workspace.requireApproval} zones={zones} disabled={!isAdmin} />
        </section>
        <section>
          <SectionTitle n="02">Your profile</SectionTitle>
          <ProfileForm name={ctx.user.name} email={ctx.user.email} timezone={ctx.user.timezone} zones={zones} />
        </section>
      </div>
      <section>
        <SectionTitle n="03" aside={<span className="font-mono text-[11px] text-muted-foreground">{members.length} members</span>}>
          Members
        </SectionTitle>
        <MembersTable members={JSON.parse(JSON.stringify(members))} canManage={isAdmin} selfId={ctx.user.id} />
        {isAdmin && <InviteForm />}
      </section>
    </div>
  );
}
