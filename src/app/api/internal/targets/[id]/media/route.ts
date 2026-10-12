import { NextResponse } from "next/server";
import { checkInternal } from "@/lib/internal-auth";
import { connectDB } from "@/lib/db";
import { MediaAsset, Post, PostTarget, isOid } from "@/lib/models";
import { signMediaToken } from "@/lib/crypto";
import { appUrl } from "@/lib/oauth";

/**
 * GET /api/internal/targets/{id}/media — signed, short-lived URLs for the post's media,
 * in order, plus the soundtrack and edit spec. Platforms that pull by URL (Instagram,
 * Threads, TikTok pull mode) get these directly; others stream them into chunked uploads.
 * A render worker (FFmpeg) slots in here to produce per-platform variants.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/internal/targets/[id]/media">) {
  const denied = checkInternal(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isOid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await connectDB();
  const target = await PostTarget.findById(id).lean();
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  const post = await Post.findById(target.postId).lean();
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ids = (post.media ?? []).flatMap((m) => [m.assetId, m.audioTrackId]).filter(Boolean);
  const assets = new Map((await MediaAsset.find({ _id: { $in: ids } }).lean()).map((a) => [String(a._id), a]));
  const sign = (assetId: string) => {
    const { exp, sig } = signMediaToken(assetId, 3600);
    return `${appUrl()}/api/media/${assetId}/file?exp=${exp}&sig=${sig}`;
  };

  const items = (post.media ?? [])
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((m) => {
      const a = assets.get(String(m.assetId));
      if (!a) return null;
      const audio = m.audioTrackId ? assets.get(String(m.audioTrackId)) : undefined;
      return {
        assetId: String(a._id),
        kind: a.kind,
        mime: a.mime,
        url: sign(String(a._id)),
        width: a.width,
        height: a.height,
        durationMs: a.durationMs,
        sizeBytes: a.sizeBytes,
        editSpec: m.editSpec ?? {},
        soundtrack: audio ? { assetId: String(audio._id), url: sign(String(audio._id)), title: audio.audio?.title ?? audio.filename, licenseRef: audio.audio?.licenseRef } : null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ items, expiresInSeconds: 3600 }, { headers: { "cache-control": "no-store" } });
}
