"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { CustomFilter, MediaAsset, PLAN_LIMITS, Workspace, oid, isOid, type MediaAssetDoc } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { planFeatures, planFor, PLAN_INFO } from "@/lib/plans";
import { STORE_PACK_IDS, fullAdjust, isNeutral, parseCube, usesStudio, type MediaEdit } from "@/lib/media/filters";
import { packLut, renderEdit, unpackLut } from "@/lib/media/edit";
import { fetchTrackAudio, searchMusic, type Track } from "@/lib/media/music";
import { putObject } from "@/lib/storage";
import { randomToken } from "@/lib/crypto";
import type { MediaItem } from "@/components/media/types";

async function editor() {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "editor")) throw new Error("Viewers can't edit media.");
  await connectDB();
  return ctx;
}

const studioError = (plan: string) =>
  planFeatures(plan).mediaStudio ? null : `Filters, adjustments and music are on ${PLAN_INFO[planFor("mediaStudio")].name} and above. Cropping, rotating and trimming are free.`;

const EditSchema = z.object({
  rotate: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) }).nullable(),
  trimStartMs: z.number().int().min(0).optional(),
  trimEndMs: z.number().int().min(0).optional(),
  mute: z.boolean().optional(),
  adjust: z.record(z.string(), z.union([z.number(), z.string()])),
  filterId: z.string().max(80).nullable().optional(),
  musicId: z.string().nullable().optional(),
  musicVolume: z.number().min(0).max(2).optional(),
  musicStartMs: z.number().int().min(0).optional(),
  stillDurationMs: z.number().int().min(3000).max(60_000).optional(),
});

const toItem = (a: MediaAssetDoc): MediaItem & { uses: number } => ({
  id: String(a._id),
  kind: a.kind as MediaItem["kind"],
  filename: a.filename ?? undefined,
  sizeBytes: a.sizeBytes ?? undefined,
  width: a.width ?? undefined,
  height: a.height ?? undefined,
  durationMs: a.durationMs ?? undefined,
  mime: a.mime ?? undefined,
  createdAt: new Date((a as { createdAt?: Date }).createdAt ?? Date.now()).toISOString(),
  uses: 0,
});

async function storageLeft(workspaceId: string, plan: string) {
  const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
  const [used] = await MediaAsset.aggregate([{ $match: { workspaceId: oid(workspaceId) } }, { $group: { _id: null, b: { $sum: "$sizeBytes" } } }]);
  return limits.storageMb * 1024 * 1024 - (used?.b ?? 0);
}

/** Renders the edit and saves it as a new file; the original is never changed. */
export async function saveEditAction(sourceId: string, raw: unknown): Promise<{ error?: string; item?: MediaItem & { uses: number } }> {
  const ctx = await editor();
  const parsed = EditSchema.safeParse(raw);
  if (!isOid(sourceId) || !parsed.success) return { error: "That edit couldn't be read." };
  const { stillDurationMs, ...rest } = parsed.data;
  const edit: MediaEdit = { ...rest, adjust: fullAdjust(rest.adjust) };

  const source = await MediaAsset.findOne({ _id: oid(sourceId), workspaceId: oid(ctx.workspace.id), variantOf: { $exists: false } }).lean<MediaAssetDoc>();
  if (!source || source.kind === "audio") return { error: "Only photos and videos can be edited." };
  if (usesStudio(edit)) {
    const err = studioError(ctx.workspace.plan);
    if (err) return { error: err };
  }
  const nothing = !edit.rotate && !edit.flipH && !edit.flipV && !edit.crop && !edit.trimStartMs && !edit.trimEndMs && !edit.mute && isNeutral(edit.adjust) && !edit.filterId && !edit.musicId;
  if (nothing) return { error: "Nothing has changed yet." };
  if ((await storageLeft(ctx.workspace.id, ctx.workspace.plan)) < (source.sizeBytes ?? 0)) return { error: "This copy would go over your plan's storage. Delete old files or upgrade." };

  let baseLut = null;
  if (edit.filterId?.startsWith("custom:")) {
    const id = edit.filterId.slice(7);
    const f = isOid(id) ? await CustomFilter.findOne({ _id: oid(id), workspaceId: oid(ctx.workspace.id) }).lean() : null;
    if (!f) return { error: "That filter was deleted." };
    baseLut = unpackLut(f.lut as never);
  }
  let music: MediaAssetDoc | null = null;
  if (edit.musicId) {
    music = isOid(edit.musicId) ? await MediaAsset.findOne({ _id: oid(edit.musicId), workspaceId: oid(ctx.workspace.id), kind: "audio" }).lean<MediaAssetDoc>() : null;
    if (!music) return { error: "That track isn't in your library any more." };
  }

  try {
    const out = await renderEdit({ source, edit, baseLut, music, userId: ctx.user.id, stillDurationMs });
    await audit({ action: "media.edited", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "media", entityId: String(out._id), meta: { from: sourceId, filter: edit.filterId ?? null, music: Boolean(music) } });
    revalidatePath("/media");
    return { item: toItem(out.toObject() as MediaAssetDoc) };
  } catch (e) {
    return { error: `The edit couldn't be rendered: ${(e as Error).message}` };
  }
}

/* ---------- Filter store and custom filters ---------- */

