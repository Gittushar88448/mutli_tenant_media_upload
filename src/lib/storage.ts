import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Local-disk storage driver. Keys are laid out as workspaces/{workspaceId}/originals/...
 * exactly like the S3 layout in the architecture doc, so swapping in an S3 driver with
 * presigned multipart uploads only changes this file.
 */
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "storage"));

function resolveKey(key: string) {
  const full = path.resolve(/*turbopackIgnore: true*/ ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("invalid storage key");
  return full;
}

export async function putObject(key: string, data: Buffer) {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function statObject(key: string) {
  try {
    return await stat(resolveKey(key));
  } catch {
    return null;
  }
}

export function readObjectStream(key: string, range?: { start: number; end: number }) {
  const stream = createReadStream(resolveKey(key), range);
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function deleteObject(key: string) {
  try {
    await unlink(resolveKey(key));
  } catch {
    /* already gone */
  }
}
