import "server-only";
import { assertSafeWebhookUrl } from "@/lib/ssrf";
import { bskyFacets, bskySession } from "@/lib/publishing/connectors";
import { liveCaps, type LiveComment, type LiveMetrics, type LivePayload } from "./types";

/**
 * Reads a delivered post back from its platform: counts, comments and whether it's still
 * up, plus replying to a comment where the API allows it. Every request has a short
 * timeout and every failure is a LiveError, which the caller stores on the snapshot
 * instead of failing the page. Only documented, read-mostly endpoints are used.
 */

export class LiveError extends Error {
  constructor(
    message: string,
    public opts: { auth?: boolean; gone?: boolean; status?: number } = {}
  ) {
    super(message);
  }
}

export type LiveContext = {
  platform: string;
  postType: string;
  platformPostId: string;
  permalink?: string | null;
  messageIds: string[];
  account: { externalId: string; handle: string; connector: Record<string, unknown> };
  secret: Record<string, string>;
};

export type LiveResult = Omit<LivePayload, "fetchedAt">;

const T = 10_000;
const REDDIT_UA = "web:relay-scheduler:1.0 (multi-channel publisher)";

async function call(url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit; json?: unknown } = {}) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body || init.json ? "POST" : "GET"),
      headers: { ...(init.json ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.json ? JSON.stringify(init.json) : init.body,
      signal: AbortSignal.timeout(T),
      cache: "no-store",
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new LiveError(name === "TimeoutError" || name === "AbortError" ? "The platform took too long to answer." : "Couldn't reach the platform.");
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    // some error pages are HTML; the status code says enough
  }
  return { status: res.status, ok: res.ok, json: json as Record<string, never> & Record<string, unknown> };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const iso = (v: unknown) => (v ? new Date(typeof v === "number" ? v * 1000 : String(v)).toISOString() : new Date(0).toISOString());
const byNewest = (a: LiveComment, b: LiveComment) => b.at.localeCompare(a.at);

/** Runs a secondary read (insights, comments) without letting it sink the main one. */
async function soft<T>(p: Promise<T>, notes: string[], what: string): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof LiveError && e.opts.auth) throw e;
    notes.push(`${what} unavailable: ${(e as Error).message}`);
    return null;
  }
}

const done = (r: { metrics: LiveMetrics; comments?: LiveComment[]; status?: LivePayload["status"]; notes?: string[] }): LiveResult => ({
  metrics: r.metrics,
  comments: (r.comments ?? []).sort(byNewest),
  status: r.status ?? "live",
  note: r.notes?.length ? r.notes.join(" ") : undefined,
});
const removed = (note: string): LiveResult => ({ metrics: {}, comments: [], status: "removed", note });

/* ------------------------------------------------------------------ Meta Graph (Instagram, Facebook) */

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path: string, token: string, params: Record<string, string> = {}, method = "GET") {
  const url = new URL(`${GRAPH}/${path}`);
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await call(url.toString(), {
    method,
    headers: { authorization: `Bearer ${token}` },
    body: method === "GET" ? undefined : new URLSearchParams(params),
  });
  if (!r.ok) {
    const err = (r.json.error ?? {}) as { code?: number; error_subcode?: number; message?: string };
    if (err.code === 190 || r.status === 401) throw new LiveError("The access token expired or was revoked. Reconnect this channel.", { auth: true, status: r.status });
    // 100/33: "Object does not exist" — the post was deleted on the platform.
    if (err.code === 100 && err.error_subcode === 33) throw new LiveError("The post no longer exists.", { gone: true, status: r.status });
    if (err.code === 10 || err.code === 200) throw new LiveError(`Missing permission: ${err.message ?? "reconnect this channel and allow access"}`, { status: r.status });
    throw new LiveError(err.message ?? `Meta returned ${r.status}`, { status: r.status });
  }
  return r.json;
}

type IgComment = { id: string; text?: string; username?: string; timestamp?: string; like_count?: number; replies?: { data?: IgComment[] } };
const igComment = (c: IgComment): LiveComment => ({
  id: c.id,
  author: c.username ? `@${c.username}` : "Instagram user",
  authorUrl: c.username ? `https://instagram.com/${c.username}` : undefined,
  text: c.text ?? "",
  at: iso(c.timestamp),
  likes: num(c.like_count),
  replies: (c.replies?.data ?? []).map(igComment),
});

