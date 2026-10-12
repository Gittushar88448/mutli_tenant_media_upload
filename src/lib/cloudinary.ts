import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Cloudinary over its REST API (no SDK). Media keys map to public ids by dropping the
 * extension; images use the image resource type, video and audio the video type.
 * Configure with CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>, or
 * CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.
 */
type Config = { cloud: string; key: string; secret: string; folder: string };

function config(): Config | null {
  const url = process.env.CLOUDINARY_URL;
  if (url) {
    const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/);
    if (m) return { key: decodeURIComponent(m[1]!), secret: decodeURIComponent(m[2]!), cloud: m[3]!, folder: process.env.CLOUDINARY_FOLDER ?? "relay" };
  }
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  return cloud && key && secret ? { cloud, key, secret, folder: process.env.CLOUDINARY_FOLDER ?? "relay" } : null;
}

export function cloudinaryConfigured() {
  return Boolean(config());
}

const IMAGE = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const AV = new Set(["mp4", "mov", "webm", "mp3", "m4a", "aac", "wav"]);

function split(storageKey: string) {
  const cfg = config();
  if (!cfg) throw new Error("Cloudinary isn't configured");
  const ext = storageKey.split(".").pop()!.toLowerCase();
  const resourceType = IMAGE.has(ext) ? "image" : AV.has(ext) ? "video" : "raw";
  // Raw files keep their extension in the public id; images and video don't.
  const base = resourceType === "raw" ? storageKey : storageKey.replace(/\.[^./]+$/, "");
  return { cfg, ext, resourceType, publicId: `${cfg.folder}/${base}` };
}

/** Upload API signature: SHA-1 of the sorted parameters, then the API secret. */
function sign(params: Record<string, string | number>, secret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(payload + secret).digest("hex");
}

const CHUNK = 20 * 1024 * 1024;

export async function cloudinaryUpload(storageKey: string, data: Buffer, mime: string) {
  const { cfg, resourceType, publicId } = split(storageKey);
  const params = { public_id: publicId, overwrite: "true", timestamp: Math.floor(Date.now() / 1000) };
  const signature = sign(params, cfg.secret);
  const endpoint = `https://api.cloudinary.com/v1_1/${cfg.cloud}/${resourceType}/upload`;
  const form = (chunk: Buffer) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(params)) f.set(k, String(v));
    f.set("api_key", cfg.key);
    f.set("signature", signature);
    f.set("file", new Blob([new Uint8Array(chunk)], { type: mime }), storageKey.split("/").pop());
    return f;
  };

  let res: Response;
  if (data.length <= CHUNK) {
    res = await fetch(endpoint, { method: "POST", body: form(data), signal: AbortSignal.timeout(10 * 60_000) });
  } else {
    // Big files go up in 20 MB chunks that share an upload id; the last answer is the asset.
    const uploadId = randomBytes(12).toString("hex");
    res = new Response(null, { status: 500 });
    for (let start = 0; start < data.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, data.length) - 1;
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "X-Unique-Upload-Id": uploadId, "Content-Range": `bytes ${start}-${end}/${data.length}` },
        body: form(data.subarray(start, end + 1)),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok) break;
    }
  }
  const json = (await res.json().catch(() => ({}))) as { secure_url?: string; bytes?: number; error?: { message?: string } };
  if (!res.ok || !json.secure_url) throw new Error(`Cloudinary upload failed: ${json.error?.message ?? res.status}`);
  return { url: json.secure_url, bytes: json.bytes };
}

export async function cloudinaryDestroy(storageKey: string) {
  const { cfg, resourceType, publicId } = split(storageKey);
  const params = { invalidate: "true", public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const f = new FormData();
  for (const [k, v] of Object.entries(params)) f.set(k, String(v));
  f.set("api_key", cfg.key);
  f.set("signature", sign(params, cfg.secret));
  await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloud}/${resourceType}/destroy`, { method: "POST", body: f, signal: AbortSignal.timeout(30_000) });
}

/** Delivery URL on Cloudinary's CDN. Keys carry a random token, so URLs can't be guessed. */
export function cloudinaryUrl(storageKey: string) {
  const { cfg, ext, resourceType, publicId } = split(storageKey);
  return `https://res.cloudinary.com/${cfg.cloud}/${resourceType}/upload/${publicId}${resourceType === "raw" ? "" : `.${ext}`}`;
}
