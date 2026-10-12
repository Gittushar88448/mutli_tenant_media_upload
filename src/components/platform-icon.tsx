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
    case "reddit":
      return (
        <g {...common}>
          <ellipse cx="12" cy="14" rx="7.5" ry="5.2" />
          <path d="M12 8.8l1.2-4.6 3.6.9" />
          <circle cx="18" cy="5.4" r="1.3" />
          <circle cx="9.3" cy="13.3" r="0.7" fill="currentColor" />
          <circle cx="14.7" cy="13.3" r="0.7" fill="currentColor" />
          <path d="M9.4 16.2c1.6 1 3.6 1 5.2 0" />
        </g>
      );
    case "telegram":
      return <path {...common} d="M20.5 4.2L3.4 10.9c-.8.3-.8 1.4 0 1.6l4.3 1.4 1.7 5.1c.2.7 1.1.9 1.6.4l2.4-2.3 4.4 3.3c.6.4 1.4.1 1.6-.6l2.9-14.2c.2-.9-.7-1.6-1.6-1.4zM7.7 13.9l9.4-6.3-6.9 7.5-.4 3.8" />;
    case "whatsapp":
      return (
        <g {...common}>
          <path d="M4 20l1.2-4.1A8.4 8.4 0 1 1 8.4 19z" />
          <path d="M9.2 8.6c-.3.9 0 2.3 1.4 3.8 1.5 1.5 3 2 3.9 1.6l.7-1.1-1.6-.9-.8.7c-.8-.3-1.8-1.3-2.1-2.1l.7-.8-.8-1.6z" fill="currentColor" strokeWidth="0.8" />
        </g>
      );
    case "discord":
      return (
        <g {...common}>
          <path d="M8.5 6.2c-1.6.3-3 .9-4.2 1.7C2.6 11.2 2.2 14.4 2.5 17.5c1.5 1.1 3.1 1.9 4.8 2.3l1.1-1.8M15.5 6.2c1.6.3 3 .9 4.2 1.7 1.7 3.3 2.1 6.5 1.8 9.6-1.5 1.1-3.1 1.9-4.8 2.3l-1.1-1.8M7.2 17.2c3.1 1.4 6.5 1.4 9.6 0M8.3 6.9c2.4-.7 5-.7 7.4 0" />
          <circle cx="9.2" cy="13" r="1.2" fill="currentColor" />
          <circle cx="14.8" cy="13" r="1.2" fill="currentColor" />
        </g>
      );
    case "slack":
      return <path {...common} d="M9.5 3.5v7M14.5 13.5v7M3.5 14.5h7M13.5 9.5h7M9.5 3.5a1.8 1.8 0 0 0-1.8 1.8M14.5 20.5a1.8 1.8 0 0 0 1.8-1.8M3.5 14.5a1.8 1.8 0 0 0 1.8 1.8M20.5 9.5a1.8 1.8 0 0 0-1.8-1.8M14.5 3.5v4.2h4.2M9.5 20.5v-4.2H5.3" />;
    case "bluesky":
      return <path {...common} d="M12 11.2C10.6 8.4 7 4 4.6 4.6c-1.9.5-1.2 4.2-.6 5.9.7 1.9 3 2.6 5.5 2.2-3.6.7-4.5 2.7-2.5 4.7 3.3 3.3 4.6-1 5-2.6.4 1.6 1.7 5.9 5 2.6 2-2 1.1-4-2.5-4.7 2.5.4 4.8-.3 5.5-2.2.6-1.7 1.3-5.4-.6-5.9C17 4 13.4 8.4 12 11.2z" />;
    case "mastodon":
      return (
        <g {...common}>
          <path d="M19.4 13.6c-.5 1.9-3.3 3.3-6.1 3.5-2 .1-3.9-.2-5.1-.5.2 2.5 2.4 3 4.6 3 1.3 0 2.6-.3 3.3-.6M4.6 8.2c0-3.4 2.3-4.7 4.8-4.9 1.8-.2 3.6-.2 5.4 0 2.5.2 4.8 1.5 4.8 4.9 0 2 .1 3.7-.2 5.4M4.6 8.2c0 4.6.1 8.4 3.6 9.3" />
          <path d="M8.5 13V9.4a1.7 1.7 0 0 1 3.4 0v2M11.9 11.4V9.4a1.7 1.7 0 0 1 3.4 0V13" />
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
