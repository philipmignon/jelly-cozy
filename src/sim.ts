/**
 * The tank simulation. Pure: no DOM, no Rive. Everything is in logical
 * pixels (the 144x256 grid); `view()` converts to artboard units for the
 * view model.
 */
import contract from "./contract.json";

export const K = contract;
const P = K.P;

export interface Save {
  v: 1;
  fullness: number;
  murk: number;
  affection: number;
  night: boolean;
  lastSeen: number;
}

export type FoodState = "off" | "sink" | "rest" | "eaten";

export interface Food {
  state: FoodState;
  x: number;
  y: number;
  vy: number;
  age: number;
  seed: number;
  /** where it was when eaten, so it can be drawn into the jelly */
  ex: number;
  ey: number;
}

export interface State {
  t: number;
  rand: () => number;
  jx: number;
  jy: number;
  vx: number;
  vy: number;
  pulse: number;
  tent: number;
  target: { x: number; y: number } | null;
  targetKind: "wander" | "tap" | "food" | null;
  targetUntil: number;
  food: Food[];
  fullness: number;
  murk: number;
  affection: number;
  nightTarget: boolean;
  night: number;
  ripple: { x: number; y: number; t0: number } | null;
  wipe: { t0: number; murk0: number } | null;
  pressUntil: [number, number, number];
  /** when the last happy wiggle started (eating, petting) */
  wiggleT0: number;
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

const BOUNDS = { x0: 18, x1: 126, y0: 32, y1: 172 };
const RATES = {
  /** full -> empty while you watch, seconds */
  hungerActive: 60 * 8,
  /** full -> empty while away, seconds */
  hungerAway: 3600 * 6,
  murkActive: 60 * 25,
  murkAway: 3600 * 12,
  affectionDecay: 60 * 6,
};

export function defaultSave(): Save {
  return { v: 1, fullness: 0.7, murk: 0.1, affection: 0.4, night: false, lastSeen: Date.now() };
}

/** Time away still matters, but nothing ever dies: hunger floors at 10%. */
export function applyAway(save: Save, now: number): Save {
  const away = Math.max(0, (now - save.lastSeen) / 1000);
  return {
    ...save,
    fullness: Math.max(Math.min(save.fullness, 0.1), save.fullness - away / RATES.hungerAway),
    murk: Math.min(Math.max(save.murk, 0.8), save.murk + away / RATES.murkAway),
    affection: Math.max(0, save.affection - away / (RATES.affectionDecay * 20)),
    lastSeen: now,
  };
}

export function createState(save: Save, rand: () => number = Math.random): State {
  return {
    t: 0,
    rand,
    jx: 72,
    jy: 100,
    vx: 0,
    vy: 0,
    pulse: 0,
    tent: 0,
    target: null,
    targetKind: null,
    targetUntil: 0,
    food: Array.from({ length: K.foodN }, () => ({ state: "off" as FoodState, x: 0, y: 0, vy: 0, age: 0, seed: 0, ex: 0, ey: 0 })),
    fullness: save.fullness,
    murk: save.murk,
    affection: save.affection,
    nightTarget: save.night,
    night: save.night ? 1 : 0,
    ripple: null,
    wipe: null,
    pressUntil: [0, 0, 0],
    wiggleT0: -Infinity,
  };
}

export function toSave(s: State, now: number): Save {
  return { v: 1, fullness: s.fullness, murk: s.murk, affection: s.affection, night: s.nightTarget, lastSeen: now };
}

export const mood = (s: State) => clamp(0.5 * s.fullness + 0.3 * (1 - s.murk) + 0.2 * s.affection);

const sandAt = (x: number) => K.sandTop[clamp(Math.round(x), 0, K.LW - 1)] ?? 192;

// ---------------------------------------------------------------- actions

export function feed(s: State): number {
  s.pressUntil[0] = s.t + 0.14;
  let dropped = 0;
  const cx = 34 + s.rand() * 76;
  for (const f of s.food) {
    if (dropped >= 4) break;
    if (f.state !== "off") continue;
    f.state = "sink";
    f.x = cx + (s.rand() - 0.5) * 14;
    f.y = K.waterTop + 1 - dropped * 2;
    f.vy = 7 + s.rand() * 4;
    f.age = 0;
    f.seed = s.rand() * 10;
    dropped++;
  }
  return dropped;
}

export function clean(s: State): void {
  s.pressUntil[1] = s.t + 0.14;
  if (s.wipe) return;
  s.wipe = { t0: s.t, murk0: s.murk };
}

export function toggleLamp(s: State): void {
  s.pressUntil[2] = s.t + 0.14;
  s.nightTarget = !s.nightTarget;
}

/** A tap in the water: logical coordinates. */
export function tap(s: State, x: number, y: number): "pet" | "call" | null {
  if (x < K.glassL || x > K.glassR || y < K.waterTop || y > K.waterBot) return null;
  s.ripple = { x, y, t0: s.t };
  const onBell = Math.abs(x - s.jx) <= 13 && y >= s.jy - 17 && y <= s.jy + 4;
  if (onBell) {
    s.affection = clamp(s.affection + 0.08);
    s.wiggleT0 = s.t;
    s.vy -= 5;
    return "pet";
  }
  s.affection = clamp(s.affection + 0.02);
  if (s.targetKind !== "food") {
    s.target = { x: clamp(x, BOUNDS.x0, BOUNDS.x1), y: clamp(y + 4, BOUNDS.y0, BOUNDS.y1) };
    s.targetKind = "tap";
    s.targetUntil = s.t + 4;
  }
  return "call";
}

// ---------------------------------------------------------------- step

const WIPE_TIME = 1.6;

export function step(s: State, dt: number): string[] {
  const events: string[] = [];
  s.t += dt;

  // needs
  s.fullness = clamp(s.fullness - dt / RATES.hungerActive);
  s.murk = clamp(s.murk + dt / RATES.murkActive);
  s.affection = clamp(s.affection - dt / RATES.affectionDecay);

  // lamp
  const nt = s.nightTarget ? 1 : 0;
  s.night += clamp(nt - s.night, -dt / 1.2, dt / 1.2);

  // cleaning sweep
  if (s.wipe) {
    const p = (s.t - s.wipe.t0) / WIPE_TIME;
    s.murk = s.wipe.murk0 * (1 - clamp(p));
    if (p >= 1) {
      s.wipe = null;
      events.push("cleaned");
    }
  }

  // food
  let nearest: Food | null = null;
  let nearestD = Infinity;
  for (const f of s.food) {
    if (f.state === "off") continue;
    f.age += dt;
    if (f.state === "sink") {
      f.y += f.vy * dt;
      f.x += Math.sin(f.age * 2.2 + f.seed) * 3 * dt;
      const floor = sandAt(f.x) - 2;
      if (f.y >= floor) {
        f.y = floor;
        f.state = "rest";
        f.age = 0;
      }
    } else if (f.state === "rest" && f.age > 30) {
      f.state = "off";
      s.murk = clamp(s.murk + 0.03);
    } else if (f.state === "eaten" && f.age > 0.3) {
      f.state = "off";
    }
    if (f.state === "sink" || f.state === "rest") {
      // caught by the tentacles: under the bell, within its width
      if (Math.abs(f.x - s.jx) <= 10 && f.y >= s.jy - 4 && f.y <= s.jy + 15) {
        f.state = "eaten";
        f.age = 0;
        f.ex = f.x;
        f.ey = f.y;
        s.fullness = clamp(s.fullness + 0.12);
        s.affection = clamp(s.affection + 0.04);
        s.wiggleT0 = s.t;
        events.push("ate");
        continue;
      }
      const d = Math.hypot(f.x - s.jx, f.y - (s.jy + 8));
      if (d < nearestD) {
        nearestD = d;
        nearest = f;
      }
    }
  }

  // choose where to go
  if (nearest) {
    s.target = { x: nearest.x, y: clamp(nearest.y - 8, BOUNDS.y0, BOUNDS.y1) };
    s.targetKind = "food";
  } else if (s.targetKind === "food" || !s.target || s.t > s.targetUntil) {
    s.target = {
      x: BOUNDS.x0 + 8 + s.rand() * (BOUNDS.x1 - BOUNDS.x0 - 16),
      y: BOUNDS.y0 + 10 + s.rand() * (BOUNDS.y1 - BOUNDS.y0 - 30),
    };
    s.targetKind = "wander";
    s.targetUntil = s.t + 6 + s.rand() * 5;
  }

  // swim: pulse the bell, thrust during the squeeze
  const busy = s.targetKind === "food" || s.targetKind === "tap";
  let period = busy ? 1.15 : 2.1;
  if (s.fullness < 0.2) period *= 1.3;
  const prev = s.pulse;
  s.pulse = (s.pulse + dt / period) % 1;
  const squeezing = s.pulse < 0.3;
  const tx = s.target.x - s.jx;
  const ty = s.target.y - s.jy;
  const dist = Math.hypot(tx, ty);
  if (squeezing && dist > 3) {
    // a jelly can only push away from its bell: aim up and across, never down
    const up = ty < -2 ? ty : -Math.min(6, Math.max(2, dist * 0.2));
    const len = Math.hypot(tx * 0.9, up) || 1;
    const force = (busy ? 70 : 42) * Math.sin((s.pulse / 0.3) * Math.PI);
    if (ty < 8) {
      s.vx += ((tx * 0.9) / len) * force * dt;
      s.vy += (up / len) * force * dt;
    } else {
      s.vx += Math.sign(tx) * Math.min(1, Math.abs(tx) / 10) * force * 0.35 * dt;
    }
  }
  if (prev > s.pulse) events.push("pulse");
  // sink between pulses, water drag
  s.vy += 5 * dt;
  const drag = Math.exp(-1.6 * dt);
  s.vx *= drag;
  s.vy *= drag;
  s.jx += s.vx * dt;
  s.jy += s.vy * dt;
  if (s.jx < BOUNDS.x0) s.vx += (BOUNDS.x0 - s.jx) * 4 * dt;
  if (s.jx > BOUNDS.x1) s.vx -= (s.jx - BOUNDS.x1) * 4 * dt;
  if (s.jy < BOUNDS.y0) s.vy += (BOUNDS.y0 - s.jy) * 4 * dt;
  const floor = Math.min(BOUNDS.y1, sandAt(s.jx) - 18);
  if (s.jy > floor) {
    s.jy = floor;
    s.vy = Math.min(0, s.vy);
  }

  // tentacles sway faster when it swims
  s.tent = (s.tent + dt * (0.9 + Math.min(1.5, Math.hypot(s.vx, s.vy) / 8))) % 1;

  return events;
}

// ---------------------------------------------------------------- view

export type View = Record<string, number>;

function bellFrame(pulse: number): number {
  if (pulse < 0.12) return 1;
  if (pulse < 0.3) return 2;
  if (pulse < 0.45) return 3;
  return 0;
}

const WIGGLE_TIME = 0.6;
const FLUSH_TIME = 1.0;

const step6 = (v: number) => Math.round(v * 6) / 6;

export function view(s: State): View {
  const v: View = {};
  const m = mood(s);
  // happy wiggle: three quick squeezes and a one-pixel shimmy, no thrust
  const wp = (s.t - s.wiggleT0) / WIGGLE_TIME;
  const wiggling = wp >= 0 && wp < 1;
  const shimmy = wiggling ? (Math.floor(wp * 8) % 2 ? 1 : -1) : 0;
  v.jx = (Math.round(s.jx) + shimmy) * P;
  v.jy = Math.round(s.jy) * P;
  const bf = bellFrame(wiggling ? (wp * 3) % 1 : s.pulse);
  const tf = wiggling ? Math.floor(wp * 8) % 4 : Math.floor(s.tent * 4) % 4;
  for (let i = 0; i < 4; i++) {
    v[`bf${i}`] = i === bf ? 1 : 0;
    v[`tf${i}`] = i === tf ? 1 : 0;
  }
  const pale = m < 0.35 ? 1 : 0;
  v.pale = pale;
  v.healthy = 1 - pale;
  // rosy flush over whichever bell is showing, fading out in steps
  const fp = (s.t - s.wiggleT0) / FLUSH_TIME;
  v.flush = fp < 0 || fp >= 1 ? 0 : fp < 0.5 ? 1 : fp < 0.75 ? 0.6 : 0.3;

  const night = step6(s.night);
  v.nightShade = night * 0.55;
  v.daylight = 1 - night;
  v.sunO = s.nightTarget ? 0 : 1;
  v.moonO = s.nightTarget ? 1 : 0;
  v.glow = Math.round(night * (0.45 + 0.55 * m) * 4) / 4;

  v.murkShade = Math.round(s.murk * 8) / 8 * 0.42;
  v.algae0 = s.murk > 0.3 ? 1 : 0;
  v.algae1 = s.murk > 0.55 ? 1 : 0;
  v.algae2 = s.murk > 0.8 ? 1 : 0;

  s.food.forEach((f, i) => {
    let x = f.x;
    let y = f.y;
    let o = f.state === "sink" || f.state === "rest" ? 1 : 0;
    if (f.state === "eaten") {
      const p = clamp(f.age / 0.3);
      x = f.ex + (s.jx - f.ex) * p;
      y = f.ey + (s.jy - 2 - f.ey) * p;
      o = p < 0.5 ? 1 : 0.5;
    }
    v[`food${i}x`] = Math.round(x) * P;
    v[`food${i}y`] = Math.round(y) * P;
    v[`food${i}o`] = o;
  });

  const rp = s.ripple ? (s.t - s.ripple.t0) / 0.45 : 1;
  const rframe = rp < 1 ? Math.floor(rp * 3) : -1;
  v.rx = s.ripple ? Math.round(s.ripple.x) * P : 0;
  v.ry = s.ripple ? Math.round(s.ripple.y) * P : 0;
  for (let i = 0; i < 3; i++) v[`rf${i}`] = i === rframe ? 1 : 0;

  if (s.wipe) {
    const p = clamp((s.t - s.wipe.t0) / WIPE_TIME);
    v.wipeX = Math.round(K.glassL - 14 + p * (K.glassR - K.glassL + 44)) * P;
    v.wipeO = 1;
  } else {
    v.wipeX = -100 * P;
    v.wipeO = 0;
  }

  v.barFood = Math.round(s.fullness * K.barW) * P;
  v.barWater = Math.round((1 - s.murk) * K.barW) * P;
  v.barMood = Math.round(m * K.barW) * P;
  for (let i = 0; i < 3; i++) v[`b${i}y`] = s.t < (s.pressUntil[i] ?? 0) ? P : 0;
  return v;
}
