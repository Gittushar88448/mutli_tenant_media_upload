/**
 * Discover searches: each fresh search is cached here for half an hour and counted toward
 * the workspace's daily limit. Documents expire after three days.
 */
import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const { ObjectId } = Schema.Types;

const DiscoverSearchSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: "Workspace", required: true },
    userId: { type: ObjectId, ref: "User" },
    key: { type: String, required: true },
    // DiscoverQuery and DiscoverResult from lib/discover/types.
    query: { type: Schema.Types.Mixed, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
DiscoverSearchSchema.index({ workspaceId: 1, key: 1, createdAt: -1 });
DiscoverSearchSchema.index({ workspaceId: 1, createdAt: -1 });
DiscoverSearchSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 86400 });

export const DiscoverSearch = (models.DiscoverSearch as Model<InferSchemaType<typeof DiscoverSearchSchema>>) ?? model("DiscoverSearch", DiscoverSearchSchema);
