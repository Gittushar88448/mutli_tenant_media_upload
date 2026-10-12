import { NextResponse } from "next/server";
import { checkInternal } from "@/lib/internal-auth";
import { isOid } from "@/lib/models";
import { deliverDirect } from "@/lib/publishing/direct";

/**
 * POST /api/internal/targets/{id}/send — delivers a claimed target through Relay's
 * built-in connector (Telegram, WhatsApp, Discord, Slack, Bluesky, Mastodon, Reddit) and
 * records every step. n8n's Publish target workflow routes those platforms here.
 */
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/internal/targets/[id]/send">) {
  const denied = checkInternal(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isOid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { executionId?: string };
  const result = await deliverDirect(id, body.executionId ?? "n8n");
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
