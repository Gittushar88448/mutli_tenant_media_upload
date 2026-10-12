/**
 * Filters for the media editor. Safe to import from client components.
 *
 * Every colour change is one function from an RGB pixel to an RGB pixel, so the browser
 * preview and the FFmpeg render use the exact same maths: the editor applies it to canvas
 * pixels, and the server bakes it into a 3D LUT (.cube) that FFmpeg's lut3d filter reads.
 * The same LUT is what "Download as .cube" gives you, for Lightroom, Premiere or CapCut.
 * Vignette, sharpen and grain are spatial, so they're separate steps on both sides.
 */

export type Adjust = {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100 (-100 is black and white)
  warmth: number; // -100..100 (cool to warm)
  tint: number; // -100..100 (green to magenta)
  fade: number; // 0..100 (lifted blacks)
  highlights: number; // -100..100
  shadows: number; // -100..100
  sepia: number; // 0..100
  splitShadow: string; // hex colour pushed into the shadows ("" for none)
  splitHighlight: string; // hex colour pushed into the highlights ("" for none)
  split: number; // 0..100 strength of the two split-tone colours
  vignette: number; // 0..100
  sharpen: number; // 0..100
  grain: number; // 0..100
};

export const NEUTRAL: Adjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  tint: 0,
  fade: 0,
  highlights: 0,
  shadows: 0,
  sepia: 0,
  splitShadow: "",
  splitHighlight: "",
  split: 0,
  vignette: 0,
  sharpen: 0,
  grain: 0,
};

export const SLIDERS: { key: keyof Adjust; label: string; min: number; max: number }[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "warmth", label: "Warmth", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "fade", label: "Fade", min: 0, max: 100 },
  { key: "sepia", label: "Sepia", min: 0, max: 100 },
  { key: "vignette", label: "Vignette", min: 0, max: 100 },
  { key: "sharpen", label: "Sharpen", min: 0, max: 100 },
  { key: "grain", label: "Grain", min: 0, max: 100 },
];

export type FilterPreset = { id: string; name: string; adjust: Partial<Adjust> };
export type FilterPack = { id: string; name: string; blurb: string; builtIn?: boolean; filters: FilterPreset[] };

