import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { OAuthCredential, PostTarget, SocialAccount, oid, type PostTargetDoc, type SocialAccountDoc } from "@/lib/models";
import { LiveReply, LiveSnapshot, type LiveReplyDoc } from "@/lib/models/live";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/oauth";
import { PLATFORMS, type PlatformId, type TargetPlatform } from "@/lib/platforms";
import { LiveError, fetchLive, hasLiveApi, replyLive, type LiveContext } from "./fetchers";
import { simulateLive } from "./sandbox";
import { liveCaps, type LiveComment, type LivePayload } from "./types";

/**
 * The Live view's read path. A snapshot younger than FRESH_MS is reused; older ones are
 * fetched again from the platform (or simulated for sandbox channels) and stored. A failed
 * fetch keeps the previous numbers and records the error next to them.
 */

export const FRESH_MS = 5 * 60_000;
const CONCURRENCY = 6;

export type Snapshot = { payload: LivePayload | null; fetchedAt: Date; error?: string | null; authError?: boolean | null };

type Target = Pick<PostTargetDoc, "_id" | "workspaceId" | "socialAccountId" | "platform" | "postType" | "platformPostId" | "permalink" | "platformMessageIds" | "publishedAt" | "status">;
type Account = Pick<SocialAccountDoc, "_id" | "platform" | "externalId" | "handle" | "connector" | "sandbox" | "status">;

/** Same rules as publishing/direct: one encrypted JSON blob, or an OAuth token refreshed near expiry. */
async function loadSecrets(account: Account): Promise<Record<string, string>> {
  const cred = await OAuthCredential.findOne({ socialAccountId: account._id });
  if (!cred) throw new LiveError("No saved credentials. Reconnect this channel.", { auth: true });
  if (PLATFORMS[account.platform as TargetPlatform]?.oauth) {
    if (cred.refreshTokenEnc && cred.expiresAt && cred.expiresAt.getTime() - Date.now() < 10 * 60_000) {
      try {
        const t = await refreshAccessToken(account.platform as PlatformId, decrypt(cred.refreshTokenEnc));
        cred.accessTokenEnc = encrypt(t.accessToken);
        if (t.refreshToken) cred.refreshTokenEnc = encrypt(t.refreshToken);
        if (t.expiresIn) cred.expiresAt = new Date(Date.now() + t.expiresIn * 1000);
        await cred.save();
      } catch (e) {
        throw new LiveError(`Couldn't refresh the sign-in: ${(e as Error).message}`, { auth: Boolean((e as { auth?: boolean }).auth) });
      }
    }
    return { accessToken: decrypt(cred.accessTokenEnc) };
  }
  try {
    return JSON.parse(decrypt(cred.accessTokenEnc));
  } catch {
    return {};
  }
}

function contextFor(t: Target, a: Account, secret: Record<string, string>): LiveContext {
  return {
    platform: t.platform,
    postType: t.postType,
    platformPostId: t.platformPostId!,
    permalink: t.permalink,
    messageIds: t.platformMessageIds ?? [],
    account: { externalId: a.externalId, handle: a.handle, connector: (a.connector ?? {}) as Record<string, unknown> },
    secret,
  };
}

/** What Relay's own records say, for platforms with nothing to ask. */
function fromRecord(t: Target): LivePayload {
  return { metrics: {}, comments: [], status: t.status === "published" ? "live" : "unknown", fetchedAt: new Date().toISOString(), note: liveCaps(t.platform).note };
}

// Overlapping refreshes of the same target (two tabs, auto-refresh plus a click) share one request.
const inflight = new Map<string, Promise<Snapshot>>();

async function fetchOne(t: Target, a: Account, previous: Snapshot | undefined): Promise<Snapshot> {
  const now = new Date();
  let payload: LivePayload | null = previous?.payload ?? null;
  let error: string | null = null;
  let authError = false;
  try {
    if (a.sandbox) payload = simulateLive({ targetId: String(t._id), platform: t.platform, publishedAt: t.publishedAt ?? null, now });
    else if (!hasLiveApi(t.platform) || !t.platformPostId) payload = fromRecord(t);
    else if (a.status === "revoked" || a.status === "disabled") throw new LiveError(`This channel is ${a.status}. Reconnect it to see live numbers.`, { auth: true });
    else payload = { ...(await fetchLive(contextFor(t, a, await loadSecrets(a)))), fetchedAt: now.toISOString() };
  } catch (e) {
    error = e instanceof LiveError ? e.message : `Unexpected error: ${(e as Error).message}`;
    authError = e instanceof LiveError && Boolean(e.opts.auth);
  }
  await LiveSnapshot.updateOne(
    { postTargetId: t._id },
    { $set: { workspaceId: t.workspaceId, socialAccountId: t.socialAccountId, platform: t.platform, payload, fetchedAt: now, error, authError } },
    { upsert: true }
  );
  return { payload, fetchedAt: now, error, authError };
}

