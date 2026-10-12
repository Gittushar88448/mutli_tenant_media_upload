"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { adminDeleteUsers, adminResetPassword, adminSetUserRole, adminSetUserStatus } from "@/lib/actions/admin";

export function UserDetailActions({ id, role, status, email }: { id: string; role: string; status: string; email: string }) {
  const [pending, start] = useTransition();
  const [temp, setTemp] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message: string; secret?: string }>) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.secret) setTemp(r.secret);
      router.refresh();
    });
  return (
    <>
      {temp && <span className="rounded-xl border bg-muted px-2 py-1 font-mono text-xs">{temp}</span>}
      <Button variant="outline" disabled={pending} onClick={() => run(() => adminResetPassword(id))}>
        Reset password
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => run(() => adminSetUserRole([id], role === "admin" ? "user" : "admin"))}>
        {role === "admin" ? "Remove admin" : "Make admin"}
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => run(() => adminSetUserStatus([id], status === "suspended" ? "active" : "suspended"))}>
        {status === "suspended" ? "Reactivate" : "Suspend"}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={pending}>
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {email}?</AlertDialogTitle>
            <AlertDialogDescription>Workspaces they own alone are deleted with everything in them. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                start(async () => {
                  const r = await adminDeleteUsers([id]);
                  (r.ok ? toast.success : toast.error)(r.message);
                  if (r.ok) router.push("/admin/users");
                })
              }
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
