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
 * Winter's penguin zips in from one side, stops to look around (upright, bobbing, a flipper flap now and then),
 * darts to another spot or two, and zips off the other way. Greeted, it flaps happily, then zips off.
 * Origin = the middle of its body. Frames: 0 gliding, 1 a flipper stroke (both side-on, swimming), 2 upright,
 * 3 upright with its flippers out (a flap). Reduced motion: slower dashes, and a greeting holds the flap.
 *
 * v14 night visitors (VISITOR_NIGHT) only come while night is showing, now and then in place of a day visitor
 * (NIGHT_VISIT_CHANCE), and leave when the light comes on:
 *   octopus  peeks over a reef rock (contract.octoSpots; drawn over the Night layer, clipped along the rock's
 *            edge), shifts between red and rock-grey camouflage, reaches an arm toward a jelly (a quick tip flick,
 *            not with reduced motion), flushes pale when greeted, and slips back down. Origin = the spot on the
 *            rock's edge; `dy` = how far below it. Frames: 0 rest, 1 breathe, 2 reach, 3 reach flicked.
 *   manta    a big soft shadow gliding through the far upper water, in the Far parallax group: `gx` is its
 *            far-layer x, and `x` (world, for taps) follows the camera: x = gx - camX * (1 - parallax.Far).
 *            Frames 0-3: a slow wing beat. Greeted, it eases a little faster (not with reduced motion).
 *   hermit   a hermit crab. With the dive helmet owned and in view it walks over, slips inside and peeks out of
 *            the front port (contract.hermitHome); otherwise it wanders along the sand. Frames 0-1 walk (origin
 *            bottom-centre on the sand), 2-3 peek (origin the port's centre: the hermitPeek box).
 */
import type { SeasonId } from "./season";
import { K, P, clamp, num } from "./species";

export const VISITORS = ["turtle", "seahorse", "diver", "bat", "octopus", "manta", "hermit", "penguin"] as const;
export type VisitorKind = (typeof VISITORS)[number];
export const TURTLE = 0;
export const SEAHORSE = 1;
export const DIVER = 2;
export const BAT = 3;
export const OCTOPUS = 4;
export const MANTA = 5;
export const HERMIT = 6;
export const PENGUIN = 7;
/** The view-model prefix for each visitor: `{prefix}On X Y SX F0..F3` (v14: see writeVisitors in sim.ts for the octopus). */
export const VISITOR_PROP = ["turtle", "horse", "diver", "bat", "octo", "manta", "hermit", "penguin"] as const;
/** The event a visitor belongs to (it only comes while that is on); null = all year. */
export const VISITOR_SEASON: readonly (SeasonId | null)[] = [null, null, null, "halloween", null, null, null, "winter"];
/** v14: night visitors only come while night is showing. */
export const VISITOR_NIGHT: readonly boolean[] = [false, false, false, false, true, true, true, false];
/** v14: what to call each visitor out loud and in the visitor log. */
export const VISITOR_NAMES = ["sea turtle", "seahorse", "mini diver", "bat", "octopus", "manta ray", "hermit crab", "penguin"] as const;
/** v14: at night, the chance that the next visit is a night visitor's. */
export const NIGHT_VISIT_CHANCE = 0.35;
/** v14: is visitor `k` one of the night ones? */
export const nightVisitor = (k: number) => VISITOR_NIGHT[k] === true;
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

/** The penguin: a dash's top speed (px/s; slower with reduced motion), how long it looks around between dashes. */
export const PENGUIN_ZIP = 900;
export const PENGUIN_ZIP_CALM = 360;
export const PENGUIN_LOOK = 5;
export const PENGUIN_LOOK_SPREAD = 3;
/** Flipper strokes per second while it dashes, and its happy flaps when greeted. */
export const PENGUIN_STROKE = 5;
export const PENGUIN_FLAP_HAPPY = 7;

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
  { x0: -45, y0: -63, x1: 72, y1: 9 },
  { x0: -102, y0: -69, x1: 48, y1: 69 },
  { x0: -27, y0: -39, x1: 39, y1: 6 },
  { x0: -36, y0: -33, x1: 39, y1: 33 },
];
/** Each visitor's art extent around its origin at sx +1 (contract.visitors). */
export const VISITOR_BOX: readonly Box[] = VISITOR_PROP.map((key, i) => {
  const all = (K as unknown as { visitors?: Record<string, Record<string, unknown>> }).visitors;
  const o = all?.[key] ?? {};
  const [x0, y0, x1, y1] = [num(o.x0), num(o.y0), num(o.x1), num(o.y1)];
  return x0 !== null && y0 !== null && x1 !== null && y1 !== null && x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : BOX_FALLBACK[i]!;
});
const mirror = (b: Box, sx: 1 | -1): Box => (sx > 0 ? b : { x0: -b.x1, y0: b.y0, x1: -b.x0, y1: b.y1 });
/** The box mirrored for a visitor facing `sx`. */
export const boxFacing = (k: number, sx: 1 | -1): Box => mirror(VISITOR_BOX[k]!, sx);

