/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped aggregation output */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { ExternalLinkIcon, FlaskConicalIcon } from "lucide-react";
import { can, getWorkspaceContext } from "@/lib/auth/session";
import { getPostDetail } from "@/lib/queries/workspace";
import { isOid } from "@/lib/models";
import { PLATFORMS, type TargetPlatform } from "@/lib/platforms";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { MediaThumb } from "@/components/media/thumb";
import { Badge } from "@/components/ui/badge";
import { PostActions, TargetActions } from "./actions";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Post" };

const STEPS = ["scheduled", "queued", "preparing", "uploading", "processing", "published"];

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isOid(id)) notFound();
  const ctx = await getWorkspaceContext();
  const post = await getPostDetail(ctx.workspace.id, id);
  if (!post) notFound();
  const tz = ctx.workspace.timezone;
  const live = ["publishing", "scheduled"].includes(post.status) && post.targets.some((t: { status: string }) => ["queued", "preparing", "uploading", "processing", "retrying"].includes(t.status));

  return (
    <div className="space-y-10">
      {live && <AutoRefresh />}
      <PageHeader
        eyebrow={`Post · ${post.author?.name ?? "Unknown"} · created ${formatInTimeZone(post.createdAt, tz, "d MMM, HH:mm")}`}
        title={post.title || (post.baseCaption ? post.baseCaption.slice(0, 60) + (post.baseCaption.length > 60 ? "…" : "") : "Untitled post")}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={post.status} />
            {post.scheduledAt && <span className="font-mono text-xs">{formatInTimeZone(post.scheduledAt, tz, "EEEE d MMMM yyyy, HH:mm")} · {tz}</span>}
          </span>
        }
        actions={<PostActions postId={id} status={post.status} canEdit={can(ctx.role, "editor")} canApprove={can(ctx.role, "approver")} />}
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <section>
          <SectionTitle n="01" aside={<span className="font-mono text-[11px] text-muted-foreground">{post.targets.length} channels</span>}>
            Deliveries
          </SectionTitle>
          <div className="space-y-3">
            {post.targets.map((t: Record<string, any>) => {
              const stepIdx = STEPS.indexOf(t.status);
              const spec = PLATFORMS[t.platform as TargetPlatform];
              return (
                <div key={String(t._id)} className="rounded-md border bg-card">
                  <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                    <PlatformIcon platform={t.platform} tone="chip" className="size-7 p-1.5" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        {t.account.handle}
                        {t.account.sandbox && <FlaskConicalIcon className="size-3.5 text-muted-foreground" />}
                      </p>
                      <p className="font-mono text-[10.5px] text-muted-foreground uppercase">
                        {spec?.postTypes.find((p) => p.id === t.postType)?.label} · attempt {t.attempts}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                    {t.permalink && (
                      <a href={t.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline decoration-signal decoration-2 underline-offset-4">
                        View <ExternalLinkIcon className="size-3.5" />
                      </a>
                    )}
                    <TargetActions targetId={String(t._id)} status={t.status} platform={t.platform} canEdit={can(ctx.role, "editor")} />
                  </div>
                  {/* Step rail */}
                  <div className="grid grid-cols-6 gap-1 px-4 pt-3">
                    {STEPS.map((s, i) => (
                      <div key={s}>
                        <div className={`h-1 rounded-full ${t.status === "published" || i <= stepIdx ? "bg-foreground" : ["failed", "needs_action"].includes(t.status) && i <= 2 ? "bg-signal" : "bg-secondary"}`} />
                        <p className="mt-1 font-mono text-[9.5px] text-muted-foreground uppercase">{s}</p>
                      </div>
                    ))}
                  </div>
                  {(t.lastErrorMessage || t.lastErrorCode) && t.status !== "published" && (
                    <p className="mx-4 mt-3 rounded-md bg-signal/[0.07] px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-signal">{t.lastErrorCode}</span> {t.lastErrorMessage}
                    </p>
                  )}
                  {t.attemptsLog.length > 0 && (
                    <details className="group px-4 py-3">
                      <summary className="cursor-pointer list-none font-mono text-[11px] text-muted-foreground hover:text-foreground">
                        <span className="group-open:hidden">▸</span>
                        <span className="hidden group-open:inline">▾</span> Delivery log ({t.attemptsLog.length})
                      </summary>
                      <ol className="mt-2 space-y-1 border-l pl-3">
                        {t.attemptsLog.map((a: Record<string, any>) => (
                          <li key={String(a._id)} className="font-mono text-[11.5px]">
                            <span className="text-muted-foreground">{formatInTimeZone(a.createdAt, tz, "d MMM HH:mm:ss")}</span> {a.step}
                            {a.errorCode && <span className="text-signal"> {a.errorCode}</span>}
                            {a.httpStatus && <span className="text-muted-foreground"> HTTP {a.httpStatus}</span>}
                            {a.message && <span className="text-muted-foreground"> · {a.message}</span>}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {!t.attemptsLog.length && <div className="h-3" />}
                  {t.captionOverride && (
                    <div className="border-t px-4 py-3 text-sm">
                      <Badge variant="outline" className="mb-1.5">
                        Own caption
                      </Badge>
                      <p className="whitespace-pre-wrap text-muted-foreground">{t.captionOverride}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <aside className="space-y-6">
          <div>
            <SectionTitle n="02">Media</SectionTitle>
            {post.assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Text only.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {post.media.map((m: { assetId: unknown }) => {
                  const a = post.assets.find((x: { _id: unknown }) => String(x._id) === String(m.assetId));
                  return a ? <MediaThumb key={String(a._id)} item={{ id: String(a._id), kind: a.kind, durationMs: a.durationMs }} className="aspect-square rounded-md border" /> : null;
                })}
              </div>
            )}
          </div>
          <div>
            <SectionTitle n="03">Caption</SectionTitle>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.baseCaption || <span className="text-muted-foreground">No caption</span>}</p>
          </div>
          {post.approval?.status && post.approval.status !== "not_required" && (
            <div>
              <SectionTitle n="04">Approval</SectionTitle>
              <StatusBadge status={post.approval.status === "pending" ? "pending_approval" : post.approval.status === "approved" ? "done" : "failed"} />
              {post.approval.note && <p className="mt-2 text-sm text-muted-foreground">{post.approval.note}</p>}
            </div>
          )}
          <Link href={`/compose?duplicate=${id}`} className="inline-block text-sm underline decoration-signal decoration-2 underline-offset-4">
            Duplicate as a new post
          </Link>
        </aside>
      </div>
    </div>
  );
}
