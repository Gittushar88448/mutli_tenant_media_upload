import "server-only";
import { assertSafeWebhookUrl } from "@/lib/ssrf";

/**
 * Relay's own connectors for community and messaging platforms (Telegram, WhatsApp Cloud
 * API, Discord, Slack, Bluesky, Mastodon, Reddit). Their APIs are single requests with a
 * bot token or webhook, so they run inside the app; n8n triggers them through
 * POST /api/internal/targets/:id/send. Every function throws ConnectorError, which the
 * caller turns into a publishing event (retryable, needs a reconnect, or failed).
 */

export class ConnectorError extends Error {
  constructor(
    public code: string,
    message: string,
    public opts: { httpStatus?: number; retryable?: boolean; authError?: boolean; excerpt?: string } = {}
  ) {
    super(message);
  }
}

export type OutFile = { kind: "image" | "video"; mime: string; filename: string; data: () => Promise<Buffer>; path: string; sizeBytes?: number };

export type SendInput = {
  targetId: string;
  platform: string;
  postType: string;
  text: string;
  headline?: string;
  options: Record<string, unknown>;
  poll?: { question: string; options: string[]; allowMultiple?: boolean; durationHours?: number } | null;
  account: { externalId: string; handle: string; accountType?: string | null; profileUrl?: string | null; connector: Record<string, unknown> };
  secret: Record<string, string>;
  files: OutFile[];
};

export type SendResult = { platformPostId: string; permalink?: string; messageIds?: string[]; note?: string };
export type EditInput = { platform: string; postType: string; text: string; headline?: string; platformPostId: string; messageIds: string[]; account: SendInput["account"]; secret: Record<string, string> };

const T = 30_000;

function classify(status: number, code: string, message: string, excerpt?: string): never {
  throw new ConnectorError(code, message, {
    httpStatus: status,
    retryable: status === 429 || status >= 500,
    authError: status === 401,
    excerpt,
  });
}

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text) as Record<string, unknown> & Record<string, never>, text };
  } catch {
    return { json: {} as Record<string, never>, text };
  }
}

function blob(buf: Buffer, mime: string) {
  return new Blob([new Uint8Array(buf)], { type: mime });
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ------------------------------------------------------------------ Telegram */

async function tg(token: string, method: string, body: Record<string, unknown> | FormData) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(body instanceof FormData ? 300_000 : T),
  });
  const { json, text } = await readJson(res);
  if (!json.ok) {
    const desc = String(json.description ?? `Telegram ${method} failed`);
    const status = Number(json.error_code ?? res.status);
    // A bot that was removed from the chat, or a revoked token, needs the owner to fix it.
    if (status === 401 || (status === 403 && /kicked|not a member|blocked|rights/i.test(desc))) throw new ConnectorError("TELEGRAM_ACCESS", desc, { httpStatus: status, authError: true, excerpt: text });
    classify(status, status === 429 ? "RATE_LIMITED" : "TELEGRAM_ERROR", desc, text);
  }
  return json.result as Record<string, unknown> & { message_id: number };
}

export async function telegramVerify(botToken: string, chatId: string) {
  const me = await tg(botToken, "getMe", {});
  const chat = await tg(botToken, "getChat", { chat_id: chatId });
  const member = (await tg(botToken, "getChatMember", { chat_id: chat.id, user_id: me.id })) as { status?: string; can_post_messages?: boolean };
  const isChannel = chat.type === "channel";
  if (isChannel && member.status !== "administrator" && member.status !== "creator") throw new ConnectorError("TELEGRAM_NOT_ADMIN", `Make @${me.username} an admin of the channel with permission to post, then try again.`);
  if (isChannel && member.status === "administrator" && member.can_post_messages === false) throw new ConnectorError("TELEGRAM_NOT_ADMIN", `@${me.username} is an admin but can't post messages. Turn on "Post messages" for it.`);
  const count = await tg(botToken, "getChatMemberCount", { chat_id: chat.id }).catch(() => null);
  return {
    externalId: String(chat.id),
    handle: chat.username ? `@${chat.username}` : String(chat.title ?? chatId),
    displayName: String(chat.title ?? chat.username ?? chatId),
    accountType: String(chat.type),
    profileUrl: chat.username ? `https://t.me/${chat.username}` : undefined,
    audienceSize: typeof count === "number" ? count : undefined,
    botName: `@${me.username}`,
  };
}

