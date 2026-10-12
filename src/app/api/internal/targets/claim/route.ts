import { NextResponse } from "next/server";
import { z } from "zod";
import { checkInternal } from "@/lib/internal-auth";
import { claimDueTargets } from "@/lib/publishing/engine";

const Body = z.object({ limit: z.number().int().min(1).max(100).optional(), workerId: z.string().max(80).optional(), targetIds: z.array(z.string()).max(100).optional() });

/** POST /api/internal/targets/claim — n8n's dispatcher calls this every minute (and for "publish now"). */
export async function POST(req: Request) {
  const denied = checkInternal(req);
  if (denied) return denied;
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const targets = await claimDueTargets({ limit: body.data.limit, workerId: body.data.workerId, onlyIds: body.data.targetIds });
  return NextResponse.json({ targets, claimedAt: new Date().toISOString() });
}
