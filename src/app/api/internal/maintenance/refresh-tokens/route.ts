import { NextResponse } from "next/server";
import { checkInternal } from "@/lib/internal-auth";
import { connectDB } from "@/lib/db";
import { Membership, Notification, OAuthCredential, SocialAccount } from "@/lib/models";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/oauth";
import { isPlatformConfigured, type PlatformId } from "@/lib/platforms";

/**
 * POST /api/internal/maintenance/refresh-tokens — run daily by n8n. Refreshes tokens that
 * expire within 7 days and flags accounts that can't be refreshed, warning their admins.
 */
export async function POST(req: Request) {
  const denied = checkInternal(req);
  if (denied) return denied;
  await connectDB();
  const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const creds = await OAuthCredential.aggregate([
    { $match: { expiresAt: { $lte: soon } } },
    { $lookup: { from: "socialaccounts", localField: "socialAccountId", foreignField: "_id", as: "acc" } },
    { $unwind: "$acc" },
    { $match: { "acc.status": "active", "acc.sandbox": { $ne: true } } },
    { $limit: 500 },
  ]);

  let refreshed = 0;
  let flagged = 0;
  for (const c of creds) {
    const platform = c.acc.platform as PlatformId;
    try {
      if (!c.refreshTokenEnc || !isPlatformConfigured(platform)) throw Object.assign(new Error("no refresh token"), { auth: true });
      const t = await refreshAccessToken(platform, decrypt(c.refreshTokenEnc));
      await OAuthCredential.updateOne(
        { _id: c._id },
        { $set: { accessTokenEnc: encrypt(t.accessToken), refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : c.refreshTokenEnc, expiresAt: t.expiresIn ? new Date(Date.now() + t.expiresIn * 1000) : c.expiresAt } }
      );
      refreshed++;
    } catch (e) {
      if (!(e as { auth?: boolean }).auth) continue;
      flagged++;
      await SocialAccount.updateOne({ _id: c.acc._id }, { $set: { status: "needs_reauth", lastHealthCheckAt: new Date() } });
      const admins = await Membership.find({ workspaceId: c.acc.workspaceId, role: { $in: ["owner", "admin"] } }).lean();
      await Notification.insertMany(
        admins.map((a) => ({
          workspaceId: c.acc.workspaceId,
          userId: a.userId,
          kind: "needs_reauth",
          title: `Reconnect ${c.acc.handle}`,
          body: "Its sign-in is about to expire. Reconnect so scheduled posts keep going out.",
          href: "/accounts",
        }))
      );
    }
  }
  return NextResponse.json({ checked: creds.length, refreshed, flagged });
}
