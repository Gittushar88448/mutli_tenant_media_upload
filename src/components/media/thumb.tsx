import { AudioLinesIcon } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { mediaUrl, type MediaItem } from "./types";

export function MediaThumb({ item, className, fit = "cover" }: { item: Pick<MediaItem, "id" | "kind" | "durationMs" | "filename">; className?: string; fit?: "cover" | "contain" }) {
  return (
    <div className={cn("relative overflow-hidden bg-secondary", className)}>
      {item.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl(item.id)} alt={item.filename ?? ""} loading="lazy" className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")} />
      )}
      {item.kind === "video" && (
        <video src={`${mediaUrl(item.id)}#t=0.5`} muted playsInline preload="metadata" className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")} />
      )}
      {item.kind === "audio" && (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-foreground text-background">
          <AudioLinesIcon className="size-7 text-signal" strokeWidth={1.5} />
          <span className="max-w-[90%] truncate px-2 font-mono text-[10.5px] opacity-70">{item.filename}</span>
        </div>
      )}
      {item.durationMs ? (
        <span className="absolute right-1.5 bottom-1.5 rounded-[6px] bg-black/70 px-1 font-mono text-[10px] text-white">{formatDuration(item.durationMs)}</span>
      ) : null}
    </div>
  );
}
