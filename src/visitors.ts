/**
 * Visitors (v7): a sea turtle, a seahorse and a mini diver drop by every few minutes, one at a
 * time, for 30-60 s. Pure movement and timing; sim.ts owns scheduling, taps, rewards and events.
 *
 * Positions are world units (artboard px, x 0..worldW). Origins (contract.visitorOrigin):
 * turtle = middle of the shell; seahorse ("horse" in the props) = where its tail grips a kelp
 * stalk; diver = middle of the belly, on the inside of the front glass. Art faces right at sx +1.
 *
 * Seasonal visitors (VISITOR_SEASON) only come while their event is on: the Halloween bat flutters in,
 * hangs upside down from the hood's front lip (origin = its feet's grip, y = contract.batHangY), stretches
 * now and then, and flutters off. Frames: 0 hanging wrapped, 1 hanging stretching, 2-3 flying.
 */
import type { SeasonId } from "./season";
import { K, P, clamp, num } from "./species";

export const VISITORS = ["turtle", "seahorse", "diver", "bat"] as const;
export type VisitorKind = (typeof VISITORS)[number];
export const TURTLE = 0;
export const SEAHORSE = 1;
export const DIVER = 2;
export const BAT = 3;
/** The view-model prefix for each visitor: `{prefix}On X Y SX F0..F3`. */
export const VISITOR_PROP = ["turtle", "horse", "diver", "bat"] as const;
/** The event a visitor belongs to (it only comes while that is on); null = all year. */
export const VISITOR_SEASON: readonly (SeasonId | null)[] = [null, null, null, "halloween"];
/** Can visitor `k` come while `event` is on? */
export const visitsDuring = (k: number, event: SeasonId | null) => {
  const s = VISITOR_SEASON[k] ?? null;
  return s === null || s === event;
};

/** The bat's perch: the hood's front lip (world y of its feet while hanging). */
export const BAT_HANG_Y = num((K as unknown as { batHangY?: unknown }).batHangY) ?? K.waterTop;
/** Flying in and away, s; wing beats per second (flying, and when it leaves happy). */
export const BAT_FLY_IN = 3.2;
export const BAT_FLAP = 6;
export const BAT_FLAP_HAPPY = 9;
/** A stretch lasts this long, every BAT_STRETCH_GAP..+3 s while it hangs. */
export const BAT_STRETCH = 0.9;
export const BAT_STRETCH_GAP = 5;

/** Seconds between visits: 3-6 minutes. */
export const VISIT_GAP_MIN = 180;
export const VISIT_GAP_SPREAD = 180;
/** How long a visit lasts, arrival and leaving included: 30-60 s. */
export const VISIT_MIN = 30;
export const VISIT_SPREAD = 30;
/** A tap pays VISIT_PAY_MIN..VISIT_PAY_MIN + VISIT_PAY_STEPS - 1 dollars (5..10), once per visit. */
export const VISIT_PAY_MIN = 5;
export const VISIT_PAY_STEPS = 6;
/** Fade in on arrival / out when leaving, s. */
export const ARRIVE_TIME = 1.0;
export const LEAVE_TIME = 2.2;
/** After a tap the visitor stays this much longer, then leaves happily. */
export const HAPPY_STAY = 1.0;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const BOX_FALLBACK: Box[] = [
  { x0: -66, y0: -51, x1: 90, y1: 57 },
  { x0: -9, y0: -96, x1: 42, y1: 12 },
  { x0: -39, y0: -90, x1: 51, y1: 51 },
  { x0: -57, y0: 0, x1: 57, y1: 81 },
];
/** Each visitor's art extent around its origin at sx +1 (contract.visitors). */
export const VISITOR_BOX: readonly Box[] = VISITOR_PROP.map((key, i) => {
  const all = (K as unknown as { visitors?: Record<string, Record<string, unknown>> }).visitors;
  const o = all?.[key] ?? {};
  const [x0, y0, x1, y1] = [num(o.x0), num(o.y0), num(o.x1), num(o.y1)];
  return x0 !== null && y0 !== null && x1 !== null && y1 !== null && x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : BOX_FALLBACK[i]!;
});
/** The box mirrored for a visitor facing `sx`. */
export const boxFacing = (k: number, sx: 1 | -1): Box => {
  const b = VISITOR_BOX[k]!;
  return sx > 0 ? b : { x0: -b.x1, y0: b.y0, x1: -b.x0, y1: b.y1 };
};

