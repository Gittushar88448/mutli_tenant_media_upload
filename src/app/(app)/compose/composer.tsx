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
  MusicIcon,
  SendIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { PLATFORMS, countHashtags, type TargetPlatform } from "@/lib/platforms";
import { validateTargets } from "@/lib/publishing/validate";
import { savePostAction, type ComposePayload } from "@/lib/actions/posts";
import { PlatformIcon } from "@/components/platform-icon";
import { MediaThumb } from "@/components/media/thumb";
import { MediaUploader } from "@/components/media/uploader";
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

type Account = { id: string; platform: string; handle: string; displayName?: string; sandbox: boolean; status: string };
type TargetState = { postType: string; captionOverride: string; options: Record<string, unknown> };
type MediaSel = { assetId: string; audioTrackId?: string; editSpec: Record<string, unknown> };

export type ComposerInitial = {
  postId?: string;
  title: string;
  caption: string;
  scheduledAt?: string;
  media: MediaSel[];
  targets: { accountId: string; postType: string; captionOverride: string; options: Record<string, unknown> }[];
};

function defaultTarget(platform: string, hasVideo: boolean): TargetState {
  const spec = PLATFORMS[platform as TargetPlatform];
  const types = spec.postTypes;
  const pick = (hasVideo && types.find((t) => t.media === "video")) || types.find((t) => t.media === "any") || types[0]!;
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
}: {
  accounts: Account[];
  library: MediaItem[];
  timezone: string;
  needsApproval: boolean;
  initial?: ComposerInitial;
}) {
  const router = useRouter();
  const [library, setLibrary] = useState(initialLibrary);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [caption, setCaption] = useState(initial?.caption ?? "");
  const [media, setMedia] = useState<MediaSel[]>(initial?.media ?? []);
  const [targets, setTargets] = useState<Record<string, TargetState>>(() =>
    Object.fromEntries((initial?.targets ?? []).map((t) => [t.accountId, { postType: t.postType, captionOverride: t.captionOverride, options: t.options }]))
  );
  const [active, setActive] = useState<string | undefined>(initial?.targets[0]?.accountId);
  const [when, setWhen] = useState<"now" | "later">(initial?.scheduledAt ? "later" : "now");
  const initialLocal = initial?.scheduledAt ? new Date(initial.scheduledAt) : addDays(new Date(), 1);
  const [date, setDate] = useState<Date>(initialLocal);
  const [time, setTime] = useState(initial?.scheduledAt ? formatInTimeZone(initialLocal, timezone, "HH:mm") : "09:00");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(library.map((m) => [m.id, m])), [library]);
  const mediaItems = media.map((m) => byId.get(m.assetId)).filter(Boolean) as MediaItem[];
  const hasVideo = mediaItems.some((m) => m.kind === "video");
  const audioTracks = library.filter((m) => m.kind === "audio");
  const selectedAccounts = accounts.filter((a) => targets[a.id]);
  const activeAccount = selectedAccounts.find((a) => a.id === active) ?? selectedAccounts[0];

  const validation = validateTargets({
    caption,
    media: mediaItems.map((m) => ({ kind: m.kind, durationMs: m.durationMs, width: m.width, height: m.height })),
    targets: selectedAccounts.map((a) => ({ key: a.id, platform: a.platform as TargetPlatform, ...targets[a.id]! })),
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
      else next[a.id] = defaultTarget(a.platform, hasVideo);
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
      })),
    };
  }

  function submit(mode: ComposePayload["mode"]) {
    start(async () => {
      const r = await savePostAction(payload(mode));
      if (!r.ok) {
        toast.error(r.error);
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
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => {
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
                  {a.sandbox && <FlaskConicalIcon className="size-3 opacity-60" />}
                  {on ? <CheckIcon className="size-3.5 text-signal" /> : null}
                  {errors[a.id] && <span className="size-1.5 rounded-full bg-signal" />}
                </button>
              );
            })}
          </div>
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
            <button type="button" onClick={() => setPickerOpen(true)} className="grain flex w-full items-center justify-center gap-3 rounded-md border border-dashed py-10 text-sm text-muted-foreground hover:border-foreground/40">
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
                      <MediaThumb item={item} className="aspect-[9/16] rounded-md border" />
                      <span className="absolute top-1.5 left-1.5 rounded-[3px] bg-black/70 px-1 font-mono text-[10px] text-white">{String(i + 1).padStart(2, "0")}</span>
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
                <div className="grid gap-4 rounded-md border bg-card p-4 md:grid-cols-[1.4fr_1fr_1fr]">
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
                    <p className="text-[11.5px] text-muted-foreground">Your own or licensed tracks, mixed in before upload.{audioTracks.length === 0 && " Upload an MP3 or M4A to the library to use one."}</p>
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
          <SectionTitle n="03">Caption</SectionTitle>
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
                  <TargetEditor account={a} state={targets[a.id]!} errors={errors[a.id]} baseCaption={caption} onChange={(p) => patchTarget(a.id, p)} />
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
            title={activeAccount ? (targets[activeAccount.id]?.options.title as string) : undefined}
          />
        </div>

        <div className="rounded-md border bg-card p-4">
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
          <ul className="divide-y rounded-md border">
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
}: {
  account: Account;
  state: TargetState;
  errors?: string[];
  baseCaption: string;
  onChange: (p: Partial<TargetState>) => void;
}) {
  const spec = PLATFORMS[account.platform as TargetPlatform];
  const setOpt = (k: string, v: unknown) => onChange({ options: { ...state.options, [k]: v } });
  return (
    <div className="grid gap-5 rounded-md border bg-card p-5">
      {errors && (
        <ul className="space-y-1 rounded-md border border-signal/30 bg-signal/[0.06] p-3 text-sm">
          {errors.map((e) => (
            <li key={e} className="flex gap-2">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-signal" /> {e}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2">
        <Label>Post as</Label>
        <ToggleGroup type="single" value={state.postType} onValueChange={(v) => v && onChange({ postType: v })} className="flex-wrap">
          {spec.postTypes.map((t) => (
            <ToggleGroupItem key={t.id} value={t.id}>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {spec.options.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {spec.options.map((f) => (
            <div key={f.key} className={cn("grid gap-2", f.type === "switch" && "content-center")}>
              {f.type === "text" && (
                <>
                  <Label>
                    {f.label}
                    {f.required && <span className="text-signal">*</span>}
                  </Label>
                  <Input value={(state.options[f.key] as string) ?? ""} onChange={(e) => setOpt(f.key, e.target.value)} placeholder={f.placeholder} maxLength={f.max} />
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
          ))}
        </div>
      )}
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <Label>Caption for {spec.name}</Label>
          <span className="font-mono text-[11px] text-muted-foreground">
            {(state.captionOverride || baseCaption).length}/{spec.captionMax.toLocaleString()}
          </span>
        </div>
        <Textarea value={state.captionOverride} onChange={(e) => onChange({ captionOverride: e.target.value })} placeholder="Leave empty to use the main caption" className="min-h-24" />
      </div>
      <p className="text-xs text-muted-foreground">{spec.notes}</p>
    </div>
  );
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
    <button type="button" aria-label={label} onClick={onClick} className="flex size-6 items-center justify-center rounded-[4px] bg-black/65 text-white hover:bg-black/85 [&_svg]:size-3.5">
      {children}
    </button>
  );
}

function swap<T>(arr: T[], a: number, b: number) {
  const next = [...arr];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}
