import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { MediaAsset, type MediaAssetDoc } from "@/lib/models";
import { existsObject, localPath, putFile, scratchPath } from "@/lib/storage";

/**
 * Per-channel video rendering. A post has one edit spec for its first video, and each
 * channel may carry its own (trim, crop, soundtrack). The rendered cut is stored as a
 * hidden MediaAsset keyed by a hash of source + spec, so every channel asking for the same
 * cut shares one file and a retry never renders twice.
 */
export type EditSpec = {
  trimStartMs?: number | null;
  trimEndMs?: number | null;
  crop?: string | null;
  audioTrackId?: unknown;
  audioVolume?: number | null;
  keepOriginalAudio?: boolean | null;
};

const RATIOS: Record<string, number> = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 };
export const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";

/** True when the spec asks for nothing the original doesn't already have. */
export function isNoopSpec(spec?: EditSpec | null) {
  if (!spec) return true;
  return !spec.trimStartMs && !spec.trimEndMs && (!spec.crop || spec.crop === "original") && !spec.audioTrackId;
}

/** A channel's own spec wins; otherwise the post's spec for its first item. */
export function effectiveSpec(targetSpec: EditSpec | null | undefined, postItem?: { audioTrackId?: unknown; editSpec?: EditSpec | null }): EditSpec {
  const own = clean(targetSpec);
  if (own && Object.keys(own).length) return own;
  return clean({ ...(postItem?.editSpec ?? {}), audioTrackId: postItem?.audioTrackId ?? undefined }) ?? {};
}

function clean(spec?: EditSpec | null) {
  if (!spec) return null;
  const out: EditSpec = {};
  for (const [k, v] of Object.entries(spec)) if (v !== undefined && v !== null && v !== "") (out as Record<string, unknown>)[k] = k === "audioTrackId" ? String(v) : v;
  return out;
}

function specHash(sourceId: string, spec: EditSpec) {
  const norm = {
    s: sourceId,
    a: spec.trimStartMs ?? 0,
    b: spec.trimEndMs ?? 0,
    c: spec.crop ?? "original",
    t: spec.audioTrackId ? String(spec.audioTrackId) : null,
    v: spec.audioTrackId ? (spec.audioVolume ?? 1) : null,
    k: spec.audioTrackId ? (spec.keepOriginalAudio ?? true) : null,
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 24);
}

export function run(bin: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(e.message.includes("ENOENT") ? `${bin} is not installed on this server` : e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split("\n").slice(-3).join(" ") || `${bin} exited with ${code}`));
    });
  });
}

async function hasAudio(file: string) {
  const out = await run(FFPROBE(), ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], 30_000).catch(() => "");
  return out.trim().length > 0;
}

/**
 * Returns the asset a channel should upload: the original when nothing changes, otherwise
 * the rendered cut (rendering it first if this exact cut doesn't exist yet).
 */
export async function ensureRendered(source: MediaAssetDoc, spec: EditSpec): Promise<MediaAssetDoc> {
  if (source.kind !== "video" || isNoopSpec(spec)) return source;
  const hash = specHash(String(source._id), spec);
  const existing = await MediaAsset.findOne({ variantOf: source._id, specHash: hash, status: "ready" }).lean<MediaAssetDoc>();
  if (existing && (await existsObject(existing))) return existing;

  const audio = spec.audioTrackId ? await MediaAsset.findOne({ _id: spec.audioTrackId, workspaceId: source.workspaceId, kind: "audio" }).lean<MediaAssetDoc>() : null;
  const key = `workspaces/${String(source.workspaceId)}/renders/${hash}.mp4`;
  const input = await localPath(source);
  const output = await scratchPath("mp4");

  const srcMs = source.durationMs ?? 0;
  const start = Math.max(0, spec.trimStartMs ?? 0);
  const end = spec.trimEndMs && spec.trimEndMs > start ? Math.min(spec.trimEndMs, srcMs || spec.trimEndMs) : srcMs;
  const durMs = end > start ? end - start : 0;

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (start) args.push("-ss", (start / 1000).toFixed(3));
  if (durMs) args.push("-t", (durMs / 1000).toFixed(3));
  args.push("-i", input);
  if (audio) args.push("-i", await localPath(audio));

  const ratio = spec.crop ? RATIOS[spec.crop] : undefined;
  const vf = [
    ratio ? `crop='trunc(if(gt(iw/ih,${ratio}),ih*${ratio},iw)/2)*2':'trunc(if(gt(iw/ih,${ratio}),ih,iw/${ratio})/2)*2'` : null,
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
  ]
    .filter(Boolean)
    .join(",");
  const filters = [`[0:v]${vf}[v]`];
  const maps = ["-map", "[v]"];
  if (audio) {
    const vol = Math.max(0, Math.min(2, spec.audioVolume ?? 1));
    filters.push(`[1:a]volume=${vol}[track]`);
    if ((spec.keepOriginalAudio ?? true) && (await hasAudio(input))) {
      filters.push(`[0:a][track]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`);
    } else filters.push(`[track]anull[a]`);
    maps.push("-map", "[a]");
  } else if (await hasAudio(input)) maps.push("-map", "0:a:0");

  args.push("-filter_complex", filters.join(";"), ...maps);
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart");
  if (audio) args.push("-shortest");
  args.push(output);
  await run(FFMPEG(), args, 15 * 60_000);

  const st = await stat(output);
  const { storage } = await putFile(key, output, "video/mp4");
  const w = source.width ?? 0;
  const h = source.height ?? 0;
  let width = w;
  let height = h;
  if (ratio && w && h) {
    if (w / h > ratio) width = Math.floor((h * ratio) / 2) * 2;
    else height = Math.floor(w / ratio / 2) * 2;
  }
  const doc = await MediaAsset.findOneAndUpdate(
    { variantOf: source._id, specHash: hash },
    {
      $set: {
        workspaceId: source.workspaceId,
        kind: "video",
        filename: `${(source.filename ?? "video").replace(/\.[^.]+$/, "")} · ${spec.crop && spec.crop !== "original" ? spec.crop : "cut"}.mp4`,
        storageKey: key,
        storage,
        mime: "video/mp4",
        sizeBytes: st.size,
        width: width || undefined,
        height: height || undefined,
        durationMs: durMs || source.durationMs,
        status: "ready",
        variantOf: source._id,
        specHash: hash,
      },
    },
    { upsert: true, new: true }
  ).lean<MediaAssetDoc>();
  return doc!;
}

/** Re-encodes an image under maxBytes (Bluesky caps images at about 1 MB). */
export async function shrinkImage(file: string, maxBytes: number): Promise<Buffer | null> {
  const out = `${file}.relay-${Date.now()}.jpg`;
  for (const [width, q] of [
    [2000, 4],
    [1600, 6],
    [1200, 8],
  ] as const) {
    await run(FFMPEG(), ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale='min(${width},iw)':-2`, "-q:v", String(q), out], 60_000);
    const st = await stat(out);
    if (st.size <= maxBytes) {
      const { readFile, unlink } = await import("node:fs/promises");
      const buf = await readFile(out);
      await unlink(out).catch(() => {});
      return buf;
    }
  }
  return null;
}