function tgLink(account: SendInput["account"], messageId: number) {
  if (account.profileUrl?.startsWith("https://t.me/")) return `${account.profileUrl}/${messageId}`;
  const id = account.externalId;
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${messageId}` : undefined;
}

function tgText(text: string, headline?: string) {
  return (headline ? `<b>${escHtml(headline)}</b>\n\n` : "") + escHtml(text);
}

async function telegramSend(i: SendInput): Promise<SendResult> {
  const token = i.secret.botToken!;
  const chat = i.account.externalId;
  const common = { disable_notification: Boolean(i.options.silent), protect_content: Boolean(i.options.protect) };
  const ids: number[] = [];
  const text = tgText(i.text, i.headline);

  if (i.postType === "poll") {
    if (!i.poll) throw new ConnectorError("POLL_MISSING", "This poll has no question.");
    if (i.text.trim() || i.headline) ids.push((await tg(token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", ...common })).message_id);
    const r = await tg(token, "sendPoll", {
      chat_id: chat,
      question: i.poll.question.slice(0, 300),
      options: i.poll.options.map((o) => ({ text: o.slice(0, 100) })),
      is_anonymous: true,
      allows_multiple_answers: Boolean(i.poll.allowMultiple),
      ...common,
    });
    ids.push(r.message_id);
  } else if (i.postType === "message" || i.files.length === 0) {
    const r = await tg(token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: Boolean(i.options.noPreview) }, ...common });
    ids.push(r.message_id);
  } else if (i.files.length === 1) {
    const f = i.files[0]!;
    const form = new FormData();
    form.set("chat_id", chat);
    form.set("caption", text);
    form.set("parse_mode", "HTML");
    form.set("disable_notification", String(common.disable_notification));
    form.set("protect_content", String(common.protect_content));
    const field = f.kind === "video" ? "video" : "photo";
    if (f.kind === "video") form.set("supports_streaming", "true");
    form.set(field, blob(await f.data(), f.mime), f.filename);
    const r = await tg(token, f.kind === "video" ? "sendVideo" : "sendPhoto", form);
    ids.push(r.message_id);
  } else {
    const form = new FormData();
    form.set("chat_id", chat);
    form.set("disable_notification", String(common.disable_notification));
    form.set("protect_content", String(common.protect_content));
    const media = [];
    for (const [n, f] of i.files.slice(0, 10).entries()) {
      form.set(`f${n}`, blob(await f.data(), f.mime), f.filename);
      media.push({ type: f.kind === "video" ? "video" : "photo", media: `attach://f${n}`, ...(n === 0 ? { caption: text, parse_mode: "HTML" } : {}) });
    }
    form.set("media", JSON.stringify(media));
    const r = (await tg(token, "sendMediaGroup", form)) as unknown as { message_id: number }[];
    ids.push(...r.map((m) => m.message_id));
  }

  if (i.options.pin && ids.length) await tg(token, "pinChatMessage", { chat_id: chat, message_id: ids[ids.length - 1], disable_notification: true }).catch(() => null);
  const main = ids[0]!;
  return { platformPostId: String(main), messageIds: ids.map(String), permalink: tgLink(i.account, main) };
}