export interface Grip {
  x: number;
  y: number;
  /** -1: it hangs to the left of the stalk and faces left; +1 right */
  side: 1 | -1;
  tier: number;
}
/** Kelp stalks a seahorse can hold (contract.kelpGrips), world units. */
export const KELP_GRIPS: readonly Grip[] = (() => {
  const raw = (K as unknown as { kelpGrips?: unknown }).kelpGrips;
  const out: Grip[] = [];
  if (Array.isArray(raw))
    for (const g of raw) {
      const o = (g ?? {}) as Record<string, unknown>;
      const x = num(o.x);
      const y = num(o.y);
      if (x === null || y === null) continue;
      out.push({ x, y, side: num(o.side) === -1 ? -1 : 1, tier: num(o.tier) ?? 0 });
    }
  return out.length ? out : [{ x: 246, y: 948, side: -1, tier: 0 }];
})();

/** The stretch of world the visitor must stay inside: the view, within the glass. */
export interface Stretch {
  x0: number;
  x1: number;
}

export interface Visit {
  kind: number;
  /** seconds on stage (frozen while the shop is up) */
  age: number;
  /** when it starts to leave (age), and when it's gone (leaveAt + LEAVE_TIME) */
  leaveAt: number;
  x: number;
  y: number;
  sx: 1 | -1;
  /** 0..1 visibility (opacity) */
  on: number;
  /** current frame 0..3 and the cycle phase 0..1 that drives it */
  f: number;
  phase: number;
  /** paid out (tapped once already) / leaving happily after a tap */
  paid: boolean;
  happy: boolean;
  /** the stretch it keeps to */
  lo: number;
  hi: number;
  /** turtle: speed along x and base depth; seahorse: the grip; diver: the work spot */
  vx: number;
  baseY: number;
  gx: number;
  gy: number;
  /** seahorse arrival / diver move: from (fx, fy) over [t0, t0 + dur] */
  fx: number;
  fy: number;
  t0: number;
  dur: number;
  /** diver: when it shifts to a new spot, and the band of glass it keeps to */
  nextMove: number;
  ylo: number;
  yhi: number;
}

const smooth = (t: number) => {
  const u = clamp(t);
  return u * u * (3 - 2 * u);
};

/** x range for an origin such that the whole box stays inside [st.x0, st.x1] with a margin. */
function xRange(k: number, sx: 1 | -1, st: Stretch, margin: number): [number, number] | null {
  const b = boxFacing(k, sx);
  const lo = st.x0 - b.x0 + margin;
  const hi = st.x1 - b.x1 - margin;
  return hi >= lo ? [lo, hi] : null;
}
/** y range so the whole box stays in the water (above `bottom`). */
function yRange(k: number, bottom: number): [number, number] {
  const b = VISITOR_BOX[k]!;
  const lo = K.waterTop - b.y0 + 6 * P;
  return [lo, Math.max(lo, bottom - b.y1)];
}

function base(kind: number, dur: number): Visit {
  return {
    kind,
    age: 0,
    leaveAt: Math.max(ARRIVE_TIME + 1, dur - LEAVE_TIME),
    x: 0,
    y: 0,
    sx: 1,
    on: 0,
    f: 0,
    phase: 0,
    paid: false,
    happy: false,
    lo: 0,
    hi: 0,
    vx: 0,
    baseY: 0,
    gx: 0,
    gy: 0,
    fx: 0,
    fy: 0,
    t0: 0,
    dur: 0,
    nextMove: 0,
    ylo: 0,
    yhi: 0,
  };
}

