import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { connectDB } from "@/lib/db";
import { OAuthCredential, SocialAccount, oid } from "@/lib/models";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { discoverAccounts, exchangeCode } from "@/lib/oauth";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/audit";

const stateSecret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-auth-secret-change-me-please-0123456789");

export async function GET(req: NextRequest, ctx: RouteContext<"/api/oauth/[platform]/callback">) {
  const { platform } = await ctx.params;
  const back = (q: string) => NextResponse.redirect(new URL(`/accounts?${q}`, req.url));
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(`error=${encodeURIComponent(sp.get("error_description") ?? "Sign-in was cancelled")}`);

  const raw = req.cookies.get(`relay_oauth_${platform}`)?.value;
  if (!raw) return back("error=Sign-in+expired.+Try+again.");
  let state: { nonce: string; verifier: string; ws: string; uid: string; platform: string };
  try {
    state = (await jwtVerify(raw, stateSecret())).payload as typeof state;
  } catch {
    return back("error=Sign-in+expired.+Try+again.");
  }
  if (state.nonce !== sp.get("state") || state.platform !== platform) return back("error=Sign-in+state+mismatch");

  try {
    await connectDB();
    const p = platform as PlatformId;
    const token = await exchangeCode(p, sp.get("code") ?? "", state.verifier);
    const found = await discoverAccounts(p, token);
    if (found.length === 0) return back(`error=${encodeURIComponent(`No ${PLATFORMS[p].name} accounts you can post to were found`)}`);

    for (const a of found) {
      const acc = await SocialAccount.findOneAndUpdate(
        { workspaceId: oid(state.ws), platform: p, externalId: a.externalId },
        {
          $set: {
            handle: a.handle,
            displayName: a.displayName,
            accountType: a.accountType,
            avatarUrl: a.avatarUrl,
            profileUrl: a.profileUrl,
            status: "active",
            sandbox: false,
            scopes: token.scope ?? PLATFORMS[p].oauth?.scopes,
            lastHealthCheckAt: new Date(),
          },
          $setOnInsert: { connectedBy: oid(state.uid) },
        },
        { upsert: true, new: true }
      );
      await OAuthCredential.findOneAndUpdate(
        { socialAccountId: acc._id },
        {
          $set: {
            workspaceId: oid(state.ws),
            accessTokenEnc: encrypt(a.accessToken ?? token.accessToken),
            refreshTokenEnc: token.refreshToken ? encrypt(token.refreshToken) : undefined,
            scopes: token.scope,
            // Page tokens derived from a long-lived user token don't expire.
            expiresAt: a.accessToken && (p === "facebook" || p === "instagram") ? undefined : token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : undefined,
            refreshExpiresAt: token.refreshExpiresIn ? new Date(Date.now() + token.refreshExpiresIn * 1000) : undefined,
          },
        },
        { upsert: true }
      );
      await audit({ action: "channel.connected", actor: { id: state.uid }, workspaceId: state.ws, entity: "social_account", entityId: String(acc._id), meta: { platform: p } });
    }
    const res = back(`connected=${encodeURIComponent(`${found.length} ${PLATFORMS[p].name} account${found.length > 1 ? "s" : ""}`)}`);
    res.cookies.delete(`relay_oauth_${platform}`);
    return res;
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
