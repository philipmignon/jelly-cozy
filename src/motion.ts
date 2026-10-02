/**
 * v10 jelly motion: the eased 8-frame pulse, tentacle ripple frames and the lean into turns.
 * Pure functions + small state steppers; sim.ts calls them and writes the frames into the view.
 *
 * Art contract (tools/gen.py): juvenile and adult bells have 8 pulse frames j{s}bf0..7
 *   0 rest, 1 swell (anticipation), 2 squeeze, 3 squeeze (deeper), 4 peak squeeze,
 *   5 release, 6 overshoot (wider and flatter than rest), 7 settle
 * Polyps, ephyrae and the comb's shimmer keep 4 (bf0..3). Juvenile and adult tentacles ripple in 8 sway
 * frames (tf0..7; the 4-frame stream/trail poses show each drawing for two of them); polyps and ephyrae
 * keep 4. j{s}rot is the jelly's tilt in radians (Rive node rotation, positive = clockwise = leaning right).
 */
import { COMB, JUVENILE, clamp, type Species, type Stage } from "./species";

// ---------------------------------------------------------------- pulse

export const PULSE_REST = 0;
export const PULSE_SWELL = 1;
export const PULSE_PEAK = 4;
export const PULSE_OVERSHOOT = 6;

/** Body frames a stage draws: 8 for juvenile/adult bells, 4 for polyps, ephyrae and the comb's shimmer. */
export const bodyFramesOf = (k: Species, g: Stage): number => (g >= JUVENILE && k !== COMB ? 8 : 4);
/** Tentacle sway frames: 8 for juveniles and adults, 4 for polyps and ephyrae. */
export const tentFramesOf = (g: Stage): number => (g >= JUVENILE ? 8 : 4);

/**
 * The pulse curve, as the phase where each frame ENDS, in units of the species' squeeze fraction
 * (the part of the cycle that thrusts). Frames are not spaced evenly: the squeeze is quick (three frames
 * in the first ~0.8 of it, the peak held longest), the release and overshoot spring back, and the
 * settle eases out over the longest stretch before the long rest.
 */
export const PULSE_KEYS: readonly { end: number; frame: number }[] = [
  { end: 0.16, frame: 2 }, // squeeze: the margin starts to pull in
  { end: 0.38, frame: 3 }, // squeeze, deeper
  { end: 0.78, frame: PULSE_PEAK }, // peak: the power stroke, held
  { end: 1.04, frame: 5 }, // release
  { end: 1.5, frame: PULSE_OVERSHOOT }, // overshoot: wider and flatter than rest
  { end: 2.2, frame: 7 }, // settle back
];
/** The swell (anticipation) fills the last part of the cycle, just before the next squeeze. */
export const SWELL_AT = 0.86;

/** The 8-frame body frame for pulse phase p (0..1, the squeeze starts at 0) and squeeze fraction sq. */
export function pulseFrame(p: number, sq: number): number {
  const ph = ((p % 1) + 1) % 1;
  const q = Math.max(0.05, sq);
  for (const k of PULSE_KEYS) if (ph < Math.min(k.end * q, SWELL_AT)) return k.frame;
  return ph < SWELL_AT ? PULSE_REST : PULSE_SWELL;
}

/** The v2 4-frame pulse (polyps aside: ephyrae, and anything without 8 frames). */
export function pulseFrame4(p: number, sq = 0.3): number {
  if (p < sq * 0.4) return 1;
  if (p < sq) return 2;
  if (p < sq * 1.5) return 3;
  return 0;
}

/** Tentacle ripple waves sent down per pulse: the sway runs at this many cycles per bell beat. */
export const TENT_WAVES_PER_PULSE = 2;

/** Sway frame for tentacle phase t (0..1) out of n frames. */
export const tentFrame = (t: number, n: number): number => Math.floor((((t % 1) + 1) % 1) * n) % n;

// ---------------------------------------------------------------- tilt