// ---------------------------------------------------------------- v14: the night visitors' places (contract)

const C = K as unknown as {
  visitors?: Record<string, Record<string, unknown>>;
  octoSpots?: unknown;
  hermitHome?: Record<string, unknown>;
  mantaBand?: Record<string, unknown>;
  parallax?: Record<string, unknown>;
};
/** The hermit crab peeking out of the helmet's port (frames 2-3): its box around the port's centre. */
export const HERMIT_PEEK_BOX: Box = (() => {
  const o = C.visitors?.hermitPeek ?? {};
  const [x0, y0, x1, y1] = [num(o.x0), num(o.y0), num(o.x1), num(o.y1)];
  return x0 !== null && y0 !== null && x1 !== null && y1 !== null ? { x0, y0, x1, y1 } : { x0: -6, y0: -15, x1: 24, y1: 18 };
})();
/** The box of a visit as it is drawn now (the hermit's peek frames sit round the port, not on the sand). */
export const boxOf = (v: Pick<Visit, "kind" | "sx" | "f">): Box => (v.kind === HERMIT && v.f >= 2 ? mirror(HERMIT_PEEK_BOX, v.sx) : boxFacing(v.kind, v.sx));

export interface OctoSpot {
  x: number;
  y: number;
  tier: number;
  /** how far below its spot it starts and slips back to (hidden by the rock) */
  rise: number;
}
/** Where the octopus can peek over a reef rock (world): one node per spot in the .riv (octoS{i}). */
export const OCTO_SPOTS: readonly OctoSpot[] = (() => {
  const out: OctoSpot[] = [];
  if (Array.isArray(C.octoSpots))
    for (const v of C.octoSpots) {
      const o = (v ?? {}) as Record<string, unknown>;
      const x = num(o.x);
      const y = num(o.y);
      if (x !== null && y !== null) out.push({ x, y, tier: num(o.tier) ?? 0, rise: num(o.rise) ?? 45 });
    }
  return out.length ? out : [{ x: 87, y: 945, tier: 0, rise: 45 }];
})();
/** The decoration the hermit crab moves into (the dive helmet) and its port's centre from that decoration's base. */
export const HERMIT_HOME = { decor: num(C.hermitHome?.decor) ?? 2, dx: num(C.hermitHome?.dx) ?? -6, dy: num(C.hermitHome?.dy) ?? -33 };
/** The manta's band of far upper water (y), and the Far layer's parallax. */
export const MANTA_BAND = { y0: num(C.mantaBand?.y0) ?? 78, y1: num(C.mantaBand?.y1) ?? 186 };
export const FAR_PARALLAX = num(C.parallax?.Far) ?? 0.35;
/** The world x of a far-layer x with the camera at camX (≤ 0). */
export const farToWorld = (fx: number, camX: number) => fx - camX * (1 - FAR_PARALLAX);

