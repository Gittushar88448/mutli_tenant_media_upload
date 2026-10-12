import "server-only";
import { createHash } from "node:crypto";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { randomToken } from "@/lib/crypto";

/**
 * authorizeUrl() / handleCallback() / refreshToken() from the connector interface.
 * Authorization-code flow with state and PKCE; the verifier rides in a short-lived,
 * signed cookie. Account discovery returns every page/channel/profile the user can post to.
 */
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const redirectUri = (p: string) => `${appUrl()}/api/oauth/${p}/callback`;

export function buildAuthorizeUrl(platform: PlatformId, state: string) {
  const spec = PLATFORMS[platform];
  const o = spec.oauth!;
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(o.authorizeUrl);
  const clientId = process.env[o.clientIdEnv]!;
  url.searchParams.set(platform === "tiktok" ? "client_key" : "client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(platform));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", o.scopes.join(platform === "tiktok" || platform === "threads" ? "," : " "));
  if (platform === "youtube") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
  }
  if (platform === "reddit") url.searchParams.set("duration", "permanent");
  if (["x", "tiktok", "youtube"].includes(platform)) {
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return { url: url.toString(), verifier };
}

type TokenSet = { accessToken: string; refreshToken?: string; expiresIn?: number; refreshExpiresIn?: number; scope?: string[]; openId?: string };

export async function exchangeCode(platform: PlatformId, code: string, verifier: string): Promise<TokenSet> {
  const o = PLATFORMS[platform].oauth!;
  const id = process.env[o.clientIdEnv]!;
  const secret = process.env[o.clientSecretEnv]!;
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(platform) });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (platform === "tiktok") {
    body.set("client_key", id);
    body.set("client_secret", secret);
    body.set("code_verifier", verifier);
  } else if (platform === "x") {
    body.set("code_verifier", verifier);
    body.set("client_id", id);
    headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  } else if (platform === "reddit") {
    headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
    headers["user-agent"] = "web:relay-scheduler:1.0 (multi-channel publisher)";
  } else {
    body.set("client_id", id);
    body.set("client_secret", secret);
    if (platform === "youtube") body.set("code_verifier", verifier);
  }
  const res = await fetch(o.tokenUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(json.error_description ?? json.error?.message ?? json.error ?? `Token exchange failed (${res.status})`);
  let token: TokenSet = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    refreshExpiresIn: json.refresh_expires_in ?? json.refresh_token_expires_in,
    scope: typeof json.scope === "string" ? json.scope.split(/[ ,]/) : undefined,
    openId: json.open_id,
  };
  // Meta: swap the short-lived user token for a long-lived one (about 60 days).
  if (platform === "facebook" || platform === "instagram") {
    const u = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    u.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: token.accessToken }).toString();
    const ll = await fetch(u, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    if (ll.access_token) token = { ...token, accessToken: ll.access_token, expiresIn: ll.expires_in ?? 60 * 24 * 3600 };
  }
  return token;
}

export type DiscoveredAccount = {
  externalId: string;
  handle: string;
  displayName?: string;
  accountType: string;
  avatarUrl?: string;
  profileUrl?: string;
  /** Page tokens etc. When present, this token is stored instead of the user token. */
  accessToken?: string;
};

async function getJson(url: string, token?: string) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (url.includes("reddit.com")) headers["user-agent"] = "web:relay-scheduler:1.0 (multi-channel publisher)";
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? `Platform request failed (${res.status})`);
  return json;
}