const DEG = Math.PI / 180;

export interface TiltParams {
  /** the most a jelly leans, radians */
  max: number;
  /** sideways speed (eased, artboard px/s) that asks for the full lean */
  speed: number;
  /** how much "mostly downward" travel (svy - 0.8 |svx|, px/s) stands it fully upright again */
  sinkFull: number;
  /** time constant of the velocity the lean reads, s (slower than the trail's: a little lag) */
  tau: number;
  /** natural frequency (Hz) and damping ratio of the lean spring: < 1 overshoots a little */
  freq: number;
  damping: number;
  /** the written angle moves in whole steps of this, with a step of hysteresis, so it never flickers between two */
  step: number;
}

export const TILT: TiltParams = { max: 10 * DEG, speed: 32, sinkFull: 10, tau: 0.15, freq: 0.9, damping: 0.45, step: 0.5 * DEG };

export interface Tilt {
  /** the spring's angle and angular velocity (radians, rad/s) */
  a: number;
  v: number;
  /** the eased velocity it reads */
  svx: number;
  svy: number;
  /** what the view writes: `a` in `step`s, with hysteresis */
  out: number;
}

export const newTilt = (): Tilt => ({ a: 0, v: 0, svx: 0, svy: 0, out: 0 });

const smooth01 = (t: number) => {
  const u = clamp(t);
  return u * u * (3 - 2 * u);
};

/** The lean a velocity asks for: toward the sideways travel, fading to upright when still or heading down. */
export function tiltTarget(svx: number, svy: number, tp: TiltParams = TILT): number {
  const lean = clamp(svx / tp.speed, -1, 1);
  const down = svy - 0.8 * Math.abs(svx);
  return tp.max * lean * (1 - smooth01(down / tp.sinkFull));
}

// ---------------------------------------------------------------- quiet nights

/**
 * At night the tank settles: idle jellies pulse less often and push more gently, gliders slow down, wander
 * targets last longer, and swimmers loosely gather, each biased toward a shared point that wanders slowly
 * through the mid water of the view. A few glow: the bell's own soft light (j{s}nglow) swells with each squeeze.
 * `calm` is the eased night amount (0 day .. 1 night). Food still gets chased at nearly full speed.
 */
export interface QuietParams {
  /** idle pulse period multiplier at full calm (busy: `busyPeriod`) */
  period: number;
  busyPeriod: number;
  /** idle thrust multiplier at full calm */
  force: number;
  /** glider (comb) idle speed multiplier at full calm */
  glide: number;
  /** wander target hold time multiplier at full calm */
  hold: number;
  /** ephyra twitch multiplier at full calm */
  twitch: number;
  /** how strongly a wander target is pulled toward the gathering point at full calm (0..1) */
  gather: number;
  /** each jelly keeps its own spot around the gathering point, this far out (artboard px), plus up to `spread` */
  ring: number;
  spread: number;
  /** the gathering point's slow drift: periods of its x and y sway, s */
  driftX: number;
  driftY: number;
}

export const QUIET: QuietParams = {
  period: 1.6, busyPeriod: 1.15, force: 0.75, glide: 0.6, hold: 1.7, twitch: 0.4, gather: 0.7, ring: 70, spread: 60, driftX: 140, driftY: 97,
};

/** The night amount eased into a calm factor (a smoothstep, so dusk is gentle). */
export const calmOf = (night: number): number => {
  const n = clamp(night);
  return n * n * (3 - 2 * n);
};

/** Pulse period at a calm: idle periods stretch the most; chasing food barely slows. */
export const quietPeriod = (period: number, calm: number, busy: boolean, q: QuietParams = QUIET): number =>
  period * (1 + ((busy ? q.busyPeriod : q.period) - 1) * clamp(calm));

/** A multiplier that goes from 1 (day) to `atNight` (full calm). */
export const quietScale = (atNight: number, calm: number): number => 1 + (atNight - 1) * clamp(calm);

