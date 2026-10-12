import { NextResponse } from "next/server";
import { checkInternal } from "@/lib/internal-auth";
import { connectDB } from "@/lib/db";
import { OAuthCredential, PostTarget, SocialAccount, isOid } from "@/lib/models";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/oauth";
import { recordTargetEvent } from "@/lib/publishing/engine";
import type { PlatformId } from "@/lib/platforms";

/**
 * GET /api/internal/targets/{id}/credentials — a fresh access token for this target's
 * account, refreshed first when it expires within 10 minutes. Never logged, never cached.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/internal/targets/[id]/credentials">) {
  const denied = checkInternal(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isOid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await connectDB();
  const target = await PostTarget.findById(id).lean();
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  const account = await SocialAccount.findById(target.socialAccountId).lean();
  if (!account) return NextResponse.json({ error: "account missing" }, { status: 404 });

  const headers = { "cache-control": "no-store" };
  if (account.platform === "webhook") {
    return NextResponse.json(
      {
        kind: "webhook",
        endpointUrl: account.connector?.endpointUrl,
        authHeader: account.connector?.authHeaderEnc ? decrypt(account.connector.authHeaderEnc) : null,
        signingSecret: account.connector?.signingSecretEnc ? decrypt(account.connector.signingSecretEnc) : null,
      },
      { headers }
    );
  }
  if (account.platform === "manual") {
    return NextResponse.json({ kind: "manual", notifyEmail: account.connector?.notifyEmail ?? null }, { headers });
  }

  const cred = await OAuthCredential.findOne({ socialAccountId: account._id });
  if (!cred) {
    await recordTargetEvent(id, { step: "needs_action", errorCode: "NO_CREDENTIALS", message: "Reconnect this channel.", authError: true });
    return NextResponse.json({ error: "no credentials" }, { status: 409 });
  }

  const expiringSoon = cred.expiresAt && cred.expiresAt.getTime() - Date.now() < 10 * 60 * 1000;
  if (expiringSoon && cred.refreshTokenEnc && !account.sandbox) {
    try {
      const t = await refreshAccessToken(account.platform as PlatformId, decrypt(cred.refreshTokenEnc));
      cred.accessTokenEnc = encrypt(t.accessToken);
      if (t.refreshToken) cred.refreshTokenEnc = encrypt(t.refreshToken);
      cred.expiresAt = t.expiresIn ? new Date(Date.now() + t.expiresIn * 1000) : cred.expiresAt;
      await cred.save();
    } catch (e) {
      const authFail = (e as { auth?: boolean }).auth;
      await recordTargetEvent(id, { step: authFail ? "needs_action" : "retrying", errorCode: "TOKEN_REFRESH_FAILED", message: (e as Error).message, authError: authFail, retryable: !authFail });
      return NextResponse.json({ error: "token refresh failed" }, { status: 409 });
    }
  }

  return NextResponse.json(
    {
      kind: "oauth",
      platform: account.platform,
      sandbox: Boolean(account.sandbox),
      externalId: account.externalId,
      accountType: account.accountType,
      accessToken: decrypt(cred.accessTokenEnc),
      expiresAt: cred.expiresAt,
    },
    { headers }
  );
}
