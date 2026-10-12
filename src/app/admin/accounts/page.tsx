import type { Metadata } from "next";
import { listAccounts } from "@/lib/queries/admin";
import { parseTableParams } from "@/lib/queries/table-params";
import { PageHeader } from "@/components/shell/page-header";
import { AccountsTable } from "./table";

export const metadata: Metadata = { title: "Channels" };

export default async function AdminAccounts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parseTableParams(await searchParams, {
    sortable: ["handle", "platform", "createdAt", "published", "failed", "tokenExpiresAt"],
    defaultSort: "createdAt",
    filterKeys: ["platform", "status"],
  });
  const { rows, total } = await listAccounts(p);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Channels" title="Connected channels" description="Every connected page, channel and profile with its token health and delivery record." />
      <AccountsTable rows={rows} total={total} page={p.page} size={p.size} />
    </div>
  );
}
