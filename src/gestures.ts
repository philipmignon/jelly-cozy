/**
 * Pointer gestures on the tank canvas, in artboard coordinates.
 *
 * A quick press is a tap. Holding still for LONG_MS is a long-press; if the
 * long-press handler returns true the gesture becomes a drag, followed by
 * window-level pointermove/up so it survives leaving the canvas (the thing
 * being dragged never has to hit-test). Moving sideways before the long-press
 * fires pans instead: pan(dx) per move in artboard units, panEnd(vx) with the
 * release velocity for inertia.
 */
export const LONG_MS = 450;
export const SLOP_PX = 12;

export interface GestureHandlers {
  tap(x: number, y: number): void;
  /** Return true to start dragging from here. */
  longPress(x: number, y: number): boolean;
  drag(x: number, y: number): void;
  drop(): void;
  /** Return false to refuse a pan starting here (e.g. on the cabinet). */
  panStart?(x: number, y: number): boolean;
  pan?(dxArtboard: number): void;
  panEnd?(vxArtboardPerSec: number): void;
  /** Vertical drags (the shop's scrolling list): return false to refuse one starting here. */
  vpanStart?(x: number, y: number): boolean;
  vpan?(dyArtboard: number): void;
  vpanEnd?(): void;
  /** Called on every pointerdown, before anything else (audio unlock). */
  down?(): void;
  /**
   * Tool mode (holding the food can or the sponge): when toolDown returns true the whole press
   * belongs to the tool (no tap, pan or long-press); toolMove follows it, toolUp ends it.
   */
  toolDown?(x: number, y: number): boolean;
  toolMove?(x: number, y: number): void;
  toolUp?(): void;
  /** The pointer moved over the canvas with nothing pressed (null = it left): the held item follows it. */
  hover?(x: number, y: number, inside: boolean): void;
}

export function attachGestures(
  canvas: HTMLCanvasElement,
  toArtboard: (clientX: number, clientY: number) => { x: number; y: number },
  h: GestureHandlers,
): () => void {
  let pointer: number | null = null;
  let start = { cx: 0, cy: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mode: "idle" | "pressing" | "held" | "dragging" | "panning" | "vpanning" | "tooling" = "idle";
  let lastX = 0;
  let lastY = 0;
  let samples: { t: number; x: number }[] = [];

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const end = () => {
    clear();
    pointer = null;
    mode = "idle";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    if (mode === "tooling") {
      e.preventDefault();
      const p = toArtboard(e.clientX, e.clientY);
      h.toolMove?.(p.x, p.y);
      return;
    }
    if (mode === "dragging") {
      e.preventDefault();
      const p = toArtboard(e.clientX, e.clientY);
      h.drag(p.x, p.y);
      return;
    }
    if (mode === "vpanning") {
      e.preventDefault();
      const a = toArtboard(0, lastY).y;
      const b = toArtboard(0, e.clientY).y;
      lastY = e.clientY;
      h.vpan?.(b - a);
      return;
    }
    if (mode === "panning") {
      e.preventDefault();
      const a = toArtboard(lastX, 0).x;
      const b = toArtboard(e.clientX, 0).x;
      lastX = e.clientX;
      samples.push({ t: e.timeStamp, x: b });
      if (samples.length > 6) samples.shift();
      h.pan?.(b - a);
      return;
    }
    if (mode === "pressing" && Math.hypot(e.clientX - start.cx, e.clientY - start.cy) > SLOP_PX) {
      clear();
      const sideways = Math.abs(e.clientX - start.cx) > Math.abs(e.clientY - start.cy);
      const p = toArtboard(start.cx, start.cy);
      if (sideways && h.pan && (h.panStart?.(p.x, p.y) ?? true)) {
        mode = "panning";
        lastX = start.cx;
        samples = [{ t: e.timeStamp, x: toArtboard(start.cx, 0).x }];
        onMove(e);
      } else if (!sideways && h.vpan && (h.vpanStart?.(p.x, p.y) ?? true)) {
        mode = "vpanning";
        lastY = start.cy;
        onMove(e);
      } else {
        mode = "held"; // a slip or a swipe nobody wants: nothing
      }
    }
  }
  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    if (mode === "pressing") {
      const p = toArtboard(e.clientX, e.clientY);
      h.tap(p.x, p.y);
    } else if (mode === "dragging") {
      h.drop();
    } else if (mode === "vpanning") {
      h.vpanEnd?.();
    } else if (mode === "tooling") {
      h.toolUp?.();
    } else if (mode === "panning") {
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = a && b ? (b.t - a.t) / 1000 : 0;
      h.panEnd?.(a && b && dt > 0.01 && e.timeStamp - b.t < 80 ? (b.x - a.x) / dt : 0);
    }
    end();
  }
  function onCancel(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    if (mode === "dragging") h.drop();
    if (mode === "panning") h.panEnd?.(0);
    if (mode === "vpanning") h.vpanEnd?.();
    if (mode === "tooling") h.toolUp?.();
    end();
  }

  function onDown(e: PointerEvent) {
    h.down?.();
    if (pointer !== null) return;
    pointer = e.pointerId;
    start = { cx: e.clientX, cy: e.clientY };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    const p0 = toArtboard(e.clientX, e.clientY);
    if (h.toolDown?.(p0.x, p0.y)) {
      mode = "tooling";
      return;
    }
    mode = "pressing";
    timer = setTimeout(() => {
      timer = null;
      if (mode !== "pressing") return;
      const p = toArtboard(start.cx, start.cy);
      mode = h.longPress(p.x, p.y) ? "dragging" : "held";
    }, LONG_MS);
  }

  const onHover = (e: PointerEvent) => {
    if (pointer !== null) return;
    const p = toArtboard(e.clientX, e.clientY);
    h.hover?.(p.x, p.y, true);
  };
  const onLeave = () => {
    if (pointer === null) h.hover?.(0, 0, false);
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onHover);
  canvas.addEventListener("pointerleave", onLeave);
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onHover);
    canvas.removeEventListener("pointerleave", onLeave);
    end();
  };
}
