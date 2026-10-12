"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { MoreHorizontalIcon } from "lucide-react";
import { DataTable, selectColumn } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/column-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AdminWorkspaceRow } from "@/lib/queries/admin";
import { adminDeleteWorkspaces, adminSetWorkspacePlan, adminSetWorkspaceStatus } from "@/lib/actions/admin";
import { formatBytes } from "@/lib/utils";

const PLANS = ["free", "creator", "studio", "agency"];
const num = (v: number) => <span className="font-mono tabular-nums">{v}</span>;

export function WorkspacesTable({ rows, total, page, size }: { rows: AdminWorkspaceRow[]; total: number; page: number; size: number }) {
  const [pending, start] = useTransition();
  const [del, setDel] = useState<{ ids: string[]; label: string; done?: () => void } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      after?.();
    });

  const columns: ColumnDef<AdminWorkspaceRow, unknown>[] = [
    selectColumn<AdminWorkspaceRow>(),
    {
      id: "name",
      meta: { label: "Workspace" },
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Workspace" sortKey="name" />,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="font-mono text-[10.5px] text-muted-foreground">{row.original.slug}</p>
        </div>
      ),
    },
    {
      id: "owner",
      meta: { label: "Owner" },
      header: "Owner",
      cell: ({ row }) => (
        <div className="text-sm">
          <p>{row.original.owner?.name ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{row.original.owner?.email}</p>
        </div>
      ),
    },
    {
      id: "plan",
      meta: { label: "Plan" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Plan" sortKey="plan" />,
      cell: ({ row }) => <Badge variant={row.original.plan === "free" ? "secondary" : row.original.plan === "agency" ? "signal" : "outline"}>{row.original.plan}</Badge>,
    },
    { id: "status", meta: { label: "Status" }, header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: "members", meta: { label: "Members" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Members" sortKey="members" />, cell: ({ row }) => num(row.original.members) },
    { id: "accounts", meta: { label: "Channels" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Channels" sortKey="accounts" />, cell: ({ row }) => num(row.original.accounts) },
    { id: "posts", meta: { label: "Posts" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Posts" sortKey="posts" />, cell: ({ row }) => num(row.original.posts) },
    { id: "published", meta: { label: "Delivered" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Delivered" sortKey="published" />, cell: ({ row }) => num(row.original.published) },
    {
      id: "storageBytes",
      meta: { label: "Storage" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Storage" sortKey="storageBytes" />,
      cell: ({ row }) => <span className="font-mono text-xs">{formatBytes(row.original.storageBytes)}</span>,
    },
    {
      id: "createdAt",
      meta: { label: "Created" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Created" sortKey="createdAt" />,
      cell: ({ row }) => <span className="font-mono text-xs">{format(new Date(row.original.createdAt), "d MMM yyyy")}</span>,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const w = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{w.name}</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Change plan</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={w.plan} onValueChange={(v) => run(() => adminSetWorkspacePlan([w._id], v))}>
                    {PLANS.map((p) => (
                      <DropdownMenuRadioItem key={p} value={p} className="capitalize">
                        {p}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => run(() => adminSetWorkspaceStatus([w._id], w.status === "suspended" ? "active" : "suspended"))}>
                {w.status === "suspended" ? "Reactivate" : "Suspend"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDel({ ids: [w._id], label: w.name })}>
                Delete workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        total={total}
        page={page}
        size={size}
        getRowId={(r) => r._id}
        searchPlaceholder="Search workspaces"
        filters={[
          { param: "plan", title: "Plan", options: PLANS.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) })) },
          { param: "status", title: "Status", options: [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }] },
        ]}
        bulkActions={(sel, clear) => {
          const ids = sel.map((r) => r.original._id);
          return (
            <>
              {PLANS.map((p) => (
                <Button key={p} size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminSetWorkspacePlan(ids, p), clear)} className="capitalize">
                  → {p}
                </Button>
              ))}
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminSetWorkspaceStatus(ids, "suspended"), clear)}>
                Suspend
              </Button>
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => setDel({ ids, label: `${ids.length} workspaces`, done: clear })}>
                Delete
              </Button>
            </>
          );
        }}
      />
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {del?.label}?</AlertDialogTitle>
            <AlertDialogDescription>Removes every channel, token, media file, post and delivery record in it. Members lose access. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => del && run(() => adminDeleteWorkspaces(del.ids), () => { del.done?.(); setDel(null); })}>
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
