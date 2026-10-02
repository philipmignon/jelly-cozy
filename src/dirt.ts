/**
 * Dirt spots on the front glass (v8). Pure data and helpers; sim.ts owns the state, events and dollars.
 *
 * Up to SPOT_N spots, each `{ x, y, dirt 0..1, v (kind 0 algae, 1 smear, 2 speckles) }` in WORLD
 * coordinates (the spot's middle), kept in fixed slots so spot{i} in the view stays the same spot.
 * New spots appear every 90-150 s while there's room and grow from faint to full over ~5 minutes.
 * The tank's murk is derived: murk = clamp(sum(dirt) / 6).
 */
import { K, P, clamp, num, sandAt } from "./species";

export interface Spot {
  x: number;
  y: number;
  dirt: number;
  /** grime kind: 0 green algae bloom, 1 brown smear, 2 speckle cluster */
  v: number;
  /** the most dirt it has had (a spot scrubbed off from >= PAY_DIRT pays a dollar) */
  peak: number;
}

/** A spot as saved. */
export interface SaveSpot {
  x: number;
  y: number;
  dirt: number;
  v: number;
}

const C = K as unknown as { spotN?: unknown; spotR?: unknown };
/** How many spots the glass holds (contract.spotN, the art's spot0..11). */
export const SPOT_N = clamp(Math.round(num(C.spotN) ?? 12), 1, 32);
/** Half the art's extent, artboard px: spots keep this far inside the water. */
export const SPOT_R = Math.max(30, num(C.spotR) ?? 66);
export const SPOT_KINDS = 3;
/** Seconds from a new (faint) spot to a full one. */
export const SPOT_GROW = 300;
/** A new spot's dirt. */
export const SPOT_START = 0.05;
/** A new spot every SPOT_GAP_MIN + rand * SPOT_GAP_SPREAD seconds while there's room. */
export const SPOT_GAP_MIN = 90;
export const SPOT_GAP_SPREAD = 60;
/** murk = sum(dirt) / MURK_DIRT */
export const MURK_DIRT = 6;
/** Scrubbing reaches spots whose middle is this close to the sponge, artboard px. */
export const SCRUB_REACH = 60;
/** "Steady scrubbing" is a finger rubbing at SCRUB_SPEED px/s; a full spot comes off in SCRUB_TIME of it. */
export const SCRUB_SPEED = 600;
export const SCRUB_TIME = 1.75;
export const SCRUB_PER_PX = 1 / (SCRUB_SPEED * SCRUB_TIME);
/** One scrubAt call counts at most this much movement (a jump of the pointer isn't a scrub). */
export const SCRUB_STEP_MAX = 160;
/** A spot that had at least this much dirt pays when scrubbed clean. */
export const PAY_DIRT = 0.4;
export const SPOT_PAY = 1;
/** A pellet rotting on the sand adds this much dirt (the old +0.03 murk) and brings the next spot sooner. */
export const ROT_DIRT = 0.18;
export const ROT_HURRY = 20;
/** The snail grazes the spot it sits on at this rate (a full spot in ~15 s). */
export const SNAIL_SCRUB = 1 / 15;
/** The mini diver wipes spots within DIVER_REACH of its middle at this rate while it works. */
export const DIVER_SCRUB = 0.12;
export const DIVER_REACH = 100;
/** Time away: dirt accrues for at most this long, and no further than murk max(murk on leaving, 0.8)... */
export const AWAY_DIRT_TIME = 20 * 60;
export const AWAY_MURK_CAP = 0.8;
/** ...while the snail works the whole absence (simulated up to AWAY_SIM_MAX, in AWAY_DT steps). */
export const AWAY_SIM_MAX = 6 * 3600;
export const AWAY_DT = 5;
/** Away, the snail spends about this share of its time on a spot (the rest crawling between them). */
export const SNAIL_AWAY_DUTY = 0.6;

const sumDirt = (spots: readonly (Spot | SaveSpot | null)[]) => spots.reduce((a, sp) => a + (sp ? sp.dirt : 0), 0);
/** The tank's murk from its spots: clamp(sum(dirt) / 6). */
export const murkOf = (spots: readonly (Spot | SaveSpot | null)[]) => clamp(sumDirt(spots) / MURK_DIRT);

/** Opacity for a spot's dirt: faint (but readable) when new, solid when full; 0 when gone. */
export const spotOpacity = (dirt: number) => (dirt <= 0 ? 0 : clamp(0.25 + 0.75 * Math.min(1, dirt) ** 0.7));

