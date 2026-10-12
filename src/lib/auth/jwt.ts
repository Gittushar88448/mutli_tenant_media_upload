import { SignJWT, jwtVerify } from "jose";

/** Edge-safe session token helpers, shared by proxy.ts and the server. */
export const SESSION_COOKIE = "relay_session";
export const WORKSPACE_COOKIE = "relay_ws";
const SESSION_TTL_DAYS = 14;

export type SessionPayload = { sub: string; role: "user" | "admin"; v: number };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set (32+ chars)");
    return new TextEncoder().encode("dev-only-auth-secret-change-me-please-0123456789");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ role: payload.role, v: payload.v })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    // Flow tokens carry an audience and never count as a session.
    if (!payload.sub || payload.aud) return null;
    return { sub: payload.sub, role: payload.role === "admin" ? "admin" : "user", v: Number(payload.v ?? 0) };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
};

/** Short-lived signed state for multi-step flows such as Google sign-in. */
export async function signFlowToken(audience: string, data: Record<string, string>, minutes: number) {
  return new SignJWT(data).setProtectedHeader({ alg: "HS256" }).setAudience(audience).setIssuedAt().setExpirationTime(`${minutes}m`).sign(secret());
}

export async function verifyFlowToken(audience: string, token: string | undefined): Promise<Record<string, string> | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], audience });
    return Object.fromEntries(Object.entries(payload).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return null;
  }
}
