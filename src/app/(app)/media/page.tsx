import type { Metadata } from "next";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { MediaAsset, oid } from "@/lib/models";
import { PageHeader } from "@/components/shell/page-header";
import { MediaLibrary } from "./library";
import { formatBytes } from "@/lib/utils";

export const metadata: Metadata = { title: "Media" };

export default async function MediaPage({ searchParams }: PageProps<"/media">) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext();
  const [assets, usage] = await Promise.all([
    MediaAsset.aggregate([
      // Rendered per-channel cuts are hidden; they belong to their original.
      { $match: { workspaceId: oid(ctx.workspace.id), variantOf: { $exists: false } } },
      { $sort: { createdAt: -1 } },
      { $limit: 500 },
      // How many posts use each file, so the library can show it and block deletes.
      {
        $lookup: {
          from: "posts",
          let: { id: "$_id" },
          pipeline: [
            { $match: { $expr: { $or: [{ $in: ["$$id", { $ifNull: ["$media.assetId", []] }] }, { $in: ["$$id", { $ifNull: ["$media.audioTrackId", []] }] }] } } },
            { $count: "n" },
          ],
          as: "uses",
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          kind: 1,
          filename: 1,
          sizeBytes: 1,
          width: 1,
          height: 1,
          durationMs: 1,
          mime: 1,
          createdAt: { $dateToString: { date: "$createdAt" } },
          uses: { $ifNull: [{ $first: "$uses.n" }, 0] },
          edited: { $toBool: { $ifNull: ["$editOf", false] } },
          license: "$audio.licenseRef",
        },
      },
    ]),
    MediaAsset.aggregate([{ $match: { workspaceId: oid(ctx.workspace.id) } }, { $group: { _id: "$kind", n: { $sum: 1 }, b: { $sum: "$sizeBytes" } } }]),
  ]);
  const total = usage.reduce((a, u) => a + u.b, 0);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Media"
        title="Library"
        description={`${assets.length} files · ${formatBytes(total)}. Open a photo or video to crop, rotate, trim, add a filter or a song, and save it as a new copy.`}
      />
      <MediaLibrary initial={assets} openId={typeof sp.open === "string" ? sp.open : undefined} canEdit={can(ctx.role, "editor")} />
    </div>
  );
}