/** The octopus: rising to its first peek (eyes only), up the rest of the way, a breath, a reach, its colours. */
export const OCTO_PEEK = 0.45; // the first peek: this much of the rise still below the edge
export const OCTO_REACH = 2.6; // a reach lasts this long, s
export const OCTO_REACH_NEAR = 360; // it reaches for a jelly this close (world px)
export const OCTO_CAMO_PERIOD = 9; // red -> rock-grey -> red, s
/** The hermit crab's walking speed (px/s), and how long it takes to slip inside the helmet and look out. */
export const HERMIT_SPEED = 24;
export const HERMIT_SLIP = 0.6;
/** The manta: a visit is shorter than the others' (one glide across), 16-24 s. */
export const MANTA_MIN = 16;
export const MANTA_SPREAD = 8;

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
  /** v14: the camera's x offset (camX, ≤ 0), for the manta's parallax; 0 when left out */
  cam?: number;
}

/** v14: what else a night visitor plans with: the dive helmet's base point (world) if the hermit crab could move in. */
export interface PlanContext {
  home?: { x: number; y: number } | null;
}

/** v14: what else a step needs: reduced motion, the camera (the manta), where the helmet is now (the hermit). */
export interface StepContext {
  reduced?: boolean;
  cam?: number;
  home?: { x: number; y: number } | null;
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
  /** v14 octopus: its spot (OCTO_SPOTS), how far below it, its colours (camouflage, pale) 0..1 */
  spot: number;
  dy: number;
  c1: number;
  c2: number;
  /** v14 hermit: its own fade (slipping into the helmet and looking out), and whether it's going there */
  vis: number;
  home: boolean;
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
    spot: -1,
    dy: 0,
    c1: 0,
    c2: 0,
    vis: 1,
    home: false,
  };
}

/**
 * A new visit of `kind` somewhere on stage (the view, inside the glass); null when it can't fit
 * (no kelp the seahorse can reach in view). `tier` gates the kelp grips.
 */