/**
 * The shared gathering point at sim time t: a slow Lissajous through the middle of the view's water
 * (x 30..70% across the span, y 35..60% down the water), so the group drifts where the player is looking.
 */
export function gatherPoint(t: number, x0: number, x1: number, y0: number, y1: number, q: QuietParams = QUIET): { x: number; y: number } {
  const fx = 0.5 + 0.2 * Math.sin((2 * Math.PI * t) / q.driftX);
  const fy = 0.475 + 0.125 * Math.sin((2 * Math.PI * t) / q.driftY + 1.1);
  return { x: x0 + (x1 - x0) * fx, y: y0 + (y1 - y0) * fy };
}

/**
 * A wander target pulled toward the gathering point: each slot keeps its own place on a loose ring round it
 * (golden-angle spacing), jittered by `r` (0..1), blended with the free target by gather x calm.
 */
export function gatherTarget(
  free: { x: number; y: number },
  point: { x: number; y: number },
  slot: number,
  calm: number,
  r: number,
  q: QuietParams = QUIET,
): { x: number; y: number } {
  const w = q.gather * clamp(calm);
  if (w <= 0) return free;
  const ang = slot * 2.39996 + r * 0.8;
  const rad = q.ring + q.spread * r;
  const spot = { x: point.x + Math.cos(ang) * rad, y: point.y + Math.sin(ang) * rad * 0.6 };
  return { x: free.x + (spot.x - free.x) * w, y: free.y + (spot.y - free.y) * w };
}

/** How brightly each species' bell lights up at night (index = species): the crystal and the comb most. */
export const NIGHT_GLOW: readonly number[] = [0.45, 0.4, 0.3, 0.85, 0.35, 0.4, 0.9, 0.5, 0.45];

/**
 * j{s}nglow: 0 by day; at night the species' level, swelling with the squeeze of the bell (pulse phase p, the
 * squeeze is its first `sq`) and easing back over the rest of the beat. Rounded to 0.01 so the view stays quiet.
 */
export function nightGlow(night: number, k: number, p: number, sq = 0.3): number {
  const n = clamp(night);
  if (n <= 0) return 0;
  const ph = ((p % 1) + 1) % 1;
  const q = Math.max(0.05, sq);
  const swell = ph < q ? Math.sin(((ph / q) * Math.PI) / 2) : Math.exp(-((ph - q) / (1 - q)) * 3);
  const level = NIGHT_GLOW[k] ?? 0.4;
  return Math.round(n * level * (0.55 + 0.45 * swell) * 100) / 100;
}

/** Advance the lean by dt. `still` (polyps, settling/settled jellies) stands it upright at once. */
export function stepTilt(t: Tilt, vx: number, vy: number, dt: number, still: boolean, tp: TiltParams = TILT): void {
  if (still) {
    t.a = t.v = t.svx = t.svy = t.out = 0;
    return;
  }
  const e = 1 - Math.exp(-dt / tp.tau);
  t.svx += (vx - t.svx) * e;
  t.svy += (vy - t.svy) * e;
  const target = tiltTarget(t.svx, t.svy, tp);
  const w = 2 * Math.PI * tp.freq;
  // semi-implicit Euler, substepped so a long frame can't blow the spring up
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    t.v += (w * w * (target - t.a) - 2 * tp.damping * w * t.v) * h;
    t.a += t.v * h;
    if (Math.abs(t.a) > tp.max) {
      t.a = Math.sign(t.a) * tp.max;
      t.v = 0;
    }
  }
  // whole steps toward the spring, only once it is a full step away: a peak that just grazes the next step
  // never flicks up and straight back down
  const steps = Math.trunc((t.a - t.out) / tp.step);
  if (steps) t.out = clamp(Math.round((t.out + steps * tp.step) / tp.step) * tp.step, -tp.max, tp.max);
  if (Math.abs(t.out) < 1e-9) t.out = 0;
}