/** Essentials come with every workspace; the rest are installed from the filter store. */
export const PACKS: FilterPack[] = [
  {
    id: "essentials",
    name: "Essentials",
    blurb: "Everyday looks that suit most photos and clips.",
    builtIn: true,
    filters: [
      { id: "bright", name: "Bright", adjust: { brightness: 12, contrast: 10, saturation: 12 } },
      { id: "vivid", name: "Vivid", adjust: { contrast: 18, saturation: 35, shadows: 8 } },
      { id: "warm", name: "Warm", adjust: { warmth: 35, saturation: 8 } },
      { id: "cool", name: "Cool", adjust: { warmth: -35, tint: -6 } },
      { id: "mono", name: "Mono", adjust: { saturation: -100, contrast: 15 } },
      { id: "soft", name: "Soft", adjust: { contrast: -15, fade: 18, highlights: -10 } },
    ],
  },
  {
    id: "film",
    name: "Film",
    blurb: "Analogue stocks: soft blacks, gentle colour and a little grain.",
    filters: [
      { id: "portra", name: "Portra", adjust: { warmth: 18, saturation: -8, fade: 12, highlights: -12, splitShadow: "#2f4b5a", splitHighlight: "#f2d2a9", split: 22, grain: 12 } },
      { id: "kodachrome", name: "Kodachrome", adjust: { contrast: 22, saturation: 22, warmth: 12, shadows: -8, grain: 10 } },
      { id: "fuji", name: "Fuji 400", adjust: { warmth: -8, tint: -10, saturation: 6, fade: 10, splitShadow: "#1e5a52", split: 18, grain: 14 } },
      { id: "cine", name: "Cine", adjust: { contrast: 12, saturation: -12, splitShadow: "#13435c", splitHighlight: "#f0b47a", split: 35, vignette: 25 } },
      { id: "trix", name: "Tri-X", adjust: { saturation: -100, contrast: 35, fade: 6, grain: 30, vignette: 18 } },
    ],
  },
  {
    id: "moody",
    name: "Moody",
    blurb: "Low light, deep shadows and muted colour for drama.",
    filters: [
      { id: "noir", name: "Noir", adjust: { saturation: -100, contrast: 45, brightness: -8, vignette: 45 } },
      { id: "teal-orange", name: "Teal & Orange", adjust: { contrast: 15, saturation: 10, splitShadow: "#0c5f6b", splitHighlight: "#ff9d4d", split: 45 } },
      { id: "dusk", name: "Dusk", adjust: { brightness: -10, warmth: -12, tint: 14, saturation: -15, vignette: 30 } },
      { id: "matte", name: "Matte", adjust: { contrast: -10, fade: 30, saturation: -20, shadows: 10 } },
      { id: "forest", name: "Forest", adjust: { tint: -18, saturation: -10, shadows: -10, splitShadow: "#173d2a", split: 30, vignette: 20 } },
    ],
  },
  {
    id: "vintage",
    name: "Vintage",
    blurb: "Faded prints, warm casts and old-camera vignettes.",
    filters: [
      { id: "sepia", name: "Sepia", adjust: { sepia: 85, contrast: 5, vignette: 20 } },
      { id: "seventies", name: "1970s", adjust: { warmth: 30, saturation: -18, fade: 22, splitHighlight: "#ffd28a", split: 25, grain: 18 } },
      { id: "polaroid", name: "Polaroid", adjust: { brightness: 8, contrast: -12, fade: 25, tint: 8, warmth: 10, vignette: 12 } },
      { id: "lomo", name: "Lomo", adjust: { contrast: 35, saturation: 30, vignette: 60, splitShadow: "#203070", split: 15 } },
    ],
  },
  {
    id: "food-travel",
    name: "Food & Travel",
    blurb: "Clean, appetising colour and golden light for places and plates.",
    filters: [
      { id: "fresh", name: "Fresh", adjust: { brightness: 10, saturation: 18, warmth: 6, sharpen: 25 } },
      { id: "golden", name: "Golden hour", adjust: { warmth: 40, highlights: -8, splitHighlight: "#ffbf69", split: 30, saturation: 10 } },
      { id: "coast", name: "Coast", adjust: { warmth: -15, brightness: 10, saturation: 15, splitShadow: "#1a5f8a", split: 18 } },
      { id: "crisp", name: "Crisp", adjust: { contrast: 20, shadows: 12, highlights: -15, sharpen: 40 } },
    ],
  },
];

export const STORE_PACK_IDS = PACKS.filter((p) => !p.builtIn).map((p) => p.id);

export function fullAdjust(a: Partial<Adjust> | null | undefined): Adjust {
  const out = { ...NEUTRAL };
  for (const s of SLIDERS) {
    const v = Number(a?.[s.key]);
    if (Number.isFinite(v)) (out as Record<string, unknown>)[s.key] = Math.max(s.min, Math.min(s.max, Math.round(v)));
  }
  const hex = (h: unknown) => (typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : "");
  out.splitShadow = hex(a?.splitShadow);
  out.splitHighlight = hex(a?.splitHighlight);
  const sp = Number(a?.split);
  out.split = Number.isFinite(sp) ? Math.max(0, Math.min(100, Math.round(sp))) : 0;
  return out;
}

export function isNeutral(a: Adjust) {
  return colourIsNeutral(a) && !a.vignette && !a.sharpen && !a.grain;
}

export function colourIsNeutral(a: Adjust) {
  return !a.brightness && !a.contrast && !a.saturation && !a.warmth && !a.tint && !a.fade && !a.highlights && !a.shadows && !a.sepia && !(a.split && (a.splitShadow || a.splitHighlight));
}

