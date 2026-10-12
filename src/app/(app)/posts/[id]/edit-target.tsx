"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClapperboardIcon, Loader2Icon, MusicIcon, PencilIcon, RotateCcwIcon, ScissorsIcon } from "lucide-react";
import { renderTargetPreviewAction, updateTargetAction, type TargetPatch } from "@/lib/actions/posts";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import type { Feature } from "@/lib/plans";
import { PlatformIcon } from "@/components/platform-icon";
import { UpgradeHint } from "@/components/upgrade-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type EditSpec = { crop?: string; trimStartMs?: number; trimEndMs?: number; audioTrackId?: string; audioVolume?: number; keepOriginalAudio?: boolean };

export type EditableTarget = {
  id: string;
  platform: string;
  handle: string;
  status: string;
  postType: string;
  captionOverride: string;
  options: Record<string, unknown>;
  editSpec: EditSpec | null;
};

/**
 * Edits one channel of a post on its own: its text, options and video cut. Undelivered
 * channels are changed before they go (or re-sent, when they failed); delivered messages
 * on platforms that allow it are edited in place.
 */
export function EditTargetButton({
  target,
  baseCaption,
  video,
  audioTracks,
  postSpec,
  features,
}: {
  target: EditableTarget;
  baseCaption: string;
  video?: { durationMs?: number };
  audioTracks: { id: string; filename: string }[];
  postSpec: EditSpec;
  features: Record<Feature, boolean>;
}) {
  const router = useRouter();
  const spec = PLATFORMS[target.platform as TargetPlatform];
  const live = target.status === "published";
  const [open, setOpen] = useState(false);
  const [postType, setPostType] = useState(target.postType);
  const [caption, setCaption] = useState(target.captionOverride);
  const [options, setOptions] = useState(target.options);
  const [cut, setCut] = useState<EditSpec | null>(target.editSpec);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [rendering, startRender] = useTransition();

  if (!spec) return null;
  if (live && !spec.liveEdit) return null;
  const failed = ["failed", "needs_action", "cancelled"].includes(target.status);
  const type = spec.postTypes.find((t) => t.id === postType);
  const showCut = !live && video && type && type.media !== "none" && type.media !== "image";
  const lockedText = !features.channelCaptions;
  const lockedLive = live && !features.liveEdits;
  const lockedEdit = !features.editAfterPublish;

  function save(requeue: boolean) {
    start(async () => {
      const r = await updateTargetAction(target.id, { postType, captionOverride: caption, options, editSpec: cut as TargetPatch["editSpec"] }, { requeue });
      if (!r.ok) {
        if (r.upgrade) toast.error(r.error, { action: { label: "See plans", onClick: () => router.push("/billing") } });
        else toast.error(r.error);
        return;
      }
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    });
  }

  function render() {
    startRender(async () => {
      // Save first so the render uses what's on screen.
      const saved = await updateTargetAction(target.id, { editSpec: cut as TargetPatch["editSpec"] });
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      const r = await renderTargetPreviewAction(target.id);
      if (!r.ok) toast.error(r.error);
      else {
        setPreview(`${r.url}?v=${Date.now()}`);
        if (r.same) toast("No edits for this channel, so it uploads the original.");
      }
    });
  }

  const textOptions = spec.options.filter((f) => f.type === "text");
  const otherOptions = spec.options.filter((f) => f.type !== "text");

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon /> {live ? "Edit message" : "Edit"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PlatformIcon platform={target.platform} tone="chip" /> {target.handle}
            </SheetTitle>
            <SheetDescription>
              {live
                ? `Already sent. Saving edits the message on ${spec.name} in place.`
                : failed
                  ? "Fix what went wrong and send this channel again. The other channels aren't touched."
                  : "Changes apply to this channel only."}
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-5 px-4">
            {lockedLive && <UpgradeHint feature="liveEdits" />}
            {!lockedLive && lockedEdit && !["scheduled"].includes(target.status) && <UpgradeHint feature="editAfterPublish" />}

            {!live && (
              <div className="grid gap-2">
                <Label>Post as</Label>
                <ToggleGroup type="single" value={postType} onValueChange={(v) => v && setPostType(v)} className="flex-wrap justify-start">
                  {spec.postTypes.map((t) => (
                    <ToggleGroupItem key={t.id} value={t.id} disabled={t.id === "poll" && !features.polls}>
                      {t.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}

            {textOptions.map((f) =>
              f.type === "text" ? (
                <div key={f.key} className="grid gap-2">
                  <Label>
                    {f.label}
                    {f.required && <span className="text-signal">*</span>}
                  </Label>
                  <Input
                    value={(options[f.key] as string) ?? ""}
                    maxLength={f.max}
                    placeholder={f.placeholder}
                    disabled={f.key === "headline" && lockedText}
                    onChange={(e) => setOptions((o) => ({ ...o, [f.key]: e.target.value }))}
                  />
                </div>
              ) : null
            )}

            <div className="grid gap-2">
              <div className="flex items-baseline justify-between">
                <Label>{spec.category === "community" ? "Message" : target.platform === "youtube" ? "Description" : "Caption"}</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {(caption || baseCaption).length}/{(type?.captionMax ?? spec.captionMax).toLocaleString()}
                </span>
              </div>
              {lockedText ? (
                <>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-[13px] whitespace-pre-wrap text-muted-foreground">{baseCaption || "Uses the post's caption."}</p>
                  <UpgradeHint feature="channelCaptions" />
                </>
              ) : (
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={baseCaption || "Uses the post's caption"} className="min-h-36" />
              )}
            </div>

            {!live && otherOptions.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {otherOptions.map((f) =>
                  f.type === "switch" ? (
                    <label key={f.key} className="flex items-center gap-2 text-[13px]">
                      <Switch checked={Boolean(options[f.key])} onCheckedChange={(v) => setOptions((o) => ({ ...o, [f.key]: v }))} /> {f.label}
                    </label>
                  ) : f.type === "select" ? (
                    <div key={f.key} className="grid gap-1.5">
                      <Label>{f.label}</Label>
                      <Select value={(options[f.key] as string) ?? ""} onValueChange={(v) => setOptions((o) => ({ ...o, [f.key]: v }))}>
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
                    </div>
                  ) : null
                )}
              </div>
            )}

            {showCut && (
              <div className="grid gap-4 rounded-md border border-dashed p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-[13px] font-medium">
                      <ScissorsIcon className="size-3.5" /> Video for {spec.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{cut ? "Its own cut, rendered with FFmpeg before upload." : "Same cut as the post."}</p>
                  </div>
                  {features.channelVideoEdits ? (
                    <Switch checked={!!cut} onCheckedChange={(v) => setCut(v ? { ...postSpec } : null)} aria-label="Own cut" />
                  ) : (
                    <UpgradeHint feature="channelVideoEdits" compact />
                  )}
                </div>
                {!features.channelVideoEdits && <UpgradeHint feature="channelVideoEdits" />}
                {cut && features.channelVideoEdits && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Trim</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        className="h-8 w-20 font-mono"
                        aria-label="Trim start in seconds"
                        value={cut.trimStartMs ? cut.trimStartMs / 1000 : ""}
                        placeholder="0"
                        onChange={(e) => setCut({ ...cut, trimStartMs: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 1000) })}
                      />
                      <span className="text-muted-foreground">to</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        className="h-8 w-20 font-mono"
                        aria-label="Trim end in seconds"
                        value={cut.trimEndMs ? cut.trimEndMs / 1000 : ""}
                        placeholder={video?.durationMs ? (video.durationMs / 1000).toFixed(1) : "end"}
                        onChange={(e) => setCut({ ...cut, trimEndMs: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 1000) })}
                      />
                      <span className="text-muted-foreground">s</span>
                    </div>
                    <ToggleGroup type="single" value={cut.crop ?? "original"} onValueChange={(v) => v && setCut({ ...cut, crop: v })} className="flex-wrap justify-start">
                      {["original", "9:16", "4:5", "1:1", "16:9"].map((c) => (
                        <ToggleGroupItem key={c} value={c} className="font-mono text-[11px]">
                          {c === "original" ? "Orig" : c}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <div className="grid gap-1.5">
                      <Label className="flex items-center gap-1.5">
                        <MusicIcon className="size-3.5" /> Soundtrack
                      </Label>
                      <Select value={cut.audioTrackId ?? "none"} onValueChange={(v) => setCut({ ...cut, audioTrackId: v === "none" ? undefined : v })}>
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
                    </div>
                  </>
                )}
                {features.channelVideoEdits && (
                  <div className="grid gap-2">
                    <Button variant="outline" size="sm" className="justify-self-start" disabled={rendering} onClick={render}>
                      {rendering ? <Loader2Icon className="animate-spin" /> : <ClapperboardIcon />} {rendering ? "Rendering…" : "Render preview"}
                    </Button>
                    {preview && <video src={preview} controls playsInline className={cn("max-h-80 w-full rounded-md border bg-black")} />}
                  </div>
                )}
              </div>
            )}
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            {failed ? (
              <Button variant="signal" disabled={pending} onClick={() => save(true)}>
                {pending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />} Save & send again
              </Button>
            ) : (
              <Button variant="signal" disabled={pending || lockedLive} onClick={() => save(false)}>
                {pending && <Loader2Icon className="animate-spin" />} {live ? `Update on ${spec.name}` : "Save channel"}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
