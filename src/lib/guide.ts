/**
 * Copy for the in-app guide (/guide). Kept as data, next to the platform registry it
 * explains, so a platform's setup steps are edited in one place. Anything the registry
 * already knows (post types, limits, notes) is read from there instead of repeated here.
 */
import type { CommunityId, PlatformId } from "@/lib/platforms";

/** What someone needs on the platform's side before "Connect" works. */
export const SOCIAL_REQUIREMENTS: Record<PlatformId, string> = {
  instagram: "An Instagram Business or Creator account, linked to a Facebook Page you manage.",
  facebook: "Admin access to the Facebook Page. Personal profiles and Groups can't be posted to.",
  youtube: "A Google account with a YouTube channel.",
  tiktok: "A TikTok account. You choose who can see each post when you schedule it.",
  linkedin: "A LinkedIn profile. Company pages need admin access and LinkedIn's API approval.",
  x: "An X account. The server needs a paid X API plan.",
  threads: "A Threads profile (it signs in through Instagram).",
  pinterest: "A Pinterest account with at least one board.",
  reddit: "A Reddit account that's allowed to post in the subreddits you pick.",
};

export type GuideStep = { text: string; code?: string };

export const COMMUNITY_GUIDES: Record<CommunityId, { intro: string; steps: GuideStep[]; good: string[]; alt?: { title: string; steps: GuideStep[] } }> = {
  telegram: {
    intro: "Relay posts through a bot you own, so messages appear from your channel, not from Relay.",
    steps: [
      { text: "In Telegram, open @BotFather, send /newbot and follow the prompts. Copy the token it gives you.", code: "123456789:AA…" },
      { text: "Open your channel or group, go to Administrators, add the bot, and allow it to post messages (and pin, if you want pinned announcements)." },
      { text: "In Relay, open Communities, choose Connect Telegram, paste the token, and enter the chat: the public @username, or the numeric ID of a private chat.", code: "@yourchannel  or  -1001234567890" },
      { text: "Relay checks that the bot can reach the chat and reads its member count. Nothing is sent until you post." },
    ],
    good: ["Messages, photos and videos, albums of 2 to 10, and polls", "Silent sends, pinning, and blocking forwarding", "Fix a typo after sending (Studio and above)"],
  },
  whatsapp: {
    intro: "WhatsApp has two ways in. The Cloud API sends automatically to groups and contacts. Channels and Community announcements have no API, so Relay gets the post ready and you send it.",
    steps: [
      { text: "In Meta's developer site, create an app with the WhatsApp product, and add your business phone number under WhatsApp → API setup." },
      { text: "Copy the Phone number ID shown on that page." },
      { text: "In Business settings → System users, create a system user, give it your WhatsApp account, and generate a permanent token with the whatsapp_business_messaging permission." },
      { text: "In Relay, choose Connect WhatsApp → Cloud API, paste both, and list who receives the posts: one group ID or phone number per line.", code: "+919876543210" },
    ],
    good: [
      "Text, photos and videos to groups and opted-in contacts",
      "Outside 24 hours since a contact last wrote to you, WhatsApp only allows approved message templates. Add the template's name to the post.",
    ],
    alt: {
      title: "Channels and Community announcements (assisted)",
      steps: [
        { text: "In WhatsApp, open your channel or community, tap its name, and copy the share link." },
        { text: "In Relay, choose Connect WhatsApp → Channel or Community, name it, and paste the link." },
        { text: "When a post is due it appears under Needs attention with Copy text and Open WhatsApp. Paste it, send it, then press Mark posted." },
      ],
    },
  },
  discord: {
    intro: "Relay posts with a channel webhook. No bot to install, and you can pick the name it posts as.",
    steps: [
      { text: "In Discord, open Server settings → Integrations → Webhooks → New Webhook." },
      { text: "Pick the channel it posts to (a text, announcement or forum channel) and press Copy Webhook URL." },
      { text: "In Relay, choose Connect Discord and paste the URL.", code: "https://discord.com/api/webhooks/…" },
    ],
    good: ["Messages, up to 10 attachments, and polls", "Forum channels: give each post a title in the channel's options", "Edit messages after sending (Studio and above)"],
  },
  slack: {
    intro: "Relay posts as a small Slack app you create in your workspace. It takes about five minutes.",
    steps: [
      { text: "Go to api.slack.com/apps → Create New App → From scratch, and pick your workspace." },
      { text: "Under OAuth & Permissions, add the bot scopes chat:write, files:write, channels:read and channels:history (so Live view can read thread replies), then Install to Workspace." },
      { text: "Copy the Bot User OAuth Token.", code: "xoxb-…" },
      { text: "In the Slack channel, type /invite @YourApp. Then open the channel's details and copy the Channel ID at the bottom.", code: "C0123456789" },
      { text: "In Relay, choose Connect Slack and paste the token and the channel ID." },
    ],
    good: ["Messages and up to 10 files", "Public and private channels the app was invited to", "Edit messages after sending (Studio and above)"],
  },
  bluesky: {
    intro: "Bluesky uses app passwords: a separate password just for Relay that you can revoke at any time.",
    steps: [
      { text: "In Bluesky, open Settings → Privacy and security → App passwords → Add App Password, and name it Relay." },
      { text: "In Relay, choose Connect Bluesky, enter your handle and paste the app password.", code: "yourname.bsky.social" },
      { text: "On a self-hosted server, also fill in its address (PDS). Everyone else leaves it empty." },
    ],
    good: ["Posts with up to four images", "Links and hashtags become clickable"],
  },
  mastodon: {
    intro: "Works with any Mastodon-compatible server. You create an access token in your account settings.",
    steps: [
      { text: "On your server, open Preferences → Development → New application, and name it Relay." },
      { text: "Tick the read:statuses, write:statuses and write:media scopes, and submit." },
      { text: "Open the application and copy Your access token." },
      { text: "In Relay, choose Connect Mastodon and enter your server address and the token.", code: "https://mastodon.social" },
    ],
    good: ["Posts with up to four media files, and polls", "Visibility and content warnings per post", "Edit posts after sending (Studio and above)"],
  },
};

