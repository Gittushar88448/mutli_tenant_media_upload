"use client";

import { useActionState, useSyncExternalStore } from "react";
import { ArrowRightIcon, Loader2Icon } from "lucide-react";
import { registerAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm({ compact }: { compact?: boolean }) {
  const [state, action, pending] = useActionState(registerAction, undefined);
  // Browser timezone, read without an effect; the server render falls back to UTC.
  const tz = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "UTC"
  );
  const err = (k: string) => state?.fieldErrors?.[k]?.[0];

  return (
    <form action={action} className={compact ? "grid gap-5" : "mt-8 grid gap-5"}>
      <input type="hidden" name="timezone" value={tz} />
      <Field id="name" label="Your name" error={err("name")}>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!err("name")} />
      </Field>
      <Field id="email" label="Work email" error={err("email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!err("email")} />
      </Field>
      <Field id="password" label="Password" error={err("password")} hint="8 characters or more">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!err("password")} />
      </Field>
      <Field id="workspace" label="Workspace name" error={err("workspace")} hint="Usually your brand or client">
        <Input id="workspace" name="workspace" required placeholder="Northwind Studio" aria-invalid={!!err("workspace")} />
      </Field>
      {state?.error && <p className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="lg" disabled={pending} className="justify-between">
        Create workspace
        {pending ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
      </Button>
      <p className="font-mono text-[11px] text-muted-foreground">Timezone detected: {tz}</p>
    </form>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>{label}</Label>
        {hint && !error && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
