"use server";

import { z } from "zod";
import { getWorkspaceContext } from "@/lib/auth/session";
import { PLAN_LIMITS } from "@/lib/plans";
import { discover } from "@/lib/discover";
import { DISCOVER_SOURCES, type DiscoverResult } from "@/lib/discover/types";
import { audit } from "@/lib/audit";

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  sources: z.array(z.enum(DISCOVER_SOURCES)).min(1),
  types: z.array(z.enum(["short", "video", "post"])).min(1),
  period: z.enum(["day", "week", "month", "year", "any"]),
  minViews: z.number().int().min(0).max(1e10).optional(),
  minLikes: z.number().int().min(0).max(1e10).optional(),
  minComments: z.number().int().min(0).max(1e10).optional(),
  sort: z.enum(["views", "likes", "comments", "engagement", "recent"]),
  region: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  language: z.string().regex(/^[a-z]{2}$/).optional(),
});

export type DiscoverResponse = { error?: string; result?: DiscoverResult; cached?: boolean; used?: number; limit?: number };

export async function discoverAction(raw: unknown, fresh = false): Promise<DiscoverResponse> {
  const ctx = await getWorkspaceContext();
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) return { error: "Type a keyword or hashtag and pick at least one platform and content type." };
  const limit = (PLAN_LIMITS[ctx.workspace.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free).discoverPerDay;
  const r = await discover(ctx.workspace.id, ctx.user.id, parsed.data, { fresh, dailyLimit: limit });
  if ("error" in r) return { error: r.error, used: r.used, limit };
  if (!r.cached) await audit({ action: "discover.searched", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "discover", meta: { q: parsed.data.q, sources: parsed.data.sources, results: r.result.items.length } });
  return { result: r.result, cached: r.cached, used: r.used, limit };
}