export function planVisit(kind: number, st: Stretch, tier: number, rand: () => number, ctx: PlanContext = {}): Visit | null {
  if (nightVisitor(kind)) return planNight(kind, st, tier, rand, ctx);
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
  if (kind === PENGUIN) return planPenguin(v, st, rand);
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
export function stepVisit(v: Visit, dt: number, rand: () => number, aim: { x: number; y: number } | null = null, ctx: StepContext = {}): void {
  v.age += dt;
  const a = v.age;
  const leaving = a >= v.leaveAt;
  const lp = clamp((a - v.leaveAt) / LEAVE_TIME);
  v.on = leaving ? 1 - lp : clamp(a / ARRIVE_TIME);
  if (v.kind === OCTOPUS) stepOctopus(v, dt, rand, aim, ctx, leaving, lp);
  else if (v.kind === MANTA) stepManta(v, dt, ctx, leaving);
  else if (v.kind === HERMIT) stepHermit(v, dt, rand, ctx, leaving);
  else if (v.kind === TURTLE) {
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
  } else if (v.kind === PENGUIN) {
    stepPenguin(v, dt, rand, leaving, lp, ctx.reduced === true);
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

// ---------------------------------------------------------------- winter: the penguin

/**
 * The penguin's plan. (fx, fy) -> (gx, gy) is the dash it's on (from t0, `dur` long), (lo, hi) x and (ylo, yhi) y
 * the water it keeps to, nextMove when it next dashes; `vx` is where it zips off to (an x past the far edge of its
 * stretch, so it leaves the other way from where it came) and (c1, c2) where it started to leave from.
 */
function planPenguin(v: Visit, st: Stretch, rand: () => number): Visit | null {
  const r = [xRange(PENGUIN, 1, st, 4 * P), xRange(PENGUIN, -1, st, 4 * P)];
  if (!r[0] || !r[1]) return null;
  v.lo = Math.max(r[0][0], r[1][0]);
  v.hi = Math.min(r[0][1], r[1][1]);
  if (v.hi < v.lo) return null;
  // mid water, clear of the hood and the sand
  const [ylo, yhi] = yRange(PENGUIN, 800);
  v.ylo = ylo + 30;
  v.yhi = Math.max(v.ylo, Math.min(yhi, 720));
  // in from one side, past the edge, to a spot a third of the way in
  const from: 1 | -1 = rand() < 0.5 ? -1 : 1;
  v.sx = from < 0 ? 1 : -1;
  const span = v.hi - v.lo;
  v.fx = from < 0 ? v.lo - 60 * P : v.hi + 60 * P;
  v.gx = from < 0 ? v.lo + span * (0.2 + rand() * 0.25) : v.hi - span * (0.2 + rand() * 0.25);
  v.fy = v.ylo + rand() * (v.yhi - v.ylo);
  v.gy = v.ylo + rand() * (v.yhi - v.ylo);
  v.t0 = 0;
  v.dur = 0; // set on the first step (its length depends on reduced motion)
  v.nextMove = Infinity;
  v.vx = from < 0 ? v.hi + 80 * P : v.lo - 80 * P; // and out the other side
  v.c1 = Number.NaN; // where it starts to leave from (set then)
  v.x = v.fx;
  v.y = v.fy;
  return v;
}

/** How long a dash of `d` px takes: quick and eased (a penguin's burst), slower with reduced motion. */
const dashTime = (d: number, reduced: boolean) => Math.max(0.6, Math.abs(d) / (reduced ? PENGUIN_ZIP_CALM : PENGUIN_ZIP) * 1.8);

function stepPenguin(v: Visit, dt: number, rand: () => number, leaving: boolean, lp: number, reduced: boolean): void {
  const a = v.age;
  if (v.dur === 0) v.dur = dashTime(Math.hypot(v.gx - v.fx, v.gy - v.fy), reduced);
  const stroke = () => {
    v.phase = (v.phase + dt * PENGUIN_STROKE) % 1;
    v.f = v.phase < 0.5 ? 1 : 0;
  };
  if (leaving) {
    // zips off from where it was when it started to leave (c1, c2), out past the far edge, fading as it goes
    if (Number.isNaN(v.c1)) {
      v.c1 = v.x;
      v.c2 = v.y;
      v.sx = v.vx >= v.x ? 1 : -1;
    }
    stroke();
    const e = smooth(lp) * (reduced ? 0.6 : 1);
    v.x = v.c1 + (v.vx - v.c1) * e;
    v.y = v.c2 + (Math.max(v.ylo, v.c2 - 50 * P) - v.c2) * Math.sin((e * Math.PI) / 2);
    return;
  }
  const r = a - v.t0;
  if (r < v.dur) {
    // dashing: strokes for the first half, then a glide as it slows; a little porpoising arc on the way
    const u = r / v.dur;
    const p = 1 - (1 - u) ** 3;
    v.x = v.fx + (v.gx - v.fx) * p;
    v.y = v.fy + (v.gy - v.fy) * p - Math.sin(Math.PI * p) * Math.min(60, Math.abs(v.gx - v.fx) * 0.12);
    v.sx = v.gx >= v.fx ? 1 : -1;
    if (u < 0.55) stroke();
    else v.f = 0;
    return;
  }
  if (v.nextMove === Infinity) v.nextMove = a + PENGUIN_LOOK + rand() * PENGUIN_LOOK_SPREAD;
  // looking around: upright and bobbing, a flipper flap every few seconds (greeted: flapping away until it goes)
  v.x = v.gx;
  v.y = v.gy + 4 * Math.sin((a * 2 * Math.PI) / 2.2) * (reduced ? 0.5 : 1);
  if (v.happy) {
    if (reduced) v.f = 3;
    else {
      v.phase = (v.phase + dt * PENGUIN_FLAP_HAPPY) % 1;
      v.f = v.phase < 0.5 ? 3 : 2;
    }
    return;
  }
  v.f = !reduced && a % 3.1 < 0.35 ? 3 : 2;
  if (a >= v.nextMove && a + 4 < v.leaveAt) {
    // a dart to another spot nearby (turning to face that way)
    v.fx = v.x;
    v.fy = v.y;
    const reach = (v.hi - v.lo) * (0.25 + rand() * 0.35);
    let gx = v.x + (rand() < 0.5 ? -1 : 1) * reach;
    if (gx < v.lo || gx > v.hi) gx = 2 * v.x - gx;
    v.gx = clamp(gx, v.lo, v.hi);
    v.gy = v.ylo + rand() * (v.yhi - v.ylo);
    v.t0 = a;
    v.dur = dashTime(Math.hypot(v.gx - v.fx, v.gy - v.fy), reduced);
    v.nextMove = Infinity;
    v.phase = 0;
  }
}

/** Is world (x, y) on the visitor (its box, a finger's width more)? Only while it can be seen. */
export function visitorHit(v: Visit, x: number, y: number): boolean {
  if (v.on * v.vis < 0.25) return false;
  const b = boxOf(v);
  const pad = 4 * P;
  return x >= v.x + b.x0 - pad && x <= v.x + b.x1 + pad && y >= v.y + b.y0 - pad && y <= v.y + b.y1 + pad;
}

/** The middle of the visitor's art, for the sparkle and the "+N". */
export function visitorCentre(v: Visit): { x: number; y: number } {
  const b = boxOf(v);
  return { x: v.x + (b.x0 + b.x1) / 2, y: v.y + (b.y0 + b.y1) / 2 };
}

// ---------------------------------------------------------------- v14: night visitors

/** Does the octopus at spot `sp`, facing `sx`, fit inside [lo, hi]? */
const octoFits = (sp: OctoSpot, sx: 1 | -1, lo: number, hi: number) => {
  const b = boxFacing(OCTOPUS, sx);
  return sp.x + b.x0 >= lo && sp.x + b.x1 <= hi;
};
/** The sand the hermit crab walks on (its origin's y). */
const sandWalkY = () => K.waterBot - 2 * P;

function planNight(kind: number, st: Stretch, tier: number, rand: () => number, ctx: PlanContext): Visit | null {
  if (kind === OCTOPUS) {
    const v = base(kind, VISIT_MIN + rand() * VISIT_SPREAD);
    const ok = OCTO_SPOTS.flatMap((sp, i) => (sp.tier <= tier && (octoFits(sp, 1, st.x0, st.x1) || octoFits(sp, -1, st.x0, st.x1)) ? [i] : []));
    if (!ok.length) return null;
    v.spot = ok[Math.floor(rand() * ok.length) % ok.length]!;
    const sp = OCTO_SPOTS[v.spot]!;
    // it faces the middle of the view, if it fits that way round
    const toward: 1 | -1 = st.x0 + st.x1 >= 2 * sp.x ? 1 : -1;
    v.sx = octoFits(sp, toward, st.x0, st.x1) ? toward : toward > 0 ? -1 : 1;
    v.lo = st.x0;
    v.hi = st.x1;
    v.x = sp.x;
    v.dy = sp.rise;
    v.y = sp.y + v.dy;
    v.t0 = -1; // no reach yet
    v.nextMove = 6 + rand() * 3;
    v.ylo = Number.NaN; // how far down it was when it started to leave
    return v;
  }
  if (kind === MANTA) {
    const v = base(kind, MANTA_MIN + rand() * MANTA_SPREAD);
    const total = v.leaveAt + LEAVE_TIME;
    v.sx = rand() < 0.5 ? 1 : -1;
    const r = xRange(MANTA, v.sx, st, 2 * P);
    if (!r) return null;
    // the stretch in far-layer x (the Far group lags the camera)
    const shift = farToWorld(0, st.cam ?? 0);
    v.lo = r[0] - shift;
    v.hi = r[1] - shift;
    v.gx = v.sx > 0 ? v.lo : v.hi;
    v.vx = (v.sx * (v.hi - v.lo)) / total;
    const b = VISITOR_BOX[MANTA]!;
    const ylo = Math.max(MANTA_BAND.y0, K.waterTop - b.y0 + 4 * P);
    v.baseY = ylo + rand() * Math.max(0, MANTA_BAND.y1 - ylo);
    v.dur = 1; // the manta keeps its speed-up here (eased toward 1.6 once greeted; 1 = none)
    v.phase = rand();
    v.x = farToWorld(v.gx, st.cam ?? 0);
    v.y = v.baseY;
    return v;
  }
  // the hermit crab
  const v = base(kind, VISIT_MIN + rand() * VISIT_SPREAD * 0.5);
  v.y = v.ylo = sandWalkY();
  const home = ctx.home ?? null;
  if (home) {
    const port = { x: home.x + HERMIT_HOME.dx, y: home.y + HERMIT_HOME.dy };
    const portIn = [1, -1].every((sx) => {
      const b = mirror(HERMIT_PEEK_BOX, sx as 1 | -1);
      return port.x + b.x0 >= st.x0 && port.x + b.x1 <= st.x1;
    });
    // it walks toward the helmet from the side with more room, facing it
    const from: 1 | -1 = home.x - st.x0 > st.x1 - home.x ? -1 : 1;
    v.sx = from > 0 ? -1 : 1;
    const r = xRange(HERMIT, v.sx, st, 2 * P);
    if (portIn && r) {
      v.home = true;
      v.gx = port.x;
      v.gy = port.y;
      v.lo = r[0];
      v.hi = r[1];
      v.fx = clamp(home.x + from * (90 + rand() * 90), v.lo, v.hi);
      v.x = v.fx;
      v.t0 = -1; // when it got to the helmet
      v.nextMove = 0;
      return v;
    }
  }
  // no helmet (or not in view): it wanders along the sand, pausing now and then
  v.sx = rand() < 0.5 ? 1 : -1;
  const r = xRange(HERMIT, v.sx, st, 2 * P);
  if (!r) return null;
  [v.lo, v.hi] = r;
  v.x = v.sx > 0 ? v.lo + rand() * (v.hi - v.lo) * 0.3 : v.hi - rand() * (v.hi - v.lo) * 0.3;
  v.vx = v.sx * HERMIT_SPEED;
  v.t0 = -Infinity; // when its last pause began
  v.nextMove = 3 + rand() * 3;
  return v;
}

/** The octopus: rises to a first peek, then the rest of the way; breathes, changes colour, reaches; slips down. */
function stepOctopus(v: Visit, dt: number, rand: () => number, aim: { x: number; y: number } | null, ctx: StepContext, leaving: boolean, lp: number): void {
  const sp = OCTO_SPOTS[v.spot] ?? OCTO_SPOTS[0]!;
  const a = v.age;
  if (!leaving) {
    const first = smooth(a / 2.4);
    const rest = smooth((a - 3.4) / 1.2);
    v.dy = sp.rise * (1 - (1 - OCTO_PEEK) * first - OCTO_PEEK * rest);
  } else {
    if (Number.isNaN(v.ylo)) v.ylo = v.dy;
    v.dy = v.ylo + (sp.rise - v.ylo) * smooth(lp * 1.3);
  }
  v.x = sp.x;
  v.y = sp.y + v.dy;
  // colours: drifting between red and the rock's grey; a greeting flushes it pale
  const camo = 0.5 - 0.5 * Math.cos((2 * Math.PI * Math.max(0, a - 3)) / OCTO_CAMO_PERIOD);
  v.c2 = v.happy ? Math.min(1, v.c2 + dt / 0.4) : Math.max(0, v.c2 - dt / 0.8);
  v.c1 = v.happy ? Math.max(0, v.c1 - dt / 0.4) : camo;
  // a breath every 1.6 s
  v.phase = (v.phase + dt / 1.6) % 1;
  v.f = v.phase < 0.55 ? 0 : 1;
  // now and then it reaches an arm toward a jelly nearby (facing it, if it fits that way round)
  if (v.t0 < 0 && !leaving && !v.happy && a >= v.nextMove && v.dy < 2) {
    v.nextMove = a + 7 + rand() * 4;
    if (aim && Math.abs(aim.x - v.x) <= OCTO_REACH_NEAR && aim.y < v.y) {
      const sx: 1 | -1 = aim.x >= v.x ? 1 : -1;
      if (octoFits(sp, sx, v.lo, v.hi)) v.sx = sx;
      v.t0 = a;
    }
  }
  if (v.t0 >= 0) {
    const r = a - v.t0;
    if (r >= OCTO_REACH || leaving || v.happy) v.t0 = -1;
    else {
      // the tip flicks twice (held still with reduced motion)
      const flick = !ctx.reduced && ((r >= 0.7 && r < 0.88) || (r >= 1.45 && r < 1.63));
      v.f = flick ? 3 : 2;
    }
  }
}

/** The manta glides across at its own pace (a little quicker once greeted, eased; not with reduced motion). */
function stepManta(v: Visit, dt: number, ctx: StepContext, leaving: boolean): void {
  const a = v.age;
  const want = v.happy && !ctx.reduced ? 1.6 : 1;
  v.dur += (want - v.dur) * Math.min(1, dt * 1.2);
  v.gx = clamp(v.gx + v.vx * v.dur * dt, v.lo, v.hi);
  if (!leaving && (v.gx <= v.lo || v.gx >= v.hi) && a > ARRIVE_TIME) v.leaveAt = a; // reached the far side: fade out
  v.y = v.baseY + 6 * Math.sin((a * 2 * Math.PI) / 9);
  v.phase = (v.phase + dt / (v.happy && !ctx.reduced ? 1.9 : 2.6)) % 1;
  v.f = Math.floor(v.phase * 4) % 4;
  v.x = farToWorld(v.gx, ctx.cam ?? 0);
}

/** The hermit crab: to the helmet and in, then peeking out of its port; or a wander along the sand. */
function stepHermit(v: Visit, dt: number, rand: () => number, ctx: StepContext, leaving: boolean): void {
  const a = v.age;
  const walk = (speed: number) => {
    v.phase = (v.phase + dt / 0.5) % 1;
    v.f = v.phase < 0.5 ? 0 : 1;
    v.x = clamp(v.x + v.sx * speed * dt, v.lo, v.hi);
  };
  const quick = v.happy && !ctx.reduced ? 1.5 : 1;
  if (v.home) {
    const home = ctx.home === undefined ? { x: v.gx - HERMIT_HOME.dx, y: v.gy - HERMIT_HOME.dy } : ctx.home;
    if (!home) {
      // the helmet was picked up (or is gone): it scuttles off
      v.home = false;
      if (!leaving) v.leaveAt = a;
      return;
    }
    v.gx = home.x + HERMIT_HOME.dx;
    v.gy = home.y + HERMIT_HOME.dy;
    if (v.t0 < 0) {
      // walking over: it stops at the helmet's middle and slips in
      if (leaving) return;
      const before = v.x;
      walk(HERMIT_SPEED * quick);
      if ((before - home.x) * (v.x - home.x) <= 0 || v.x <= v.lo || v.x >= v.hi) v.t0 = a;
      return;
    }
    const r = a - v.t0;
    if (r < HERMIT_SLIP) {
      v.vis = 1 - smooth(r / HERMIT_SLIP); // in it goes
      return;
    }
    // inside: a moment's pause, then it looks out of the port
    v.x = v.gx;
    v.y = v.gy;
    v.vis = smooth((r - HERMIT_SLIP - 0.8) / HERMIT_SLIP);
    if (leaving) {
      v.f = 2; // ducks back in as it goes
      return;
    }
    if (v.happy) {
      v.f = ctx.reduced ? 3 : Math.floor(a / 0.25) % 2 ? 3 : 2; // a wave of the claw
      return;
    }
    if (v.f < 2) {
      v.f = 2;
      v.nextMove = a + 1.2;
    }
    if (a >= v.nextMove) {
      v.f = v.f === 2 ? 3 : 2;
      v.nextMove = a + (v.f === 3 ? 2.5 + rand() * 1.5 : 1.2 + rand() * 0.8);
      if (v.f === 3 && rand() < 0.3) v.sx = v.sx > 0 ? -1 : 1; // and looks the other way
    }
    return;
  }
  // wandering: steps along, a pause every few seconds, gone at the end of its stretch
  if (leaving) return;
  if (a >= v.nextMove) {
    v.t0 = a;
    v.nextMove = a + 1.2 + 3 + rand() * 3;
  }
  if (a - v.t0 < 1.2) v.f = 0;
  else walk(HERMIT_SPEED * quick);
  if ((v.x <= v.lo && v.sx < 0) || (v.x >= v.hi && v.sx > 0)) v.leaveAt = Math.min(v.leaveAt, a);
}
