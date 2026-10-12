import { cn } from "@/lib/utils";

/** Editorial page head: numbered eyebrow, serif title, actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="display text-[44px] md:text-[52px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ n, children, aside }: { n?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      {n && <span className="font-mono text-[11px] text-signal">{n}</span>}
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      <span className="rule-dashed flex-1 translate-y-[-3px]" />
      {aside}
    </div>
  );
}