async function telegramEdit(e: EditInput) {
  const token = e.secret.botToken!;
  const id = Number(e.platformPostId);
  const text = tgText(e.text, e.headline);
  if (e.postType === "poll") {
    if (e.messageIds.length < 2) throw new ConnectorError("EDIT_UNSUPPORTED", "Telegram polls can't be edited once sent.");
    await tg(token, "editMessageText", { chat_id: e.account.externalId, message_id: id, text, parse_mode: "HTML" });
  } else if (e.postType === "message") await tg(token, "editMessageText", { chat_id: e.account.externalId, message_id: id, text, parse_mode: "HTML" });
  else await tg(token, "editMessageCaption", { chat_id: e.account.externalId, message_id: id, caption: text, parse_mode: "HTML" });
}

/* ------------------------------------------------------------------ Discord */

const DISCORD_HOOK = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)\/?$/;

export async function discordVerify(webhookUrl: string) {
  const m = webhookUrl.trim().match(DISCORD_HOOK);
  if (!m) throw new ConnectorError("BAD_WEBHOOK", "That isn't a Discord channel webhook URL.");
  const res = await fetch(webhookUrl, { signal: AbortSignal.timeout(T) });
  const { json, text } = await readJson(res);
  if (!res.ok) classify(res.status, "DISCORD_ERROR", res.status === 404 || res.status === 401 ? "This webhook was deleted or the URL is wrong." : String(json.message ?? "Discord rejected the webhook"), text);
  return { externalId: String(json.id), name: String(json.name ?? "Discord webhook"), channelId: String(json.channel_id ?? ""), guildId: String(json.guild_id ?? "") };
}

async function discordCall(url: string, method: string, body: Record<string, unknown> | FormData) {
  const res = await fetch(url, {
    method,
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(body instanceof FormData ? 300_000 : T),
  });
  const { json, text } = await readJson(res);
  if (!res.ok) {
    if (res.status === 404 || res.status === 401) throw new ConnectorError("DISCORD_WEBHOOK_GONE", "The Discord webhook was deleted. Reconnect the channel with a new webhook.", { httpStatus: res.status, authError: true, excerpt: text });
    classify(res.status, res.status === 429 ? "RATE_LIMITED" : "DISCORD_ERROR", String(json.message ?? `Discord returned ${res.status}`), text);
  }
  return json as Record<string, string>;
}

const mdText = (text: string, headline?: string, bold = "**") => (headline ? `${bold}${headline}${bold}\n\n` : "") + text;

async function discordSend(i: SendInput): Promise<SendResult> {
  const hook = i.secret.webhookUrl!;
  const payload: Record<string, unknown> = { content: mdText(i.text, i.headline).slice(0, 2000) || undefined };
  if (i.options.username) payload.username = String(i.options.username);
  if (i.options.threadName) payload.thread_name = String(i.options.threadName);
  if (i.options.suppressEmbeds) payload.flags = 4;
  if (i.postType === "poll") {
    if (!i.poll) throw new ConnectorError("POLL_MISSING", "This poll has no question.");
    payload.poll = {
      question: { text: i.poll.question.slice(0, 300) },
      answers: i.poll.options.slice(0, 10).map((o) => ({ poll_media: { text: o.slice(0, 55) } })),
      duration: Math.min(Math.max(i.poll.durationHours ?? 24, 1), 768),
      allow_multiselect: Boolean(i.poll.allowMultiple),
    };
  }
  let body: Record<string, unknown> | FormData = payload;
  if (i.postType === "media" && i.files.length) {
    const form = new FormData();
    for (const [n, f] of i.files.slice(0, 10).entries()) form.set(`files[${n}]`, blob(await f.data(), f.mime), f.filename);
    form.set("payload_json", JSON.stringify(payload));
    body = form;
  }
  const msg = await discordCall(`${hook}?wait=true`, "POST", body);
  const guild = String(i.account.connector.guildId ?? "");
  return {
    platformPostId: msg.id!,
    messageIds: [msg.channel_id!],
    permalink: guild ? `https://discord.com/channels/${guild}/${msg.channel_id}/${msg.id}` : undefined,
  };
}

