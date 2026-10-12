"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { DownloadIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import Link from "next/link";
import { MediaUploader } from "@/components/media/uploader";
import { MediaThumb } from "@/components/media/thumb";
import type { MediaItem } from "@/components/media/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { deleteMediaAction } from "@/lib/actions/media";
import { formatBytes, formatDuration } from "@/lib/utils";
import { mediaUrl } from "@/components/media/types";

type Item = MediaItem & { uses?: number; edited?: boolean; license?: string };

export function MediaLibrary({ initial, openId, canEdit }: { initial: Item[]; openId?: string; canEdit: boolean }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState("all");
  // ?open=<id> opens a file's sheet, e.g. a copy just saved from the editor.
  const [open, setOpen] = useState<Item | null>(() => initial.find((i) => i.id === openId) ?? null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const shown = useMemo(() => (filter === "all" ? items : items.filter((i) => i.kind === filter)), [items, filter]);
  const counts = useMemo(() => ({ video: items.filter((i) => i.kind === "video").length, image: items.filter((i) => i.kind === "image").length, audio: items.filter((i) => i.kind === "audio").length }), [items]);

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <div className="space-y-4">
        <MediaUploader
          onUploaded={(m) => {
            setItems((x) => [{ ...m, uses: 0 }, ...x]);
            toast.success(`${m.filename} uploaded`);
            router.refresh();
          }}
        />
        <div className="rounded-md border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="eyebrow mb-2">Specs that travel well</p>
          <p>
            Vertical 9:16 MP4 (H.264, AAC) at 1080×1920 works for Reels, Shorts and TikTok. Use 4:5 photos for Instagram feed and 16:9 for YouTube videos.
          </p>
        </div>
      </div>
      <div>
        <div className="mb-4 flex items-center justify-between">
          <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v)}>
            <ToggleGroupItem value="all">All {items.length}</ToggleGroupItem>
            <ToggleGroupItem value="video">Video {counts.video}</ToggleGroupItem>
            <ToggleGroupItem value="image">Photo {counts.image}</ToggleGroupItem>
            <ToggleGroupItem value="audio">Audio {counts.audio}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {shown.length === 0 ? (
          <div className="rounded-md border border-dashed p-16 text-center">
            <p className="font-serif text-2xl">Nothing here yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Upload a video, photo or audio track to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((m) => (
              <button key={m.id} onClick={() => setOpen(m)} className="group text-left">
                <MediaThumb item={m} className="aspect-[4/5] rounded-md border transition-transform group-hover:-translate-y-0.5" />
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs">{m.filename}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground uppercase">{m.kind}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="truncate pr-8">{open.filename}</SheetTitle>
                <SheetDescription>
                  {open.edited ? "Saved from the editor" : "Uploaded"} {format(new Date(open.createdAt), "d MMM yyyy, HH:mm")}
                </SheetDescription>
              </SheetHeader>
              <div className="px-5">
                {open.kind === "video" ? (
                  <video src={mediaUrl(open.id)} controls className="max-h-[50vh] w-full rounded-md bg-black" />
                ) : open.kind === "audio" ? (
                  <audio src={mediaUrl(open.id)} controls className="w-full" />
                ) : (
                  <MediaThumb item={open} fit="contain" className="max-h-[50vh] rounded-md" />
                )}
                <dl className="mt-5 grid grid-cols-2 gap-y-3 text-sm">
                  <dt className="eyebrow">Type</dt>
                  <dd className="font-mono text-xs">{open.mime}</dd>
                  <dt className="eyebrow">Size</dt>
                  <dd className="font-mono text-xs">{formatBytes(open.sizeBytes ?? 0)}</dd>
                  {open.width && (
                    <>
                      <dt className="eyebrow">Dimensions</dt>
                      <dd className="font-mono text-xs">
                        {open.width}×{open.height}
                      </dd>
                    </>
                  )}
                  {open.durationMs && (
                    <>
                      <dt className="eyebrow">Duration</dt>
                      <dd className="font-mono text-xs">{formatDuration(open.durationMs)}</dd>
                    </>
                  )}
                  <dt className="eyebrow">Used in</dt>
                  <dd className="font-mono text-xs">{open.uses ?? 0} posts</dd>
                  {open.license && (
                    <>
                      <dt className="eyebrow">Licence</dt>
                      <dd className="text-xs break-words text-muted-foreground">{open.license.split(" ").slice(1).join(" ")}</dd>
                    </>
                  )}
                </dl>
              </div>
              <div className="mt-auto space-y-2 border-t p-5">
                <div className="grid grid-cols-2 gap-2">
                  {open.kind !== "audio" && canEdit ? (
                    <Button asChild>
                      <Link href={`/media/${open.id}/edit`}>
                        <WandSparklesIcon /> Edit
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild variant="outline" className={open.kind === "audio" || !canEdit ? "col-span-2" : undefined}>
                    <a href={`${mediaUrl(open.id)}?download=1`}>
                      <DownloadIcon /> Download
                    </a>
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full text-destructive"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteMediaAction(open.id);
                      if (r.error) toast.error(r.error);
                      else {
                        setItems((x) => x.filter((i) => i.id !== open.id));
                        setOpen(null);
                        toast.success("Deleted");
                      }
                    })
                  }
                >
                  <Trash2Icon /> Delete file
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
