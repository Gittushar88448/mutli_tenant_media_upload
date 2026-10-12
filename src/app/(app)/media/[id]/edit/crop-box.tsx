"use client";

import { useRef } from "react";
import type { MediaEdit } from "@/lib/media/filters";

type Rect = NonNullable<MediaEdit["crop"]>;
type Handle = "move" | "nw" | "ne" | "sw" | "se";
const MIN = 0.05;

/**
 * Crop rectangle drawn over the oriented image. Drag inside to move it, drag a corner to
 * resize. With a ratio set, resizing keeps it (ratio is width/height in pixels).
 */
export function CropBox({ crop, onChange, ratio, aspect }: { crop: Rect; onChange: (c: Rect) => void; ratio: number | null; aspect: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Rect } | null>(null);

  function onPointerDown(e: React.PointerEvent, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const box = ref.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.x) / box.width;
    const dy = (e.clientY - d.y) / box.height;
    const s = d.start;
    if (d.handle === "move") {
      onChange({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    // The corner opposite the one being dragged stays put.
    const left = d.handle === "nw" || d.handle === "sw";
    const top = d.handle === "nw" || d.handle === "ne";
    const ax = left ? s.x + s.w : s.x;
    const ay = top ? s.y + s.h : s.y;
    let w = clamp(left ? s.w - dx : s.w + dx, MIN, left ? ax : 1 - ax);
    let h = clamp(top ? s.h - dy : s.h + dy, MIN, top ? ay : 1 - ay);
    if (ratio) {
      // In 0..1 units a pixel ratio r means w/h = r / aspect.
      const r = ratio / aspect;
      const maxW = left ? ax : 1 - ax;
      const maxH = top ? ay : 1 - ay;
      if (w / h > r) w = h * r;
      else h = w / r;
      if (w > maxW) {
        w = maxW;
        h = w / r;
      }
      if (h > maxH) {
        h = maxH;
        w = h * r;
      }
    }
    onChange({ x: left ? ax - w : ax, y: top ? ay - h : ay, w, h });
  }

  const pct = (v: number) => `${v * 100}%`;
  return (
    <div ref={ref} className="absolute inset-0 touch-none" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
      {/* Dim everything outside the crop. */}
      <div
        className="absolute cursor-move border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
        style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
        onPointerDown={(e) => onPointerDown(e, "move")}
        data-testid="crop-box"
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="border-[0.5px] border-white/30" />
          ))}
        </div>
        {(["nw", "ne", "sw", "se"] as const).map((hnd) => (
          <span
            key={hnd}
            aria-label={`Resize ${hnd}`}
            onPointerDown={(e) => onPointerDown(e, hnd)}
            className="absolute size-4 rounded-full border-2 border-white bg-signal"
            style={{
              left: hnd.includes("w") ? -8 : undefined,
              right: hnd.includes("e") ? -8 : undefined,
              top: hnd.includes("n") ? -8 : undefined,
              bottom: hnd.includes("s") ? -8 : undefined,
              cursor: hnd === "nw" || hnd === "se" ? "nwse-resize" : "nesw-resize",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
