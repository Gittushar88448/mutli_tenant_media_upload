/** Status lists safe to import from client components (no mongoose). */
export const TARGET_STATUSES = ["scheduled", "queued", "preparing", "uploading", "processing", "published", "retrying", "needs_action", "failed", "cancelled"] as const;
export const POST_STATUSES = ["draft", "pending_approval", "scheduled", "publishing", "done", "partially_failed", "failed", "cancelled"] as const;
