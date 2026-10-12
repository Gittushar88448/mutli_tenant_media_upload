import type { Metadata } from "next";
import Link from "next/link";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { MediaAsset, Post, PostTarget, SocialAccount, oid, isOid } from "@/lib/models";
import { Composer, type ComposerInitial } from "./composer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Compose" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ post?: string; duplicate?: string }> }) {
  const ctx = await getWorkspaceContext();
  const sp = await searchParams;
  const ws = oid(ctx.workspace.id);

  const [accounts, library] = await Promise.all([
    SocialAccount.find({ workspaceId: ws, status: { $in: ["active", "needs_reauth"] } }).sort({ platform: 1, handle: 1 }).lean(),
    MediaAsset.find({ workspaceId: ws, status: "ready" }).sort({ createdAt: -1 }).limit(300).lean(),
  ]);

  let initial: ComposerInitial | undefined;
  const sourceId = sp.post ?? sp.duplicate;
  if (sourceId && isOid(sourceId)) {
    const post = await Post.findOne({ _id: oid(sourceId), workspaceId: ws }).lean();
    if (post) {
      const targets = await PostTarget.find({ postId: post._id }).lean();
      const editable = !!sp.post && ["draft", "scheduled", "pending_approval"].includes(post.status);
      initial = {
        postId: editable ? String(post._id) : undefined,
        title: post.title ?? "",
        caption: post.baseCaption ?? "",
        scheduledAt: editable && post.scheduledAt ? post.scheduledAt.toISOString() : undefined,
        media: (post.media ?? []).map((m) => ({
          assetId: String(m.assetId),
          audioTrackId: m.audioTrackId ? String(m.audioTrackId) : undefined,
          editSpec: (m.editSpec ?? {}) as Record<string, unknown>,
        })),
        targets: targets
          .filter((t) => t.status !== "cancelled")
          .map((t) => ({ accountId: String(t.socialAccountId), postType: t.postType, captionOverride: t.captionOverride ?? "", options: (t.options ?? {}) as Record<string, unknown> })),
      };
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="grain mx-auto mt-16 max-w-xl rounded-lg border border-dashed p-12 text-center">
        <p className="eyebrow">Compose</p>
        <p className="display mt-3 text-4xl">Connect a channel first.</p>
        <p className="mt-3 text-sm text-muted-foreground">Posts need somewhere to go. Connect Instagram, YouTube, TikTok or another platform, or add a webhook.</p>
        <Button asChild className="mt-6">
          <Link href="/accounts">Go to channels</Link>
        </Button>
      </div>
    );
  }

  return (
    <Composer
      accounts={accounts.map((a) => ({ id: String(a._id), platform: a.platform, handle: a.handle, displayName: a.displayName ?? undefined, sandbox: Boolean(a.sandbox), status: a.status }))}
      library={library.map((m) => ({
        id: String(m._id),
        kind: m.kind as "image" | "video" | "audio",
        filename: m.filename ?? undefined,
        sizeBytes: m.sizeBytes ?? undefined,
        width: m.width ?? undefined,
        height: m.height ?? undefined,
        durationMs: m.durationMs ?? undefined,
        mime: m.mime ?? undefined,
        createdAt: (m as unknown as { createdAt: Date }).createdAt.toISOString(),
      }))}
      timezone={ctx.workspace.timezone}
      needsApproval={ctx.workspace.requireApproval && !can(ctx.role, "approver")}
      initial={initial}
    />
  );
}
