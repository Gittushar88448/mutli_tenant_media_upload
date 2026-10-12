# Relay

Write one post, schedule it once, and Relay delivers it to every connected channel: Instagram, Facebook Pages, YouTube, TikTok, LinkedIn, X, Threads, Pinterest and Reddit, plus communities and messaging (Telegram, WhatsApp, Discord, Slack, Bluesky, Mastodon), any webhook or a manual reminder. Every channel can get its own text, title and video cut. Each workspace has its own channels, media library, queue and team. The platform admin panel manages every user, workspace, delivery and channel across all tenants.

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
| Workspace app (overview, compose, communities, queue, calendar, live view, media, channels, billing, settings, guide) | `src/app/(app)/*` |
| In-app guide: setup checklist, connecting platforms and communities, pricing, roles, FAQ | `src/app/(app)/guide`, copy in `src/lib/guide.ts` |
| Admin panel (control room, users, workspaces, publishing, channels, audit log, platform settings) | `src/app/admin/*` |
| Reusable data table (URL-driven search, faceted filters, sort, paging, bulk actions, column visibility) | `src/components/data-table` |
| shadcn/ui components | `src/components/ui` |
| Mongoose models | `src/lib/models` |
| Aggregation queries | `src/lib/queries` |
| Server actions | `src/lib/actions` |
| Publishing engine (claim, events, retries, roll-up) | `src/lib/publishing` |
| Platform registry (post types, caption limits, OAuth config, community credentials) | `src/lib/platforms.ts` |
| Community connectors (Telegram, WhatsApp, Discord, Slack, Bluesky, Mastodon, Reddit) | `src/lib/publishing/connectors.ts`, `direct.ts` |
| Per-channel video rendering (FFmpeg) | `src/lib/media/render.ts` |
| Media editor: crop, rotate, trim, filters, LUTs, music | `src/app/(app)/media/[id]/edit`, `src/lib/media/filters.ts`, `edit.ts`, `music.ts` |
| Media storage (Cloudinary or local disk) | `src/lib/storage.ts`, `src/lib/cloudinary.ts` |
| Live view: post stats, comments and replies, channel health | `src/app/(app)/live`, `src/lib/live` |
| Plans, features, Razorpay billing | `src/lib/plans.ts`, `src/lib/billing`, `src/app/(app)/billing` |
| Google sign-in | `src/lib/auth/google.ts`, `src/app/api/auth/google` |
| API routes for media, OAuth and n8n | `src/app/api` |
| n8n workflows | `n8n/` (see `n8n/README.md`) |

## How publishing works

1. Composing a post creates one **post** and one **post_target** per destination channel, each with its own post type, caption override and options. Validation (`src/lib/publishing/validate.ts`) runs in the composer and again on the server.
2. A target moves through `scheduled → queued → preparing → uploading → processing → published`, or to `retrying`, `needs_action` or `failed`. Retries back off 1, 4, 15 and 60 minutes, up to 5 attempts. Token errors go to `needs_action` and notify the workspace.
3. n8n's dispatcher calls `POST /api/internal/targets/claim` every minute. An aggregation proposes due targets, capped per workspace for fairness and per account against platform daily limits. Each one is then taken with an atomic `findOneAndUpdate` guarded on status, so two workers can never claim the same target. Targets stuck in a running state are swept back to `retrying`.
4. For each claimed target, n8n fetches decrypted credentials (`/credentials`) and signed media URLs (`/media`), calls the platform, and reports every step to `/events`. Relay records each attempt and rolls the post status up (`published`, `partially_failed`, `failed`).
5. "Publish now" calls the n8n webhook in `N8N_PUBLISH_NOW_WEBHOOK_URL` straight away instead of waiting for the next minute.
6. With `DEMO_MODE` on and n8n not configured, an in-process simulator runs the same claim and event code paths, so the whole app works locally with sandbox channels.
7. Community platforms and Reddit are sent by Relay itself. n8n's **Built into Relay?** branch hands those targets to `POST /api/internal/targets/:id/send`, which renders the channel's cut if it has one, sends it, and records the same events.

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

## Communities and messaging

The **Communities** page lists every connected group, channel and server with its members, messages sent and queue, and has a quick box to send one message or poll to all of them at once (now or scheduled). Anything sent there is a normal post, so it shows in the queue, calendar and post page too.

