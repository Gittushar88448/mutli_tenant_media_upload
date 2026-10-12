import Link from "next/link";
import { LockIcon } from "lucide-react";
import { FEATURE_LABELS, PLAN_INFO, planFor, type Feature } from "@/lib/plans";
import { cn } from "@/lib/utils";

/** Inline "this is a paid feature" note with a link to the plans page. */
export function UpgradeHint({ feature, className, compact }: { feature: Feature; className?: string; compact?: boolean }) {
  const plan = planFor(feature);
  if (compact) {
    return (
      <Link href={`/billing?feature=${feature}`} className={cn("inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground uppercase hover:text-foreground", className)}>
        <LockIcon className="size-3" /> {PLAN_INFO[plan].name}
      </Link>
    );
  }
  return (
    <div className={cn("flex items-start gap-3 rounded-md border border-dashed bg-muted/40 px-3 py-2.5", className)}>
      <LockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p className="text-[12.5px] leading-snug text-muted-foreground">
        <span className="font-medium text-foreground">{FEATURE_LABELS[feature].title}</span> is on {PLAN_INFO[plan].name} and above.{" "}
        <Link href={`/billing?feature=${feature}`} className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4">
          See plans
        </Link>
      </p>
    </div>
  );
}