function refreshOne(t: Target, a: Account, previous: Snapshot | undefined) {
  const key = String(t._id);
  let p = inflight.get(key);
  if (!p) {
    p = fetchOne(t, a, previous).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/**
 * Snapshots for these targets: fresh ones from the cache, stale ones fetched now. Fetches
 * that outlast `budgetMs` keep running and are returned in `pending` (hand them to
 * after()), and the page shows the previous snapshot until the next render.
 */
export async function liveFor(targets: Target[], accounts: Map<string, Account>, opts: { force?: boolean; budgetMs?: number } = {}) {
  await connectDB();
  const cached = await LiveSnapshot.find({ postTargetId: { $in: targets.map((t) => t._id) } }).lean();
  const snapshots = new Map<string, Snapshot>(cached.map((s) => [String(s.postTargetId), { payload: s.payload as LivePayload | null, fetchedAt: s.fetchedAt, error: s.error, authError: s.authError }]));
  const stale = targets.filter((t) => {
    if (!accounts.has(String(t.socialAccountId))) return false;
    const s = snapshots.get(String(t._id));
    return opts.force || !s || Date.now() - s.fetchedAt.getTime() > FRESH_MS;
  });

  // A small pool so thirty posts don't open thirty connections at once.
  const queue = [...stale];
  const work = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const snap = await refreshOne(t, accounts.get(String(t.socialAccountId))!, snapshots.get(String(t._id)));
      snapshots.set(String(t._id), snap);
    }
  });
  const all = Promise.allSettled(work);
  let finished = false;
  if (opts.budgetMs == null) {
    await all;
    finished = true;
  } else {
    finished = await Promise.race([all.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), opts.budgetMs))]);
  }
  return { snapshots, pending: finished ? null : all, refreshed: stale.length };
}

/** Replies sent from Relay, grouped by target, to merge into each snapshot's comments. */
export async function repliesFor(targetIds: Types.ObjectId[]) {
  const rows = await LiveReply.find({ postTargetId: { $in: targetIds }, ok: true }).sort({ createdAt: 1 }).lean<LiveReplyDoc[]>();
  const map = new Map<string, LiveReplyDoc[]>();
  for (const r of rows) map.set(String(r.postTargetId), [...(map.get(String(r.postTargetId)) ?? []), r]);
  return map;
}

/** Adds Relay's own replies under their comments, skipping ones the platform already echoes back. */
export function mergeReplies(comments: LiveComment[], replies: LiveReplyDoc[] | undefined): LiveComment[] {
  if (!replies?.length) return comments;
  return comments.map((c) => {
    const mine = replies.filter((r) => r.commentId === c.id);
    if (!mine.length) return c;
    const seen = new Set((c.replies ?? []).map((r) => r.id));
    const extra = mine
      .filter((r) => !r.platformReplyId || !seen.has(r.platformReplyId))
      .map((r) => ({ id: r.platformReplyId || String(r._id), author: r.byName ?? "You", text: r.text, at: r.createdAt.toISOString(), fromRelay: true }));
    return { ...c, replies: [...(c.replies ?? []), ...extra].sort((a, b) => a.at.localeCompare(b.at)) };
  });
}

/** Sends a reply to one comment of one delivery. Returns an error message, or null when it went out. */
export async function sendReply(input: { workspaceId: string; targetId: string; commentId: string; text: string; user: { id: string; name: string } }): Promise<string | null> {
  await connectDB();
  const t = await PostTarget.findOne({ _id: oid(input.targetId), workspaceId: oid(input.workspaceId) }).lean<Target>();
  if (!t || t.status !== "published") return "That post isn't live.";
  const [a, snap] = await Promise.all([
    SocialAccount.findOne({ _id: t.socialAccountId, workspaceId: oid(input.workspaceId) }).lean<Account>(),
    LiveSnapshot.findOne({ postTargetId: t._id }).lean(),
  ]);
  if (!a) return "The channel no longer exists.";
  if (!liveCaps(t.platform).reply) return `${PLATFORMS[t.platform as TargetPlatform]?.name ?? t.platform} doesn't let apps reply to comments.`;
  // Reply only to comments Relay has seen: the snapshot holds the platform's own reference data.
  const comment = ((snap?.payload as LivePayload | null)?.comments ?? []).find((c) => c.id === input.commentId);
  if (!comment) return "That comment is gone or hasn't been loaded yet. Refresh and try again.";

  let platformReplyId: string | undefined;
  let error: string | null = null;
  if (!a.sandbox) {
    try {
      platformReplyId = (await replyLive(contextFor(t, a, await loadSecrets(a)), comment, input.text)).id || undefined;
    } catch (e) {
      error = e instanceof LiveError ? e.message : `Unexpected error: ${(e as Error).message}`;
    }
  }
  await LiveReply.create({
    workspaceId: t.workspaceId,
    postTargetId: t._id,
    commentId: comment.id,
    text: input.text,
    by: oid(input.user.id),
    byName: `${input.user.name} (via Relay)`,
    platformReplyId,
    ok: !error,
    error: error ?? undefined,
  });
  return error;
}
