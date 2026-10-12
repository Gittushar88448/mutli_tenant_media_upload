import { randomBytes } from "node:crypto";

export function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "workspace";
  return `${base}-${randomBytes(3).toString("hex")}`;
}
