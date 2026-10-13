import "server-only";
import { PERIOD_DAYS, type ContentType, type DiscoverItem, type DiscoverQuery, type MediaVariant } from "./types";

/**
 * One search function per platform, each using that platform's public or official API and
 * returning the numbers it publishes. Nothing here reads a personalised feed: YouTube is
 * searched by view count, Reddit and Bluesky by top posts, Instagram by a hashtag's top
 * media, Mastodon by a hashtag's public timeline and X by recent search.
 */

export class DiscoverError extends Error {}

export type ProviderCtx = { instagram?: { userId: string; accessToken: string } | null };

const T = 15_000;
const UA = "Relay/1.0 (content research; +https://github.com/)";

async function getJson<J>(url: string, init: RequestInit = {}, label: string): Promise<J> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(T), cache: "no-store" });
  } catch (e) {
    throw new DiscoverError(`${label} didn't answer (${(e as Error).message}).`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const j = json as { error?: { message?: string } | string; message?: string; detail?: string; title?: string } | null;
    const msg = (typeof j?.error === "object" ? j.error?.message : typeof j?.error === "string" ? j.error : null) ?? j?.message ?? j?.detail ?? j?.title ?? text.slice(0, 120);
    throw new DiscoverError(`${label} returned ${res.status}: ${msg}`);
  }
  return json as J;
}

const sinceDate = (q: DiscoverQuery) => {
  const d = PERIOD_DAYS[q.period];
  return d ? new Date(Date.now() - d * 86400_000) : null;
};
const words = (q: string) => q.trim().replace(/#/g, "").split(/\s+/).filter(Boolean);
const hashtagsIn = (text: string) => [...text.matchAll(/#([\p{L}\p{N}_]{2,60})/gu)].map((m) => m[1]!.toLowerCase());
const stripHtml = (h: string) =>
  h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));

/* ---------- YouTube Data API v3 ---------- */

function isoSeconds(d?: string) {
  const m = d?.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return undefined;
  return (Number(m[1] ?? 0) * 86400) + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

type YtThumb = { url: string; width?: number; height?: number };
type YtVideo = {
  id: string;
  snippet: { title: string; description: string; channelTitle: string; channelId: string; publishedAt: string; tags?: string[]; thumbnails: Record<string, YtThumb> };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

export async function searchYouTube(q: DiscoverQuery): Promise<DiscoverItem[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new DiscoverError("Add YOUTUBE_API_KEY on the server to search YouTube.");
  const since = sinceDate(q);
  const params = new URLSearchParams({ part: "snippet", type: "video", q: q.q, maxResults: "50", order: q.sort === "recent" ? "date" : q.sort === "views" ? "viewCount" : "relevance", key });
  if (since) params.set("publishedAfter", since.toISOString());
  if (q.region) params.set("regionCode", q.region.toUpperCase());
  if (q.language) params.set("relevanceLanguage", q.language);
  // Shorts are under three minutes; "short" alone narrows the search to under four.
  if (q.types.length === 1 && q.types[0] === "short") params.set("videoDuration", "short");
  const search = await getJson<{ items?: { id: { videoId?: string } }[] }>(`https://www.googleapis.com/youtube/v3/search?${params}`, {}, "YouTube");
  const ids = (search.items ?? []).map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const vids = await getJson<{ items?: YtVideo[] }>(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}&key=${key}`, {}, "YouTube");
  return (vids.items ?? []).map((v) => {
    const dur = isoSeconds(v.contentDetails?.duration);
    const th = v.snippet.thumbnails;
    const sizes: [string, string][] = [
      ["maxres", "Thumbnail · HD"],
      ["standard", "Thumbnail · 640"],
      ["high", "Thumbnail · 480"],
      ["medium", "Thumbnail · 320"],
    ];
    const type: ContentType = dur !== undefined && dur <= 180 ? "short" : "video";
    return {
      id: `youtube:${v.id}`,
      source: "youtube",
      type,
      title: v.snippet.title,
      text: v.snippet.description,
      author: v.snippet.channelTitle,
      authorUrl: `https://www.youtube.com/channel/${v.snippet.channelId}`,
      url: type === "short" ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
      thumbnail: (th.high ?? th.medium ?? th.default)?.url,
      publishedAt: v.snippet.publishedAt,
      durationSec: dur,
      views: num(v.statistics?.viewCount),
      likes: num(v.statistics?.likeCount),
      comments: num(v.statistics?.commentCount),
      tags: [...(v.snippet.tags ?? []).map((t) => t.toLowerCase()), ...hashtagsIn(`${v.snippet.title} ${v.snippet.description}`)],
      media: sizes.filter(([k]) => th[k]).map(([k, label]) => ({ label: `${label} (${th[k]!.width}×${th[k]!.height})`, url: th[k]!.url, width: th[k]!.width, height: th[k]!.height, kind: "image" as const })),
    } satisfies DiscoverItem;
  });
}

