"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 10.5, fontFamily: "var(--font-mono)", fill: "var(--muted-foreground)" };
const tip = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 },
  labelStyle: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" },
};

export function PublishVolumeChart({ data }: { data: { day: string; published: number; failed: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: d.day.slice(5).replace("-", "/") }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 8, right: 0, left: -24, bottom: 0 }} barCategoryGap={3}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axis} interval={4} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={axis} />
        <Tooltip cursor={{ fill: "var(--accent)", opacity: 0.5 }} {...tip} />
        <Bar dataKey="published" name="Published" stackId="a" fill="var(--foreground)" />
        <Bar dataKey="failed" name="Failed" stackId="a" fill="var(--signal)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SignupSpark({ data }: { data: { day: string; n: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="sig" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--signal)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--signal)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" hide />
        <Tooltip {...tip} />
        <Area type="monotone" dataKey="n" name="Sign-ups" stroke="var(--signal)" strokeWidth={1.75} fill="url(#sig)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
