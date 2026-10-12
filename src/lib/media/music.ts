import "server-only";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { FFMPEG, run } from "./render";

/**
 * The music library. Instagram, TikTok and YouTube don't let other apps search or attach
 * songs from their in-app libraries, so Relay searches Jamendo instead: around 600,000
 * tracks from independent artists under Creative Commons licences, with genre and mood tags
 * and a weekly popularity chart. Set JAMENDO_CLIENT_ID (free at devportal.jamendo.com).
 * Without it the library offers a few generated demo tracks so the flow can be tried.
 */

export type Track = {
  id: string; // "jamendo:123" or "demo:sunrise"
  title: string;
  artist: string;
  durationMs: number;
  previewUrl: string;
  image?: string;
  license: string;
  licenseUrl?: string;
  pageUrl?: string;
  tags: string[];
};

export const MUSIC_TAGS = ["pop", "electronic", "hiphop", "chillout", "acoustic", "cinematic", "rock", "lounge", "ambient", "dance"] as const;

export function musicProvider(): "jamendo" | "demo" {
  return process.env.JAMENDO_CLIENT_ID ? "jamendo" : "demo";
}

type JamendoTrack = {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  album_image?: string;
  image?: string;
  audio: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  license_ccurl?: string;
  shareurl?: string;
  musicinfo?: { tags?: { genres?: string[]; vartags?: string[] } };
};

function licenseName(url?: string) {
  const m = url?.match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  return m ? `CC ${m[1]!.toUpperCase()} ${m[2]}` : "Creative Commons";
}

function fromJamendo(t: JamendoTrack): Track {
  return {
    id: `jamendo:${t.id}`,
    title: t.name,
    artist: t.artist_name,
    durationMs: Math.round(t.duration * 1000),
    previewUrl: t.audio,
    image: t.album_image || t.image,
    license: licenseName(t.license_ccurl),
    licenseUrl: t.license_ccurl,
    pageUrl: t.shareurl,
    tags: [...(t.musicinfo?.tags?.genres ?? []), ...(t.musicinfo?.tags?.vartags ?? [])].slice(0, 4),
  };
}

async function jamendo(params: Record<string, string>) {
  const qs = new URLSearchParams({ client_id: process.env.JAMENDO_CLIENT_ID!, format: "json", audioformat: "mp32", include: "musicinfo", imagesize: "100", ...params });
  const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${qs}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { headers?: { status?: string; error_message?: string }; results?: JamendoTrack[] };
  if (!res.ok || json.headers?.status !== "success") throw new Error(`Jamendo: ${json.headers?.error_message || res.status}`);
  return json.results ?? [];
}

/** Search by words, or browse a genre/mood; with neither, this week's most popular tracks. */
export async function searchMusic({ q, tag, page = 0 }: { q?: string; tag?: string; page?: number }): Promise<{ provider: "jamendo" | "demo"; tracks: Track[] }> {
  if (musicProvider() === "demo") {
    const needle = (q ?? "").toLowerCase();
    const tracks = DEMO.filter((t) => (!needle || `${t.title} ${t.artist} ${t.tags.join(" ")}`.toLowerCase().includes(needle)) && (!tag || t.tags.includes(tag))).map(demoTrack);
    return { provider: "demo", tracks: page ? [] : tracks };
  }
  const params: Record<string, string> = { limit: "20", offset: String(page * 20), order: q ? "relevance" : "popularity_week" };
  if (q) params.search = q;
  if (tag) params.fuzzytags = tag;
  return { provider: "jamendo", tracks: (await jamendo(params)).map(fromJamendo) };
}

