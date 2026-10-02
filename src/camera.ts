/**
 * The camera over a tank wider than the screen (v5). Pure math on a small struct;
 * sim.ts owns the state and the public API (panBy, flingCam, camTo, ...).
 *
 * `x` is the World node's offset, artboard units, always in [lo, 0] where
 * lo = -(wallX - 720): x = -360 shows world x 360..1080.
 */
import { K, clamp } from "./species";

/** The visible width of the world: the artboard. */
export const VIEW_W = K.W;
/** Fling inertia: velocity decays as exp(-t / FLING_TAU) (it travels v * FLING_TAU in all). */
export const FLING_TAU = 0.4;
/** Fastest fling taken from the host, px/s. */
export const FLING_MAX = 4000;
/** Below this the fling comes to rest, px/s. */
export const FLING_REST = 5;
/** Soft stop: near the end of the tank the speed is capped at (distance left) / EDGE_SOFT, so it eases in. */
export const EDGE_SOFT = 0.12;
/** While a decoration is dragged near a screen edge the camera scrolls up to this fast, px/s... */
export const EDGE_SCROLL = 420;
/** ...ramping in over this many px from the edge of the water. */
export const EDGE_ZONE = 84;

export interface Cam {
  /** the World offset (≤ 0), unsnapped */
  x: number;
  /** fling velocity, px/s (0 = not flinging) */
  v: number;
  /** an eased move (camTo, the upgrade reveal); it may start in the future */
  ease: { from: number; to: number; t0: number; dur: number } | null;
}

export const newCam = (x = 0): Cam => ({ x, v: 0, ease: null });

/** The leftmost camera offset for a right wall at `wallX`. */
export const camLo = (wallX: number) => Math.min(0, VIEW_W - wallX);

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/** How long an eased move of this many px takes, s. */
export const easeTime = (dist: number) => clamp(0.3 + Math.abs(dist) / 1100, 0.35, 0.9);

/** Advance the camera by dt at sim time t, inside [lo, 0]. */
export function stepCam(c: Cam, t: number, dt: number, lo: number): void {
  if (c.ease) {
    const e = c.ease;
    const p = clamp((t - e.t0) / e.dur);
    if (t >= e.t0) c.x = e.from + (e.to - e.from) * easeInOut(p);
    if (p >= 1) c.ease = null;
  } else if (c.v !== 0) {
    let v = c.v * Math.exp(-dt / FLING_TAU);
    // soft stop: never faster than it can ease into the end of the tank
    const room = v < 0 ? c.x - lo : -c.x;
    const cap = Math.max(0, room) / EDGE_SOFT;
    if (Math.abs(v) > cap) v = Math.sign(v) * cap;
    c.x += v * dt;
    const left = v < 0 ? c.x - lo : -c.x;
    c.v = Math.abs(v) < FLING_REST || left < 0.25 ? 0 : v;
    if (c.v === 0 && left < 0.25) c.x = v < 0 ? lo : 0;
  }
  c.x = clamp(c.x, lo, 0);
}