/** Places people ask about that have no posting API, and what to do instead. */
export const NO_API = [
  { name: "WhatsApp Channels and Community announcements", instead: "Connect WhatsApp in assisted mode. Relay reminds you with the text ready to paste." },
  { name: "Facebook Groups", instead: "Meta closed the Groups API in 2024. Add a Manual reminder channel." },
  { name: "Instagram broadcast channels", instead: "Add a Manual reminder channel." },
  { name: "Personal Facebook profiles", instead: "Post to a Facebook Page instead, or use a Manual reminder." },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Why did a post fail on one channel?",
    a: "Open the post from the Queue. Each channel shows its own status and the platform's error. Temporary errors retry by themselves after 1, 4, 15 and 60 minutes. For anything else, fix it with Edit next to that channel and send it again; the other channels aren't touched.",
  },
  {
    q: "A channel says it needs reconnecting.",
    a: "The platform stopped accepting Relay's sign-in, usually after a password change or when access was removed. Open Channels and connect the same account again. Scheduled posts then go out as planned; press Retry on any that already failed.",
  },
  {
    q: "Can I send different text to each platform?",
    a: "Yes, on Creator and above. In the composer, open a channel's tab and write its own caption, title or headline. Channels without their own text use the main text.",
  },
  {
    q: "Can I fix a message after it's sent?",
    a: "On Studio and above, for Telegram, Discord, Slack, Mastodon and Reddit text posts: open the post, choose Edit message on that channel, and press Update. Other channels can't be edited from Relay once they're live.",
  },
  {
    q: "Why does my WhatsApp message need a template?",
    a: "WhatsApp only lets businesses send free-form messages within 24 hours of a contact's last message to them. Outside that window you need a template approved in WhatsApp Manager; add its name in the post's WhatsApp options.",
  },
  {
    q: "What's a sandbox channel?",
    a: "A pretend channel that behaves like the real one, including failures, without posting anywhere. It's there so you can try Relay before connecting real accounts.",
  },
  {
    q: "Who can connect channels and change the plan?",
    a: "The workspace owner and admins. Editors write and schedule, approvers review, and viewers can look at everything without changing it.",
  },
  {
    q: "What happens to my posts if I move to Free?",
    a: "Scheduled posts still go out. Channel-specific text and video cuts you already saved are kept, but you can't add new ones until you upgrade again.",
  },
];

export const ROLE_MATRIX: { can: string; roles: ("owner" | "admin" | "editor" | "approver" | "viewer")[] }[] = [
  { can: "See posts, calendar, channels and stats", roles: ["owner", "admin", "editor", "approver", "viewer"] },
  { can: "Write, schedule and edit posts; upload media", roles: ["owner", "admin", "editor"] },
  { can: "Approve or reject posts when approvals are on", roles: ["owner", "admin", "approver"] },
  { can: "Connect and remove channels and communities", roles: ["owner", "admin"] },
  { can: "Add members and change their roles", roles: ["owner", "admin"] },
  { can: "Change the plan and payment", roles: ["owner", "admin"] },
];