export async function discoverAccounts(platform: PlatformId, token: TokenSet): Promise<DiscoveredAccount[]> {
  const t = token.accessToken;
  switch (platform) {
    case "facebook": {
      const j = await getJson(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,picture{url},link&limit=100`, t);
      return (j.data ?? []).map((p: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; link?: string }) => ({
        externalId: p.id,
        handle: p.name,
        displayName: p.name,
        accountType: "page",
        avatarUrl: p.picture?.data?.url,
        profileUrl: p.link ?? `https://facebook.com/${p.id}`,
        accessToken: p.access_token,
      }));
    }
    case "instagram": {
      const j = await getJson(
        `https://graph.facebook.com/v21.0/me/accounts?fields=access_token,instagram_business_account{id,username,name,profile_picture_url}&limit=100`,
        t
      );
      return (j.data ?? [])
        .filter((p: { instagram_business_account?: unknown }) => p.instagram_business_account)
        .map((p: { access_token: string; instagram_business_account: { id: string; username: string; name?: string; profile_picture_url?: string } }) => ({
          externalId: p.instagram_business_account.id,
          handle: `@${p.instagram_business_account.username}`,
          displayName: p.instagram_business_account.name,
          accountType: "business",
          avatarUrl: p.instagram_business_account.profile_picture_url,
          profileUrl: `https://instagram.com/${p.instagram_business_account.username}`,
          accessToken: p.access_token,
        }));
    }
    case "youtube": {
      const j = await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", t);
      return (j.items ?? []).map((c: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }) => ({
        externalId: c.id,
        handle: c.snippet.customUrl ?? c.snippet.title,
        displayName: c.snippet.title,
        accountType: "channel",
        avatarUrl: c.snippet.thumbnails?.default?.url,
        profileUrl: `https://youtube.com/channel/${c.id}`,
      }));
    }
    case "tiktok": {
      const j = await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username", t);
      const u = j.data?.user ?? {};
      return [{ externalId: u.open_id ?? token.openId, handle: u.username ? `@${u.username}` : u.display_name, displayName: u.display_name, accountType: "creator", avatarUrl: u.avatar_url, profileUrl: u.username ? `https://tiktok.com/@${u.username}` : undefined }];
    }
    case "linkedin": {
      const u = await getJson("https://api.linkedin.com/v2/userinfo", t);
      return [{ externalId: `urn:li:person:${u.sub}`, handle: u.name, displayName: u.name, accountType: "member", avatarUrl: u.picture }];
    }
    case "x": {
      const j = await getJson("https://api.twitter.com/2/users/me?user.fields=profile_image_url", t);
      return [{ externalId: j.data.id, handle: `@${j.data.username}`, displayName: j.data.name, accountType: "user", avatarUrl: j.data.profile_image_url, profileUrl: `https://x.com/${j.data.username}` }];
    }
    case "threads": {
      const j = await getJson(`https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=${encodeURIComponent(t)}`);
      return [{ externalId: j.id, handle: `@${j.username}`, accountType: "profile", avatarUrl: j.threads_profile_picture_url, profileUrl: `https://threads.net/@${j.username}` }];
    }
    case "pinterest": {
      const j = await getJson("https://api.pinterest.com/v5/user_account", t);
      return [{ externalId: j.username, handle: j.username, accountType: j.account_type?.toLowerCase() ?? "business", avatarUrl: j.profile_image, profileUrl: `https://pinterest.com/${j.username}` }];
    }
    case "reddit": {
      const j = await getJson("https://oauth.reddit.com/api/v1/me", t);
      return [{ externalId: j.id, handle: `u/${j.name}`, displayName: j.name, accountType: "user", avatarUrl: j.icon_img?.split("?")[0], profileUrl: `https://www.reddit.com/user/${j.name}` }];
    }
  }
}

/** Refreshes a token that has a refresh token. Meta page tokens don't expire and are skipped. */
export async function refreshAccessToken(platform: PlatformId, refreshToken: string): Promise<TokenSet> {
  const o = PLATFORMS[platform].oauth!;
  const id = process.env[o.clientIdEnv]!;
  const secret = process.env[o.clientSecretEnv]!;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (platform === "tiktok") {
    body.set("client_key", id);
    body.set("client_secret", secret);
  } else if (platform === "x") {
    body.set("client_id", id);
    headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  } else if (platform === "reddit") {
    headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
    headers["user-agent"] = "web:relay-scheduler:1.0 (multi-channel publisher)";
  } else {
    body.set("client_id", id);
    body.set("client_secret", secret);
  }
  const res = await fetch(o.tokenUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const err = new Error(json.error_description ?? json.error ?? `Refresh failed (${res.status})`) as Error & { auth?: boolean };
    err.auth = res.status === 400 || res.status === 401;
    throw err;
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? refreshToken, expiresIn: json.expires_in, refreshExpiresIn: json.refresh_expires_in };
}
