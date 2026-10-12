"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ExternalLinkIcon, MoreHorizontalIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { DataTable, selectColumn } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/column-header";
import { StatusBadge } from "@/components/status-badge";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AdminTargetRow } from "@/lib/queries/admin";
import { adminCancelTargets, adminRetryTargets } from "@/lib/actions/admin";
import { ALL_TARGET_PLATFORMS, PLATFORMS } from "@/lib/platforms";
import { TARGET_STATUSES } from "@/lib/models/statuses";

export function TargetsTable({ rows, total, page, size }: { rows: AdminTargetRow[]; total: number; page: number; size: number }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      after?.();
    });

  const columns: ColumnDef<AdminTargetRow, unknown>[] = [
    selectColumn<AdminTargetRow>(),
    {
      id: "caption",
      meta: { label: "Post" },
      enableHiding: false,
      header: "Post",
      cell: ({ row }) => (
        <div className="max-w-[280px]">
          <p className="truncate">{row.original.caption || <span className="text-muted-foreground italic">No caption</span>}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.original.workspace} · {row.original.author}
          </p>
        </div>
      ),
    },
    {
      id: "platform",
      meta: { label: "Channel" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Channel" sortKey="platform" />,
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <PlatformIcon platform={row.original.platform} />
          <span className="max-w-[140px] truncate">{row.original.handle}</span>
        </span>
      ),
    },
    { id: "postType", meta: { label: "Type" }, header: "Type", cell: ({ row }) => <span className="font-mono text-xs uppercase">{row.original.postType}</span> },
    {
      id: "status",
      meta: { label: "Status" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" sortKey="status" />,
      cell: ({ row }) =>
        row.original.lastErrorCode && row.original.status !== "published" ? (
          <Tooltip>
            <TooltipTrigger>
              <StatusBadge status={row.original.status} />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {row.original.lastErrorCode}: {row.original.lastErrorMessage}
            </TooltipContent>
          </Tooltip>
        ) : (
          <StatusBadge status={row.original.status} />
        ),
    },
    {
      id: "lastErrorCode",
      meta: { label: "Error" },
      header: "Error",
      cell: ({ row }) => <span className="font-mono text-[11px] text-signal">{row.original.status !== "published" ? row.original.lastErrorCode : ""}</span>,
    },
    {
      id: "attempts",
      meta: { label: "Attempts" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tries" sortKey="attempts" />,
      cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.attempts}</span>,
    },
    {
      id: "scheduledAt",
      meta: { label: "Scheduled" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Scheduled" sortKey="scheduledAt" />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.scheduledAt ? format(new Date(row.original.scheduledAt), "d MMM HH:mm") : "—"}</span>,
    },
    {
      id: "updatedAt",
      meta: { label: "Updated" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" sortKey="updatedAt" />,
      cell: ({ row }) => <span className="font-mono text-xs">{format(new Date(row.original.updatedAt), "d MMM HH:mm")}</span>,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.original.permalink && (
              <DropdownMenuItem asChild>
                <a href={row.original.permalink} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon /> Open on platform
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!["failed", "needs_action", "cancelled"].includes(row.original.status)} onSelect={() => run(() => adminRetryTargets([row.original._id]))}>
              <RotateCcwIcon /> Retry
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!["scheduled", "retrying", "queued", "needs_action"].includes(row.original.status)}
              onSelect={() => run(() => adminCancelTargets([row.original._id]))}
            >
              <XIcon /> Cancel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
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
      searchPlaceholder="Search caption, workspace, handle, error"
      initialHidden={{ postType: false }}
      filters={[
        { param: "status", title: "Status", options: TARGET_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") })) },
        { param: "platform", title: "Platform", options: ALL_TARGET_PLATFORMS.map((p) => ({ value: p, label: PLATFORMS[p].name, icon: <PlatformIcon platform={p} className="size-3.5" /> })) },
      ]}
      bulkActions={(sel, clear) => {
        const ids = sel.map((r) => r.original._id);
        return (
          <>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminRetryTargets(ids), clear)}>
              <RotateCcwIcon /> Retry
            </Button>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => adminCancelTargets(ids), clear)}>
              Cancel
            </Button>
          </>
        );
      }}
    />
  );
}
