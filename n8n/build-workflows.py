"""
Generates the n8n workflow exports in ./workflows. Edit this file, re-run it, and
re-import, so the workflows stay reviewable in git (see the architecture doc:
"Keep the workflows in git and promote them from staging to production").

    python3 n8n/build-workflows.py

By default every workflow reads two n8n environment variables:
    RELAY_APP_URL        e.g. http://relay-app:3000  (private network address of the app)
    RELAY_SHARED_SECRET  same value as the app's N8N_SHARED_SECRET

n8n Cloud can't read environment variables, so for Cloud bake the values in instead:

    python3 n8n/build-workflows.py --app-url https://relay.example.com --secret <N8N_SHARED_SECRET>

That writes to ./workflows-cloud, which holds your secret: don't commit it.
"""
import argparse, json, os, uuid

ap = argparse.ArgumentParser()
ap.add_argument("--app-url", help="Relay's public URL; bakes it in instead of reading $env (needed on n8n Cloud)")
ap.add_argument("--secret", help="N8N_SHARED_SECRET; bakes it in instead of reading $env")
ap.add_argument("--out", help="output folder (default ./workflows, or ./workflows-cloud with --app-url)")
ARGS = ap.parse_args()
if bool(ARGS.app_url) != bool(ARGS.secret):
    ap.error("--app-url and --secret go together")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = ARGS.out or os.path.join(HERE, "workflows-cloud" if ARGS.app_url else "workflows")
os.makedirs(OUT, exist_ok=True)
APP = "=" + ARGS.app_url.rstrip("/") if ARGS.app_url else "={{$env.RELAY_APP_URL}}"
SECRET_VALUE = ARGS.secret if ARGS.secret else "={{$env.RELAY_SHARED_SECRET}}"
SECRET_HDR = {"parameters": [{"name": "x-relay-secret", "value": SECRET_VALUE}]}
GRAPH = "https://graph.facebook.com/v21.0"


class WF:
    def __init__(self, name, error_workflow=None):
        self.name, self.nodes, self.conn = name, [], {}
        self.settings = {"executionOrder": "v1", "saveDataErrorExecution": "all", "saveDataSuccessExecution": "none"}
        # n8n stores the error workflow by id, so it's set after import (see n8n/README.md).
        self.error_workflow = error_workflow
        self.x = 0

    def node(self, name, type_, params, version, pos=None, **extra):
        self.x += 240
        n = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, self.name + name)), "name": name, "type": type_, "typeVersion": version,
             "position": pos or [self.x, 300], "parameters": params}
        n.update(extra)
        self.nodes.append(n)
        return name

    def link(self, a, b, out=0):
        self.conn.setdefault(a, {"main": []})
        while len(self.conn[a]["main"]) <= out:
            self.conn[a]["main"].append([])
        self.conn[a]["main"][out].append({"node": b, "type": "main", "index": 0})

    def chain(self, *names):
        for a, b in zip(names, names[1:]):
            self.link(a, b)

    def save(self, file):
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, file), "w") as f:
            json.dump({"name": self.name, "nodes": self.nodes, "connections": self.conn, "settings": self.settings, "active": False, "pinData": {}}, f, indent=2)


def http(wf, name, method, url, body=None, pos=None, headers=None, retry=True, never_error=False, query=None):
    p = {"method": method, "url": url, "options": {"timeout": 30000}}
    hdrs = headers if headers is not None else SECRET_HDR
    if hdrs:
        p["sendHeaders"] = True
        p["headerParameters"] = hdrs
    if query:
        p["sendQuery"] = True
        p["queryParameters"] = {"parameters": [{"name": k, "value": v} for k, v in query.items()]}
    if body is not None:
        p["sendBody"] = True
        p["specifyBody"] = "json"
        p["jsonBody"] = body
    if never_error:
        p["options"]["response"] = {"response": {"neverError": True, "fullResponse": True}}
    extra = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 2000} if retry else {}
    return wf.node(name, "n8n-nodes-base.httpRequest", p, 4.2, pos, **extra)


