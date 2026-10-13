import "server-only";
import { createHash } from "node:crypto";
import type { ContentType, DiscoverItem, DiscoverQuery, DiscoverSource } from "./types";

/**
 * Sample results for demo mode, so Discover can be tried before any API key is added.
 * Deterministic per query and platform; every item is marked demo and the page says so.
 */

const ANGLES = [
  ["5 mistakes everyone makes with", "mistakes beginners tips"],
  ["I tried {q} for 30 days", "challenge results honest review"],
  ["The easiest {q} tutorial", "tutorial beginners step by step"],
  ["{q} hacks nobody tells you", "hacks tips secret"],
  ["Day in my life: {q} edition", "vlog routine day in my life"],
  ["Is {q} worth it in 2026?", "review worth it honest"],
  ["{q} under ₹500", "budget cheap affordable"],
  ["Before and after: {q}", "transformation before after results"],
  ["Why your {q} isn't working", "fix mistakes tips"],
  ["{q} trends right now", "trend trending viral"],
  ["Quick {q} ideas", "ideas quick easy"],
  ["Behind the scenes of {q}", "behind the scenes process studio"],
];

function rng(seed: string) {
  let h = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
}

export function sampleResults(source: DiscoverSource, q: DiscoverQuery): DiscoverItem[] {
  const r = rng(`${source}:${q.q.toLowerCase()}:${q.period}`);
  const topic = q.q.trim().replace(/^#/, "") || "content";
  const tag = topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const days = { day: 1, week: 7, month: 30, year: 365, any: 730 }[q.period];
  const types: ContentType[] = source === "youtube" ? ["short", "video"] : source === "instagram" ? ["short", "post"] : source === "reddit" ? ["post", "video"] : ["post"];
  const n = 14 + Math.floor(r() * 8);
  return Array.from({ length: n }, (_, i) => {
    const [title, extra] = ANGLES[Math.floor(r() * ANGLES.length)]!;
    const type = types[Math.floor(r() * types.length)]!;
    const viral = r() < 0.15;
    const base = source === "youtube" ? 4000 : source === "x" ? 2500 : 300;
    const views = source === "youtube" || source === "x" ? Math.round(base * Math.pow(10, r() * 2.5 + (viral ? 1.2 : 0))) : undefined;
    const likes = Math.round((views ?? base * Math.pow(10, r() * 1.8 + (viral ? 1 : 0))) * (0.02 + r() * 0.06));
    const comments = Math.round(likes * (0.02 + r() * 0.08));
    const extraTags = extra.split(" ").slice(0, 2);
    const t = title.includes("{q}") ? title.replace("{q}", topic) : `${title} ${topic}`;
    const id = createHash("sha1").update(`${source}${q.q}${i}`).digest("hex").slice(0, 11);
    return {
      id: `${source}:demo-${id}`,
      source,
      type,
      title: t,
      text: `${t}. ${extra} #${tag} #${extraTags[0]} ${r() < 0.5 ? `#${tag}tips` : "#creator"}`,
      author: source === "reddit" ? `r/${tag} · u/sample_${i}` : `@sample.creator${i}`,
      url: "#",
      publishedAt: new Date(Date.now() - r() * days * 86400_000).toISOString(),
      durationSec: type === "short" ? 15 + Math.floor(r() * 45) : type === "video" ? 240 + Math.floor(r() * 900) : undefined,
      views,
      likes,
      comments,
      shares: source === "youtube" ? undefined : Math.round(likes * r() * 0.2),
      tags: [tag, ...extraTags, ...(source === "youtube" ? [`${topic} ${extraTags[0]}`] : [])],
      media: [],
      demo: true,
    } satisfies DiscoverItem;
  });
}
