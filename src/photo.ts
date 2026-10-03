/**
 * Photo mode: a PNG of the tank, cropped to the glass (no hood HUD, no cabinet shelf), with a thin
 * caption strip, saved with an ordinary download link.
 *
 * The canvas is WebGL without preserveDrawingBuffer, so its pixels are only readable in the same
 * task that drew them. capture() stops Rive's loop, has it draw one frame synchronously
 * (resizeDrawingSurfaceToCanvas draws straight away when no frame is pending), copies the pixels
 * out, then starts the loop again. HTML overlays never reach the canvas, so they can't be in it.
 */
import { dayKey } from "./sim";

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-photo-flash {
  position: fixed; inset: 0; z-index: 30; pointer-events: none; background: #fffaf0;
  animation: jt-photo-flash 0.45s ease-out forwards;
}
@keyframes jt-photo-flash { 0% { opacity: 0.85; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .jt-photo-flash { animation-duration: 0.15s; } }
`;

/** What Rive needs to give us one fresh frame. */
export interface RiveLike {
  stopRendering(): void;
  startRendering(): void;
  resizeDrawingSurfaceToCanvas(): void;
}

/** A rectangle in canvas pixels. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const photoFilename = (now: number) => `jelly-tank-${dayKey(now)}.png`;

/** "2 OCT 2026" */
export function captionDate(now: number): string {
  const d = new Date(now);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

let styled = false;
/** The shutter: a quick cream flash over everything. */
export function flash(): void {
  if (!styled) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    styled = true;
  }
  const f = document.createElement("div");
  f.className = "jt-photo-flash";
  document.body.append(f);
  setTimeout(() => f.remove(), 600);
}

/**
 * Draw one frame now and copy `crop` of it, with a caption strip under it, onto a new 2D canvas.
 * Everything between stopRendering and the copy runs in one task.
 */
export function capture(rive: RiveLike, canvas: HTMLCanvasElement, crop: Crop, caption: { left: string; right: string }): HTMLCanvasElement {
  const w = Math.max(1, Math.round(crop.w));
  const h = Math.max(1, Math.round(crop.h));
  const strip = Math.max(24, Math.round(w * 0.07));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h + strip;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  rive.stopRendering();
  try {
    rive.resizeDrawingSurfaceToCanvas(); // with the loop stopped, this draws a frame synchronously
    ctx.drawImage(canvas, Math.round(crop.x), Math.round(crop.y), w, h, 0, 0, w, h);
  } finally {
    rive.startRendering();
  }
  // the caption strip: the hood's ink, cream pixel lettering
  ctx.fillStyle = "#23253a";
  ctx.fillRect(0, h, w, strip);
  ctx.fillStyle = "#6c7194";
  ctx.fillRect(0, h, w, Math.max(1, Math.round(strip / 12)));
  ctx.fillStyle = "#f1e2c4";
  ctx.font = `${Math.round(strip * 0.42)}px ${FONT}`;
  ctx.textBaseline = "middle";
  const pad = Math.round(strip * 0.5);
  const mid = h + strip / 2 + Math.round(strip / 24);
  ctx.textAlign = "left";
  ctx.fillText(caption.left, pad, mid);
  ctx.textAlign = "right";
  ctx.fillText(caption.right, w - pad, mid);
  return out;
}

export const toPng = (c: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => {
    try {
      c.toBlob(resolve, "image/png");
    } catch {
      resolve(null); // a tainted or zero-size canvas
    }
  });

export type SaveResult = "saved" | "failed";

/** Offer the PNG: a plain <a download> link. */
export async function savePng(blob: Blob, filename: string): Promise<SaveResult> {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return "saved";
  } catch {
    return "failed";
  }
}
