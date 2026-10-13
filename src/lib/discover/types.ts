/**
 * Discover: platform-wide search for content that is performing well, with the numbers
 * each platform publishes. Safe to import from client components.
 */

export const DISCOVER_SOURCES = ["youtube", "instagram", "reddit", "bluesky", "mastodon", "x"] as const;
export type DiscoverSource = (typeof DISCOVER_SOURCES)[number];

export const SOURCE_INFO: Record<DiscoverSource, { name: string; needs: string; types: ContentType[]; download: "media" | "thumbnail" }> = {
  youtube: { name: "YouTube", needs: "YOUTUBE_API_KEY on the server", types: ["short", "video"], download: "thumbnail" },
  instagram: { name: "Instagram", needs: "a connected Instagram business or creator account", types: ["short", "post"], download: "thumbnail" },
  reddit: { name: "Reddit", needs: "nothing (public search)", types: ["post", "video"], download: "media" },
  bluesky: { name: "Bluesky", needs: "nothing (public search)", types: ["post"], download: "media" },
  mastodon: { name: "Mastodon", needs: "nothing (public hashtag timelines)", types: ["post"], download: "media" },
  x: { name: "X", needs: "X_BEARER_TOKEN (X API Basic or above)", types: ["post"], download: "thumbnail" },
};

/** Platforms people ask about that have no search API for other apps. */
export const NO_SEARCH_API: { name: string; why: string }[] = [
  { name: "TikTok", why: "TikTok's search and video data are only open to approved academic researchers (Research API)." },
  { name: "Facebook", why: "Meta removed public post search from the Graph API." },
  { name: "LinkedIn", why: "LinkedIn has no public content search for apps." },
  { name: "Threads", why: "Threads' keyword search only returns posts to approved apps, without view counts." },
];

export type ContentType = "short" | "video" | "post";
export type Period = "day" | "week" | "month" | "year" | "any";
export type SortKey = "views" | "likes" | "comments" | "engagement" | "recent";

export type DiscoverQuery = {
  q: string;
  sources: DiscoverSource[];
  types: ContentType[];
  period: Period;
  minViews?: number;
  minLikes?: number;
  minComments?: number;
  sort: SortKey;
  region?: string; // ISO country, YouTube only
  language?: string; // ISO language
};

/** href is Relay's signed download link for the file (added by the server). */
export type MediaVariant = { label: string; url: string; width?: number; height?: number; kind: "image" | "video"; href?: string };

export type DiscoverItem = {
  id: string; // "<source>:<platform id>"
  source: DiscoverSource;
  type: ContentType;
  title: string;
  text: string;
  author: string;
  authorUrl?: string;
  url: string;
  thumbnail?: string;
  publishedAt: string;
  durationSec?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  tags: string[];
  /** Downloadable files, best quality first. Empty when the platform's terms don't allow it. */
  media: MediaVariant[];
  demo?: boolean;
};

export type Keyword = { term: string; kind: "hashtag" | "keyword" | "phrase"; score: number; count: number; avgViews?: number; avgEngagement: number };

export type DiscoverResult = {
  items: DiscoverItem[];
  keywords: Keyword[];
  notes: { source: DiscoverSource; message: string }[];
  demo: DiscoverSource[];
  fetchedAt: string;
};

export function engagement(i: Pick<DiscoverItem, "views" | "likes" | "comments" | "shares">) {
  const acts = (i.likes ?? 0) + (i.comments ?? 0) + (i.shares ?? 0);
  return i.views ? acts / i.views : acts;
}

export const PERIOD_DAYS: Record<Period, number | null> = { day: 1, week: 7, month: 30, year: 365, any: null };
