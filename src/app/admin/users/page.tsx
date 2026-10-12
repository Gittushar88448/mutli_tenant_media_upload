import type { Metadata } from "next";
import { listUsers } from "@/lib/queries/admin";
import { parseTableParams } from "@/lib/queries/table-params";
import { PageHeader } from "@/components/shell/page-header";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parseTableParams(await searchParams, {
    sortable: ["name", "email", "createdAt", "lastLoginAt", "postCount", "publishedCount", "workspaceCount", "accountCount"],
    defaultSort: "createdAt",
    filterKeys: ["role", "status"],
  });
  const { rows, total } = await listUsers(p);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Users" title="People" description="Every account on the platform. Counts come from a single aggregation joining memberships, posts, deliveries and channels." />
      <UsersTable rows={rows} total={total} page={p.page} size={p.size} />
    </div>
  );
}
