"use client";

import { useActionState, useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { BookOpenIcon, FlaskConicalIcon, KeyRoundIcon, PlugIcon } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { connectCommunityAction, connectSandboxAccountAction } from "@/lib/actions/accounts";
import { COMMUNITY_PLATFORMS, PLATFORMS, type CommunityId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

export type CommunityTile = { id: CommunityId; connected: number; disabled?: boolean };

/** Grid of community platforms, each opening a connect form with that platform's credentials. */
export function CommunityConnectGrid({
  tiles,
  demo,
  canManage,
  initial,
  className,
}: {
  tiles: CommunityTile[];
  demo: boolean;
  canManage: boolean;
  /** Opens this platform's connect form on load (the guide links here with ?connect=…). */
  initial?: CommunityId;
  className?: string;
}) {
  const [open, setOpen] = useState<CommunityId | null>(canManage && initial && tiles.some((t) => t.id === initial && !t.disabled) ? initial : null);
  const [key, setKey] = useState(0);
  return (
    <>
      <div className={cn("grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-3", className)}>
        {tiles.map((t) => {
          const spec = PLATFORMS[t.id];
          return (
            <div key={t.id} className="flex flex-col bg-card p-4">
              <div className="flex items-center gap-3">
                <PlatformIcon platform={t.id} tone="chip" className="size-8 p-1.5" />
                <div>
                  <p className="font-medium leading-tight">{spec.name}</p>
                  <p className="font-mono text-[10.5px] text-muted-foreground uppercase">{t.connected ? `${t.connected} connected` : spec.noun}</p>
                </div>
              </div>
              <p className="mt-3 flex-1 text-xs leading-relaxed text-muted-foreground">{spec.notes}</p>
              <div className="mt-4">
                {!canManage ? (
                  <p className="text-xs text-muted-foreground">Ask a workspace admin to connect.</p>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={t.disabled}
                    onClick={() => {
                      setKey((k) => k + 1);
                      setOpen(t.id);
                    }}
                  >
                    <PlugIcon /> Connect {spec.name}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ConnectCommunityDialog key={key} platform={open} demo={demo} onClose={() => setOpen(null)} />
    </>
  );
}

function ConnectCommunityDialog({ platform, demo, onClose }: { platform: CommunityId | null; demo: boolean; onClose: () => void }) {
  const spec = platform ? COMMUNITY_PLATFORMS.find((p) => p.id === platform) : undefined;
  const [mode, setMode] = useState(spec?.credentials?.modes?.[0]?.id ?? "");
  const [sandbox, setSandbox] = useState(false);
  const [state, action, pending] = useActionState(connectCommunityAction, undefined);
  const [sbState, sbAction, sbPending] = useActionState(connectSandboxAccountAction, undefined);
  const onSuccess = useEffectEvent((message?: string) => {
    toast.success(message);
    onClose();
  });
  useEffect(() => {
    if (state?.ok) onSuccess(state.message);
  }, [state]);
  useEffect(() => {
    if (sbState?.ok) onSuccess(sbState.message);
  }, [sbState]);

  return (
    <Dialog open={!!spec} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {spec && !sandbox && (
          <form action={action} className="grid gap-4">
            <input type="hidden" name="platform" value={spec.id} />
            <input type="hidden" name="mode" value={mode} />
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PlatformIcon platform={spec.id} tone="chip" /> Connect {spec.name}
              </DialogTitle>
              <DialogDescription>
                Relay checks these details with {spec.name} before saving. Tokens are encrypted and never shown again.{" "}
                <a href={`/guide#community-${spec.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground underline decoration-signal decoration-2 underline-offset-4">
                  <BookOpenIcon className="size-3" /> Where to find them
                </a>
              </DialogDescription>
            </DialogHeader>
            {spec.credentials?.modes && (
              <div className="grid gap-2">
                <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v)} className="w-full">
                  {spec.credentials.modes.map((m) => (
                    <ToggleGroupItem key={m.id} value={m.id} className="flex-1">
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-xs leading-relaxed text-muted-foreground">{spec.credentials.modes.find((m) => m.id === mode)?.hint}</p>
              </div>
            )}
            {spec.credentials?.fields
              .filter((f) => !f.mode || f.mode === mode)
              .map((f) => (
                <div key={f.key} className="grid gap-2">
                  <Label htmlFor={`cc-${f.key}`} className="gap-1.5">
                    {f.type === "secret" && <KeyRoundIcon className="size-3.5 text-muted-foreground" />}
                    {f.label}
                    {f.required && <span className="text-signal">*</span>}
                  </Label>
                  {f.type === "textarea" ? (
                    <Textarea id={`cc-${f.key}`} name={f.key} placeholder={f.placeholder} required={f.required} className="min-h-20 font-mono text-xs" />
                  ) : (
                    <Input
                      id={`cc-${f.key}`}
                      name={f.key}
                      type={f.type === "secret" ? "password" : f.type === "url" ? "url" : "text"}
                      autoComplete="off"
                      placeholder={f.placeholder}
                      required={f.required}
                      className={f.type === "secret" ? "font-mono" : undefined}
                    />
                  )}
                  {f.hint && <p className="text-[11.5px] leading-snug text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter className="items-center sm:justify-between">
              {demo ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSandbox(true)}>
                  <FlaskConicalIcon /> Use a sandbox instead
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={pending}>
                {pending ? "Checking…" : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        )}
        {spec && sandbox && (
          <form action={sbAction} className="grid gap-4">
            <input type="hidden" name="platform" value={spec.id} />
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PlatformIcon platform={spec.id} tone="chip" /> Sandbox {spec.name} {spec.noun}
              </DialogTitle>
              <DialogDescription>Behaves like a real {spec.noun} everywhere in Relay, including rendering, but sends nothing.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="sb-handle">Name</Label>
              <Input id="sb-handle" name="handle" placeholder={spec.id === "discord" ? "#announcements" : spec.id === "slack" ? "#community" : "Northwind Community"} required />
            </div>
            {spec.id === "whatsapp" && (
              <div className="grid gap-2">
                <Label>Kind</Label>
                <select name="accountType" className="h-9 rounded-md border bg-transparent px-3 text-sm" defaultValue="group">
                  <option value="group">Group (Cloud API)</option>
                  <option value="channel">Channel or Community (assisted)</option>
                </select>
              </div>
            )}
            {sbState?.error && <p className="text-sm text-destructive">{sbState.error}</p>}
            <DialogFooter className="items-center sm:justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={() => setSandbox(false)}>
                Back to real connection
              </Button>
              <Button type="submit" disabled={sbPending}>
                Add sandbox
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
