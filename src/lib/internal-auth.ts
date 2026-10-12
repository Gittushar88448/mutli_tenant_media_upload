import "server-only";
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";

/**
 * n8n → app calls. Shared secret header plus an optional IP allowlist; these routes are
 * meant to be reachable only from the private network n8n runs in.
 */
export function checkInternal(req: Request): NextResponse | null {
  const secret = process.env.N8N_SHARED_SECRET;
  if (!secret) return NextResponse.json({ error: "N8N_SHARED_SECRET is not configured" }, { status: 503 });
  const given = req.headers.get("x-relay-secret") ?? "";
  if (!safeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const allow = process.env.INTERNAL_IP_ALLOWLIST?.split(",").map((s) => s.trim()).filter(Boolean);
  if (allow?.length) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "";
    if (!allow.includes(ip)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
