/**
 * Seeds a demo dataset: an admin, a demo creator, ~40 other users across workspaces on
 * every plan, sandbox channels and communities, media, and a month of posts and community
 * messages in every delivery state.
 *
 *   npm run seed            # adds demo data (refuses if users already exist)
 *   npm run seed -- --reset # wipes the database first
 */
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";
import {
  AppSettings,
  AuditEvent,
  MediaAsset,
  Membership,
  Notification,
  OAuthCredential,
  Post,
  PostTarget,
  PublishAttempt,
  SocialAccount,
  User,
  Workspace,
  type TargetStatus,
} from "../src/lib/models";

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: readonly T[]) => a[rnd(a.length)]!;
const days = (n: number) => new Date(Date.now() + n * 86400000);

/* Minimal PNG encoder so the demo media library has real images. */
function crc32(buf: Buffer) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, a: [number, number, number], b: [number, number, number]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w) * 0.35 + (y / h) * 0.65;
      const stripe = (x + y) % 48 < 2 ? 18 : 0;
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = Math.min(255, a[0] + (b[0] - a[0]) * t + stripe);
      raw[i + 1] = Math.min(255, a[1] + (b[1] - a[1]) * t + stripe);
      raw[i + 2] = Math.min(255, a[2] + (b[2] - a[2]) * t + stripe);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vihaan", "Isha", "Arjun", "Sara", "Leo", "Maya", "Noah", "Zara", "Omar", "Lena", "Tomás", "Yuki", "Priya", "Ethan", "Nina", "Kenji", "Amara", "Felix"];
const LAST = ["Sharma", "Patel", "Iyer", "Khan", "Rao", "Fernandes", "Okafor", "Silva", "Novak", "Tanaka", "Haddad", "Larsen", "Mehta", "Costa"];
const BRANDS = ["Northwind Studio", "Saffron Kitchen", "Atlas Running Club", "Pixel & Paper", "Monsoon Records", "Little Fern Ceramics", "Kite Travel Co.", "Bluebird Bakery", "Granite Gym", "Neon Arcade", "Tidewater Surf", "Juniper Skincare"];
const CAPTIONS = [
  "Behind the scenes of this week's shoot. Three takes, one keeper.",
  "New drop Thursday. Set a reminder so you don't miss it. #launch #smallbusiness",
  "Five things we learned shipping our first 1,000 orders.",
  "Sunday reset routine, sped up. Which step do you skip?",
  "Our head baker's sourdough timeline, start to finish. #bread #sourdough",
  "Tour dates are live. Link in bio.",
  "Before and after: the studio renovation is finally done.",
  "Ask us anything. We'll answer the top questions in Friday's video.",
  "Morning 10K with the club. Pace chart in the comments.",
  "Glaze test results are in. Vote for the colour we fire next.",
];
const TZS = ["Asia/Kolkata", "Europe/London", "America/New_York", "Asia/Tokyo", "Europe/Berlin"];
const SOCIAL = ["instagram", "facebook", "youtube", "tiktok", "linkedin", "threads"] as const;
const COMMUNITIES = [
  { platform: "telegram", handle: "@{slug}news", accountType: "channel", size: 4200 },
  { platform: "whatsapp", handle: "{brand} customers", accountType: "group", size: 180, connector: { mode: "api", recipients: ["+15550000001", "Y2FwaV9ncm91cDpzZWVk"] } },
  { platform: "whatsapp", handle: "{brand} Channel", accountType: "channel", size: 9600, connector: { mode: "assisted", inviteUrl: "https://whatsapp.com/channel/0029Va-seed" } },
  { platform: "discord", handle: "#announcements", accountType: "channel", size: 1350, connector: { channelId: "1100000000000000001", guildId: "1100000000000000000" } },
  { platform: "slack", handle: "#community", accountType: "channel", size: 640, connector: { channelId: "C0SEED0001" } },
  { platform: "bluesky", handle: "@{slug}.bsky.social", accountType: "profile", size: 820 },
  { platform: "mastodon", handle: "@{slug}@mastodon.social", accountType: "profile", size: 310, connector: { instanceUrl: "https://mastodon.social" } },
] as const;
const MESSAGES = [
  "Doors open at 6pm tonight. First 50 people get the zine.",
  "Quick heads-up: the store is closed Monday for a stock take.",
  "We just pushed the new size guide. Tell us what's missing.",
  "Thank you for 5,000 orders. Code THANKYOU gets 15% off this weekend.",
  "Live Q&A with the founders on Thursday at 7. Drop your questions here.",
  "Restock alert: the oat colourway is back.",
];
const POLLS = [
  { question: "Which colour should we restock first?", options: ["Oat", "Charcoal", "Moss"] },
  { question: "When should we run the next live session?", options: ["Weekday evening", "Saturday morning", "Sunday afternoon"] },
];
const TYPES: Record<string, string> = { instagram: "reel", facebook: "feed", youtube: "short", tiktok: "video", linkedin: "feed", threads: "feed", webhook: "feed", manual: "feed" };

