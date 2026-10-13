import { engagement, type DiscoverItem, type Keyword } from "./types";

/**
 * Keywords that travel with performance: every hashtag, tag, word and two-word phrase in
 * the results is scored by how well the posts using it did (views where the platform has
 * them, otherwise likes, plus engagement rate), so a term used once by a viral post and a
 * term used by many solid posts both rise. Safe to import from client components.
 */

const STOP = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves
  just like get got go going one two new now also really will can make made us via amp im dont thats youre ive its it's gonna wanna get got see way much many even still back well know think want need time day today year years video videos shorts short watch subscribe channel link bio follow comment comments share please check out http https www com`
    .split(/\s+/)
    .filter(Boolean)
);

const tokenise = (text: string) =>
  text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][\p{L}\p{N}_]+/gu, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

/** How strongly one post counts: log of its reach, lifted by its engagement rate. */
export function weight(i: DiscoverItem) {
  const reach = i.views ?? (i.likes ?? 0) * 25 + (i.comments ?? 0) * 50;
  const rate = i.views ? Math.min(engagement(i), 0.3) : 0.05;
  return Math.log10(10 + reach) * (1 + rate * 5);
}

export function extractKeywords(items: DiscoverItem[], opts: { query?: string; limit?: number } = {}): Keyword[] {
  const query = new Set(tokenise(opts.query ?? ""));
  const acc = new Map<string, { kind: Keyword["kind"]; score: number; count: number; views: number; viewsN: number; eng: number }>();
  const add = (term: string, kind: Keyword["kind"], i: DiscoverItem, w: number) => {
    const key = `${kind}:${term}`;
    const a = acc.get(key) ?? { kind, score: 0, count: 0, views: 0, viewsN: 0, eng: 0 };
    a.score += w;
    a.count += 1;
    if (i.views !== undefined) {
      a.views += i.views;
      a.viewsN += 1;
    }
    a.eng += engagement(i);
    acc.set(key, a);
  };

  for (const i of items) {
    const w = weight(i);
    for (const t of new Set(i.tags)) {
      const clean = t.replace(/^#/, "").trim();
      if (!clean) continue;
      // Multi-word YouTube tags read as phrases; single words become hashtags.
      if (clean.includes(" ")) add(clean, "phrase", i, w);
      else add(clean, "hashtag", i, w);
    }
    const toks = tokenise(`${i.title} ${i.text.slice(0, 600)}`);
    for (const t of new Set(toks)) if (!query.has(t)) add(t, "keyword", i, w);
    const pairs = new Set<string>();
    for (let k = 0; k + 1 < toks.length; k++) if (toks[k] !== toks[k + 1]) pairs.add(`${toks[k]} ${toks[k + 1]}`);
    for (const p of pairs) add(p, "phrase", i, w);
  }

  const list = [...acc.entries()]
    .map(([key, a]) => ({ term: key.slice(key.indexOf(":") + 1), ...a }))
    // A keyword or phrase has to appear in at least two posts to count as a pattern.
    .filter((a) => a.kind === "hashtag" || a.count >= 2)
    .sort((x, y) => y.score - x.score)
    .slice(0, opts.limit ?? 60);
  const top = list[0]?.score || 1;
  return list.map((a) => ({
    term: a.term,
    kind: a.kind,
    count: a.count,
    score: Math.round((a.score / top) * 100),
    avgViews: a.viewsN ? Math.round(a.views / a.viewsN) : undefined,
    avgEngagement: a.eng / a.count,
  }));
}

/** Per-post keywords for the detail view. */
export function itemKeywords(i: DiscoverItem, limit = 8) {
  const tags = [...new Set(i.tags.map((t) => t.replace(/^#/, "")))].filter((t) => !t.includes(" ")).slice(0, limit);
  const counts = new Map<string, number>();
  for (const t of tokenise(`${i.title} ${i.title} ${i.text.slice(0, 600)}`)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const words = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).filter((w) => !tags.includes(w)).slice(0, limit);
  return { hashtags: tags, keywords: words };
}
