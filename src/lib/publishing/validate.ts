/**
 * Confirm-time validation (runs on the client for instant feedback and again on the
 * server before anything is saved). Mirrors validate(target) from the connector interface.
 */
import { PLATFORMS, countHashtags, type TargetPlatform } from "@/lib/platforms";

export type ValidationMedia = { kind: "image" | "video" | "audio"; durationMs?: number | null; width?: number | null; height?: number | null };
export type ValidationTarget = {
  key: string; // social account id
  platform: TargetPlatform;
  postType: string;
  captionOverride?: string | null;
  options?: Record<string, unknown>;
  editSpec?: { trimStartMs?: number; trimEndMs?: number } | null;
};
export type ValidationPoll = { question?: string; options?: string[] };

export function validateTargets(input: { caption: string; media: ValidationMedia[]; targets: ValidationTarget[]; poll?: ValidationPoll }) {
  const errors: Record<string, string[]> = {};
  const visual = input.media.filter((m) => m.kind !== "audio");

  for (const t of input.targets) {
    const list: string[] = [];
    const spec = PLATFORMS[t.platform];
    const type = spec?.postTypes.find((p) => p.id === t.postType);
    if (!spec || !type) {
      errors[t.key] = ["Pick a post type"];
      continue;
    }
    const caption = (t.captionOverride ?? "").trim() || input.caption;
    const max = type.captionMax ?? spec.captionMax;
    const what = spec.category === "community" ? "Message" : "Caption";
    if (caption.length > max) list.push(`${what} is ${caption.length - max} characters over ${spec.name}'s ${max.toLocaleString()} limit${type.captionMax ? ` for ${type.label.toLowerCase()}` : ""}`);
    if (spec.hashtagMax && countHashtags(caption) > spec.hashtagMax) list.push(`${spec.name} allows at most ${spec.hashtagMax} hashtags`);

    if (type.id === "poll") {
      const q = input.poll?.question?.trim();
      const opts = (input.poll?.options ?? []).filter((o) => o.trim());
      if (!q) list.push("Write the poll question");
      if (opts.length < 2) list.push("A poll needs at least two answers");
      if (t.platform === "mastodon" && opts.length > 4) list.push("Mastodon polls take up to 4 answers");
      if (t.platform === "discord" && opts.some((o) => o.length > 55)) list.push("Discord poll answers can be at most 55 characters");
    } else if (type.id === "link") {
      const url = String(t.options?.url ?? "");
      if (!/^https?:\/\/\S+\.\S+/.test(url)) list.push("Link posts need a valid link");
    } else if (type.media === "none") {
      if (!caption.trim()) list.push(spec.category === "community" ? "Write the message" : "Text posts need a caption");
    } else {
      if (visual.length === 0) list.push(`${type.label} needs at least one photo or video`);
      if (type.media === "video" && visual.length > 0 && visual[0]!.kind !== "video") list.push(`${type.label} needs a video as the first item`);
      if (type.media === "image" && visual.some((m) => m.kind !== "image")) list.push(`${type.label} only takes photos`);
      const maxItems = type.maxItems ?? 1;
      if (visual.length > maxItems) list.push(`${type.label} takes ${maxItems === 1 ? "one item" : `up to ${maxItems} items`}`);
      if (type.minItems && visual.length > 0 && visual.length < type.minItems) list.push(`${type.label} needs at least ${type.minItems} items`);
      const video = visual.find((m) => m.kind === "video");
      if (video?.durationMs) {
        // A channel's own trim changes the length that platform sees.
        const start = t.editSpec?.trimStartMs ?? 0;
        const end = t.editSpec?.trimEndMs && t.editSpec.trimEndMs > start ? Math.min(t.editSpec.trimEndMs, video.durationMs) : video.durationMs;
        if (t.editSpec?.trimStartMs && t.editSpec.trimStartMs >= video.durationMs) list.push("The trim starts after the video ends");
        const sec = Math.max(0, end - start) / 1000;
        if (type.maxDurationSec && sec > type.maxDurationSec) list.push(`${type.label} videos can be at most ${fmtSec(type.maxDurationSec)}`);
        if (type.minDurationSec && sec < type.minDurationSec) list.push(`${type.label} videos must be at least ${type.minDurationSec} seconds`);
      }
      if (t.platform === "youtube" && t.postType === "short" && video?.width && video?.height && video.width > video.height) {
        list.push("Shorts need a vertical or square video");
      }
    }

    for (const field of spec.options) {
      const v = t.options?.[field.key];
      if (field.type !== "switch" && field.required && (v === undefined || v === null || String(v).trim() === "")) {
        list.push(`${field.label} is required`);
      }
      if (field.type === "text" && field.max && typeof v === "string" && v.length > field.max) {
        list.push(`${field.label} can be at most ${field.max} characters`);
      }
    }
    if (list.length) errors[t.key] = list;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

function fmtSec(s: number) {
  return s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
}
