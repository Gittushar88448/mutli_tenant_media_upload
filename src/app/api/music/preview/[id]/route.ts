import { readFile } from "node:fs/promises";
import { getWorkspaceContext } from "@/lib/auth/session";
import { demoAudioPath } from "@/lib/media/music";

/** Plays a demo track. Real library tracks stream straight from Jamendo. */
export async function GET(_req: Request, ctx: RouteContext<"/api/music/preview/[id]">) {
  await getWorkspaceContext();
  const { id } = await ctx.params;
  try {
    const data = await readFile(await demoAudioPath(id));
    return new Response(new Uint8Array(data), { headers: { "content-type": "audio/mpeg", "content-length": String(data.length), "cache-control": "private, max-age=86400" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
