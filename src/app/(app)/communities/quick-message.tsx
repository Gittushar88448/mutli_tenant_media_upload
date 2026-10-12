"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, format } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import { CalendarIcon, CheckIcon, FlaskConicalIcon, HandIcon, LockIcon, MessageSquareTextIcon, PlusIcon, SendIcon, VoteIcon, XIcon, ZapIcon } from "lucide-react";
import { savePostAction } from "@/lib/actions/posts";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { validateTargets } from "@/lib/publishing/validate";
import { PlatformIcon } from "@/components/platform-icon";
import { UpgradeHint } from "@/components/upgrade-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { isPast } from "@/lib/time";

type Group = { id: string; platform: string; handle: string; audienceSize: number | null; sandbox: boolean; assisted: boolean };

/**
 * One message (or poll) to many communities at once. It saves an ordinary post with a
 * "message" or "poll" target per group, so it shows up in the queue, calendar and log
 * like everything else and can be edited per channel afterwards.
 */
export function QuickMessage({ groups, timezone, canPost, pollsUnlocked, needsApproval }: { groups: Group[]; timezone: string; canPost: boolean; pollsUnlocked: boolean; needsApproval: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(groups.map((g) => g.id));
  const [kind, setKind] = useState<"message" | "poll">("message");
  const [headline, setHeadline] = useState("");
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [silent, setSilent] = useState(false);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [date, setDate] = useState<Date>(addDays(new Date(), 1));
  const [time, setTime] = useState("09:00");
  const [pending, start] = useTransition();

  const pollCapable = new Set(Object.values(PLATFORMS).filter((p) => p.postTypes.some((t) => t.id === "poll")).map((p) => p.id as string));
  const chosen = groups.filter((g) => selected.includes(g.id));
  // A poll goes to groups that support polls; the rest get the text as a message.
  const targets = chosen.map((g) => ({ g, postType: kind === "poll" && pollCapable.has(g.platform) ? "poll" : "message" }));
  const reach = chosen.reduce((n, g) => n + (g.audienceSize ?? 0), 0);
  const poll = { question, options: answers.map((a) => a.trim()).filter(Boolean), allowMultiple: multi, durationHours: 24 };
  // Groups without polls get the question and answers written out as a message.
  const pollAsText = [text.trim(), question.trim(), poll.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")].filter(Boolean).join("\n\n");
  const textFor = (postType: string) => (kind === "poll" && postType === "message" ? pollAsText : undefined);

  const v = validateTargets({
    caption: text,
    media: [],
    targets: targets.map(({ g, postType }) => ({ key: g.id, platform: g.platform as TargetPlatform, postType, captionOverride: textFor(postType), options: {} })),
    poll,
  });
  const scheduledAt = useMemo(() => {
    if (when === "now") return undefined;
    try {
      return fromZonedTime(`${format(date, "yyyy-MM-dd")}T${time}:00`, timezone);
    } catch {
      return undefined;
    }
  }, [when, date, time, timezone]);
  const firstError = Object.entries(v.errors)[0];
  const tooShort = kind === "message" ? !text.trim() : !question.trim() || poll.options.length < 2;

  function send() {
    start(async () => {
      const r = await savePostAction({
        mode: when === "now" ? "now" : "schedule",
        title: (kind === "poll" ? question : headline || text).slice(0, 80) || undefined,
        caption: text,
        scheduledAt: scheduledAt?.toISOString(),
        media: [],
        targets: targets.map(({ g, postType }) => ({
          accountId: g.id,
          platform: g.platform,
          postType,
          captionOverride: textFor(postType),
          options: { ...(headline.trim() ? { headline: headline.trim() } : {}), ...(silent && g.platform === "telegram" ? { silent: true } : {}) },
        })),
        poll: kind === "poll" ? poll : undefined,
      });
      if (!r.ok) {
        if (r.upgrade) toast.error(r.error, { action: { label: "See plans", onClick: () => router.push("/billing") } });
        else toast.error(r.error);
        return;
      }
      toast.success(r.message);
      setText("");
      setHeadline("");
      setQuestion("");
      setAnswers(["", ""]);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap gap-2 border-b p-4">
        {groups.map((g) => {
          const on = selected.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSelected((s) => (on ? s.filter((x) => x !== g.id) : [...s, g.id]))}
              className={cn(
                "flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] transition-all",
                on ? "border-foreground bg-foreground text-background" : "bg-card hover:border-foreground/40"
              )}
            >
              <PlatformIcon platform={g.platform} tone="chip" className="size-6 rounded-full p-1" />
              <span className="max-w-[150px] truncate">{g.handle}</span>
              {g.sandbox && <FlaskConicalIcon className="size-3 opacity-60" />}
              {g.assisted && <HandIcon className="size-3 opacity-60" />}
              {on && <CheckIcon className="size-3.5 text-signal" />}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup type="single" value={kind} onValueChange={(x) => x && setKind(x as "message" | "poll")}>
            <ToggleGroupItem value="message">
              <MessageSquareTextIcon /> Message
            </ToggleGroupItem>
            <ToggleGroupItem value="poll" disabled={!pollsUnlocked}>
              <VoteIcon /> Poll {!pollsUnlocked && <LockIcon className="size-3 opacity-60" />}
            </ToggleGroupItem>
          </ToggleGroup>
          {!pollsUnlocked && <UpgradeHint feature="polls" compact />}
        </div>

        <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} placeholder="Headline (optional, shown in bold)" className="font-medium" />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "poll" ? "Say something before the poll (optional)" : "Write to your communities…"}
          className="min-h-32 text-[15px] leading-relaxed"
        />

        {kind === "poll" && (
          <div className="grid gap-2 rounded-xl border border-dashed p-3">
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="Poll question" />
            {answers.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 font-mono text-[11px] text-muted-foreground">{String.fromCharCode(65 + i)}</span>
                <Input value={a} maxLength={100} onChange={(e) => setAnswers((x) => x.map((y, j) => (j === i ? e.target.value : y)))} placeholder={`Answer ${i + 1}`} />
                {answers.length > 2 && (
                  <Button variant="ghost" size="icon-sm" aria-label="Remove answer" onClick={() => setAnswers((x) => x.filter((_, j) => j !== i))}>
                    <XIcon />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-4">
              {answers.length < 10 && (
                <Button variant="ghost" size="sm" onClick={() => setAnswers((x) => [...x, ""])}>
                  <PlusIcon /> Add answer
                </Button>
              )}
              <label className="flex items-center gap-2 text-[13px]">
                <Switch checked={multi} onCheckedChange={setMulti} /> Several answers allowed
              </label>
            </div>
            {chosen.some((g) => !pollCapable.has(g.platform)) && (
              <p className="text-xs text-muted-foreground">
                {chosen
                  .filter((g) => !pollCapable.has(g.platform))
                  .map((g) => PLATFORMS[g.platform as TargetPlatform]?.name)
                  .filter((x, i, a) => a.indexOf(x) === i)
                  .join(", ")}{" "}
                can&apos;t run polls, so they get the text as a normal message.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-4">
          <ToggleGroup type="single" value={when} onValueChange={(x) => x && setWhen(x as "now" | "later")}>
            <ToggleGroupItem value="now">
              <ZapIcon /> Now
            </ToggleGroupItem>
            <ToggleGroupItem value="later">
              <CalendarIcon /> Schedule
            </ToggleGroupItem>
          </ToggleGroup>
          {when === "later" && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="font-normal">
                    <CalendarIcon /> {format(date, "EEE d MMM")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }} />
                </PopoverContent>
              </Popover>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-[100px] font-mono" />
            </div>
          )}
          {chosen.some((g) => g.platform === "telegram") && (
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Switch checked={silent} onCheckedChange={setSilent} /> Silent on Telegram
            </label>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
              {chosen.length} {chosen.length === 1 ? "group" : "groups"}
              {reach ? ` · ${reach.toLocaleString()} members` : ""}
            </span>
            <Button
              variant="signal"
              disabled={!canPost || pending || chosen.length === 0 || tooShort || !v.ok || (when === "later" && (!scheduledAt || isPast(scheduledAt)))}
              onClick={send}
            >
              {needsApproval ? "Send for approval" : when === "now" ? "Send now" : "Schedule"} <SendIcon />
            </Button>
          </div>
        </div>
        {firstError && !tooShort && (
          <p className="text-xs text-signal">
            {groups.find((g) => g.id === firstError[0])?.handle}: {firstError[1][0]}
          </p>
        )}
        {when === "later" && scheduledAt && (
          <p className="-mt-2 font-mono text-[11px] text-muted-foreground">
            Goes out {formatInTimeZone(scheduledAt, timezone, "EEEE d MMMM 'at' HH:mm")} ({timezone})
          </p>
        )}
      </div>
    </div>
  );
}