async function instagramFetch(x: LiveContext): Promise<LiveResult> {
  const token = x.secret.accessToken!;
  const notes: string[] = [];
  let media;
  try {
    media = (await graph(x.platformPostId, token, { fields: "like_count,comments_count,media_product_type" })) as { like_count?: number; comments_count?: number };
  } catch (e) {
    if (e instanceof LiveError && e.opts.gone) return removed("Deleted on Instagram.");
    throw e;
  }
  const metrics: LiveMetrics = { likes: num(media.like_count), comments: num(media.comments_count) };
  // Stories have no insights after 24h and some metrics aren't offered for every media type.
  const insights = (await soft(graph(`${x.platformPostId}/insights`, token, { metric: "views,saved,shares" }), notes, "Insights")) as {
    data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[];
  } | null;
  for (const m of insights?.data ?? []) {
    const v = num(m.total_value?.value) ?? num(m.values?.[0]?.value);
    if (m.name === "views") metrics.views = v;
    if (m.name === "saved") metrics.saves = v;
    if (m.name === "shares") metrics.shares = v;
  }
  const list = (await soft(
    graph(`${x.platformPostId}/comments`, token, { fields: "id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}", limit: "50" }),
    notes,
    "Comments"
  )) as { data?: IgComment[] } | null;
  return done({ metrics, comments: (list?.data ?? []).map(igComment), notes });
}

async function instagramReply(x: LiveContext, c: LiveComment, text: string) {
  const r = (await graph(`${c.id}/replies`, x.secret.accessToken!, { message: text }, "POST")) as { id?: string };
  return { id: String(r.id ?? "") };
}

type FbComment = { id: string; message?: string; from?: { name?: string; id?: string }; created_time?: string; like_count?: number; comments?: { data?: FbComment[] } };
const fbComment = (c: FbComment): LiveComment => ({
  id: c.id,
  // Without pages_read_user_content Meta hides who wrote it.
  author: c.from?.name ?? "Facebook user",
  authorUrl: c.from?.id ? `https://facebook.com/${c.from.id}` : undefined,
  text: c.message ?? "",
  at: iso(c.created_time),
  likes: num(c.like_count),
  replies: (c.comments?.data ?? []).map(fbComment),
});

async function facebookFetch(x: LiveContext): Promise<LiveResult> {
  const token = x.secret.accessToken!;
  const notes: string[] = [];
  // Reels are video objects, which have no shares field.
  const fields = ["reactions.summary(true).limit(0)", "comments.summary(true).limit(0)", ...(x.postType === "reel" ? [] : ["shares"])].join(",");
  let post;
  try {
    post = (await graph(x.platformPostId, token, { fields })) as { reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } };
  } catch (e) {
    if (e instanceof LiveError && e.opts.gone) return removed("Deleted from the Page.");
    throw e;
  }
  const metrics: LiveMetrics = {
    reactions: num(post.reactions?.summary?.total_count),
    comments: num(post.comments?.summary?.total_count),
    shares: num(post.shares?.count) ?? 0,
  };
  const list = (await soft(
    graph(`${x.platformPostId}/comments`, token, {
      fields: "id,message,from{name,id},created_time,like_count,comments.limit(20){id,message,from{name,id},created_time,like_count}",
      order: "reverse_chronological",
      limit: "50",
    }),
    notes,
    "Comments"
  )) as { data?: FbComment[] } | null;
  return done({ metrics, comments: (list?.data ?? []).map(fbComment), notes });
}

async function facebookReply(x: LiveContext, c: LiveComment, text: string) {
  const r = (await graph(`${c.id}/comments`, x.secret.accessToken!, { message: text }, "POST")) as { id?: string };
  return { id: String(r.id ?? "") };
}

/* ------------------------------------------------------------------ YouTube Data API v3 */

const YT = "https://www.googleapis.com/youtube/v3";