async function discordEdit(e: EditInput) {
  const hook = e.secret.webhookUrl!;
  const thread = e.messageIds[0] && e.messageIds[0] !== e.account.connector.channelId ? `?thread_id=${e.messageIds[0]}` : "";
  await discordCall(`${hook}/messages/${e.platformPostId}${thread}`, "PATCH", { content: mdText(e.text, e.headline).slice(0, 2000) });
}

/* ------------------------------------------------------------------ Slack */

async function slack(token: string, method: string, body: Record<string, unknown>, form = false) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
    body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body),
    signal: AbortSignal.timeout(T),
  });
  const { json, text } = await readJson(res);
  if (!json.ok) {
    const err = String(json.error ?? `HTTP ${res.status}`);
    if (["not_authed", "invalid_auth", "token_revoked", "account_inactive", "token_expired"].includes(err)) throw new ConnectorError("SLACK_AUTH", `Slack: ${err}. Reconnect with a fresh bot token.`, { httpStatus: 401, authError: true, excerpt: text });
    if (err === "not_in_channel" || err === "channel_not_found") throw new ConnectorError("SLACK_CHANNEL", "Invite the Relay app to the channel (/invite @yourapp), then retry.", { excerpt: text });
    classify(res.status === 200 && err === "ratelimited" ? 429 : res.status, err === "ratelimited" ? "RATE_LIMITED" : "SLACK_ERROR", `Slack: ${err}`, text);
  }
  return json as Record<string, unknown>;
}

export async function slackVerify(botToken: string, channelId: string) {
  const auth = await slack(botToken, "auth.test", {});
  const info = (await slack(botToken, "conversations.info", { channel: channelId, include_num_members: "true" }, true)) as { channel?: { id: string; name: string; num_members?: number; is_private?: boolean } };
  return {
    team: String(auth.team ?? ""),
    url: String(auth.url ?? ""),
    channel: info.channel!,
  };
}

async function slackSend(i: SendInput): Promise<SendResult> {
  const token = i.secret.botToken!;
  const channel = String(i.account.connector.channelId ?? i.account.externalId);
  const text = mdText(i.text, i.headline, "*");
  if (i.postType === "media" && i.files.length) {
    const files = [];
    for (const f of i.files.slice(0, 10)) {
      const data = await f.data();
      const up = (await slack(token, "files.getUploadURLExternal", { filename: f.filename, length: String(data.length) }, true)) as { upload_url: string; file_id: string };
      const put = await fetch(up.upload_url, { method: "POST", body: blob(data, f.mime), signal: AbortSignal.timeout(300_000) });
      if (!put.ok) classify(put.status, "SLACK_UPLOAD", `Slack upload failed (${put.status})`);
      files.push({ id: up.file_id, title: f.filename });
    }
    const done = (await slack(token, "files.completeUploadExternal", { files, channel_id: channel, initial_comment: text })) as { files?: { id: string; permalink?: string }[] };
    const first = done.files?.[0];
    return { platformPostId: first?.id ?? files[0]!.id, permalink: first?.permalink, note: "Slack messages with files can't be edited from Relay." };
  }
  const r = (await slack(token, "chat.postMessage", { channel, text, unfurl_links: true })) as { ts: string; channel: string };
  const link = (await slack(token, "chat.getPermalink", { channel: r.channel, message_ts: r.ts }, true).catch(() => null)) as { permalink?: string } | null;
  return { platformPostId: r.ts, messageIds: [r.channel], permalink: link?.permalink };
}

async function slackEdit(e: EditInput) {
  if (e.postType !== "message") throw new ConnectorError("EDIT_UNSUPPORTED", "Slack messages with files can't be edited from Relay.");
  await slack(e.secret.botToken!, "chat.update", { channel: e.messageIds[0] ?? e.account.connector.channelId, ts: e.platformPostId, text: mdText(e.text, e.headline, "*") });
}

