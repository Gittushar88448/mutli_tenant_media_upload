import type { Metadata } from "next";
import { getWorkspaceContext } from "@/lib/auth/session";
import { MediaAsset, oid } from "@/lib/models";
import { PageHeader } from "@/components/shell/page-header";
import { MediaLibrary } from "./library";
import { formatBytes } from "@/lib/utils";

export const metadata: Metadata = { title: "Media" };

export default async function MediaPage() {
  const ctx = await getWorkspaceContext();
  const [assets, usage] = await Promise.all([
    MediaAsset.aggregate([
      { $match: { workspaceId: oid(ctx.workspace.id) } },
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
        description={`${assets.length} files · ${formatBytes(total)}. Music has to be your own or licensed: it's mixed into the video before upload, because no platform's API offers its in-app music library.`}
      />
      <MediaLibrary initial={assets} />
    </div>
  );
}
