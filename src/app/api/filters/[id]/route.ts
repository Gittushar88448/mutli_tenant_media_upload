import { type NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { CustomFilter, isOid, oid } from "@/lib/models";
import { getWorkspaceContext } from "@/lib/auth/session";
import { PACKS, buildLut, cubeText, fullAdjust, NEUTRAL, type Adjust } from "@/lib/media/filters";
import { unpackLut } from "@/lib/media/edit";

/**
 * Downloads a filter. ?format=cube (default) is a 33-point 3D LUT for Lightroom, Premiere,
 * DaVinci Resolve, CapCut or Final Cut; ?format=relay is Relay's own .relayfilter file that
 * can be imported into another workspace; ?format=base is a custom filter's imported LUT on
 * its own, which the editor's preview needs.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/filters/[id]">) {
  const { id: rawId } = await ctx.params;
  const id = decodeURIComponent(rawId);
  const { workspace } = await getWorkspaceContext();
  await connectDB();

  let name: string;
  let adjust: Adjust;
  let base = null;
  if (id.startsWith("custom:")) {
    const fid = id.slice(7);
    const f = isOid(fid) ? await CustomFilter.findOne({ _id: oid(fid), workspaceId: oid(workspace.id) }).lean() : null;
    if (!f) return new Response("Not found", { status: 404 });
    name = f.name;
    adjust = fullAdjust(f.adjust as never);
    base = unpackLut(f.lut as never);
  } else {
    const [packId, filterId] = id.split("/");
    const preset = PACKS.find((p) => p.id === packId)?.filters.find((f) => f.id === filterId);
    if (!preset) return new Response("Not found", { status: 404 });
    name = preset.name;
    adjust = fullAdjust(preset.adjust);
  }

  const format = req.nextUrl.searchParams.get("format") ?? "cube";
  const file = name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "filter";
  if (format === "relay") {
    const body = JSON.stringify({ relayFilter: 1, name, adjust }, null, 2);
    return new Response(body, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${file}.relayfilter"` } });
  }
  if (format === "base") {
    if (!base) return new Response("Not found", { status: 404 });
    return new Response(cubeText(base, name), { headers: { "content-type": "text/plain", "cache-control": "private, max-age=600" } });
  }
  // Grain, vignette and sharpening aren't colour, so a LUT can't carry them.
  const lut = buildLut({ ...adjust, vignette: NEUTRAL.vignette, sharpen: NEUTRAL.sharpen, grain: NEUTRAL.grain }, base);
  return new Response(cubeText(lut, name), { headers: { "content-type": "text/plain", "content-disposition": `attachment; filename="${file}.cube"` } });
}
