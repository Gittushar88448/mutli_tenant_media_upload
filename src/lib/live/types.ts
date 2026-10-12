import type { TargetPlatform } from "@/lib/platforms";

/**
 * Shapes and per-platform capabilities for the Live view. No server code here, so the
 * page's client components can import it; the fetchers themselves live in ./fetchers.
 */

export const METRIC_KEYS = ["views", "likes", "reactions", "comments", "shares", "saves"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type LiveMetrics = Partial<Record<MetricKey, number>>;

export type LiveComment = {
  id: string;
  author: string;
  authorUrl?: string;
  text: string;
  at: string;
  likes?: number;
  replies?: LiveComment[];
  /** Sent from Relay (stored in LiveReply), shown even before the platform echoes it back. */
  fromRelay?: boolean;
  /** Whatever the platform needs to reply to this comment (a Bluesky cid, a Slack thread ts). Never shown. */
  ref?: Record<string, string>;
};

export type LiveStatus = "live" | "removed" | "unknown";

export type LivePayload = {
  metrics: LiveMetrics;
  comments: LiveComment[];
  status: LiveStatus;
  fetchedAt: string;
  /** Something worth saying that isn't an error ("comments are turned off"). */
  note?: string;
};

/** What Relay can read back from each platform once a post is out. */
export type LiveCaps = { metrics: MetricKey[]; comments: boolean; reply: boolean; note?: string };

const RECORD_ONLY = (name: string): LiveCaps => ({
  metrics: [],
  comments: false,
  reply: false,
  note: `${name} doesn't share post stats or comments with apps. The status shown is Relay's own delivery record.`,
});

export const LIVE_CAPS: Record<TargetPlatform, LiveCaps> = {
  instagram: { metrics: ["views", "likes", "comments", "shares", "saves"], comments: true, reply: true },
  facebook: { metrics: ["reactions", "comments", "shares"], comments: true, reply: true },
  youtube: { metrics: ["views", "likes", "comments"], comments: true, reply: true },
  threads: { metrics: ["views", "likes", "comments", "shares"], comments: true, reply: true },
  reddit: { metrics: ["likes", "comments"], comments: true, reply: true },
  bluesky: { metrics: ["likes", "comments", "shares"], comments: true, reply: true },
  mastodon: { metrics: ["likes", "comments", "shares"], comments: true, reply: true },
  x: { metrics: ["views", "likes", "comments", "shares"], comments: false, reply: false, note: "X only shares replies with the higher API tiers, so Relay shows counts here." },
  tiktok: { metrics: ["views", "likes", "comments", "shares"], comments: false, reply: false, note: "TikTok's API gives counts but not the comments themselves." },
  slack: { metrics: ["reactions", "comments"], comments: true, reply: true },
  discord: { metrics: ["reactions"], comments: false, reply: false, note: "A channel webhook can read reactions but not thread replies." },
  telegram: RECORD_ONLY("Telegram's Bot API"),
  whatsapp: RECORD_ONLY("WhatsApp"),
  pinterest: RECORD_ONLY("Pinterest (with Relay's current permissions)"),
  linkedin: RECORD_ONLY("LinkedIn (without Community Management API approval)"),
  webhook: { metrics: [], comments: false, reply: false, note: "Webhooks deliver to your own system; Relay only knows whether it accepted the payload." },
  manual: { metrics: [], comments: false, reply: false, note: "You posted this one yourself; Relay only knows it was marked done." },
};

export const liveCaps = (platform: string): LiveCaps => LIVE_CAPS[platform as TargetPlatform] ?? RECORD_ONLY(platform);

export const METRIC_LABEL: Record<MetricKey, string> = {
  views: "Views",
  likes: "Likes",
  reactions: "Reactions",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
};
