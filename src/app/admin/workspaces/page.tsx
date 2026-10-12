import type { Metadata } from "next";
import { listWorkspaces } from "@/lib/queries/admin";
import { parseTableParams } from "@/lib/queries/table-params";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspacesTable } from "./table";

export const metadata: Metadata = { title: "Workspaces" };

export default async function AdminWorkspaces({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parseTableParams(await searchParams, {
    sortable: ["name", "plan", "createdAt", "members", "accounts", "posts", "published", "storageBytes"],
    defaultSort: "createdAt",
    filterKeys: ["plan", "status"],
  });
  const { rows, total } = await listWorkspaces(p);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Workspaces" title="Tenants" description="Plans, usage and status for every workspace. Suspending one pauses its queue." />
      <WorkspacesTable rows={rows} total={total} page={p.page} size={p.size} />
    </div>
  );
}