/* ------------------------------------------------------------------ WhatsApp Cloud API */

const GRAPH = "https://graph.facebook.com/v21.0";

async function wa(token: string, path: string, body: Record<string, unknown> | FormData, method = "POST") {
  const res = await fetch(`${GRAPH}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body instanceof FormData || method === "GET" ? {} : { "content-type": "application/json" }) },
    body: method === "GET" ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(body instanceof FormData ? 300_000 : T),
  });
  const { json, text } = await readJson(res);
  if (!res.ok) {
    const err = (json.error ?? {}) as { code?: number; message?: string; error_data?: { details?: string } };
    const msg = err.error_data?.details ?? err.message ?? `WhatsApp returned ${res.status}`;
    if (err.code === 190 || res.status === 401) throw new ConnectorError("WHATSAPP_TOKEN", "The WhatsApp access token expired or was revoked.", { httpStatus: res.status, authError: true, excerpt: text });
    if (err.code === 131047) throw new ConnectorError("WHATSAPP_WINDOW", "This contact hasn't messaged you in 24 hours, so WhatsApp only accepts an approved template. Set one on this channel.", { httpStatus: res.status, excerpt: text });
    const rate = [4, 80007, 130429, 131048, 131056].includes(Number(err.code));
    throw new ConnectorError(rate ? "RATE_LIMITED" : "WHATSAPP_ERROR", msg, { httpStatus: res.status, retryable: rate || res.status >= 500, excerpt: text });
  }
  return json as Record<string, unknown>;
}

export async function whatsappVerify(phoneNumberId: string, token: string) {
  const r = await wa(token, `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, {}, "GET");
  return { display: String(r.display_phone_number ?? phoneNumberId), name: String(r.verified_name ?? "") };
}

/** "+14155550123" or "14155550123" is a contact; anything else is a group id. */
export function waRecipient(r: string) {
  const v = r.trim();
  return /^\+?\d{6,15}$/.test(v) ? { recipient_type: "individual", to: v.replace(/^\+/, "") } : { recipient_type: "group", to: v };
}

async function whatsappSend(i: SendInput): Promise<SendResult> {
  const token = i.secret.accessToken!;
  const phone = String(i.account.connector.phoneNumberId);
  const recipients = ((i.account.connector.recipients as string[]) ?? []).filter(Boolean);
  if (!recipients.length) throw new ConnectorError("NO_RECIPIENTS", "Add at least one group or contact to this WhatsApp channel.");
  const text = mdText(i.text, i.headline, "*");

  let message: Record<string, unknown>;
  if (i.options.templateName) {
    message = {
      type: "template",
      template: {
        name: String(i.options.templateName),
        language: { code: String(i.options.templateLanguage || "en_US") },
        components: text.trim() ? [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 1024) }] }] : [],
      },
    };
  } else if (i.postType === "media" && i.files[0]) {
    const f = i.files[0];
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", f.mime);
    form.set("file", blob(await f.data(), f.mime), f.filename);
    const up = await wa(token, `${phone}/media`, form);
    const kind = f.kind === "video" ? "video" : "image";
    message = { type: kind, [kind]: { id: up.id, caption: text.slice(0, 1024) } };
  } else {
    message = { type: "text", text: { body: text.slice(0, 4096), preview_url: true } };
  }

  const ids: string[] = [];
  const failures: string[] = [];
  let firstError: ConnectorError | null = null;
  for (const r of recipients) {
    try {
      const res = (await wa(token, `${phone}/messages`, { messaging_product: "whatsapp", ...waRecipient(r), ...message })) as { messages?: { id: string }[] };
      ids.push(res.messages?.[0]?.id ?? "");
    } catch (e) {
      if (e instanceof ConnectorError && e.opts.authError) throw e;
      firstError ??= e as ConnectorError;
      failures.push(r);
    }
  }
  if (!ids.length) throw firstError ?? new ConnectorError("WHATSAPP_ERROR", "No recipient accepted the message.");
  return { platformPostId: ids[0]!, messageIds: ids, note: failures.length ? `Sent to ${ids.length} of ${recipients.length}. Failed: ${failures.join(", ")}` : `Sent to ${ids.length} recipient${ids.length > 1 ? "s" : ""}` };
}

