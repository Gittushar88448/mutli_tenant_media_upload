# Relay n8n workflows

Relay owns the data and the state machine. n8n does the talking to platforms. The workflows only ever call Relay's internal API, so n8n never touches MongoDB.

| File | Workflow | Trigger | Job |
| --- | --- | --- | --- |
| `01-dispatcher.json` | Relay · Dispatcher | Every minute | Claims due targets and runs Publish target for each |
| `02-publish-now.json` | Relay · Publish now | Webhook `POST /webhook/relay-publish-now` | Same as the dispatcher, but for the target ids Relay sends straight away |
| `03-publish-target.json` | Relay · Publish target | Called by the two above | Hands community and Reddit targets to Relay; for the rest gets credentials and media, publishes, reports every step |
| `04-error-reporter.json` | Relay · Error reporter | Error workflow | Reports a crashed execution to Relay with its HTTP status, so the target retries or asks for a reconnect instead of staying stuck |
| `05-token-refresh.json` | Relay · Token refresh | Daily at 03:00 | Calls Relay to refresh tokens that expire soon |

## Setup

1. Set these environment variables on the n8n instance and restart it:
   - `RELAY_APP_URL`: Relay's public URL, for example `https://relay.example.com`
   - `RELAY_SHARED_SECRET`: the same value as `N8N_SHARED_SECRET` in Relay
   - `NODE_FUNCTION_ALLOW_BUILTIN=crypto`: the webhook connector signs payloads in a Code node
   - If your n8n blocks `$env` in expressions, also set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
2. Import the five JSON files (Workflows → Import from file).
3. Open **Relay · Publish target** and copy its workflow id from the URL. In **Dispatcher** and **Publish now**, open the Execute Workflow node and replace `REPLACE_WITH_PUBLISH_TARGET_WORKFLOW_ID` with it.
4. In the settings of Dispatcher, Publish now and Publish target, set the error workflow to **Relay · Error reporter**.
5. Activate all five. Copy the production webhook URL of **Publish now** into Relay's `N8N_PUBLISH_NOW_WEBHOOK_URL`.

Relay's admin control room shows "n8n connected" once both `N8N_SHARED_SECRET` and `N8N_PUBLISH_NOW_WEBHOOK_URL` are set. Until then, demo mode uses the built-in simulator.

## On n8n Cloud

n8n Cloud can't read environment variables, so bake Relay's URL and secret into the files instead, then import those:

```bash
python3 n8n/build-workflows.py --app-url https://your-relay-url --secret <N8N_SHARED_SECRET>
# writes n8n/workflows-cloud/*.json (contains your secret, git-ignored)
```

Relay has to be reachable from the internet, because n8n Cloud can't call `localhost`. Deploy it, or for testing run `cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`) and use the https URL it prints, both here and as `APP_URL` in `.env.local`.

To import, open **Workflows → Create workflow**, then the **⋯** menu at the top right → **Import from File**, and pick one file. Save it, and repeat for each file. Then do steps 3 to 5 above. The **Publish now** webhook URL on Cloud looks like `https://<your-workspace>.app.n8n.cloud/webhook/relay-publish-now`.

## Relay's internal API

Every call sends the header `x-relay-secret: <shared secret>`.

- `POST /api/internal/targets/claim` with `{ limit?, workerId?, targetIds? }` returns `{ targets: [...] }`. Each target carries its platform, post type, caption, options and account id. Claiming is atomic, so overlapping runs are safe.
- `GET /api/internal/targets/:id/credentials` returns the decrypted access token and the platform account id, or `sandbox: true`.
- `GET /api/internal/targets/:id/media` returns signed, expiring URLs for each media file, in order. When the channel has its own video cut, the first video is the rendered cut (`rendered: true`).
- `POST /api/internal/targets/:id/send` with `{ executionId? }` sends a community or Reddit target from inside Relay (Telegram, WhatsApp, Discord, Slack, Bluesky, Mastodon, Reddit) and records its events. Publish target calls it from the **Built into Relay?** branch.
- `POST /api/internal/targets/:id/events` takes `{ step, executionId?, platformContainerId?, uploadSessionUrl?, platformPostId?, permalink?, errorCode?, message?, httpStatus?, retryable?, authError? }`. `step` is one of `preparing`, `uploading`, `processing`, `published`, `failed`, `retrying`, `needs_action`. Relay decides retries and back-off; send `retryable: true` for 429s and 5xx, and `authError: true` for expired or revoked tokens.
- `POST /api/internal/maintenance/refresh-tokens` refreshes tokens that expire within 7 days and warns workspace admins about any that can't be refreshed.
- `GET /api/internal/health` reports app and database status.

## Adding a platform connector

Publish target first checks **Built into Relay?**. Community platforms and Reddit go to **Relay sends it**, which calls `/send`; their connectors live in `src/lib/publishing/connectors.ts`. Everything else continues to **Get credentials** and the **Route by platform** Switch node. Instagram (container → poll → publish), Facebook Pages, webhook, manual reminders and sandbox are built. YouTube, TikTok, LinkedIn, X, Threads and Pinterest fall through to a node that reports `CONNECTOR_NOT_BUILT`. To add one, add an output to the Switch, build the calls for that platform's API, and end with an HTTP node that posts `step: "published"` to `/events`, like **IG report published**. Errors thrown by the platform calls go to the error reporter, which classifies them (429 and 5xx retry, 401 and 403 need a reconnect) and reports them to Relay.

The workflows are generated by `build-workflows.py` (`npm run n8n:build`). Edit the script rather than the JSON if you want the change to survive a rebuild.
