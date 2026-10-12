/**
 * Platform registry: the "capabilities()" half of the connector interface from the
 * architecture doc. The composer, validation and admin screens are all driven from here,
 * so adding a platform is one entry plus its n8n workflow.
 */
export type PlatformId = "instagram" | "facebook" | "youtube" | "tiktok" | "linkedin" | "x" | "threads" | "pinterest" | "reddit";
/** Community and messaging destinations, connected with a bot token, webhook or app password instead of OAuth. */
export type CommunityId = "telegram" | "whatsapp" | "discord" | "slack" | "bluesky" | "mastodon";
export type ConnectorKind = "webhook" | "manual";
export type TargetPlatform = PlatformId | CommunityId | ConnectorKind;

export type PostType = "reel" | "feed" | "story" | "carousel" | "video" | "short" | "text" | "message" | "media" | "album" | "poll" | "link";

/** A field on the connect form of a token-connected platform. Secret fields are stored encrypted. */
export type CredentialField = {
  key: string;
  label: string;
  type: "text" | "secret" | "url" | "textarea";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Only shown for this connection mode (WhatsApp has an API mode and an assisted mode). */
  mode?: string;
};

export type OptionField =
  | { key: string; label: string; type: "text"; max?: number; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; noDefault?: boolean }
  | { key: string; label: string; type: "switch"; hint?: string };

export interface PlatformSpec {
  id: TargetPlatform;
  name: string;
  short: string;
  color: string;
  /** social: OAuth feeds; community: channels, groups and servers you message; custom: webhook and manual. */
  category: "social" | "community" | "custom";
  postTypes: {
    id: PostType;
    label: string;
    media: "video" | "image" | "any" | "none";
    maxDurationSec?: number;
    minDurationSec?: number;
    maxItems?: number;
    minItems?: number;
    /** Overrides captionMax for this type (Telegram media captions are capped at 1,024). */
    captionMax?: number;
  }[];
  captionMax: number;
  hashtagMax?: number;
  options: OptionField[];
  oauth?: {
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientIdEnv: string;
    clientSecretEnv: string;
  };
  notes: string;
  /** Token-connected platforms: the fields asked for on connect, and the connection modes offered. */
  credentials?: { fields: CredentialField[]; modes?: { id: string; label: string; hint: string }[] };
  /** Delivered by Relay's own connector code (lib/publishing/connectors) rather than an n8n branch. */
  direct?: boolean;
  /** Messages already sent can be edited in place from Relay. */
  liveEdit?: boolean;
  /** Short label for what a destination is called on this platform. */
  noun?: string;
}

const POLL_DURATIONS = [
  { value: "1", label: "1 hour" },
  { value: "4", label: "4 hours" },
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "1 week" },
];

