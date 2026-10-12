"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  CheckIcon,
  CropIcon,
  DownloadIcon,
  EyeIcon,
  FlipHorizontal2Icon,
  FlipVertical2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  MusicIcon,
  PackageIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UpgradeHint } from "@/components/upgrade-hint";
import { MusicPicker } from "@/components/media/music-picker";
import { mediaUrl, type MediaItem } from "@/components/media/types";
import { CROP_RATIOS, NEUTRAL, SLIDERS, buildLut, colourIsNeutral, fullAdjust, parseCube, type Adjust, type Lut, type MediaEdit } from "@/lib/media/filters";
import { deleteCustomFilterAction, saveCustomFilterAction, saveEditAction, setPackInstalledAction } from "@/lib/actions/editor";
import { cn, formatDuration } from "@/lib/utils";
import { CropBox } from "./crop-box";
import { applyLook, drawCropped, drawOriented, fitCrop, orientedSize, sourceSize } from "./render-preview";

type Asset = { id: string; kind: "image" | "video"; filename: string; width?: number; height?: number; durationMs?: number; mime?: string };
type FilterOpt = { id: string; name: string; adjust: Adjust; hasLut?: boolean; lutSource?: string };
type Pack = { id: string; name: string; blurb: string; builtIn: boolean; installed: boolean; filters: FilterOpt[] };
type Track = Pick<MediaItem, "id" | "kind" | "filename" | "durationMs" | "createdAt">;

const PREVIEW_MAX = 1000;
const PLAY_MAX = 560;
const THUMB = 112;

