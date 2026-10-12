"use client";

import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { changeMemberRoleAction, inviteMemberAction, removeMemberAction, updateProfileAction, updateWorkspaceAction } from "@/lib/actions/workspace";
import type { FormState } from "@/lib/actions/auth";
import { initials } from "@/lib/utils";
import { TimeAgo } from "@/components/time-ago";

function useToastState(state: FormState) {
  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    if (state?.error) toast.error(state.error);
  }, [state]);
}

function TimezoneSelect({ name, value, zones, disabled }: { name: string; value: string; zones: string[]; disabled?: boolean }) {
  return (
    <Select name={name} defaultValue={value} disabled={disabled}>
      <SelectTrigger className="w-full font-mono text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {zones.map((z) => (
          <SelectItem key={z} value={z} className="font-mono text-xs">
            {z}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WorkspaceForm({ name, timezone, requireApproval, zones, disabled }: { name: string; timezone: string; requireApproval: boolean; zones: string[]; disabled: boolean }) {
  const [state, action, pending] = useActionState(updateWorkspaceAction, undefined);
  useToastState(state);
  return (
    <form action={action} className="grid gap-5 rounded-xl border bg-card p-5">
      <div className="grid gap-2">
        <Label htmlFor="ws-name">Name</Label>
        <Input id="ws-name" name="name" defaultValue={name} disabled={disabled} />
      </div>
      <div className="grid gap-2">
        <Label>Timezone</Label>
        <TimezoneSelect name="timezone" value={timezone} zones={zones} disabled={disabled} />
        <p className="text-xs text-muted-foreground">Schedules and the calendar use this zone. Times are stored in UTC, so daylight saving is handled.</p>
      </div>
      <label className="flex items-start gap-3">
        <Switch name="requireApproval" defaultChecked={requireApproval} disabled={disabled} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium">Require approval</span>
          <span className="block text-xs text-muted-foreground">Editors&apos; posts wait for an owner, admin or approver before they go out.</span>
        </span>
      </label>
      {!disabled && (
        <Button disabled={pending} className="justify-self-start">
          Save workspace
        </Button>
      )}
    </form>
  );
}

export function ProfileForm({ name, email, timezone, zones }: { name: string; email: string; timezone: string; zones: string[] }) {
  const [state, action, pending] = useActionState(updateProfileAction, undefined);
  useToastState(state);
  return (
    <form action={action} className="grid gap-5 rounded-xl border bg-card p-5">
      <div className="grid gap-2">
        <Label htmlFor="p-name">Name</Label>
        <Input id="p-name" name="name" defaultValue={name} />
      </div>
      <div className="grid gap-2">
        <Label>Email</Label>
        <Input value={email} disabled />
      </div>
      <div className="grid gap-2">
        <Label>Your timezone</Label>
        <TimezoneSelect name="timezone" value={timezone} zones={zones} />
      </div>
      <Button disabled={pending} className="justify-self-start">
        Save profile
      </Button>
    </form>
  );
}

type Member = { userId: string; role: string; name: string; email: string; lastLoginAt?: string; posts: number };

export function MembersTable({ members, canManage, selfId }: { members: Member[]; canManage: boolean; selfId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Posts</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.userId}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Avatar className="size-7">
                    <AvatarFallback>{initials(m.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      {m.name} {m.userId === selfId && <span className="text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {canManage && m.role !== "owner" && m.userId !== selfId ? (
                  <Select defaultValue={m.role} disabled={pending} onValueChange={(v) => start(async () => { await changeMemberRoleAction(m.userId, v); toast.success("Role updated"); })}>
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["admin", "approver", "editor", "viewer"].map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
                )}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{m.posts}</TableCell>
              <TableCell className="text-muted-foreground">{m.lastLoginAt ? <TimeAgo date={m.lastLoginAt} /> : "Never"}</TableCell>
              <TableCell className="text-right">
                {canManage && m.role !== "owner" && m.userId !== selfId && (
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => start(async () => { await removeMemberAction(m.userId); toast("Removed"); })}>
                    Remove
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMemberAction, undefined);
  useToastState(state);
  return (
    <form action={action} className="mt-4 flex flex-col gap-2 sm:flex-row">
      <Input name="email" type="email" placeholder="teammate@studio.com" required className="sm:max-w-xs" />
      <Select name="role" defaultValue="editor">
        <SelectTrigger className="sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["admin", "approver", "editor", "viewer"].map((r) => (
            <SelectItem key={r} value={r} className="capitalize">
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={pending} variant="outline">
        Add member
      </Button>
    </form>
  );
}
