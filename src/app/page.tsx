import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";

const FANOUT = [
  { p: "instagram", h: "@northwind.studio", t: "Reel", s: "Published", c: "text-ok" },
  { p: "tiktok", h: "@northwind", t: "Video · drafts", s: "Published", c: "text-ok" },
  { p: "youtube", h: "Northwind Studio", t: "Short", s: "Processing", c: "text-signal" },
  { p: "facebook", h: "Northwind Studio", t: "Reel", s: "Uploading", c: "text-signal" },
  { p: "linkedin", h: "Northwind", t: "Video", s: "09:30", c: "text-muted-foreground" },
];

export default async function Landing() {
  const user = await getCurrentUser().catch(() => null);
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#honest" className="hover:text-foreground">What platforms allow</a>
          <a href="#channels" className="hover:text-foreground">Channels</a>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">Open your desk</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Start free</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto grid max-w-[1240px] gap-12 px-6 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
        <div>
          <p className="eyebrow">A publishing desk for short video</p>
          <h1 className="display mt-5 text-[64px] sm:text-[84px] lg:text-[104px]">
            One upload.
            <br />
            <em className="text-signal not-italic">Every</em> feed.
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
            Connect Instagram, TikTok, YouTube, Facebook and the rest. Write the post once, tune it per channel, and send it now or at the minute you choose. If one platform fails, the others still go out.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" variant="signal" asChild>
              <Link href={user ? "/compose" : "/register"}>
                {user ? "Write a post" : "Create a workspace"} <ArrowRightIcon />
              </Link>
            </Button>
            <span className="font-mono text-xs text-muted-foreground">Free plan · 3 channels · 30 posts a month</span>
          </div>
        </div>

        {/* Fan-out sheet */}
        <div className="relative">
          <div className="grain absolute -inset-4 -z-10 rounded-2xl border border-dashed" />
          <div className="rounded-xl border bg-card p-5 shadow-[0_40px_80px_-40px_rgb(0_0_0/0.35)]">
            <div className="flex items-center justify-between border-b pb-3">
              <span className="eyebrow">Post · Tue 09:00 · Asia/Kolkata</span>
              <span className="rounded-md bg-signal px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-signal-foreground">Live</span>
            </div>
            <div className="mt-4 grid grid-cols-[96px_1fr] gap-4">
              <div className="aspect-[9/16] overflow-hidden rounded-md bg-[linear-gradient(160deg,oklch(0.45_0.17_10),oklch(0.2_0.05_265))]">
                <div className="flex h-full items-end p-2">
                  <span className="font-mono text-[9px] text-white/70">0:24 · 9:16</span>
                </div>
              </div>
              <div>
                <p className="font-serif text-2xl leading-tight">Autumn drop, behind the seams.</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Three weeks, one jacket, and a lot of thread. Full collection Thursday. #slowfashion #studio</p>
                <p className="mt-3 font-mono text-[10.5px] text-muted-foreground">Soundtrack: own audio · Crop 9:16</p>
              </div>
            </div>
            <ul className="mt-5 divide-y border-t">
              {FANOUT.map((r) => (
                <li key={r.p} className="flex items-center gap-3 py-2.5 text-sm">
                  <PlatformIcon platform={r.p} tone="chip" />
                  <span className="w-40 truncate">{r.h}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.t}</span>
                  <span className={`ml-auto font-mono text-[11px] uppercase ${r.c}`}>{r.s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="how" className="border-y bg-card/40">
        <div className="mx-auto grid max-w-[1240px] md:grid-cols-3 md:divide-x">
          {[
            ["01", "Connect", "Sign in to each platform once. Relay keeps the tokens encrypted and refreshes them before they lapse."],
            ["02", "Compose", "Pick the video or photos, add your own soundtrack, write one caption and override it where a channel needs something different."],
            ["03", "Confirm", "Every channel's rules are checked before anything is sent. Publish now or schedule it; each delivery is tracked on its own."],
          ].map(([n, t, d]) => (
            <div key={n} className="px-6 py-12 md:px-10">
              <span className="font-mono text-xs text-signal">{n}</span>
              <h3 className="display mt-3 text-4xl">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="honest" className="mx-auto max-w-[1240px] px-6 py-20">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="eyebrow">Straight answers</p>
            <h2 className="display mt-3 text-5xl">What the platforms actually allow.</h2>
          </div>
          <ol className="divide-y border-y">
            {[
              ["You connect by signing in, not by pasting a link.", "Posting needs the account owner's permission through each platform's own sign-in. A profile URL is a label, not a key."],
              ["Trending sounds stay in the apps.", "No publishing API offers a platform's music library. Use your own or licensed audio, or send TikTok posts to drafts and add a sound there."],
              ["Business and creator accounts only.", "Instagram needs a Professional account and Facebook a Page. Personal profiles and Groups can't be posted to through the API."],
            ].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[40px_1fr] gap-4 py-6">
                <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-lg font-medium">{t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="channels" className="border-t">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6 px-6 py-12">
          <p className="eyebrow">Channels</p>
          <div className="flex flex-wrap items-center gap-6">
            {["instagram", "facebook", "youtube", "tiktok", "linkedin", "x", "threads", "pinterest", "webhook", "manual"].map((p) => (
              <PlatformIcon key={p} platform={p} tone="plain" className="size-6 text-foreground/70" />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-foreground text-background">
        <div className="mx-auto flex max-w-[1240px] flex-col items-start gap-6 px-6 py-20 md:flex-row md:items-end md:justify-between">
          <h2 className="display max-w-[14ch] text-6xl">Your next post can go everywhere by nine.</h2>
          <ul className="space-y-2 text-sm text-background/70">
            {["Approvals for teams and agencies", "Per-channel captions and settings", "Retries with backoff, never double posts"].map((x) => (
              <li key={x} className="flex items-center gap-2">
                <CheckIcon className="size-4 text-signal" /> {x}
              </li>
            ))}
            <li className="pt-4">
              <Button variant="signal" size="lg" asChild>
                <Link href={user ? "/dashboard" : "/register"}>
                  Get started <ArrowRightIcon />
                </Link>
              </Button>
            </li>
          </ul>
        </div>
      </section>
      <footer className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-8 font-mono text-[11px] text-muted-foreground">
        <span>© {new Date().getFullYear()} Relay</span>
        <span>Built on Next.js, MongoDB and n8n</span>
      </footer>
    </div>
  );
}