/** Everything needed to store a track: its bytes and the licence line kept with it. */
export async function fetchTrackAudio(id: string): Promise<{ track: Track; data: Buffer; mime: string }> {
  const [source, ref] = id.split(":");
  if (source === "demo") {
    const d = DEMO.find((t) => t.id === ref);
    if (!d) throw new Error("Unknown track");
    return { track: demoTrack(d), data: await readFile(await demoAudioPath(d.id)), mime: "audio/mpeg" };
  }
  if (source !== "jamendo" || !/^\d+$/.test(ref ?? "") || musicProvider() !== "jamendo") throw new Error("Unknown track");
  const [t] = await jamendo({ id: ref! });
  if (!t) throw new Error("That track is no longer on Jamendo.");
  const url = t.audiodownload_allowed && t.audiodownload ? t.audiodownload : t.audio;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Jamendo returned ${res.status} for the audio file`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 40 * 1024 * 1024) throw new Error("That track is too large to import.");
  return { track: fromJamendo(t), data, mime: "audio/mpeg" };
}

/* ---------- Demo tracks, generated with FFmpeg so nothing is downloaded ---------- */

type Demo = { id: string; title: string; artist: string; tags: string[]; bpm: number; notes: number[]; wave: "sine" | "soft" };

const DEMO: Demo[] = [
  { id: "sunrise", title: "Sunrise Loop", artist: "Relay Demo", tags: ["acoustic", "chillout"], bpm: 96, notes: [261.63, 329.63, 392, 523.25, 392, 329.63], wave: "soft" },
  { id: "neon", title: "Neon Drive", artist: "Relay Demo", tags: ["electronic", "dance"], bpm: 124, notes: [220, 261.63, 329.63, 440, 329.63, 261.63, 196, 246.94], wave: "sine" },
  { id: "drift", title: "Slow Drift", artist: "Relay Demo", tags: ["ambient", "lounge"], bpm: 70, notes: [174.61, 220, 261.63, 220], wave: "soft" },
  { id: "bounce", title: "Bounce", artist: "Relay Demo", tags: ["pop", "hiphop"], bpm: 110, notes: [293.66, 293.66, 349.23, 440, 392, 349.23], wave: "sine" },
  { id: "horizon", title: "Horizon", artist: "Relay Demo", tags: ["cinematic"], bpm: 80, notes: [146.83, 220, 293.66, 349.23, 329.63, 220], wave: "soft" },
];
const DEMO_SECONDS = 30;

function demoTrack(d: Demo): Track {
  return {
    id: `demo:${d.id}`,
    title: d.title,
    artist: d.artist,
    durationMs: DEMO_SECONDS * 1000,
    previewUrl: `/api/music/preview/${d.id}`,
    license: "Demo track, free to use",
    tags: d.tags,
  };
}

export async function demoAudioPath(id: string) {
  const d = DEMO.find((t) => t.id === id);
  if (!d) throw new Error("Unknown track");
  const dir = path.join(tmpdir(), "relay-music");
  const file = path.join(dir, `${d.id}.mp3`);
  if (await stat(file).catch(() => null)) return file;
  await mkdir(dir, { recursive: true });
  // An arpeggio over the notes with a soft pluck envelope on every step.
  const step = 60 / d.bpm / 2;
  const idx = `mod(floor(t/${step.toFixed(4)})\\,${d.notes.length})`;
  const freq = d.notes.reduceRight((acc, f, i) => (i === d.notes.length - 1 ? `${f}` : `if(eq(${idx}\\,${i})\\,${f}\\,${acc})`), "");
  const env = `exp(-3*mod(t\\,${step.toFixed(4)})/${step.toFixed(4)})`;
  const tone = d.wave === "soft" ? `(sin(2*PI*${freq}*t)+0.3*sin(4*PI*${freq}*t))` : `(sin(2*PI*${freq}*t)+0.15*sin(6*PI*${freq}*t))`;
  const pad = `0.12*sin(2*PI*${d.notes[0]! / 2}*t)`;
  const expr = `0.28*${env}*${tone}+${pad}`;
  const part = `${file}.${process.pid}.part.mp3`;
  await run(FFMPEG(), ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=44100:d=${DEMO_SECONDS}`, "-af", "afade=t=in:d=0.5,afade=t=out:st=28:d=2", "-ac", "2", "-b:a", "128k", part], 60_000);
  await rename(part, file);
  return file;
}
