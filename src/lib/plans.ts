/**
 * Plans, limits and the features each one unlocks. Safe to import from client components
 * (no mongoose), so the composer and billing page read the same table the server enforces.
 */
export const PLANS = ["free", "creator", "studio", "agency"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_LIMITS: Record<Plan, { accounts: number; postsPerMonth: number; storageMb: number; seats: number }> = {
  free: { accounts: 3, postsPerMonth: 30, storageMb: 500, seats: 1 },
  creator: { accounts: 8, postsPerMonth: 300, storageMb: 10_000, seats: 2 },
  studio: { accounts: 25, postsPerMonth: 2000, storageMb: 50_000, seats: 10 },
  agency: { accounts: 150, postsPerMonth: 20000, storageMb: 500_000, seats: 50 },
};

export type Feature = "channelCaptions" | "channelVideoEdits" | "polls" | "editAfterPublish" | "liveEdits" | "mediaStudio";

export const FEATURE_LABELS: Record<Feature, { title: string; body: string }> = {
  channelCaptions: { title: "Different text per platform", body: "Its own caption, description, title and headline for every channel in a post." },
  channelVideoEdits: { title: "Video edits per platform", body: "Trim, crop and soundtrack for each channel, rendered with FFmpeg before it uploads." },
  polls: { title: "Polls", body: "Run polls in Telegram, Discord and Mastodon from the composer." },
  editAfterPublish: { title: "Edit one channel at any time", body: "Change or retry a single channel of a post while the others are already live." },
  liveEdits: { title: "Edit sent messages", body: "Fix a typo in a message that already went out on Telegram, Discord, Slack, Mastodon or Reddit." },
  mediaStudio: { title: "Full media editor", body: "Filters, adjustments, filter packs, your own LUTs and the music library. Cropping, rotating and trimming are free." },
};

const FEATURES: Record<Plan, Feature[]> = {
  free: [],
  creator: ["channelCaptions", "channelVideoEdits", "polls", "editAfterPublish", "mediaStudio"],
  studio: ["channelCaptions", "channelVideoEdits", "polls", "editAfterPublish", "liveEdits", "mediaStudio"],
  agency: ["channelCaptions", "channelVideoEdits", "polls", "editAfterPublish", "liveEdits", "mediaStudio"],
};

/**
 * List prices in rupees: what `npm run razorpay:plans` creates in Razorpay. With Razorpay
 * configured, the billing page shows the live amounts of the plans in your account instead.
 */
export const PLAN_INFO: Record<Plan, { name: string; monthly: number; yearly: number; pitch: string }> = {
  free: { name: "Free", monthly: 0, yearly: 0, pitch: "One message, sent everywhere the same way." },
  creator: { name: "Creator", monthly: 1299, yearly: 12499, pitch: "Tailor every post and video to each platform." },
  studio: { name: "Studio", monthly: 3999, yearly: 38399, pitch: "For teams that publish daily and fix things live." },
  agency: { name: "Agency", monthly: 11999, yearly: 115199, pitch: "Many brands, many channels, one queue." },
};

export type Price = { amount: number; currency: string };
export type PriceTable = Record<Plan, { month: Price; year: Price }>;

/** The static INR price table. */
export function listPrices(): PriceTable {
  return Object.fromEntries(PLANS.map((p) => [p, { month: { amount: PLAN_INFO[p].monthly, currency: "INR" }, year: { amount: PLAN_INFO[p].yearly, currency: "INR" } }])) as PriceTable;
}

export function formatPrice(p: Price) {
  return new Intl.NumberFormat(p.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 }).format(p.amount);
}

export function planFeatures(plan: string): Record<Feature, boolean> {
  const list = FEATURES[(PLANS as readonly string[]).includes(plan) ? (plan as Plan) : "free"];
  return Object.fromEntries((Object.keys(FEATURE_LABELS) as Feature[]).map((f) => [f, list.includes(f)])) as Record<Feature, boolean>;
}

/** The cheapest plan that has a feature, for "Upgrade to …" prompts. */
export function planFor(feature: Feature): Plan {
  return PLANS.find((p) => FEATURES[p].includes(feature)) ?? "studio";
}