/* ------------------------------------------------------------------ Bluesky */

async function bsky(service: string, method: string, body: unknown, token?: string, contentType = "application/json") {
  const res = await fetch(`${service}/xrpc/${method}`, {
    method: "POST",
    headers: { "content-type": contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: contentType === "application/json" ? JSON.stringify(body) : (body as BodyInit),
    signal: AbortSignal.timeout(60_000),
  });
  const { json, text } = await readJson(res);
  if (!res.ok) {
    if (res.status === 401 || json.error === "AuthenticationRequired" || json.error === "AccountTakedown") throw new ConnectorError("BLUESKY_AUTH", String(json.message ?? "Bluesky rejected the app password."), { httpStatus: res.status, authError: true, excerpt: text });
    classify(res.status, res.status === 429 ? "RATE_LIMITED" : "BLUESKY_ERROR", String(json.message ?? json.error ?? `Bluesky returned ${res.status}`), text);
  }
  return json as Record<string, unknown>;
}

export async function bskySession(service: string, identifier: string, password: string) {
  const s = await bsky(service, "com.atproto.server.createSession", { identifier: identifier.replace(/^@/, ""), password });
  return { did: String(s.did), handle: String(s.handle), accessJwt: String(s.accessJwt) };
}

/** Link and hashtag facets, with byte offsets as the AT Protocol requires. */
export function bskyFacets(text: string) {
  const enc = new TextEncoder();
  const facets: unknown[] = [];
  const at = (idx: number) => enc.encode(text.slice(0, idx)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const start = at(m.index!);
    facets.push({ index: { byteStart: start, byteEnd: start + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const begin = m.index! + m[1]!.length;
    const start = at(begin);
    facets.push({ index: { byteStart: start, byteEnd: start + enc.encode(`#${m[2]}`).length }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }] });
  }
  return facets;
}

async function blueskySend(i: SendInput): Promise<SendResult> {
  const service = String(i.account.connector.instanceUrl || "https://bsky.social").replace(/\/$/, "");
  const s = await bskySession(service, i.secret.identifier ?? i.account.handle, i.secret.appPassword!);
  const text = (i.headline ? `${i.headline}\n\n` : "") + i.text;
  const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() };
  const facets = bskyFacets(text);
  if (facets.length) record.facets = facets;
  if (i.postType === "media" && i.files.length) {
    const { shrinkImage } = await import("@/lib/media/render");
    const images = [];
    for (const f of i.files.filter((x) => x.kind === "image").slice(0, 4)) {
      let data = await f.data();
      let mime = f.mime;
      if (data.length > 950_000) {
        const small = await shrinkImage(f.path, 950_000);
        if (!small) throw new ConnectorError("IMAGE_TOO_LARGE", `${f.filename} is too large for Bluesky even after compressing.`);
        data = small;
        mime = "image/jpeg";
      }
      const up = (await bsky(service, "com.atproto.repo.uploadBlob", blob(data, mime), s.accessJwt, mime)) as { blob: unknown };
      images.push({ alt: "", image: up.blob });
    }
    record.embed = { $type: "app.bsky.embed.images", images };
  }
  const r = (await bsky(service, "com.atproto.repo.createRecord", { repo: s.did, collection: "app.bsky.feed.post", record }, s.accessJwt)) as { uri: string };
  const rkey = r.uri.split("/").pop();
  return { platformPostId: r.uri, permalink: `https://bsky.app/profile/${s.handle}/post/${rkey}` };
}

/* ------------------------------------------------------------------ Mastodon */

async function masto(base: string, token: string, path: string, init: { method?: string; body?: Record<string, unknown> | FormData; idempotencyKey?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(init.idempotencyKey ? { "idempotency-key": init.idempotencyKey } : {}),
    },
    body: init.body instanceof FormData ? init.body : init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.body instanceof FormData ? 300_000 : T),
  });
  const { json, text } = await readJson(res);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new ConnectorError("MASTODON_AUTH", String(json.error ?? "Mastodon rejected the access token."), { httpStatus: res.status, authError: true, excerpt: text });
    classify(res.status, res.status === 429 ? "RATE_LIMITED" : "MASTODON_ERROR", String(json.error ?? `Mastodon returned ${res.status}`), text);
  }
  return { status: res.status, json: json as Record<string, unknown> };
}

