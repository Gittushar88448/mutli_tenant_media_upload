import type { PipelineStage } from "mongoose";

/** Parses ?page=&size=&sort=&dir=&q= into safe values for server-side data tables. */
export type TableParams = { page: number; size: number; sort: string; dir: 1 | -1; q: string; filters: Record<string, string[]> };

export function parseTableParams(
  sp: Record<string, string | string[] | undefined>,
  opts: { sortable: string[]; defaultSort: string; filterKeys?: string[] }
): TableParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const page = Math.max(1, parseInt(one("page") || "1", 10) || 1);
  const size = [10, 20, 50, 100].includes(parseInt(one("size"), 10)) ? parseInt(one("size"), 10) : 20;
  const sort = opts.sortable.includes(one("sort")) ? one("sort") : opts.defaultSort;
  const dir = one("dir") === "asc" ? 1 : -1;
  const q = one("q").slice(0, 100);
  const filters: Record<string, string[]> = {};
  for (const k of opts.filterKeys ?? []) {
    const v = one(k);
    if (v) filters[k] = v.split(",").filter(Boolean).slice(0, 20);
  }
  return { page, size, sort, dir, q, filters };
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Standard tail for paginated aggregations: one round trip returns the page and the total. */
export function paginate(p: TableParams): PipelineStage[] {
  return [
    { $sort: { [p.sort]: p.dir, _id: 1 as const } },
    {
      $facet: {
        rows: [{ $skip: (p.page - 1) * p.size }, { $limit: p.size }],
        total: [{ $count: "n" }],
      },
    },
    { $project: { rows: 1, total: { $ifNull: [{ $first: "$total.n" }, 0] } } },
  ];
}
