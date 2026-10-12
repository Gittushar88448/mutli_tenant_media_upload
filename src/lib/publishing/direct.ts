import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { MediaAsset, OAuthCredential, Post, PostTarget, SocialAccount, oid, type MediaAssetDoc } from "@/lib/models";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/oauth";
import { localPath, readObject } from "@/lib/storage";
import { PLATFORMS, type PlatformId, type TargetPlatform } from "@/lib/platforms";
import { effectiveSpec, ensureRendered, type EditSpec } from "@/lib/media/render";
import { recordTargetEvent } from "./engine";
import { ConnectorError, editDirect, sendDirect, type OutFile } from "./connectors";

/**
 * Runs one claimed target through a built-in connector and reports each step to the
 * publishing state machine, exactly as an n8n workflow would. Called by
 * POST /api/internal/targets/:id/send (from n8n) and by the dev dispatcher.
 */

/** Secrets for a token-connected channel are stored as one encrypted JSON object. */
export function encryptSecrets(secrets: Record<string, string>) {
  return encrypt(JSON.stringify(secrets));
}

async function loadSecrets(accountId: Types.ObjectId, platform: string, sandbox: boolean): Promise<Record<string, string>> {
  const cred = await OAuthCredential.findOne({ socialAccountId: accountId });
  if (!cred) throw new ConnectorError("NO_CREDENTIALS", "Reconnect this channel.", { authError: true });
  if (PLATFORMS[platform as TargetPlatform]?.oauth) {
    // OAuth platforms (Reddit): refresh shortly before expiry, like the n8n credentials route.
    if (!sandbox && cred.refreshTokenEnc && cred.expiresAt && cred.expiresAt.getTime() - Date.now() < 10 * 60_000) {
      try {
        const t = await refreshAccessToken(platform as PlatformId, decrypt(cred.refreshTokenEnc));
        cred.accessTokenEnc = encrypt(t.accessToken);
        if (t.refreshToken) cred.refreshTokenEnc = encrypt(t.refreshToken);
        if (t.expiresIn) cred.expiresAt = new Date(Date.now() + t.expiresIn * 1000);
        await cred.save();
      } catch (e) {
        throw new ConnectorError("TOKEN_REFRESH_FAILED", (e as Error).message, { authError: (e as { auth?: boolean }).auth, retryable: !(e as { auth?: boolean }).auth });
      }
    }
    return { accessToken: decrypt(cred.accessTokenEnc) };
  }
  try {
    return JSON.parse(decrypt(cred.accessTokenEnc));
  } catch {
    return {};
  }
}

