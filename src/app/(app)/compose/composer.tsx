"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, format } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CheckIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  ImagePlusIcon,
  Loader2Icon,
  LockIcon,
  MusicIcon,
  PlusIcon,
  ScissorsIcon,
  UsersIcon,
  VoteIcon,
  SendIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { PLATFORMS, POLL_DURATIONS, countHashtags, type TargetPlatform } from "@/lib/platforms";
import { PLAN_INFO, planFor, type Feature } from "@/lib/plans";
import { UpgradeHint } from "@/components/upgrade-hint";
import { validateTargets } from "@/lib/publishing/validate";
import { savePostAction, type ComposePayload } from "@/lib/actions/posts";
import { PlatformIcon } from "@/components/platform-icon";
import { MediaThumb } from "@/components/media/thumb";
import { MediaUploader } from "@/components/media/uploader";
import { MusicPicker } from "@/components/media/music-picker";
import type { MediaItem } from "@/components/media/types";
import { SectionTitle } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isPast } from "@/lib/time";
import { Preview } from "./preview";

type Account = { id: string; platform: string; handle: string; displayName?: string; sandbox: boolean; status: string; category: string; audienceSize?: number };
type EditSpec = { crop?: string; trimStartMs?: number; trimEndMs?: number; audioTrackId?: string; audioVolume?: number; keepOriginalAudio?: boolean };
/** editSpec undefined means "same cut as the post". */
type TargetState = { postType: string; captionOverride: string; options: Record<string, unknown>; editSpec?: EditSpec };
type MediaSel = { assetId: string; audioTrackId?: string; editSpec: Record<string, unknown> };
export type Poll = { question: string; options: string[]; allowMultiple: boolean; durationHours: number };

export type ComposerInitial = {
  postId?: string;
  title: string;
  caption: string;
  scheduledAt?: string;
  media: MediaSel[];
  targets: { accountId: string; postType: string; captionOverride: string; options: Record<string, unknown>; editSpec?: EditSpec }[];
  poll?: Poll;
};

function defaultTarget(platform: string, hasVideo: boolean, mediaCount: number): TargetState {
  const spec = PLATFORMS[platform as TargetPlatform];
  const types = spec.postTypes;
  let pick = (hasVideo && types.find((t) => t.media === "video")) || types.find((t) => t.media === "any") || types[0]!;
  if (spec.category === "community" || platform === "reddit") {
    // Messages by default; attach media when the post has some.
    const withMedia = mediaCount > 1 ? (types.find((t) => t.id === "album") ?? types.find((t) => t.id === "media")) : types.find((t) => t.id === "media");
    pick = (mediaCount > 0 && withMedia) || types[0]!;
  }
  const options: Record<string, unknown> = {};
  for (const f of spec.options) {
    if (f.type === "select" && !f.noDefault) options[f.key] = f.options[0]!.value;
    if (f.type === "switch") options[f.key] = f.key === "shareToFeed";
  }
  return { postType: pick.id, captionOverride: "", options };
}

