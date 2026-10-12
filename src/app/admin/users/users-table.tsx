"use client";

import Link from "next/link";
import { useActionState, useEffect, useEffectEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CopyIcon, MoreHorizontalIcon, ShieldIcon, UserPlusIcon, KeyRoundIcon, BanIcon, CircleCheckIcon, Trash2Icon, EyeIcon } from "lucide-react";
import { DataTable, selectColumn } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/column-header";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AdminUserRow } from "@/lib/queries/admin";
import { adminCreateUser, adminDeleteUsers, adminResetPassword, adminSetUserRole, adminSetUserStatus } from "@/lib/actions/admin";
import { initials } from "@/lib/utils";
import { TimeAgo } from "@/components/time-ago";

type Res = { ok: boolean; message: string; secret?: string };

export function UsersTable({ rows, total, page, size }: { rows: AdminUserRow[]; total: number; page: number; size: number }) {
  const [pending, start] = useTransition();
  const [secret, setSecret] = useState<{ who: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string; done?: () => void } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const router = useRouter();

  const run = (fn: () => Promise<Res>, after?: (r: Res) => void) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      after?.(r);
    });

  const columns: ColumnDef<AdminUserRow, unknown>[] = [
    selectColumn<AdminUserRow>(),
    {
      id: "name",
      accessorKey: "name",
      meta: { label: "User" },
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} title="User" sortKey="name" />,
      cell: ({ row }) => (
        <Link href={`/admin/users/${row.original._id}`} className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
          <Avatar className="size-8">
            <AvatarFallback className={row.original.role === "admin" ? "bg-signal/15 text-signal" : undefined}>{initials(row.original.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-medium">
              {row.original.name}
              {row.original.role === "admin" && <ShieldIcon className="size-3.5 text-signal" />}
            </span>
            <span className="block text-xs text-muted-foreground">{row.original.email}</span>
          </span>
        </Link>
      ),
    },
    {
      id: "role",
      accessorKey: "role",
      meta: { label: "Role" },
      header: "Role",
      cell: ({ row }) => <Badge variant={row.original.role === "admin" ? "signal" : "secondary"}>{row.original.role}</Badge>,
    },
    { id: "status", accessorKey: "status", meta: { label: "Status" }, header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: "workspaceCount",
      meta: { label: "Workspaces" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Workspaces" sortKey="workspaceCount" />,
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono tabular-nums">{row.original.workspaceCount}</span>
              <span className="max-w-[140px] truncate text-xs text-muted-foreground">{row.original.workspaces[0]?.name}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {row.original.workspaces.map((w) => (
              <div key={w.id}>
                {w.name} · {w.role} · {w.plan}
              </div>
            ))}
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "postCount",
      meta: { label: "Posts" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Posts" sortKey="postCount" className="justify-end" />,
      cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.postCount}</span>,
    },
    {
      id: "publishedCount",
      meta: { label: "Delivered" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Delivered" sortKey="publishedCount" />,
      cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.publishedCount}</span>,
    },
    {
      id: "accountCount",
      meta: { label: "Channels" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Channels" sortKey="accountCount" />,
      cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.accountCount}</span>,
    },
    {
      id: "createdAt",
      meta: { label: "Joined" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Joined" sortKey="createdAt" />,
      cell: ({ row }) => <span className="font-mono text-xs">{format(new Date(row.original.createdAt), "d MMM yyyy")}</span>,
    },
    {
      id: "lastLoginAt",
      meta: { label: "Last seen" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last seen" sortKey="lastLoginAt" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.lastLoginAt ? <TimeAgo date={row.original.lastLoginAt} /> : "Never"}</span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()} aria-label="Actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>{u.email}</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={`/admin/users/${u._id}`}>
                  <EyeIcon /> View details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(u.email).then(() => toast("Email copied"))}>
                <CopyIcon /> Copy email
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => run(() => adminSetUserRole([u._id], u.role === "admin" ? "user" : "admin"))}>
                <ShieldIcon /> {u.role === "admin" ? "Remove admin" : "Make admin"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => adminResetPassword(u._id), (r) => r.secret && setSecret({ who: u.email, value: r.secret }))}>
                <KeyRoundIcon /> Reset password
              </DropdownMenuItem>
              {u.status === "suspended" ? (
                <DropdownMenuItem onSelect={() => run(() => adminSetUserStatus([u._id], "active"))}>
                  <CircleCheckIcon /> Reactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => run(() => adminSetUserStatus([u._id], "suspended"))}>
                  <BanIcon /> Suspend
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete({ ids: [u._id], label: u.name })}>
                <Trash2Icon /> Delete user
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
        searchPlaceholder="Search name or email"
        initialHidden={{ accountCount: false }}
        onRowClick={(r) => router.push(`/admin/users/${r._id}`)}
        filters={[
          { param: "role", title: "Role", options: [{ value: "admin", label: "Admin" }, { value: "user", label: "User" }] },
          {
            param: "status",
            title: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
              { value: "invited", label: "Invited" },
            ],
          },
        ]}
        toolbarExtra={
          <Button size="sm" className="h-8" onClick={() => {
              setCreateKey((k) => k + 1);
              setCreateOpen(true);
            }}>
            <UserPlusIcon /> Add user
          </Button>
        }
        bulkActions={(sel, clear) => {
          const ids = sel.map((r) => r.original._id);
          return (
            <>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminSetUserStatus(ids, "active"), clear)}>
                Activate
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminSetUserStatus(ids, "suspended"), clear)}>
                Suspend
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => adminSetUserRole(ids, "admin"), clear)}>
                Make admin
              </Button>
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => setConfirmDelete({ ids, label: `${ids.length} users`, done: clear })}>
                Delete
              </Button>
            </>
          );
        }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Workspaces they own alone are deleted with all their channels, media and posts. Shared workspaces pass to another admin member. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => confirmDelete && run(() => adminDeleteUsers(confirmDelete.ids), () => { confirmDelete.done?.(); setConfirmDelete(null); })}>
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      <CreateUserDialog key={createKey} open={createOpen} onOpenChange={setCreateOpen} onSecret={(who, value) => setSecret({ who, value })} />
    </>
  );
}

function SecretDialog({ secret, onClose }: { secret: { who: string; value: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>For {secret?.who}. It&apos;s shown once; send it over a private channel and ask them to change it.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
          <span className="flex-1">{secret?.value}</span>
          <Button size="icon-sm" variant="ghost" onClick={() => secret && navigator.clipboard.writeText(secret.value).then(() => toast("Copied"))}>
            <CopyIcon />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({ open, onOpenChange, onSecret }: { open: boolean; onOpenChange: (o: boolean) => void; onSecret: (who: string, v: string) => void }) {
  const [state, action, pending] = useActionState(adminCreateUser, undefined);
  const onSuccess = useEffectEvent((message: string, secret: string) => {
    toast.success(message);
    onOpenChange(false);
    onSecret(message, secret);
  });
  useEffect(() => {
    if (state?.ok && state.secret) onSuccess(state.message ?? "", state.secret);
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={action} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a user</DialogTitle>
            <DialogDescription>Creates the account with its own workspace and a temporary password.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cu-name">Name</Label>
            <Input id="cu-name" name="name" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cu-email">Email</Label>
            <Input id="cu-email" name="email" type="email" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select name="role" defaultValue="user">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Workspace plan</Label>
              <Select name="plan" defaultValue="free">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["free", "creator", "studio", "agency"].map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button disabled={pending}>Create user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
