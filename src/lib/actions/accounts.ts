"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { AppSettings, OAuthCredential, PLAN_LIMITS, PostTarget, SocialAccount, oid, isOid } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { encrypt, randomToken } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { assertSafeWebhookUrl } from "@/lib/ssrf";
import { PLATFORMS, SOCIAL_PLATFORMS, isPlatformConfigured, type PlatformId } from "@/lib/platforms";
import { demoMode } from "@/lib/publishing/n8n";
import type { FormState } from "./auth";

async function guard() {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "admin")) throw new Error("Only workspace owners and admins can manage channels.");
  return ctx;
}

async function assertCapacity(workspaceId: string, plan: string) {
  const limit = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.accounts ?? 3;
  const n = await SocialAccount.countDocuments({ workspaceId: oid(workspaceId), status: { $ne: "disabled" } });
  if (n >= limit) throw new Error(`Your plan allows ${limit} channels. Disable one or upgrade.`);
}

const SandboxSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS.map((p) => p.id) as [PlatformId, ...PlatformId[]]),
  handle: z.string().trim().min(2).max(60),
  displayName: z.string().trim().max(80).optional(),
  profileUrl: z.union([z.url(), z.literal("")]).optional(),
  accountType: z.string().max(30).optional(),
});

/**
 * Demo/sandbox connect: creates an account that behaves like a real one in the UI and
 * in the publishing engine, but publishes nowhere. Only offered while the platform's
 * OAuth app isn't configured and demo mode is on.
 */
export async function connectSandboxAccountAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const parsed = SandboxSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Fill in a handle (2–60 characters) and a valid profile URL." };
    if (!demoMode()) return { error: "Sandbox channels are turned off on this server." };
    if (isPlatformConfigured(parsed.data.platform)) return { error: "This platform is set up for real sign-in. Use Connect instead." };
    await connectDB();
    await assertCapacity(ctx.workspace.id, ctx.workspace.plan);
    const settings = await AppSettings.findOne({ key: "global" }).lean();
    if (settings?.disabledPlatforms?.includes(parsed.data.platform)) return { error: "This platform is turned off by the administrator." };

    const handle = parsed.data.handle.startsWith("@") || parsed.data.platform === "youtube" || parsed.data.platform === "facebook" ? parsed.data.handle : `@${parsed.data.handle}`;
    const acc = await SocialAccount.create({
      workspaceId: oid(ctx.workspace.id),
      platform: parsed.data.platform,
      externalId: `sandbox_${randomToken(8)}`,
      handle,
      displayName: parsed.data.displayName || handle,
      accountType: parsed.data.accountType || defaultAccountType(parsed.data.platform),
      profileUrl: parsed.data.profileUrl || undefined,
      sandbox: true,
      connectedBy: oid(ctx.user.id),
      scopes: PLATFORMS[parsed.data.platform].oauth?.scopes,
    });
    await OAuthCredential.create({
      socialAccountId: acc._id,
      workspaceId: oid(ctx.workspace.id),
      accessTokenEnc: encrypt(`sandbox-token-${randomToken()}`),
      expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
    });
    await audit({ action: "channel.connected", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "social_account", entityId: String(acc._id), meta: { platform: acc.platform, sandbox: true } });
    revalidatePath("/accounts");
    return { ok: true, message: `${PLATFORMS[parsed.data.platform].name} sandbox channel added` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function defaultAccountType(p: PlatformId) {
  return { instagram: "business", facebook: "page", youtube: "channel", tiktok: "creator", linkedin: "member", x: "user", threads: "profile", pinterest: "business" }[p];
}

const WebhookSchema = z.object({
  name: z.string().trim().min(2).max(60),
  endpointUrl: z.string().trim().max(500),
  authHeader: z.string().trim().max(500).optional(),
});

export async function createWebhookConnectorAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const parsed = WebhookSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Name the connector and give it an endpoint URL." };
    const url = await assertSafeWebhookUrl(parsed.data.endpointUrl);
    await connectDB();
    await assertCapacity(ctx.workspace.id, ctx.workspace.plan);
    const secret = `whsec_${randomToken(24)}`;
    const acc = await SocialAccount.create({
      workspaceId: oid(ctx.workspace.id),
      platform: "webhook",
      externalId: `webhook_${randomToken(8)}`,
      handle: parsed.data.name,
      displayName: url.host,
      accountType: "webhook",
      profileUrl: url.origin,
      connectedBy: oid(ctx.user.id),
      connector: {
        endpointUrl: url.toString(),
        authHeaderEnc: parsed.data.authHeader ? encrypt(parsed.data.authHeader) : undefined,
        signingSecretEnc: encrypt(secret),
      },
    });
    await audit({ action: "connector.created", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "social_account", entityId: String(acc._id), meta: { kind: "webhook", host: url.host } });
    revalidatePath("/accounts");
    // The signing secret is shown once, so the receiver can verify X-Relay-Signature.
    return { ok: true, message: secret };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const ManualSchema = z.object({
  name: z.string().trim().min(2).max(60),
  profileUrl: z.union([z.url(), z.literal("")]).optional(),
  notifyEmail: z.union([z.email(), z.literal("")]).optional(),
});

export async function createManualConnectorAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const parsed = ManualSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Name it, and check the URL and email." };
    await connectDB();
    await assertCapacity(ctx.workspace.id, ctx.workspace.plan);
    const acc = await SocialAccount.create({
      workspaceId: oid(ctx.workspace.id),
      platform: "manual",
      externalId: `manual_${randomToken(8)}`,
      handle: parsed.data.name,
      displayName: parsed.data.profileUrl ? new URL(parsed.data.profileUrl).host : parsed.data.name,
      accountType: "manual",
      profileUrl: parsed.data.profileUrl || undefined,
      connectedBy: oid(ctx.user.id),
      connector: { notifyEmail: parsed.data.notifyEmail || ctx.user.email },
    });
    await audit({ action: "connector.created", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "social_account", entityId: String(acc._id), meta: { kind: "manual" } });
    revalidatePath("/accounts");
    return { ok: true, message: "Manual channel added" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setAccountEnabledAction(accountId: string, enabled: boolean) {
  const ctx = await guard();
  if (!isOid(accountId)) return;
  const acc = await SocialAccount.findOne({ _id: oid(accountId), workspaceId: oid(ctx.workspace.id) });
  if (!acc) return;
  if (enabled) await assertCapacity(ctx.workspace.id, ctx.workspace.plan);
  acc.status = enabled ? "active" : "disabled";
  await acc.save();
  await audit({ action: enabled ? "channel.enabled" : "channel.disabled", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "social_account", entityId: accountId });
  revalidatePath("/accounts");
}

/** Removes the channel and its tokens. Undelivered targets to it are cancelled, history is kept. */
export async function disconnectAccountAction(accountId: string) {
  const ctx = await guard();
  if (!isOid(accountId)) return;
  const acc = await SocialAccount.findOne({ _id: oid(accountId), workspaceId: oid(ctx.workspace.id) });
  if (!acc) return;
  await PostTarget.updateMany(
    { socialAccountId: acc._id, status: { $in: ["scheduled", "retrying", "needs_action"] } },
    { $set: { status: "cancelled", lastErrorCode: "CHANNEL_DISCONNECTED" } }
  );
  await OAuthCredential.deleteOne({ socialAccountId: acc._id });
  acc.status = "revoked";
  await acc.save();
  await audit({ action: "channel.disconnected", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "social_account", entityId: accountId, meta: { platform: acc.platform } });
  revalidatePath("/accounts");
}
