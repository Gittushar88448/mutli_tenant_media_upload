"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BellIcon, MenuIcon, PenLineIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { markNotificationsReadAction } from "@/lib/actions/workspace";
import { APP_NAV, ADMIN_NAV } from "./nav";
import { Sidebar, type ShellData } from "./sidebar";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/time-ago";

export type NotificationItem = { id: string; title: string; body?: string; href?: string; createdAt: string; read: boolean; kind: string };

export function Topbar({ data, notifications, mode = "app" }: { data: ShellData; notifications: NotificationItem[]; mode?: "app" | "admin" }) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setCmdOpen(false);
    router.push(href);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md md:px-6">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
        <MenuIcon />
      </Button>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar data={data} mode={mode} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <button
        onClick={() => setCmdOpen(true)}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-xl border bg-card/50 px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-card"
      >
        <SearchIcon className="size-3.5" />
        Jump to…
        <kbd className="ml-auto rounded border bg-background px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <Notifications items={notifications} />
        {mode === "app" && (
          <Button asChild size="sm" variant="signal" className="hidden sm:inline-flex">
            <Link href="/compose">
              <PenLineIcon /> New post
            </Link>
          </Button>
        )}
      </div>

      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Where to?" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Workspace">
            {APP_NAV.map((n) => (
              <CommandItem key={n.href} onSelect={() => go(n.href)}>
                <n.icon /> {n.label}
                <CommandShortcut>{n.key}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          {data.user.role === "admin" && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Admin">
                {ADMIN_NAV.map((n) => (
                  <CommandItem key={n.href} onSelect={() => go(n.href)}>
                    <n.icon /> {n.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </header>
  );
}

function Notifications({ items }: { items: NotificationItem[] }) {
  const unread = items.filter((i) => !i.read).length;
  const [pending, start] = useTransition();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
          <BellIcon />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-signal font-mono text-[9px] font-bold text-signal-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="eyebrow">Notifications</span>
          {unread > 0 && (
            <button className="text-xs text-muted-foreground hover:text-foreground" disabled={pending} onClick={() => start(() => markNotificationsReadAction())}>
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>}
          {items.map((n) => (
            <Link key={n.id} href={n.href ?? "#"} className={cn("block border-b px-4 py-3 last:border-0 hover:bg-accent/50", !n.read && "bg-signal/[0.04]")}>
              <div className="flex items-start gap-2">
                {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-signal" />}
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-snug">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground"><TimeAgo date={n.createdAt} /></p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
