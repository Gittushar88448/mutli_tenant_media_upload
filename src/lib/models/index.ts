/**
 * MongoDB models. Every tenant-owned collection carries workspaceId and is always
 * queried through it (see lib/tenant.ts). Collections follow the architecture doc's
 * data model, adapted to documents: options and edit specs are embedded, high-volume
 * history (publish attempts, audit events) lives in its own collections.
 */
import mongoose, { Schema, model, models, type InferSchemaType, type Model, Types } from "mongoose";
import { ALL_TARGET_PLATFORMS } from "@/lib/platforms";
import { POST_STATUSES, TARGET_STATUSES } from "./statuses";

const { ObjectId } = Schema.Types;
const ts = { timestamps: true } as const;

/* ---------- Users & tenancy ---------- */

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Empty for accounts that only ever signed in with Google.
    passwordHash: { type: String, select: false },
    googleId: { type: String, unique: true, sparse: true },
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
    status: { type: String, enum: ["active", "suspended", "invited"], default: "active", index: true },
    avatarUrl: String,
    timezone: { type: String, default: "UTC" },
    lastLoginAt: Date,
    defaultWorkspaceId: { type: ObjectId, ref: "Workspace" },
  },
  ts
);

import { PLANS, PLAN_LIMITS } from "@/lib/plans";
export { PLANS, PLAN_LIMITS };

const WorkspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    plan: { type: String, enum: PLANS, default: "free", index: true },
    timezone: { type: String, default: "UTC" },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    ownerId: { type: ObjectId, ref: "User", required: true, index: true },
    requireApproval: { type: Boolean, default: false },
    // Filter packs installed from the media editor's filter store.
    filterPacks: { type: [String], default: [] },
    // Subscription state. Razorpay is the source of truth when configured; its webhook writes here.
    billing: {
      provider: { type: String, enum: ["razorpay", "demo", "manual"] },
      customerId: { type: String, index: true, sparse: true },
      subscriptionId: String,
      status: { type: String, enum: ["active", "trialing", "past_due", "canceled", "incomplete"] },
      interval: { type: String, enum: ["month", "year"] },
      currentPeriodEnd: Date,
      cancelAtPeriodEnd: Boolean,
    },
  },
  ts
);

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "approver", "viewer"] as const;
const MembershipSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    userId: { type: ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: WORKSPACE_ROLES, default: "editor" },
  },
  ts
);
MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

/* ---------- Connected destinations ---------- */

const SocialAccountSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    platform: { type: String, enum: ALL_TARGET_PLATFORMS, required: true },
    externalId: { type: String, required: true },
    handle: { type: String, required: true },
    displayName: String,
    accountType: String, // page, channel, business, creator, member, webhook, manual
    avatarUrl: String,
    profileUrl: String,
    status: { type: String, enum: ["active", "needs_reauth", "revoked", "disabled"], default: "active", index: true },
    sandbox: { type: Boolean, default: false },
    connectedBy: { type: ObjectId, ref: "User" },
    scopes: [String],
    lastHealthCheckAt: Date,
    // Webhook / manual connectors keep their config here; secrets are encrypted.
    connector: {
      endpointUrl: String,
      authHeaderEnc: String,
      signingSecretEnc: String,
      fieldMap: Schema.Types.Mixed,
      notifyEmail: String,
      // Community connectors: where to send (secrets live encrypted in OAuthCredential).
      mode: String, // "api" | "assisted" (WhatsApp Channels and Communities have no API)
      chatId: String,
      channelId: String,
      guildId: String,
      instanceUrl: String,
      phoneNumberId: String,
      recipients: [String],
      inviteUrl: String,
    },
    // Members, subscribers or followers, refreshed on connect and on each health check.
    audienceSize: Number,
  },
  ts
);
SocialAccountSchema.index({ workspaceId: 1, platform: 1, externalId: 1 }, { unique: true });

const OAuthCredentialSchema = new Schema(
  {
    socialAccountId: { type: ObjectId, ref: "SocialAccount", required: true, unique: true },
    workspaceId: { type: ObjectId, ref: "Workspace", required: true, index: true },
    accessTokenEnc: { type: String, required: true },
    refreshTokenEnc: String,
    scopes: [String],
    expiresAt: { type: Date, index: true },
    refreshExpiresAt: Date,
    keyId: { type: String, default: "v1" },
  },
  ts
);

