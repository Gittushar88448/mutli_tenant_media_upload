import "server-only";
import { connectDB } from "@/lib/db";
import { AuditEvent, MediaAsset, PostTarget, SocialAccount, User, Workspace, oid } from "@/lib/models";
import { escapeRegex, paginate, type TableParams } from "./table-params";

/* ---------------- Overview ---------------- */

export async function getAdminOverview() {
  await connectDB();
  const d30 = new Date(Date.now() - 29 * 24 * 3600 * 1000);
  d30.setUTCHours(0, 0, 0, 0);

  const [users, workspaces, targets, storage, accounts] = await Promise.all([
    User.aggregate([
      {
        $facet: {
          total: [{ $count: "n" }],
          byStatus: [{ $group: { _id: "$status", n: { $sum: 1 } } }],
          admins: [{ $match: { role: "admin" } }, { $count: "n" }],
          signups: [
            { $match: { createdAt: { $gte: d30 } } },
            { $group: { _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d" } }, n: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          activeWeek: [{ $match: { lastLoginAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }, { $count: "n" }],
        },
      },
    ]),
    Workspace.aggregate([{ $group: { _id: "$plan", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    PostTarget.aggregate([
      {
        $facet: {
          daily: [
            { $match: { updatedAt: { $gte: d30 }, status: { $in: ["published", "failed", "needs_action"] } } },
            {
              $group: {
                _id: { $dateToString: { date: { $ifNull: ["$publishedAt", "$updatedAt"] }, format: "%Y-%m-%d" } },
                published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $ne: ["$status", "published"] }, 1, 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          platforms: [
            {
              $group: {
                _id: "$platform",
                total: { $sum: 1 },
                published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $in: ["$status", ["failed", "needs_action"]] }, 1, 0] } },
                queued: { $sum: { $cond: [{ $in: ["$status", ["scheduled", "queued", "preparing", "uploading", "processing", "retrying"]] }, 1, 0] } },
              },
            },
            { $sort: { total: -1 } },
          ],
          errors: [
            { $match: { lastErrorCode: { $exists: true, $ne: null } } },
            { $group: { _id: "$lastErrorCode", n: { $sum: 1 }, platforms: { $addToSet: "$platform" } } },
            { $sort: { n: -1 } },
            { $limit: 6 },
          ],
          topWorkspaces: [
            { $match: { status: "published" } },
            { $group: { _id: "$workspaceId", published: { $sum: 1 } } },
            { $sort: { published: -1 } },
            { $limit: 5 },
            { $lookup: { from: "workspaces", localField: "_id", foreignField: "_id", as: "ws", pipeline: [{ $project: { name: 1, plan: 1 } }] } },
            { $project: { published: 1, name: { $first: "$ws.name" }, plan: { $first: "$ws.plan" } } },
          ],
          inFlight: [{ $match: { status: { $in: ["queued", "preparing", "uploading", "processing"] } } }, { $count: "n" }],
          due: [{ $match: { status: { $in: ["scheduled", "retrying"] }, nextAttemptAt: { $lte: new Date() } } }, { $count: "n" }],
        },
      },
    ]),
    MediaAsset.aggregate([{ $group: { _id: "$kind", n: { $sum: 1 }, bytes: { $sum: "$sizeBytes" } } }]),
    SocialAccount.aggregate([{ $group: { _id: { platform: "$platform", status: "$status" }, n: { $sum: 1 } } }]),
  ]);

  const u = users[0];
  const t = targets[0];
  return {
    users: {
      total: u.total[0]?.n ?? 0,
      admins: u.admins[0]?.n ?? 0,
      activeWeek: u.activeWeek[0]?.n ?? 0,
      byStatus: Object.fromEntries(u.byStatus.map((s: { _id: string; n: number }) => [s._id, s.n])) as Record<string, number>,
      signups: fillDays30(u.signups.map((s: { _id: string; n: number }) => ({ day: s._id, n: s.n })), d30),
    },
    plans: workspaces as { _id: string; n: number }[],
    daily: fillDays30Pub(t.daily as { _id: string; published: number; failed: number }[], d30),
    platforms: t.platforms as { _id: string; total: number; published: number; failed: number; queued: number }[],
    errors: t.errors as { _id: string; n: number; platforms: string[] }[],
    topWorkspaces: t.topWorkspaces as { _id: unknown; published: number; name: string; plan: string }[],
    inFlight: t.inFlight[0]?.n ?? 0,
    due: t.due[0]?.n ?? 0,
    storage: storage as { _id: string; n: number; bytes: number }[],
    accounts: accounts as { _id: { platform: string; status: string }; n: number }[],
  };
}

function fillDays30(rows: { day: string; n: number }[], from: Date) {
  const m = new Map(rows.map((r) => [r.day, r.n]));
  return Array.from({ length: 30 }, (_, i) => {
    const day = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10);
    return { day, n: m.get(day) ?? 0 };
  });
}
function fillDays30Pub(rows: { _id: string; published: number; failed: number }[], from: Date) {
  const m = new Map(rows.map((r) => [r._id, r]));
  return Array.from({ length: 30 }, (_, i) => {
    const day = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10);
    const r = m.get(day);
    return { day, published: r?.published ?? 0, failed: r?.failed ?? 0 };
  });
}

/* ---------------- Users ---------------- */

export type AdminUserRow = {
  _id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  status: "active" | "suspended" | "invited";
  createdAt: string;
  lastLoginAt?: string | null;
  workspaceCount: number;
  workspaces: { id: string; name: string; role: string; plan: string }[];
  postCount: number;
  publishedCount: number;
  accountCount: number;
};

export async function listUsers(p: TableParams) {
  await connectDB();
  const match: Record<string, unknown> = {};
  if (p.q) {
    const rx = { $regex: escapeRegex(p.q), $options: "i" };
    match.$or = [{ name: rx }, { email: rx }];
  }
  if (p.filters.role?.length) match.role = { $in: p.filters.role };
  if (p.filters.status?.length) match.status = { $in: p.filters.status };

  const [res] = await User.aggregate([
    { $match: match },
    {
      $lookup: {
        from: "memberships",
        localField: "_id",
        foreignField: "userId",
        as: "memberships",
        pipeline: [
          { $lookup: { from: "workspaces", localField: "workspaceId", foreignField: "_id", as: "ws", pipeline: [{ $project: { name: 1, plan: 1 } }] } },
          { $unwind: "$ws" },
          { $project: { _id: 0, id: { $toString: "$ws._id" }, name: "$ws.name", plan: "$ws.plan", role: 1 } },
        ],
      },
    },
    // Post counts per author, published counts via their posts' targets.
    {
      $lookup: {
        from: "posts",
        localField: "_id",
        foreignField: "authorId",
        as: "postStats",
        pipeline: [
          { $lookup: { from: "posttargets", localField: "_id", foreignField: "postId", as: "t", pipeline: [{ $match: { status: "published" } }, { $project: { _id: 1 } }] } },
          { $group: { _id: null, posts: { $sum: 1 }, published: { $sum: { $size: "$t" } } } },
        ],
      },
    },
    { $lookup: { from: "socialaccounts", localField: "_id", foreignField: "connectedBy", as: "accs", pipeline: [{ $project: { _id: 1 } }] } },
    {
      $project: {
        _id: { $toString: "$_id" },
        name: 1,
        email: 1,
        role: 1,
        status: 1,
        createdAt: 1,
        lastLoginAt: 1,
        workspaces: "$memberships",
        workspaceCount: { $size: "$memberships" },
        postCount: { $ifNull: [{ $first: "$postStats.posts" }, 0] },
        publishedCount: { $ifNull: [{ $first: "$postStats.published" }, 0] },
        accountCount: { $size: "$accs" },
      },
    },
    ...paginate(p),
  ]);
  return { rows: serialize(res?.rows ?? []) as AdminUserRow[], total: (res?.total as number) ?? 0 };
}

export async function getAdminUserDetail(id: string) {
  await connectDB();
  const [user] = await User.aggregate([
    { $match: { _id: oid(id) } },
    {
      $lookup: {
        from: "memberships",
        localField: "_id",
        foreignField: "userId",
        as: "memberships",
        pipeline: [
          {
            $lookup: {
              from: "workspaces",
              localField: "workspaceId",
              foreignField: "_id",
              as: "ws",
              pipeline: [
                { $lookup: { from: "memberships", localField: "_id", foreignField: "workspaceId", as: "m" } },
                { $lookup: { from: "socialaccounts", localField: "_id", foreignField: "workspaceId", as: "a", pipeline: [{ $project: { platform: 1, handle: 1, status: 1 } }] } },
                { $project: { name: 1, plan: 1, status: 1, members: { $size: "$m" }, accounts: "$a" } },
              ],
            },
          },
          { $unwind: "$ws" },
        ],
      },
    },
    {
      $lookup: {
        from: "posts",
        localField: "_id",
        foreignField: "authorId",
        as: "recentPosts",
        pipeline: [
          { $sort: { createdAt: -1 } },
          { $limit: 8 },
          { $lookup: { from: "posttargets", localField: "_id", foreignField: "postId", as: "t", pipeline: [{ $project: { platform: 1, status: 1 } }] } },
          { $project: { baseCaption: 1, status: 1, scheduledAt: 1, createdAt: 1, targets: "$t" } },
        ],
      },
    },
    {
      $lookup: {
        from: "auditevents",
        localField: "_id",
        foreignField: "actorId",
        as: "activity",
        pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 12 }, { $project: { action: 1, entity: 1, createdAt: 1, ip: 1 } }],
      },
    },
    { $project: { passwordHash: 0 } },
  ]);
  return user ? serialize(user) : null;
}

/* ---------------- Workspaces ---------------- */

export type AdminWorkspaceRow = {
  _id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: string;
  owner?: { name: string; email: string };
  members: number;
  accounts: number;
  posts: number;
  published: number;
  storageBytes: number;
};

export async function listWorkspaces(p: TableParams) {
  await connectDB();
  const match: Record<string, unknown> = {};
  if (p.q) match.name = { $regex: escapeRegex(p.q), $options: "i" };
  if (p.filters.plan?.length) match.plan = { $in: p.filters.plan };
  if (p.filters.status?.length) match.status = { $in: p.filters.status };

  const [res] = await Workspace.aggregate([
    { $match: match },
    { $lookup: { from: "users", localField: "ownerId", foreignField: "_id", as: "owner", pipeline: [{ $project: { _id: 0, name: 1, email: 1 } }] } },
    { $lookup: { from: "memberships", localField: "_id", foreignField: "workspaceId", as: "m", pipeline: [{ $count: "n" }] } },
    { $lookup: { from: "socialaccounts", localField: "_id", foreignField: "workspaceId", as: "a", pipeline: [{ $count: "n" }] } },
    { $lookup: { from: "posts", localField: "_id", foreignField: "workspaceId", as: "p", pipeline: [{ $count: "n" }] } },
    { $lookup: { from: "posttargets", localField: "_id", foreignField: "workspaceId", as: "pub", pipeline: [{ $match: { status: "published" } }, { $count: "n" }] } },
    { $lookup: { from: "mediaassets", localField: "_id", foreignField: "workspaceId", as: "s", pipeline: [{ $group: { _id: null, b: { $sum: "$sizeBytes" } } }] } },
    {
      $project: {
        _id: { $toString: "$_id" },
        name: 1,
        slug: 1,
        plan: 1,
        status: 1,
        createdAt: 1,
        owner: { $first: "$owner" },
        members: { $ifNull: [{ $first: "$m.n" }, 0] },
        accounts: { $ifNull: [{ $first: "$a.n" }, 0] },
        posts: { $ifNull: [{ $first: "$p.n" }, 0] },
        published: { $ifNull: [{ $first: "$pub.n" }, 0] },
        storageBytes: { $ifNull: [{ $first: "$s.b" }, 0] },
      },
    },
    ...paginate(p),
  ]);
  return { rows: serialize(res?.rows ?? []) as AdminWorkspaceRow[], total: (res?.total as number) ?? 0 };
}

/* ---------------- Publishing (post targets) ---------------- */

export type AdminTargetRow = {
  _id: string;
  postId: string;
  platform: string;
  postType: string;
  status: string;
  attempts: number;
  scheduledAt?: string;
  publishedAt?: string;
  updatedAt: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  permalink?: string;
  caption: string;
  workspace: string;
  handle: string;
  author: string;
};

export async function listTargets(p: TableParams) {
  await connectDB();
  const match: Record<string, unknown> = {};
  if (p.filters.status?.length) match.status = { $in: p.filters.status };
  if (p.filters.platform?.length) match.platform = { $in: p.filters.platform };

  const [res] = await PostTarget.aggregate([
    { $match: match },
    { $lookup: { from: "posts", localField: "postId", foreignField: "_id", as: "post", pipeline: [{ $project: { baseCaption: 1, scheduledAt: 1, authorId: 1 } }] } },
    { $unwind: "$post" },
    { $lookup: { from: "workspaces", localField: "workspaceId", foreignField: "_id", as: "ws", pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: "socialaccounts", localField: "socialAccountId", foreignField: "_id", as: "acc", pipeline: [{ $project: { handle: 1 } }] } },
    { $lookup: { from: "users", localField: "post.authorId", foreignField: "_id", as: "author", pipeline: [{ $project: { name: 1 } }] } },
    {
      $project: {
        _id: { $toString: "$_id" },
        postId: { $toString: "$postId" },
        platform: 1,
        postType: 1,
        status: 1,
        attempts: 1,
        publishedAt: 1,
        updatedAt: 1,
        lastErrorCode: 1,
        lastErrorMessage: 1,
        permalink: 1,
        scheduledAt: "$post.scheduledAt",
        caption: { $ifNull: ["$captionOverride", "$post.baseCaption"] },
        workspace: { $first: "$ws.name" },
        handle: { $first: "$acc.handle" },
        author: { $first: "$author.name" },
      },
    },
    ...(p.q
      ? [
          {
            $match: {
              $or: ["caption", "workspace", "handle", "author", "lastErrorCode"].map((f) => ({ [f]: { $regex: escapeRegex(p.q), $options: "i" } })),
            },
          },
        ]
      : []),
    ...paginate(p),
  ]);
  return { rows: serialize(res?.rows ?? []) as AdminTargetRow[], total: (res?.total as number) ?? 0 };
}

/* ---------------- Social accounts ---------------- */

export type AdminAccountRow = {
  _id: string;
  platform: string;
  handle: string;
  displayName?: string;
  status: string;
  sandbox: boolean;
  createdAt: string;
  workspace: string;
  connectedBy?: string;
  tokenExpiresAt?: string | null;
  published: number;
  failed: number;
};

export async function listAccounts(p: TableParams) {
  await connectDB();
  const match: Record<string, unknown> = {};
  if (p.filters.platform?.length) match.platform = { $in: p.filters.platform };
  if (p.filters.status?.length) match.status = { $in: p.filters.status };
  if (p.q) match.$or = [{ handle: { $regex: escapeRegex(p.q), $options: "i" } }, { displayName: { $regex: escapeRegex(p.q), $options: "i" } }];

  const [res] = await SocialAccount.aggregate([
    { $match: match },
    { $lookup: { from: "workspaces", localField: "workspaceId", foreignField: "_id", as: "ws", pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: "users", localField: "connectedBy", foreignField: "_id", as: "by", pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: "oauthcredentials", localField: "_id", foreignField: "socialAccountId", as: "cred", pipeline: [{ $project: { expiresAt: 1 } }] } },
    {
      $lookup: {
        from: "posttargets",
        localField: "_id",
        foreignField: "socialAccountId",
        as: "stats",
        pipeline: [
          {
            $group: {
              _id: null,
              published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $in: ["$status", ["failed", "needs_action"]] }, 1, 0] } },
            },
          },
        ],
      },
    },
    {
      $project: {
        _id: { $toString: "$_id" },
        platform: 1,
        handle: 1,
        displayName: 1,
        status: 1,
        sandbox: { $ifNull: ["$sandbox", false] },
        createdAt: 1,
        workspace: { $first: "$ws.name" },
        connectedBy: { $first: "$by.name" },
        tokenExpiresAt: { $first: "$cred.expiresAt" },
        published: { $ifNull: [{ $first: "$stats.published" }, 0] },
        failed: { $ifNull: [{ $first: "$stats.failed" }, 0] },
      },
    },
    ...paginate(p),
  ]);
  return { rows: serialize(res?.rows ?? []) as AdminAccountRow[], total: (res?.total as number) ?? 0 };
}