function rgbOf(hex: string): [number, number, number] | null {
  if (!hex) return null;
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Builds the colour function for a set of adjustments; r, g, b and the result are 0..1. */
export function colourFn(a: Adjust) {
  const sh = rgbOf(a.splitShadow);
  const hi = rgbOf(a.splitHighlight);
  const split = a.split / 100;
  const bright = a.brightness / 100;
  const contrast = 1 + a.contrast / 100;
  const sat = 1 + a.saturation / 100;
  const warm = a.warmth / 100;
  const tint = a.tint / 100;
  const fade = a.fade / 100;
  const hl = a.highlights / 100;
  const sd = a.shadows / 100;
  const sepia = a.sepia / 100;
  const out: [number, number, number] = [0, 0, 0];

  return (r: number, g: number, b: number): [number, number, number] => {
    // A gamma-style curve, so black stays black and white stays white.
    if (bright > 0) {
      const k = 1 + bright * 0.8;
      r = 1 - Math.pow(1 - r, k);
      g = 1 - Math.pow(1 - g, k);
      b = 1 - Math.pow(1 - b, k);
    } else if (bright < 0) {
      const k = 1 - bright * 0.8;
      r = Math.pow(r, k);
      g = Math.pow(g, k);
      b = Math.pow(b, k);
    }
    if (warm) {
      r += warm * 0.08;
      b -= warm * 0.08;
    }
    if (tint) {
      g -= tint * 0.06;
      r += tint * 0.02;
      b += tint * 0.02;
    }
    let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (hl || sd) {
      const lc = clamp(l);
      const d = hl * 0.35 * lc * lc * lc + sd * 0.35 * (1 - lc) * (1 - lc) * (1 - lc);
      r += d;
      g += d;
      b += d;
    }
    if (contrast !== 1) {
      r = (r - 0.5) * contrast + 0.5;
      g = (g - 0.5) * contrast + 0.5;
      b = (b - 0.5) * contrast + 0.5;
    }
    if (sat !== 1) {
      l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
    }
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sepia;
      g += (sg - g) * sepia;
      b += (sb - b) * sepia;
    }
    if (split && (sh || hi)) {
      l = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (sh) {
        const w = split * (1 - l) * (1 - l) * 0.6;
        r += (sh[0] - 0.5) * w;
        g += (sh[1] - 0.5) * w;
        b += (sh[2] - 0.5) * w;
      }
      if (hi) {
        const w = split * l * l * 0.6;
        r += (hi[0] - 0.5) * w;
        g += (hi[1] - 0.5) * w;
        b += (hi[2] - 0.5) * w;
      }
    }
    if (fade) {
      r = r * (1 - fade * 0.22) + fade * 0.12;
      g = g * (1 - fade * 0.22) + fade * 0.12;
      b = b * (1 - fade * 0.22) + fade * 0.12;
    }
    out[0] = clamp(r);
    out[1] = clamp(g);
    out[2] = clamp(b);
    return out;
  };
}

/* ---------- 3D LUTs ---------- */

/** A 3D LUT with red changing fastest, as in .cube files. Values are 0..1. */
export type Lut = { size: number; data: Float32Array };

export function sampleLut(lut: Lut, r: number, g: number, b: number, out: [number, number, number]) {
  const n = lut.size - 1;
  const fr = clamp(r) * n;
  const fg = clamp(g) * n;
  const fb = clamp(b) * n;
  const r0 = Math.floor(fr);
  const g0 = Math.floor(fg);
  const b0 = Math.floor(fb);
  const r1 = Math.min(n, r0 + 1);
  const g1 = Math.min(n, g0 + 1);
  const b1 = Math.min(n, b0 + 1);
  const dr = fr - r0;
  const dg = fg - g0;
  const db = fb - b0;
  const s = lut.size;
  const d = lut.data;
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => d[(ri + gi * s + bi * s * s) * 3 + c]!;
    const c00 = at(r0, g0, b0) * (1 - dr) + at(r1, g0, b0) * dr;
    const c10 = at(r0, g1, b0) * (1 - dr) + at(r1, g1, b0) * dr;
    const c01 = at(r0, g0, b1) * (1 - dr) + at(r1, g0, b1) * dr;
    const c11 = at(r0, g1, b1) * (1 - dr) + at(r1, g1, b1) * dr;
    out[c] = (c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db;
  }
  return out;
}