export async function mastodonVerify(instanceUrl: string, token: string) {
  const base = (await assertSafeWebhookUrl(instanceUrl)).origin;
  const { json } = await masto(base, token, "/api/v1/accounts/verify_credentials");
  return { base, id: String(json.id), acct: String(json.acct), url: String(json.url ?? ""), followers: Number(json.followers_count ?? 0), name: String(json.display_name || json.acct) };
}

async function mastodonSend(i: SendInput): Promise<SendResult> {
  const base = String(i.account.connector.instanceUrl).replace(/\/$/, "");
  const token = i.secret.accessToken!;
  const mediaIds: string[] = [];
  if (i.postType === "media") {
    for (const f of i.files.slice(0, 4)) {
      const form = new FormData();
      form.set("file", blob(await f.data(), f.mime), f.filename);
      const up = await masto(base, token, "/api/v2/media", { method: "POST", body: form });
      const id = String(up.json.id);
      // Video is processed asynchronously (202): wait until it has a URL before posting.
      if (up.status === 202 || !up.json.url) {
        for (let n = 0; n < 60; n++) {
          await new Promise((r) => setTimeout(r, 2000));
          const st = await masto(base, token, `/api/v1/media/${id}`);
          if (st.status === 200 && st.json.url) break;
          if (n === 59) throw new ConnectorError("MEDIA_PROCESSING", "Mastodon is still processing the video.", { retryable: true });
        }
      }
      mediaIds.push(id);
    }
  }
  const body: Record<string, unknown> = {
    status: (i.headline ? `${i.headline}\n\n` : "") + i.text,
    visibility: String(i.options.visibility || "public"),
  };
  if (i.options.spoiler) body.spoiler_text = String(i.options.spoiler);
  if (mediaIds.length) body.media_ids = mediaIds;
  if (i.postType === "poll") {
    if (!i.poll) throw new ConnectorError("POLL_MISSING", "This poll has no question.");
    body.status = [body.status, i.poll.question].filter((x) => String(x).trim()).join("\n\n");
    body.poll = { options: i.poll.options.slice(0, 4), expires_in: Math.max(300, (i.poll.durationHours ?? 24) * 3600), multiple: Boolean(i.poll.allowMultiple) };
  }
  // The idempotency key makes a retry after a timeout return the same status instead of posting twice.
  const r = await masto(base, token, "/api/v1/statuses", { method: "POST", body, idempotencyKey: `relay-${i.targetId}` });
  return { platformPostId: String(r.json.id), permalink: String(r.json.url ?? "") || undefined };
}

async function mastodonEdit(e: EditInput) {
  if (e.postType === "poll") throw new ConnectorError("EDIT_UNSUPPORTED", "Editing a Mastodon poll resets its votes, so Relay doesn't do it.");
  const base = String(e.account.connector.instanceUrl).replace(/\/$/, "");
  const current = await masto(base, e.secret.accessToken!, `/api/v1/statuses/${e.platformPostId}`);
  const media = ((current.json.media_attachments as { id: string }[]) ?? []).map((m) => m.id);
  await masto(base, e.secret.accessToken!, `/api/v1/statuses/${e.platformPostId}`, {
    method: "PUT",
    body: { status: (e.headline ? `${e.headline}\n\n` : "") + e.text, media_ids: media, spoiler_text: current.json.spoiler_text ?? "" },
  });
}

