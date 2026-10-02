/**
 * Tank helpers (v3): the snail on the front glass, the cleaner shrimp and the
 * hermit crab on the sand. Pure movement; sim.ts owns ownership, food, dollars
 * and events.
 *
 * Positions are world units (x 0..worldW, v5). Snail origin = centre of the shell;
 * shrimp and crab origin = bottom-centre, standing on the sand (y = sand top under x).
 * Each step takes a HelperWorld: where the right glass is now and which open-sand
 * ranges the tank has (it grows with the tier).
 */
import {
  CRAB_SIZE,
  CRAB_SPEED,
  DIG_MIN,
  DIG_SPREAD,
  DIG_TIME,
  K,
  OPEN_SAND,
  P,
  type SandRange,
  SHRIMP_EAT_TIME,
  SHRIMP_FOOD_SPEED,
  SHRIMP_SIZE,
  SHRIMP_SPEED,
  SNAIL_SIZE,
  SNAIL_SPEED,
  clamp,
  sandAt,
} from "./species";

export interface Snail {
  x: number;
  y: number;
  /** facing: +1 right, -1 left */
  sx: 1 | -1;
  /** crawl cycle 0..1 */
  phase: number;
  /** current frame 0..1 */
  f: number;
  tx: number;
  ty: number;
  /** give up on the target after this sim time */
  until: number;
  /** resting until this sim time */
  restUntil: number;
  /** wander seed for the gentle side-to-side */
  wob: number;
}

export type WalkerAct = "walk" | "wait" | "act";

/** Shrimp and crab: they walk the sand line. `act` = eating (shrimp) or digging (crab). */
export interface Walker {
  x: number;
  y: number;
  sx: 1 | -1;
  phase: number;
  /** current frame 0..3 (0-1 walk, 2-3 pick/eat or dig) */
  f: number;
  mode: WalkerAct;
  tx: number;
  waitUntil: number;
  /** seconds left of the current eat/dig */
  actLeft: number;
  /** shrimp: food index being eaten (-1 none) */
  food: number;
  /** crab: sim time of the next dig */
  digAt: number;
  /** walking over to another open stretch (crossing hidden sand on purpose) */
  trip: boolean;
}

// ---------------------------------------------------------------- bounds

export type Span = { x0: number; x1: number };

/** The tank the helpers live in: the inside of the right glass (world x) and the open-sand ranges, sorted by x. */
export interface HelperWorld {
  right: number;
  sands: readonly Span[];
}
/** The starter tank. */
export const WORLD0: HelperWorld = { right: K.glassR, sands: [OPEN_SAND] };
export const helperWorld = (right: number, sands: readonly SandRange[]): HelperWorld => ({
  right,
  sands: sands.length ? sands.map(({ x0, x1 }) => ({ x0, x1 })) : [OPEN_SAND],
});

/** The snail's shell stays inside the glass, under the surface and above the sand. */
export function snailBounds(x: number, right: number = K.glassR) {
  const hw = SNAIL_SIZE.w / 2;
  const hh = SNAIL_SIZE.h / 2;
  const x0 = K.glassL + hw + P;
  const x1 = right - hw - P;
  const cx = clamp(x, x0, x1);
  const sand = Math.min(sandAt(cx - hw), sandAt(cx), sandAt(cx + hw));
  return { x0, x1, y0: K.waterTop + hh + P, y1: sand - hh };
}

/** Anywhere along the sand inside the glass (the shrimp, fetching food; walkers crossing between open stretches). */
export const walkerBounds = (w: number, right: number = K.glassR): Span => ({ x0: K.glassL + w / 2 + P, x1: right - w / 2 - P });

/** The whole body on an open stretch of sand (default: the starter tank's), where the scenery doesn't hide it. */
export const openSandBounds = (w: number, sand: Span = OPEN_SAND): Span => ({ x0: sand.x0 + w / 2, x1: sand.x1 - w / 2 });

/** The open stretch the whole body is on, or null. */
export function sandUnder(x: number, w: number, world: HelperWorld): Span | null {
  for (const r of world.sands) {
    const b = openSandBounds(w, r);
    if (x >= b.x0 - 1e-9 && x <= b.x1 + 1e-9) return r;
  }
  return null;
}

