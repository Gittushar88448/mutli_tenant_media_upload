import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { decodeJwt } from "jose";
import { connectDB } from "@/lib/db";
import { AppSettings, User } from "@/lib/models";
import { audit } from "@/lib/audit";
import { appUrl } from "@/lib/oauth";

/**
 * "Continue with Google" for sign-in and sign-up: OpenID Connect authorization code flow
 * with PKCE, state and nonce. Uses GOOGLE_AUTH_CLIENT_ID/SECRET, or falls back to the
 * GOOGLE_CLIENT_ID/SECRET the YouTube connector uses (one OAuth client can serve both;
 * add both redirect URLs to it).
 */
export function googleAuthConfig() {
  const id = process.env.GOOGLE_AUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_AUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

export const googleRedirectUri = () => `${appUrl()}/api/auth/google/callback`;
export const GOOGLE_FLOW_COOKIE = "relay_google";
export const GOOGLE_FLOW_AUDIENCE = "relay:google-signin";

const b64url = (buf: Buffer) => buf.toString("base64url");

export function newFlow() {
  const verifier = b64url(randomBytes(32));
  return {
    state: b64url(randomBytes(16)),
    nonce: b64url(randomBytes(16)),
    verifier,
    challenge: b64url(createHash("sha256").update(verifier).digest()),
  };
}

export function authorizeUrl(flow: { state: string; nonce: string; challenge: string }, clientId: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: flow.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export type GoogleProfile = { sub: string; email: string; name: string; picture?: string };

export class GoogleSignInError extends Error {
  constructor(public code: "exchange" | "token" | "unverified" | "closed" | "suspended") {
    super(code);
  }
}

/**
 * Swaps the code for tokens and reads the ID token. It comes straight from Google's token
 * endpoint over TLS, so per OpenID Connect Core 3.1.3.7 the claims are checked (issuer,
 * audience, expiry, nonce) without re-verifying the signature.
 */
export async function exchangeCode(code: string, verifier: string, nonce: string): Promise<GoogleProfile> {
  const cfg = googleAuthConfig();
  if (!cfg) throw new GoogleSignInError("exchange");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: cfg.id, client_secret: cfg.secret, redirect_uri: googleRedirectUri(), grant_type: "authorization_code", code_verifier: verifier }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!res.ok || !json.id_token) throw new GoogleSignInError("exchange");

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwt(json.id_token);
  } catch {
    throw new GoogleSignInError("token");
  }
  const now = Date.now() / 1000;
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(cfg.id) : claims.aud === cfg.id;
  if (
    !["https://accounts.google.com", "accounts.google.com"].includes(String(claims.iss)) ||
    !audOk ||
    typeof claims.exp !== "number" ||
    claims.exp < now - 60 ||
    claims.nonce !== nonce ||
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string"
  ) {
    throw new GoogleSignInError("token");
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new GoogleSignInError("unverified");
  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : claims.email.split("@")[0]!,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
  };
}

/**
 * Finds the Relay user for a Google account, linking by verified email the first time, or
 * creates one. New users have no workspace yet; onboarding asks them to name one.
 */
export async function signInWithGoogle(profile: GoogleProfile, timezone: string) {
  await connectDB();
  let user = await User.findOne({ googleId: profile.sub });
  let created = false;
  if (!user) {
    user = await User.findOne({ email: profile.email });
    if (user) {
      user.googleId = profile.sub;
      if (!user.avatarUrl && profile.picture) user.avatarUrl = profile.picture;
    }
  }
  if (!user) {
    const settings = await AppSettings.findOne({ key: "global" }).lean();
    const isFirstUser = (await User.estimatedDocumentCount()) === 0;
    if (settings && !settings.registrationOpen && !isFirstUser) throw new GoogleSignInError("closed");
    user = new User({
      name: profile.name.slice(0, 80),
      email: profile.email,
      googleId: profile.sub,
      avatarUrl: profile.picture,
      // The very first account on a fresh install becomes the platform admin.
      role: isFirstUser ? "admin" : "user",
      timezone,
    });
    created = true;
  }
  if (user.status === "suspended") throw new GoogleSignInError("suspended");
  if (user.status === "invited") user.status = "active";
  user.lastLoginAt = new Date();
  await user.save();

  const actor = { id: String(user._id), email: user.email };
  await audit({ action: created ? "user.registered" : "user.login", actor, entity: "user", entityId: String(user._id), meta: { method: "google" } });
  return { user, created };
}
