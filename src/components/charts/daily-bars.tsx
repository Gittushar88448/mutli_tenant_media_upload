"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";

type Row = { day: string; total: number; byPlatform: Record<string, number> };

export function DailyPlatformBars({ data, platforms }: { data: Row[]; platforms: string[] }) {
  const rows = data.map((r) => ({ day: r.day.slice(5).replace("-", "/"), ...r.byPlatform }));
  const color = (p: string) => {
    const c = PLATFORMS[p as TargetPlatform]?.color ?? "#888";
    return c === "#111111" ? "var(--foreground)" : c;
  };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 0, left: -24, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 10.5, fontFamily: "var(--font-mono)", fill: "var(--muted-foreground)" }} interval={1} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10.5, fontFamily: "var(--font-mono)", fill: "var(--muted-foreground)" }} />
        <Tooltip
          cursor={{ fill: "var(--accent)", opacity: 0.5 }}
          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
          labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}
        />
        {platforms.map((p, i) => (
          <Bar key={p} dataKey={p} name={PLATFORMS[p as TargetPlatform]?.name ?? p} stackId="a" fill={color(p)} radius={i === platforms.length - 1 ? [2, 2, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
