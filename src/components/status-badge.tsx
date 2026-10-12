import { Badge } from "@/components/ui/badge";

const MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "signal" | "ok" | "warn" }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending_approval: { label: "Awaiting approval", variant: "warn" },
  scheduled: { label: "Scheduled", variant: "outline" },
  publishing: { label: "Publishing", variant: "signal" },
  done: { label: "Published", variant: "ok" },
  partially_failed: { label: "Partly failed", variant: "warn" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  queued: { label: "Queued", variant: "signal" },
  preparing: { label: "Preparing", variant: "signal" },
  uploading: { label: "Uploading", variant: "signal" },
  processing: { label: "Processing", variant: "signal" },
  published: { label: "Published", variant: "ok" },
  retrying: { label: "Retrying", variant: "warn" },
  needs_action: { label: "Needs action", variant: "warn" },
  active: { label: "Active", variant: "ok" },
  suspended: { label: "Suspended", variant: "destructive" },
  invited: { label: "Invited", variant: "secondary" },
  needs_reauth: { label: "Reconnect", variant: "warn" },
  revoked: { label: "Revoked", variant: "destructive" },
  disabled: { label: "Disabled", variant: "secondary" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status.replace(/_/g, " "), variant: "outline" as const };
  return (
    <Badge variant={s.variant}>
      {["publishing", "queued", "preparing", "uploading", "processing"].includes(status) && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {s.label}
    </Badge>
  );
}
