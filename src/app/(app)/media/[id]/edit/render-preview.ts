import { grainStrength, sampleLut, sharpenAmount, vignetteAngle, type Adjust, type Lut, type MediaEdit } from "@/lib/media/filters";

/**
 * The editor's live preview, drawn on a canvas in the same order the server renders:
 * rotate and flip, crop, colour LUT, vignette, sharpen, grain.
 */

type Source = HTMLImageElement | HTMLVideoElement;

export function sourceSize(el: Source) {
  return el instanceof HTMLVideoElement ? { w: el.videoWidth, h: el.videoHeight } : { w: el.naturalWidth, h: el.naturalHeight };
}

/** Size after rotation. */
export function orientedSize(w: number, h: number, rotate: number) {
  return rotate % 2 ? { w: h, h: w } : { w, h };
}

/** Draws the source rotated and flipped, scaled so the long side is at most maxSide. */
export function drawOriented(canvas: HTMLCanvasElement, el: Source, edit: Pick<MediaEdit, "rotate" | "flipH" | "flipV">, maxSide: number) {
  const { w: sw, h: sh } = sourceSize(el);
  if (!sw || !sh) return false;
  const o = orientedSize(sw, sh, edit.rotate);
  const scale = Math.min(1, maxSide / Math.max(o.w, o.h));
  const cw = Math.max(1, Math.round(o.w * scale));
  const ch = Math.max(1, Math.round(o.h * scale));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  // Flips apply after rotation, as in FFmpeg's transpose then hflip/vflip.
  ctx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  ctx.rotate((edit.rotate * Math.PI) / 2);
  const dw = (edit.rotate % 2 ? ch : cw) / 1;
  const dh = (edit.rotate % 2 ? cw : ch) / 1;
  ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return true;
}

/** Copies the crop rectangle of `from` into `to`. */
export function drawCropped(to: HTMLCanvasElement, from: HTMLCanvasElement, crop: MediaEdit["crop"]) {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(c.x * from.width);
  const sy = Math.round(c.y * from.height);
  const sw = Math.max(1, Math.round(c.w * from.width));
  const sh = Math.max(1, Math.round(c.h * from.height));
  if (to.width !== sw || to.height !== sh) {
    to.width = sw;
    to.height = sh;
  }
  const ctx = to.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(from, sx, sy, sw, sh, 0, 0, sw, sh);
}

/** Applies colour, vignette, sharpen and grain in place. */
export function applyLook(canvas: HTMLCanvasElement, adjust: Adjust, lut: Lut | null, opts: { sharpen?: boolean; seed?: number } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  if (!lut && !adjust.vignette && !adjust.sharpen && !adjust.grain) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return; // a cross-origin file without CORS; the server render still applies the look
  }
  const d = img.data;
  const tmp: [number, number, number] = [0, 0, 0];

  if (lut) {
    // Cache per 6-bit colour so big flat areas don't re-sample the LUT.
    const cache = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) {
      const key = ((d[i]! >> 2) << 12) | ((d[i + 1]! >> 2) << 6) | (d[i + 2]! >> 2);
      let packed = cache.get(key);
      if (packed === undefined) {
        sampleLut(lut, d[i]! / 255, d[i + 1]! / 255, d[i + 2]! / 255, tmp);
        packed = (Math.round(tmp[0] * 255) << 16) | (Math.round(tmp[1] * 255) << 8) | Math.round(tmp[2] * 255);
        if (cache.size < 200_000) cache.set(key, packed);
      }
      d[i] = (packed >> 16) & 255;
      d[i + 1] = (packed >> 8) & 255;
      d[i + 2] = packed & 255;
    }
  }

  if (adjust.vignette) {
    const angle = vignetteAngle(adjust.vignette);
    const cx = w / 2;
    const cy = h / 2;
    const dmax = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dn = Math.hypot(x - cx, y - cy) / dmax;
        const c = Math.cos(angle * dn);
        const f = dn > 1 ? 0 : c * c * c * c;
        const i = (y * w + x) * 4;
        d[i] = d[i]! * f;
        d[i + 1] = d[i + 1]! * f;
        d[i + 2] = d[i + 2]! * f;
      }
    }
  }

  if (adjust.sharpen && opts.sharpen !== false) {
    // Unsharp mask with a 3×3 blur: close to FFmpeg's 5×5 at preview sizes.
    const amt = sharpenAmount(adjust.sharpen);
    const src = new Uint8ClampedArray(d);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const blur =
            (src[i - w * 4 - 4 + c]! + 2 * src[i - w * 4 + c]! + src[i - w * 4 + 4 + c]! + 2 * src[i - 4 + c]! + 4 * src[i + c]! + 2 * src[i + 4 + c]! + src[i + w * 4 - 4 + c]! + 2 * src[i + w * 4 + c]! + src[i + w * 4 + 4 + c]!) / 16;
          d[i + c] = src[i + c]! + (src[i + c]! - blur) * amt;
        }
      }
    }
  }

  if (adjust.grain) {
    const s = grainStrength(adjust.grain);
    let seed = opts.seed ?? 1;
    for (let i = 0; i < d.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed / 4294967296) * 2 - 1) * s;
      d[i] = d[i]! + n;
      d[i + 1] = d[i + 1]! + n;
      d[i + 2] = d[i + 2]! + n;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Largest rectangle of a given pixel ratio, centred, as a 0..1 crop. */
export function fitCrop(ratio: number | null, w: number, h: number): MediaEdit["crop"] {
  if (!ratio) return null;
  const imgRatio = w / h;
  if (imgRatio > ratio) {
    const cw = ratio / imgRatio;
    return { x: (1 - cw) / 2, y: 0, w: cw, h: 1 };
  }
  const ch = imgRatio / ratio;
  return { x: 0, y: (1 - ch) / 2, w: 1, h: ch };
}