/**
 * A new visit of `kind` somewhere on stage (the view, inside the glass); null when it can't fit
 * (no kelp the seahorse can reach in view). `tier` gates the kelp grips.
 */
export function planVisit(kind: number, st: Stretch, tier: number, rand: () => number): Visit | null {
  const v = base(kind, VISIT_MIN + rand() * VISIT_SPREAD);
  const total = v.leaveAt + LEAVE_TIME;
  if (kind === TURTLE) {
    v.sx = rand() < 0.5 ? 1 : -1;
    const r = xRange(TURTLE, v.sx, st, 4 * P);
    if (!r) return null;
    [v.lo, v.hi] = r;
    v.x = v.sx > 0 ? v.lo : v.hi;
    v.vx = (v.sx * (v.hi - v.lo)) / total;
    const [y0, y1] = yRange(TURTLE, 650);
    v.baseY = clamp(390 + rand() * 210, y0 + 15, y1 - 15);
    v.y = v.baseY;
    return v;
  }
  if (kind === SEAHORSE) {
    const ok = KELP_GRIPS.filter((g) => {
      if (g.tier > tier) return false;
      const b = boxFacing(SEAHORSE, g.side);
      return g.x + b.x0 >= st.x0 + 2 * P && g.x + b.x1 <= st.x1 - 2 * P;
    });
    if (!ok.length) return null;
    const g = ok[Math.floor(rand() * ok.length) % ok.length]!;
    v.sx = g.side;
    v.gx = g.x;
    v.gy = g.y;
    // it drifts in from above, from the side with more room
    const toward = st.x0 + st.x1 > 2 * g.x ? 1 : -1;
    const [ylo] = yRange(SEAHORSE, g.y);
    v.fx = g.x + toward * 13 * P;
    v.fy = Math.max(ylo, g.y - 40 * P);
    v.ylo = ylo;
    const r = xRange(SEAHORSE, v.sx, st, 0);
    v.lo = r ? Math.min(r[0], g.x) : g.x;
    v.hi = r ? Math.max(r[1], g.x) : g.x;
    v.fx = clamp(v.fx, v.lo, v.hi);
    v.t0 = 0;
    v.dur = 3.5;
    v.x = v.fx;
    v.y = v.fy;
    return v;
  }
  if (kind === BAT) {
    const rb = [xRange(BAT, 1, st, 2 * P), xRange(BAT, -1, st, 2 * P)];
    if (!rb[0] || !rb[1]) return null;
    v.lo = Math.max(rb[0][0], rb[1][0]);
    v.hi = Math.min(rb[0][1], rb[1][1]);
    if (v.hi < v.lo) return null;
    // the perch keeps clear of the settings gear at the screen's top right
    v.gx = v.lo + rand() * Math.max(0, v.hi - 40 * P - v.lo);
    v.gy = BAT_HANG_Y;
    // it flutters in from the side with more room, and leaves the other way
    const from = v.gx - v.lo > v.hi - v.gx ? -1 : 1;
    v.fx = clamp(v.gx + from * (240 + rand() * 120), v.lo, v.hi);
    v.fy = BAT_HANG_Y + 150 + rand() * 120;
    v.vx = clamp(v.gx - from * (260 + rand() * 120), v.lo, v.hi);
    v.baseY = BAT_HANG_Y + 140 + rand() * 100;
    v.sx = v.gx >= v.fx ? 1 : -1;
    v.t0 = 0;
    v.dur = BAT_FLY_IN;
    v.nextMove = BAT_FLY_IN + 2 + rand() * 3;
    v.ylo = Number.NaN; // where it lets go from (set when it starts to leave)
    v.yhi = Number.NaN;
    v.x = v.fx;
    v.y = v.fy;
    return v;
  }
  // diver: on the glass in view, mid water
  const r = [xRange(DIVER, 1, st, 4 * P), xRange(DIVER, -1, st, 4 * P)];
  if (!r[0] || !r[1]) return null;
  v.lo = Math.max(r[0][0], r[1][0]);
  v.hi = Math.min(r[0][1], r[1][1]);
  if (v.hi < v.lo) return null;
  const [ylo, yhi] = yRange(DIVER, 860);
  v.sx = rand() < 0.5 ? 1 : -1;
  v.gx = v.lo + rand() * (v.hi - v.lo);
  v.gy = ylo + 40 + rand() * Math.max(0, Math.min(yhi, 760) - ylo - 40);
  v.fx = v.gx;
  v.fy = Math.max(ylo, v.gy - 50 * P);
  v.t0 = 0;
  v.dur = 2.2;
  v.x = v.fx;
  v.y = v.fy;
  v.nextMove = 5 + rand() * 3;
  v.ylo = ylo;
  v.yhi = Math.min(yhi, 760);
  return v;
}