/* ---------- Instagram Graph API: hashtag top media ---------- */

type IgMedia = { id: string; caption?: string; media_type: string; media_product_type?: string; comments_count?: number; like_count?: number; permalink: string; timestamp: string; media_url?: string; children?: { data: { media_url?: string }[] } };

export async function searchInstagram(q: DiscoverQuery, ctx: ProviderCtx): Promise<DiscoverItem[]> {
  const ig = ctx.instagram;
  if (!ig) throw new DiscoverError("Connect an Instagram business or creator account to search Instagram hashtags.");
  const tag = words(q.q)[0]?.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
  if (!tag) return [];
  const g = "https://graph.facebook.com/v21.0";
  const found = await getJson<{ data?: { id: string }[] }>(`${g}/ig_hashtag_search?user_id=${ig.userId}&q=${encodeURIComponent(tag)}&access_token=${ig.accessToken}`, {}, "Instagram");
  const hid = found.data?.[0]?.id;
  if (!hid) return [];
  const fields = "id,caption,media_type,media_product_type,comments_count,like_count,permalink,timestamp,media_url,children{media_url}";
  const top = await getJson<{ data?: IgMedia[] }>(`${g}/${hid}/top_media?user_id=${ig.userId}&fields=${fields}&limit=50&access_token=${ig.accessToken}`, {}, "Instagram");
  return (top.data ?? []).map((m) => {
    const caption = m.caption ?? "";
    const reel = m.media_product_type === "REELS" || m.media_type === "VIDEO";
    const image = m.media_type === "IMAGE" ? m.media_url : m.children?.data?.[0]?.media_url;
    return {
      id: `instagram:${m.id}`,
      source: "instagram",
      type: reel ? "short" : "post",
      title: caption.split("\n")[0]!.slice(0, 120) || `#${tag}`,
      text: caption,
      author: "Instagram",
      url: m.permalink,
      thumbnail: image,
      publishedAt: m.timestamp,
      likes: m.like_count,
      comments: m.comments_count,
      tags: hashtagsIn(caption),
      media: image ? [{ label: "Preview image", url: image, kind: "image" as const }] : [],
    } satisfies DiscoverItem;
  });
}

/* ---------- Reddit ---------- */

type RedditPost = {
  id: string;
  title: string;
  selftext?: string;
  author: string;
  subreddit_name_prefixed: string;
  score: number;
  num_comments: number;
  view_count?: number | null;
  created_utc: number;
  permalink: string;
  url?: string;
  is_video?: boolean;
  post_hint?: string;
  over_18?: boolean;
  thumbnail?: string;
  media?: { reddit_video?: { fallback_url: string; height: number; width: number; duration: number } } | null;
  preview?: { images?: { source: { url: string; width: number; height: number }; resolutions: { url: string; width: number; height: number }[] }[] };
};

let redditToken: { token: string; until: number } | null = null;
async function redditAuth() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.until > Date.now()) return redditToken.token;
  const j = await getJson<{ access_token: string; expires_in: number }>(
    "https://www.reddit.com/api/v1/access_token",
    { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": UA }, body: "grant_type=client_credentials" },
    "Reddit"
  );
  redditToken = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return redditToken.token;
}

export async function searchReddit(q: DiscoverQuery): Promise<DiscoverItem[]> {
  const t = { day: "day", week: "week", month: "month", year: "year", any: "all" }[q.period];
  const sort = q.sort === "recent" ? "new" : q.sort === "comments" ? "comments" : "top";
  const token = await redditAuth().catch(() => null);
  const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const j = await getJson<{ data?: { children?: { data: RedditPost }[] } }>(
    `${base}/search${token ? "" : ".json"}?q=${encodeURIComponent(q.q)}&sort=${sort}&t=${t}&limit=50&raw_json=1&type=link`,
    { headers: { "user-agent": UA, ...(token ? { authorization: `Bearer ${token}` } : {}) } },
    "Reddit"
  );
  return (j.data?.children ?? [])
    .map((c) => c.data)
    .filter((p) => !p.over_18)
    .map((p) => {
      const media: MediaVariant[] = [];
      const v = p.media?.reddit_video;
      if (v) {
        // Reddit serves the same clip at several heights; sound is a separate track.
        for (const h of [1080, 720, 480, 360, 240]) {
          if (h > v.height) continue;
          media.push({ label: `${h}p video`, url: v.fallback_url.replace(/DASH_\d+\.mp4/, `DASH_${h}.mp4`), height: h, kind: "video" });
        }
        if (!media.length) media.push({ label: `${v.height}p video`, url: v.fallback_url, height: v.height, kind: "video" });
      }
      const img = p.preview?.images?.[0];
      if (img) {
        media.push({ label: `Image · original (${img.source.width}×${img.source.height})`, url: img.source.url, width: img.source.width, height: img.source.height, kind: "image" });
        const mid = img.resolutions.filter((r) => r.width >= 600).at(0);
        if (mid) media.push({ label: `Image · ${mid.width}×${mid.height}`, url: mid.url, width: mid.width, height: mid.height, kind: "image" });
      }
      return {
        id: `reddit:${p.id}`,
        source: "reddit",
        type: p.is_video ? "video" : "post",
        title: p.title,
        text: p.selftext ?? "",
        author: `${p.subreddit_name_prefixed} · u/${p.author}`,
        authorUrl: `https://www.reddit.com/${p.subreddit_name_prefixed}`,
        url: `https://www.reddit.com${p.permalink}`,
        thumbnail: img?.resolutions.find((r) => r.width >= 320)?.url ?? img?.source.url,
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        durationSec: v?.duration,
        views: p.view_count ?? undefined,
        likes: p.score,
        comments: p.num_comments,
        tags: hashtagsIn(`${p.title} ${p.selftext ?? ""}`),
        media,
      } satisfies DiscoverItem;
    });
}

