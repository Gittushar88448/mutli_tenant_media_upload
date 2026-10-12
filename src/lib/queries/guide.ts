import "server-only";
import { connectDB } from "@/lib/db";
import { MediaAsset, Membership, Post, SocialAccount, oid } from "@/lib/models";
import { PLATFORMS } from "@/lib/platforms";

const COMMUNITY_IDS = Object.values(PLATFORMS)
  .filter((p) => p.category === "community")
  .map((p) => p.id);

export type SetupStep = { key: string; title: string; body: string; href: string; cta: string; done: boolean };

/**
 * The workspace's setup checklist for the guide and the overview banner. One $facet over
 * the workspace's channels, plus counts for media, posts and members.
 */
export async function getSetupProgress(workspaceId: string, plan: string): Promise<{ steps: SetupStep[]; done: number }> {
  await connectDB();
  const ws = oid(workspaceId);
  const [[channels], media, posts, members] = await Promise.all([
    SocialAccount.aggregate<{ social: { n: number }[]; community: { n: number }[] }>([
      { $match: { workspaceId: ws, status: { $ne: "revoked" } } },
      {
        $facet: {
          social: [{ $match: { platform: { $nin: COMMUNITY_IDS } } }, { $count: "n" }],
          community: [{ $match: { platform: { $in: COMMUNITY_IDS } } }, { $count: "n" }],
        },
      },
    ]),
    MediaAsset.countDocuments({ workspaceId: ws, variantOf: null }),
    Post.countDocuments({ workspaceId: ws, status: { $ne: "draft" } }),
    Membership.countDocuments({ workspaceId: ws }),
  ]);
  const social = channels?.social[0]?.n ?? 0;
  const community = channels?.community[0]?.n ?? 0;

  const steps: SetupStep[] = [
    { key: "social", title: "Connect a social account", body: "Instagram, YouTube, LinkedIn and the rest sign in with their own login.", href: "/accounts", cta: "Open Channels", done: social > 0 },
    { key: "community", title: "Connect a community", body: "A Telegram channel, WhatsApp group, Discord or Slack channel.", href: "/communities", cta: "Open Communities", done: community > 0 },
    { key: "media", title: "Upload your media", body: "Videos, images and soundtracks you'll reuse across posts.", href: "/media", cta: "Open Media", done: media > 0 },
    { key: "post", title: "Schedule your first post", body: "Write once, tailor it per channel, pick a time.", href: "/compose", cta: "Compose", done: posts > 0 },
    { key: "team", title: "Invite your team", body: "Give editors, approvers and viewers their own logins.", href: "/settings", cta: "Open Settings", done: members > 1 },
    { key: "plan", title: "Pick a plan", body: "Unlock per-platform text, video cuts, polls and live edits.", href: "/billing", cta: "See plans", done: plan !== "free" },
  ];
  return { steps, done: steps.filter((s) => s.done).length };
}
