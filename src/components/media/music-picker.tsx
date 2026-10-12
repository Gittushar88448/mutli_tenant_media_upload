"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLinkIcon, Loader2Icon, MusicIcon, PauseIcon, PlayIcon, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UpgradeHint } from "@/components/upgrade-hint";
import { importTrackAction, searchMusicAction } from "@/lib/actions/editor";
import type { Track } from "@/lib/media/music";
import { cn, formatDuration } from "@/lib/utils";
import type { MediaItem } from "./types";

const TAGS = [
  { id: "", label: "Trending" },
  { id: "pop", label: "Pop" },
  { id: "electronic", label: "Electronic" },
  { id: "hiphop", label: "Hip hop" },
  { id: "chillout", label: "Chill" },
  { id: "acoustic", label: "Acoustic" },
  { id: "cinematic", label: "Cinematic" },
  { id: "rock", label: "Rock" },
  { id: "lounge", label: "Lounge" },
  { id: "ambient", label: "Ambient" },
  { id: "dance", label: "Dance" },
];

/**
 * Search the music library, preview tracks and add one to the post. Picking a track copies
 * it into the media library with its licence, then hands it back.
 */
export function MusicPicker({ open, onOpenChange, onPicked, unlocked }: { open: boolean; onOpenChange: (o: boolean) => void; onPicked: (item: MediaItem) => void; unlocked: boolean }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [provider, setProvider] = useState<"jamendo" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const audio = useRef<HTMLAudioElement | null>(null);

  function load(next: { q?: string; tag?: string }) {
    startLoad(async () => {
      const r = await searchMusicAction(next);
      if (r.error) {
        setError(r.error);
        setTracks([]);
      } else {
        setError(null);
        setTracks(r.tracks ?? []);
        setProvider(r.provider ?? null);
      }
    });
  }

  useEffect(() => {
    if (open && unlocked && tracks === null) load({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unlocked]);

  function setOpen(o: boolean) {
    if (!o) {
      audio.current?.pause();
      setPlaying(null);
    }
    onOpenChange(o);
  }

  function toggle(t: Track) {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
    }
    if (playing === t.id) {
      audio.current.pause();
      setPlaying(null);
      return;
    }
    audio.current.src = t.previewUrl;
    audio.current.play().catch(() => toast.error("That preview couldn't play."));
    setPlaying(t.id);
  }

  async function pick(t: Track) {
    setAdding(t.id);
    const r = await importTrackAction(t.id);
    setAdding(null);
    if (r.error || !r.item) return toast.error(r.error ?? "That track couldn't be added.");
    onPicked(r.item);
    setOpen(false);
    toast.success(`Added ${t.title}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b p-5 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <MusicIcon className="size-4 text-signal" /> Music library
          </DialogTitle>
          <DialogDescription>
            Instagram and TikTok don&apos;t let other apps use their in-app songs, so these are Creative Commons tracks from Jamendo. The song is mixed into your video before it posts.
          </DialogDescription>
        </DialogHeader>
        {!unlocked ? (
          <div className="p-5">
            <UpgradeHint feature="mediaStudio" />
          </div>
        ) : (
          <>
            <form
              className="space-y-3 border-b p-5 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                load({ q, tag });
              }}
            >
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs, artists or moods" className="pl-8" aria-label="Search music" />
              </div>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {TAGS.map((t) => (
                  <button
                    key={t.id || "trending"}
                    type="button"
                    onClick={() => {
                      setTag(t.id);
                      load({ q, tag: t.id });
                    }}
                    className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs", tag === t.id ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </form>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {provider === "demo" && (
                <p className="border-b bg-muted/40 px-5 py-2.5 text-[12px] text-muted-foreground">
                  These are generated demo tracks. Add <code className="font-mono">JAMENDO_CLIENT_ID</code> on the server to search real songs.
                </p>
              )}
              {error && <p className="px-5 py-4 text-sm text-destructive">{error}</p>}
              {loading && !tracks?.length ? (
                <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" /> Finding tracks
                </div>
              ) : tracks?.length === 0 && !error ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No tracks match. Try another word or genre.</p>
              ) : (
                <ul className={cn("divide-y", loading && "opacity-60")}>
                  {tracks?.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-5 py-2.5" data-testid="music-track">
                      <button type="button" onClick={() => toggle(t)} aria-label={playing === t.id ? `Pause ${t.title}` : `Play ${t.title}`} className="relative size-10 shrink-0 overflow-hidden rounded-md bg-foreground text-background">
                        {t.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.image} alt="" className="absolute inset-0 size-full object-cover opacity-70" />
                        )}
                        <span className="relative flex size-full items-center justify-center">{playing === t.id ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}</span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t.artist} · {formatDuration(t.durationMs)} · {t.license}
                          {t.pageUrl && (
                            <a href={t.pageUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex align-middle hover:text-foreground" aria-label="Open on Jamendo">
                              <ExternalLinkIcon className="size-3" />
                            </a>
                          )}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" disabled={adding !== null} onClick={() => pick(t)}>
                        {adding === t.id ? <Loader2Icon className="animate-spin" /> : null} Use
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="border-t px-5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Check each track&apos;s licence before commercial use; it&apos;s saved with the file. For TikTok&apos;s trending sounds, post to TikTok as a draft and add the sound in the app.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