/** A small seeded PRNG (mulberry32), for the deterministic away simulation and save migration. */
export function rng(seed: number): () => number {
  let a = Math.floor(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The lowest a spot's middle may sit at x: its art stays above the sand. */
export const spotYMax = (x: number) => Math.min(sandAt(x - SPOT_R * 0.7), sandAt(x), sandAt(x + SPOT_R * 0.7)) - SPOT_R;
/** The water a spot may sit in, for a tank whose right glass is at `right` (world x). */
export const spotBox = (right: number) => ({ x0: K.glassL + SPOT_R, x1: Math.max(K.glassL + SPOT_R, right - SPOT_R), y0: K.waterTop + SPOT_R });

/** Clamp a spot's middle into the water (pixel grid). */
export function clampSpot(x: number, y: number, right: number): { x: number; y: number } {
  const b = spotBox(right);
  const cx = clamp(x, b.x0, b.x1);
  return { x: Math.round(cx / P) * P, y: Math.round(clamp(y, b.y0, Math.max(b.y0, spotYMax(cx))) / P) * P };
}

/**
 * Somewhere for a new spot: best of a few random candidates, as far as possible from the spots already
 * there. With `nearX`, low on the glass around that x (food rotting on the sand below).
 */
export function placeSpot(spots: readonly (Spot | SaveSpot | null)[], rand: () => number, right: number, nearX?: number): { x: number; y: number } {
  const b = spotBox(right);
  let best = { x: b.x0, y: b.y0 };
  let bestD = -1;
  for (let k = 0; k < 10; k++) {
    let x: number;
    let y: number;
    if (nearX !== undefined) {
      x = nearX + (rand() - 0.5) * SPOT_R;
      const lo = clamp(x, b.x0, b.x1);
      y = spotYMax(lo) - rand() * SPOT_R * 0.8;
    } else {
      x = b.x0 + rand() * (b.x1 - b.x0);
      const lo = clamp(x, b.x0, b.x1);
      y = b.y0 + rand() * Math.max(0, spotYMax(lo) - b.y0);
    }
    const p = clampSpot(x, y, right);
    let d = Infinity;
    for (const sp of spots) if (sp) d = Math.min(d, Math.hypot(sp.x - p.x, sp.y - p.y));
    if (nearX !== undefined) d = Math.min(d, 3 * SPOT_R) - Math.abs(p.x - nearX) * 0.5; // stay near the pellet
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** A new spot in the first free slot (index, or -1 when the glass is full). */
export function addSpot(spots: (Spot | null)[], rand: () => number, right: number, dirt = SPOT_START, nearX?: number): number {
  const i = spots.findIndex((sp) => !sp);
  if (i < 0) return -1;
  const p = placeSpot(spots, rand, right, nearX);
  const d = clamp(dirt);
  spots[i] = { x: p.x, y: p.y, dirt: d, v: Math.min(SPOT_KINDS - 1, Math.floor(rand() * SPOT_KINDS)), peak: d };
  return i;
}

/** Add dirt to spot i (up to full). */
export function dirty(sp: Spot, amount: number): void {
  sp.dirt = clamp(sp.dirt + amount);
  sp.peak = Math.max(sp.peak, sp.dirt);
}

/** Grow every spot by dt seconds' worth. */
export function growSpots(spots: (Spot | null)[], dt: number): void {
  for (const sp of spots) if (sp) dirty(sp, dt / SPOT_GROW);
}

/** The dirtiest spot's slot (-1 if the glass is clean). */
export function dirtiest(spots: readonly (Spot | null)[], ok: (sp: Spot) => boolean = () => true): number {
  let best = -1;
  let bestD = 0;
  spots.forEach((sp, i) => {
    if (sp && sp.dirt > bestD && ok(sp)) {
      bestD = sp.dirt;
      best = i;
    }
  });
  return best;
}

/**
 * Rot from a pellet left on the sand at x: feeds a spot low on the glass near x if there is one,
 * else starts one there, else (the glass is full) feeds the nearest spot. Returns the slot.
 */
export function rotInto(spots: (Spot | null)[], x: number, rand: () => number, right: number): number {
  let near = -1;
  let nearD = Infinity;
  spots.forEach((sp, i) => {
    if (!sp) return;
    const dx = Math.abs(sp.x - x);
    if (dx < SPOT_R * 1.5 && sp.y > spotYMax(sp.x) - SPOT_R * 2 && dx < nearD) {
      nearD = dx;
      near = i;
    }
  });
  if (near < 0) near = addSpot(spots, rand, right, 0, x);
  if (near < 0) {
    spots.forEach((sp, i) => {
      if (sp && Math.abs(sp.x - x) < nearD) {
        nearD = Math.abs(sp.x - x);
        near = i;
      }
    });
  }
  const sp = spots[near];
  if (sp) dirty(sp, ROT_DIRT);
  return near;
}

/**
 * Spots for an older save that only knew its murk: a few spots (each up to 0.8 dirt) whose dirt adds up
 * to murk × 6, spread over the tank's water.
 */
export function spotsForMurk(murk: number, right: number, rand: () => number): Spot[] {
  const total = clamp(Number.isFinite(murk) ? murk : 0) * MURK_DIRT;
  if (total <= 1e-6) return [];
  const n = Math.min(SPOT_N, Math.ceil(total / 0.8 - 1e-9));
  const each = Math.min(1, total / n);
  const out: (Spot | null)[] = [];
  for (let i = 0; i < n; i++) {
    out.push(null);
    addSpot(out, rand, right, each);
  }
  return out.filter((sp): sp is Spot => sp !== null);
}

/** Saved spots, repaired: finite, inside the water, dirt in (0, 1], at most SPOT_N. */
export function spotsFromSave(raw: unknown, right: number): Spot[] {
  if (!Array.isArray(raw)) return [];
  const out: Spot[] = [];
  for (const r of raw) {
    if (out.length >= SPOT_N) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const x = num(o.x);
    const y = num(o.y);
    const d = num(o.dirt);
    if (x === null || y === null || d === null || d <= 0) continue;
    const p = clampSpot(x, y, right);
    const dirt = clamp(d);
    out.push({ x: p.x, y: p.y, dirt, v: clamp(Math.round(num(o.v) ?? 0), 0, SPOT_KINDS - 1), peak: dirt });
  }
  return out;
}

export const toSaveSpots = (spots: readonly (Spot | null)[]): SaveSpot[] =>
  spots.flatMap((sp) => (sp && sp.dirt > 0 ? [{ x: sp.x, y: sp.y, dirt: sp.dirt, v: sp.v }] : []));

/** Fixed slots (length SPOT_N) from a list. */
export const spotSlots = (list: readonly Spot[]): (Spot | null)[] => Array.from({ length: SPOT_N }, (_, i) => (list[i] ? { ...list[i]! } : null));

export interface AwayDirt {
  spots: Spot[];
  murk: number;
  /** seconds of [0, limit) the water was clear enough (murk < goodMurk) for good care */
  goodTime: (limit: number) => number;
}

/**
 * The glass while nobody watched for `seconds`: spots appear and grow as they would (for up to
 * AWAY_DIRT_TIME, and murk no higher than max(murk on leaving, 0.8)); with the snail, it grazes the
 * dirtiest spot whenever murk is above `snailFloor`, for the whole absence (up to AWAY_SIM_MAX).
 */
export function dirtAway(start: readonly Spot[], seconds: number, right: number, snail: boolean, snailFloor: number, goodMurk: number, seed: number): AwayDirt {
  const rand = rng(seed);
  const spots = spotSlots(start);
  const m0 = murkOf(spots);
  const cap = Math.max(m0, AWAY_MURK_CAP);
  const total = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, snail ? AWAY_SIM_MAX : AWAY_DIRT_TIME));
  const steps = Math.ceil(total / AWAY_DT - 1e-9);
  const good: boolean[] = [];
  let next = rand() * SPOT_GAP_MIN;
  for (let i = 0; i < steps; i++) {
    const t = i * AWAY_DT;
    const dt = Math.min(AWAY_DT, total - t);
    good.push(murkOf(spots) < goodMurk);
    if (t < AWAY_DIRT_TIME) {
      const m = murkOf(spots);
      const grow = spots.reduce((a, sp) => a + (sp ? Math.min(1 - sp.dirt, dt / SPOT_GROW) : 0), 0) / MURK_DIRT;
      if (m < cap && grow > 0) {
        const f = Math.min(1, (cap - m) / grow);
        for (const sp of spots) if (sp) dirty(sp, (Math.min(1 - sp.dirt, dt / SPOT_GROW)) * f);
      }
      if (t >= next) {
        if (murkOf(spots) + SPOT_START / MURK_DIRT <= cap + 1e-9) addSpot(spots, rand, right);
        next = t + SPOT_GAP_MIN + rand() * SPOT_GAP_SPREAD;
      }
    }
    if (snail && murkOf(spots) > snailFloor) {
      const k = dirtiest(spots);
      const sp = spots[k];
      if (sp) {
        // no further than the floor: the snail leaves the tank lightly cloudy
        const room = (murkOf(spots) - snailFloor) * MURK_DIRT;
        sp.dirt -= Math.min(sp.dirt, room, SNAIL_SCRUB * SNAIL_AWAY_DUTY * dt);
        if (sp.dirt <= 1e-9) spots[k] = null;
      }
    }
  }
  const end = murkOf(spots);
  const endGood = end < goodMurk;
  return {
    spots: spots.filter((sp): sp is Spot => sp !== null),
    murk: end,
    goodTime: (limit: number) => {
      let g = 0;
      const lim = Math.max(0, limit);
      for (let i = 0; i < good.length; i++) {
        const t0 = i * AWAY_DT;
        if (t0 >= lim) break;
        if (good[i]) g += Math.min(AWAY_DT, lim - t0, total - t0);
      }
      if (lim > total && endGood) g += lim - total;
      return g;
    },
  };
}