/* ---------- Media ---------- */

const MediaAssetSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    uploadedBy: { type: ObjectId, ref: "User" },
    kind: { type: String, enum: ["image", "video", "audio"], required: true },
    filename: String,
    storageKey: { type: String, required: true },
    // Which storage driver holds the bytes (see lib/storage.ts).
    storage: { type: String, enum: ["local", "cloudinary"], default: "local" },
    mime: String,
    sizeBytes: Number,
    width: Number,
    height: Number,
    durationMs: Number,
    checksum: String,
    status: { type: String, enum: ["uploading", "scanning", "ready", "rejected"], default: "ready" },
    rejectReason: String,
    tags: [String],
    // Audio only: where it came from, kept for licence disputes.
    audio: { source: { type: String, enum: ["upload", "library"] }, licenseRef: String, title: String },
    // Rendered per-channel cuts point back at their original and are hidden from the library.
    variantOf: { type: ObjectId, ref: "MediaAsset", index: true, sparse: true },
    specHash: String,
    // Copies saved from the media editor: the file they came from and the edit that made them.
    editOf: { type: ObjectId, ref: "MediaAsset" },
    edit: Schema.Types.Mixed,
  },
  ts
);
MediaAssetSchema.index({ workspaceId: 1, createdAt: -1 });

/** A workspace's own filter: saved adjustments, optionally on top of an imported .cube LUT. */
const CustomFilterSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true, index: true },
    createdBy: { type: ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true },
    adjust: Schema.Types.Mixed,
    // Imported LUT, 16-bit per channel, red fastest.
    lut: { size: Number, data: Buffer, source: String },
  },
  ts
);

/* ---------- Posts ---------- */

export { POST_STATUSES, TARGET_STATUSES };
export type TargetStatus = (typeof TARGET_STATUSES)[number];

const PostSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    authorId: { type: ObjectId, ref: "User", required: true, index: true },
    title: String,
    baseCaption: { type: String, default: "" },
    media: [
      {
        _id: false,
        assetId: { type: ObjectId, ref: "MediaAsset" },
        position: Number,
        audioTrackId: { type: ObjectId, ref: "MediaAsset" },
        editSpec: {
          trimStartMs: Number,
          trimEndMs: Number,
          crop: String, // "9:16" | "4:5" | "1:1" | "16:9" | "original"
          audioVolume: Number,
          audioOffsetMs: Number,
          keepOriginalAudio: Boolean,
        },
      },
    ],
    status: { type: String, enum: POST_STATUSES, default: "draft", index: true },
    scheduledAt: Date,
    timezone: { type: String, default: "UTC" },
    // Shared by every channel posting this as a poll (Telegram, Discord, Mastodon).
    poll: {
      question: String,
      options: [String],
      allowMultiple: Boolean,
      durationHours: Number,
    },
    approval: {
      status: { type: String, enum: ["not_required", "pending", "approved", "rejected"], default: "not_required" },
      by: { type: ObjectId, ref: "User" },
      at: Date,
      note: String,
    },
    targetCount: { type: Number, default: 0 },
  },
  ts
);
PostSchema.index({ workspaceId: 1, scheduledAt: 1 });
PostSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });

const PostTargetSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    postId: { type: ObjectId, ref: "Post", required: true, index: true },
    socialAccountId: { type: ObjectId, ref: "SocialAccount", required: true },
    platform: { type: String, enum: ALL_TARGET_PLATFORMS, required: true },
    postType: { type: String, required: true },
    captionOverride: String,
    options: { type: Schema.Types.Mixed, default: {} },
    // This channel's own cut of the first video. Empty means "same as the post".
    editSpec: {
      trimStartMs: Number,
      trimEndMs: Number,
      crop: String,
      audioTrackId: { type: ObjectId, ref: "MediaAsset" },
      audioVolume: Number,
      keepOriginalAudio: Boolean,
    },
    renderedAssetId: { type: ObjectId, ref: "MediaAsset" },
    status: { type: String, enum: TARGET_STATUSES, default: "scheduled" },
    // Saved platform handles so a retry resumes instead of re-uploading.
    platformContainerId: String,
    uploadSessionUrl: String,
    platformPostId: String,
    // Extra ids when one delivery is several messages (an album, or one per WhatsApp recipient).
    platformMessageIds: [String],
    permalink: String,
    // Edits made after the message went out.
    liveEdits: [{ _id: false, at: Date, by: { type: ObjectId, ref: "User" }, ok: Boolean, error: String }],
    attempts: { type: Number, default: 0 },
    nextAttemptAt: Date,
    claimedAt: Date,
    claimedBy: String,
    lastErrorCode: String,
    lastErrorMessage: String,
    publishedAt: Date,
  },
  ts
);
// The scheduler's index: due targets by status and time.
PostTargetSchema.index({ status: 1, nextAttemptAt: 1 });
PostTargetSchema.index({ workspaceId: 1, platform: 1, publishedAt: -1 });
PostTargetSchema.index({ socialAccountId: 1, publishedAt: -1 });

const PublishAttemptSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true, index: true },
    postTargetId: { type: ObjectId, ref: "PostTarget", required: true, index: true },
    step: String,
    status: String,
    executionId: String,
    httpStatus: Number,
    errorCode: String,
    message: String,
    responseExcerpt: String,
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
  },
  ts
);

/* ---------- Notifications, audit, settings ---------- */

const NotificationSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    userId: { type: ObjectId, ref: "User", index: true },
    kind: { type: String, enum: ["publish_failed", "published", "needs_reauth", "approval_requested", "system"], required: true },
    title: String,
    body: String,
    href: String,
    readAt: Date,
  },
  ts
);
NotificationSchema.index({ workspaceId: 1, createdAt: -1 });

const AuditEventSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", index: true },
    actorId: { type: ObjectId, ref: "User", index: true },
    actorEmail: String,
    action: { type: String, required: true, index: true },
    entity: String,
    entityId: String,
    meta: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AuditEventSchema.index({ createdAt: -1 });

/** Single document of platform-wide settings an admin can change at runtime. */
const AppSettingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    registrationOpen: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
    maxUploadMb: { type: Number, default: 512 },
    disabledPlatforms: { type: [String], default: [] },
    defaultPlan: { type: String, enum: PLANS, default: "free" },
    announcement: { type: String, default: "" },
  },
  ts
);

function m<T extends Schema>(name: string, schema: T) {
  return (models[name] as Model<InferSchemaType<T>>) ?? model(name, schema);
}

export const User = m("User", UserSchema);
export const Workspace = m("Workspace", WorkspaceSchema);
export const Membership = m("Membership", MembershipSchema);
export const SocialAccount = m("SocialAccount", SocialAccountSchema);
export const OAuthCredential = m("OAuthCredential", OAuthCredentialSchema);
export const MediaAsset = m("MediaAsset", MediaAssetSchema);
export const CustomFilter = m("CustomFilter", CustomFilterSchema);
export const Post = m("Post", PostSchema);
export const PostTarget = m("PostTarget", PostTargetSchema);
export const PublishAttempt = m("PublishAttempt", PublishAttemptSchema);
export const Notification = m("Notification", NotificationSchema);
export const AuditEvent = m("AuditEvent", AuditEventSchema);
export const AppSettings = m("AppSettings", AppSettingsSchema);

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export type WorkspaceDoc = InferSchemaType<typeof WorkspaceSchema> & { _id: Types.ObjectId };
export type SocialAccountDoc = InferSchemaType<typeof SocialAccountSchema> & { _id: Types.ObjectId };
export type MediaAssetDoc = InferSchemaType<typeof MediaAssetSchema> & { _id: Types.ObjectId };
export type PostDoc = InferSchemaType<typeof PostSchema> & { _id: Types.ObjectId };
export type PostTargetDoc = InferSchemaType<typeof PostTargetSchema> & { _id: Types.ObjectId };

export const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);
export const isOid = (id: unknown): id is string => typeof id === "string" && mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(id);