export const PLATFORMS: Record<TargetPlatform, PlatformSpec> = {
  instagram: {
    id: "instagram",
    category: "social",
    name: "Instagram",
    short: "IG",
    color: "#d6336c",
    postTypes: [
      { id: "reel", label: "Reel", media: "video", maxDurationSec: 900, minDurationSec: 3 },
      { id: "feed", label: "Feed post", media: "any" },
      { id: "carousel", label: "Carousel", media: "any", maxItems: 10 },
      { id: "story", label: "Story", media: "any", maxDurationSec: 60 },
    ],
    captionMax: 2200,
    hashtagMax: 30,
    options: [
      { key: "shareToFeed", label: "Also show Reel in feed", type: "switch" },
      { key: "audioName", label: "Original audio name", type: "text", max: 60, placeholder: "Original audio" },
    ],
    oauth: {
      authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
      scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights", "pages_show_list", "business_management"],
      clientIdEnv: "META_APP_ID",
      clientSecretEnv: "META_APP_SECRET",
    },
    notes: "Professional accounts only. Media is pulled from a public URL. About 100 API posts per account per day.",
  },
  facebook: {
    id: "facebook",
    category: "social",
    name: "Facebook Page",
    short: "FB",
    color: "#1877f2",
    postTypes: [
      { id: "feed", label: "Page post", media: "any" },
      { id: "reel", label: "Reel", media: "video", maxDurationSec: 90, minDurationSec: 3 },
      { id: "text", label: "Text only", media: "none" },
    ],
    captionMax: 63206,
    options: [{ key: "link", label: "Link to attach", type: "text", placeholder: "https://" }],
    oauth: {
      authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
      scopes: ["pages_manage_posts", "pages_read_engagement", "pages_read_user_content", "pages_manage_engagement", "pages_show_list", "publish_video"],
      clientIdEnv: "META_APP_ID",
      clientSecretEnv: "META_APP_SECRET",
    },
    notes: "Pages only. Meta closed the Groups API in 2024, so post to Groups with a manual reminder.",
  },
  youtube: {
    id: "youtube",
    category: "social",
    name: "YouTube",
    short: "YT",
    color: "#e5372b",
    postTypes: [
      { id: "short", label: "Short", media: "video", maxDurationSec: 180 },
      { id: "video", label: "Video", media: "video" },
    ],
    captionMax: 5000,
    options: [
      { key: "title", label: "Title", type: "text", max: 100, required: true, placeholder: "Video title" },
      {
        key: "privacy",
        label: "Visibility",
        type: "select",
        required: true,
        options: [
          { value: "public", label: "Public" },
          { value: "unlisted", label: "Unlisted" },
          { value: "private", label: "Private" },
        ],
      },
      { key: "madeForKids", label: "Made for kids", type: "switch" },
    ],
    oauth: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"],
      clientIdEnv: "GOOGLE_CLIENT_ID",
      clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    },
    notes: "10,000 quota units a day shared by every workspace; one upload costs about 1,600.",
  },
  tiktok: {
    id: "tiktok",
    category: "social",
    name: "TikTok",
    short: "TT",
    color: "#111111",
    postTypes: [
      { id: "video", label: "Video", media: "video", maxDurationSec: 600, minDurationSec: 3 },
      { id: "carousel", label: "Photo post", media: "image", maxItems: 35 },
    ],
    captionMax: 2200,
    options: [
      {
        key: "privacy",
        label: "Who can view",
        type: "select",
        required: true,
        noDefault: true,
        options: [
          { value: "PUBLIC_TO_EVERYONE", label: "Everyone" },
          { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
          { value: "SELF_ONLY", label: "Only me" },
        ],
      },
      { key: "sendToDrafts", label: "Send to drafts", type: "switch", hint: "Lets the creator add a trending sound in the TikTok app" },
      { key: "brandedContent", label: "Branded content", type: "switch" },
      { key: "disableComments", label: "Turn off comments", type: "switch" },
    ],
    oauth: {
      authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
      tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
      scopes: ["user.info.basic", "video.publish", "video.upload", "video.list"],
      clientIdEnv: "TIKTOK_CLIENT_KEY",
      clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    },
    notes: "Until the Content Posting audit passes, posts are private-only. Privacy must be picked by the creator.",
  },
  linkedin: {
    id: "linkedin",
    category: "social",
    name: "LinkedIn",
    short: "IN",
    color: "#0a66c2",
    postTypes: [
      { id: "text", label: "Text", media: "none" },
      { id: "feed", label: "Image or video", media: "any" },
    ],
    captionMax: 3000,
    options: [],
    oauth: {
      authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
      scopes: ["openid", "profile", "w_member_social"],
      clientIdEnv: "LINKEDIN_CLIENT_ID",
      clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    },
    notes: "Company pages need Community Management API approval.",
  },
  x: {
    id: "x",
    category: "social",
    name: "X",
    short: "X",
    color: "#111111",
    postTypes: [
      { id: "text", label: "Post", media: "none" },
      { id: "feed", label: "Post with media", media: "any", maxItems: 4 },
    ],
    captionMax: 280,
    options: [],
    oauth: {
      authorizeUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
      scopes: ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"],
      clientIdEnv: "X_CLIENT_ID",
      clientSecretEnv: "X_CLIENT_SECRET",
    },
    notes: "Needs a paid API tier.",
  },
  threads: {
    id: "threads",
    category: "social",
    name: "Threads",
    short: "TH",
    color: "#111111",
    postTypes: [
      { id: "text", label: "Text", media: "none" },
      { id: "feed", label: "Image or video", media: "any" },
      { id: "carousel", label: "Carousel", media: "any", maxItems: 20 },
    ],
    captionMax: 500,
    options: [],
    oauth: {
      authorizeUrl: "https://threads.net/oauth/authorize",
      tokenUrl: "https://graph.threads.net/oauth/access_token",
      scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_read_replies", "threads_manage_replies"],
      clientIdEnv: "THREADS_APP_ID",
      clientSecretEnv: "THREADS_APP_SECRET",
    },
    notes: "About 250 posts per account per day.",
  },
  pinterest: {
    id: "pinterest",
    category: "social",
    name: "Pinterest",
    short: "PI",
    color: "#e60023",
    postTypes: [{ id: "feed", label: "Pin", media: "any" }],
    captionMax: 500,
    options: [
      { key: "boardId", label: "Board", type: "text", required: true, placeholder: "Board id" },
      { key: "title", label: "Pin title", type: "text", max: 100 },
      { key: "link", label: "Destination link", type: "text", placeholder: "https://" },
    ],
    oauth: {
      authorizeUrl: "https://www.pinterest.com/oauth/",
      tokenUrl: "https://api.pinterest.com/v5/oauth/token",
      scopes: ["boards:read", "pins:write"],
      clientIdEnv: "PINTEREST_APP_ID",
      clientSecretEnv: "PINTEREST_APP_SECRET",
    },
    notes: "A board must be chosen for every Pin.",
  },
  reddit: {
    id: "reddit",
    category: "social",
    name: "Reddit",
    short: "RD",
    color: "#ff4500",
    noun: "subreddit",
    postTypes: [
      { id: "text", label: "Text post", media: "none" },
      { id: "link", label: "Link post", media: "none" },
    ],
    captionMax: 40000,
    options: [
      { key: "subreddit", label: "Subreddit", type: "text", required: true, max: 21, placeholder: "r/yourcommunity" },
      { key: "title", label: "Post title", type: "text", required: true, max: 300 },
      { key: "url", label: "Link (link posts)", type: "text", placeholder: "https://" },
      { key: "flairId", label: "Flair id", type: "text", placeholder: "Optional" },
      { key: "nsfw", label: "Mark NSFW", type: "switch" },
      { key: "spoiler", label: "Mark as spoiler", type: "switch" },
    ],
    oauth: {
      authorizeUrl: "https://www.reddit.com/api/v1/authorize",
      tokenUrl: "https://www.reddit.com/api/v1/access_token",
      scopes: ["identity", "submit", "edit", "read", "flair"],
      clientIdEnv: "REDDIT_CLIENT_ID",
      clientSecretEnv: "REDDIT_CLIENT_SECRET",
    },
    direct: true,
    liveEdit: true,
    notes: "Posts to any subreddit the account may post in. Each subreddit's own rules (flair, karma, link posts) still apply.",
  },
  telegram: {
    id: "telegram",
    category: "community",
    name: "Telegram",
    short: "TG",
    color: "#229ed9",
    noun: "channel or group",
    postTypes: [
      { id: "message", label: "Message", media: "none" },
      { id: "media", label: "Photo or video", media: "any", captionMax: 1024 },
      { id: "album", label: "Album", media: "any", minItems: 2, maxItems: 10, captionMax: 1024 },
      { id: "poll", label: "Poll", media: "none" },
    ],
    captionMax: 4096,
    options: [
      { key: "headline", label: "Bold headline", type: "text", max: 120, placeholder: "Optional first line" },
      { key: "silent", label: "Send silently", type: "switch", hint: "Members get it without a sound" },
      { key: "pin", label: "Pin the message", type: "switch" },
      { key: "protect", label: "Block forwarding and saving", type: "switch" },
      { key: "noPreview", label: "Hide link previews", type: "switch" },
    ],
    credentials: {
      fields: [
        { key: "botToken", label: "Bot token", type: "secret", required: true, placeholder: "123456:ABC-DEF…", hint: "From @BotFather. Add the bot to your channel or group as an admin that can post." },
        { key: "chatId", label: "Channel or group", type: "text", required: true, placeholder: "@yourchannel or -1001234567890" },
      ],
    },
    direct: true,
    liveEdit: true,
    notes: "Channels, groups and supergroups through your own bot. Text, photos, videos, albums and polls; sent messages can be edited.",
  },
  whatsapp: {
    id: "whatsapp",
    category: "community",
    name: "WhatsApp",
    short: "WA",
    color: "#25d366",
    noun: "channel, community or group",
    postTypes: [
      { id: "message", label: "Message", media: "none" },
      { id: "media", label: "Photo or video", media: "any" },
    ],
    captionMax: 4096,
    options: [
      { key: "headline", label: "Bold headline", type: "text", max: 120, placeholder: "Optional first line" },
      { key: "templateName", label: "Approved template", type: "text", max: 512, placeholder: "Needed outside the 24-hour window" },
      { key: "templateLanguage", label: "Template language", type: "text", max: 10, placeholder: "en_US" },
    ],
    credentials: {
      modes: [
        { id: "api", label: "Cloud API", hint: "Sends from your WhatsApp Business number to groups and opted-in contacts. Fully automatic." },
        { id: "assisted", label: "Channel or Community", hint: "WhatsApp has no API for Channels or Community announcements. Relay lines the post up at the scheduled time and you send it with one tap." },
      ],
      fields: [
        { key: "name", label: "Name in Relay", type: "text", required: true, placeholder: "Northwind updates" },
        { key: "phoneNumberId", label: "Phone number ID", type: "text", required: true, mode: "api", placeholder: "From WhatsApp Manager → API setup" },
        { key: "accessToken", label: "Access token", type: "secret", required: true, mode: "api", hint: "A permanent system-user token with whatsapp_business_messaging." },
        { key: "recipients", label: "Groups and contacts", type: "textarea", required: true, mode: "api", placeholder: "One per line: group IDs or numbers like +14155550123", hint: "Contacts must have opted in to your messages." },
        { key: "inviteUrl", label: "Channel or community link", type: "url", mode: "assisted", placeholder: "https://whatsapp.com/channel/…" },
      ],
    },
    direct: true,
    notes: "Cloud API sends to groups and opted-in contacts. Channels and Community announcements have no API, so Relay reminds you and you send with one tap.",
  },
  discord: {
    id: "discord",
    category: "community",
    name: "Discord",
    short: "DC",
    color: "#5865f2",
    noun: "server channel",
    postTypes: [
      { id: "message", label: "Message", media: "none" },
      { id: "media", label: "With attachments", media: "any", maxItems: 10 },
      { id: "poll", label: "Poll", media: "none" },
    ],
    captionMax: 2000,
    options: [
      { key: "headline", label: "Bold headline", type: "text", max: 120, placeholder: "Optional first line" },
      { key: "threadName", label: "Forum post title", type: "text", max: 100, placeholder: "Only for forum channels" },
      { key: "username", label: "Post as name", type: "text", max: 80, placeholder: "Defaults to the webhook's name" },
      { key: "suppressEmbeds", label: "Hide link embeds", type: "switch" },
    ],
    credentials: {
      fields: [
        { key: "webhookUrl", label: "Channel webhook URL", type: "secret", required: true, placeholder: "https://discord.com/api/webhooks/…", hint: "Server settings → Integrations → Webhooks → New webhook → Copy URL." },
      ],
    },
    direct: true,
    liveEdit: true,
    notes: "Posts to a server channel, announcement channel or forum through a channel webhook. Messages and polls can be edited or followed up.",
  },
  slack: {
    id: "slack",
    category: "community",
    name: "Slack",
    short: "SL",
    color: "#4a154b",
    noun: "channel",
    postTypes: [
      { id: "message", label: "Message", media: "none" },
      { id: "media", label: "With files", media: "any", maxItems: 10 },
    ],
    captionMax: 40000,
    options: [{ key: "headline", label: "Bold headline", type: "text", max: 150, placeholder: "Optional first line" }],
    credentials: {
      fields: [
        { key: "botToken", label: "Bot token", type: "secret", required: true, placeholder: "xoxb-…", hint: "A Slack app with chat:write, files:write, channels:read and channels:history (for Live view). Invite it to the channel." },
        { key: "channelId", label: "Channel ID", type: "text", required: true, placeholder: "C0123456789" },
      ],
    },
    direct: true,
    liveEdit: true,
    notes: "Posts to a public or private channel in your workspace or a community Slack. Sent messages can be edited.",
  },
  bluesky: {
    id: "bluesky",
    category: "community",
    name: "Bluesky",
    short: "BS",
    color: "#1185fe",
    noun: "profile",
    postTypes: [
      { id: "message", label: "Post", media: "none" },
      { id: "media", label: "With images", media: "image", maxItems: 4 },
    ],
    captionMax: 300,
    options: [],
    credentials: {
      fields: [
        { key: "identifier", label: "Handle", type: "text", required: true, placeholder: "yourname.bsky.social" },
        { key: "appPassword", label: "App password", type: "secret", required: true, placeholder: "xxxx-xxxx-xxxx-xxxx", hint: "Settings → Privacy and security → App passwords. Never your main password." },
        { key: "service", label: "PDS", type: "url", placeholder: "https://bsky.social (default)" },
      ],
    },
    direct: true,
    notes: "Posts with up to four images. Links in the text are made clickable.",
  },
  mastodon: {
    id: "mastodon",
    category: "community",
    name: "Mastodon",
    short: "MA",
    color: "#6364ff",
    noun: "account",
    postTypes: [
      { id: "message", label: "Post", media: "none" },
      { id: "media", label: "With media", media: "any", maxItems: 4 },
      { id: "poll", label: "Poll", media: "none" },
    ],
    captionMax: 500,
    options: [
      {
        key: "visibility",
        label: "Visibility",
        type: "select",
        options: [
          { value: "public", label: "Public" },
          { value: "unlisted", label: "Quiet public" },
          { value: "private", label: "Followers only" },
        ],
      },
      { key: "spoiler", label: "Content warning", type: "text", max: 100, placeholder: "Optional" },
    ],
    credentials: {
      fields: [
        { key: "instanceUrl", label: "Server", type: "url", required: true, placeholder: "https://mastodon.social" },
        { key: "accessToken", label: "Access token", type: "secret", required: true, hint: "Preferences → Development → New application with read:statuses, write:statuses and write:media." },
      ],
    },
    direct: true,
    liveEdit: true,
    notes: "Any Mastodon-compatible server. Posts, media and polls; sent posts can be edited.",
  },
  webhook: {
    id: "webhook",
    category: "custom",
    name: "Webhook",
    short: "WH",
    color: "#6b7280",
    postTypes: [{ id: "feed", label: "Payload", media: "any" }],
    captionMax: 100000,
    options: [],
    notes: "Sends a signed JSON payload with media links to a URL you control (your CMS, Zapier, Make).",
  },
  manual: {
    id: "manual",
    category: "custom",
    name: "Manual reminder",
    short: "MN",
    color: "#a16207",
    postTypes: [{ id: "feed", label: "Reminder", media: "any" }],
    captionMax: 100000,
    options: [],
    notes: "For platforms without an API: at the scheduled time you get the file and caption and mark it done.",
  },
};

export const SOCIAL_PLATFORMS = Object.values(PLATFORMS).filter((p) => p.oauth) as (PlatformSpec & { id: PlatformId })[];
export const COMMUNITY_PLATFORMS = Object.values(PLATFORMS).filter((p) => p.category === "community") as (PlatformSpec & { id: CommunityId })[];
export const ALL_TARGET_PLATFORMS = Object.keys(PLATFORMS) as TargetPlatform[];
/** Platforms whose delivery runs in Relay's own connectors (the n8n workflow hands them to /send). */
export const DIRECT_PLATFORMS = Object.values(PLATFORMS).filter((p) => p.direct).map((p) => p.id);
export const isCommunity = (p: string) => PLATFORMS[p as TargetPlatform]?.category === "community";
export { POLL_DURATIONS };

export function isPlatformConfigured(p: TargetPlatform) {
  const spec = PLATFORMS[p];
  if (!spec.oauth) return true;
  return Boolean(process.env[spec.oauth.clientIdEnv] && process.env[spec.oauth.clientSecretEnv]);
}

export function countHashtags(text: string) {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}
