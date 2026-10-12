import Link from "next/link";
import { cn } from "@/lib/utils";

/** One line in, several lines out: the fan-out the product is built on. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6", className)} aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" className="fill-foreground" />
      <circle cx="9" cy="16" r="2.6" className="fill-signal" />
      <path d="M11.5 16 L23 8.5 M11.5 16 L24 16 M11.5 16 L23 23.5" className="stroke-background" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-serif text-[26px] leading-none tracking-tight">Relay</span>
    </Link>
  );
}
