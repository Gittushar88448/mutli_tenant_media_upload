import { NextResponse, type NextRequest } from "next/server";
import { signFlowToken } from "@/lib/auth/jwt";
import { GOOGLE_FLOW_AUDIENCE, GOOGLE_FLOW_COOKIE, authorizeUrl, googleAuthConfig, newFlow } from "@/lib/auth/google";

/** GET /api/auth/google/start?next=/compose&tz=Asia/Kolkata — sends the browser to Google's account chooser. */
export async function GET(req: NextRequest) {
  const cfg = googleAuthConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login?error=google_off", req.url));
  const next = req.nextUrl.searchParams.get("next") ?? "";
  const tz = req.nextUrl.searchParams.get("tz") ?? "";
  const flow = newFlow();
  const token = await signFlowToken(
    GOOGLE_FLOW_AUDIENCE,
    {
      state: flow.state,
      nonce: flow.nonce,
      verifier: flow.verifier,
      next: next.startsWith("/") && !next.startsWith("//") ? next.slice(0, 300) : "",
      tz: /^[A-Za-z_+\-/0-9]{1,64}$/.test(tz) ? tz : "UTC",
    },
    10
  );
  const res = NextResponse.redirect(authorizeUrl(flow, cfg.id));
  res.cookies.set(GOOGLE_FLOW_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 600 });
  return res;
}
