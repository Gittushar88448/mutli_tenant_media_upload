import type { Metadata } from "next";
import { distinctAuditActions, listAudit } from "@/lib/queries/admin";
import { parseTableParams } from "@/lib/queries/table-params";
import { PageHeader } from "@/components/shell/page-header";
import { AuditTable } from "./table";

export const metadata: Metadata = { title: "Audit log" };

export default async function AdminAudit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parseTableParams(await searchParams, { sortable: ["createdAt", "action"], defaultSort: "createdAt", filterKeys: ["action"] });
  const [{ rows, total }, actions] = await Promise.all([listAudit(p), distinctAuditActions()]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Audit log" title="Who did what" description="Sign-ins, connects, publishes, deletions and every admin action, newest first." />
      <AuditTable rows={rows} total={total} page={p.page} size={p.size} actions={actions} />
    </div>
  );
}
