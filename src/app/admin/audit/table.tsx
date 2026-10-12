"use client";

import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/column-header";
import type { AdminAuditRow } from "@/lib/queries/admin";
import { cn } from "@/lib/utils";

const columns: ColumnDef<AdminAuditRow, unknown>[] = [
  {
    id: "createdAt",
    meta: { label: "When" },
    header: ({ column }) => <DataTableColumnHeader column={column} title="When" sortKey="createdAt" />,
    cell: ({ row }) => <span className="font-mono text-xs">{format(new Date(row.original.createdAt), "d MMM yyyy HH:mm:ss")}</span>,
  },
  {
    id: "action",
    meta: { label: "Action" },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Action" sortKey="action" />,
    cell: ({ row }) => <span className={cn("font-mono text-xs", row.original.action.startsWith("admin.") && "text-signal")}>{row.original.action}</span>,
  },
  { id: "actorEmail", meta: { label: "Actor" }, header: "Actor", cell: ({ row }) => <span className="text-sm">{row.original.actorEmail ?? "system"}</span> },
  { id: "workspace", meta: { label: "Workspace" }, header: "Workspace", cell: ({ row }) => <span className="text-sm">{row.original.workspace ?? "—"}</span> },
  {
    id: "entity",
    meta: { label: "Entity" },
    header: "Entity",
    cell: ({ row }) => (
      <span className="font-mono text-[11px] text-muted-foreground">
        {row.original.entity}
        {row.original.entityId && ` · ${row.original.entityId.slice(-8)}`}
      </span>
    ),
  },
  {
    id: "meta",
    meta: { label: "Details" },
    header: "Details",
    cell: ({ row }) => <span className="block max-w-[320px] truncate font-mono text-[11px] text-muted-foreground">{row.original.meta ? JSON.stringify(row.original.meta) : ""}</span>,
  },
  { id: "ip", meta: { label: "IP" }, header: "IP", cell: ({ row }) => <span className="font-mono text-[11px]">{row.original.ip}</span> },
];

export function AuditTable({ rows, total, page, size, actions }: { rows: AdminAuditRow[]; total: number; page: number; size: number; actions: string[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      size={size}
      getRowId={(r) => r._id}
      searchPlaceholder="Search action, actor or entity"
      filters={[{ param: "action", title: "Action", options: actions.map((a) => ({ value: a, label: a })) }]}
    />
  );
}
