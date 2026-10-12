"use client";

import { useActionState, useEffect, useEffectEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyIcon, ExternalLinkIcon, FlaskConicalIcon, MoreHorizontalIcon, PlusIcon, PlugIcon, HandIcon, WebhookIcon } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  connectSandboxAccountAction,
  createManualConnectorAction,
  createWebhookConnectorAction,
  disconnectAccountAction,
  setAccountEnabledAction,
} from "@/lib/actions/accounts";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import { msFromNow } from "@/lib/time";
import { TimeAgo } from "@/components/time-ago";

type Row = {
  id: string;
  platform: string;
  handle: string;
  displayName?: string;
  accountType?: string;
  profileUrl?: string;
  status: string;
  sandbox: boolean;
  endpoint?: string;
  expiresAt: string | null;
  published: number;
  queued: number;
  lastPublishedAt: string | null;
};

export function ChannelList({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [pending, start] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="grain rounded-md border border-dashed p-10 text-center">
        <p className="font-serif text-2xl">No channels yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">Connect a platform below to start publishing.</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border bg-card">
        {rows.map((r) => {
          const expSoon = r.expiresAt && msFromNow(r.expiresAt) < 7 * 86400000;
          return (
            <div key={r.id} className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b px-4 py-3.5 last:border-0 md:grid-cols-[auto_1.4fr_1fr_1fr_auto]", r.status === "disabled" && "opacity-60")}>
              <PlatformIcon platform={r.platform} tone="chip" className="size-9 p-2" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.handle}</span>
                  {r.sandbox && (
                    <Badge variant="outline" className="gap-1">
                      <FlaskConicalIcon /> Sandbox
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {PLATFORMS[r.platform as TargetPlatform]?.name} · {r.accountType ?? "account"}
                  {r.endpoint && ` · ${new URL(r.endpoint).host}`}
                </p>
              </div>
              <div className="hidden md:block">
                <p className="font-mono text-[13px] tabular-nums">
                  {r.published} sent <span className="text-muted-foreground">· {r.queued} queued</span>
                </p>
                <p className="text-xs text-muted-foreground">{r.lastPublishedAt ? <TimeAgo prefix="Last " date={r.lastPublishedAt} /> : "Nothing sent yet"}</p>
              </div>
              <div className="hidden md:block">
                <StatusBadge status={r.status} />
                {r.expiresAt && (
                  <p className={cn("mt-1 font-mono text-[10.5px]", expSoon ? "text-signal" : "text-muted-foreground")}>
                    token {new Date(r.expiresAt) < new Date() ? "expired" : <TimeAgo prefix="renews " date={r.expiresAt} />}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {canManage && (
                  <Switch
                    checked={r.status !== "disabled"}
                    disabled={pending}
                    onCheckedChange={(v) =>
                      start(async () => {
                        try {
                          await setAccountEnabledAction(r.id, v);
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      })
                    }
                    aria-label="Enabled"
                  />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="More">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {r.profileUrl && (
                      <DropdownMenuItem asChild>
                        <a href={r.profileUrl} target="_blank" rel="noreferrer">
                          <ExternalLinkIcon /> Open profile
                        </a>
                      </DropdownMenuItem>
                    )}
                    {r.status === "needs_reauth" && PLATFORMS[r.platform as TargetPlatform]?.oauth && (
                      <DropdownMenuItem asChild>
                        <a href={`/api/oauth/${r.platform}/start`}>
                          <PlugIcon /> Reconnect
                        </a>
                      </DropdownMenuItem>
                    )}
                    {canManage && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(r)}>
                          Disconnect
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </div>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirm?.handle}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its tokens are deleted and {confirm?.queued ? `${confirm.queued} queued deliveries are cancelled` : "nothing queued is affected"}. Posts already published stay on the platform.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                confirm &&
                start(async () => {
                  await disconnectAccountAction(confirm.id);
                  toast.success("Channel disconnected");
                  setConfirm(null);
                })
              }
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type PlatformTile = { id: string; name: string; notes: string; configured: boolean; connected: number };

export function ConnectGrid({
  platforms,
  demo,
  canManage,
  flash,
}: {
  platforms: PlatformTile[];
  demo: boolean;
  canManage: boolean;
  flash: { connected?: string; error?: string };
}) {
  const [sandboxFor, setSandboxFor] = useState<PlatformTile | null>(null);
  const [sandboxKey, setSandboxKey] = useState(0);

  useEffect(() => {
    if (flash.connected) toast.success(`${flash.connected} connected`);
    if (flash.error) toast.error(flash.error);
  }, [flash.connected, flash.error]);

  return (
    <>
      <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {platforms.map((p) => (
          <div key={p.id} className="flex flex-col bg-card p-4">
            <div className="flex items-center gap-3">
              <PlatformIcon platform={p.id} tone="chip" className="size-8 p-1.5" />
              <div>
                <p className="font-medium leading-tight">{p.name}</p>
                <p className="font-mono text-[10.5px] text-muted-foreground uppercase">{p.connected ? `${p.connected} connected` : p.configured ? "Ready" : demo ? "Sandbox only" : "Not set up"}</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-xs leading-relaxed text-muted-foreground">{p.notes}</p>
            <div className="mt-4">
              {!canManage ? (
                <p className="text-xs text-muted-foreground">Ask a workspace admin to connect.</p>
              ) : p.configured ? (
                <Button size="sm" variant="outline" className="w-full" asChild>
                  <a href={`/api/oauth/${p.id}/start`}>
                    <PlugIcon /> Connect with {p.name.split(" ")[0]}
                  </a>
                </Button>
              ) : demo ? (
                <Button size="sm" variant="outline" className="w-full border-dashed" onClick={() => {
                    setSandboxKey((k) => k + 1);
                    setSandboxFor(p);
                  }}>
                  <FlaskConicalIcon /> Add sandbox channel
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">The administrator hasn&apos;t added this platform&apos;s app keys yet.</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <SandboxDialog key={sandboxKey} platform={sandboxFor} onClose={() => setSandboxFor(null)} />
    </>
  );
}

function SandboxDialog({ platform, onClose }: { platform: PlatformTile | null; onClose: () => void }) {
  const [state, action, pending] = useActionState(connectSandboxAccountAction, undefined);
  const onSuccess = useEffectEvent((message?: string) => {
    toast.success(message);
    onClose();
  });
  useEffect(() => {
    if (state?.ok) onSuccess(state.message);
  }, [state]);
  return (
    <Dialog open={!!platform} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {platform && (
          <form action={action} className="grid gap-4">
            <input type="hidden" name="platform" value={platform.id} />
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PlatformIcon platform={platform.id} tone="chip" /> Sandbox {platform.name} channel
              </DialogTitle>
              <DialogDescription>
                Behaves like a connected account everywhere in Relay, but publishes nowhere. Real sign-in turns on once the {platform.name} app keys are added.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="handle">Handle or name</Label>
              <Input id="handle" name="handle" placeholder={platform.id === "youtube" ? "Northwind Studio" : "@northwind"} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input id="displayName" name="displayName" placeholder="Optional" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profileUrl">Profile URL</Label>
              <Input id="profileUrl" name="profileUrl" type="url" placeholder="https://" />
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Add channel
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CustomConnectors({ canManage }: { canManage: boolean }) {
  const [open, setOpen] = useState<"webhook" | "manual" | null>(null);
  const [openKey, setOpenKey] = useState(0);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <button
          disabled={!canManage}
          onClick={() => {
            setOpenKey((k) => k + 1);
            setOpen("webhook");
          }}
          className="group flex gap-4 rounded-md border bg-card p-5 text-left transition-colors hover:border-foreground/40 disabled:opacity-60"
        >
          <WebhookIcon className="size-6 shrink-0 text-muted-foreground group-hover:text-signal" strokeWidth={1.6} />
          <div>
            <p className="font-medium">Webhook</p>
            <p className="mt-1 text-sm text-muted-foreground">Send a signed JSON payload with the caption and media links to any HTTPS endpoint: your CMS, Zapier, Make, or an in-house tool.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
              <PlusIcon className="size-3.5" /> Add webhook
            </span>
          </div>
        </button>
        <button
          disabled={!canManage}
          onClick={() => {
            setOpenKey((k) => k + 1);
            setOpen("manual");
          }}
          className="group flex gap-4 rounded-md border bg-card p-5 text-left transition-colors hover:border-foreground/40 disabled:opacity-60"
        >
          <HandIcon className="size-6 shrink-0 text-muted-foreground group-hover:text-signal" strokeWidth={1.6} />
          <div>
            <p className="font-medium">Manual reminder</p>
            <p className="mt-1 text-sm text-muted-foreground">For a platform with no publishing API. At the scheduled time you get the file and caption, post it yourself, and mark it done.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
              <PlusIcon className="size-3.5" /> Add manual channel
            </span>
          </div>
        </button>
      </div>
      <WebhookDialog key={`w${openKey}`} open={open === "webhook"} onClose={() => setOpen(null)} />
      <ManualDialog key={`m${openKey}`} open={open === "manual"} onClose={() => setOpen(null)} />
    </>
  );
}

function WebhookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(createWebhookConnectorAction, undefined);
  const secret = state?.ok ? state.message : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {secret ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Webhook added</DialogTitle>
              <DialogDescription>Copy the signing secret now; it won&apos;t be shown again. Every request carries an X-Relay-Signature header: an HMAC-SHA256 of the body with this secret.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border bg-muted p-2 font-mono text-xs">
              <span className="flex-1 truncate">{secret}</span>
              <Button size="icon-sm" variant="ghost" onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success("Copied"))}>
                <CopyIcon />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New webhook destination</DialogTitle>
              <DialogDescription>HTTPS only. Private network addresses are refused.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="wh-name">Name</Label>
              <Input id="wh-name" name="name" placeholder="Company blog" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wh-url">Endpoint URL</Label>
              <Input id="wh-url" name="endpointUrl" type="url" placeholder="https://hooks.example.com/relay" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wh-auth">Authorization header</Label>
              <Input id="wh-auth" name="authHeader" placeholder="Bearer … (optional, stored encrypted)" />
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Add webhook
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(createManualConnectorAction, undefined);
  const onSuccess = useEffectEvent((message?: string) => {
    toast.success(message);
    onClose();
  });
  useEffect(() => {
    if (state?.ok) onSuccess(state.message);
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form action={action} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New manual channel</DialogTitle>
            <DialogDescription>Give it the name of the platform or profile you&apos;ll post to yourself.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="mn-name">Name</Label>
            <Input id="mn-name" name="name" placeholder="Snapchat · @northwind" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mn-url">Profile URL</Label>
            <Input id="mn-url" name="profileUrl" type="url" placeholder="https://" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mn-email">Remind this email</Label>
            <Input id="mn-email" name="notifyEmail" type="email" placeholder="Defaults to yours" />
          </div>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Add channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