/** The open stretch nearest x (by the distance to its walkable part). */
function nearestSand(x: number, w: number, world: HelperWorld): Span {
  let best = world.sands[0]!;
  let bestD = Infinity;
  for (const r of world.sands) {
    const b = openSandBounds(w, r);
    const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

// ---------------------------------------------------------------- snail

/** The snail counts as sitting on its goal within this distance of it. */
export const SNAIL_ON = 6;

function snailWander(h: Snail, t: number, rand: () => number, right: number): void {
  const b = snailBounds(h.x, right);
  h.tx = b.x0 + rand() * (b.x1 - b.x0);
  const yb = snailBounds(h.tx, right);
  h.ty = yb.y0 + rand() * Math.max(0, yb.y1 - yb.y0);
  // a snail is slow: give it time to get there
  h.until = t + Math.hypot(h.tx - h.x, h.ty - h.y) / SNAIL_SPEED + 20;
}

export function newSnail(rand: () => number, t = 0, world: HelperWorld = WORLD0): Snail {
  const b = snailBounds(K.glassL, world.right);
  const h: Snail = { x: b.x0 + 12, y: clamp(600, b.y0, b.y1), sx: 1, phase: 0, f: 0, tx: 0, ty: 0, until: 0, restUntil: t, wob: rand() * 10 };
  snailWander(h, t, rand, world.right);
  return h;
}

/**
 * v8: with a `goal` (the dirt spot it wants, world), the snail crawls there and sits on it, grazing
 * (slow frame changes); returns true while it's on it. Without one it wanders the glass, resting now and then.
 */
export function stepSnail(h: Snail, t: number, dt: number, rand: () => number, goal: { x: number; y: number } | null, world: HelperWorld = WORLD0): boolean {
  const right = world.right;
  if (goal) {
    const gb = snailBounds(goal.x, right);
    h.tx = clamp(goal.x, gb.x0, gb.x1);
    h.ty = clamp(goal.y, gb.y0, gb.y1);
    h.until = Infinity;
    h.restUntil = Math.min(h.restUntil, t);
  } else if (h.until === Infinity) {
    // just finished a spot: a short rest, then wander again
    h.restUntil = t + 1 + rand() * 3;
    snailWander(h, t, rand, right);
  }
  if (t < h.restUntil) {
    h.f = 0;
    return false;
  }
  const dx = h.tx - h.x;
  const dy = h.ty - h.y;
  const d = Math.hypot(dx, dy);
  if (goal && d <= SNAIL_ON) {
    // grazing: the mouth works slowly
    h.phase = (h.phase + dt / 2.4) % 1;
    h.f = Math.floor(h.phase * 2) % 2;
    return true;
  }
  if (!goal && (d < 4 || t > h.until)) {
    h.restUntil = t + 2 + rand() * 5;
    snailWander(h, t, rand, right);
    h.f = 0;
    return false;
  }
  // head for the target with a slow, gentle meander (straighter when it's after a spot)
  const heading = Math.atan2(dy, dx) + Math.sin(t * 0.45 + h.wob) * (goal ? 0.25 : 0.5);
  const v = Math.min(SNAIL_SPEED * dt, d);
  const cx = Math.cos(heading);
  h.x += cx * v;
  h.y += Math.sin(heading) * v;
  const b = snailBounds(h.x, right);
  h.x = clamp(h.x, b.x0, b.x1);
  h.y = clamp(h.y, b.y0, b.y1);
  if (Math.abs(cx) > 0.25) h.sx = cx > 0 ? 1 : -1;
  h.phase = (h.phase + dt / 1.2) % 1;
  h.f = Math.floor(h.phase * 2) % 2;
  return goal !== null && Math.hypot(h.tx - h.x, h.ty - h.y) <= SNAIL_ON;
}

// ---------------------------------------------------------------- sand walkers

/** Chance that a walker done waiting strolls over to another open stretch (when the tank has more than one). */
const CROSS_CHANCE = 0.25;

function newWalker(x: number, w: number, t: number): Walker {
  const b = openSandBounds(w);
  const cx = clamp(x, b.x0, b.x1);
  return { x: cx, y: sandAt(cx), sx: 1, phase: 0, f: 0, mode: "wait", tx: cx, waitUntil: t + 1, actLeft: 0, food: -1, digAt: Infinity, trip: false };
}

export const newShrimp = (t = 0): Walker => newWalker(300, SHRIMP_SIZE.w, t);
export function newCrab(rand: () => number, t = 0): Walker {
  const c = newWalker(450, CRAB_SIZE.w, t);
  c.digAt = t + DIG_MIN + rand() * DIG_SPREAD;
  return c;
}

/** Walk toward h.tx (clamped into `b`) at `speed`; returns true on arrival. Keeps y on the sand. */
function walk(h: Walker, b: Span, dt: number, speed: number, cycle: number): boolean {
  h.tx = clamp(h.tx, b.x0, b.x1);
  const dx = h.tx - h.x;
  const v = speed * dt;
  if (Math.abs(dx) <= v) h.x = h.tx;
  else h.x += Math.sign(dx) * v;
  h.x = clamp(h.x, b.x0, b.x1);
  h.y = sandAt(h.x);
  if (Math.abs(dx) > 0.01) h.sx = dx > 0 ? 1 : -1;
  h.phase = (h.phase + dt / cycle) % 1;
  h.f = Math.floor(h.phase * 2) % 2;
  return h.x === h.tx;
}

/**
 * Potter about the open sand: wait a little, then stroll to a nearby spot on the same stretch, or
 * now and then over to another stretch (crossing the hidden sand between). Caught off the open sand
 * otherwise (the shrimp, after a snack behind the rocks) it heads straight for the nearest stretch at `back` speed.
 */
function potter(h: Walker, w: number, t: number, dt: number, rand: () => number, speed: number, cycle: number, wait: [number, number], world: HelperWorld, back = speed): void {
  const home = sandUnder(h.x, w, world);
  const arrive = () => {
    h.mode = "wait";
    h.trip = false;
    h.waitUntil = t + wait[0] + rand() * wait[1];
    h.f = 0;
  };
  if (h.trip && h.mode === "walk") {
    if (walk(h, walkerBounds(w, world.right), dt, speed, cycle)) arrive();
    return;
  }
  h.trip = false;
  if (!home) {
    // a little way in from the edge, so it doesn't stop right at the rocks
    const b = openSandBounds(w, nearestSand(h.x, w, world));
    h.tx = h.x < b.x0 ? Math.min(b.x1, b.x0 + 24) : Math.max(b.x0, b.x1 - 24);
    h.mode = "walk";
    walk(h, walkerBounds(w, world.right), dt, back, cycle * (speed / back));
    return;
  }
  if (h.mode === "wait") {
    h.f = 0;
    h.y = sandAt(h.x);
    if (t < h.waitUntil) return;
    const others = world.sands.filter((r) => r !== home);
    if (others.length && rand() < CROSS_CHANCE) {
      const b = openSandBounds(w, others[Math.floor(rand() * others.length)] ?? home);
      h.tx = b.x0 + rand() * Math.max(0, b.x1 - b.x0);
      h.trip = true;
      h.mode = "walk";
      return;
    }
    const b = openSandBounds(w, home);
    h.tx = clamp(h.x + (rand() - 0.5) * 360, b.x0, b.x1);
    h.mode = "walk";
  }
  if (walk(h, openSandBounds(w, home), dt, speed, cycle)) arrive();
}

/** Centre x of each pellet resting on the sand (null where there is none). */
export type RestingFood = (number | null)[];

/**
 * The cleaner shrimp: potters about the open sand; goes to the nearest pellet resting on
 * the sand (anywhere along it) and eats it, then comes back. Returns the index of the pellet it just finished eating, or -1.
 */
export function stepShrimp(h: Walker, t: number, dt: number, rand: () => number, food: RestingFood, world: HelperWorld = WORLD0): number {
  const w = SHRIMP_SIZE.w;
  const b = walkerBounds(w, world.right);
  if (h.mode === "act") {
    if (h.food < 0 || food[h.food] == null) {
      // something else got it first
      h.mode = "wait";
      h.waitUntil = t + 0.5;
      h.food = -1;
      h.f = 0;
      return -1;
    }
    h.actLeft -= dt;
    h.phase = (h.phase + dt / 0.5) % 1;
    h.f = 2 + (Math.floor(h.phase * 2) % 2);
    if (h.actLeft > 0) return -1;
    const ate = h.food;
    h.food = -1;
    h.mode = "wait";
    h.waitUntil = t + 0.8 + rand() * 1.5;
    h.f = 0;
    return ate;
  }
  let best = -1;
  let bestD = Infinity;
  food.forEach((fx, i) => {
    if (fx == null) return;
    const d = Math.abs(fx - h.x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const fx = best >= 0 ? food[best] : null;
  if (fx != null) {
    const stand = clamp(fx, b.x0, b.x1);
    h.tx = stand;
    h.mode = "walk";
    h.trip = false;
    // food may lie anywhere along the sand: it nips out from the open sand to get it
    const there = walk(h, b, dt, SHRIMP_FOOD_SPEED, 0.3);
    if (there && Math.abs(fx - h.x) <= w / 2 + 6) {
      if (Math.abs(fx - h.x) > 0.01) h.sx = fx > h.x ? 1 : -1;
      h.mode = "act";
      h.food = best;
      h.actLeft = SHRIMP_EAT_TIME;
      h.phase = 0;
      h.f = 2;
    }
    return -1;
  }
  potter(h, w, t, dt, rand, SHRIMP_SPEED, 0.45, [1, 4], world, SHRIMP_FOOD_SPEED);
  return -1;
}

/**
 * The hermit crab: ambles about the open sand (only crossing the hidden sand to reach another
 * open stretch); every DIG_MIN..DIG_MIN+DIG_SPREAD seconds it stops and digs for DIG_TIME, but
 * only with its whole body on an open stretch. Returns true on the step a dig finishes.
 */
export function stepCrab(h: Walker, t: number, dt: number, rand: () => number, world: HelperWorld = WORLD0): boolean {
  const w = CRAB_SIZE.w;
  if (h.mode === "act") {
    h.y = sandAt(h.x);
    h.actLeft -= dt;
    h.phase = (h.phase + dt / 0.5) % 1;
    h.f = 2 + (Math.floor(h.phase * 2) % 2);
    if (h.actLeft > 0) return false;
    h.mode = "wait";
    h.waitUntil = t + 1.5 + rand() * 2;
    h.digAt = t + DIG_MIN + rand() * DIG_SPREAD;
    h.f = 0;
    return true;
  }
  if (t >= h.digAt && !h.trip && sandUnder(h.x, w, world)) {
    h.mode = "act";
    h.actLeft = DIG_TIME;
    h.phase = 0;
    h.f = 2;
    return false;
  }
  potter(h, w, t, dt, rand, CRAB_SPEED, 0.7, [2, 6], world);
  return false;
}
