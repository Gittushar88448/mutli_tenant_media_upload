import { type NextRequest } from "next/server";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { getWorkspaceContext } from "@/lib/auth/session";
import { verifyDownloadUrl } from "@/lib/crypto";
import { scratchPath } from "@/lib/storage";
import { FFMPEG, run } from "@/lib/media/render";

/**
 * Downloads a file Discover listed (an image, a video at a chosen quality, or a thumbnail).
 * Only URLs signed by the search that produced them are fetched, so this can't be used as
 * an open proxy. Reddit keeps video and sound in separate files; they're joined here.
 */
export const maxDuration = 120;

const MAX = 300 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

async function grab(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { "user-agent": "Relay/1.0" } });
  if (!res.ok) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX) throw new Error("too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX) throw new Error("too large");
  return { buf, type: (res.headers.get("content-type") ?? "").split(";")[0]!.trim() };
}

export async function GET(req: NextRequest) {
  await getWorkspaceContext();
  const sp = req.nextUrl.searchParams;
  const url = sp.get("u") ?? "";
  if (!verifyDownloadUrl(url, sp.get("s")) || !url.startsWith("https://")) return new Response("Not allowed", { status: 403 });
  const name = (sp.get("n") ?? "download").replace(/[^\w.-]+/g, "_").slice(0, 80);

  let file: { buf: Buffer; type: string } | null;
  try {
    file = await grab(url);
  } catch {
    return new Response("That file is too large to download here.", { status: 413 });
  }
  if (!file) return new Response("The platform didn't return that file. It may have been removed.", { status: 502 });

  let { buf, type } = file;
  const reddit = url.match(/^(https:\/\/v\.redd\.it\/[^/]+)\/DASH_\d+\.mp4/);
  if (reddit) {
    type = "video/mp4";
    const audio = (await grab(`${reddit[1]}/DASH_AUDIO_128.mp4`).catch(() => null)) ?? (await grab(`${reddit[1]}/DASH_audio.mp4`).catch(() => null));
    if (audio) {
      const [v, a, out] = [await scratchPath("mp4"), await scratchPath("m4a"), await scratchPath("mp4")];
      try {
        await writeFile(v, buf);
        await writeFile(a, audio.buf);
        await run(FFMPEG(), ["-y", "-hide_banner", "-loglevel", "error", "-i", v, "-i", a, "-c", "copy", "-map", "0:v:0", "-map", "1:a:0", "-movflags", "+faststart", out], 60_000);
        buf = await readFile(out);
      } catch {
        /* keep the silent video */
      } finally {
        await Promise.all([v, a, out].map((f) => unlink(f).catch(() => {})));
      }
    }
  }
  const ext = EXT[type] ?? url.split("?")[0]!.split(".").pop()?.slice(0, 4) ?? "bin";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": type || "application/octet-stream",
      "content-length": String(buf.length),
      "content-disposition": `attachment; filename="${name}.${ext}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
