import type { Metadata } from "next";
import Link from "next/link";
import { getWorkspaceContext, can } from "@/lib/auth/session";
import { AppSettings, SocialAccount, oid } from "@/lib/models";
import { COMMUNITY_PLATFORMS, SOCIAL_PLATFORMS, isPlatformConfigured } from "@/lib/platforms";
import { demoMode } from "@/lib/publishing/n8n";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { ChannelList, ConnectGrid, CustomConnectors } from "./channels-client";
import { CommunityConnectGrid } from "@/components/community/connect";

export const metadata: Metadata = { title: "Channels" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const ctx = await getWorkspaceContext();
  const sp = await searchParams;
  const [accounts, settings] = await Promise.all([
    SocialAccount.aggregate([
      { $match: { workspaceId: oid(ctx.workspace.id), status: { $ne: "revoked" } } },
      { $lookup: { from: "oauthcredentials", localField: "_id", foreignField: "socialAccountId", as: "cred", pipeline: [{ $project: { expiresAt: 1 } }] } },
      {
        $lookup: {
          from: "posttargets",
          localField: "_id",
          foreignField: "socialAccountId",
          as: "stats",
          pipeline: [
            {
              $group: {
                _id: null,
                published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
                queued: { $sum: { $cond: [{ $in: ["$status", ["scheduled", "retrying", "queued"]] }, 1, 0] } },
                last: { $max: "$publishedAt" },
              },
            },
          ],
        },
      },
      { $sort: { platform: 1, createdAt: 1 } },
    ]),
    AppSettings.findOne({ key: "global" }).lean(),
  ]);

  const disabled = new Set(settings?.disabledPlatforms ?? []);
  const platforms = SOCIAL_PLATFORMS.filter((p) => !disabled.has(p.id)).map((p) => ({
    id: p.id,
    name: p.name,
    notes: p.notes,
    configured: isPlatformConfigured(p.id),
    connected: accounts.filter((a) => a.platform === p.id).length,
  }));

  const rows = accounts.map((a) => ({
    id: String(a._id),
    platform: a.platform as string,
    handle: a.handle as string,
    displayName: a.displayName as string | undefined,
    accountType: a.accountType as string | undefined,
    profileUrl: a.profileUrl as string | undefined,
    status: a.status as string,
    sandbox: Boolean(a.sandbox),
    endpoint: a.connector?.endpointUrl as string | undefined,
    audienceSize: (a.audienceSize as number | undefined) ?? null,
    assisted: a.connector?.mode === "assisted",
    expiresAt: a.cred?.[0]?.expiresAt ? new Date(a.cred[0].expiresAt).toISOString() : null,
    published: a.stats?.[0]?.published ?? 0,
    queued: a.stats?.[0]?.queued ?? 0,
    lastPublishedAt: a.stats?.[0]?.last ? new Date(a.stats[0].last).toISOString() : null,
  }));

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Channels"
        title="Where your posts land"
        description="Social feeds connect with the platform's own sign-in, communities with a bot or webhook you control, so Relay never sees a password. A profile link alone can't grant posting access."
      />
      <section>
        <SectionTitle n="01" aside={<span className="font-mono text-[11px] text-muted-foreground">{rows.length} connected</span>}>
          Connected
        </SectionTitle>
        <ChannelList rows={rows} canManage={can(ctx.role, "admin")} />
      </section>
      <section>
        <SectionTitle
          n="02"
          aside={
            <Link href="/guide#platforms" className="text-xs text-muted-foreground hover:text-foreground">
              What each platform needs →
            </Link>
          }
        >
          Add a platform
        </SectionTitle>
        <ConnectGrid platforms={platforms} demo={demoMode()} canManage={can(ctx.role, "admin")} flash={sp} />
      </section>
      <section>
        <SectionTitle n="03" aside={<span className="font-mono text-[11px] text-muted-foreground">groups · channels · servers</span>}>
          Communities & messaging
        </SectionTitle>
        <CommunityConnectGrid
          tiles={COMMUNITY_PLATFORMS.filter((p) => !disabled.has(p.id)).map((p) => ({ id: p.id, connected: accounts.filter((a) => a.platform === p.id).length }))}
          demo={demoMode()}
          canManage={can(ctx.role, "admin")}
        />
      </section>
      <section>
        <SectionTitle n="04">Custom destinations</SectionTitle>
        <CustomConnectors canManage={can(ctx.role, "admin")} />
      </section>
    </div>
  );
}
