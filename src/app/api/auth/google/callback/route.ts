import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, WORKSPACE_COOKIE, sessionCookieOptions, signSession, verifyFlowToken } from "@/lib/auth/jwt";
import { GOOGLE_FLOW_AUDIENCE, GOOGLE_FLOW_COOKIE, GoogleSignInError, exchangeCode, signInWithGoogle } from "@/lib/auth/google";
import { Membership } from "@/lib/models";

/**
 * GET /api/auth/google/callback — Google sends the browser back here. Checks the state
 * against the signed flow cookie, swaps the code (with the PKCE verifier) for an ID token,
 * then signs the user in, linking or creating their Relay account.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const flow = await verifyFlowToken(GOOGLE_FLOW_AUDIENCE, req.cookies.get(GOOGLE_FLOW_COOKIE)?.value);
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=google_${code}`, req.url));
    res.cookies.delete({ name: GOOGLE_FLOW_COOKIE, path: "/api/auth/google" });
    return res;
  };

  if (q.get("error")) return fail(q.get("error") === "access_denied" ? "cancelled" : "failed");
  const code = q.get("code");
  if (!flow || !code || q.get("state") !== flow.state) return fail("expired");

  try {
    const profile = await exchangeCode(code, flow.verifier!, flow.nonce!);
    const { user } = await signInWithGoogle(profile, flow.tz || "UTC");
    // No workspace yet (a new account, or removed from every one): onboarding names one.
    const membership = await Membership.findOne({ userId: user._id }).lean();
    const dest = !membership ? "/onboarding?welcome=1" : flow.next || "/dashboard";
    const res = NextResponse.redirect(new URL(dest, req.url));
    res.cookies.delete({ name: GOOGLE_FLOW_COOKIE, path: "/api/auth/google" });
    res.cookies.set(SESSION_COOKIE, await signSession({ sub: String(user._id), role: user.role as "user" | "admin", v: 1 }), sessionCookieOptions);
    const wsId = user.defaultWorkspaceId ? String(user.defaultWorkspaceId) : membership ? String(membership.workspaceId) : null;
    if (wsId) res.cookies.set(WORKSPACE_COOKIE, wsId, { ...sessionCookieOptions, httpOnly: false });
    return res;
  } catch (e) {
    return fail(e instanceof GoogleSignInError ? e.code : "failed");
  }
}