/* ---------------- Audit ---------------- */

export type AdminAuditRow = { _id: string; action: string; entity?: string; entityId?: string; actorEmail?: string; workspace?: string; ip?: string; createdAt: string; meta?: unknown };

export async function listAudit(p: TableParams) {
  await connectDB();
  const match: Record<string, unknown> = {};
  if (p.q) {
    const rx = { $regex: escapeRegex(p.q), $options: "i" };
    match.$or = [{ action: rx }, { actorEmail: rx }, { entity: rx }];
  }
  if (p.filters.action?.length) match.action = { $in: p.filters.action };
  const [res] = await AuditEvent.aggregate([
    { $match: match },
    { $lookup: { from: "workspaces", localField: "workspaceId", foreignField: "_id", as: "ws", pipeline: [{ $project: { name: 1 } }] } },
    { $project: { _id: { $toString: "$_id" }, action: 1, entity: 1, entityId: 1, actorEmail: 1, ip: 1, createdAt: 1, meta: 1, workspace: { $first: "$ws.name" } } },
    ...paginate(p),
  ]);
  return { rows: serialize(res?.rows ?? []) as AdminAuditRow[], total: (res?.total as number) ?? 0 };
}

export async function distinctAuditActions() {
  await connectDB();
  return (await AuditEvent.distinct("action")).sort() as string[];
}

/** ObjectIds and Dates → strings so rows can cross the server/client boundary. */
export function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
