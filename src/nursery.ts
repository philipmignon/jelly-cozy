/**
 * ---- nursery ---- The nursery bowl's geometry and the little ones' own motion. Pure: no DOM, no Rive; sim.ts
 * (its nursery block) holds the rules and calls these.
 *
 * The bowl hangs from the hood's lip at the top left of the water (screen space, in front of the glass, like the
 * Halloween bat). Tapped, it zooms out into the open bowl: a round fishbowl in the upper water with a sand bed and
 * four polyp spots. Nursery jellies live in the OPEN bowl's own coordinates: artboard units about its centre
 * (NURSERY.cx, NURSERY.cy on screen when open), so `nj{n}x/y` are written as they are and the view node carries the
 * zoom. The geometry comes from contract.nursery (tools/gen.py's nursery block), with fallbacks that match it.
 */
import { K, NUR_CAP, P, clamp, num, type Species } from "./species";
import type { Jelly } from "./sim";

type Rect = { x: number; y: number; w: number; h: number };

export interface NurseryGeom {
  /** the hanging bowl's hit box (screen) and its middle */
  icon: Rect;
  iconC: { x: number; y: number };
  /** the open bowl's centre (screen) and the radius inside its glass */
  cx: number;
  cy: number;
  r: number;
  /** the scale the open bowl has when it sits where the hanging one is (the zoom's start) */
  closedScale: number;
  /** local y of the water's surface and of the sand's flat top */
  surface: number;
  floor: number;
  /** polyp spots (local; base of the stalk) */
  anchors: { x: number; y: number }[];
  /** where a swimming ephyra's origin may go (local) */
  swim: { x0: number; x1: number; y0: number; y1: number };
}

const FALLBACK: NurseryGeom = {
  icon: { x: 33, y: 30, w: 90, h: 114 },
  iconC: { x: 78, y: 99 },
  cx: 360,
  cy: 456,
  r: 282,
  closedScale: 0.133,
  surface: -210,
  floor: 186,
  anchors: [
    { x: -162, y: 186 },
    { x: -60, y: 165 },
    { x: 54, y: 180 },
    { x: 156, y: 186 },
  ],
  swim: { x0: -186, x1: 186, y0: -150, y1: 105 },
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const rectOf = (v: unknown, fb: Rect): Rect => {
  const o = obj(v);
  const x = num(o.x);
  const y = num(o.y);
  const w = num(o.w);
  const h = num(o.h);
  return x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0 ? { x, y, w, h } : fb;
};
const pt = (v: unknown, fb: { x: number; y: number }) => {
  const o = obj(v);
  const x = num(o.x);
  const y = num(o.y);
  return x !== null && y !== null ? { x, y } : fb;
};

/** contract.nursery, entry by entry over the fallback. */
export const NURSERY: NurseryGeom = (() => {
  const o = obj((K as unknown as { nursery?: unknown }).nursery);
  const fb = FALLBACK;
  const anchors = Array.isArray(o.anchors) ? o.anchors.map((a, i) => pt(a, fb.anchors[i] ?? fb.anchors[0]!)) : fb.anchors;
  const sw = obj(o.swim);
  return {
    icon: rectOf(o.icon, fb.icon),
    iconC: pt(o.iconC, fb.iconC),
    cx: num(o.cx) ?? fb.cx,
    cy: num(o.cy) ?? fb.cy,
    r: num(o.r) ?? fb.r,
    closedScale: num(o.closedScale) ?? fb.closedScale,
    surface: num(o.surface) ?? fb.surface,
    floor: num(o.floor) ?? fb.floor,
    anchors: anchors.length >= NUR_CAP ? anchors.slice(0, NUR_CAP) : fb.anchors,
    swim: { x0: num(sw.x0) ?? fb.swim.x0, x1: num(sw.x1) ?? fb.swim.x1, y0: num(sw.y0) ?? fb.swim.y0, y1: num(sw.y1) ?? fb.swim.y1 },
  };
})();

/** The zoom in and out, s (the jelly card's close-up takes as long). */
export const NUR_ZOOM_TIME = 0.35;

/** Is a screen (artboard) point on the hanging bowl? */
export const onBowl = (x: number, y: number): boolean => {
  const r = NURSERY.icon;
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
};

/** Screen -> the open bowl's local coordinates (at full zoom). */
export const toBowl = (x: number, y: number) => ({ x: x - NURSERY.cx, y: y - NURSERY.cy });
/** Local -> screen (at full zoom). */
export const fromBowl = (x: number, y: number) => ({ x: x + NURSERY.cx, y: y + NURSERY.cy });

/** Is a local point inside the bowl's water (inside the glass, under the surface)? */
export const inWater = (x: number, y: number): boolean => x * x + y * y <= NURSERY.r * NURSERY.r && y >= NURSERY.surface;

/** Is a local point anywhere on the open bowl (glass included): taps there belong to it, the rest close it. */
export const onOpenBowl = (x: number, y: number): boolean => x * x + y * y <= (NURSERY.r + 8 * P) ** 2;

/** Where a pellet comes to rest at local x: the flat sand, or the glass where the bowl curves up past it. */
export function floorAt(x: number): number {
  const r = NURSERY.r - 2 * P;
  const glass = Math.sqrt(Math.max(0, r * r - x * x));
  return Math.min(NURSERY.floor, glass) - 2 * P;
}

/** The zoom's transform at eased progress e (0 the hanging bowl, 1 open): the view node's centre and scale. */
export function zoomAt(e: number): { x: number; y: number; s: number } {
  const t = clamp(e);
  const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const c = NURSERY.iconC;
  return {
    x: Math.round(c.x + (NURSERY.cx - c.x) * k),
    y: Math.round(c.y + (NURSERY.cy - c.y) * k),
    s: Math.round((NURSERY.closedScale + (1 - NURSERY.closedScale) * k) * 1e4) / 1e4,
  };
}

/** A fresh wander target for an ephyra in the bowl (local), from the nursery's own random stream. */
export function wanderTarget(rand: () => number): { x: number; y: number } {
  const w = NURSERY.swim;
  return { x: w.x0 + rand() * (w.x1 - w.x0), y: w.y0 + rand() * (w.y1 - w.y0) };
}

/** Keep a swimmer's origin inside the swim box, stopping it against the edge it reached. */
export function keepIn(j: Pick<Jelly, "x" | "y" | "vx" | "vy">): void {
  const w = NURSERY.swim;
  if (j.x < w.x0 || j.x > w.x1) {
    j.x = clamp(j.x, w.x0, w.x1);
    j.vx = 0;
  }
  if (j.y < w.y0 || j.y > w.y1) {
    j.y = clamp(j.y, w.y0, w.y1);
    j.vy = 0;
  }
}

/** An ephyra's pulse in the bowl: how hard and how often it pushes (the main tank's ephyra numbers, gentler). */
export const NUR_SWIM = { idle: 0.8, busy: 0.5, forceIdle: 120, forceBusy: 220, squeeze: 0.35, drag: 1.6, sink: 10 } as const;

/** Which species is in which nursery slot, for the host's sprite groups (null = empty). */
export const nurserySpecies = (slots: readonly (Pick<Jelly, "k" | "morph"> | null)[]): { k: Species; morph: number }[] =>
  slots.flatMap((j) => (j ? [{ k: j.k, morph: j.morph }] : []));
