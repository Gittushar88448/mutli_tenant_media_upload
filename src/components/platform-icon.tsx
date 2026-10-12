import { HandIcon, WebhookIcon } from "lucide-react";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/** Hand-drawn platform marks (lucide no longer ships brand icons). */
function Glyph({ platform }: { platform: TargetPlatform }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (platform) {
    case "instagram":
      return (
        <g {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
        </g>
      );
    case "facebook":
      return <path {...common} d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 4v2.2H9v3h2.5V21" />;
    case "youtube":
      return (
        <g {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" />
        </g>
      );
    case "tiktok":
      return <path {...common} d="M14 3.5v11.2a3.7 3.7 0 1 1-3.2-3.7M14 3.5c.4 2.6 2.1 4.2 4.8 4.4" />;
    case "linkedin":
      return (
        <g {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
          <path d="M8 10.5V16M8 7.8v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.3-2.6s2.2.9 2.2 2.6v3" />
        </g>
      );
    case "x":
      return <path {...common} d="M4.5 4.5l15 15M19.5 4.5l-15 15" />;
    case "threads":
      return <path {...common} d="M16.5 11.2c-.5-2.6-2.4-3.7-4.4-3.7-2.6 0-4.6 2-4.6 4.6 0 2.9 2 4.8 4.7 4.8 2.3 0 3.9-1.3 3.9-3.2 0-2.6-3.6-3-5.4-2.2M12 21c-5 0-8.5-3.6-8.5-9S7 3 12 3c3.9 0 6.7 2 7.8 5.4" />;
    case "pinterest":
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M10.6 20.2l1.8-7.4M10.4 15c3.6 1.3 6.1-1 6.1-4.1 0-2.5-2-4.4-4.6-4.4-3 0-4.9 2.1-4.9 4.6 0 .9.3 1.7.9 2.1" />
        </g>
      );
    default:
      return null;
  }
}

export function PlatformIcon({
  platform,
  className,
  tone = "brand",
}: {
  platform: TargetPlatform | string;
  className?: string;
  tone?: "brand" | "plain" | "chip";
}) {
  const spec = PLATFORMS[platform as TargetPlatform];
  if (!spec) return null;
  const isConnector = platform === "webhook" || platform === "manual";
  const icon = isConnector ? (
    platform === "webhook" ? <WebhookIcon className="size-full" strokeWidth={1.8} /> : <HandIcon className="size-full" strokeWidth={1.8} />
  ) : (
    <svg viewBox="0 0 24 24" className="size-full" aria-hidden>
      <Glyph platform={platform as TargetPlatform} />
    </svg>
  );

  if (tone === "chip") {
    return (
      <span
        title={spec.name}
        className={cn("inline-flex size-6 items-center justify-center rounded-[5px] p-[3px] text-white", className)}
        style={{ backgroundColor: spec.color }}
      >
        {icon}
      </span>
    );
  }
  return (
    <span
      title={spec.name}
      className={cn("inline-flex size-4 shrink-0", className)}
      style={tone === "brand" ? { color: spec.color === "#111111" ? "var(--foreground)" : spec.color } : undefined}
    >
      {icon}
    </span>
  );
}

export function PlatformStack({ platforms, max = 5 }: { platforms: string[]; max?: number }) {
  const shown = platforms.slice(0, max);
  return (
    <span className="inline-flex items-center -space-x-1">
      {shown.map((p) => (
        <PlatformIcon key={p} platform={p} tone="chip" className="size-5 ring-2 ring-card" />
      ))}
      {platforms.length > max && <span className="ml-2 font-mono text-[11px] text-muted-foreground">+{platforms.length - max}</span>}
    </span>
  );
}
