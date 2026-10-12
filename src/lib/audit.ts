import "server-only";
import { headers } from "next/headers";
import { AuditEvent, oid } from "@/lib/models";

export async function audit(input: {
  action: string;
  actor?: { id: string; email?: string } | null;
  workspaceId?: string | null;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}) {
  let ip: string | undefined;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? undefined;
  } catch {
    // called outside a request (n8n callback paths pass no headers); fine to skip
  }
  await AuditEvent.create({
    action: input.action,
    actorId: input.actor?.id ? oid(input.actor.id) : undefined,
    actorEmail: input.actor?.email,
    workspaceId: input.workspaceId ? oid(input.workspaceId) : undefined,
    entity: input.entity,
    entityId: input.entityId,
    meta: input.meta,
    ip,
  });
}