/** The files this delivery uploads, with the first video swapped for this channel's rendered cut. */
async function filesFor(target: InstanceType<typeof PostTarget>, post: InstanceType<typeof Post>): Promise<OutFile[]> {
  const items = [...(post.media ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (!items.length) return [];
  const assets = new Map((await MediaAsset.find({ _id: { $in: items.map((m) => m.assetId) } }).lean<MediaAssetDoc[]>()).map((a) => [String(a._id), a]));
  const out: OutFile[] = [];
  let firstVideoDone = false;
  for (const m of items) {
    let a = assets.get(String(m.assetId));
    if (!a || a.kind === "audio") continue;
    if (a.kind === "video" && !firstVideoDone) {
      firstVideoDone = true;
      const spec = effectiveSpec(target.editSpec as EditSpec, { audioTrackId: m.audioTrackId, editSpec: m.editSpec as EditSpec });
      const rendered = await ensureRendered(a, spec);
      if (String(rendered._id) !== String(a._id)) await PostTarget.updateOne({ _id: target._id }, { $set: { renderedAssetId: rendered._id } });
      a = rendered;
    }
    const asset = a;
    out.push({
      kind: asset.kind as "image" | "video",
      mime: asset.mime ?? (asset.kind === "video" ? "video/mp4" : "image/jpeg"),
      filename: asset.filename ?? `${String(asset._id)}.${asset.kind === "video" ? "mp4" : "jpg"}`,
      path: await localPath(asset),
      sizeBytes: asset.sizeBytes ?? undefined,
      data: () => readObject(asset),
    });
  }
  return out;
}

export async function deliverDirect(targetId: string, executionId = "relay") {
  await connectDB();
  const target = await PostTarget.findById(targetId);
  if (!target) return { ok: false, error: "not_found" };
  if (target.status === "published" || target.status === "cancelled") return { ok: true, status: target.status };
  const [post, account] = await Promise.all([Post.findById(target.postId), SocialAccount.findById(target.socialAccountId).lean()]);
  if (!post || !account) return recordTargetEvent(targetId, { step: "failed", errorCode: "MISSING", message: "The post or channel no longer exists.", retryable: false });

  const caption = (target.captionOverride ?? "").trim() || post.baseCaption || "";
  const options = (target.options ?? {}) as Record<string, unknown>;

  // WhatsApp Channels and Community announcements have no API: hand it to a person.
  if (account.platform === "whatsapp" && account.connector?.mode === "assisted") {
    return recordTargetEvent(targetId, {
      step: "needs_action",
      executionId,
      errorCode: "ASSISTED_POST_DUE",
      message: "Time to post this in WhatsApp. Copy the text, send it in your channel or community, then mark it sent.",
    });
  }

  await recordTargetEvent(targetId, { step: "preparing", executionId });
  try {
    const files = PLATFORMS[target.platform as TargetPlatform]?.postTypes.find((t) => t.id === target.postType)?.media === "none" ? [] : await filesFor(target, post);
    await recordTargetEvent(targetId, { step: "uploading", executionId });

    if (account.sandbox) {
      // Sandbox channels go through everything above, including rendering, but send nothing.
      const id = `sandbox_${Date.now().toString(36)}`;
      return recordTargetEvent(targetId, { step: "published", executionId, platformPostId: id, permalink: `https://example.com/${account.platform}/${account.handle.replace(/^[@#]/, "")}/${id}` });
    }

    const secret = await loadSecrets(account._id, account.platform, false);
    const result = await sendDirect({
      targetId,
      platform: account.platform,
      postType: target.postType,
      text: caption,
      headline: options.headline ? String(options.headline) : undefined,
      options,
      poll: post.poll?.question ? { question: post.poll.question, options: post.poll.options ?? [], allowMultiple: post.poll.allowMultiple ?? false, durationHours: post.poll.durationHours ?? 24 } : null,
      account: {
        externalId: account.externalId,
        handle: account.handle,
        accountType: account.accountType,
        profileUrl: account.profileUrl,
        connector: (account.connector ?? {}) as Record<string, unknown>,
      },
      secret,
      files,
    });
    if (result.messageIds?.length) await PostTarget.updateOne({ _id: target._id }, { $set: { platformMessageIds: result.messageIds } });
    return recordTargetEvent(targetId, { step: "published", executionId, platformPostId: result.platformPostId, permalink: result.permalink, message: result.note });
  } catch (e) {
    const err = e instanceof ConnectorError ? e : new ConnectorError("CONNECTOR_CRASHED", (e as Error).message, { retryable: true });
    return recordTargetEvent(targetId, {
      step: "failed",
      executionId,
      errorCode: err.code,
      message: err.message,
      httpStatus: err.opts.httpStatus,
      retryable: err.opts.retryable,
      authError: err.opts.authError,
      responseExcerpt: err.opts.excerpt,
    });
  }
}

/** Edits a message that already went out. Returns an error string, or null when it worked. */
export async function editLive(targetId: string, userId: string): Promise<string | null> {
  await connectDB();
  const target = await PostTarget.findById(targetId);
  if (!target || target.status !== "published" || !target.platformPostId) return "Only delivered messages can be edited live.";
  const [post, account] = await Promise.all([Post.findById(target.postId).lean(), SocialAccount.findById(target.socialAccountId).lean()]);
  if (!post || !account) return "The post or channel no longer exists.";
  const options = (target.options ?? {}) as Record<string, unknown>;
  let error: string | null = null;
  if (!account.sandbox) {
    try {
      await editDirect({
        platform: account.platform,
        postType: target.postType,
        text: (target.captionOverride ?? "").trim() || post.baseCaption || "",
        headline: options.headline ? String(options.headline) : undefined,
        platformPostId: target.platformPostId,
        messageIds: target.platformMessageIds ?? [],
        account: { externalId: account.externalId, handle: account.handle, accountType: account.accountType, profileUrl: account.profileUrl, connector: (account.connector ?? {}) as Record<string, unknown> },
        secret: await loadSecrets(account._id, account.platform, false),
      });
    } catch (e) {
      error = (e as Error).message;
    }
  }
  await PostTarget.updateOne({ _id: target._id }, { $push: { liveEdits: { at: new Date(), by: oid(userId), ok: !error, error: error ?? undefined } } });
  return error;
}