async function yt(path: string, token: string, json?: unknown) {
  const r = await call(`${YT}/${path}`, { headers: { authorization: `Bearer ${token}` }, json });
  if (!r.ok) {
    const err = (r.json.error ?? {}) as { message?: string; errors?: { reason?: string }[] };
    const reason = err.errors?.[0]?.reason;
    if (r.status === 401) throw new LiveError("Google sign-in expired. Reconnect this channel.", { auth: true, status: 401 });
    if (reason === "commentsDisabled") throw new LiveError("Comments are turned off for this video.", { status: r.status });
    if (reason === "insufficientPermissions" || r.status === 403) throw new LiveError(`Missing permission: ${err.message ?? reason ?? "reconnect this channel"}`, { status: r.status });
    throw new LiveError(err.message ?? `YouTube returned ${r.status}`, { status: r.status });
  }
  return r.json;
}

type YtSnippet = { authorDisplayName?: string; authorChannelUrl?: string; textOriginal?: string; textDisplay?: string; publishedAt?: string; likeCount?: number };
const ytComment = (id: string, s: YtSnippet = {}): LiveComment => ({
  id,
  author: s.authorDisplayName ?? "YouTube user",
  authorUrl: s.authorChannelUrl,
  text: s.textOriginal ?? s.textDisplay ?? "",
  at: iso(s.publishedAt),
  likes: num(s.likeCount),
});

async function youtubeFetch(x: LiveContext): Promise<LiveResult> {
  const token = x.secret.accessToken!;
  const notes: string[] = [];
  const v = (await yt(`videos?part=statistics,status&id=${encodeURIComponent(x.platformPostId)}`, token)) as {
    items?: { statistics?: Record<string, string>; status?: { uploadStatus?: string; privacyStatus?: string; rejectionReason?: string } }[];
  };
  const item = v.items?.[0];
  if (!item) return removed("YouTube no longer lists this video.");
  if (["deleted", "rejected", "failed"].includes(item.status?.uploadStatus ?? "")) return removed(`YouTube marked it ${item.status?.uploadStatus}${item.status?.rejectionReason ? ` (${item.status.rejectionReason})` : ""}.`);
  if (item.status?.privacyStatus && item.status.privacyStatus !== "public") notes.push(`Visibility: ${item.status.privacyStatus}.`);
  const s = item.statistics ?? {};
  const metrics: LiveMetrics = { views: Number(s.viewCount ?? 0), likes: s.likeCount != null ? Number(s.likeCount) : undefined, comments: s.commentCount != null ? Number(s.commentCount) : undefined };
  const threads = (await soft(yt(`commentThreads?part=snippet,replies&videoId=${encodeURIComponent(x.platformPostId)}&maxResults=50&order=time&textFormat=plainText`, token), notes, "Comments")) as {
    items?: { id: string; snippet?: { topLevelComment?: { snippet?: YtSnippet } }; replies?: { comments?: { id: string; snippet?: YtSnippet }[] } }[];
  } | null;
  const comments = (threads?.items ?? []).map((t) => ({
    // Thread id is the top-level comment id, which is what a reply's parentId must be.
    ...ytComment(t.id, t.snippet?.topLevelComment?.snippet),
    replies: (t.replies?.comments ?? []).map((r) => ytComment(r.id, r.snippet)),
  }));
  return done({ metrics, comments, notes });
}

async function youtubeReply(x: LiveContext, c: LiveComment, text: string) {
  const r = (await yt("comments?part=snippet", x.secret.accessToken!, { snippet: { parentId: c.id, textOriginal: text } })) as { id?: string };
  return { id: String(r.id ?? "") };
}

/* ------------------------------------------------------------------ Threads */

const THREADS = "https://graph.threads.net/v1.0";

async function th(path: string, token: string, params: Record<string, string> = {}, method = "GET") {
  const url = new URL(`${THREADS}/${path}`);
  for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, v);
  const r = await call(url.toString(), { method });
  if (!r.ok) {
    const err = (r.json.error ?? {}) as { code?: number; error_subcode?: number; message?: string };
    if (err.code === 190 || r.status === 401) throw new LiveError("The Threads token expired. Reconnect this channel.", { auth: true, status: r.status });
    if (err.code === 100 && err.error_subcode === 33) throw new LiveError("The post no longer exists.", { gone: true, status: r.status });
    if (err.code === 10 || err.code === 200) throw new LiveError(`Missing permission: ${err.message ?? "reconnect this channel"}`, { status: r.status });
    throw new LiveError(err.message ?? `Threads returned ${r.status}`, { status: r.status });
  }
  return r.json;
}