async function main() {
  await connectDB();
  if (process.argv.includes("--reset")) {
    await mongoose.connection.db!.dropDatabase();
    console.log("database dropped");
  } else if ((await User.estimatedDocumentCount()) > 0) {
    console.log("users already exist; run with --reset to start over");
    process.exit(0);
  }
  await Promise.all([User, Workspace, Membership, SocialAccount, OAuthCredential, MediaAsset, Post, PostTarget, PublishAttempt, AuditEvent, Notification, AppSettings].map((m) => m.syncIndexes()));
  await AppSettings.create({ key: "global" });

  const storageRoot = path.resolve(process.env.STORAGE_DIR ?? "storage");
  const pass = await bcrypt.hash("relay-demo-123", 10);

  const admin = await User.create({ name: "Kapil Kumar", email: "admin@relay.dev", passwordHash: pass, role: "admin", timezone: "Asia/Kolkata", lastLoginAt: new Date(), createdAt: days(-60) });
  const people = [admin];
  for (let i = 0; i < 42; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    people.push(
      await User.create({
        name,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${i}@example.com`,
        passwordHash: pass,
        role: i < 2 ? "admin" : "user",
        status: i % 13 === 5 ? "suspended" : "active",
        timezone: pick(TZS),
        lastLoginAt: i % 4 === 0 ? undefined : days(-rnd(20)),
        createdAt: days(-rnd(30)),
      })
    );
  }

  const plans = ["agency", "studio", "creator", "creator", "free", "free", "studio", "free", "creator", "free", "agency", "free"] as const;
  for (let w = 0; w < BRANDS.length; w++) {
    const owner = w === 0 ? admin : people[1 + w]!;
    const tz = w === 0 ? "Asia/Kolkata" : pick(TZS);
    const ws = await Workspace.create({
      name: BRANDS[w]!,
      slug: `${BRANDS[w]!.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomBytes(2).toString("hex")}`,
      plan: plans[w],
      billing: plans[w] === "free" ? undefined : { provider: "demo", status: "active", interval: w % 3 === 0 ? "year" : "month", currentPeriodEnd: days(5 + rnd(25)), cancelAtPeriodEnd: false },
      ownerId: owner._id,
      timezone: tz,
      requireApproval: w === 1,
      createdAt: days(-rnd(40) - 5),
    });
    await Membership.create({ workspaceId: ws._id, userId: owner._id, role: "owner" });
    owner.defaultWorkspaceId = ws._id;
    await owner.save();
    const extra = w === 0 ? people.slice(14, 19) : people.slice(14 + ((w * 3) % 25), 16 + ((w * 3) % 25));
    for (const [j, u] of extra.entries()) {
      await Membership.updateOne({ workspaceId: ws._id, userId: u._id }, { $setOnInsert: { role: ["editor", "admin", "approver", "viewer"][j % 4] } }, { upsert: true });
    }

    // Channels
    const platforms = w === 0 ? [...SOCIAL] : SOCIAL.filter(() => Math.random() < 0.55);
    if (!platforms.length) platforms.push("instagram");
    const accounts = [];
    for (const p of platforms) {
      const handle = p === "youtube" || p === "facebook" ? BRANDS[w]! : `@${BRANDS[w]!.toLowerCase().replace(/[^a-z]+/g, "")}`;
      const acc = await SocialAccount.create({
        workspaceId: ws._id,
        platform: p,
        externalId: `sandbox_${randomBytes(5).toString("hex")}`,
        handle,
        displayName: BRANDS[w],
        accountType: { instagram: "business", facebook: "page", youtube: "channel", tiktok: "creator", linkedin: "member", threads: "profile" }[p],
        status: Math.random() < 0.08 ? "needs_reauth" : "active",
        sandbox: true,
        connectedBy: owner._id,
        createdAt: days(-rnd(30) - 3),
      });
      await OAuthCredential.create({ socialAccountId: acc._id, workspaceId: ws._id, accessTokenEnc: "v1.seed.seed.seed", expiresAt: days(rnd(55) + 2) });
      accounts.push(acc);
    }
    if (w === 0) {
      accounts.push(
        await SocialAccount.create({ workspaceId: ws._id, platform: "webhook", externalId: "webhook_seed", handle: "Company blog", displayName: "hooks.example.com", accountType: "webhook", connectedBy: owner._id, connector: { endpointUrl: "https://hooks.example.com/relay" } })
      );
    }

    // Communities: every kind in the demo workspace, a couple elsewhere.
    const slug = BRANDS[w]!.toLowerCase().replace(/[^a-z]+/g, "");
    const groups: InstanceType<typeof SocialAccount>[] = [];
    for (const c of w === 0 ? COMMUNITIES : COMMUNITIES.filter(() => Math.random() < 0.3)) {
      const acc = await SocialAccount.create({
        workspaceId: ws._id,
        platform: c.platform,
        externalId: `sandbox_${randomBytes(5).toString("hex")}`,
        handle: c.handle.replace("{slug}", slug).replace("{brand}", BRANDS[w]!),
        displayName: BRANDS[w],
        accountType: c.accountType,
        audienceSize: Math.round(c.size * (0.5 + Math.random())),
        connector: "connector" in c ? (JSON.parse(JSON.stringify(c.connector)) as Record<string, unknown>) : undefined,
        status: "active",
        sandbox: true,
        connectedBy: owner._id,
        createdAt: days(-rnd(30) - 3),
      });
      await OAuthCredential.create({ socialAccountId: acc._id, workspaceId: ws._id, accessTokenEnc: "v1.seed.seed.seed" });
      groups.push(acc);
    }

    // Media
    const palette: [number, number, number][][] = [
      [[214, 92, 52], [40, 30, 28]],
      [[38, 70, 83], [233, 196, 106]],
      [[42, 157, 143], [20, 33, 61]],
      [[244, 162, 97], [120, 40, 60]],
      [[90, 90, 140], [230, 220, 200]],
    ];
    const assets = [];
    const nMedia = w === 0 ? 8 : 3;
    for (let k = 0; k < nMedia; k++) {
      const [a, b] = palette[(w + k) % palette.length]!;
      const vertical = k % 2 === 0;
      const [W, H] = vertical ? [360, 640] : [480, 600];
      const buf = png(W, H, a!, b!);
      const key = `workspaces/${ws._id}/originals/seed/${randomBytes(6).toString("hex")}.png`;
      await mkdir(path.dirname(path.join(storageRoot, key)), { recursive: true });
      await writeFile(path.join(storageRoot, key), buf);
      assets.push(
        await MediaAsset.create({
          workspaceId: ws._id,
          uploadedBy: owner._id,
          kind: "image",
          filename: `${["cover", "teaser", "studio", "product", "bts"][k % 5]}-${k + 1}.png`,
          storageKey: key,
          mime: "image/png",
          sizeBytes: buf.length,
          width: W,
          height: H,
          checksum: createHash("sha256").update(buf).digest("hex"),
          createdAt: days(-rnd(25)),
        })
      );
    }

    // Posts across the last 30 days and the next 10
    const nPosts = w === 0 ? 34 : 6 + rnd(10);
    for (let k = 0; k < nPosts; k++) {
      const future = k % 3 === 0;
      const when = future ? days(rnd(10) + Math.random()) : days(-rnd(30) - Math.random());
      when.setMinutes(rnd(4) * 15, 0, 0);
      const chosen = accounts.filter((a) => a.status === "active").filter(() => Math.random() < 0.6);
      if (!chosen.length) continue;
      const asset = pick(assets);
      const draft = !future && k % 11 === 0;
      const post = await Post.create({
        workspaceId: ws._id,
        authorId: pick([owner, ...extra])._id,
        baseCaption: pick(CAPTIONS),
        title: k % 4 === 0 ? pick(["Launch teaser", "Weekly recap", "Studio tour", "Product close-up", "Community Q&A"]) : undefined,
        media: [{ assetId: asset._id, position: 0, editSpec: { crop: "9:16" } }],
        status: draft ? "draft" : future ? (w === 1 && k % 2 ? "pending_approval" : "scheduled") : "done",
        scheduledAt: draft ? undefined : when,
        timezone: tz,
        approval: { status: w === 1 && future && k % 2 ? "pending" : "not_required" },
        targetCount: chosen.length,
        createdAt: new Date(when.getTime() - 86400000 * (1 + rnd(3))),
      });
      const statuses: TargetStatus[] = [];
      for (const acc of chosen) {
        let status: TargetStatus = draft ? "scheduled" : future ? "scheduled" : "published";
        if (!future && !draft) {
          const r = Math.random();
          if (r < 0.09) status = "failed";
          else if (r < 0.13) status = "needs_action";
        }
        statuses.push(status);
        const errorCode = status === "failed" ? pick(["RATE_LIMITED", "MEDIA_REJECTED", "HTTP_500", "IG_CONTAINER_ERROR"]) : status === "needs_action" ? "TOKEN_EXPIRED" : undefined;
        const t = await PostTarget.create({
          workspaceId: ws._id,
          postId: post._id,
          socialAccountId: acc._id,
          platform: acc.platform,
          postType: TYPES[acc.platform]!,
          options: acc.platform === "youtube" ? { title: "Seeded short", privacy: "public" } : acc.platform === "tiktok" ? { privacy: "PUBLIC_TO_EVERYONE" } : {},
          status,
          attempts: status === "scheduled" ? 0 : status === "published" ? 1 + (Math.random() < 0.15 ? 1 : 0) : 5,
          nextAttemptAt: draft ? new Date(8.64e15) : when,
          publishedAt: status === "published" ? new Date(when.getTime() + rnd(120) * 1000) : undefined,
          permalink: status === "published" ? `https://example.com/${acc.platform}/${post._id}` : undefined,
          platformPostId: status === "published" ? `seed_${randomBytes(4).toString("hex")}` : undefined,
          lastErrorCode: errorCode,
          lastErrorMessage: errorCode ? { RATE_LIMITED: "Platform rate limit reached", MEDIA_REJECTED: "Video codec not supported", HTTP_500: "Platform returned an internal error", IG_CONTAINER_ERROR: "Container processing failed", TOKEN_EXPIRED: "Access token expired; reconnect the channel" }[errorCode] : undefined,
        });
        if (status !== "scheduled") {
          const steps = status === "published" ? ["preparing", "uploading", "processing", "published"] : ["preparing", "uploading", status === "needs_action" ? "needs_action" : "failed"];
          await PublishAttempt.insertMany(steps.map((s, i) => ({ workspaceId: ws._id, postTargetId: t._id, step: s, status: s, executionId: "seed", errorCode: ["failed", "needs_action"].includes(s) ? errorCode : undefined, createdAt: new Date(when.getTime() + i * 8000) })));
        }
      }
      if (!future && !draft) {
        const pub = statuses.filter((s) => s === "published").length;
        post.status = pub === statuses.length ? "done" : pub === 0 ? "failed" : "partially_failed";
        await post.save();
      }
    }
    // Community messages and polls
    for (let k = 0; k < (groups.length ? (w === 0 ? 18 : 3) : 0); k++) {
      const future = k % 4 === 0;
      const when = future ? days(rnd(6) + Math.random()) : days(-rnd(14) - Math.random());
      when.setMinutes(rnd(4) * 15, 0, 0);
      const isPoll = k % 5 === 2 && plans[w] !== "free";
      const chosen = groups.filter(() => Math.random() < 0.7);
      if (!chosen.length) continue;
      const poll = isPoll ? pick(POLLS) : undefined;
      const post = await Post.create({
        workspaceId: ws._id,
        authorId: pick([owner, ...extra])._id,
        title: poll ? poll.question : undefined,
        baseCaption: poll ? "" : pick(MESSAGES),
        poll,
        status: future ? "scheduled" : "done",
        scheduledAt: when,
        timezone: tz,
        targetCount: chosen.length,
        createdAt: new Date(when.getTime() - 3600_000 * (1 + rnd(20))),
      });
      const statuses: TargetStatus[] = [];
      for (const acc of chosen) {
        const pollable = ["telegram", "discord", "mastodon"].includes(acc.platform);
        const assisted = acc.connector?.mode === "assisted";
        let status: TargetStatus = future ? "scheduled" : "published";
        if (!future && assisted && k % 3 === 0) status = "needs_action";
        else if (!future && Math.random() < 0.06) status = "failed";
        statuses.push(status);
        const errorCode = status === "needs_action" ? "ASSISTED_POST_DUE" : status === "failed" ? "RATE_LIMITED" : undefined;
        const t = await PostTarget.create({
          workspaceId: ws._id,
          postId: post._id,
          socialAccountId: acc._id,
          platform: acc.platform,
          postType: poll && pollable ? "poll" : "message",
          captionOverride: poll && !pollable ? poll.question : undefined,
          options: k % 6 === 1 ? { headline: "Community update" } : {},
          status,
          attempts: status === "scheduled" ? 0 : 1,
          nextAttemptAt: when,
          publishedAt: status === "published" ? new Date(when.getTime() + rnd(30) * 1000) : undefined,
          permalink: status === "published" ? `https://example.com/${acc.platform}/${post._id}` : undefined,
          platformPostId: status === "published" ? `seed_${randomBytes(4).toString("hex")}` : undefined,
          liveEdits: status === "published" && k % 7 === 3 && acc.platform === "telegram" ? [{ at: new Date(when.getTime() + 600_000), by: owner._id, ok: true }] : undefined,
          lastErrorCode: errorCode,
          lastErrorMessage: errorCode === "ASSISTED_POST_DUE" ? "Time to post this in WhatsApp. Copy the text, send it in your channel or community, then mark it sent." : errorCode ? "Platform rate limit reached" : undefined,
        });
        if (status !== "scheduled") {
          const steps = status === "published" ? ["preparing", "uploading", "published"] : status === "needs_action" ? ["needs_action"] : ["preparing", "uploading", "failed"];
          await PublishAttempt.insertMany(steps.map((s2, i) => ({ workspaceId: ws._id, postTargetId: t._id, step: s2, status: s2, executionId: "seed", errorCode: ["failed", "needs_action"].includes(s2) ? errorCode : undefined, createdAt: new Date(when.getTime() + i * 3000) })));
        }
      }
      if (!future) {
        const pub = statuses.filter((x) => x === "published").length;
        post.status = pub === statuses.length ? "done" : pub === 0 ? "failed" : "partially_failed";
        await post.save();
      }
    }

    // A real video and soundtrack in the demo workspace, so per-channel cuts can be rendered.
    if (w === 0) await seedVideo(ws._id, owner._id, storageRoot);

    await AuditEvent.create({ action: "workspace.created", actorId: owner._id, actorEmail: owner.email, workspaceId: ws._id, entity: "workspace", entityId: String(ws._id), createdAt: ws.get("createdAt") });
  }

  const actions = ["user.login", "channel.connected", "post.scheduled", "post.publish_now", "media.uploaded", "member.added", "admin.user.suspended", "admin.workspace.plan_changed"];
  await AuditEvent.insertMany(
    Array.from({ length: 160 }, () => {
      const u = pick(people);
      return { action: pick(actions), actorId: u._id, actorEmail: u.email, entity: "user", entityId: String(u._id), ip: `10.0.${rnd(255)}.${rnd(255)}`, createdAt: days(-Math.random() * 30) };
    })
  );
  await Notification.create({ workspaceId: admin.defaultWorkspaceId ?? undefined, userId: admin._id, kind: "publish_failed", title: "Instagram post failed to publish", body: "Container processing failed", href: "/posts" });

  console.log(`seeded: ${await User.countDocuments()} users, ${await Workspace.countDocuments()} workspaces, ${await Post.countDocuments()} posts, ${await PostTarget.countDocuments()} deliveries`);
  console.log("sign in: admin@relay.dev / relay-demo-123 (admin). Every seeded user uses the same password.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/** Makes a 12-second test-pattern video and a tone with FFmpeg, if it's installed. */
async function seedVideo(workspaceId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId, storageRoot: string) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const dir = `workspaces/${workspaceId}/originals/seed`;
  await mkdir(path.join(storageRoot, dir), { recursive: true });
  const videoKey = `${dir}/sample-${randomBytes(4).toString("hex")}.mp4`;
  const audioKey = `${dir}/tone-${randomBytes(4).toString("hex")}.m4a`;
  try {
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(storageRoot, videoKey)]);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=20", "-c:a", "aac", path.join(storageRoot, audioKey)]);
  } catch {
    console.log("ffmpeg not found; skipping the sample video");
    return;
  }
  const v = await stat(path.join(storageRoot, videoKey));
  const a = await stat(path.join(storageRoot, audioKey));
  await MediaAsset.create({ workspaceId, uploadedBy: userId, kind: "video", filename: "launch-teaser.mp4", storageKey: videoKey, mime: "video/mp4", sizeBytes: v.size, width: 1280, height: 720, durationMs: 12_000, createdAt: days(-1) });
  await MediaAsset.create({ workspaceId, uploadedBy: userId, kind: "audio", filename: "warm-tone.m4a", storageKey: audioKey, mime: "audio/mp4", sizeBytes: a.size, durationMs: 20_000, audio: { source: "upload", title: "Warm tone" }, createdAt: days(-1) });
}
