"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlatformIcon } from "@/components/platform-icon";
import { SectionTitle } from "@/components/shell/page-header";
import { adminUpdateSettings } from "@/lib/actions/admin";

type Settings = { registrationOpen: boolean; maintenanceMode: boolean; maxUploadMb: number; defaultPlan: string; announcement: string };
type Platform = { id: string; name: string; configured: boolean; envs: string[]; enabled: boolean };

export function SettingsForm({ settings, platforms }: { settings: Settings; platforms: Platform[] }) {
  const [state, action, pending] = useActionState(adminUpdateSettings, undefined);
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-10">
      <section>
        <SectionTitle n="01">General</SectionTitle>
        <div className="grid gap-6 rounded-md border bg-card p-5 md:grid-cols-2">
          <label className="flex items-start gap-3">
            <Switch name="registrationOpen" defaultChecked={settings.registrationOpen} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Open sign-ups</span>
              <span className="block text-xs text-muted-foreground">When off, only admins can create accounts.</span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <Switch name="maintenanceMode" defaultChecked={settings.maintenanceMode} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Pause publishing</span>
              <span className="block text-xs text-muted-foreground">n8n&apos;s claims return nothing until it&apos;s off. Scheduled posts wait, then go out.</span>
            </span>
          </label>
          <div className="grid gap-2">
            <Label htmlFor="maxUploadMb">Max upload size (MB)</Label>
            <Input id="maxUploadMb" name="maxUploadMb" type="number" min={1} max={5000} defaultValue={settings.maxUploadMb} className="font-mono" />
          </div>
          <div className="grid gap-2">
            <Label>Plan for new workspaces</Label>
            <Select name="defaultPlan" defaultValue={settings.defaultPlan}>
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
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="announcement">Announcement banner</Label>
            <Textarea id="announcement" name="announcement" defaultValue={settings.announcement} maxLength={240} placeholder="Shown at the top of every workspace. Leave empty to hide." className="min-h-16" />
          </div>
        </div>
      </section>
      <section>
        <SectionTitle n="02">Platforms</SectionTitle>
        <div className="grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-2">
          {platforms.map((p) => (
            <label key={p.id} className="flex items-center gap-3 bg-card px-4 py-3">
              <PlatformIcon platform={p.id} tone="chip" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{p.envs.length ? p.envs.join(" · ") : "no keys needed"}</span>
              </span>
              {p.envs.length > 0 && <Badge variant={p.configured ? "ok" : "outline"}>{p.configured ? "keys set" : "sandbox"}</Badge>}
              <Switch name={`platform_${p.id}`} defaultChecked={p.enabled} aria-label={`Enable ${p.name}`} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Turning a platform off hides it from Channels and the composer. Existing connections stay but can&apos;t be added.</p>
      </section>
      <Button disabled={pending} size="lg">
        Save settings
      </Button>
    </form>
  );
}
