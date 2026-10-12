import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { getNotifications } from "@/lib/queries/shell";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Relay admin" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const notifications = await getNotifications(user.id);
  const data = { user: { name: user.name, email: user.email, role: user.role } };
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r bg-sidebar md:block">
        <Sidebar data={data} mode="admin" />
      </aside>
      <div className="min-w-0">
        <div className="h-1 bg-[repeating-linear-gradient(90deg,var(--signal)_0_14px,transparent_14px_22px)]" />
        <Topbar data={data} notifications={notifications} mode="admin" />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