/* ---------- Bluesky (public AppView) ---------- */

type BskyPost = {
  uri: string;
  author: { handle: string; displayName?: string };
  record: { text?: string; createdAt?: string; facets?: { features?: { $type: string; tag?: string }[] }[] };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  embed?: { $type: string; images?: { thumb: string; fullsize: string; aspectRatio?: { width: number; height: number } }[]; thumbnail?: string; media?: { $type: string; images?: { thumb: string; fullsize: string }[]; thumbnail?: string } };
};

export async function searchBluesky(q: DiscoverQuery): Promise<DiscoverItem[]> {
  const since = sinceDate(q);
  const params = new URLSearchParams({ q: q.q, sort: q.sort === "recent" ? "latest" : "top", limit: "100" });
  if (since) params.set("since", since.toISOString());
  if (q.language) params.set("lang", q.language);
  const j = await getJson<{ posts?: BskyPost[] }>(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params}`, { headers: { "user-agent": UA } }, "Bluesky");
  return (j.posts ?? []).map((p) => {
    const text = p.record.text ?? "";
    const rkey = p.uri.split("/").pop();
    const emb = p.embed?.images ? p.embed : p.embed?.media;
    const images = emb?.images ?? [];
    const media: MediaVariant[] = images.flatMap((im, i) => [
      { label: `Image ${images.length > 1 ? i + 1 + " " : ""}· full size`, url: im.fullsize, kind: "image" as const },
      { label: `Image ${images.length > 1 ? i + 1 + " " : ""}· small`, url: im.thumb, kind: "image" as const },
    ]);
    const videoThumb = p.embed?.thumbnail ?? p.embed?.media?.thumbnail;
    if (videoThumb) media.push({ label: "Video cover", url: videoThumb, kind: "image" });
    const tags = (p.record.facets ?? []).flatMap((f) => f.features ?? []).filter((f) => f.$type === "app.bsky.richtext.facet#tag" && f.tag).map((f) => f.tag!.toLowerCase());
    return {
      id: `bluesky:${rkey}`,
      source: "bluesky",
      type: "post",
      title: text.split("\n")[0]!.slice(0, 120),
      text,
      author: `@${p.author.handle}`,
      authorUrl: `https://bsky.app/profile/${p.author.handle}`,
      url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
      thumbnail: images[0]?.thumb ?? videoThumb,
      publishedAt: p.record.createdAt ?? new Date().toISOString(),
      likes: p.likeCount,
      comments: p.replyCount,
      shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0),
      tags: [...new Set([...tags, ...hashtagsIn(text)])],
      media,
    } satisfies DiscoverItem;
  });
}

/* ---------- Mastodon (public hashtag timeline) ---------- */

type MastoStatus = {
  id: string;
  url?: string;
  uri: string;
  content: string;
  created_at: string;
  account: { acct: string; url: string };
  favourites_count: number;
  reblogs_count: number;
  replies_count: number;
  sensitive?: boolean;
  tags?: { name: string }[];
  media_attachments?: { type: string; url: string; preview_url?: string; meta?: { original?: { width?: number; height?: number; duration?: number } } }[];
};

