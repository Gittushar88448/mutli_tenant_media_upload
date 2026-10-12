import { type NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { MediaAsset, Membership, isOid } from "@/lib/models";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyMediaToken } from "@/lib/crypto";
import { publicUrl, readObjectStream, statObject } from "@/lib/storage";

/**
 * Serves media to members of the owning workspace, or to anyone holding a short-lived
 * signed link (how n8n and platforms like Instagram pull files). Supports Range so
 * video previews can seek.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/media/[id]/file">) {
  const { id } = await ctx.params;
  if (!isOid(id)) return new Response("Not found", { status: 404 });
  await connectDB();
  const asset = await MediaAsset.findById(id).lean();
  if (!asset) return new Response("Not found", { status: 404 });

  const sp = req.nextUrl.searchParams;
  let allowed = verifyMediaToken(id, sp.get("exp"), sp.get("sig"));
  if (!allowed) {
    const user = await getCurrentUser();
    allowed = Boolean(user && (user.role === "admin" || (await Membership.exists({ userId: user.id, workspaceId: asset.workspaceId }))));
  }
  if (!allowed) return new Response("Forbidden", { status: 403 });

  // Cloudinary files are served from its CDN once access is checked.
  const cdn = publicUrl(asset);
  if (cdn) {
    if (sp.get("download")) return Response.redirect(cdn.replace("/upload/", `/upload/fl_attachment/`), 302);
    return Response.redirect(cdn, 302);
  }

  const st = await statObject(asset.storageKey);
  if (!st) return new Response("Gone", { status: 410 });

  const headers = new Headers({
    "content-type": asset.mime ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  if (sp.get("download")) headers.set("content-disposition", `attachment; filename="${(asset.filename ?? "media").replace(/[^\w.\- ]+/g, "_")}"`);
  const range = req.headers.get("range");
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    headers.set("content-range", `bytes ${start}-${end}/${st.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(readObjectStream(asset.storageKey, { start, end }), { status: 206, headers });
  }
  headers.set("content-length", String(st.size));
  return new Response(readObjectStream(asset.storageKey), { headers });
}
