import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Weekday × hour grid of when posts actually went out. */
export function PublishHeatmap({ cells }: { cells: { d: number; h: number; n: number }[] }) {
  const max = Math.max(1, ...cells.map((c) => c.n));
  const get = (d: number, h: number) => cells.find((c) => c.d === d && c.h === h)?.n ?? 0;
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-[36px_repeat(24,1fr)] gap-[3px]">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center font-mono text-[9px] text-muted-foreground">
            {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </span>
        ))}
        {DAYS.map((label, di) => (
          <div key={label} className="contents">
            <span className="font-mono text-[10px] leading-[18px] text-muted-foreground">{label}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const n = get(di + 1, h);
              const a = n === 0 ? 0 : 0.18 + (n / max) * 0.82;
              return (
                <span
                  key={h}
                  title={`${label} ${String(h).padStart(2, "0")}:00 — ${n} published`}
                  className={cn("h-[18px] rounded-[3px]", n === 0 && "bg-secondary")}
                  style={n ? { backgroundColor: `color-mix(in oklch, var(--signal) ${Math.round(a * 100)}%, transparent)` } : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
