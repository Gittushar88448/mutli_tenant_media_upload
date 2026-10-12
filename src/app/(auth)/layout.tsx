import { Logo } from "@/components/logo";
import { PlatformIcon } from "@/components/platform-icon";

const LOG = [
  { t: "09:00", p: "instagram", h: "@northwind.studio", s: "Reel · published" },
  { t: "09:00", p: "tiktok", h: "@northwind", s: "Video · sent to drafts" },
  { t: "09:01", p: "youtube", h: "Northwind Studio", s: "Short · processing" },
  { t: "12:30", p: "facebook", h: "Northwind Studio", s: "Page post · scheduled" },
  { t: "12:30", p: "linkedin", h: "Northwind", s: "Image post · scheduled" },
  { t: "18:15", p: "threads", h: "@northwind.studio", s: "Carousel · scheduled" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-foreground text-background lg:flex lg:flex-col">
        <div className="grain absolute inset-0 opacity-30" />
        <div className="relative flex items-center justify-between p-10">
          <Logo className="[&_span]:text-background [&_rect]:fill-background [&_path]:stroke-foreground" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-background/50">Desk · Today</span>
        </div>
        <div className="relative mt-auto px-10 pb-6">
          <p className="display max-w-[16ch] text-[64px] text-background">
            Write it once. <em className="text-signal">Send it everywhere</em> on time.
          </p>
        </div>
        <div className="relative border-t border-background/15 px-10 py-6">
          <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-background/45">Outgoing</p>
          <ul className="divide-y divide-background/10 font-mono text-[12.5px]">
            {LOG.map((r, i) => (
              <li key={i} className="flex items-center gap-4 py-2.5">
                <span className="w-12 text-background/50 tabular-nums">{r.t}</span>
                <PlatformIcon platform={r.p} tone="plain" className="size-4 text-background/80" />
                <span className="w-44 truncate text-background/90">{r.h}</span>
                <span className="text-background/50">{r.s}</span>
                {i < 2 && <span className="ml-auto size-1.5 rounded-full bg-signal" />}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-6 lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
