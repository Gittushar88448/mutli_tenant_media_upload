"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { FlaskConicalIcon, MoreHorizontalIcon } from "lucide-react";
import { DataTable, selectColumn } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/column-header";
import { StatusBadge } from "@/components/status-badge";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AdminAccountRow } from "@/lib/queries/admin";
import { adminRevokeAccounts, adminSetAccountStatus } from "@/lib/actions/admin";
import { ALL_TARGET_PLATFORMS, PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/time-ago";

export function AccountsTable({ rows, total, page, size }: { rows: AdminAccountRow[]; total: number; page: number; size: number }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      after?.();
    });

  const columns: ColumnDef<AdminAccountRow, unknown>[] = [
    selectColumn<AdminAccountRow>(),
    {
      id: "handle",
      meta: { label: "Channel" },
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Channel" sortKey="handle" />,
      cell: ({ row }) => (
        <span className="flex items-center gap-2.5">
          <PlatformIcon platform={row.original.platform} tone="chip" />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              {row.original.handle}
              {row.original.sandbox && <FlaskConicalIcon className="size-3 text-muted-foreground" />}
            </span>
            <span className="block text-xs text-muted-foreground">{PLATFORMS[row.original.platform as TargetPlatform]?.name}</span>
          </span>
        </span>
      ),
    },
    { id: "workspace", meta: { label: "Workspace" }, header: "Workspace", cell: ({ row }) => <span className="text-sm">{row.original.workspace}</span> },
    { id: "status", meta: { label: "Status" }, header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: "tokenExpiresAt",
      meta: { label: "Token" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Token" sortKey="tokenExpiresAt" />,
      cell: ({ row }) => {
        const t = row.original.tokenExpiresAt;
        if (!t) return <span className="font-mono text-xs text-muted-foreground">{["webhook", "manual"].includes(row.original.platform) ? "n/a" : "no expiry"}</span>;
        const d = new Date(t);
        const soon = d.getTime() - Date.now() < 7 * 86400000;
        return <span className={cn("font-mono text-xs", soon && "text-signal")}>{d < new Date() ? "expired" : <TimeAgo date={d} />}</span>;
      },
    },
    { id: "published", meta: { label: "Delivered" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Delivered" sortKey="published" />, cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.published}</span> },
    { id: "failed", meta: { label: "Failed" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Failed" sortKey="failed" />, cell: ({ row }) => <span className="font-mono tabular-nums text-signal">{row.original.failed || ""}</span> },
    { id: "connectedBy", meta: { label: "Connected by" }, header: "Connected by", cell: ({ row }) => <span className="text-xs">{row.original.connectedBy}</span> },
    {
      id: "createdAt",
      meta: { label: "Connected" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Connected" sortKey="createdAt" />,
      cell: ({ row }) => <span className="font-mono text-xs">{format(new Date(row.original.createdAt), "d MMM yyyy")}</span>,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const a = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem disabled={a.status === "active"} onSelect={() => run(() => adminSetAccountStatus([a._id], "active"))}>
                Enable
              </DropdownMenuItem>
              <DropdownMenuItem disabled={a.status === "disabled"} onSelect={() => run(() => adminSetAccountStatus([a._id], "disabled"))}>
                Disable
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => adminSetAccountStatus([a._id], "needs_reauth"))}>Force reconnect</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => run(() => adminRevokeAccounts([a._id]))}>
                Revoke & delete tokens
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      size={size}
      getRowId={(r) => r._id}
      searchPlaceholder="Search handle or name"
      initialHidden={{ connectedBy: false }}
      filters={[
        { param: "platform", title: "Platform", options: ALL_TARGET_PLATFORMS.map((p) => ({ value: p, label: PLATFORMS[p].name, icon: <PlatformIcon platform={p} className="size-3.5" /> })) },
        {
          param: "status",
          title: "Status",
          options: ["active", "needs_reauth", "disabled", "revoked"].map((s) => ({ value: s, label: s.replace("_", " ") })),
        },
      ]}
      bulkActions={(sel, clear) => {
        const ids = sel.map((r) => r.original._id);
        return (
          <>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminSetAccountStatus(ids, "active"), clear)}>
              Enable
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminSetAccountStatus(ids, "disabled"), clear)}>
              Disable
            </Button>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => adminRevokeAccounts(ids), clear)}>
              Revoke
            </Button>
          </>
        );
      }}
    />
  );
}
