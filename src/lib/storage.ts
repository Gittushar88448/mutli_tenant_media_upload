import "server-only";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { cloudinaryConfigured, cloudinaryDestroy, cloudinaryUpload, cloudinaryUrl } from "./cloudinary";

/**
 * Media storage. Two drivers share one key layout (workspaces/{id}/originals/...):
 * - cloudinary: used for new files once CLOUDINARY_URL (or the three CLOUDINARY_* values) is set.
 * - local: files under STORAGE_DIR, for development and single-server installs.
 * Each MediaAsset records which driver holds it, so switching drivers never strands old files.
 */
export type Driver = "local" | "cloudinary";
export type StoredRef = { storageKey: string; storage?: string | null };

const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "storage"));

export function activeDriver(): Driver {
  if (process.env.STORAGE_DRIVER === "local") return "local";
  return cloudinaryConfigured() ? "cloudinary" : "local";
}

const driverOf = (ref: StoredRef): Driver => (ref.storage === "cloudinary" ? "cloudinary" : "local");

function resolveKey(key: string) {
  const full = path.resolve(/*turbopackIgnore: true*/ ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("invalid storage key");
  return full;
}

/** Stores bytes under a key with the active driver and says which driver took it. */
export async function putObject(key: string, data: Buffer, mime: string): Promise<{ storage: Driver }> {
  if (activeDriver() === "cloudinary") {
    await cloudinaryUpload(key, data, mime);
    return { storage: "cloudinary" };
  }
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return { storage: "local" };
}

/** Stores a finished file (a render) and removes the temporary copy. */
export async function putFile(key: string, file: string, mime: string): Promise<{ storage: Driver }> {
  if (activeDriver() === "cloudinary") {
    const out = await putObject(key, await readFile(file), mime);
    await unlink(file).catch(() => {});
    return out;
  }
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await rename(file, full).catch(async () => {
    await copyFile(file, full);
    await unlink(file).catch(() => {});
  });
  return { storage: "local" };
}

export async function existsObject(ref: StoredRef) {
  if (driverOf(ref) === "cloudinary") return true;
  return Boolean(await statObject(ref.storageKey));
}

export async function statObject(key: string) {
  try {
    return await stat(resolveKey(key));
  } catch {
    return null;
  }
}

/** Local driver only: streams a byte range for the media route. */
export function readObjectStream(key: string, range?: { start: number; end: number }) {
  const stream = createReadStream(resolveKey(key), range);
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function deleteObject(ref: StoredRef) {
  if (driverOf(ref) === "cloudinary") return cloudinaryDestroy(ref.storageKey).catch(() => {});
  try {
    await unlink(resolveKey(ref.storageKey));
  } catch {
    /* already gone */
  }
}

export async function readObject(ref: StoredRef) {
  if (driverOf(ref) === "cloudinary") {
    const res = await fetch(cloudinaryUrl(ref.storageKey), { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Cloudinary returned ${res.status} for ${ref.storageKey}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(resolveKey(ref.storageKey));
}

/**
 * A path on this server's disk for tools like FFmpeg. Cloudinary files are downloaded once
 * into a cache folder and reused.
 */
export async function localPath(ref: StoredRef) {
  if (driverOf(ref) === "local") return resolveKey(ref.storageKey);
  const cached = path.join(tmpdir(), "relay-cache", ref.storageKey.replace(/[^\w.-]+/g, "_"));
  if (await stat(cached).catch(() => null)) return cached;
  await mkdir(path.dirname(cached), { recursive: true });
  const part = `${cached}.${process.pid}.part`;
  await writeFile(part, await readObject(ref));
  await rename(part, cached);
  return cached;
}

/** A scratch file path for renders before they're stored. */
export async function scratchPath(ext: string) {
  const dir = path.join(tmpdir(), "relay-renders");
  await mkdir(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`);
}

/** Public CDN address for Cloudinary files; local files are served by /api/media/{id}/file. */
export function publicUrl(ref: StoredRef): string | null {
  return driverOf(ref) === "cloudinary" ? cloudinaryUrl(ref.storageKey) : null;
}