export function Composer({
  accounts,
  library: initialLibrary,
  timezone,
  needsApproval,
  initial,
  features,
}: {
  accounts: Account[];
  library: MediaItem[];
  timezone: string;
  needsApproval: boolean;
  initial?: ComposerInitial;
  features: Record<Feature, boolean>;
}) {
  const router = useRouter();
  const [library, setLibrary] = useState(initialLibrary);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [caption, setCaption] = useState(initial?.caption ?? "");
  const [media, setMedia] = useState<MediaSel[]>(initial?.media ?? []);
  const [targets, setTargets] = useState<Record<string, TargetState>>(() =>
    Object.fromEntries((initial?.targets ?? []).map((t) => [t.accountId, { postType: t.postType, captionOverride: t.captionOverride, options: t.options, editSpec: t.editSpec }]))
  );
  const [poll, setPoll] = useState<Poll>(initial?.poll ?? { question: "", options: ["", ""], allowMultiple: false, durationHours: 24 });
  const [active, setActive] = useState<string | undefined>(initial?.targets[0]?.accountId);
  const [when, setWhen] = useState<"now" | "later">(initial?.scheduledAt ? "later" : "now");
  const initialLocal = initial?.scheduledAt ? new Date(initial.scheduledAt) : addDays(new Date(), 1);
  const [date, setDate] = useState<Date>(initialLocal);
  const [time, setTime] = useState(initial?.scheduledAt ? formatInTimeZone(initialLocal, timezone, "HH:mm") : "09:00");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(library.map((m) => [m.id, m])), [library]);
  const mediaItems = media.map((m) => byId.get(m.assetId)).filter(Boolean) as MediaItem[];
  const hasVideo = mediaItems.some((m) => m.kind === "video");
  const audioTracks = library.filter((m) => m.kind === "audio");
  const selectedAccounts = accounts.filter((a) => targets[a.id]);
  const activeAccount = selectedAccounts.find((a) => a.id === active) ?? selectedAccounts[0];

  const usesPoll = selectedAccounts.some((a) => targets[a.id]?.postType === "poll");
  const validation = validateTargets({
    caption,
    media: mediaItems.map((m) => ({ kind: m.kind, durationMs: m.durationMs, width: m.width, height: m.height })),
    targets: selectedAccounts.map((a) => ({ key: a.id, platform: a.platform as TargetPlatform, ...targets[a.id]!, editSpec: targets[a.id]!.editSpec ?? (media[0]?.editSpec as EditSpec) })),
    poll,
  });
  const errors = { ...validation.errors, ...serverErrors };

  const scheduledAt = useMemo(() => {
    if (when === "now") return undefined;
    try {
      return fromZonedTime(`${format(date, "yyyy-MM-dd")}T${time}:00`, timezone);
    } catch {
      return undefined;
    }
  }, [when, date, time, timezone]);
  const inPast = scheduledAt ? isPast(scheduledAt) : false;

  function toggleAccount(a: Account) {
    setServerErrors({});
    setTargets((t) => {
      const next = { ...t };
      if (next[a.id]) delete next[a.id];
      else next[a.id] = defaultTarget(a.platform, hasVideo, mediaItems.filter((m) => m.kind !== "audio").length);
      return next;
    });
    if (!targets[a.id]) setActive(a.id);
  }

  function patchTarget(id: string, patch: Partial<TargetState>) {
    setTargets((t) => ({ ...t, [id]: { ...t[id]!, ...patch } }));
  }

  function payload(mode: ComposePayload["mode"]): ComposePayload {
    return {
      postId: initial?.postId,
      mode,
      title: title || undefined,
      caption,
      scheduledAt: mode === "schedule" ? scheduledAt?.toISOString() : undefined,
      media: media.map((m) => ({ assetId: m.assetId, audioTrackId: m.audioTrackId, editSpec: m.editSpec as never })),
      targets: selectedAccounts.map((a) => ({
        accountId: a.id,
        platform: a.platform,
        postType: targets[a.id]!.postType,
        captionOverride: targets[a.id]!.captionOverride || undefined,
        options: targets[a.id]!.options,
        editSpec: targets[a.id]!.editSpec as ComposePayload["targets"][number]["editSpec"],
      })),
      poll: usesPoll ? { ...poll, options: poll.options.map((o) => o.trim()).filter(Boolean) } : undefined,
    };
  }

  function submit(mode: ComposePayload["mode"]) {
    start(async () => {
      const r = await savePostAction(payload(mode));
      if (!r.ok) {
        if (r.upgrade) toast.error(r.error, { action: { label: "See plans", onClick: () => router.push("/billing") } });
        else toast.error(r.error);
        if (r.targetErrors) setServerErrors(r.targetErrors);
        setConfirmOpen(false);
        return;
      }
      toast.success(r.message);
      router.push(`/posts/${r.postId}`);
    });
  }

  const visual = mediaItems.filter((m) => m.kind !== "audio");

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-10">
        <div className="flex flex-col gap-1 border-b pb-6">
          <p className="eyebrow">{initial?.postId ? "Editing post" : "New post"}</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled post"
            className="display w-full bg-transparent text-[44px] outline-none placeholder:text-muted-foreground/40 md:text-[52px]"
            maxLength={140}
          />
          <p className="text-xs text-muted-foreground">An internal title for your queue and calendar. It isn&apos;t published.</p>
        </div>

        {/* 01 Channels */}
        <section>
          <SectionTitle n="01" aside={<span className="font-mono text-[11px] text-muted-foreground">{selectedAccounts.length} selected</span>}>
            Channels
          </SectionTitle>
          {[
            { key: "social", label: "Social feeds", list: accounts.filter((a) => a.category !== "community") },
            { key: "community", label: "Communities & messaging", list: accounts.filter((a) => a.category === "community") },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
          <div key={g.key} className="mb-4 last:mb-0">
          <p className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] tracking-wider text-muted-foreground uppercase">
            {g.key === "community" && <UsersIcon className="size-3" />} {g.label}
          </p>
          <div className="flex flex-wrap gap-2">
            {g.list.map((a) => {
              const on = !!targets[a.id];
              const bad = a.status !== "active";
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={bad}
                  aria-pressed={on}
                  onClick={() => toggleAccount(a)}
                  className={cn(
                    "group flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-[13px] transition-all disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "border-foreground bg-foreground text-background" : "hover:border-foreground/40"
                  )}
                  title={bad ? "Reconnect this channel first" : undefined}
                >
                  <PlatformIcon platform={a.platform} tone="chip" className="size-6 rounded-full p-1" />
                  <span className="max-w-[160px] truncate">{a.handle}</span>
                  {a.audienceSize ? <span className="font-mono text-[10px] opacity-60">{compact(a.audienceSize)}</span> : null}
                  {a.sandbox && <FlaskConicalIcon className="size-3 opacity-60" />}
                  {on ? <CheckIcon className="size-3.5 text-signal" /> : null}
                  {errors[a.id] && <span className="size-1.5 rounded-full bg-signal" />}
                </button>
              );
            })}
          </div>
          </div>
            ))}
        </section>

        {/* 02 Media */}
        <section>
          <SectionTitle
            n="02"
            aside={
              <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)}>
                <ImagePlusIcon /> Add media
              </Button>
            }
          >
            Media
          </SectionTitle>
          {visual.length === 0 ? (
            <button type="button" onClick={() => setPickerOpen(true)} className="grain flex w-full items-center justify-center gap-3 rounded-xl border border-dashed py-10 text-sm text-muted-foreground hover:border-foreground/40">
              <ImagePlusIcon className="size-5" strokeWidth={1.6} /> Choose a video or photos from the library, or upload new ones
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-3 overflow-x-auto pb-2">
                {media.map((m, i) => {
                  const item = byId.get(m.assetId);
                  if (!item || item.kind === "audio") return null;
                  return (
                    <div key={m.assetId} className="relative w-32 shrink-0">
                      <MediaThumb item={item} className="aspect-[9/16] rounded-xl border" />
                      <span className="absolute top-1.5 left-1.5 rounded-[6px] bg-black/70 px-1 font-mono text-[10px] text-white">{String(i + 1).padStart(2, "0")}</span>
                      <div className="absolute top-1 right-1 flex flex-col gap-1">
                        <IconBtn label="Remove" onClick={() => setMedia((x) => x.filter((y) => y.assetId !== m.assetId))}>
                          <XIcon />
                        </IconBtn>
                        {i > 0 && (
                          <IconBtn label="Move up" onClick={() => setMedia((x) => swap(x, i, i - 1))}>
                            <ArrowUpIcon />
                          </IconBtn>
                        )}
                        {i < media.length - 1 && (
                          <IconBtn label="Move down" onClick={() => setMedia((x) => swap(x, i, i + 1))}>
                            <ArrowDownIcon />
                          </IconBtn>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {hasVideo && (
                <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[1.4fr_1fr_1fr]">
                  <TrimFields
                    className="md:col-span-3"
                    durationMs={mediaItems.find((m) => m.kind === "video")?.durationMs}
                    spec={(media[0]?.editSpec ?? {}) as EditSpec}
                    onChange={(patch) => setMedia((x) => x.map((m, i) => (i === 0 ? { ...m, editSpec: { ...m.editSpec, ...patch } } : m)))}
                  />
                  <div className="grid gap-2">
                    <Label className="flex items-center gap-1.5">
                      <MusicIcon className="size-3.5" /> Soundtrack
                    </Label>
                    <Select
                      value={media[0]?.audioTrackId ?? "none"}
                      onValueChange={(v) => setMedia((x) => x.map((m, i) => (i === 0 ? { ...m, audioTrackId: v === "none" ? undefined : v } : m)))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keep the video&apos;s own audio</SelectItem>
                        {audioTracks.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.filename}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setMusicOpen(true)}>
                      <MusicIcon /> Browse music
                      {!features.mediaStudio && <LockIcon className="size-3 text-muted-foreground" />}
                    </Button>
                    <p className="text-[11.5px] text-muted-foreground">Search the music library or use your own track. It&apos;s mixed in before upload.</p>
                  </div>
                  <div className="grid content-start gap-2">
                    <Label>Crop</Label>
                    <Select value={(media[0]?.editSpec.crop as string) ?? "original"} onValueChange={(v) => setMedia((x) => x.map((m, i) => (i === 0 ? { ...m, editSpec: { ...m.editSpec, crop: v } } : m)))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["original", "9:16", "4:5", "1:1", "16:9"].map((c) => (
                          <SelectItem key={c} value={c}>
                            {c === "original" ? "Original" : c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid content-start gap-2">
                    <Label>Track volume</Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={150}
                        step={5}
                        disabled={!media[0]?.audioTrackId}
                        value={Math.round(((media[0]?.editSpec.audioVolume as number) ?? 1) * 100)}
                        onChange={(e) => setMedia((x) => x.map((m, i) => (i === 0 ? { ...m, editSpec: { ...m.editSpec, audioVolume: Number(e.target.value) / 100 } } : m)))}
                        className="w-full accent-[var(--signal)] disabled:opacity-40"
                      />
                      <span className="w-10 font-mono text-xs tabular-nums">{Math.round(((media[0]?.editSpec.audioVolume as number) ?? 1) * 100)}%</span>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={(media[0]?.editSpec.keepOriginalAudio as boolean) ?? true}
                        disabled={!media[0]?.audioTrackId}
                        onCheckedChange={(v) => setMedia((x) => x.map((m, i) => (i === 0 ? { ...m, editSpec: { ...m.editSpec, keepOriginalAudio: v } } : m)))}
                      />
                      Keep original audio under the track
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 03 Caption */}
        <section>
          <SectionTitle n="03">{selectedAccounts.length > 0 && selectedAccounts.every((a) => a.category === "community") ? "Message" : "Caption"}</SectionTitle>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write once. Adjust per channel below if you need to."
            className="min-h-40 text-[15px] leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
            <span className="text-muted-foreground">
              {caption.length} chars · {countHashtags(caption)} hashtags
            </span>
            {[...new Set(selectedAccounts.map((a) => a.platform))].map((p) => {
              const spec = PLATFORMS[p as TargetPlatform];
              const over = caption.length > spec.captionMax;
              return (
                <span key={p} className={cn("flex items-center gap-1", over ? "text-signal" : "text-muted-foreground")}>
                  <PlatformIcon platform={p} tone="plain" className="size-3" />
                  {spec.captionMax >= 10000 ? "∞" : `${spec.captionMax - caption.length}`}
                </span>
              );
            })}
          </div>
        </section>

        {usesPoll && (
          <section>
            <SectionTitle n="03b" aside={!features.polls ? <UpgradeHint feature="polls" compact /> : undefined}>
              Poll
            </SectionTitle>
            <PollEditor poll={poll} onChange={setPoll} platforms={[...new Set(selectedAccounts.filter((a) => targets[a.id]?.postType === "poll").map((a) => a.platform))]} />
          </section>
        )}

        {/* 04 Per channel */}
        {selectedAccounts.length > 0 && (
          <section>
            <SectionTitle n="04">Per-channel settings</SectionTitle>
            <Tabs value={activeAccount?.id} onValueChange={setActive}>
              <TabsList className="max-w-full overflow-x-auto">
                {selectedAccounts.map((a) => (
                  <TabsTrigger key={a.id} value={a.id}>
                    <PlatformIcon platform={a.platform} />
                    <span className="max-w-[120px] truncate">{a.handle}</span>
                    {errors[a.id] && <span className="size-1.5 rounded-full bg-signal" />}
                  </TabsTrigger>
                ))}
              </TabsList>
              {selectedAccounts.map((a) => (
                <TabsContent key={a.id} value={a.id} className="pt-3">
                  <TargetEditor
                    account={a}
                    state={targets[a.id]!}
                    errors={errors[a.id]}
                    baseCaption={caption}
                    onChange={(p) => patchTarget(a.id, p)}
                    features={features}
                    video={hasVideo ? mediaItems.find((m) => m.kind === "video") : undefined}
                    audioTracks={audioTracks}
                    postSpec={(media[0]?.editSpec ?? {}) as EditSpec}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </section>
        )}
      </div>

      {/* Right rail */}
      <aside className="space-y-6 xl:sticky xl:top-20 xl:self-start">
        <div>
          <p className="eyebrow mb-2">Preview</p>
          <Preview
            account={activeAccount}
            postType={activeAccount ? targets[activeAccount.id]?.postType : undefined}
            caption={(activeAccount && targets[activeAccount.id]?.captionOverride) || caption}
            media={visual}
            title={activeAccount ? ((targets[activeAccount.id]?.options.title ?? targets[activeAccount.id]?.options.headline) as string) : undefined}
            poll={activeAccount && targets[activeAccount.id]?.postType === "poll" ? poll : undefined}
            audienceSize={activeAccount?.audienceSize}
          />
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="eyebrow mb-3">When</p>
          <ToggleGroup type="single" value={when} onValueChange={(v) => v && setWhen(v as "now" | "later")} className="w-full">
            <ToggleGroupItem value="now" className="flex-1">
              <ZapIcon /> Now
            </ToggleGroupItem>
            <ToggleGroupItem value="later" className="flex-1">
              <CalendarIcon /> Schedule
            </ToggleGroupItem>
          </ToggleGroup>
          {when === "later" && (
            <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start font-normal">
                    <CalendarIcon /> {format(date, "EEE d MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }} />
                </PopoverContent>
              </Popover>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="font-mono" />
              <p className={cn("col-span-2 font-mono text-[11px]", inPast ? "text-signal" : "text-muted-foreground")}>
                {inPast ? "That time has passed." : `${timezone} · ${scheduledAt ? formatInTimeZone(scheduledAt, "UTC", "HH:mm 'UTC'") : ""}`}
              </p>
            </div>
          )}
        </div>

        <Checklist validationOk={validation.ok} errors={errors} accounts={selectedAccounts} hasMedia={visual.length > 0} />

        <div className="grid gap-2">
          <Button
            size="lg"
            variant="signal"
            disabled={pending || selectedAccounts.length === 0 || !validation.ok || (when === "later" && (!scheduledAt || inPast))}
            onClick={() => setConfirmOpen(true)}
            className="justify-between"
          >
            {needsApproval ? "Send for approval" : when === "now" ? "Review & publish" : "Review & schedule"}
            <SendIcon />
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => submit("draft")}>
            Save as draft
          </Button>
        </div>
      </aside>

      <MusicPicker
        open={musicOpen}
        onOpenChange={setMusicOpen}
        unlocked={features.mediaStudio}
        onPicked={(item) => {
          setLibrary((l) => (l.some((x) => x.id === item.id) ? l : [item, ...l]));
          setMedia((x) => x.map((m, i) => (i === 0 ? { ...m, audioTrackId: item.id } : m)));
        }}
      />
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        library={library}
        selected={media.map((m) => m.assetId)}
        onUploaded={(m) => setLibrary((l) => [m, ...l])}
        onDone={(ids) => {
          setMedia((cur) => {
            const keep = cur.filter((c) => ids.includes(c.assetId));
            const add = ids.filter((id) => !cur.some((c) => c.assetId === id)).map((id) => ({ assetId: id, editSpec: {} }));
            return [...keep, ...add];
          });
          setPickerOpen(false);
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-3xl font-normal">
              {needsApproval ? "Send for approval?" : when === "now" ? "Publish now?" : "Schedule this post?"}
            </DialogTitle>
            <DialogDescription>
              {when === "now"
                ? `Goes out to ${selectedAccounts.length} channel${selectedAccounts.length > 1 ? "s" : ""} right away. Each one is delivered on its own, so one failing never blocks the others.`
                : `Goes out ${scheduledAt ? formatInTimeZone(scheduledAt, timezone, "EEEE d MMMM 'at' HH:mm") : ""} (${timezone}).`}
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-xl border">
            {selectedAccounts.map((a) => {
              const t = targets[a.id]!;
              const type = PLATFORMS[a.platform as TargetPlatform].postTypes.find((p) => p.id === t.postType);
              return (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                  <PlatformIcon platform={a.platform} tone="chip" />
                  <span className="flex-1 truncate text-sm">{a.handle}</span>
                  {a.sandbox && <Badge variant="outline">Sandbox</Badge>}
                  <Badge variant="secondary">{type?.label}</Badge>
                  {t.captionOverride && <Badge variant="outline">Own caption</Badge>}
                  {t.editSpec && <Badge variant="outline">Own cut</Badge>}
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Back
            </Button>
            <Button variant="signal" disabled={pending} onClick={() => submit(when === "now" ? "now" : "schedule")}>
              {pending && <Loader2Icon className="animate-spin" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TargetEditor({
  account,
  state,
  errors,
  baseCaption,
  onChange,
  features,
  video,
  audioTracks,
  postSpec,
}: {
  account: Account;
  state: TargetState;
  errors?: string[];
  baseCaption: string;
  onChange: (p: Partial<TargetState>) => void;
  features: Record<Feature, boolean>;
  video?: MediaItem;
  audioTracks: MediaItem[];
  postSpec: EditSpec;
}) {
  const spec = PLATFORMS[account.platform as TargetPlatform];
  const type = spec.postTypes.find((t) => t.id === state.postType);
  const setOpt = (k: string, v: unknown) => onChange({ options: { ...state.options, [k]: v } });
  const community = spec.category === "community";
  const textLabel = community ? "Message" : account.platform === "youtube" ? "Description" : "Caption";
  const max = type?.captionMax ?? spec.captionMax;
  return (
    <div className="grid gap-5 rounded-xl border bg-card p-5">
      {errors && (
        <ul className="space-y-1 rounded-xl border border-signal/30 bg-signal/[0.06] p-3 text-sm">
          {errors.map((e) => (
            <li key={e} className="flex gap-2">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-signal" /> {e}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2">
        <Label>{community ? "Send as" : "Post as"}</Label>
        <ToggleGroup type="single" value={state.postType} onValueChange={(v) => v && onChange({ postType: v })} className="flex-wrap">
          {spec.postTypes.map((t) => {
            const lockedPoll = t.id === "poll" && !features.polls;
            return (
              <ToggleGroupItem key={t.id} value={t.id} disabled={lockedPoll} title={lockedPoll ? `Polls are on ${PLAN_INFO[planFor("polls")].name} and above` : undefined}>
                {t.id === "poll" && <VoteIcon />}
                {t.label}
                {lockedPoll && <LockIcon className="size-3 opacity-60" />}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
      {spec.options.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {spec.options.map((f) => {
            const gated = f.key === "headline" && !features.channelCaptions;
            return (
              <div key={f.key} className={cn("grid gap-2", f.type === "switch" && "content-center")}>
                {f.type === "text" && (
                  <>
                    <Label className="justify-between">
                      <span>
                        {f.label}
                        {f.required && <span className="text-signal">*</span>}
                      </span>
                      {gated && <UpgradeHint feature="channelCaptions" compact />}
                    </Label>
                    <Input value={(state.options[f.key] as string) ?? ""} onChange={(e) => setOpt(f.key, e.target.value)} placeholder={f.placeholder} maxLength={f.max} disabled={gated} />
                  </>
                )}
                {f.type === "select" && (
                  <>
                    <Label>
                      {f.label}
                      {f.required && <span className="text-signal">*</span>}
                    </Label>
                    <Select value={(state.options[f.key] as string) ?? ""} onValueChange={(v) => setOpt(f.key, v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose…" />
                      </SelectTrigger>
                      <SelectContent>
                        {f.options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
                {f.type === "switch" && (
                  <label className="flex items-start gap-3">
                    <Switch checked={Boolean(state.options[f.key])} onCheckedChange={(v) => setOpt(f.key, v)} className="mt-0.5" />
                    <span>
                      <span className="block text-[13px] font-medium">{f.label}</span>
                      {f.hint && <span className="block text-xs text-muted-foreground">{f.hint}</span>}
                    </span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <Label>
            {textLabel} for {spec.name}
          </Label>
          <span className={cn("font-mono text-[11px]", (state.captionOverride || baseCaption).length > max ? "text-signal" : "text-muted-foreground")}>
            {(state.captionOverride || baseCaption).length}/{max.toLocaleString()}
          </span>
        </div>
        {features.channelCaptions ? (
          <Textarea value={state.captionOverride} onChange={(e) => onChange({ captionOverride: e.target.value })} placeholder={`Leave empty to use the main ${community ? "message" : "caption"}`} className="min-h-24" />
        ) : (
          <>
            <p className="rounded-xl border bg-muted/30 px-3 py-2 text-[13px] whitespace-pre-wrap text-muted-foreground">{baseCaption || "Uses the main caption."}</p>
            <UpgradeHint feature="channelCaptions" />
          </>
        )}
      </div>
      {video && type && type.media !== "none" && type.media !== "image" && (
        <ChannelCut state={state} onChange={onChange} video={video} audioTracks={audioTracks} postSpec={postSpec} unlocked={features.channelVideoEdits} platformName={spec.name} />
      )}
      <p className="text-xs text-muted-foreground">{spec.notes}</p>
    </div>
  );
}

/** This channel's own cut of the first video: trim, crop and soundtrack, rendered with FFmpeg. */
function ChannelCut({
  state,
  onChange,
  video,
  audioTracks,
  postSpec,
  unlocked,
  platformName,
}: {
  state: TargetState;
  onChange: (p: Partial<TargetState>) => void;
  video: MediaItem;
  audioTracks: MediaItem[];
  postSpec: EditSpec;
  unlocked: boolean;
  platformName: string;
}) {
  const own = !!state.editSpec;
  const spec = state.editSpec ?? postSpec;
  const set = (patch: Partial<EditSpec>) => onChange({ editSpec: { ...spec, ...patch } });
  return (
    <div className="grid gap-4 rounded-xl border border-dashed p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <ScissorsIcon className="size-3.5" /> Video for {platformName}
          </p>
          <p className="text-xs text-muted-foreground">{own ? "Its own trim, crop and soundtrack, rendered before upload." : "Same cut as the post. Turn on to tailor it for this platform."}</p>
        </div>
        {unlocked ? <Switch checked={own} onCheckedChange={(v) => onChange({ editSpec: v ? { ...postSpec } : undefined })} aria-label="Own cut for this channel" /> : <UpgradeHint feature="channelVideoEdits" compact />}
      </div>
      {!unlocked && <UpgradeHint feature="channelVideoEdits" />}
      {unlocked && own && (
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <TrimFields className="md:col-span-2" durationMs={video.durationMs} spec={spec} onChange={set} />
          <div className="grid content-start gap-2">
            <Label>Crop</Label>
            <ToggleGroup type="single" value={spec.crop ?? "original"} onValueChange={(v) => v && set({ crop: v })} className="flex-wrap justify-start">
              {["original", "9:16", "4:5", "1:1", "16:9"].map((c) => (
                <ToggleGroupItem key={c} value={c} className="font-mono text-[11px]">
                  {c === "original" ? "Orig" : c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid content-start gap-2">
            <Label className="flex items-center gap-1.5">
              <MusicIcon className="size-3.5" /> Soundtrack
            </Label>
            <Select value={spec.audioTrackId ?? "none"} onValueChange={(v) => set({ audioTrackId: v === "none" ? undefined : v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Video&apos;s own audio</SelectItem>
                {audioTracks.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {spec.audioTrackId && (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={150}
                  step={5}
                  value={Math.round((spec.audioVolume ?? 1) * 100)}
                  onChange={(e) => set({ audioVolume: Number(e.target.value) / 100 })}
                  className="w-full accent-[var(--signal)]"
                  aria-label="Track volume"
                />
                <span className="w-10 font-mono text-xs tabular-nums">{Math.round((spec.audioVolume ?? 1) * 100)}%</span>
              </div>
            )}
            {spec.audioTrackId && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={spec.keepOriginalAudio ?? true} onCheckedChange={(v) => set({ keepOriginalAudio: v })} /> Keep original audio under it
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TrimFields({ durationMs, spec, onChange, className }: { durationMs?: number; spec: EditSpec; onChange: (p: Partial<EditSpec>) => void; className?: string }) {
  const total = durationMs ? durationMs / 1000 : undefined;
  const start = (spec.trimStartMs ?? 0) / 1000;
  const end = spec.trimEndMs ? spec.trimEndMs / 1000 : undefined;
  const length = (end ?? total ?? 0) - start;
  const toMs = (v: string) => (v === "" ? undefined : Math.max(0, Math.round(Number(v) * 1000)));
  return (
    <div className={cn("grid gap-2", className)}>
      <Label className="flex items-center gap-1.5">
        <ScissorsIcon className="size-3.5" /> Trim
      </Label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">from</span>
        <Input type="number" min={0} step={0.1} value={spec.trimStartMs ? start : ""} placeholder="0" onChange={(e) => onChange({ trimStartMs: toMs(e.target.value) })} className="h-8 w-20 font-mono" aria-label="Trim start in seconds" />
        <span className="text-muted-foreground">to</span>
        <Input type="number" min={0} step={0.1} value={end ?? ""} placeholder={total ? total.toFixed(1) : "end"} onChange={(e) => onChange({ trimEndMs: toMs(e.target.value) })} className="h-8 w-20 font-mono" aria-label="Trim end in seconds" />
        <span className="text-muted-foreground">seconds</span>
        {total !== undefined && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{Math.max(0, length).toFixed(1)}s of {total.toFixed(1)}s</span>}
      </div>
    </div>
  );
}

function PollEditor({ poll, onChange, platforms }: { poll: Poll; onChange: (p: Poll) => void; platforms: string[] }) {
  const maxAnswers = platforms.includes("mastodon") ? 4 : 10;
  const hasDuration = platforms.some((p) => p === "discord" || p === "mastodon");
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-5">
      <div className="grid gap-2">
        <Label htmlFor="poll-q">Question</Label>
        <Input id="poll-q" value={poll.question} maxLength={300} onChange={(e) => onChange({ ...poll, question: e.target.value })} placeholder="What should we build next?" />
      </div>
      <div className="grid gap-2">
        <Label>Answers</Label>
        {poll.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 font-mono text-[11px] text-muted-foreground">{String.fromCharCode(65 + i)}</span>
            <Input value={o} maxLength={100} onChange={(e) => onChange({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Answer ${i + 1}`} />
            {poll.options.length > 2 && (
              <Button variant="ghost" size="icon-sm" aria-label="Remove answer" onClick={() => onChange({ ...poll, options: poll.options.filter((_, j) => j !== i) })}>
                <XIcon />
              </Button>
            )}
          </div>
        ))}
        {poll.options.length < maxAnswers && (
          <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => onChange({ ...poll, options: [...poll.options, ""] })}>
            <PlusIcon /> Add answer
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={poll.allowMultiple} onCheckedChange={(v) => onChange({ ...poll, allowMultiple: v })} /> Allow several answers
        </label>
        {hasDuration && (
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Open for</span>
            <Select value={String(poll.durationHours)} onValueChange={(v) => onChange({ ...poll, durationHours: Number(v) })}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLL_DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Telegram polls in channels are anonymous. The main message goes out with the poll.</p>
    </div>
  );
}

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

function Checklist({ validationOk, errors, accounts, hasMedia }: { validationOk: boolean; errors: Record<string, string[]>; accounts: Account[]; hasMedia: boolean }) {
  const items = [
    { ok: accounts.length > 0, label: accounts.length ? `${accounts.length} channel${accounts.length > 1 ? "s" : ""} selected` : "Pick at least one channel" },
    { ok: hasMedia || accounts.every((a) => PLATFORMS[a.platform as TargetPlatform].postTypes.some((t) => t.media === "none")), label: hasMedia ? "Media attached" : "No media yet" },
    { ok: validationOk, label: validationOk ? "Every channel's rules pass" : `${Object.keys(errors).length} channel${Object.keys(errors).length > 1 ? "s" : ""} need changes` },
  ];
  return (
    <ul className="space-y-1.5 text-[13px]">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className={cn("flex size-4 items-center justify-center rounded-full", i.ok ? "bg-ok/15 text-ok" : "bg-signal/15 text-signal")}>
            {i.ok ? <CheckIcon className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <span className={i.ok ? "" : "text-foreground"}>{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

function MediaPicker({
  open,
  onOpenChange,
  library,
  selected,
  onUploaded,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  library: MediaItem[];
  selected: string[];
  onUploaded: (m: MediaItem) => void;
  onDone: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const visual = library.filter((m) => m.kind !== "audio");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setPicked(selected);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose media</DialogTitle>
          <DialogDescription>Pick in the order they should appear. Carousels take several; Reels, Shorts and videos use the first.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto md:grid-cols-[200px_1fr]">
          <MediaUploader
            compact
            accept="image/*,video/*,audio/*"
            onUploaded={(m) => {
              onUploaded(m);
              if (m.kind !== "audio") setPicked((p) => [...p, m.id]);
            }}
          />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {visual.map((m) => {
              const idx = picked.indexOf(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPicked((p) => (idx >= 0 ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                  className={cn("relative rounded-md ring-offset-2 ring-offset-popover", idx >= 0 && "ring-2 ring-signal")}
                >
                  <MediaThumb item={m} className="aspect-square rounded-md" />
                  {idx >= 0 && <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-signal font-mono text-[10px] font-bold text-signal-foreground">{idx + 1}</span>}
                </button>
              );
            })}
            {visual.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">Upload something to get started.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onDone(picked)}>Use {picked.length} item{picked.length === 1 ? "" : "s"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex size-6 items-center justify-center rounded-md bg-black/65 text-white hover:bg-black/85 [&_svg]:size-3.5">
      {children}
    </button>
  );
}

function swap<T>(arr: T[], a: number, b: number) {
  const next = [...arr];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}
