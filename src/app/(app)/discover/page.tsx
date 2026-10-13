import type { Metadata } from "next";
import { getWorkspaceContext } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { SocialAccount, oid } from "@/lib/models";
import { PLAN_LIMITS } from "@/lib/plans";
import { demoMode } from "@/lib/publishing/n8n";
import { recentSearches, usedToday } from "@/lib/discover";
import { DISCOVER_SOURCES, type DiscoverSource } from "@/lib/discover/types";
import { PageHeader } from "@/components/shell/page-header";
import { DiscoverView } from "./discover-view";

export const metadata: Metadata = { title: "Discover" };

export default async function DiscoverPage() {
  const ctx = await getWorkspaceContext();
  await connectDB();
  const [used, recent, ig] = await Promise.all([
    usedToday(ctx.workspace.id),
    recentSearches(ctx.workspace.id),
    SocialAccount.exists({ workspaceId: oid(ctx.workspace.id), platform: "instagram", status: "active", sandbox: { $ne: true } }),
  ]);
  const ready: Record<DiscoverSource, boolean> = {
    youtube: Boolean(process.env.YOUTUBE_API_KEY),
    instagram: Boolean(ig),
    reddit: true,
    bluesky: true,
    mastodon: true,
    x: Boolean(process.env.X_BEARER_TOKEN),
  };
  const limit = (PLAN_LIMITS[ctx.workspace.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free).discoverPerDay;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Discover"
        title="What's working"
        description="Search YouTube, Instagram, Reddit, Bluesky, Mastodon and X for the content getting the most views and likes right now, see the keywords and hashtags behind it, and download what each platform allows."
      />
      <DiscoverView ready={ready} demo={demoMode()} used={used} limit={limit} recent={recent} sources={[...DISCOVER_SOURCES]} />
    </div>
  );
}