| Platform | Connect with | Sends | Edit after sending |
| --- | --- | --- | --- |
| Telegram | Bot token from @BotFather + channel or group id (bot must be an admin) | text, photo/video, albums (2 to 10), polls, pin, silent | yes |
| WhatsApp | Cloud API: phone number id, access token, recipients (numbers or group ids) | text, media, approved templates outside the 24-hour window | no |
| WhatsApp Channels and Communities | Assisted: the channel's invite link | Relay reminds you with the text ready to copy and a button to open WhatsApp | no |
| Discord | Channel webhook URL | text, files, polls | yes |
| Slack | Bot token (`chat:write`, `files:write`) + channel id | text, files | yes |
| Bluesky | Handle + app password (optional PDS) | text with links and tags, up to 4 images | no |
| Mastodon | Instance URL + access token (`write:statuses`, `write:media`) | text, media, polls, visibility, content warning | yes |
| Reddit | OAuth (`REDDIT_CLIENT_ID`/`SECRET`) | text and link posts to a subreddit, flair, NSFW, spoiler | text posts |

Tokens and passwords are checked against the platform when you connect and stored encrypted. In demo mode each tile also offers a sandbox community.

WhatsApp Channels, Facebook Groups and Instagram broadcast channels have no posting API, so Relay can't post to them on its own. They work as assisted or manual channels: when the post is due, it shows up under "needs you" with the text ready to paste.

## Per-channel edits

In the composer each channel has its own panel:

- **Text**: its own caption or description, headline or title, and platform options (subreddit, visibility, silent, pin and so on), each checked against that platform's limits.
- **Video cut**: its own trim, crop (9:16, 1:1, 4:5, 16:9), soundtrack and volume. `src/lib/media/render.ts` renders the cut with FFmpeg when the post goes out (or on "Render preview") and caches it as a hidden variant of the original, so the same cut is only rendered once.
- **Polls** on Telegram, Discord and Mastodon. Groups that can't run polls get the question written out as a message.

After a post is created, **Edit** next to a channel on the post page changes one channel without touching the others. Failed channels can be fixed and sent again. Messages already sent to Telegram, Discord, Slack, Mastodon or Reddit can be updated in place, and the post page shows how many times each was edited.

## Roles and plans

Workspace roles: owner, admin, editor, approver, viewer. When a workspace turns on approvals, editors' posts wait for an approver or admin. Platform admins sit above all of this and work in `/admin`.

Plans limit channels, posts per month, storage and seats, and unlock editing features. They are defined in `src/lib/plans.ts`; the server enforces them in every action and the UI shows a lock with a link to the plan that has it.

| Plan | Price (INR) | Editing features |
| --- | --- | --- |
| Free | ₹0 | Same text and media on every channel |
| Creator | ₹1,299/mo or ₹12,499/yr | Different text per channel, per-channel video cuts, polls, editing a channel after it's scheduled or failed |
| Studio | ₹3,999/mo or ₹38,399/yr | Everything in Creator, plus updating messages that are already live |
| Agency | ₹11,999/mo or ₹1,15,199/yr | Everything in Studio, with the highest limits |

Owners and admins change plans on **Plan & billing** (`/billing`). Platform admins can still set any workspace's plan in `/admin/workspaces`. Razorpay is the only payment provider:

- **Razorpay**, when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set. Customers pay with UPI, cards or netbanking.
- **Demo**, with no keys: the plan switches straight away so every feature can be tried.

### Razorpay setup

1. Put your API keys in `.env.local` (test keys first).
2. Run `npm run razorpay:plans`. It creates the six recurring plans (three paid plans, monthly and yearly) from the INR prices in `src/lib/plans.ts` and prints the `RAZORPAY_PLAN_…` lines to paste. To use plans you already have, paste their ids instead; the billing page shows their real amounts.
3. In the Razorpay dashboard add a webhook to `APP_URL/api/billing/razorpay/webhook` with the `subscription.*` events, and put its secret in `RAZORPAY_WEBHOOK_SECRET`.

How it behaves:

- **Upgrading** creates a subscription and opens Razorpay Checkout. When it returns, Relay checks the payment signature, reads the subscription from Razorpay and unlocks the plan. The webhook keeps renewals in sync after that.
- **Switching plans** starts a new subscription. The old one is cancelled as soon as the new one is paid, with no proration.
- **Moving to Free** cancels at the end of the paid period.
- **Failed renewals:** a failed charge marks the plan past due. If Razorpay gives up (halted), the workspace drops to Free until a charge succeeds.
- **Missed webhooks:** if one never arrives, the billing page re-checks the subscription with Razorpay once the period has ended.

