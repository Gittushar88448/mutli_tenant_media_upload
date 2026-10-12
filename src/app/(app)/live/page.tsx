import type { Metadata } from "next";
import { after } from "next/server";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { getLiveOverview } from "@/lib/live/queries";
import { PageHeader } from "@/components/shell/page-header";
import { LiveView, RefreshAllButton } from "./live-view";

export const metadata: Metadata = { title: "Live view" };

export default async function LivePage({ searchParams }: { searchParams: Promise<{ tab?: string; platform?: string }> }) {
  const ctx = await getWorkspaceContext();
  const sp = await searchParams;
  // Stale posts get a few seconds to refresh; slower platforms finish after the response
  // and appear on the next auto-refresh.
  const { pending, ...data } = await getLiveOverview(ctx.workspace.id, { budgetMs: 4000 });
  if (pending) after(() => pending.then(() => undefined));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Live view"
        title="How it's landing"
        description="Your published posts as the platforms see them right now: views, likes and comments, whether each post is still up, and the health of every connected channel. Reply to comments without leaving Relay."
        actions={<RefreshAllButton />}
      />
      <LiveView
        data={data}
        initialTab={sp.tab === "comments" || sp.tab === "channels" ? sp.tab : "posts"}
        initialPlatform={sp.platform ?? "all"}
        canReply={can(ctx.role, "editor")}
      />
    </div>
  );
}