async function threadsFetch(x: LiveContext): Promise<LiveResult> {
  const token = x.secret.accessToken!;
  const notes: string[] = [];
  try {
    await th(x.platformPostId, token, { fields: "id,timestamp" });
  } catch (e) {
    if (e instanceof LiveError && e.opts.gone) return removed("Deleted on Threads.");
    throw e;
  }
  const metrics: LiveMetrics = {};
  const ins = (await soft(th(`${x.platformPostId}/insights`, token, { metric: "views,likes,replies,reposts,quotes,shares" }), notes, "Insights")) as {
    data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[];
  } | null;
  const val = (n: string) => {
    const m = ins?.data?.find((d) => d.name === n);
    return num(m?.total_value?.value) ?? num(m?.values?.[0]?.value);
  };
  if (ins) {
    metrics.views = val("views");
    metrics.likes = val("likes");
    metrics.comments = val("replies");
    metrics.shares = (val("reposts") ?? 0) + (val("quotes") ?? 0) + (val("shares") ?? 0);
  }
  const replies = (await soft(th(`${x.platformPostId}/replies`, token, { fields: "id,text,username,timestamp" }), notes, "Replies")) as {
    data?: { id: string; text?: string; username?: string; timestamp?: string }[];
  } | null;
  const comments = (replies?.data ?? []).map((r) => ({
    id: r.id,
    author: r.username ? `@${r.username}` : "Threads user",
    authorUrl: r.username ? `https://threads.net/@${r.username}` : undefined,
    text: r.text ?? "",
    at: iso(r.timestamp),
  }));
  return done({ metrics, comments, notes });
}

async function threadsReply(x: LiveContext, c: LiveComment, text: string) {
  const token = x.secret.accessToken!;
  const user = x.account.externalId;
  const container = (await th(`${user}/threads`, token, { media_type: "TEXT", text, reply_to_id: c.id }, "POST")) as { id?: string };
  const pub = (await th(`${user}/threads_publish`, token, { creation_id: String(container.id) }, "POST")) as { id?: string };
  return { id: String(pub.id ?? "") };
}

/* ------------------------------------------------------------------ Reddit */

async function reddit(path: string, token: string, form?: Record<string, string>) {
  const r = await call(`https://oauth.reddit.com${path}`, {
    method: form ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "user-agent": REDDIT_UA, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams({ api_type: "json", ...form }) : undefined,
  });
  if (!r.ok) {
    if (r.status === 401) throw new LiveError("Reddit sign-in expired. Reconnect the account.", { auth: true, status: 401 });
    throw new LiveError(r.status === 429 ? "Reddit is rate limiting; try again in a minute." : `Reddit returned ${r.status}`, { status: r.status });
  }
  return r.json as unknown;
}

type RedditThing = { kind: string; data: { id: string; name: string; author?: string; body?: string; created_utc?: number; score?: number; replies?: { data?: { children?: RedditThing[] } } | "" } };
const redditComment = (t: RedditThing): LiveComment => ({
  id: t.data.name,
  author: `u/${t.data.author ?? "[deleted]"}`,
  authorUrl: t.data.author && t.data.author !== "[deleted]" ? `https://www.reddit.com/user/${t.data.author}` : undefined,
  text: t.data.body ?? "",
  at: iso(t.data.created_utc),
  likes: num(t.data.score),
  replies: (t.data.replies && typeof t.data.replies === "object" ? (t.data.replies.data?.children ?? []) : []).filter((c) => c.kind === "t1").map(redditComment),
});

async function redditFetch(x: LiveContext): Promise<LiveResult> {
  const token = x.secret.accessToken!;
  const notes: string[] = [];
  const fullname = x.platformPostId.startsWith("t3_") ? x.platformPostId : `t3_${x.platformPostId}`;
  const info = (await reddit(`/api/info?id=${fullname}&raw_json=1`, token)) as { data?: { children?: { data: Record<string, unknown> }[] } };
  const d = info.data?.children?.[0]?.data;
  if (!d) return removed("Reddit no longer lists this post.");
  if (d.removed_by_category) return removed(`Removed on Reddit (${String(d.removed_by_category).replace(/_/g, " ")}).`);
  if (d.author === "[deleted]") return removed("Deleted on Reddit.");
  const metrics: LiveMetrics = { likes: num(d.score), comments: num(d.num_comments), views: num(d.view_count) };
  const listing = (await soft(reddit(`/comments/${fullname.slice(3)}?limit=50&depth=2&sort=new&raw_json=1`, token), notes, "Comments")) as { data?: { children?: RedditThing[] } }[] | null;
  const comments = (listing?.[1]?.data?.children ?? []).filter((c) => c.kind === "t1").map(redditComment);
  return done({ metrics, comments, notes });
}

