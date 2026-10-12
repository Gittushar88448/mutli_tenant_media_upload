import "server-only";
import { liveCaps, type LiveComment, type LiveMetrics, type LivePayload } from "./types";

/**
 * Simulated platform reads for sandbox channels. Everything is seeded by the target id, so
 * the same post shows the same numbers on every refresh, and they only grow as time since
 * publishing passes. Only the metrics and comments the real platform offers are simulated,
 * so a sandbox Telegram channel looks exactly as bare as a real one.
 */

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small, fast and good enough for believable fake numbers. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE = ["maya.codes", "jonas_b", "priya.k", "theo_draws", "lin_wu", "sam.okafor", "ana.ruiz", "kenji_t", "noor.h", "felix_m", "rosa.lima", "dev.patel"];
const LINES = [
  "This is great, thanks for sharing!",
  "Where can I find more about this?",
  "Love the colours in this one.",
  "Is this available in other sizes?",
  "Saving this for later 🙌",
  "Been waiting for this, nice work.",
  "Can you do a follow-up on how you made it?",
  "Shared with my team, they loved it.",
  "What time does it start?",
  "Is there a link?",
  "Huge fan of what you're doing here.",
  "Any plans for a version in Spanish?",
];
const REPLIES = ["Same question here!", "+1, would love to know too", "Agreed 👏", "Ha, came here to say this."];

function authorFor(platform: string, name: string) {
  switch (platform) {
    case "reddit":
      return `u/${name.replace(/\./g, "_")}`;
    case "bluesky":
      return `${name.replace(/_/g, "")}.bsky.social`;
    case "mastodon":
      return `@${name.replace(/\./g, "_")}@mastodon.social`;
    case "slack":
    case "discord":
      return name.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    case "facebook":
      return name.split(/[._]/).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
    default:
      return `@${name}`;
  }
}

/** Typical reach per platform, so a Slack thread doesn't get YouTube numbers. */
const SCALE: Record<string, number> = { youtube: 6000, tiktok: 9000, instagram: 3500, facebook: 1800, threads: 1500, x: 2500, reddit: 900, bluesky: 500, mastodon: 300, slack: 40, discord: 60 };

export function simulateLive(input: { targetId: string; platform: string; publishedAt: Date | null; now?: Date }): LivePayload {
  const now = input.now ?? new Date();
  const caps = liveCaps(input.platform);
  const published = input.publishedAt ?? now;
  const hours = Math.max(0, (now.getTime() - published.getTime()) / 3_600_000);
  const r = rng(hash(input.targetId));

  // Draw every random number in a fixed order so the profile never shifts between calls.
  const scale = (SCALE[input.platform] ?? 500) * (0.3 + r() * 1.7);
  const likeRate = 0.03 + r() * 0.07;
  const shareRate = 0.08 + r() * 0.15;
  const saveRate = 0.1 + r() * 0.2;
  // Most reach comes in the first two days, then a slow tail; both terms only grow.
  const growth = 1 - Math.exp(-hours / 18) + 0.12 * Math.log1p(hours / 24);
  const views = Math.round(scale * growth);
  const likes = Math.round(views * likeRate);

  const comments: LiveComment[] = [];
  if (caps.comments) {
    const count = 2 + Math.floor(r() * 4);
    // Fisher-Yates with the seeded generator, so the same post always gets the same people.
    const people = [...PEOPLE];
    for (let i = people.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [people[i], people[j]] = [people[j]!, people[i]!];
    }
    for (let i = 0; i < count; i++) {
      const offset = r() * r() * 48;
      const line = LINES[Math.floor(r() * LINES.length)]!;
      const commentLikes = Math.floor(r() * 12);
      const replyOffset = offset + 0.2 + r() * 6;
      const replyLine = REPLIES[Math.floor(r() * REPLIES.length)]!;
      const hasReply = r() < 0.35;
      if (offset > hours) continue;
      const id = `sim_${input.targetId.slice(-6)}_${i}`;
      const c: LiveComment = {
        id,
        author: authorFor(input.platform, people[i % people.length]!),
        text: line,
        at: new Date(published.getTime() + offset * 3_600_000).toISOString(),
        likes: Math.round(commentLikes * Math.min(1, (hours - offset + 1) / 12)),
        replies: [],
      };
      if (hasReply && replyOffset <= hours) {
        c.replies!.push({
          id: `${id}_r`,
          author: authorFor(input.platform, people[(i + count) % people.length]!),
          text: replyLine,
          at: new Date(published.getTime() + replyOffset * 3_600_000).toISOString(),
        });
      }
      comments.push(c);
    }
    comments.sort((a, b) => b.at.localeCompare(a.at));
  }

  const threadSize = comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
  const all: Required<LiveMetrics> = {
    views,
    likes,
    reactions: likes,
    comments: Math.max(threadSize, Math.round(likes * 0.06)),
    shares: Math.round(likes * shareRate),
    saves: Math.round(likes * saveRate),
  };
  // Chat platforms count a thread, not an audience.
  if (input.platform === "slack" || input.platform === "discord") {
    all.reactions = Math.min(all.reactions, 3 + Math.round(r() * 20));
    all.comments = threadSize;
  }
  const metrics: LiveMetrics = {};
  for (const k of caps.metrics) metrics[k] = all[k];

  const simulated = caps.metrics.length > 0 || caps.comments;
  return {
    metrics,
    comments,
    status: input.publishedAt ? "live" : "unknown",
    fetchedAt: now.toISOString(),
    note: simulated ? "Sandbox channel: numbers and comments are simulated." : caps.note,
  };
}