/** Is it working (arrived and not leaving)? The diver only cleans then. */
export const settled = (v: Visit) => v.age >= ARRIVE_TIME && v.age < v.leaveAt;
/** Gone: the visit is over. */
export const visitOver = (v: Visit) => v.age >= v.leaveAt + LEAVE_TIME;

/** A tap: stay a moment, then leave early, happily. */
export function cheer(v: Visit): void {
  v.happy = true;
  v.leaveAt = Math.max(Math.min(v.leaveAt, v.age + HAPPY_STAY), Math.min(v.age, v.leaveAt));
}

/**
 * Advance a visit by dt. v8: `aim` (world, for the diver's origin) is a patch of dirty glass it would like
 * to work on: when it next shifts spot it goes there (within its stretch) instead of somewhere random.
 */
export function stepVisit(v: Visit, dt: number, rand: () => number, aim: { x: number; y: number } | null = null): void {
  v.age += dt;
  const a = v.age;
  const leaving = a >= v.leaveAt;
  const lp = clamp((a - v.leaveAt) / LEAVE_TIME);
  v.on = leaving ? 1 - lp : clamp(a / ARRIVE_TIME);
  if (v.kind === TURTLE) {
    // a stroke every ~2.4 s (twice as quick when it's happy); it surges on the downstroke
    const period = v.happy ? 1.1 : 2.4;
    v.phase = (v.phase + dt / period) % 1;
    const surge = 1 + 0.6 * Math.sin(2 * Math.PI * (v.phase - 0.1));
    v.x = clamp(v.x + v.vx * (v.happy ? 2.2 : 1) * surge * dt, v.lo, v.hi);
    if (v.happy) v.baseY = Math.max(yRange(TURTLE, 650)[0] + 15, v.baseY - 18 * dt);
    v.y = v.baseY + 12 * Math.sin((a * 2 * Math.PI) / 7);
    v.f = Math.floor(v.phase * 4) % 4;
  } else if (v.kind === SEAHORSE) {
    v.phase = (v.phase + dt / (v.happy ? 0.6 : 1.6)) % 1;
    v.f = Math.floor(v.phase * 4) % 4;
    if (!leaving) {
      const p = 1 - (1 - clamp(a / v.dur)) ** 3;
      v.x = v.fx + (v.gx - v.fx) * p;
      v.y = v.fy + (v.gy - v.fy) * p;
    } else {
      // lets go and drifts up and away
      const e = lp * lp;
      v.x = clamp(v.gx + (v.fx - v.gx) * e, v.lo, v.hi);
      v.y = Math.max(Math.min(v.ylo, v.gy), v.gy - 45 * P * e);
    }
  } else if (v.kind === BAT) {
    stepBat(v, dt, rand, leaving, lp);
  } else {
    v.phase = (v.phase + dt / (v.happy ? 0.5 : 1.0)) % 1;
    v.f = Math.floor(v.phase * 4) % 4;
    if (!leaving) {
      if (a >= v.nextMove && a + 2 < v.leaveAt) {
        // shift to a new patch of glass nearby
        v.fx = v.x;
        v.fy = v.y;
        v.gx = clamp(aim ? aim.x : v.x + (rand() - 0.5) * 300, v.lo, v.hi);
        v.gy = clamp(aim ? aim.y : v.y + (rand() - 0.5) * 240, v.ylo + 40, Math.max(v.ylo + 40, v.yhi));
        v.t0 = a;
        v.dur = 1.6;
        v.nextMove = a + 5 + rand() * 3;
        if (rand() < 0.5) v.sx = v.sx > 0 ? -1 : 1;
      }
      const p = smooth((a - v.t0) / v.dur);
      v.x = v.fx + (v.gx - v.fx) * p;
      v.y = v.fy + (v.gy - v.fy) * p;
    } else {
      // swims up and off the glass
      v.x = v.gx;
      v.y = Math.max(v.ylo, v.gy - 40 * P * lp * lp);
    }
  }
}

