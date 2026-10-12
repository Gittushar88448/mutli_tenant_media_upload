import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, CircleIcon, FlaskConicalIcon, MinusIcon } from "lucide-react";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { SocialAccount, oid } from "@/lib/models";
import { getSetupProgress } from "@/lib/queries/guide";
import { FAQ, NO_API, ROLE_MATRIX, SOCIAL_REQUIREMENTS } from "@/lib/guide";
import { PLATFORMS, SOCIAL_PLATFORMS, isPlatformConfigured } from "@/lib/platforms";
import { FEATURE_LABELS, PLANS, PLAN_INFO, PLAN_LIMITS, formatPrice, planFeatures, planFor, type Feature, type Plan } from "@/lib/plans";
import { billingProvider, displayPrices } from "@/lib/billing";
import { demoMode } from "@/lib/publishing/n8n";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { GuideToc } from "./toc";
import { CommunityTabs } from "./community-tabs";

export const metadata: Metadata = { title: "Guide" };

const TOC = [
  { id: "start", n: "01", label: "How Relay works" },
  { id: "platforms", n: "02", label: "Connect social platforms" },
  { id: "communities", n: "03", label: "Connect communities" },
  { id: "compose", n: "04", label: "Write and schedule" },
  { id: "media", n: "05", label: "Edit media and add music" },
  { id: "live", n: "06", label: "Watch it live" },
  { id: "pricing", n: "07", label: "Plans and pricing" },
  { id: "team", n: "08", label: "Team and roles" },
  { id: "faq", n: "09", label: "Questions" },
];

const ROLES = ["owner", "admin", "editor", "approver", "viewer"] as const;

