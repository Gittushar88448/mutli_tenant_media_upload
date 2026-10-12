import { getWorkspaceContext } from "@/lib/auth/session";
import { getNotifications, getPlanUsage } from "@/lib/queries/shell";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { AppSettings } from "@/lib/models";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getWorkspaceContext();
  const [{ usage }, notifications, settings] = await Promise.all([
    getPlanUsage(ctx.workspace.id, ctx.workspace.plan),
    getNotifications(ctx.user.id),
    AppSettings.findOne({ key: "global" }).lean(),
  ]);
  const data = {
    user: { name: ctx.user.name, email: ctx.user.email, role: ctx.user.role },
    workspace: { id: ctx.workspace.id, name: ctx.workspace.name, plan: ctx.workspace.plan },
    workspaces: ctx.workspaces,
    usage,
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r bg-sidebar md:block">
        <Sidebar data={data} />
      </aside>
      <div className="min-w-0">
        {settings?.announcement && (
          <div className="border-b bg-foreground px-6 py-2 text-center font-mono text-[11.5px] text-background">{settings.announcement}</div>
        )}
        <Topbar data={data} notifications={notifications} />
        <main className="mx-auto w-full max-w-[1320px] px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
