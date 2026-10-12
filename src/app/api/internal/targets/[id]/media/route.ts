import { NextResponse } from "next/server";
import { checkInternal } from "@/lib/internal-auth";
import { connectDB } from "@/lib/db";
import { MediaAsset, Post, PostTarget, isOid, type MediaAssetDoc } from "@/lib/models";
import { effectiveSpec, ensureRendered, isNoopSpec, type EditSpec } from "@/lib/media/render";
import { signMediaToken } from "@/lib/crypto";
import { appUrl } from "@/lib/oauth";
import { publicUrl, type StoredRef } from "@/lib/storage";

/**
 * GET /api/internal/targets/{id}/media — signed, short-lived URLs for the post's media,
 * in order, plus the soundtrack and edit spec. Platforms that pull by URL (Instagram,
 * Threads, TikTok pull mode) get these directly; others stream them into chunked uploads.
 * The first video is swapped for this channel's rendered cut (trim, crop, soundtrack)
 * when it has one, rendered with FFmpeg on first request and reused afterwards.
 */
export const maxDuration = 300;

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
  // Cloudinary files go straight to its CDN; local files get a signed link back to Relay.
  const sign = (assetId: string, ref?: StoredRef) => {
    const cdn = ref ? publicUrl(ref) : null;
    if (cdn) return cdn;
    const { exp, sig } = signMediaToken(assetId, 3600);
    return `${appUrl()}/api/media/${assetId}/file?exp=${exp}&sig=${sig}`;
  };

  // Render this channel's cut of the first video before handing out links.
  const ordered = [...(post.media ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const firstVideo = ordered.find((m) => assets.get(String(m.assetId))?.kind === "video");
  let rendered: { from: string; to: MediaAssetDoc } | null = null;
  if (firstVideo) {
    const spec = effectiveSpec(target.editSpec as EditSpec, { audioTrackId: firstVideo.audioTrackId, editSpec: firstVideo.editSpec as EditSpec });
    if (!isNoopSpec(spec)) {
      try {
        const out = await ensureRendered(assets.get(String(firstVideo.assetId)) as MediaAssetDoc, spec);
        rendered = { from: String(firstVideo.assetId), to: out };
        await PostTarget.updateOne({ _id: target._id }, { $set: { renderedAssetId: out._id } });
      } catch (e) {
        return NextResponse.json({ error: "render_failed", message: (e as Error).message }, { status: 500 });
      }
    }
  }

  const items = ordered
    .map((m) => {
      const original = assets.get(String(m.assetId));
      if (!original) return null;
      const isCut = rendered && rendered.from === String(m.assetId);
      const a = isCut ? rendered!.to : original;
      // A rendered cut already has the soundtrack mixed in.
      const audio = !isCut && m.audioTrackId ? assets.get(String(m.audioTrackId)) : undefined;
      return {
        assetId: String(a._id),
        kind: a.kind,
        mime: a.mime,
        url: sign(String(a._id), a),
        width: a.width,
        height: a.height,
        durationMs: a.durationMs,
        sizeBytes: a.sizeBytes,
        editSpec: isCut ? {} : (m.editSpec ?? {}),
        rendered: Boolean(isCut),
        soundtrack: audio ? { assetId: String(audio._id), url: sign(String(audio._id), audio), title: audio.audio?.title ?? audio.filename, licenseRef: audio.audio?.licenseRef } : null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ items, expiresInSeconds: 3600 }, { headers: { "cache-control": "no-store" } });
}
