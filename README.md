# Relay

Write one post, schedule it once, and Relay delivers it to every connected channel: Instagram, Facebook Pages, YouTube, TikTok, LinkedIn, X, Threads, Pinterest, plus any webhook or a manual reminder. Each workspace has its own channels, media library, queue and team. The platform admin panel manages every user, workspace, delivery and channel across all tenants.

Built with Next.js 16 (App Router), shadcn/ui components on Radix and Tailwind v4, MongoDB through Mongoose, and n8n for the publishing automation.

## Quick start

```bash
# 1. MongoDB 7+ running locally (any of these)
docker run -d --name relay-mongo -p 27017:27017 mongo:7
# or use a MongoDB Atlas connection string

# 2. Config
cp .env.example .env.local
# fill AUTH_SECRET (openssl rand -base64 48) and TOKEN_ENCRYPTION_KEY (openssl rand -base64 32)

# 3. Install, seed demo data, run
npm install
npm run seed -- --reset     # 43 users, 12 workspaces, ~145 posts, ~380 deliveries
npm run dev                 # http://localhost:3000
```

Demo login (admin): `admin@relay.dev` / `relay-demo-123`. Every seeded user shares that password. The first account registered on an empty database also becomes the platform admin.

Production: `npm run build && npm run start`. Set `DEMO_MODE=false`, a real `APP_URL`, and the platform app keys you have.

## What's where

| Area | Path |
| --- | --- |
| Landing, login, register, onboarding | `src/app/page.tsx`, `src/app/(auth)`, `src/app/onboarding` |
| Workspace app (overview, compose, queue, calendar, media, channels, settings) | `src/app/(app)/*` |
| Admin panel (control room, users, workspaces, publishing, channels, audit log, platform settings) | `src/app/admin/*` |
| Reusable data table (URL-driven search, faceted filters, sort, paging, bulk actions, column visibility) | `src/components/data-table` |
| shadcn/ui components | `src/components/ui` |
| Mongoose models | `src/lib/models` |
| Aggregation queries | `src/lib/queries` |
| Server actions | `src/lib/actions` |
| Publishing engine (claim, events, retries, roll-up) | `src/lib/publishing` |
| Platform registry (post types, caption limits, OAuth config) | `src/lib/platforms.ts` |
| API routes for media, OAuth and n8n | `src/app/api` |
| n8n workflows | `n8n/` (see `n8n/README.md`) |

## How publishing works

1. Composing a post creates one **post** and one **post_target** per destination channel, each with its own post type, caption override and options. Validation (`src/lib/publishing/validate.ts`) runs in the composer and again on the server.
2. A target moves through `scheduled → queued → preparing → uploading → processing → published`, or to `retrying`, `needs_action` or `failed`. Retries back off 1, 4, 15 and 60 minutes, up to 5 attempts. Token errors go to `needs_action` and notify the workspace.
3. n8n's dispatcher calls `POST /api/internal/targets/claim` every minute. An aggregation proposes due targets, capped per workspace for fairness and per account against platform daily limits. Each one is then taken with an atomic `findOneAndUpdate` guarded on status, so two workers can never claim the same target. Targets stuck in a running state are swept back to `retrying`.
4. For each claimed target, n8n fetches decrypted credentials (`/credentials`) and signed media URLs (`/media`), calls the platform, and reports every step to `/events`. Relay records each attempt and rolls the post status up (`published`, `partially_failed`, `failed`).
5. "Publish now" calls the n8n webhook in `N8N_PUBLISH_NOW_WEBHOOK_URL` straight away instead of waiting for the next minute.
6. With `DEMO_MODE` on and n8n not configured, an in-process simulator runs the same claim and event code paths, so the whole app works locally with sandbox channels.

Internal routes need the `x-relay-secret` header, matching `N8N_SHARED_SECRET`, and optionally an IP from `INTERNAL_IP_ALLOWLIST`. Social tokens are encrypted with AES-256-GCM, media links are HMAC-signed and expire, and webhook URLs are checked against private and loopback addresses.

## MongoDB aggregation pipelines

| Where | What it does |
| --- | --- |
| `queries/table-params.ts` → `paginate()` | `$sort` then `$facet` into `rows` + `total`, so every admin table is one round trip |
| `queries/admin.ts` → `getAdminOverview` | `$facet` across users, workspaces and targets: totals, 30-day delivery volume (`$dateToString`), sign-ups, per-platform sent/failed/queued (`$group` + `$cond`), top error codes with `$addToSet` platforms, busiest workspaces with `$lookup` |
| `queries/admin.ts` → `listUsers` | `$lookup` memberships → workspaces, posts and delivered targets with sub-pipelines; `$match` on regex search and facet filters; computed sort keys |
| `queries/admin.ts` → `getAdminUserDetail` | user, memberships with workspace and role, recent posts, delivery breakdown by status |
| `queries/admin.ts` → `listWorkspaces` | owner `$lookup`, member/channel/post counts, storage `$sum`, delivery success rate |
| `queries/admin.ts` → `listTargets`, `listAccounts`, `listAudit` | cross-tenant joins for the publishing, channel and audit tables |
| `queries/workspace.ts` → `getWorkspaceOverview` | 14-day volume, best-time heatmap with `$isoDayOfWeek`/`$hour` in the workspace timezone, per-channel stats, attention list |
| `queries/workspace.ts` → `getCalendarMonth`, `listWorkspacePosts`, `getPostDetail` | posts with their targets, platforms via `$setUnion`, per-status counts via `$arrayToObject` |
| `queries/shell.ts` → `getPlanUsage` | channels, posts this month and storage against plan limits in one `$facet` |
| `publishing/engine.ts` → `claimDueTargets` | due targets, `$lookup` account and post, today's per-account count for rate limits, `$group` by workspace with `$slice` for fairness |

## Roles and plans

Workspace roles: owner, admin, editor, approver, viewer. When a workspace turns on approvals, editors' posts wait for an approver or admin. Plans (free, creator, studio, agency) limit channels, posts per month, storage and team seats; admins change a workspace's plan in `/admin/workspaces`. Platform admins sit above all of this and work in `/admin`.

## Connecting real accounts

Accounts connect only through each platform's OAuth sign-in (`/api/oauth/[platform]/start`). A profile URL can't grant posting access. Add the app keys from `.env.example` for each platform you register, and set the OAuth redirect URL on the platform side to `APP_URL/api/oauth/<platform>/callback`. Platforms without keys show "Sandbox only" while demo mode is on.

Music libraries from the platforms aren't available through any public API, so audio in Relay is limited to files you upload.

## Not built yet

- n8n connectors for YouTube, TikTok, LinkedIn, X, Threads and Pinterest. The publish-target workflow routes them to a fallback that reports `CONNECTOR_NOT_BUILT`. Instagram, Facebook Pages, webhooks, manual reminders and sandbox are wired.
- Media rendering (FFmpeg trims, crops and audio mixing). The composer stores an edit spec on the post; nothing renders it yet.
- Storage uses local disk (`STORAGE_DIR`). Swap `src/lib/storage.ts` for S3 or R2 before deploying to more than one server.
- Email delivery for invites and password resets. Admin password resets show a one-time password in the UI.