/* ------------------------------------------------------------------ Reddit */

const REDDIT_UA = "web:relay-scheduler:1.0 (multi-channel publisher)";

async function reddit(token: string, path: string, form: Record<string, string>) {
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "user-agent": REDDIT_UA, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_type: "json", ...form }),
    signal: AbortSignal.timeout(T),
  });
  const { json, text } = await readJson(res);
  if (!res.ok) {
    if (res.status === 401) throw new ConnectorError("REDDIT_AUTH", "Reddit sign-in expired. Reconnect the account.", { httpStatus: 401, authError: true, excerpt: text });
    classify(res.status, res.status === 429 ? "RATE_LIMITED" : "REDDIT_ERROR", `Reddit returned ${res.status}`, text);
  }
  const body = (json.json ?? {}) as { errors?: string[][]; data?: Record<string, string> };
  if (body.errors?.length) {
    const [code, message] = body.errors[0]!;
    throw new ConnectorError(code === "RATELIMIT" ? "RATE_LIMITED" : `REDDIT_${code}`, message ?? code!, { retryable: code === "RATELIMIT", excerpt: text });
  }
  return body.data ?? {};
}

async function redditSend(i: SendInput): Promise<SendResult> {
  const sr = String(i.options.subreddit ?? "").replace(/^\/?r\//i, "").trim();
  if (!sr) throw new ConnectorError("NO_SUBREDDIT", "Pick a subreddit.");
  const link = i.postType === "link";
  const form: Record<string, string> = {
    sr,
    kind: link ? "link" : "self",
    title: String(i.options.title ?? i.headline ?? "").slice(0, 300),
    resubmit: "true",
    sendreplies: "true",
  };
  if (link) form.url = String(i.options.url ?? "");
  else form.text = i.text;
  if (i.options.nsfw) form.nsfw = "true";
  if (i.options.spoiler) form.spoiler = "true";
  if (i.options.flairId) form.flair_id = String(i.options.flairId);
  const d = await reddit(i.secret.accessToken!, "/api/submit", form);
  return { platformPostId: d.name ?? d.id ?? "", permalink: d.url };
}

async function redditEdit(e: EditInput) {
  if (e.postType !== "text") throw new ConnectorError("EDIT_UNSUPPORTED", "Reddit only lets you edit the text of text posts.");
  await reddit(e.secret.accessToken!, "/api/editusertext", { thing_id: e.platformPostId, text: e.text });
}

/* ------------------------------------------------------------------ dispatch */

export async function sendDirect(i: SendInput): Promise<SendResult> {
  switch (i.platform) {
    case "telegram":
      return telegramSend(i);
    case "discord":
      return discordSend(i);
    case "slack":
      return slackSend(i);
    case "whatsapp":
      return whatsappSend(i);
    case "bluesky":
      return blueskySend(i);
    case "mastodon":
      return mastodonSend(i);
    case "reddit":
      return redditSend(i);
  }
  throw new ConnectorError("CONNECTOR_NOT_BUILT", `Relay has no built-in connector for ${i.platform}.`);
}

export async function editDirect(e: EditInput) {
  switch (e.platform) {
    case "telegram":
      return telegramEdit(e);
    case "discord":
      return discordEdit(e);
    case "slack":
      return slackEdit(e);
    case "mastodon":
      return mastodonEdit(e);
    case "reddit":
      return redditEdit(e);
  }
  throw new ConnectorError("EDIT_UNSUPPORTED", "This platform doesn't allow editing a message after it's sent.");
}