## Sign in with Google

Login and sign-up both offer **Continue with Google** once a Google OAuth client is configured (`GOOGLE_AUTH_CLIENT_ID`/`SECRET`, or the YouTube `GOOGLE_CLIENT_ID`/`SECRET`). Add `APP_URL/api/auth/google/callback` as an authorized redirect URI on that client. Only the `openid email profile` scopes are requested, so the consent screen needs no Google verification.

The flow is OpenID Connect with PKCE, a signed state cookie and a nonce:

- **Returning Google users** sign straight in.
- **Existing email accounts** are linked the first time someone signs in with Google using the same verified address. Their password keeps working too.
- **New people** get an account, then name their first workspace. The admin panel's "Open sign-ups" setting applies to them like any other sign-up.
- **Google-only accounts** have no password. Signing in with a password tells them to use Google.

Admins see who uses Google sign-in in the users table.

## Connecting real accounts

Social accounts connect only through each platform's OAuth sign-in (`/api/oauth/[platform]/start`). A profile URL can't grant posting access. Communities connect with the credentials in the table above. Add the app keys from `.env.example` for each platform you register, and set the OAuth redirect URL on the platform side to `APP_URL/api/oauth/<platform>/callback`. Platforms without keys show "Sandbox only" while demo mode is on.

## Media storage (Cloudinary)

Set `CLOUDINARY_URL` (Cloudinary dashboard → API Keys, `cloudinary://<key>:<secret>@<cloud>`) or the three `CLOUDINARY_*` values in `.env.local`. New uploads, edited copies, rendered cuts and imported songs then go to Cloudinary under `CLOUDINARY_FOLDER` and are served from its CDN; platforms pull media straight from Cloudinary URLs. Files uploaded before you set the keys stay on local disk and keep working. `STORAGE_DRIVER=local` forces local disk.

## Media editor

Media → a photo or video → **Edit**. Crop (free or 1:1, 4:5, 9:16, 16:9, 1.91:1), rotate, flip and trim are on every plan; filters, adjustments, filter packs, custom LUTs and music need Creator or above (`mediaStudio` in `src/lib/plans.ts`, enforced in `src/lib/actions/editor.ts`). Every colour change is one function in `src/lib/media/filters.ts`: the browser preview runs it on canvas pixels and the server bakes it into a 33-point 3D LUT for FFmpeg's `lut3d`, so the saved file matches the preview. Saving always creates a new copy. Filters download as `.cube` (works in Lightroom, Premiere, Resolve, CapCut) or `.relayfilter`, and `.cube` LUTs can be imported.

## Music

Instagram's and TikTok's song libraries aren't available to other apps through any API. The music library searches Jamendo (about 600,000 Creative Commons tracks with genres, moods and a weekly chart); get a free client id at devportal.jamendo.com and set `JAMENDO_CLIENT_ID`. Without it, five generated demo tracks stand in. A chosen track is copied into the media library with its licence and mixed into the video (or turns a photo into a short MP4). Check each track's licence for commercial use.

## Live view

`/live` reads each published post back from its platform: status, numbers and comments, cached for five minutes, with replies sent from Relay. Comments and replies: Instagram, Facebook Pages, YouTube, Threads, Reddit, Bluesky, Mastodon, Slack threads. Numbers only: X, TikTok, Discord. Status only: Telegram, WhatsApp, Pinterest, LinkedIn, webhooks. Sandbox channels get simulated numbers and comments. The OAuth scopes for reading comments and insights are in `src/lib/platforms.ts`; accounts connected earlier need to reconnect to grant them.

## Not built yet

- n8n connectors for YouTube, TikTok, LinkedIn, X, Threads and Pinterest. The publish-target workflow routes them to a fallback that reports `CONNECTOR_NOT_BUILT`. Instagram, Facebook Pages, webhooks, manual reminders and sandbox are wired.
- Rendering runs inside the Next.js server process. For heavy video volume, move `ensureRendered` to a worker queue.
- Without Cloudinary, media lives on local disk, which only suits a single server.
- Edits and renders run inside the Next.js server process; move them to a worker queue for heavy video volume.
- Email delivery for invites and password resets. Admin password resets show a one-time password in the UI.