def report(wf, name, step_expr, pos=None, extra=""):
    body = '={{ JSON.stringify({ step: ' + step_expr + ', executionId: $execution.id' + extra + ' }) }}'
    return http(wf, name, "POST", APP + "/api/internal/targets/{{ $('Target').item.json.id }}/events", body, pos)


def code(wf, name, js, pos=None):
    return wf.node(name, "n8n-nodes-base.code", {"jsCode": js}, 2, pos)


# ------------------------------------------------------------------ Dispatcher
d = WF("Relay · Dispatcher", error_workflow="Relay · Error reporter")
d.node("Every minute", "n8n-nodes-base.scheduleTrigger", {"rule": {"interval": [{"field": "minutes", "minutesInterval": 1}]}}, 1.2, [0, 300])
d.x = 0
http(d, "Claim due targets", "POST", APP + "/api/internal/targets/claim", '={{ JSON.stringify({ limit: 25, workerId: "n8n-" + $execution.id }) }}')
d.node("One item per target", "n8n-nodes-base.splitOut", {"fieldToSplitOut": "targets", "options": {}}, 1)
d.node("Publish target", "n8n-nodes-base.executeWorkflow",
       {"source": "database", "workflowId": {"__rl": True, "mode": "id", "value": "REPLACE_WITH_PUBLISH_TARGET_WORKFLOW_ID"},
        "mode": "each", "options": {"waitForSubWorkflow": False}}, 1.2)
d.chain("Every minute", "Claim due targets", "One item per target", "Publish target")
d.save("01-dispatcher.json")

# ------------------------------------------------------------------ Publish now
n = WF("Relay · Publish now", error_workflow="Relay · Error reporter")
n.node("Publish-now webhook", "n8n-nodes-base.webhook",
       {"httpMethod": "POST", "path": "relay-publish-now", "responseMode": "onReceived", "options": {}}, 2, [0, 300], webhookId="relay-publish-now")
n.x = 0
n.node("Check secret", "n8n-nodes-base.if", {
    "conditions": {"options": {"caseSensitive": True, "typeValidation": "strict"}, "combinator": "and",
                   "conditions": [{"leftValue": "={{ $json.headers['x-relay-secret'] }}", "rightValue": SECRET_VALUE,
                                   "operator": {"type": "string", "operation": "equals"}}]}, "options": {}}, 2.2)
http(n, "Claim these targets", "POST", APP + "/api/internal/targets/claim",
     '={{ JSON.stringify({ targetIds: $json.body.targetIds, limit: 100, workerId: "n8n-now-" + $execution.id }) }}')
n.node("One item per target", "n8n-nodes-base.splitOut", {"fieldToSplitOut": "targets", "options": {}}, 1)
n.node("Publish target", "n8n-nodes-base.executeWorkflow",
       {"source": "database", "workflowId": {"__rl": True, "mode": "id", "value": "REPLACE_WITH_PUBLISH_TARGET_WORKFLOW_ID"},
        "mode": "each", "options": {"waitForSubWorkflow": False}}, 1.2)
n.chain("Publish-now webhook", "Check secret", "Claim these targets", "One item per target", "Publish target")
n.save("02-publish-now.json")

# ------------------------------------------------------------------ Publish target (router + connectors)
p = WF("Relay · Publish target", error_workflow="Relay · Error reporter")
p.node("Target", "n8n-nodes-base.executeWorkflowTrigger", {"inputSource": "passthrough"}, 1.1, [-480, 600])

