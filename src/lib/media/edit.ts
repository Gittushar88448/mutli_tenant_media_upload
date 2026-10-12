import "server-only";
import { stat, unlink, writeFile } from "node:fs/promises";
import { MediaAsset, type MediaAssetDoc } from "@/lib/models";
import { localPath, putFile, scratchPath } from "@/lib/storage";
import { randomToken } from "@/lib/crypto";
import { FFMPEG, FFPROBE, run } from "./render";
import { buildLut, colourIsNeutral, cubeText, grainStrength, sharpenAmount, vignetteAngle, type Lut, type MediaEdit } from "./filters";

/**
 * Renders a media-editor edit with FFmpeg and saves it as a new file in the library.
 * Order matches the editor's preview: rotate and flip, crop, colour (one 3D LUT), vignette,
 * sharpen, grain. A photo with music becomes a short MP4, like a photo post with a song.
 */

/** Imported LUTs are kept as 16-bit values in MongoDB. */
export function packLut(lut: Lut) {
  const buf = Buffer.alloc(lut.data.length * 2);
  for (let i = 0; i < lut.data.length; i++) buf.writeUInt16LE(Math.round(Math.max(0, Math.min(1, lut.data[i]!)) * 65535), i * 2);
  return { size: lut.size, data: buf };
}

export function unpackLut(stored: { size?: number | null; data?: Buffer | { buffer: Buffer } | null } | null | undefined): Lut | null {
  if (!stored?.size || !stored.data) return null;
  const buf = Buffer.isBuffer(stored.data) ? stored.data : Buffer.from((stored.data as { buffer: Buffer }).buffer);
  const data = new Float32Array(buf.length / 2);
  for (let i = 0; i < data.length; i++) data[i] = buf.readUInt16LE(i * 2) / 65535;
  return { size: stored.size, data };
}

async function probe(file: string) {
  const out = await run(FFPROBE(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], 30_000);
  const j = JSON.parse(out) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
  const d = Number(j.format?.duration);
  return { width: j.streams?.[0]?.width, height: j.streams?.[0]?.height, durationMs: Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : undefined };
}

async function hasAudio(file: string) {
  const out = await run(FFPROBE(), ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], 30_000).catch(() => "");
  return out.trim().length > 0;
}

const n = (x: number) => Number(x.toFixed(5));

export type EditInput = { source: MediaAssetDoc; edit: MediaEdit; baseLut?: Lut | null; music?: MediaAssetDoc | null; userId: string; stillDurationMs?: number };

