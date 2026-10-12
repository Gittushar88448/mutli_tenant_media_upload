import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { MediaAsset, isOid, oid, type MediaAssetDoc } from "@/lib/models";
import { planFeatures } from "@/lib/plans";
import { loadFilters } from "@/lib/queries/filters";
import { musicProvider } from "@/lib/media/music";
import { MediaEditor } from "./editor";

export const metadata: Metadata = { title: "Edit media" };

export default async function EditMediaPage({ params }: PageProps<"/media/[id]/edit">) {
  const { id } = await params;
  const ctx = await getWorkspaceContext();
  if (!isOid(id)) notFound();
  await connectDB();
  const asset = await MediaAsset.findOne({ _id: oid(id), workspaceId: oid(ctx.workspace.id), variantOf: { $exists: false } }).lean<MediaAssetDoc>();
  if (!asset || asset.kind === "audio") notFound();
  const [filters, tracks] = await Promise.all([
    loadFilters(ctx.workspace.id),
    MediaAsset.find({ workspaceId: oid(ctx.workspace.id), kind: "audio" }, { filename: 1, durationMs: 1, audio: 1 }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);

  return (
    <MediaEditor
      asset={{ id, kind: asset.kind as "image" | "video", filename: asset.filename ?? "media", width: asset.width ?? undefined, height: asset.height ?? undefined, durationMs: asset.durationMs ?? undefined, mime: asset.mime ?? undefined }}
      filters={filters}
      tracks={tracks.map((t) => ({ id: String(t._id), kind: "audio" as const, filename: t.audio?.title ?? t.filename ?? "Track", durationMs: t.durationMs ?? undefined, createdAt: "" }))}
      studio={planFeatures(ctx.workspace.plan).mediaStudio}
      canEdit={can(ctx.role, "editor")}
      musicDemo={musicProvider() === "demo"}
    />
  );
}