async function redditReply(x: LiveContext, c: LiveComment, text: string) {
  const r = (await reddit("/api/comment", x.secret.accessToken!, { thing_id: c.id, text })) as { json?: { errors?: string[][]; data?: { things?: { data?: { name?: string } }[] } } };
  const err = r.json?.errors?.[0];
  if (err) throw new LiveError(err[1] ?? err[0] ?? "Reddit rejected the reply.");
  return { id: String(r.json?.data?.things?.[0]?.data?.name ?? "") };
}

/* ------------------------------------------------------------------ Bluesky */

// Public AppView: thread reads need no session.
const BSKY_APPVIEW = "https://public.api.bsky.app";

type BskyThread = {
  $type?: string;
  post?: { uri: string; cid: string; author?: { handle?: string; displayName?: string }; record?: { text?: string; createdAt?: string }; likeCount?: number; replyCount?: number; repostCount?: number; quoteCount?: number; indexedAt?: string };
  replies?: BskyThread[];
};

async function blueskyFetch(x: LiveContext): Promise<LiveResult> {
  const r = await call(`${BSKY_APPVIEW}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(x.platformPostId)}&depth=2&parentHeight=0`);
  if (!r.ok) {
    if (r.json.error === "NotFound") return removed("Deleted on Bluesky.");
    throw new LiveError(String(r.json.message ?? `Bluesky returned ${r.status}`), { status: r.status });
  }
  const thread = r.json.thread as BskyThread | undefined;
  if (!thread || thread.$type === "app.bsky.feed.defs#notFoundPost") return removed("Deleted on Bluesky.");
  if (!thread.post) return { metrics: {}, comments: [], status: "unknown", note: "Bluesky is hiding this post (blocked or restricted)." };
  const root = thread.post;
  const toComment = (t: BskyThread): LiveComment | null =>
    t.post
      ? {
          id: t.post.uri,
          author: t.post.author?.handle ? `@${t.post.author.handle}` : "Bluesky user",
          authorUrl: t.post.author?.handle ? `https://bsky.app/profile/${t.post.author.handle}` : undefined,
          text: t.post.record?.text ?? "",
          at: iso(t.post.record?.createdAt ?? t.post.indexedAt),
          likes: num(t.post.likeCount),
          replies: (t.replies ?? []).map(toComment).filter((c): c is LiveComment => !!c),
          ref: { cid: t.post.cid, rootUri: root.uri, rootCid: root.cid },
        }
      : null;
  return done({
    metrics: { likes: num(root.likeCount), comments: num(root.replyCount), shares: (root.repostCount ?? 0) + (root.quoteCount ?? 0) },
    comments: (thread.replies ?? []).map(toComment).filter((c): c is LiveComment => !!c),
  });
}

async function blueskyReply(x: LiveContext, c: LiveComment, text: string) {
  if (!c.ref?.cid || !c.ref.rootUri || !c.ref.rootCid) throw new LiveError("Refresh first; this reply is missing Bluesky's thread reference.");
  const service = String(x.account.connector.instanceUrl || "https://bsky.social").replace(/\/$/, "");
  let s;
  try {
    s = await bskySession(service, x.secret.identifier ?? x.account.handle, x.secret.appPassword!);
  } catch (e) {
    throw new LiveError((e as Error).message, { auth: true });
  }
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    reply: { root: { uri: c.ref.rootUri, cid: c.ref.rootCid }, parent: { uri: c.id, cid: c.ref.cid } },
  };
  const facets = bskyFacets(text);
  if (facets.length) record.facets = facets;
  const r = await call(`${service}/xrpc/com.atproto.repo.createRecord`, { headers: { authorization: `Bearer ${s.accessJwt}` }, json: { repo: s.did, collection: "app.bsky.feed.post", record } });
  if (!r.ok) throw new LiveError(String(r.json.message ?? `Bluesky returned ${r.status}`), { status: r.status });
  return { id: String(r.json.uri ?? "") };
}

