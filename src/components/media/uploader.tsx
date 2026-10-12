"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadIcon } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import type { MediaItem } from "./types";

/** Reads dimensions/duration in the browser so the server doesn't need ffprobe for previews. */
function probe(file: File): Promise<{ width?: number; height?: number; durationMs?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (v: { width?: number; height?: number; durationMs?: number }) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      el.preload = "metadata";
      el.onloadedmetadata = () =>
        done({
          width: (el as HTMLVideoElement).videoWidth || undefined,
          height: (el as HTMLVideoElement).videoHeight || undefined,
          durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined,
        });
      el.onerror = () => done({});
      el.src = url;
    } else done({});
  });
}

function upload(file: File, meta: Record<string, number | undefined>, onProgress: (p: number) => void) {
  return new Promise<MediaItem>((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(meta)) if (v) fd.append(k, String(v));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const json = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) resolve(json);
      else reject(new Error(json.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(fd);
  });
}

export function MediaUploader({
  onUploaded,
  accept = "image/*,video/*,audio/*",
  compact,
}: {
  onUploaded: (item: MediaItem) => void;
  accept?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [jobs, setJobs] = useState<{ name: string; size: number; p: number }[]>([]);

  const handle = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        setJobs((j) => [...j, { name: file.name, size: file.size, p: 0 }]);
        try {
          const meta = await probe(file);
          const item = await upload(file, meta, (p) => setJobs((j) => j.map((x) => (x.name === file.name ? { ...x, p } : x))));
          onUploaded(item);
        } catch (e) {
          toast.error(`${file.name}: ${(e as Error).message}`);
        } finally {
          setJobs((j) => j.filter((x) => x.name !== file.name));
        }
      }
    },
    [onUploaded]
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) handle(e.dataTransfer.files);
        }}
        className={cn(
          "grain flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center transition-colors hover:border-foreground/40",
          compact ? "py-5" : "py-10",
          drag && "border-signal bg-signal/5"
        )}
      >
        <UploadIcon className="size-5 text-muted-foreground" strokeWidth={1.6} />
        <span className="text-sm font-medium">Drop files or click to upload</span>
        {!compact && <span className="font-mono text-[11px] text-muted-foreground">JPG · PNG · WEBP · MP4 · MOV · WEBM · MP3 · M4A · WAV</span>}
      </button>
      <input ref={input} type="file" multiple accept={accept} className="hidden" onChange={(e) => e.target.files && handle(e.target.files)} />
      {jobs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {jobs.map((j) => (
            <li key={j.name} className="rounded-xl border bg-card px-3 py-2">
              <div className="flex justify-between text-xs">
                <span className="truncate">{j.name}</span>
                <span className="font-mono text-muted-foreground">{formatBytes(j.size)}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-secondary">
                <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${Math.round(j.p * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
