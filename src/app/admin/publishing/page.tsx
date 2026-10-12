import type { Metadata } from "next";
import { listTargets } from "@/lib/queries/admin";
import { parseTableParams } from "@/lib/queries/table-params";
import { PageHeader } from "@/components/shell/page-header";
import { TargetsTable } from "./table";

export const metadata: Metadata = { title: "Publishing" };

export default async function AdminPublishing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parseTableParams(await searchParams, {
    sortable: ["updatedAt", "scheduledAt", "publishedAt", "attempts", "platform", "status"],
    defaultSort: "updatedAt",
    filterKeys: ["status", "platform"],
  });
  const { rows, total } = await listTargets(p);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Publishing" title="Every delivery" description="One row per post per channel, across all workspaces. Retry or cancel in bulk." />
      <TargetsTable rows={rows} total={total} page={p.page} size={p.size} />
    </div>
  );
}