/* ------------------------------------------------------------------ Mastodon */

async function mastoBase(x: LiveContext) {
  // The instance URL is user input: re-check it each time, it could have been re-pointed.
  try {
    return (await assertSafeWebhookUrl(String(x.account.connector.instanceUrl ?? ""))).origin;
  } catch (e) {
    throw new LiveError(`Server address rejected: ${(e as Error).message}`);
  }
}

async function masto(base: string, path: string, token: string, json?: unknown) {
  let r = await call(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, json });
  // Tokens made for posting often lack read:statuses; public statuses read fine without one.
  if (!json && r.status === 403) r = await call(`${base}${path}`);
  if (!r.ok) {
    if (r.status === 401) throw new LiveError("Mastodon rejected the access token. Reconnect this account.", { auth: true, status: 401 });
    if (r.status === 404) throw new LiveError("Not found.", { gone: true, status: 404 });
    throw new LiveError(String(r.json.error ?? `Mastodon returned ${r.status}`), { status: r.status });
  }
  return r.json;
}

type MastoStatus = { id: string; in_reply_to_id?: string | null; content?: string; created_at?: string; favourites_count?: number; account?: { acct?: string; url?: string } };
const stripHtml = (h: string) =>
  h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

async function mastodonFetch(x: LiveContext): Promise<LiveResult> {
  const base = await mastoBase(x);
  const token = x.secret.accessToken!;
  const notes: string[] = [];
  let st;
  try {
    st = (await masto(base, `/api/v1/statuses/${encodeURIComponent(x.platformPostId)}`, token)) as { favourites_count?: number; replies_count?: number; reblogs_count?: number };
  } catch (e) {
    if (e instanceof LiveError && e.opts.gone) return removed("Deleted on Mastodon.");
    throw e;
  }
  const ctx = (await soft(masto(base, `/api/v1/statuses/${encodeURIComponent(x.platformPostId)}/context`, token), notes, "Replies")) as { descendants?: MastoStatus[] } | null;
  const toComment = (s: MastoStatus): LiveComment => ({
    id: s.id,
    author: s.account?.acct ? `@${s.account.acct}` : "Mastodon user",
    authorUrl: s.account?.url,
    text: stripHtml(s.content ?? ""),
    at: iso(s.created_at),
    likes: num(s.favourites_count),
    replies: [],
    ref: { acct: s.account?.acct ?? "" },
  });
  // Descendants come flat; hang each under its top-level reply so the inbox stays two levels deep.
  const all = ctx?.descendants ?? [];
  const byId = new Map(all.map((s) => [s.id, s]));
  const top = new Map<string, LiveComment>();
  for (const s of all) if (s.in_reply_to_id === x.platformPostId) top.set(s.id, toComment(s));
  for (const s of all) {
    if (top.has(s.id)) continue;
    let p = s.in_reply_to_id ? byId.get(s.in_reply_to_id) : undefined;
    while (p && p.in_reply_to_id !== x.platformPostId) p = p.in_reply_to_id ? byId.get(p.in_reply_to_id) : undefined;
    if (p) top.get(p.id)?.replies!.push(toComment(s));
  }
  return done({ metrics: { likes: num(st.favourites_count), comments: num(st.replies_count), shares: num(st.reblogs_count) }, comments: [...top.values()], notes });
}

async function mastodonReply(x: LiveContext, c: LiveComment, text: string) {
  const base = await mastoBase(x);
  // Mastodon only notifies people who are mentioned, so address the reply to them.
  const acct = c.ref?.acct;
  const status = acct && !text.includes(`@${acct}`) ? `@${acct} ${text}` : text;
  const r = (await masto(base, "/api/v1/statuses", x.secret.accessToken!, { status, in_reply_to_id: c.id })) as { id?: string };
  return { id: String(r.id ?? "") };
}

/* ------------------------------------------------------------------ X */