export async function searchMastodon(q: DiscoverQuery): Promise<DiscoverItem[]> {
  const instance = (process.env.MASTODON_DISCOVER_INSTANCE || "mastodon.social").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const tag = words(q.q)[0]?.replace(/[^\p{L}\p{N}_]/gu, "");
  if (!tag) return [];
  const since = sinceDate(q);
  const out: MastoStatus[] = [];
  let maxId: string | undefined;
  // Two pages of the public timeline for the tag, newest first.
  for (let page = 0; page < 2; page++) {
    const j = await getJson<MastoStatus[]>(`https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40${maxId ? `&max_id=${maxId}` : ""}`, { headers: { "user-agent": UA } }, "Mastodon");
    out.push(...j);
    if (j.length < 40 || (since && new Date(j.at(-1)!.created_at) < since)) break;
    maxId = j.at(-1)!.id;
  }
  return out
    .filter((s) => !s.sensitive)
    .map((s) => {
      const text = stripHtml(s.content);
      const att = s.media_attachments ?? [];
      const media: MediaVariant[] = att.flatMap((a) => {
        const kind = a.type === "image" ? "image" : a.type === "video" || a.type === "gifv" ? "video" : null;
        if (!kind) return [];
        const o = a.meta?.original;
        const list: MediaVariant[] = [{ label: `${kind === "video" ? "Video" : "Image"} · original${o?.width ? ` (${o.width}×${o.height})` : ""}`, url: a.url, width: o?.width, height: o?.height, kind }];
        if (a.preview_url) list.push({ label: `${kind === "video" ? "Video cover" : "Image · preview"}`, url: a.preview_url, kind: "image" });
        return list;
      });
      return {
        id: `mastodon:${s.id}`,
        source: "mastodon",
        type: att.some((a) => a.type === "video") ? "video" : "post",
        title: text.split("\n")[0]!.slice(0, 120),
        text,
        author: `@${s.account.acct}`,
        authorUrl: s.account.url,
        url: s.url ?? s.uri,
        thumbnail: att[0]?.preview_url,
        publishedAt: s.created_at,
        likes: s.favourites_count,
        comments: s.replies_count,
        shares: s.reblogs_count,
        tags: [...new Set([...(s.tags ?? []).map((t) => t.name.toLowerCase()), ...hashtagsIn(text)])],
        media,
      } satisfies DiscoverItem;
    });
}

/* ---------- X recent search (API v2) ---------- */

type XTweet = { id: string; text: string; created_at: string; author_id: string; lang?: string; public_metrics: { like_count: number; reply_count: number; retweet_count: number; quote_count: number; impression_count?: number }; entities?: { hashtags?: { tag: string }[] }; attachments?: { media_keys?: string[] } };

export async function searchX(q: DiscoverQuery): Promise<DiscoverItem[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new DiscoverError("Add X_BEARER_TOKEN (X API Basic or above) to search X.");
  const query = `${q.q} -is:retweet -is:reply${q.language ? ` lang:${q.language}` : ""}`;
  const params = new URLSearchParams({
    query,
    max_results: "100",
    sort_order: q.sort === "recent" ? "recency" : "relevancy",
    "tweet.fields": "public_metrics,created_at,entities,lang",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "username",
    "media.fields": "url,preview_image_url,type,width,height",
  });
  // Recent search covers the last seven days.
  const since = sinceDate(q);
  if (since && Date.now() - since.getTime() < 7 * 86400_000) params.set("start_time", since.toISOString());
  const j = await getJson<{ data?: XTweet[]; includes?: { users?: { id: string; username: string }[]; media?: { media_key: string; type: string; url?: string; preview_image_url?: string; width?: number; height?: number }[] } }>(
    `https://api.twitter.com/2/tweets/search/recent?${params}`,
    { headers: { authorization: `Bearer ${token}` } },
    "X"
  );
  const users = new Map((j.includes?.users ?? []).map((u) => [u.id, u.username]));
  const media = new Map((j.includes?.media ?? []).map((m) => [m.media_key, m]));
  return (j.data ?? []).map((t) => {
    const user = users.get(t.author_id) ?? "i";
    const m = (t.attachments?.media_keys ?? []).map((k) => media.get(k)).filter(Boolean);
    const img = m[0]?.url ?? m[0]?.preview_image_url;
    return {
      id: `x:${t.id}`,
      source: "x",
      type: m.some((x) => x!.type === "video") ? "video" : "post",
      title: t.text.split("\n")[0]!.slice(0, 120),
      text: t.text,
      author: `@${user}`,
      authorUrl: `https://x.com/${user}`,
      url: `https://x.com/${user}/status/${t.id}`,
      thumbnail: img,
      publishedAt: t.created_at,
      views: t.public_metrics.impression_count,
      likes: t.public_metrics.like_count,
      comments: t.public_metrics.reply_count,
      shares: t.public_metrics.retweet_count + t.public_metrics.quote_count,
      tags: (t.entities?.hashtags ?? []).map((h) => h.tag.toLowerCase()),
      media: img ? [{ label: "Preview image", url: img, kind: "image" as const }] : [],
    } satisfies DiscoverItem;
  });
}
