import { NextResponse, type NextRequest } from "next/server";
import { SignJWT } from "jose";
import { getWorkspaceContext, can } from "@/lib/auth/session";
import { SOCIAL_PLATFORMS, isPlatformConfigured, type PlatformId } from "@/lib/platforms";
import { buildAuthorizeUrl } from "@/lib/oauth";
import { randomToken } from "@/lib/crypto";

const stateSecret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-auth-secret-change-me-please-0123456789");

export async function GET(req: NextRequest, ctx: RouteContext<"/api/oauth/[platform]/start">) {
  const { platform } = await ctx.params;
  if (!SOCIAL_PLATFORMS.some((p) => p.id === platform)) return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  const ws = await getWorkspaceContext();
  if (!can(ws.role, "admin")) return NextResponse.redirect(new URL("/accounts?error=Only+admins+can+connect+channels", req.url));
  if (!isPlatformConfigured(platform as PlatformId)) return NextResponse.redirect(new URL("/accounts?error=This+platform+isn%27t+set+up+yet", req.url));

  const nonce = randomToken(16);
  const { url, verifier } = buildAuthorizeUrl(platform as PlatformId, nonce);
  const cookie = await new SignJWT({ nonce, verifier, ws: ws.workspace.id, uid: ws.user.id, platform })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(stateSecret());

  const res = NextResponse.redirect(url);
  res.cookies.set(`relay_oauth_${platform}`, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/api/oauth" });
  return res;
}
