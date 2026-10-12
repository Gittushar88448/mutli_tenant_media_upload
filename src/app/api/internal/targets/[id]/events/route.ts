import { NextResponse } from "next/server";
import { z } from "zod";
import { checkInternal } from "@/lib/internal-auth";
import { isOid } from "@/lib/models";
import { recordTargetEvent } from "@/lib/publishing/engine";

const Event = z.object({
  step: z.enum(["preparing", "uploading", "processing", "published", "failed", "retrying", "needs_action"]),
  executionId: z.string().max(100).optional(),
  platformContainerId: z.string().max(300).optional(),
  uploadSessionUrl: z.string().max(2000).optional(),
  platformPostId: z.string().max(300).optional(),
  permalink: z.string().max(2000).optional(),
  errorCode: z.string().max(100).optional(),
  message: z.string().max(2000).optional(),
  httpStatus: z.number().int().optional(),
  retryable: z.boolean().optional(),
  authError: z.boolean().optional(),
  responseExcerpt: z.string().max(4000).optional(),
});

/** POST /api/internal/targets/{id}/events — n8n reports every step; the app is the record. */
export async function POST(req: Request, ctx: RouteContext<"/api/internal/targets/[id]/events">) {
  const denied = checkInternal(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isOid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parsed = Event.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad event", issues: parsed.error.issues }, { status: 400 });
  const res = await recordTargetEvent(id, parsed.data);
  if (!res.ok) return NextResponse.json(res, { status: 404 });
  return NextResponse.json(res);
}