# Community and messaging platforms (Telegram, WhatsApp, Discord, Slack, Bluesky, Mastodon)
# and Reddit are delivered by Relay's built-in connectors: n8n only hands the target over.
DIRECT = ["telegram", "whatsapp", "discord", "slack", "bluesky", "mastodon", "reddit"]
p.node("Built into Relay?", "n8n-nodes-base.if", {
    "conditions": {"options": {"caseSensitive": True, "typeValidation": "loose"}, "combinator": "and",
                   "conditions": [{"leftValue": "={{ " + json.dumps(DIRECT) + ".includes($json.platform) }}", "rightValue": True,
                                   "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]}, "options": {}}, 2.2, [-240, 600])
p.link("Target", "Built into Relay?")
p.node("Relay sends it", "n8n-nodes-base.httpRequest", {
    "method": "POST", "url": APP + "/api/internal/targets/{{ $('Target').item.json.id }}/send",
    "sendHeaders": True, "headerParameters": SECRET_HDR,
    "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify({ executionId: $execution.id }) }}",
    "options": {"timeout": 300000}}, 4.2, [0, 360])
p.link("Built into Relay?", "Relay sends it", 0)

http(p, "Get credentials", "GET", APP + "/api/internal/targets/{{ $json.id }}/credentials", pos=[240, 600])
http(p, "Get media", "GET", APP + "/api/internal/targets/{{ $('Target').item.json.id }}/media", pos=[480, 600])
report(p, "Report preparing", '"preparing"', pos=[720, 600])
p.link("Built into Relay?", "Get credentials", 1)
p.chain("Get credentials", "Get media", "Report preparing")

routes = [
    ("sandbox", "={{ $('Get credentials').item.json.sandbox === true }}"),
    ("instagram", "={{ $('Target').item.json.platform === 'instagram' }}"),
    ("facebook", "={{ $('Target').item.json.platform === 'facebook' }}"),
    ("webhook", "={{ $('Target').item.json.platform === 'webhook' }}"),
    ("manual", "={{ $('Target').item.json.platform === 'manual' }}"),
]
p.node("Route by platform", "n8n-nodes-base.switch", {
    "rules": {"values": [{"conditions": {"options": {"caseSensitive": True, "typeValidation": "loose"}, "combinator": "and",
                                         "conditions": [{"leftValue": expr, "rightValue": True, "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
                          "renameOutput": True, "outputKey": key} for key, expr in routes]},
    "options": {"fallbackOutput": "extra", "renameFallbackOutput": "not built yet"}}, 3.2, [960, 600])
p.link("Report preparing", "Route by platform")

# Sandbox: no platform call, just report success so staging behaves end to end.
report(p, "Sandbox published", '"published"', pos=[1200, 120],
       extra=', platformPostId: "sandbox_" + $execution.id, permalink: "https://example.com/sandbox/" + $execution.id')
p.link("Route by platform", "Sandbox published", 0)

# Instagram: container → poll until FINISHED → media_publish → permalink.
code(p, "IG container params", r"""
const t = $('Target').item.json;
const media = $('Get media').item.json.items;
const first = media[0];
if (!first) throw new Error('NO_MEDIA');
const q = { caption: t.caption };
if (t.postType === 'reel') { q.media_type = 'REELS'; q.video_url = first.url; q.share_to_feed = String(t.options.shareToFeed ?? true); if (t.options.audioName) q.audio_name = t.options.audioName; }
else if (t.postType === 'story') { q.media_type = 'STORIES'; first.kind === 'video' ? q.video_url = first.url : q.image_url = first.url; }
else if (first.kind === 'video') { q.media_type = 'REELS'; q.video_url = first.url; q.share_to_feed = 'true'; }
else { q.image_url = first.url; }
return [{ json: { igUserId: t.account.externalId, resumeContainer: t.resume?.platformContainerId || null, query: q } }];
""", pos=[1200, 300])
p.link("Route by platform", "IG container params", 1)
http(p, "IG create container", "POST", GRAPH + "/{{ $json.igUserId }}/media", headers={"parameters": []},
     query={"access_token": "={{ $('Get credentials').item.json.accessToken }}"}, pos=[1440, 300],
     body="={{ JSON.stringify($json.query) }}")
report(p, "Report processing", '"processing"', pos=[1680, 300], extra=", platformContainerId: $('IG create container').item.json.id")
p.node("Wait 15s", "n8n-nodes-base.wait", {"amount": 15}, 1.1, [1920, 300], webhookId=str(uuid.uuid4()))
http(p, "IG container status", "GET", GRAPH + "/{{ $('IG create container').item.json.id }}", headers={"parameters": []},
     query={"fields": "status_code,status", "access_token": "={{ $('Get credentials').item.json.accessToken }}"}, pos=[2160, 300])
p.node("Finished?", "n8n-nodes-base.switch", {
    "rules": {"values": [
        {"conditions": {"options": {"caseSensitive": True, "typeValidation": "strict"}, "combinator": "and",
                        "conditions": [{"leftValue": "={{ $json.status_code }}", "rightValue": v, "operator": {"type": "string", "operation": "equals"}}]},
         "renameOutput": True, "outputKey": k} for k, v in [("finished", "FINISHED"), ("in progress", "IN_PROGRESS"), ("error", "ERROR")]]},
    "options": {"fallbackOutput": 1}}, 3.2, [2400, 300])
http(p, "IG publish", "POST", GRAPH + "/{{ $('IG container params').item.json.igUserId }}/media_publish", headers={"parameters": []},
     query={"creation_id": "={{ $('IG create container').item.json.id }}", "access_token": "={{ $('Get credentials').item.json.accessToken }}"}, pos=[2640, 200], retry=False)
http(p, "IG permalink", "GET", GRAPH + "/{{ $json.id }}", headers={"parameters": []},
     query={"fields": "permalink", "access_token": "={{ $('Get credentials').item.json.accessToken }}"}, pos=[2880, 200])
report(p, "IG report published", '"published"', pos=[3120, 200], extra=", platformPostId: $json.id, permalink: $json.permalink")
report(p, "IG report rejected", '"failed"', pos=[2640, 420], extra=', errorCode: "IG_CONTAINER_ERROR", message: $json.status, retryable: false')
p.chain("IG container params", "IG create container", "Report processing", "Wait 15s", "IG container status", "Finished?")
p.link("Finished?", "IG publish", 0)
p.link("Finished?", "Wait 15s", 1)
p.link("Finished?", "IG report rejected", 2)
p.chain("IG publish", "IG permalink", "IG report published")

# Facebook Page: photo, video (file_url) or text/link post.
code(p, "FB request", r"""
const t = $('Target').item.json;
const first = $('Get media').item.json.items[0];
const page = t.account.externalId;
if (t.postType === 'text' || !first) return [{ json: { url: `https://graph.facebook.com/v21.0/${page}/feed`, body: { message: t.caption, link: t.options.link || undefined } } }];
if (first.kind === 'video') return [{ json: { url: `https://graph-video.facebook.com/v21.0/${page}/videos`, body: { file_url: first.url, description: t.caption } } }];
return [{ json: { url: `https://graph.facebook.com/v21.0/${page}/photos`, body: { url: first.url, caption: t.caption } } }];
""", pos=[1200, 620])
p.link("Route by platform", "FB request", 2)
http(p, "FB publish", "POST", "={{ $json.url }}", headers={"parameters": []},
     query={"access_token": "={{ $('Get credentials').item.json.accessToken }}"}, body="={{ JSON.stringify($json.body) }}", pos=[1440, 620], retry=False)
report(p, "FB report published", '"published"', pos=[1680, 620],
       extra=', platformPostId: $json.post_id || $json.id, permalink: "https://facebook.com/" + ($json.post_id || $json.id)')
p.chain("FB request", "FB publish", "FB report published")

# Webhook connector: signed JSON payload.
code(p, "Webhook payload", r"""
const crypto = require('crypto');
const t = $('Target').item.json;
const c = $('Get credentials').item.json;
const body = JSON.stringify({ event: 'post.publish', targetId: t.id, postId: t.postId, caption: t.caption, options: t.options, media: $('Get media').item.json.items, sentAt: new Date().toISOString() });
const sig = crypto.createHmac('sha256', c.signingSecret).update(body).digest('hex');
const headers = { 'content-type': 'application/json', 'x-relay-signature': sig };
if (c.authHeader) headers['authorization'] = c.authHeader;
return [{ json: { url: c.endpointUrl, body, headers } }];
""", pos=[1200, 860])
p.link("Route by platform", "Webhook payload", 3)
p.node("Send webhook", "n8n-nodes-base.httpRequest", {
    "method": "POST", "url": "={{ $json.url }}", "sendHeaders": True, "specifyHeaders": "json", "jsonHeaders": "={{ JSON.stringify($json.headers) }}",
    "sendBody": True, "contentType": "raw", "rawContentType": "application/json", "body": "={{ $json.body }}",
    "options": {"timeout": 15000, "redirect": {"redirect": {"followRedirects": False}}}}, 4.2, [1440, 860], retryOnFail=True, maxTries=3, waitBetweenTries=5000)
report(p, "Webhook report published", '"published"', pos=[1680, 860], extra=', platformPostId: "webhook_" + $execution.id')
p.chain("Webhook payload", "Send webhook", "Webhook report published")

# Manual: tell the app it's due; the app notifies and the user marks it done.
report(p, "Manual due", '"needs_action"', pos=[1200, 1080], extra=', errorCode: "MANUAL_POST_DUE", message: "Time to post this one yourself, then mark it done."')
p.link("Route by platform", "Manual due", 4)

# Fallback: connectors still to build (YouTube resumable upload, TikTok, LinkedIn, X, Threads, Pinterest).
# Community platforms never reach this switch; "Built into Relay?" sends them to /send.
report(p, "Connector not built", '"failed"', pos=[1200, 1280],
       extra=', errorCode: "CONNECTOR_NOT_BUILT", message: "The " + $(\'Target\').item.json.platform + " workflow is not built in n8n yet.", retryable: false')
p.link("Route by platform", "Connector not built", 5)
p.save("03-publish-target.json")

# ------------------------------------------------------------------ Error reporter
e = WF("Relay · Error reporter")
e.node("On workflow error", "n8n-nodes-base.errorTrigger", {}, 1, [0, 300])
e.x = 0
code(e, "Find target", r"""
// Pull the target id out of the failed execution's first node data when possible.
const ex = $json.execution || {};
const data = ex.data?.resultData?.runData?.Target?.[0]?.data?.main?.[0]?.[0]?.json;
const msg = ex.error?.message || 'Workflow failed';
const http = ex.error?.httpCode ? Number(ex.error.httpCode) : undefined;
const auth = http === 401 || http === 403 || /OAuth|access token|permission/i.test(msg);
const retryable = !auth && (!http || http === 429 || http >= 500);
return data?.id ? [{ json: { id: data.id, event: { step: 'failed', executionId: String(ex.id || ''), errorCode: http ? 'HTTP_' + http : 'N8N_ERROR', httpStatus: http, message: msg.slice(0, 500), retryable, authError: auth } } }] : [];
""")
http(e, "Report failure", "POST", APP + "/api/internal/targets/{{ $json.id }}/events", "={{ JSON.stringify($json.event) }}")
e.chain("On workflow error", "Find target", "Report failure")
e.save("04-error-reporter.json")

# ------------------------------------------------------------------ Maintenance
m = WF("Relay · Token refresh", error_workflow="Relay · Error reporter")
m.node("Daily 03:00", "n8n-nodes-base.scheduleTrigger", {"rule": {"interval": [{"field": "cronExpression", "expression": "0 3 * * *"}]}}, 1.2, [0, 300])
m.x = 0
http(m, "Refresh expiring tokens", "POST", APP + "/api/internal/maintenance/refresh-tokens", "={{ JSON.stringify({}) }}")
m.chain("Daily 03:00", "Refresh expiring tokens")
m.save("05-token-refresh.json")

print("wrote", sorted(os.listdir(OUT)))
