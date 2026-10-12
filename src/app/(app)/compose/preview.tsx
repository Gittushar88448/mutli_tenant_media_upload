import { HeartIcon, MessageCircleIcon, SendIcon, BookmarkIcon, ThumbsUpIcon, Share2Icon } from "lucide-react";
import { MediaThumb } from "@/components/media/thumb";
import type { MediaItem } from "@/components/media/types";
import { PlatformIcon } from "@/components/platform-icon";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/** Rough per-platform preview so the shape of the post is obvious before confirming. */
export function Preview({
  account,
  postType,
  caption,
  media,
  title,
}: {
  account?: { platform: string; handle: string };
  postType?: string;
  caption: string;
  media: MediaItem[];
  title?: string;
}) {
  if (!account) {
    return <div className="grain flex aspect-[9/14] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">Pick a channel to preview</div>;
  }
  const vertical = ["reel", "short", "story"].includes(postType ?? "") || (account.platform === "tiktok" && postType === "video");
  const spec = PLATFORMS[account.platform as TargetPlatform];
  const first = media[0];

  if (vertical) {
    return (
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-[22px] border-[6px] border-foreground bg-black text-white shadow-[0_30px_60px_-30px_rgb(0_0_0/0.5)]">
        {first ? <MediaThumb item={first} className="absolute inset-0" /> : <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">No media</div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-16">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <PlatformIcon platform={account.platform} tone="chip" className="size-5 rounded-full p-[3px]" />
            {account.handle}
          </div>
          {title && <p className="mt-1 text-[13px] font-semibold">{title}</p>}
          <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-white/90">{caption || "Caption appears here"}</p>
        </div>
        <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4 text-white/90 [&_svg]:size-5">
          <HeartIcon />
          <MessageCircleIcon />
          <SendIcon />
        </div>
        <span className="absolute top-3 left-3 rounded-[3px] bg-white/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider backdrop-blur">
          {spec.postTypes.find((p) => p.id === postType)?.label}
        </span>
      </div>
    );
  }

  const landscape = account.platform === "youtube";
  const limit = spec.captionMax;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[0_20px_50px_-30px_rgb(0_0_0/0.35)]">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <PlatformIcon platform={account.platform} tone="chip" className="size-7 rounded-full p-1.5" />
        <div className="leading-tight">
          <p className="text-[13px] font-semibold">{account.handle}</p>
          <p className="font-mono text-[10px] text-muted-foreground uppercase">{spec.postTypes.find((p) => p.id === postType)?.label ?? spec.name}</p>
        </div>
      </div>
      {postType !== "text" &&
        (first ? (
          <div className="relative">
            <MediaThumb item={first} className={cn("w-full", landscape ? "aspect-video" : "aspect-[4/5]")} />
            {media.length > 1 && <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white">1/{media.length}</span>}
          </div>
        ) : (
          <div className={cn("flex w-full items-center justify-center bg-secondary text-xs text-muted-foreground", landscape ? "aspect-video" : "aspect-[4/5]")}>No media</div>
        ))}
      <div className="space-y-1.5 px-3 py-3">
        {title && <p className="text-[14px] font-semibold leading-snug">{title}</p>}
        <p className="line-clamp-4 text-[13px] leading-snug whitespace-pre-wrap">
          {caption.slice(0, limit) || <span className="text-muted-foreground">Caption appears here</span>}
          {caption.length > limit && <span className="bg-signal/25 text-signal">{caption.slice(limit, limit + 40)}…</span>}
        </p>
        <div className="flex gap-4 pt-1 text-muted-foreground [&_svg]:size-4">
          {account.platform === "facebook" || account.platform === "linkedin" ? (
            <>
              <ThumbsUpIcon />
              <MessageCircleIcon />
              <Share2Icon />
            </>
          ) : (
            <>
              <HeartIcon />
              <MessageCircleIcon />
              <SendIcon />
              <BookmarkIcon className="ml-auto" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
