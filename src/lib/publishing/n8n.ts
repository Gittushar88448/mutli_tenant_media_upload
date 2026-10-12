import "server-only";

/** "Publish now": ask n8n's webhook trigger to run these targets instead of waiting a minute. */
export async function triggerN8nPublishNow(targetIds: string[]) {
  const url = process.env.N8N_PUBLISH_NOW_WEBHOOK_URL;
  if (!url) return { ok: false as const, reason: "not_configured" as const };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-secret": process.env.N8N_SHARED_SECRET ?? "" },
      body: JSON.stringify({ targetIds }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? { ok: true as const } : { ok: false as const, reason: "http_error" as const, status: res.status };
  } catch {
    return { ok: false as const, reason: "unreachable" as const };
  }
}

export function n8nConfigured() {
  return Boolean(process.env.N8N_PUBLISH_NOW_WEBHOOK_URL && process.env.N8N_SHARED_SECRET);
}

export function demoMode() {
  if (process.env.DEMO_MODE === "true") return true;
  if (process.env.DEMO_MODE === "false") return false;
  return process.env.NODE_ENV !== "production";
}