export async function setPackInstalledAction(packId: string, installed: boolean): Promise<{ error?: string }> {
  const ctx = await editor();
  if (!STORE_PACK_IDS.includes(packId)) return { error: "Unknown filter pack." };
  const err = studioError(ctx.workspace.plan);
  if (err && installed) return { error: err };
  await Workspace.updateOne({ _id: oid(ctx.workspace.id) }, installed ? { $addToSet: { filterPacks: packId } } : { $pull: { filterPacks: packId } });
  await audit({ action: installed ? "filters.pack_installed" : "filters.pack_removed", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "workspace", entityId: ctx.workspace.id, meta: { packId } });
  revalidatePath("/media");
  return {};
}

const CustomFilterInput = z.object({
  name: z.string().trim().min(1).max(40),
  adjust: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  cube: z.string().max(8_000_000).optional(),
  cubeName: z.string().max(200).optional(),
});

/** Saves the current adjustments as a filter, optionally on top of an imported .cube LUT. */
export async function saveCustomFilterAction(raw: unknown): Promise<{ error?: string; filter?: { id: string; name: string; adjust: ReturnType<typeof fullAdjust>; hasLut: boolean } }> {
  const ctx = await editor();
  const err = studioError(ctx.workspace.plan);
  if (err) return { error: err };
  const parsed = CustomFilterInput.safeParse(raw);
  if (!parsed.success) return { error: "Give the filter a name of up to 40 characters." };
  let lut;
  if (parsed.data.cube) {
    try {
      lut = { ...packLut(parseCube(parsed.data.cube)), source: parsed.data.cubeName?.slice(0, 200) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  const adjust = fullAdjust(parsed.data.adjust);
  if (!lut && isNeutral(adjust)) return { error: "Move a slider or import a LUT first." };
  if ((await CustomFilter.countDocuments({ workspaceId: oid(ctx.workspace.id) })) >= 100) return { error: "A workspace can keep up to 100 filters." };
  const f = await CustomFilter.create({ workspaceId: oid(ctx.workspace.id), createdBy: oid(ctx.user.id), name: parsed.data.name, adjust, lut });
  await audit({ action: "filters.created", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "filter", entityId: String(f._id), meta: { lut: Boolean(lut) } });
  revalidatePath("/media");
  return { filter: { id: `custom:${String(f._id)}`, name: f.name, adjust, hasLut: Boolean(lut) } };
}

export async function deleteCustomFilterAction(id: string): Promise<{ error?: string }> {
  const ctx = await editor();
  const raw = id.replace(/^custom:/, "");
  if (!isOid(raw)) return { error: "Not found" };
  await CustomFilter.deleteOne({ _id: oid(raw), workspaceId: oid(ctx.workspace.id) });
  await audit({ action: "filters.deleted", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "filter", entityId: raw });
  revalidatePath("/media");
  return {};
}

/* ---------- Music library ---------- */

export async function searchMusicAction(input: { q?: string; tag?: string; page?: number }): Promise<{ error?: string; provider?: "jamendo" | "demo"; tracks?: Track[] }> {
  const ctx = await editor();
  const err = studioError(ctx.workspace.plan);
  if (err) return { error: err };
  try {
    return await searchMusic({ q: input.q?.slice(0, 100), tag: input.tag?.slice(0, 40), page: Math.max(0, Math.min(20, input.page ?? 0)) });
  } catch (e) {
    return { error: `The music library didn't answer: ${(e as Error).message}` };
  }
}

/** Adds a track to the media library (once per workspace) so posts and edits can use it. */
export async function importTrackAction(trackId: string): Promise<{ error?: string; item?: MediaItem & { uses: number } }> {
  const ctx = await editor();
  const err = studioError(ctx.workspace.plan);
  if (err) return { error: err };
  if (!/^(jamendo|demo):[\w-]{1,40}$/.test(trackId)) return { error: "Unknown track" };
  const existing = await MediaAsset.findOne({ workspaceId: oid(ctx.workspace.id), kind: "audio", "audio.source": "library", "audio.licenseRef": new RegExp(`^${trackId}(\\s|$)`) }).lean<MediaAssetDoc>();
  if (existing) return { item: toItem(existing) };
  try {
    const { track, data, mime } = await fetchTrackAudio(trackId);
    if ((await storageLeft(ctx.workspace.id, ctx.workspace.plan)) < data.length) return { error: "This track would go over your plan's storage." };
    const key = `workspaces/${ctx.workspace.id}/originals/${new Date().toISOString().slice(0, 7)}/${randomToken(12)}.mp3`;
    const { storage } = await putObject(key, data, mime);
    const asset = await MediaAsset.create({
      workspaceId: oid(ctx.workspace.id),
      uploadedBy: oid(ctx.user.id),
      kind: "audio",
      filename: `${track.title} - ${track.artist}.mp3`.slice(0, 200),
      storageKey: key,
      storage,
      mime,
      sizeBytes: data.length,
      durationMs: track.durationMs,
      status: "ready",
      // Licence details stay with the file in case a platform ever asks.
      audio: { source: "library", title: `${track.title} · ${track.artist}`, licenseRef: [trackId, track.license, track.licenseUrl, track.pageUrl].filter(Boolean).join(" ") },
    });
    await audit({ action: "media.music_imported", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "media", entityId: String(asset._id), meta: { trackId } });
    revalidatePath("/media");
    return { item: toItem(asset.toObject() as MediaAssetDoc) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
