/**
 * Platform registry: the "capabilities()" half of the connector interface from the
 * architecture doc. The composer, validation and admin screens are all driven from here,
 * so adding a platform is one entry plus its n8n workflow.
 */
export type PlatformId = "instagram" | "facebook" | "youtube" | "tiktok" | "linkedin" | "x" | "threads" | "pinterest";
export type ConnectorKind = "webhook" | "manual";
export type TargetPlatform = PlatformId | ConnectorKind;

export type PostType = "reel" | "feed" | "story" | "carousel" | "video" | "short" | "text";

export type OptionField =
  | { key: string; label: string; type: "text"; max?: number; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; noDefault?: boolean }
  | { key: string; label: string; type: "switch"; hint?: string };

export interface PlatformSpec {
  id: TargetPlatform;
  name: string;
  short: string;
  color: string;
  postTypes: { id: PostType; label: string; media: "video" | "image" | "any" | "none"; maxDurationSec?: number; minDurationSec?: number; maxItems?: number }[];
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
}

export const PLATFORMS: Record<TargetPlatform, PlatformSpec> = {
  instagram: {
    id: "instagram",
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
      scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "business_management"],
      clientIdEnv: "META_APP_ID",
      clientSecretEnv: "META_APP_SECRET",
    },
    notes: "Professional accounts only. Media is pulled from a public URL. About 100 API posts per account per day.",
  },
  facebook: {
    id: "facebook",
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
      scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list", "publish_video"],
      clientIdEnv: "META_APP_ID",
      clientSecretEnv: "META_APP_SECRET",
    },
    notes: "Pages only. Personal profiles and Groups can't be posted to through the API.",
  },
  youtube: {
    id: "youtube",
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
      scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
      clientIdEnv: "GOOGLE_CLIENT_ID",
      clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    },
    notes: "10,000 quota units a day shared by every workspace; one upload costs about 1,600.",
  },
  tiktok: {
    id: "tiktok",
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
      scopes: ["user.info.basic", "video.publish", "video.upload"],
      clientIdEnv: "TIKTOK_CLIENT_KEY",
      clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    },
    notes: "Until the Content Posting audit passes, posts are private-only. Privacy must be picked by the creator.",
  },
  linkedin: {
    id: "linkedin",
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
      scopes: ["threads_basic", "threads_content_publish"],
      clientIdEnv: "THREADS_APP_ID",
      clientSecretEnv: "THREADS_APP_SECRET",
    },
    notes: "About 250 posts per account per day.",
  },
  pinterest: {
    id: "pinterest",
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
  webhook: {
    id: "webhook",
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
export const ALL_TARGET_PLATFORMS = Object.keys(PLATFORMS) as TargetPlatform[];

export function isPlatformConfigured(p: TargetPlatform) {
  const spec = PLATFORMS[p];
  if (!spec.oauth) return true;
  return Boolean(process.env[spec.oauth.clientIdEnv] && process.env[spec.oauth.clientSecretEnv]);
}

export function countHashtags(text: string) {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}
