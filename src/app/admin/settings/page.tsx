import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { AppSettings } from "@/lib/models";
import { ALL_TARGET_PLATFORMS, PLATFORMS, isPlatformConfigured } from "@/lib/platforms";
import { demoMode, n8nConfigured } from "@/lib/publishing/n8n";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { SettingsForm } from "./form";

export const metadata: Metadata = { title: "Platform settings" };

export default async function AdminSettings() {
  await requireAdmin();
  const s = await AppSettings.findOne({ key: "global" }).lean();
  const env = [
    { key: "MONGODB_URI", ok: !!process.env.MONGODB_URI, note: "Database connection" },
    { key: "AUTH_SECRET", ok: (process.env.AUTH_SECRET?.length ?? 0) >= 32, note: "Signs sessions (32+ chars)" },
    { key: "TOKEN_ENCRYPTION_KEY", ok: !!process.env.TOKEN_ENCRYPTION_KEY, note: "Encrypts social tokens at rest" },
    { key: "APP_URL", ok: !!process.env.APP_URL, note: "Public URL for OAuth callbacks and media links" },
    { key: "N8N_SHARED_SECRET", ok: !!process.env.N8N_SHARED_SECRET, note: "Authenticates n8n's calls" },
    { key: "N8N_PUBLISH_NOW_WEBHOOK_URL", ok: !!process.env.N8N_PUBLISH_NOW_WEBHOOK_URL, note: "n8n webhook for Publish now" },
  ];
  const platforms = ALL_TARGET_PLATFORMS.map((p) => ({
    id: p,
    name: PLATFORMS[p].name,
    configured: isPlatformConfigured(p),
    envs: PLATFORMS[p].oauth ? [PLATFORMS[p].oauth!.clientIdEnv, PLATFORMS[p].oauth!.clientSecretEnv] : [],
    enabled: !(s?.disabledPlatforms ?? []).includes(p),
  }));

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Admin · Platform settings" title="How the platform runs" description="Changes apply immediately to every workspace." />
      <SettingsForm
        settings={{
          registrationOpen: s?.registrationOpen ?? true,
          maintenanceMode: s?.maintenanceMode ?? false,
          maxUploadMb: s?.maxUploadMb ?? 512,
          defaultPlan: s?.defaultPlan ?? "free",
          announcement: s?.announcement ?? "",
        }}
        platforms={platforms}
      />
      <section>
        <SectionTitle n="03" aside={<span className="font-mono text-[11px] text-muted-foreground">{demoMode() ? "demo mode on" : "demo mode off"} · n8n {n8nConfigured() ? "connected" : "not configured"}</span>}>
          Environment
        </SectionTitle>
        <div className="overflow-hidden rounded-xl border bg-card">
          {env.map((e) => (
            <div key={e.key} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-0">
              <span className={`size-2 rounded-full ${e.ok ? "bg-ok" : "bg-signal"}`} />
              <span className="font-mono text-xs">{e.key}</span>
              <span className="ml-auto text-xs text-muted-foreground">{e.note}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