async function xFetch(x: LiveContext): Promise<LiveResult> {
  const r = await call(`https://api.twitter.com/2/tweets/${encodeURIComponent(x.platformPostId)}?tweet.fields=public_metrics`, { headers: { authorization: `Bearer ${x.secret.accessToken}` } });
  if (r.status === 401) throw new LiveError("X sign-in expired. Reconnect this account.", { auth: true, status: 401 });
  if (r.status === 429) throw new LiveError("X is rate limiting this app; try again later.", { status: 429 });
  const errors = r.json.errors as { title?: string; detail?: string }[] | undefined;
  if (!r.json.data && errors?.some((e) => e.title === "Not Found Error")) return removed("Deleted on X.");
  if (!r.ok || !r.json.data) throw new LiveError(errors?.[0]?.detail ?? String(r.json.detail ?? `X returned ${r.status}`), { status: r.status });
  const m = ((r.json.data as { public_metrics?: Record<string, number> }).public_metrics ?? {}) as Record<string, number>;
  return done({ metrics: { views: num(m.impression_count), likes: num(m.like_count), comments: num(m.reply_count), shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0) } });
}

/* ------------------------------------------------------------------ TikTok */

async function tiktokFetch(x: LiveContext): Promise<LiveResult> {
  const r = await call("https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count", {
    headers: { authorization: `Bearer ${x.secret.accessToken}` },
    json: { filters: { video_ids: [x.platformPostId] } },
  });
  const err = (r.json.error ?? {}) as { code?: string; message?: string };
  if (r.status === 401 || err.code === "access_token_invalid") throw new LiveError("TikTok sign-in expired. Reconnect this account.", { auth: true, status: r.status });
  if (err.code === "scope_not_authorized") throw new LiveError("Reconnect TikTok and allow video.list so Relay can read counts.", { status: r.status });
  if (!r.ok || (err.code && err.code !== "ok")) throw new LiveError(err.message || `TikTok returned ${r.status}`, { status: r.status });
  const v = ((r.json.data as { videos?: Record<string, number>[] } | undefined)?.videos ?? [])[0];
  // Private posts, drafts and still-processing uploads aren't returned, so absence isn't proof of deletion.
  if (!v) return { metrics: {}, comments: [], status: "unknown", note: "TikTok didn't return this video. Private posts and drafts aren't listed." };
  return done({ metrics: { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) } });
}

/* ------------------------------------------------------------------ Slack */

async function slackGet(token: string, method: string, params: Record<string, string>) {
  const r = await call(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.json.ok) {
    const err = String(r.json.error ?? `HTTP ${r.status}`);
    if (["not_authed", "invalid_auth", "token_revoked", "account_inactive", "token_expired"].includes(err)) throw new LiveError(`Slack: ${err}. Reconnect with a fresh bot token.`, { auth: true, status: 401 });
    if (err === "thread_not_found" || err === "message_not_found") throw new LiveError("Deleted in Slack.", { gone: true });
    if (err === "missing_scope") throw new LiveError("The Slack app needs the channels:history scope to read replies.");
    throw new LiveError(`Slack: ${err}`);
  }
  return r.json;
}

type SlackMsg = { ts: string; user?: string; text?: string; reply_count?: number; reactions?: { name: string; count: number }[]; bot_profile?: { name?: string }; user_profile?: { display_name?: string; real_name?: string } };

async function slackFetch(x: LiveContext): Promise<LiveResult> {
  if (x.postType !== "message") return { metrics: {}, comments: [], status: "live", note: "Slack messages with files are tracked by file, so replies aren't read back." };
  const token = x.secret.botToken!;
  const channel = x.messageIds[0] || String(x.account.connector.channelId ?? x.account.externalId);
  let res;
  try {
    res = (await slackGet(token, "conversations.replies", { channel, ts: x.platformPostId, limit: "50" })) as { messages?: SlackMsg[] };
  } catch (e) {
    if (e instanceof LiveError && e.opts.gone) return removed("Deleted in Slack.");
    throw e;
  }
  const [parent, ...rest] = res.messages ?? [];
  if (!parent) return removed("Deleted in Slack.");
  // Replies carry a user id only; look up a handful of names (needs users:read, optional).
  const names = new Map<string, string>();
  for (const id of [...new Set(rest.map((m) => m.user).filter((u): u is string => !!u))].slice(0, 10)) {
    const u = (await slackGet(token, "users.info", { user: id }).catch(() => null)) as { user?: { profile?: { display_name?: string; real_name?: string } } } | null;
    const n = u?.user?.profile?.display_name || u?.user?.profile?.real_name;
    if (n) names.set(id, n);
  }
  const comments = rest.map((m) => ({
    id: m.ts,
    author: m.user_profile?.display_name || m.user_profile?.real_name || (m.user && names.get(m.user)) || m.bot_profile?.name || m.user || "Slack user",
    text: m.text ?? "",
    at: iso(Number(m.ts)),
    likes: m.reactions?.reduce((n, r) => n + r.count, 0),
  }));
  return done({ metrics: { reactions: (parent.reactions ?? []).reduce((n, r) => n + r.count, 0), comments: parent.reply_count ?? rest.length }, comments });
}

