"use client";

import { formatDistanceToNowStrict } from "date-fns";

// Relative times can tick over between the server render and hydration, so the
// text is allowed to differ there; it settles on the client's value.
export function TimeAgo({ date, prefix = "", className }: { date: string | Date; prefix?: string; className?: string }) {
  return (
    <span className={className} suppressHydrationWarning>
      {prefix}
      {formatDistanceToNowStrict(new Date(date), { addSuffix: true })}
    </span>
  );
}