export function MediaEditor({
  asset,
  filters,
  tracks: initialTracks,
  studio,
  canEdit,
}: {
  asset: Asset;
  filters: { packs: Pack[]; custom: FilterOpt[] };
  tracks: Track[];
  studio: boolean;
  canEdit: boolean;
  musicDemo?: boolean;
}) {
  const router = useRouter();
  const isVideo = asset.kind === "video";
  const [tab, setTab] = useState("crop");
  const [rotate, setRotate] = useState<MediaEdit["rotate"]>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [ratioId, setRatioId] = useState("free");
  const [crop, setCrop] = useState<NonNullable<MediaEdit["crop"]>>({ x: 0, y: 0, w: 1, h: 1 });
  const [trim, setTrim] = useState<[number, number]>([0, asset.durationMs ?? 0]);
  const [mute, setMute] = useState(false);
  const [adjust, setAdjust] = useState<Adjust>(NEUTRAL);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [baseLut, setBaseLut] = useState<Lut | null>(null);
  const [packs, setPacks] = useState(filters.packs);
  const [custom, setCustom] = useState(filters.custom);
  const [tracks, setTracks] = useState(initialTracks);
  const [musicId, setMusicId] = useState<string | null>(null);
  const [musicVolume, setMusicVolume] = useState(1);
  const [musicStartMs, setMusicStartMs] = useState(0);
  const [stillMs, setStillMs] = useState(15_000);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [dims, setDims] = useState({ w: asset.width ?? 1, h: asset.height ?? 1 });
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();
  const [, startAction] = useTransition();

  const sourceRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const orientedRef = useRef<HTMLCanvasElement | null>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const raf = useRef<number | null>(null);

  const oriented = orientedSize(dims.w, dims.h, rotate);
  const ratio = ratioId === "original" ? dims.w / dims.h : (CROP_RATIOS.find((r) => r.id === ratioId)?.ratio ?? null);
  const cropActive = crop.x > 0.0005 || crop.y > 0.0005 || crop.w < 0.9995 || crop.h < 0.9995;
  const lut = useMemo(() => (colourIsNeutral(adjust) && !baseLut ? null : buildLut(adjust, baseLut, 25)), [adjust, baseLut]);
  const track = tracks.find((t) => t.id === musicId);
  const clipMs = isVideo ? Math.max(0, trim[1] - trim[0]) : stillMs;

  // The file may finish loading before React hydrates and attaches onLoad.
  useEffect(() => {
    const el = sourceRef.current;
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) {
      setDims(sourceSize(el));
      setReady(true);
    } else if (el instanceof HTMLVideoElement && el.readyState >= 2) {
      setDims({ w: el.videoWidth, h: el.videoHeight });
      setReady(true);
    }
  }, []);

  /* ---------- Drawing ---------- */

  const draw = useCallback(
    (forPlayback = false) => {
      const el = sourceRef.current;
      const out = displayRef.current;
      if (!el || !out) return;
      if (!orientedRef.current) orientedRef.current = document.createElement("canvas");
      if (!drawOriented(orientedRef.current, el, { rotate, flipH, flipV }, forPlayback ? PLAY_MAX : PREVIEW_MAX)) return;
      if (tab === "crop" || comparing) {
        drawCropped(out, orientedRef.current, null);
        if (comparing && tab !== "crop") return;
      } else drawCropped(out, orientedRef.current, cropActive ? crop : null);
      if (!comparing && tab !== "crop") applyLook(out, adjust, lut, { sharpen: !forPlayback, seed: forPlayback ? (Date.now() & 0xffff) : 7 });
    },
    [rotate, flipH, flipV, tab, comparing, crop, cropActive, adjust, lut]
  );

  useEffect(() => {
    if (!ready || playing) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => draw());
  }, [draw, ready, playing]);

  // Video playback: redraw every frame at a lower resolution and loop inside the trim.
  useEffect(() => {
    const v = sourceRef.current;
    if (!playing || !(v instanceof HTMLVideoElement)) return;
    let stop = false;
    const loop = () => {
      if (stop) return;
      if (v.currentTime * 1000 >= trim[1] - 30) {
        v.currentTime = trim[0] / 1000;
        if (audioRef.current) audioRef.current.currentTime = musicStartMs / 1000;
      }
      draw(true);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => {
      stop = true;
    };
  }, [playing, draw, trim, musicStartMs]);

  function togglePlay() {
    const v = sourceRef.current;
    const a = audioRef.current;
    if (playing) {
      if (v instanceof HTMLVideoElement) v.pause();
      a?.pause();
      setPlaying(false);
      return;
    }
    if (v instanceof HTMLVideoElement) {
      if (v.currentTime * 1000 < trim[0] || v.currentTime * 1000 >= trim[1] - 50) v.currentTime = trim[0] / 1000;
      v.muted = mute;
      v.play().catch(() => {});
    }
    if (a && musicId) {
      a.currentTime = musicStartMs / 1000;
      a.volume = Math.min(1, musicVolume);
      a.play().catch(() => {});
    }
    setPlaying(true);
  }

  // Stop the music preview on its own for photos once the clip length has played.
  useEffect(() => {
    if (!playing || isVideo) return;
    const t = setTimeout(() => {
      audioRef.current?.pause();
      setPlaying(false);
    }, clipMs);
    return () => clearTimeout(t);
  }, [playing, isVideo, clipMs]);

  /* ---------- Filter thumbnails ---------- */

  const allFilters = useMemo(() => [...packs.filter((p) => p.installed).flatMap((p) => p.filters), ...custom], [packs, custom]);

  useEffect(() => {
    if (!ready || tab !== "filters" || !orientedRef.current) return;
    let cancelled = false;
    const base = document.createElement("canvas");
    const src = orientedRef.current;
    const c = cropActive ? crop : { x: 0, y: 0, w: 1, h: 1 };
    const side = Math.min(c.w * src.width, c.h * src.height);
    base.width = THUMB;
    base.height = THUMB;
    // A centred square of the current crop.
    base.getContext("2d")!.drawImage(src, c.x * src.width + (c.w * src.width - side) / 2, c.y * src.height + (c.h * src.height - side) / 2, side, side, 0, 0, THUMB, THUMB);
    const make = async () => {
      const next: Record<string, string> = { none: base.toDataURL("image/jpeg", 0.8) };
      for (const f of allFilters) {
        if (cancelled) return;
        const cv = document.createElement("canvas");
        cv.width = THUMB;
        cv.height = THUMB;
        cv.getContext("2d")!.drawImage(base, 0, 0);
        const fb = f.hasLut ? await loadBase(f.id).catch(() => null) : null;
        applyLook(cv, f.adjust, colourIsNeutral(f.adjust) && !fb ? null : buildLut(f.adjust, fb, 17), { seed: 3 });
        next[f.id] = cv.toDataURL("image/jpeg", 0.8);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancelled) setThumbs(next);
    };
    make();
    return () => {
      cancelled = true;
    };
  }, [ready, tab, allFilters, crop, cropActive, rotate, flipH, flipV]);

  async function chooseFilter(f: FilterOpt | null) {
    if (!f) {
      setFilterId(null);
      setBaseLut(null);
      setAdjust(NEUTRAL);
      return;
    }
    setFilterId(f.id);
    setAdjust(f.adjust);
    setBaseLut(f.hasLut ? await loadBase(f.id).catch(() => null) : null);
  }

  /* ---------- Crop helpers ---------- */

  function setRatio(id: string) {
    setRatioId(id);
    const r = id === "original" ? dims.w / dims.h : (CROP_RATIOS.find((x) => x.id === id)?.ratio ?? null);
    setCrop(id === "free" ? { x: 0, y: 0, w: 1, h: 1 } : (fitCrop(r, oriented.w, oriented.h) ?? { x: 0, y: 0, w: 1, h: 1 }));
  }

  function turn(dir: 1 | -1) {
    setRotate((r) => (((r + dir + 4) % 4) as MediaEdit["rotate"]));
    // The crop is relative to the rotated frame, so start it over.
    const o = orientedSize(dims.w, dims.h, rotate + dir);
    setCrop(ratioId === "free" ? { x: 0, y: 0, w: 1, h: 1 } : (fitCrop(ratio, o.w, o.h) ?? { x: 0, y: 0, w: 1, h: 1 }));
  }

  function resetAll() {
    setRotate(0);
    setFlipH(false);
    setFlipV(false);
    setRatioId("free");
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    setTrim([0, asset.durationMs ?? 0]);
    setMute(false);
    chooseFilter(null);
    setMusicId(null);
  }

  /* ---------- Save ---------- */

  function payload() {
    return {
      rotate,
      flipH,
      flipV,
      crop: cropActive ? crop : null,
      trimStartMs: isVideo && trim[0] > 0 ? Math.round(trim[0]) : undefined,
      trimEndMs: isVideo && asset.durationMs && trim[1] < asset.durationMs - 50 ? Math.round(trim[1]) : undefined,
      mute: isVideo ? mute : undefined,
      adjust,
      filterId,
      musicId,
      musicVolume: musicId ? musicVolume : undefined,
      musicStartMs: musicId ? Math.round(musicStartMs) : undefined,
      stillDurationMs: !isVideo && musicId ? stillMs : undefined,
    };
  }

  function save() {
    startSave(async () => {
      if (playing) togglePlay();
      const r = await saveEditAction(asset.id, payload());
      if (r.error || !r.item) {
        toast.error(r.error ?? "The edit couldn't be saved.");
        return;
      }
      toast.success("Saved as a new copy in your library");
      router.push(`/media?open=${r.item.id}`);
    });
  }

  /* ---------- Filter store and custom filters ---------- */

  function setInstalled(pack: Pack, installed: boolean) {
    startAction(async () => {
      const r = await setPackInstalledAction(pack.id, installed);
      if (r.error) return void toast.error(r.error);
      setPacks((ps) => ps.map((p) => (p.id === pack.id ? { ...p, installed } : p)));
      toast.success(installed ? `${pack.name} installed: ${pack.filters.length} filters` : `${pack.name} removed`);
    });
  }

  const [newName, setNewName] = useState("");
  function saveCustom() {
    startAction(async () => {
      const r = await saveCustomFilterAction({ name: newName || "My filter", adjust });
      if (r.error || !r.filter) return void toast.error(r.error ?? "Couldn't save the filter");
      setCustom((c) => [{ ...r.filter!, hasLut: false }, ...c]);
      setFilterId(r.filter.id);
      setNewName("");
      toast.success(`Saved “${r.filter.name}”`);
    });
  }

  async function importFile(file: File) {
    const text = await file.text();
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 40);
    let input: Record<string, unknown>;
    if (/\.relayfilter$|\.json$/i.test(file.name)) {
      try {
        const j = JSON.parse(text) as { relayFilter?: number; name?: string; adjust?: Partial<Adjust> };
        if (!j.relayFilter || !j.adjust) throw new Error();
        input = { name: (j.name ?? name).slice(0, 40), adjust: fullAdjust(j.adjust) };
      } catch {
        return void toast.error("That isn't a Relay filter file.");
      }
    } else {
      try {
        parseCube(text);
      } catch (e) {
        return void toast.error((e as Error).message);
      }
      input = { name, cube: text, cubeName: file.name };
    }
    startAction(async () => {
      const r = await saveCustomFilterAction(input);
      if (r.error || !r.filter) return void toast.error(r.error ?? "Couldn't import the filter");
      const f = { ...r.filter, hasLut: Boolean(input.cube), lutSource: input.cubeName as string | undefined };
      setCustom((c) => [f, ...c]);
      await chooseFilter(f);
      toast.success(`Imported “${f.name}”`);
    });
  }

  function removeCustom(f: FilterOpt) {
    startAction(async () => {
      const r = await deleteCustomFilterAction(f.id);
      if (r.error) return void toast.error(r.error);
      setCustom((c) => c.filter((x) => x.id !== f.id));
      if (filterId === f.id) chooseFilter(null);
    });
  }

  /* ---------- Layout ---------- */

  const changed = rotate || flipH || flipV || cropActive || (isVideo && (trim[0] > 0 || trim[1] < (asset.durationMs ?? 0) - 50 || mute)) || !colourIsNeutral(adjust) || adjust.vignette || adjust.sharpen || adjust.grain || filterId || musicId;
  const locked = (node: React.ReactNode) => (studio ? node : <div className="pointer-events-none opacity-45 select-none" aria-disabled>{node}</div>);
  const showCropBox = tab === "crop" && ready;
  const shownRatio = tab === "crop" || comparing || !cropActive ? oriented.w / oriented.h : (crop.w * oriented.w) / (crop.h * oriented.h);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to media">
            <Link href="/media">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="eyebrow">Media editor</p>
            <h1 className="truncate font-serif text-2xl">{asset.filename}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href={`${mediaUrl(asset.id)}?download=1`}>
              <DownloadIcon /> Original
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={resetAll} disabled={!changed || saving}>
            Reset
          </Button>
          <Button size="sm" onClick={save} disabled={!changed || saving || !canEdit} data-testid="save-edit">
            {saving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {saving ? (isVideo || musicId ? "Rendering" : "Saving") : "Save as new copy"}
          </Button>
        </div>
      </div>
      {!canEdit && <p className="text-sm text-muted-foreground">Viewers can try edits here but can&apos;t save them.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <div className="relative flex min-h-[280px] items-center justify-center overflow-hidden rounded-xl border bg-[oklch(0.16_0.025_265)] p-3 sm:p-6">
            {/* The real file is hidden; the canvas shows the edited preview. */}
            {isVideo ? (
              <video
                ref={(el) => {
                  sourceRef.current = el;
                }}
                src={mediaUrl(asset.id)}
                crossOrigin="anonymous"
                playsInline
                preload="auto"
                muted={mute}
                className="hidden"
                onLoadedData={(e) => {
                  const v = e.currentTarget;
                  setDims({ w: v.videoWidth, h: v.videoHeight });
                  if (!asset.durationMs && v.duration) setTrim([0, v.duration * 1000]);
                  setReady(true);
                }}
                onSeeked={() => !playing && draw()}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={(el) => {
                  sourceRef.current = el;
                }}
                src={mediaUrl(asset.id)}
                crossOrigin="anonymous"
                alt=""
                className="hidden"
                onLoad={(e) => {
                  const s = sourceSize(e.currentTarget);
                  setDims(s);
                  setReady(true);
                }}
              />
            )}
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
                <Loader2Icon className="size-4 animate-spin" /> Loading
              </div>
            )}
            <div className="relative" style={{ aspectRatio: shownRatio, width: `min(100%, calc(62vh * ${shownRatio}))` }}>
              <canvas ref={displayRef} className="block size-full" data-testid="editor-canvas" data-ready={ready ? "1" : undefined} />
              {showCropBox && <CropBox crop={crop} onChange={setCrop} ratio={ratio} aspect={oriented.w / oriented.h} />}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(isVideo || musicId) && (
              <Button variant="outline" size="sm" onClick={togglePlay} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <PauseIcon /> : <PlayIcon />} {playing ? "Pause" : isVideo ? "Play" : "Hear it"}
              </Button>
            )}
            {tab !== "crop" && (
              <Button
                variant="ghost"
                size="sm"
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                onKeyDown={(e) => e.key === " " && setComparing(true)}
                onKeyUp={() => setComparing(false)}
              >
                <EyeIcon /> Hold to compare
              </Button>
            )}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {Math.round((cropActive ? crop.w : 1) * oriented.w)}×{Math.round((cropActive ? crop.h : 1) * oriented.h)}
              {isVideo && ` · ${formatDuration(clipMs)}`}
            </span>
          </div>

          {isVideo && (
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <Label>Trim</Label>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {fmtMs(trim[0])} – {fmtMs(trim[1])}
                </span>
              </div>
              <Slider
                min={0}
                max={asset.durationMs ?? Math.max(trim[1], 1)}
                step={100}
                minStepsBetweenThumbs={5}
                value={trim}
                thumbLabels={["Trim start", "Trim end"]}
                onValueChange={(v) => {
                  const next = v as [number, number];
                  const v0 = sourceRef.current;
                  if (v0 instanceof HTMLVideoElement && !playing) v0.currentTime = (next[0] !== trim[0] ? next[0] : next[1]) / 1000;
                  setTrim(next);
                }}
              />
              <label className="mt-3 flex items-center gap-2 text-sm">
                <Switch checked={!mute} onCheckedChange={(v) => setMute(!v)} /> {mute ? <VolumeXIcon className="size-3.5" /> : <Volume2Icon className="size-3.5" />} Keep the video&apos;s own sound
              </label>
            </div>
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="crop">
              <CropIcon className="size-3.5" /> Crop
            </TabsTrigger>
            <TabsTrigger value="filters">
              <SparklesIcon className="size-3.5" /> Filters
            </TabsTrigger>
            <TabsTrigger value="adjust">
              <SlidersHorizontalIcon className="size-3.5" /> Adjust
            </TabsTrigger>
            <TabsTrigger value="music">
              <MusicIcon className="size-3.5" /> Music
            </TabsTrigger>
          </TabsList>

          <TabsContent value="crop" className="mt-4 space-y-5">
            <div>
              <p className="eyebrow mb-2">Aspect ratio</p>
              <div className="grid grid-cols-4 gap-1.5">
                {CROP_RATIOS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRatio(r.id)}
                    className={cn("rounded-lg border px-2 py-1.5 font-mono text-[11.5px]", ratioId === r.id ? "border-foreground bg-foreground text-background" : "hover:border-foreground/40")}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-muted-foreground">4:5 for Instagram feed, 9:16 for Reels, Shorts, TikTok and Stories, 1.91:1 for link cards and LinkedIn.</p>
            </div>
            <div>
              <p className="eyebrow mb-2">Rotate and flip</p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => turn(-1)} aria-label="Rotate left">
                  <RotateCcwIcon /> Left
                </Button>
                <Button variant="outline" size="sm" onClick={() => turn(1)} aria-label="Rotate right">
                  <RotateCwIcon /> Right
                </Button>
                <Button variant={flipH ? "default" : "outline"} size="sm" onClick={() => setFlipH((x) => !x)} aria-pressed={flipH}>
                  <FlipHorizontal2Icon /> Flip
                </Button>
                <Button variant={flipV ? "default" : "outline"} size="sm" onClick={() => setFlipV((x) => !x)} aria-pressed={flipV}>
                  <FlipVertical2Icon /> Flip
                </Button>
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">Drag the frame to move it and its corners to resize. Cropping, rotating and trimming are free on every plan.</p>
          </TabsContent>

          <TabsContent value="filters" className="mt-4 space-y-5">
            {!studio && <UpgradeHint feature="mediaStudio" />}
            {locked(
              <>
                <div className="grid grid-cols-3 gap-2">
                  <FilterTile name="Original" src={thumbs.none} active={!filterId && colourIsNeutral(adjust)} onClick={() => chooseFilter(null)} />
                  {allFilters.map((f) => (
                    <FilterTile key={f.id} name={f.name} src={thumbs[f.id]} active={filterId === f.id} onClick={() => chooseFilter(f)} lut={f.hasLut} />
                  ))}
                </div>

                <section>
                  <p className="eyebrow mb-2 flex items-center gap-1.5">
                    <PackageIcon className="size-3" /> Filter store
                  </p>
                  <ul className="divide-y rounded-xl border">
                    {packs
                      .filter((p) => !p.builtIn)
                      .map((p) => (
                        <li key={p.id} className="flex items-center gap-3 p-3" data-testid={`pack-${p.id}`}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {p.name} <span className="font-mono text-[10.5px] text-muted-foreground">{p.filters.length} filters</span>
                            </p>
                            <p className="text-[12px] text-muted-foreground">{p.blurb}</p>
                          </div>
                          <Button size="sm" variant={p.installed ? "ghost" : "outline"} onClick={() => setInstalled(p, !p.installed)}>
                            {p.installed ? "Remove" : "Install"}
                          </Button>
                        </li>
                      ))}
                  </ul>
                </section>

                <section>
                  <p className="eyebrow mb-2">Your filters</p>
                  {custom.length > 0 && (
                    <ul className="mb-3 divide-y rounded-xl border">
                      {custom.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                          <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => chooseFilter(f)}>
                            {f.name}
                            {f.hasLut && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">LUT</span>}
                          </button>
                          <FilterMenu id={f.id} onDelete={() => removeCustom(f)} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground">
                    <UploadIcon className="size-4" /> Import a .cube LUT or .relayfilter
                    <input
                      type="file"
                      accept=".cube,.relayfilter,.json"
                      className="sr-only"
                      data-testid="import-filter"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </section>
                {filterId && !filterId.startsWith("custom:") && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm">
                    <span className="truncate">{allFilters.find((f) => f.id === filterId)?.name}</span>
                    <FilterMenu id={filterId} />
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="adjust" className="mt-4 space-y-4">
            {!studio && <UpgradeHint feature="mediaStudio" />}
            {locked(
              <>
                {SLIDERS.map((s) => (
                  <div key={s.key} className="grid grid-cols-[88px_1fr_36px] items-center gap-3">
                    <Label className="text-[13px] font-normal">{s.label}</Label>
                    <Slider
                      min={s.min}
                      max={s.max}
                      step={1}
                      value={[adjust[s.key] as number]}
                      aria-label={s.label}
                      onValueChange={([v]) => {
                        setAdjust((a) => ({ ...a, [s.key]: v }));
                      }}
                      onDoubleClick={() => setAdjust((a) => ({ ...a, [s.key]: 0 }))}
                    />
                    <span className="text-right font-mono text-[11px] text-muted-foreground tabular-nums">{adjust[s.key] as number}</span>
                  </div>
                ))}
                <div className="grid grid-cols-[88px_1fr] items-center gap-3">
                  <Label className="text-[13px] font-normal">Split tone</Label>
                  <div className="flex items-center gap-2">
                    <ColourInput label="Shadows" value={adjust.splitShadow} onChange={(v) => setAdjust((a) => ({ ...a, splitShadow: v, split: a.split || 30 }))} />
                    <ColourInput label="Highlights" value={adjust.splitHighlight} onChange={(v) => setAdjust((a) => ({ ...a, splitHighlight: v, split: a.split || 30 }))} />
                    <Slider min={0} max={100} value={[adjust.split]} aria-label="Split tone strength" onValueChange={([v]) => setAdjust((a) => ({ ...a, split: v ?? 0 }))} />
                  </div>
                </div>
                <div className="flex gap-2 border-t pt-4">
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name this look" maxLength={40} aria-label="Filter name" />
                  <Button variant="outline" onClick={saveCustom} disabled={colourIsNeutral(adjust) && !adjust.vignette && !adjust.grain && !adjust.sharpen}>
                    Save filter
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => chooseFilter(null)}>
                  Reset adjustments
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="music" className="mt-4 space-y-4">
            {!studio && <UpgradeHint feature="mediaStudio" />}
            {locked(
              <>
                <div className="grid gap-2">
                  <Label>Song</Label>
                  <Select value={musicId ?? "none"} onValueChange={(v) => setMusicId(v === "none" ? null : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No music</SelectItem>
                      {tracks.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => setPickerOpen(true)}>
                    <MusicIcon /> Browse the music library
                  </Button>
                </div>
                {musicId && (
                  <>
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label>Start the song at</Label>
                        <span className="font-mono text-[11px] text-muted-foreground">{fmtMs(musicStartMs)}</span>
                      </div>
                      <Slider min={0} max={Math.max(0, (track?.durationMs ?? 0) - Math.min(clipMs, track?.durationMs ?? 0))} step={500} value={[musicStartMs]} aria-label="Song start" onValueChange={([v]) => setMusicStartMs(v ?? 0)} />
                    </div>
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label>Volume</Label>
                        <span className="font-mono text-[11px] text-muted-foreground">{Math.round(musicVolume * 100)}%</span>
                      </div>
                      <Slider min={0} max={200} step={5} value={[musicVolume * 100]} aria-label="Song volume" onValueChange={([v]) => setMusicVolume((v ?? 100) / 100)} />
                    </div>
                    {!isVideo && (
                      <div className="grid gap-2">
                        <Label>Length</Label>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[5_000, 10_000, 15_000, 30_000].map((ms) => (
                            <button key={ms} type="button" onClick={() => setStillMs(ms)} className={cn("rounded-lg border px-2 py-1.5 font-mono text-[11.5px]", stillMs === ms ? "border-foreground bg-foreground text-background" : "hover:border-foreground/40")}>
                              {ms / 1000}s
                            </button>
                          ))}
                        </div>
                        <p className="text-[11.5px] text-muted-foreground">A photo with a song is saved as a short MP4, so it can go out as a Reel, Short or TikTok.</p>
                      </div>
                    )}
                    <audio ref={audioRef} src={mediaUrl(musicId)} preload="auto" className="hidden" />
                  </>
                )}
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Instagram and TikTok keep their song catalogues inside their own apps, so no outside app can add those songs. Relay mixes the track into the file instead.
                </p>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <MusicPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        unlocked={studio}
        onPicked={(item) => {
          setTracks((t) => (t.some((x) => x.id === item.id) ? t : [{ ...item, filename: (item.filename ?? "Track").replace(/\.mp3$/i, "") }, ...t]));
          setMusicId(item.id);
          setMusicStartMs(0);
        }}
      />
    </div>
  );
}

const baseCache = new Map<string, Promise<Lut>>();
function loadBase(id: string) {
  if (!baseCache.has(id)) {
    baseCache.set(
      id,
      fetch(`/api/filters/${encodeURIComponent(id)}?format=base`).then(async (r) => {
        if (!r.ok) throw new Error("LUT not found");
        return parseCube(await r.text());
      })
    );
  }
  return baseCache.get(id)!;
}

function fmtMs(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

function FilterTile({ name, src, active, onClick, lut }: { name: string; src?: string; active: boolean; onClick: () => void; lut?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="group text-left" aria-pressed={active} data-testid="filter-tile">
      <div className={cn("relative aspect-square overflow-hidden rounded-xl border-2 bg-muted", active ? "border-signal" : "border-transparent group-hover:border-foreground/30")}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="size-full object-cover" />
        )}
        {lut && <span className="absolute right-1 bottom-1 rounded-[5px] bg-black/70 px-1 font-mono text-[9px] text-white">LUT</span>}
      </div>
      <p className={cn("mt-1 truncate text-[11.5px]", active ? "font-medium" : "text-muted-foreground")}>{name}</p>
    </button>
  );
}

function FilterMenu({ id, onDelete }: { id: string; onDelete?: () => void }) {
  const href = (format: string) => `/api/filters/${encodeURIComponent(id)}?format=${format}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Filter options">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={href("cube")}>
            <DownloadIcon /> Download .cube LUT
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href("relay")}>
            <DownloadIcon /> Download .relayfilter
          </a>
        </DropdownMenuItem>
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColourInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border" title={label} style={{ background: value || "repeating-conic-gradient(#999 0 25%, transparent 0 50%) 50% / 8px 8px" }}>
      <input type="color" aria-label={`${label} colour`} value={value || "#808080"} onChange={(e) => onChange(e.target.value)} className="sr-only" />
    </label>
  );
}