/** Bakes an optional imported LUT followed by the adjustments into one LUT. */
export function buildLut(a: Adjust, base?: Lut | null, size = 33): Lut {
  const fn = colourFn(a);
  const data = new Float32Array(size * size * size * 3);
  const tmp: [number, number, number] = [0, 0, 0];
  let i = 0;
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        let r = ri / (size - 1);
        let g = gi / (size - 1);
        let b = bi / (size - 1);
        if (base) [r, g, b] = sampleLut(base, r, g, b, tmp);
        const o = fn(r, g, b);
        data[i++] = o[0];
        data[i++] = o[1];
        data[i++] = o[2];
      }
  return { size, data };
}

export const MAX_LUT_SIZE = 65;

/** Parses an Adobe/Resolve .cube file. Throws a readable error for anything else. */
export function parseCube(text: string): Lut {
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0]!.toUpperCase();
    if (key === "LUT_3D_SIZE") size = Number(parts[1]);
    else if (key === "LUT_1D_SIZE") throw new Error("1D LUTs aren't supported. Export a 3D .cube LUT.");
    else if (key === "DOMAIN_MIN") min = parts.slice(1, 4).map(Number);
    else if (key === "DOMAIN_MAX") max = parts.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(key)) {
      if (parts.length < 3) throw new Error("A line in the LUT doesn't have three numbers.");
      values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE) throw new Error(`The LUT size must be between 2 and ${MAX_LUT_SIZE}.`);
  if (values.length !== size * size * size * 3) throw new Error(`Expected ${size ** 3} colour rows for a ${size}-point LUT, found ${values.length / 3}.`);
  if (values.some((v) => !Number.isFinite(v))) throw new Error("The LUT contains something that isn't a number.");
  const data = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const c = i % 3;
    data[i] = clamp((values[i]! - min[c]!) / ((max[c]! - min[c]!) || 1));
  }
  return { size, data };
}

export function cubeText(lut: Lut, title = "Relay filter") {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`, `LUT_3D_SIZE ${lut.size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i]!.toFixed(6)} ${lut.data[i + 1]!.toFixed(6)} ${lut.data[i + 2]!.toFixed(6)}`);
  return lines.join("\n") + "\n";
}

/* ---------- Spatial steps, shared by preview and render ---------- */

/** Matches FFmpeg's vignette: cos(angle × distance / corner distance)^4. */
export const vignetteAngle = (v: number) => (v / 100) * 1.15;
export const sharpenAmount = (v: number) => (v / 100) * 1.6;
export const grainStrength = (v: number) => Math.round((v / 100) * 28);

/* ---------- The edit itself ---------- */

export const CROP_RATIOS: { id: string; label: string; ratio: number | null }[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "original", label: "Original", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "1.91:1", label: "1.91:1", ratio: 1.91 },
];

/**
 * What the editor sends to the server. Crop is a 0..1 rectangle of the image after rotation
 * and flips. Rotation is in quarter turns clockwise.
 */
export type MediaEdit = {
  rotate: 0 | 1 | 2 | 3;
  flipH: boolean;
  flipV: boolean;
  crop: { x: number; y: number; w: number; h: number } | null;
  trimStartMs?: number;
  trimEndMs?: number;
  mute?: boolean;
  adjust: Adjust;
  filterId?: string | null;
  musicId?: string | null;
  musicVolume?: number;
  musicStartMs?: number;
};

/** Whether an edit needs the paid "full editing" feature. */
export function usesStudio(e: Pick<MediaEdit, "adjust" | "filterId" | "musicId">) {
  return !isNeutral(e.adjust) || Boolean(e.filterId) || Boolean(e.musicId);
}
