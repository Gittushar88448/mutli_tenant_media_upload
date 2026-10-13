import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM envelope for social tokens and connector secrets. In production the key
 * comes from a KMS-managed secret (TOKEN_ENCRYPTION_KEY, 32 bytes base64); the keyId is
 * stored next to each value so keys can be rotated.
 */
function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    return buf;
  }
  if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENCRYPTION_KEY must be set");
  return Buffer.alloc(32, 7);
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string) {
  const [, iv, tag, data] = payload.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv!, "base64url"));
  decipher.setAuthTag(Buffer.from(tag!, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data!, "base64url")), decipher.final()]).toString("utf8");
}

function signingKey() {
  return process.env.MEDIA_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "dev-media-signing-secret";
}

/** Short-lived signed URL token so platforms (via n8n) can pull media without a session. */
export function signMediaToken(assetId: string, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", signingKey()).update(`${assetId}.${exp}`).digest("base64url");
  return { exp, sig };
}

export function verifyMediaToken(assetId: string, exp: string | null, sig: string | null) {
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = createHmac("sha256", signingKey()).update(`${assetId}.${exp}`).digest();
  const given = Buffer.from(sig, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function hmacSign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

/** Signs an outside media URL so /api/discover/download only fetches files Relay listed. */
export function signDownloadUrl(url: string) {
  return createHmac("sha256", signingKey()).update(`dl.${url}`).digest("base64url");
}

export function verifyDownloadUrl(url: string, sig: string | null) {
  if (!sig) return false;
  const expected = Buffer.from(signDownloadUrl(url));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
