import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { connectDB } from "@/lib/db";
import { AppSettings, MediaAsset, PLAN_LIMITS, oid } from "@/lib/models";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { putObject } from "@/lib/storage";
import { randomToken } from "@/lib/crypto";
import { audit } from "@/lib/audit";

const ALLOWED: Record<string, "image" | "video" | "audio"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/aac": "audio",
};

/** Checks the file's real type from its first bytes, not the name the browser sent. */
function sniff(buf: Buffer): string | null {
  const hex = buf.subarray(0, 16).toString("hex");
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WAVE") return "audio/wav";
  if (buf.subarray(4, 8).toString() === "ftyp") {
    const brand = buf.subarray(8, 12).toString();
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4";
  }
  if (hex.startsWith("1a45dfa3")) return "video/webm";
  if (hex.startsWith("494433") || hex.startsWith("fffb") || hex.startsWith("fff3")) return "audio/mpeg";
  if (hex.startsWith("fff1") || hex.startsWith("fff9")) return "audio/aac";
  return null;
}

export async function POST(req: Request) {
  const ctx = await getWorkspaceContext();
  if (!can(ctx.role, "editor")) return NextResponse.json({ error: "Viewers can't upload." }, { status: 403 });
  await connectDB();

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });

  const settings = await AppSettings.findOne({ key: "global" }).lean();
  const maxMb = settings?.maxUploadMb ?? 512;
  if (file.size > maxMb * 1024 * 1024) return NextResponse.json({ error: `Files can be at most ${maxMb} MB.` }, { status: 413 });

  const limits = PLAN_LIMITS[ctx.workspace.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
  const [used] = await MediaAsset.aggregate([{ $match: { workspaceId: oid(ctx.workspace.id) } }, { $group: { _id: null, b: { $sum: "$sizeBytes" } } }]);
  if ((used?.b ?? 0) + file.size > limits.storageMb * 1024 * 1024) {
    return NextResponse.json({ error: "This upload would go over your plan's storage. Delete old files or upgrade." }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniff(buf);
  const kind = mime ? ALLOWED[mime] : undefined;
  if (!mime || !kind) return NextResponse.json({ error: "That file type isn't supported. Use JPG, PNG, WebP, MP4, MOV, WebM, MP3, M4A or WAV." }, { status: 415 });

  const ext = mime.split("/")[1]!.replace("quicktime", "mov").replace("mpeg", "mp3").replace("x-", "");
  const key = `workspaces/${ctx.workspace.id}/originals/${new Date().toISOString().slice(0, 7)}/${randomToken(12)}.${ext}`;
  const { storage } = await putObject(key, buf, mime);

  const num = (k: string) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
  };
  const asset = await MediaAsset.create({
    workspaceId: oid(ctx.workspace.id),
    uploadedBy: oid(ctx.user.id),
    kind,
    filename: file.name.slice(0, 200),
    storageKey: key,
    storage,
    mime,
    sizeBytes: file.size,
    width: num("width"),
    height: num("height"),
    durationMs: num("durationMs"),
    checksum: createHash("sha256").update(buf).digest("hex"),
    status: "ready",
    audio: kind === "audio" ? { source: "upload", title: file.name.replace(/\.[^.]+$/, "") } : undefined,
  });
  await audit({ action: "media.uploaded", actor: ctx.user, workspaceId: ctx.workspace.id, entity: "media", entityId: String(asset._id), meta: { kind, size: file.size } });

  return NextResponse.json({
    id: String(asset._id),
    kind,
    filename: asset.filename,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    mime,
    createdAt: new Date().toISOString(),
  });
}
