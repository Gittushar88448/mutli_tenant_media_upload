"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { CheckIcon, ChevronsUpDownIcon, LogOutIcon, PlusIcon, ShieldIcon, MoonIcon, SunIcon, ArrowLeftIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn, initials } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { APP_NAV, ADMIN_NAV } from "./nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspaceAction, switchWorkspaceAction } from "@/lib/actions/workspace";
import { logoutAction } from "@/lib/actions/auth";

export type ShellData = {
  user: { name: string; email: string; role: "user" | "admin" };
  workspace?: { id: string; name: string; plan: string };
  workspaces?: { id: string; name: string; role: string; plan: string }[];
  usage?: { label: string; used: number; limit: number }[];
};

export function Sidebar({ data, mode = "app", onNavigate }: { data: ShellData; mode?: "app" | "admin"; onNavigate?: () => void }) {
  const pathname = usePathname();
  const nav = mode === "admin" ? ADMIN_NAV : APP_NAV;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo href={mode === "admin" ? "/admin" : "/dashboard"} />
        {mode === "admin" && <span className="ml-2 rounded-[4px] bg-signal px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-foreground">Admin</span>}
      </div>

      {mode === "app" && data.workspace && <WorkspaceSwitcher data={data} />}

      <nav className="mt-2 flex-1 space-y-px px-2">
        {mode === "admin" && <p className="eyebrow px-2 pt-3 pb-2">Platform</p>}
        {nav.map((item, i) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                active && "bg-sidebar-accent font-medium text-sidebar-foreground"
              )}
            >
              {active && <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r bg-signal" />}
              <item.icon className="size-4 opacity-80" strokeWidth={1.8} />
              {item.label}
              {mode === "app" && <span className="ml-auto font-mono text-[10px] text-muted-foreground/60 opacity-0 group-hover:opacity-100">{String(i + 1).padStart(2, "0")}</span>}
            </Link>
          );
        })}
        {data.user.role === "admin" && (
          <div className="pt-4">
            <Link
              href={mode === "admin" ? "/dashboard" : "/admin"}
              onClick={onNavigate}
              className="flex h-9 items-center gap-3 rounded-md border border-dashed px-2.5 text-[13px] text-muted-foreground hover:border-solid hover:text-foreground"
            >
              {mode === "admin" ? <ArrowLeftIcon className="size-4" /> : <ShieldIcon className="size-4" />}
              {mode === "admin" ? "Back to workspace" : "Admin panel"}
            </Link>
          </div>
        )}
      </nav>

      {mode === "app" && data.usage && (
        <div className="mx-3 mb-3 rounded-md border bg-card/50 p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="eyebrow">Plan</span>
            <span className="font-mono text-[11px] font-semibold uppercase">{data.workspace?.plan}</span>
          </div>
          <div className="space-y-2.5">
            {data.usage.map((u) => {
              const pct = Math.min(100, Math.round((u.used / Math.max(u.limit, 1)) * 100));
              return (
                <div key={u.label}>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-muted-foreground">{u.label}</span>
                    <span className="font-mono tabular-nums">
                      {u.used}/{u.limit}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-secondary">
                    <div className={cn("h-full rounded-full", pct > 85 ? "bg-signal" : "bg-foreground/70")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <UserMenu user={data.user} />
    </div>
  );
}

function WorkspaceSwitcher({ data }: { data: ShellData }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [state, action, creating] = useActionState(createWorkspaceAction, undefined);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="mx-3 flex items-center gap-2.5 rounded-md border bg-card/60 px-2.5 py-2 text-left transition-colors hover:bg-card disabled:opacity-60" disabled={pending}>
            <span className="flex size-7 items-center justify-center rounded-[5px] bg-foreground font-mono text-[11px] font-bold text-background">
              {initials(data.workspace!.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight">{data.workspace!.name}</span>
              <span className="block font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{data.workspace!.plan} plan</span>
            </span>
            <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {data.workspaces?.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => start(() => switchWorkspaceAction(w.id))}>
              <span className="flex size-5 items-center justify-center rounded-[4px] bg-secondary font-mono text-[9px] font-bold">{initials(w.name)}</span>
              <span className="flex-1 truncate">{w.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground uppercase">{w.role}</span>
              {w.id === data.workspace?.id && <CheckIcon className="size-3.5" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <PlusIcon /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={action} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New workspace</DialogTitle>
              <DialogDescription>Workspaces keep channels, media and posts separate. Agencies usually make one per client.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="ws-name">Name</Label>
              <Input id="ws-name" name="name" placeholder="Client name or brand" autoFocus />
              {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={creating}>
                Create workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserMenu({ user }: { user: ShellData["user"] }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div className="border-t p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-sidebar-accent">
            <Avatar className="size-8">
              <AvatarFallback className="bg-signal/15 text-signal">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{user.name}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{user.email}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel>{user.role === "admin" ? "Platform admin" : "Account"}</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/settings">Profile & workspace</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            {resolvedTheme === "dark" ? "Light" : "Dark"} mode
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => logoutAction()}>
            <LogOutIcon /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
