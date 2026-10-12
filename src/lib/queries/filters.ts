import "server-only";
import { CustomFilter, Workspace, oid } from "@/lib/models";
import { PACKS, fullAdjust } from "@/lib/media/filters";

/** Packs and custom filters for the editor, built-ins first. */
export async function loadFilters(workspaceId: string) {
  const [ws, custom] = await Promise.all([Workspace.findById(oid(workspaceId), { filterPacks: 1 }).lean(), CustomFilter.find({ workspaceId: oid(workspaceId) }, { name: 1, adjust: 1, "lut.size": 1, "lut.source": 1 }).sort({ createdAt: -1 }).lean<{ _id: unknown; name: string; adjust?: unknown; lut?: { size?: number; source?: string } }[]>()]);
  const installed = new Set(ws?.filterPacks ?? []);
  return {
    packs: PACKS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, builtIn: Boolean(p.builtIn), installed: Boolean(p.builtIn) || installed.has(p.id), filters: p.filters.map((f) => ({ id: `${p.id}/${f.id}`, name: f.name, adjust: fullAdjust(f.adjust) })) })),
    custom: custom.map((f) => ({ id: `custom:${String(f._id)}`, name: f.name, adjust: fullAdjust(f.adjust as never), hasLut: Boolean(f.lut?.size), lutSource: f.lut?.source ?? undefined })),
  };
}
