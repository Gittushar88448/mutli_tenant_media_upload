import "server-only";
import { DIRECT_PLATFORMS } from "@/lib/platforms";
import { claimDueTargets, recordTargetEvent } from "./engine";
import { deliverDirect } from "./direct";

/**
 * Development stand-in for the n8n workflows. It goes through exactly the same claim and
 * event code paths, so the UI behaves the way it will in production. Platforms with a
 * built-in connector (communities, Reddit) really deliver, sandbox or not. Other real
 * accounts fail with a clear message telling you to run n8n.
 */
export async function runSimulatedDispatch(onlyIds?: string[]) {
  const claimed = await claimDueTargets({ workerId: "simulator", onlyIds, limit: 50 });
  for (const t of claimed) {
    if ((DIRECT_PLATFORMS as string[]).includes(t.platform)) {
      await deliverDirect(t.id, "sim");
      continue;
    }
    await recordTargetEvent(t.id, { step: "preparing", executionId: "sim" });
    await recordTargetEvent(t.id, { step: "uploading", executionId: "sim", platformContainerId: `sim_container_${t.id.slice(-6)}` });
    if (t.platform === "manual") {
      await recordTargetEvent(t.id, { step: "needs_action", errorCode: "MANUAL_POST_DUE", message: "It's time to post this one yourself, then mark it done." });
      continue;
    }
    if (!t.account.sandbox) {
      await recordTargetEvent(t.id, {
        step: "failed",
        errorCode: "N8N_NOT_CONFIGURED",
        message: "This is a real account; publishing it needs the n8n workflows running.",
        retryable: false,
      });
      continue;
    }
    // Sandbox: roughly one in eight uploads fails with a retryable error so retries are visible.
    if (t.attempt === 1 && Math.random() < 0.125) {
      await recordTargetEvent(t.id, { step: "failed", errorCode: "RATE_LIMITED", httpStatus: 429, message: "Simulated platform rate limit", retryable: true });
      continue;
    }
    await recordTargetEvent(t.id, { step: "processing", executionId: "sim" });
    const postId = `sim_${Date.now().toString(36)}${t.id.slice(-4)}`;
    await recordTargetEvent(t.id, {
      step: "published",
      executionId: "sim",
      platformPostId: postId,
      permalink: `https://example.com/${t.platform}/${t.account.handle.replace(/^@/, "")}/${postId}`,
    });
  }
  return claimed.length;
}
