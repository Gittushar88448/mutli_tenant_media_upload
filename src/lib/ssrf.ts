import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

const PRIVATE_V4 = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
  ["0.0.0.0", 8],
] as const;

function v4ToInt(ip: string) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
function isPrivate(ip: string) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l === "::";
  }
  const n = v4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
}

/** Webhook URLs are user input: HTTPS only, and never pointing into our own network. */
export async function assertSafeWebhookUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("Webhook URLs must use HTTPS.");
  if (url.username || url.password) throw new Error("Put credentials in the auth header, not the URL.");
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error("That host can't be resolved.");
  if (addrs.some((a) => isPrivate(a.address))) throw new Error("That URL points to a private network address.");
  return url;
}