/**
 * The bat: flutters in (wing beats bob it along an eased path up to the perch), hangs (wrapped, with a stretch
 * every few seconds; a tap makes it stretch until it goes), then lets go and flutters off sideways and down.
 * For the bat, (fx, fy) is where it flies in from, (gx, gy) the perch, (vx, baseY) where it leaves for, and
 * (ylo, yhi) where it let go from.
 */
function stepBat(v: Visit, dt: number, rand: () => number, leaving: boolean, lp: number): void {
  const a = v.age;
  const flap = v.happy ? BAT_FLAP_HAPPY : BAT_FLAP;
  const wing = () => {
    v.phase = (v.phase + dt * flap) % 1;
    v.f = v.phase < 0.5 ? 2 : 3;
  };
  if (!leaving && a < v.dur) {
    wing();
    const p = smooth(a / v.dur);
    const rise = 1 - (1 - clamp(a / v.dur)) ** 2;
    v.x = v.fx + (v.gx - v.fx) * p;
    v.y = Math.max(BAT_HANG_Y, v.fy + (v.gy - v.fy) * rise + 9 * Math.sin(v.phase * 2 * Math.PI) * (1 - p));
    v.sx = v.gx >= v.fx ? 1 : -1;
    return;
  }
  if (!leaving) {
    v.x = v.gx;
    v.y = v.gy;
    if (a >= v.nextMove + BAT_STRETCH) v.nextMove = a + BAT_STRETCH_GAP + rand() * 3;
    v.f = v.happy || a >= v.nextMove ? 1 : 0;
    return;
  }
  if (Number.isNaN(v.ylo)) {
    v.ylo = v.x;
    v.yhi = v.y;
  }
  wing();
  const e = smooth(lp);
  v.x = clamp(v.ylo + (v.vx - v.ylo) * e, v.lo, v.hi);
  v.y = Math.max(BAT_HANG_Y, v.yhi + (v.baseY - v.yhi) * Math.sin((e * Math.PI) / 2) + 8 * Math.sin(v.phase * 2 * Math.PI) * e);
  v.sx = v.vx >= v.ylo ? 1 : -1;
}

/** Is world (x, y) on the visitor (its box, a finger's width more)? Only while it can be seen. */
export function visitorHit(v: Visit, x: number, y: number): boolean {
  if (v.on < 0.25) return false;
  const b = boxFacing(v.kind, v.sx);
  const pad = 4 * P;
  return x >= v.x + b.x0 - pad && x <= v.x + b.x1 + pad && y >= v.y + b.y0 - pad && y <= v.y + b.y1 + pad;
}

/** The middle of the visitor's art, for the sparkle and the "+N". */
export function visitorCentre(v: Visit): { x: number; y: number } {
  const b = boxFacing(v.kind, v.sx);
  return { x: v.x + (b.x0 + b.x1) / 2, y: v.y + (b.y0 + b.y1) / 2 };
}
