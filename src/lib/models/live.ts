/**
 * Live view cache. Kept out of models/index.ts on purpose: these are disposable reads of
 * what the platforms report, not Relay's own records, and can be dropped at any time.
 */
import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

const { ObjectId } = Schema.Types;

/** The last thing a platform said about one delivery. One document per PostTarget. */
const LiveSnapshotSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    postTargetId: { type: ObjectId, ref: "PostTarget", required: true, unique: true },
    socialAccountId: { type: ObjectId, ref: "SocialAccount", required: true, index: true },
    platform: { type: String, required: true },
    // LivePayload from lib/live/types: metrics, comments, status, note.
    payload: { type: Schema.Types.Mixed, default: null },
    fetchedAt: { type: Date, required: true },
    // Set when the last fetch failed; the previous payload is kept so the page still has numbers.
    error: String,
    authError: Boolean,
  },
  { timestamps: true }
);
LiveSnapshotSchema.index({ workspaceId: 1, fetchedAt: -1 });

/** A reply sent from the Live view. Sandbox replies only exist here. */
const LiveReplySchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    postTargetId: { type: ObjectId, ref: "PostTarget", required: true, index: true },
    commentId: { type: String, required: true },
    text: { type: String, required: true },
    by: { type: ObjectId, ref: "User" },
    byName: String,
    platformReplyId: String,
    ok: { type: Boolean, default: true },
    error: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
LiveReplySchema.index({ workspaceId: 1, createdAt: -1 });

function m<T extends Schema>(name: string, schema: T) {
  return (models[name] as Model<InferSchemaType<T>>) ?? model(name, schema);
}

export const LiveSnapshot = m("LiveSnapshot", LiveSnapshotSchema);
export const LiveReply = m("LiveReply", LiveReplySchema);

export type LiveSnapshotDoc = InferSchemaType<typeof LiveSnapshotSchema> & { _id: Types.ObjectId };
export type LiveReplyDoc = InferSchemaType<typeof LiveReplySchema> & { _id: Types.ObjectId; createdAt: Date };