async function slackReply(x: LiveContext, _c: LiveComment, text: string) {
  // Slack threads are flat: a reply to any message in the thread goes to the thread.
  const r = await call("https://slack.com/api/chat.postMessage", {
    headers: { authorization: `Bearer ${x.secret.botToken}` },
    json: { channel: x.messageIds[0] || x.account.connector.channelId, thread_ts: x.platformPostId, text },
  });
  if (!r.json.ok) throw new LiveError(`Slack: ${String(r.json.error ?? r.status)}`, { auth: ["invalid_auth", "token_revoked"].includes(String(r.json.error)) });
  return { id: String(r.json.ts ?? "") };
}

/* ------------------------------------------------------------------ Discord */

const DISCORD_HOOK = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/;

async function discordFetch(x: LiveContext): Promise<LiveResult> {
  const hook = String(x.secret.webhookUrl ?? "").replace(/\/$/, "");
  if (!DISCORD_HOOK.test(hook)) throw new LiveError("This channel's webhook URL is missing. Reconnect it.", { auth: true });
  const thread = x.messageIds[0] && x.messageIds[0] !== x.account.connector.channelId ? `?thread_id=${x.messageIds[0]}` : "";
  const r = await call(`${hook}/messages/${encodeURIComponent(x.platformPostId)}${thread}`);
  if (!r.ok) {
    // 10008 Unknown Message: deleted. 10015 Unknown Webhook: the webhook itself is gone.
    if (r.json.code === 10008) return removed("Deleted in Discord.");
    if (r.json.code === 10015 || r.status === 401) throw new LiveError("The Discord webhook was deleted. Reconnect the channel.", { auth: true, status: r.status });
    throw new LiveError(String(r.json.message ?? `Discord returned ${r.status}`), { status: r.status });
  }
  const reactions = (r.json.reactions as { count?: number }[] | undefined) ?? [];
  return done({ metrics: { reactions: reactions.reduce((n, e) => n + (e.count ?? 0), 0) } });
}

/* ------------------------------------------------------------------ dispatch */

const FETCHERS: Record<string, (x: LiveContext) => Promise<LiveResult>> = {
  instagram: instagramFetch,
  facebook: facebookFetch,
  youtube: youtubeFetch,
  threads: threadsFetch,
  reddit: redditFetch,
  bluesky: blueskyFetch,
  mastodon: mastodonFetch,
  x: xFetch,
  tiktok: tiktokFetch,
  slack: slackFetch,
  discord: discordFetch,
};

const REPLIERS: Record<string, (x: LiveContext, c: LiveComment, text: string) => Promise<{ id: string }>> = {
  instagram: instagramReply,
  facebook: facebookReply,
  youtube: youtubeReply,
  threads: threadsReply,
  reddit: redditReply,
  bluesky: blueskyReply,
  mastodon: mastodonReply,
  slack: slackReply,
};

/** True when there's an API to ask at all; the rest are answered from Relay's own records. */
export const hasLiveApi = (platform: string) => platform in FETCHERS;

export async function fetchLive(x: LiveContext): Promise<LiveResult> {
  const f = FETCHERS[x.platform];
  if (!f) return { metrics: {}, comments: [], status: "live", note: liveCaps(x.platform).note };
  return f(x);
}

export async function replyLive(x: LiveContext, comment: LiveComment, text: string) {
  const r = REPLIERS[x.platform];
  if (!r || !liveCaps(x.platform).reply) throw new LiveError("This platform doesn't let apps reply to comments.");
  return r(x, comment, text);
}