export default async function GuidePage() {
  const ctx = await getWorkspaceContext();
  const plan = ctx.workspace.plan as Plan;
  const provider = billingProvider();
  const [setup, prices, accounts] = await Promise.all([
    getSetupProgress(ctx.workspace.id, plan),
    displayPrices(provider),
    SocialAccount.aggregate<{ _id: string; n: number }>([{ $match: { workspaceId: oid(ctx.workspace.id), status: { $ne: "revoked" } } }, { $group: { _id: "$platform", n: { $sum: 1 } } }]),
  ]);
  const connected = Object.fromEntries(accounts.map((a) => [a._id, a.n]));
  const canManage = can(ctx.role, "admin");
  const demo = demoMode();
  const features = Object.keys(FEATURE_LABELS) as Feature[];

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Guide"
        title="How to use Relay"
        description="Connect your platforms and communities, write once for all of them, and pick the plan that fits. Each section links to the page where you do it."
      />

      <section aria-labelledby="setup-title" className="rounded-md border bg-card">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-5 py-4">
          <h2 id="setup-title" className="text-[15px] font-semibold tracking-tight">
            Set up {ctx.workspace.name}
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {setup.done} of {setup.steps.length} done
          </span>
          <Progress value={(setup.done / setup.steps.length) * 100} className="h-1.5 min-w-32 flex-1" />
        </div>
        <ol className="grid sm:grid-cols-2 xl:grid-cols-3">
          {setup.steps.map((s, i) => (
            <li key={s.key} className="flex gap-3 border-b p-5 sm:[&:nth-child(odd)]:border-r xl:border-r xl:[&:nth-child(3n)]:border-r-0 xl:[&:nth-last-child(-n+3)]:border-b-0">
              <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${s.done ? "border-ok bg-ok text-background" : "text-muted-foreground"}`}>
                {s.done ? <CheckIcon className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through decoration-1" : ""}`}>{s.title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{s.body}</p>
                {!s.done && (
                  <Link href={s.href} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium underline decoration-signal decoration-2 underline-offset-4">
                    {s.cta} <ArrowRightIcon className="size-3" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-10 xl:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <GuideToc items={TOC} />
        </aside>

        <div className="min-w-0 space-y-14">
          <section id="start" className="scroll-mt-20">
            <SectionTitle n="01">How Relay works</SectionTitle>
            <p className="max-w-3xl text-[15px] leading-relaxed">
              Relay is one desk for everywhere you publish. You connect your accounts once, write a post once, adjust it for each platform where you need to, and Relay sends it at the right time. Every channel reports back on its own, so one failure never holds up the others.
            </p>
            <ol className="mt-6 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {[
                { t: "Connect", d: "Social accounts sign in with their own login. Communities use a bot, webhook or app password.", href: "/accounts" },
                { t: "Write", d: "One post with media. Tailor the text, title or video cut per channel.", href: "/compose" },
                { t: "Schedule", d: "Send now, pick a time, or save a draft. Approvals can sit in between.", href: "/calendar" },
                { t: "Follow up", d: "Each channel shows sent, failed or waiting on you, with retries built in.", href: "/posts" },
              ].map((s, i) => (
                <li key={s.t} className="bg-card p-4">
                  <p className="font-mono text-[11px] text-signal">0{i + 1}</p>
                  <p className="mt-1 font-serif text-2xl">{s.t}</p>
                  <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{s.d}</p>
                  <Link href={s.href} className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    Open <ArrowRightIcon className="size-3" />
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <section id="platforms" className="scroll-mt-20">
            <SectionTitle n="02" aside={<Link href="/accounts" className="text-xs text-muted-foreground hover:text-foreground">Channels →</Link>}>
              Connect social platforms
            </SectionTitle>
            <div className="grid max-w-3xl gap-3 text-[14px] leading-relaxed">
              <p>
                Go to <b>Channels → Add a platform</b> and press <b>Connect</b>. You sign in on the platform&apos;s own page and approve Relay there, so Relay never sees your password. Its access is stored encrypted and renewed automatically. Only workspace owners and admins can connect channels.
              </p>
              {demo && (
                <p className="flex gap-2 rounded-md border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
                  <FlaskConicalIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Platforms marked <b className="font-medium text-foreground">Sandbox only</b> haven&apos;t been set up on this server yet. You can still add a sandbox channel to try them; it behaves like the real thing without posting anywhere.
                  </span>
                </p>
              )}
            </div>
            <div className="mt-5 overflow-x-auto rounded-md border bg-card">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead className="border-b font-mono text-[10.5px] tracking-wider text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-normal">Platform</th>
                    <th className="px-4 py-2.5 font-normal">What you need</th>
                    <th className="px-4 py-2.5 font-normal">You can post</th>
                    <th className="px-4 py-2.5 font-normal">Good to know</th>
                  </tr>
                </thead>
                <tbody>
                  {SOCIAL_PLATFORMS.map((p) => {
                    const ready = isPlatformConfigured(p.id);
                    return (
                      <tr key={p.id} className="border-b align-top last:border-0">
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <PlatformIcon platform={p.id} tone="chip" className="size-7 p-1.5" />
                            <span>
                              <span className="block font-medium">{p.name}</span>
                              <span className="font-mono text-[10px] text-muted-foreground uppercase">
                                {connected[p.id] ? `${connected[p.id]} connected` : ready ? "Ready" : demo ? "Sandbox only" : "Not set up"}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="max-w-[240px] px-4 py-3 leading-snug">{SOCIAL_REQUIREMENTS[p.id]}</td>
                        <td className="px-4 py-3 leading-snug">{p.postTypes.map((t) => t.label).join(", ")}</td>
                        <td className="max-w-[260px] px-4 py-3 leading-snug text-muted-foreground">{p.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-md border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <PlatformIcon platform="webhook" className="size-4" /> Webhook
                </p>
                <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{PLATFORMS.webhook.notes} Every request is signed, so your endpoint can check it came from Relay.</p>
              </div>
              <div className="rounded-md border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <PlatformIcon platform="manual" className="size-4" /> Manual reminder
                </p>
                <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{PLATFORMS.manual.notes}</p>
              </div>
            </div>
          </section>

          <section id="communities" className="scroll-mt-20">
            <SectionTitle n="03" aside={<Link href="/communities" className="text-xs text-muted-foreground hover:text-foreground">Communities →</Link>}>
              Connect communities
            </SectionTitle>
            <p className="mb-5 max-w-3xl text-[14px] leading-relaxed">
              Groups, channels and servers connect with a bot, a webhook or an app password instead of a sign-in page. Relay checks the details with the platform before saving them. Once connected, a community shows up in the composer next to your social accounts, and in <b>Communities</b>, where one box sends a message or poll to all of them.
            </p>
            <CommunityTabs connected={connected} canManage={canManage} />
            <div className="mt-6 rounded-md border">
              <p className="border-b px-4 py-2.5 font-mono text-[10.5px] tracking-wider text-muted-foreground uppercase">No posting API, and what to do instead</p>
              <dl className="divide-y">
                {NO_API.map((x) => (
                  <div key={x.name} className="grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[260px_1fr]">
                    <dt className="font-medium">{x.name}</dt>
                    <dd className="text-muted-foreground">{x.instead}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section id="compose" className="scroll-mt-20">
            <SectionTitle n="04" aside={<Link href="/compose" className="text-xs text-muted-foreground hover:text-foreground">Compose →</Link>}>
              Write and schedule
            </SectionTitle>
            <div className="grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-2">
              {[
                { t: "One post, many channels", d: "Pick channels at the top of the composer. The main text and media go to all of them, each checked against that platform's limits as you type." },
                { t: "Different text per platform", d: "Open a channel's tab to give it its own caption, description, title or headline, plus options like subreddit, visibility or silent send.", f: "channelCaptions" as Feature },
                { t: "Video cut per platform", d: "Trim, crop to 9:16, 1:1, 4:5 or 16:9, and add a soundtrack for one channel. Once the post is saved, Render preview on its page shows the finished cut.", f: "channelVideoEdits" as Feature },
                { t: "Polls", d: "Run a poll on Telegram, Discord or Mastodon. From the Communities quick box, groups without polls get the question as a normal message.", f: "polls" as Feature },
                { t: "Now, later or draft", d: "Publish now, pick a date and time in the workspace's timezone, or save a draft. With approvals on, editors' posts wait for an approver." },
                { t: "Queue and calendar", d: "The Queue lists upcoming, published, failed and draft posts. The Calendar shows the month at a glance." },
                { t: "Fix one channel", d: "On a post's page, Edit next to a channel changes only that channel. Fix a failed one and send it again; the others aren't touched.", f: "editAfterPublish" as Feature },
                { t: "Edit sent messages", d: "Fix a typo in a message already live on Telegram, Discord, Slack, Mastodon or Reddit.", f: "liveEdits" as Feature },
              ].map((c) => (
                <div key={c.t} className="bg-card p-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {c.t}
                    {c.f && (
                      <Badge variant={planFeatures(plan)[c.f] ? "outline" : "signal"} className="font-mono text-[9.5px] tracking-wider uppercase">
                        {planFeatures(plan)[c.f] ? "on your plan" : `${PLAN_INFO[planFor(c.f)].name}+`}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{c.d}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
              When a platform has a temporary problem, Relay retries that channel after 1, 4, 15 and 60 minutes. Problems only you can fix, like an expired sign-in, show up under <b className="font-medium text-foreground">Needs attention</b> on the Overview and notify the workspace.
            </p>
          </section>

          <section id="media" className="scroll-mt-20">
            <SectionTitle n="05" aside={<Link href="/media" className="text-xs text-muted-foreground hover:text-foreground">Media →</Link>}>
              Edit media and add music
            </SectionTitle>
            <div className="grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-2">
              {[
                { t: "Crop, rotate and trim", d: "Open any photo or video in Media and press Edit. Crop freely or to 1:1, 4:5, 9:16, 16:9 or 1.91:1, rotate, flip, and trim a video. Save keeps the original and adds an edited copy." },
                { t: "Filters", d: "Essentials come built in. Install more packs (Film, Moody, Vintage, Food & Travel) from the filter store on the Filters tab. Hold to compare shows the original.", f: "mediaStudio" as Feature },
                { t: "Adjustments and your own looks", d: "Brightness, contrast, warmth, highlights, shadows, fade, split tone, vignette, sharpen and grain. Save a look as a filter, import a .cube LUT, or download any filter as a .cube for Lightroom, Premiere or CapCut.", f: "mediaStudio" as Feature },
                { t: "Music", d: "Search the music library by name, genre or mood, preview a track and add it in the editor or the composer's Soundtrack. A photo with a song is saved as a short MP4 for Reels, Shorts and TikTok.", f: "mediaStudio" as Feature },
              ].map((c) => (
                <div key={c.t} className="bg-card p-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {c.t}
                    {c.f && (
                      <Badge variant={planFeatures(plan)[c.f] ? "outline" : "signal"} className="font-mono text-[9.5px] tracking-wider uppercase">
                        {planFeatures(plan)[c.f] ? "on your plan" : `${PLAN_INFO[planFor(c.f)].name}+`}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{c.d}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
              Instagram and TikTok keep their song catalogues inside their own apps, and no outside app can add those songs to a post. Relay&apos;s music comes from Jamendo&apos;s Creative Commons catalogue and is mixed into the file before it&apos;s posted; each track&apos;s licence is saved with it. For a trending TikTok sound, turn on <b className="font-medium text-foreground">Send to drafts</b> and add the sound in the TikTok app.
            </p>
          </section>

          <section id="live" className="scroll-mt-20">
            <SectionTitle n="06" aside={<Link href="/live" className="text-xs text-muted-foreground hover:text-foreground">Live view →</Link>}>
              Watch it live
            </SectionTitle>
            <p className="max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
              <b className="font-medium text-foreground">Live view</b> shows every published post as the platforms see it now, so there&apos;s no need to open each app. <b className="font-medium text-foreground">Posts</b> has each one&apos;s status and numbers, <b className="font-medium text-foreground">Comments</b> collects comments from every channel with a reply box, and <b className="font-medium text-foreground">Channels</b> shows which connections need a reconnect. It refreshes every minute while open.
            </p>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
              Comments and replies work on Instagram, Facebook Pages, YouTube, Threads, Reddit, Bluesky, Mastodon and Slack threads. X, TikTok and Discord show numbers only. Telegram, WhatsApp, Pinterest and LinkedIn don&apos;t share stats with apps, so Relay shows its own delivery status. Channels connected before this update need a reconnect to grant the read permissions.
            </p>
          </section>

          <section id="pricing" className="scroll-mt-20">
            <SectionTitle n="07" aside={<Link href="/billing" className="text-xs text-muted-foreground hover:text-foreground">Plan & billing →</Link>}>
              Plans and pricing
            </SectionTitle>
            <p className="mb-5 max-w-3xl text-[14px] leading-relaxed">
              Every plan can publish everywhere. Paid plans add room (channels, posts, storage, seats) and the tools for tailoring each platform. You&apos;re on <b>{PLAN_INFO[plan].name}</b>.
            </p>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead>
                  <tr className="border-b">
                    <th className="w-[34%] px-4 py-3" />
                    {PLANS.map((p) => (
                      <th key={p} className={`px-4 py-3 align-bottom font-normal ${p === plan ? "bg-accent/50" : ""}`}>
                        <span className="eyebrow block">
                          {PLAN_INFO[p].name}
                          {p === plan && <span className="ml-1.5 text-signal">· yours</span>}
                        </span>
                        <span className="mt-1 block font-serif text-3xl leading-none">{formatPrice(prices[p].month)}</span>
                        <span className="mt-1 block font-mono text-[10.5px] text-muted-foreground">{prices[p].year.amount ? `/ mo, or ${formatPrice(prices[p].year)} a year` : "forever"}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Channels", v: (p: Plan) => PLAN_LIMITS[p].accounts.toLocaleString() },
                    { label: "Posts a month", v: (p: Plan) => PLAN_LIMITS[p].postsPerMonth.toLocaleString() },
                    { label: "Media storage", v: (p: Plan) => (PLAN_LIMITS[p].storageMb >= 1000 ? `${PLAN_LIMITS[p].storageMb / 1000} GB` : `${PLAN_LIMITS[p].storageMb} MB`) },
                    { label: "Team seats", v: (p: Plan) => String(PLAN_LIMITS[p].seats) },
                  ].map((row) => (
                    <tr key={row.label} className="border-b">
                      <td className="px-4 py-2.5 text-muted-foreground">{row.label}</td>
                      {PLANS.map((p) => (
                        <td key={p} className={`px-4 py-2.5 font-mono tabular-nums ${p === plan ? "bg-accent/50" : ""}`}>
                          {row.v(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {features.map((f) => (
                    <tr key={f} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="block">{FEATURE_LABELS[f].title}</span>
                        <span className="block text-xs leading-snug text-muted-foreground">{FEATURE_LABELS[f].body}</span>
                      </td>
                      {PLANS.map((p) => (
                        <td key={p} className={`px-4 py-2.5 ${p === plan ? "bg-accent/50" : ""}`}>
                          {planFeatures(p)[f] ? <CheckIcon className="size-4 text-ok" aria-label="Included" /> : <MinusIcon className="size-4 text-muted-foreground/50" aria-label="Not included" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <ul className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                {provider === "razorpay" && (
                  <>
                    <li>Pay with UPI, cards or netbanking through Razorpay. Prices are in rupees; yearly billing costs less than paying monthly.</li>
                    <li>An upgrade unlocks right after payment. Switching plans starts a new subscription and ends the old one once it&apos;s paid.</li>
                    <li>Moving to Free cancels the subscription; you keep the paid plan until the end of the period you paid for.</li>
                  </>
                )}
                {provider === "demo" && <li>This server runs in demo mode until Razorpay is set up: plans switch straight away and no payment is taken, so you can try every feature.</li>}
                {provider === "none" && <li>Payments aren&apos;t set up on this server yet. A Relay administrator can change your plan for you.</li>}
                <li>Only the workspace owner and admins can change the plan. The plan belongs to the workspace, so everyone in it gets the same features.</li>
              </ul>
              <Button asChild variant="signal">
                <Link href="/billing">
                  {plan === "free" ? "See plans" : "Manage plan"} <ArrowRightIcon />
                </Link>
              </Button>
            </div>
          </section>

          <section id="team" className="scroll-mt-20">
            <SectionTitle n="08" aside={<Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground">Settings →</Link>}>
              Team and roles
            </SectionTitle>
            <p className="mb-5 max-w-3xl text-[14px] leading-relaxed">
              Add people in <b>Settings → Members</b> with the email they signed up with, and give each a role. Turn on <b>Require approval</b> in Settings to have an approver check editors&apos; posts before they go out. You are {ctx.role === "owner" ? "the" : ctx.role === "viewer" ? "a" : "an"} <b>{ctx.role}</b> here.
            </p>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b font-mono text-[10.5px] tracking-wider text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-normal" />
                    {ROLES.map((r) => (
                      <th key={r} className={`px-3 py-2.5 text-center font-normal ${r === ctx.role ? "text-foreground" : ""}`}>
                        {r}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLE_MATRIX.map((row) => (
                    <tr key={row.can} className="border-b last:border-0">
                      <td className="px-4 py-2.5">{row.can}</td>
                      {ROLES.map((r) => (
                        <td key={r} className={`px-3 py-2.5 ${r === ctx.role ? "bg-accent/50" : ""}`}>
                          {row.roles.includes(r) ? <CheckIcon className="mx-auto size-4 text-ok" aria-label="Yes" /> : <CircleIcon className="mx-auto size-1.5 fill-muted-foreground/30 text-transparent" aria-label="No" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="faq" className="scroll-mt-20">
            <SectionTitle n="09">Questions</SectionTitle>
            <Accordion type="multiple" className="rounded-md border bg-card px-4">
              {FAQ.map((f, i) => (
                <AccordionItem key={i} value={String(i)}>
                  <AccordionTrigger>{f.q}</AccordionTrigger>
                  <AccordionContent className="max-w-3xl leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        </div>
      </div>
    </div>
  );
}
