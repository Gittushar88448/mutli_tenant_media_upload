import "server-only";
import { connectDB } from "@/lib/db";
import { MediaAsset, Notification, Post, SocialAccount, PLAN_LIMITS, oid } from "@/lib/models";
import type { NotificationItem } from "@/components/shell/topbar";

export async function getPlanUsage(workspaceId: string, plan: string) {
  await connectDB();
  const ws = oid(workspaceId);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [accounts, posts, storage] = await Promise.all([
    SocialAccount.countDocuments({ workspaceId: ws, status: { $ne: "disabled" } }),
    Post.countDocuments({ workspaceId: ws, createdAt: { $gte: monthStart }, status: { $ne: "draft" } }),
    MediaAsset.aggregate([{ $match: { workspaceId: ws } }, { $group: { _id: null, b: { $sum: "$sizeBytes" } } }]),
  ]);
  const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
  return {
    limits,
    usage: [
      { label: "Channels", used: accounts, limit: limits.accounts },
      { label: "Posts this month", used: posts, limit: limits.postsPerMonth },
      { label: "Storage (MB)", used: Math.round((storage[0]?.b ?? 0) / 1024 / 1024), limit: limits.storageMb },
    ],
  };
}

export async function getNotifications(userId: string): Promise<NotificationItem[]> {
  await connectDB();
  const rows = await Notification.find({ userId: oid(userId) }).sort({ createdAt: -1 }).limit(15).lean();
  return rows.map((n) => ({
    id: String(n._id),
    title: n.title ?? "",
    body: n.body ?? undefined,
    href: n.href ?? undefined,
    createdAt: (n as unknown as { createdAt: Date }).createdAt.toISOString(),
    read: Boolean(n.readAt),
    kind: n.kind,
  }));
}