export async function renderEdit({ source, edit, baseLut, music, userId, stillDurationMs }: EditInput) {
  const input = await localPath(source);
  const isVideo = source.kind === "video";
  const stillWithMusic = source.kind === "image" && Boolean(music);
  const outExt = isVideo || stillWithMusic ? "mp4" : source.mime === "image/png" ? "png" : "jpg";
  const output = await scratchPath(outExt);
  const temp: string[] = [];

  const vf: string[] = [];
  if (edit.rotate === 1) vf.push("transpose=1");
  if (edit.rotate === 2) vf.push("hflip,vflip");
  if (edit.rotate === 3) vf.push("transpose=2");
  if (edit.flipH) vf.push("hflip");
  if (edit.flipV) vf.push("vflip");
  const c = edit.crop;
  if (c && (c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1)) {
    vf.push(`crop=w=max(2\\,trunc(iw*${n(c.w)}/2)*2):h=max(2\\,trunc(ih*${n(c.h)}/2)*2):x=trunc(iw*${n(c.x)}):y=trunc(ih*${n(c.y)})`);
  }
  const a = edit.adjust;
  if (!colourIsNeutral(a) || baseLut) {
    const cube = await scratchPath("cube");
    temp.push(cube);
    await writeFile(cube, cubeText(buildLut(a, baseLut)));
    vf.push(`format=rgb24,lut3d=file=${cube}:interp=trilinear`);
  }
  if (a.vignette) vf.push(`format=rgb24,vignette=angle=${n(vignetteAngle(a.vignette))}`);
  if (a.sharpen) vf.push(`unsharp=5:5:${n(sharpenAmount(a.sharpen))}`);
  if (a.grain) vf.push(`noise=alls=${grainStrength(a.grain)}:allf=t+u`);
  if (isVideo || stillWithMusic) vf.push("scale=trunc(iw/2)*2:trunc(ih/2)*2", "format=yuv420p");

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  let durMs = 0;
  if (isVideo) {
    const src = source.durationMs ?? 0;
    const start = Math.max(0, edit.trimStartMs ?? 0);
    const end = edit.trimEndMs && edit.trimEndMs > start ? Math.min(edit.trimEndMs, src || edit.trimEndMs) : src;
    durMs = end > start ? end - start : 0;
    if (start) args.push("-ss", (start / 1000).toFixed(3));
    if (durMs) args.push("-t", (durMs / 1000).toFixed(3));
    args.push("-i", input);
  } else if (stillWithMusic) {
    durMs = Math.max(3000, Math.min(60_000, stillDurationMs ?? 15_000));
    args.push("-loop", "1", "-framerate", "30", "-t", (durMs / 1000).toFixed(3), "-i", input);
  } else args.push("-i", input);

  if (music) {
    if (edit.musicStartMs) args.push("-ss", (edit.musicStartMs / 1000).toFixed(3));
    args.push("-i", await localPath(music));
  }

  const graph = [`[0:v]${vf.length ? vf.join(",") : "null"}[v]`];
  const maps = ["-map", "[v]"];
  if (isVideo || stillWithMusic) {
    const keepOriginal = isVideo && !edit.mute && (await hasAudio(input));
    if (music) {
      const vol = Math.max(0, Math.min(2, edit.musicVolume ?? 1));
      const fadeAt = Math.max(0, durMs / 1000 - 1.5).toFixed(2);
      graph.push(`[1:a]volume=${vol},apad,afade=t=out:st=${fadeAt}:d=1.5[m]`);
      graph.push(keepOriginal ? `[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]` : `[m]anull[a]`);
      maps.push("-map", "[a]");
    } else if (keepOriginal) maps.push("-map", "0:a:0");
    args.push("-filter_complex", graph.join(";"), ...maps);
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart");
    if (stillWithMusic) args.push("-tune", "stillimage", "-r", "30");
    if (durMs) args.push("-t", (durMs / 1000).toFixed(3));
  } else {
    args.push("-filter_complex", graph.join(";"), ...maps, "-frames:v", "1");
    if (outExt === "jpg") args.push("-q:v", "2");
  }
  args.push(output);

  try {
    await run(FFMPEG(), args, 15 * 60_000);
  } finally {
    await Promise.all(temp.map((f) => unlink(f).catch(() => {})));
  }

  const [st, info] = await Promise.all([stat(output), probe(output)]);
  const key = `workspaces/${String(source.workspaceId)}/originals/${new Date().toISOString().slice(0, 7)}/${randomToken(12)}.${outExt}`;
  const { storage } = await putFile(key, output, outExt === "mp4" ? "video/mp4" : outExt === "png" ? "image/png" : "image/jpeg");
  const base = (source.filename ?? "media").replace(/\.[^.]+$/, "");
  return MediaAsset.create({
    workspaceId: source.workspaceId,
    uploadedBy: userId,
    kind: outExt === "mp4" ? "video" : "image",
    filename: `${base} (edited).${outExt}`.slice(0, 200),
    storageKey: key,
    storage,
    mime: outExt === "mp4" ? "video/mp4" : outExt === "png" ? "image/png" : "image/jpeg",
    sizeBytes: st.size,
    width: info.width,
    height: info.height,
    durationMs: outExt === "mp4" ? (info.durationMs ?? durMs) : undefined,
    status: "ready",
    editOf: source._id,
    edit,
  });
}
