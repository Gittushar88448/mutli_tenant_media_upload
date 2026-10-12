"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { AppSettings, OAuthCredential, PLAN_LIMITS, PostTarget, SocialAccount, oid, isOid } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { encrypt, randomToken } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { assertSafeWebhookUrl } from "@/lib/ssrf";
import { COMMUNITY_PLATFORMS, PLATFORMS, SOCIAL_PLATFORMS, isPlatformConfigured, type CommunityId, type PlatformId } from "@/lib/platforms";
import { ConnectorError, bskySession, discordVerify, mastodonVerify, slackVerify, telegramVerify, whatsappVerify } from "@/lib/publishing/connectors";
import { encryptSecrets } from "@/lib/publishing/direct";
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

type SandboxPlatform = PlatformId | CommunityId;
const SandboxSchema = z.object({
  platform: z.enum([...SOCIAL_PLATFORMS, ...COMMUNITY_PLATFORMS].map((p) => p.id) as [SandboxPlatform, ...SandboxPlatform[]]),
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

    const p = parsed.data.platform;
    const keepAsTyped = parsed.data.handle.startsWith("@") || ["youtube", "facebook", "whatsapp", "slack", "discord", "reddit"].includes(p);
    const handle = keepAsTyped ? parsed.data.handle : `@${parsed.data.handle}`;
    const acc = await SocialAccount.create({
      workspaceId: oid(ctx.workspace.id),
      platform: parsed.data.platform,
      externalId: `sandbox_${randomToken(8)}`,
      handle,
      displayName: parsed.data.displayName || handle,
      accountType: parsed.data.accountType || defaultAccountType(parsed.data.platform),
      profileUrl: parsed.data.profileUrl || undefined,
      audienceSize: PLATFORMS[p].category === "community" ? 40 + Math.floor(Math.random() * 4000) : undefined,
      connector: p === "whatsapp" ? { mode: parsed.data.accountType === "channel" ? "assisted" : "api", recipients: ["+15550000000"] } : undefined,
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
    revalidatePath("/communities");
    return { ok: true, message: `${PLATFORMS[parsed.data.platform].name} sandbox channel added` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function defaultAccountType(p: SandboxPlatform) {
  return {
    instagram: "business",
    facebook: "page",
    youtube: "channel",
    tiktok: "creator",
    linkedin: "member",
    x: "user",
    threads: "profile",
    pinterest: "business",
    reddit: "user",
    telegram: "channel",
    whatsapp: "group",
    discord: "channel",
    slack: "channel",
    bluesky: "profile",
    mastodon: "profile",
  }[p];
}

/**
 * Connects a community or messaging destination with the credential that platform uses
 * (bot token, channel webhook, app password, Cloud API token). Each one is checked against
 * the platform first, so a wrong token fails here rather than at 9:00 on launch day.
 * Secrets are encrypted into OAuthCredential; only routing details go on the account.
 */
export async function connectCommunityAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const platform = String(formData.get("platform")) as CommunityId;
    const spec = COMMUNITY_PLATFORMS.find((p) => p.id === platform);
    if (!spec) return { error: "Unknown platform." };
    const mode = String(formData.get("mode") || spec.credentials?.modes?.[0]?.id || "");
    const v = (k: string) => String(formData.get(k) ?? "").trim();
    for (const f of spec.credentials?.fields ?? []) {
      if (f.required && (!f.mode || f.mode === mode) && !v(f.key)) return { error: `${f.label} is required.` };
    }
    await connectDB();
    await assertCapacity(ctx.workspace.id, ctx.workspace.plan);
    const settings = await AppSettings.findOne({ key: "global" }).lean();
    if (settings?.disabledPlatforms?.includes(platform)) return { error: "This platform is turned off by the administrator." };

    let account: { externalId: string; handle: string; displayName?: string; accountType: string; profileUrl?: string; audienceSize?: number; connector: Record<string, unknown> };
    let secrets: Record<string, string> = {};
    switch (platform) {
      case "telegram": {
        const t = await telegramVerify(v("botToken"), v("chatId"));
        account = { externalId: t.externalId, handle: t.handle, displayName: t.displayName, accountType: t.accountType, profileUrl: t.profileUrl, audienceSize: t.audienceSize, connector: { chatId: t.externalId } };
        secrets = { botToken: v("botToken") };
        break;
      }
      case "discord": {
        const d = await discordVerify(v("webhookUrl"));
        account = { externalId: d.externalId, handle: d.name, displayName: d.name, accountType: "channel", profileUrl: d.guildId ? `https://discord.com/channels/${d.guildId}/${d.channelId}` : undefined, connector: { channelId: d.channelId, guildId: d.guildId } };
        secrets = { webhookUrl: v("webhookUrl") };
        break;
      }
      case "slack": {
        const s = await slackVerify(v("botToken"), v("channelId"));
        account = {
          externalId: s.channel.id,
          handle: `#${s.channel.name}`,
          displayName: s.team,
          accountType: s.channel.is_private ? "private channel" : "channel",
          profileUrl: s.url ? `${s.url.replace(/\/$/, "")}/archives/${s.channel.id}` : undefined,
          audienceSize: s.channel.num_members,
          connector: { channelId: s.channel.id },
        };
        secrets = { botToken: v("botToken") };
        break;
      }
      case "whatsapp": {
        if (mode === "assisted") {
          const invite = v("inviteUrl");
          if (invite && !/^https:\/\/(www\.)?(whatsapp\.com|chat\.whatsapp\.com|wa\.me)\//.test(invite)) return { error: "Use the WhatsApp channel or community invite link." };
          account = { externalId: `assisted_${randomToken(8)}`, handle: v("name"), displayName: v("name"), accountType: "channel", profileUrl: invite || undefined, connector: { mode: "assisted", inviteUrl: invite || undefined } };
          secrets = {};
        } else {
          const recipients = v("recipients").split(/[\n,]+/).map((r) => r.trim()).filter(Boolean).slice(0, 256);
          if (!recipients.length) return { error: "Add at least one group or contact." };
          const w = await whatsappVerify(v("phoneNumberId"), v("accessToken"));
          account = {
            externalId: `${v("phoneNumberId")}:${randomToken(4)}`,
            handle: v("name"),
            displayName: `${w.name || "WhatsApp"} · ${w.display}`,
            accountType: recipients.some((r) => !/^\+?\d{6,15}$/.test(r)) ? "group" : "broadcast",
            audienceSize: recipients.length,
            connector: { mode: "api", phoneNumberId: v("phoneNumberId"), recipients },
          };
          secrets = { accessToken: v("accessToken") };
        }
        break;
      }
      case "bluesky": {
        const service = v("service") ? (await assertSafeWebhookUrl(v("service"))).origin : "https://bsky.social";
        const s = await bskySession(service, v("identifier"), v("appPassword"));
        account = { externalId: s.did, handle: `@${s.handle}`, displayName: s.handle, accountType: "profile", profileUrl: `https://bsky.app/profile/${s.handle}`, connector: { instanceUrl: service } };
        secrets = { identifier: s.handle, appPassword: v("appPassword") };
        break;
      }
      case "mastodon": {
        const m = await mastodonVerify(v("instanceUrl"), v("accessToken"));
        account = { externalId: `${new URL(m.base).host}:${m.id}`, handle: `@${m.acct}@${new URL(m.base).host}`, displayName: m.name, accountType: "profile", profileUrl: m.url, audienceSize: m.followers, connector: { instanceUrl: m.base } };
        secrets = { accessToken: v("accessToken") };
        break;
      }
      default:
        return { error: "Unknown platform." };
    }

    const acc = await SocialAccount.findOneAndUpdate(
      { workspaceId: oid(ctx.workspace.id), platform, externalId: account.externalId },
      {
        $set: {
          handle: account.handle,
          displayName: account.displayName,
          accountType: account.accountType,
          profileUrl: account.profileUrl,
          audienceSize: account.audienceSize,
          connector: account.connector,
          status: "active",
          sandbox: false,
          connectedBy: oid(ctx.user.id),
          lastHealthCheckAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    await OAuthCredential.findOneAndUpdate(
      { socialAccountId: acc._id },
      { $set: { workspaceId: oid(ctx.workspace.id), accessTokenEnc: encryptSecrets(secrets), expiresAt: undefined, keyId: "v1" } },
      { upsert: true }
    );
    await audit({ action: "channel.connected", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "social_account", entityId: String(acc._id), meta: { platform, mode: mode || undefined } });
    revalidatePath("/accounts");
    revalidatePath("/communities");
    return { ok: true, message: `${spec.name} · ${account.handle} connected` };
  } catch (e) {
    if (e instanceof ConnectorError) return { error: e.message };
    const msg = (e as Error).message;
    return { error: /fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(msg) ? "Couldn't reach the platform to check these details. Try again in a moment." : msg };
  }
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
