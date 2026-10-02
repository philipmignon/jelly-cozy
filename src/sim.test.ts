import { describe, expect, it } from "vitest";
import { openSandBounds, sandUnder, snailBounds, walkerBounds, helperWorld } from "./helpers";
import { FLING_TAU } from "./camera";
import { DIVER, VISITOR_PROP, boxFacing, planVisit, visitsDuring } from "./visitors";
import { PULSE_OVERSHOOT, PULSE_PEAK, PULSE_REST, PULSE_SWELL, SWELL_AT, TENT_WAVES_PER_PULSE, TILT, newTilt, pulseFrame, stepTilt, tiltTarget } from "./motion";
import { SPOT_R, murkOf } from "./dirt";
import { OPEN_SAND, OPEN_SANDS, TIERS, glassRightOf, openSandsOf, SNAIL_FLOOR, BABY_SECONDS, CRAB_SIZE, GLIDE_TRAIL, PULSE_TRAIL, SHRIMP_SIZE, SNAIL_SIZE, TRAIL_FAN, TRAIL_L, TRAIL_N, TRAIL_NEUTRAL, TRAIL_R, TRAIL_STREAM, decorY } from "./species";
import {
  BELL_H,
  SHOP_SCROLL,
  inShopView,
  scrollShop,
  BELL_HALF,
  DECOR,
  MAX_SLOTS,
  SHOP_ITEMS,
  REVEAL_TIME,
  WALL_TIME,
  camMoving,
  camTo,
  camX,
  flingCam,
  jellyCount,
  maxJellies,
  moveDecorScreen,
  panBy,
  rightGlass,
  screenToWorld,
  viewSpan,
  wallX,
  worldToScreen,
  worldW,
  K,
  POLYP_ANCHORS,
  RIM_ABOVE_SAND,
  TAB_ITEMS,
  SETTLE_SPOTS,
  applyAway,
  buy,
  canRehome,
  demoSave,
  isNightByClock,
  loadGame,
  nextLightChange,
  rehome,
  rehomeInfo,
  clean,
  closeShop,
  createState,
  defaultSave,
  feed,
  geomOf,
  isShopOpen,
  loadSave,
  NAMES,
  dayKey,
  decorAt,
  decorBaseY,
  dropDecor,
  jellyAt,
  jellyInfo,
  liftDecor,
  migrateV1,
  nextTrail,
  moveDecor,
  openShop,
  pearlCentre,
  pearlShowing,
  renameJelly,
  setTab,
  syncClock,
  sandAt,
  specProps,
  spotsForMurk,
  setMurk,
  setTool,
  toggleTool,
  setCursor,
  sprinkle,
  scrubAt,
  SPOT_N,
  POUR_BURST,
  focusJelly,
  step,
  tap,
  toSave,
  toggleLamp,
  view,
  jellies,
  journalFrom,
  journal,
  exportTank,
  importTank,
  visitorInfo,
  VISITORS,
  favouriteFood,
  FOOD_NAMES,
  FOOD_TOOLS,
  foodKindOf,
  isFoodTool,
  setTheme,
  themeInfo,
  type Jelly,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";

const P = K.P;
/** local noon and other wall-clock times, so day/night doesn't depend on the machine's time zone */
const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m).getTime();
const NOON = at(12);
const snap = (v: number) => Math.round(v / P) * P;

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const run = (s: State, seconds: number) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * 60; i++) events.push(...step(s, 1 / 60));
  return events;
};
const count = (events: SimEvent[], type: string, slot?: number) => events.filter((e) => e.type === type && (slot === undefined || e.slot === slot)).length;

const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k,
  g,
  gp: [0, 4, 12, 30][g]!,
  care: 0,
  fullness: 0.7,
  affection: 0.4,
  anchor: -1,
  spot: -1,
  name: "Mochi",
  born: 0,
  content: 0,
  morph: 0,
  ...extra,
});
/** v8: a save's glass carries spots adding up to its murk (default 0.1) unless `spots` is given */
const spotsFor = (murk: number, tier = 0) => spotsForMurk(murk, glassRightOf(TIERS[tier]!.worldW), seeded(77)).map(({ x, y, dirt, v }) => ({ x, y, dirt, v }));
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 10,
  foods: [true, false, false],
  themes: [true, false, false, false],
  theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0,
  murk: extra.murk ?? 0.1,
  spots: extra.spots ?? spotsFor(extra.murk ?? 0.1, extra.tier ?? 0),
  night: false,
  lamp: null,
  owned: [false, false, false, false, false],
  helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x),
  pearlDay: "",
  lastSeen: 0,
  tier: 0,
  cam: 0,
  journal: journalFrom(slots, 0),
  ...extra,
});
/** the v1 single adult moon */
const moonTank = (extra: Partial<SaveJelly> = {}, tankExtra: Partial<Save> = {}) => tank([jelly(0, 3, extra)], tankExtra);
const j0 = (s: State) => s.slots[0]!;
const xy = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });

/** the whole body inside the glass and under the surface; swimmers high enough to reach the sand */
function expectInside(j: Jelly) {
  const g = geomOf(j.k, j.g);
  expect(j.x - g.body.halfW).toBeGreaterThan(K.glassL);
  expect(j.x + g.body.halfW).toBeLessThan(K.glassR);
  expect(j.y - g.body.top).toBeGreaterThanOrEqual(K.waterTop);
  // polyps sit on rocks, which may stand in front of the sand line
  if (j.mode !== "fixed") expect(j.y).toBeLessThanOrEqual(sandAt(j.x) + 1e-9);
  if (j.mode === "swim") expect(j.y).toBeLessThanOrEqual(sandAt(j.x) - g.rimAbove + 1e-9);
  expect(Number.isFinite(j.x) && Number.isFinite(j.y)).toBe(true);
}

describe("view", () => {
  const busy = () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 0, { anchor: 1 }), null], { dollars: 1234 }), seeded());
    feed(s);
    clean(s);
    tap(s, 300, 400);
    run(s, 0.5);
    return s;
  };

  it("writes exactly the spec's props, all finite", () => {
    for (const s of [busy(), createState(defaultSave(0), seeded())]) {
      const v = view(s);
      expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
      for (const [name, value] of Object.entries(v)) expect(Number.isFinite(value), name).toBe(true);
    }
  });

  // runs once gen.py has exported the v5 contract (it adds wallX etc.)
  it.skipIf(!K.props.includes("wallX"))("writes exactly the numeric props in contract.json", () => {
    // K is contract.json, imported fresh when the test runs
    expect(new Set(Object.keys(view(busy())))).toEqual(new Set(K.props));
  });

  it("snaps written positions to the pixel grid", () => {
    const s = createState(tank([jelly(0, 3, { fullness: 0.33 }), jelly(3, 2), jelly(2, 1)]), seeded(7));
    feed(s);
    clean(s);
    tap(s, 201, 333);
    openShop(s);
    for (let i = 0; i < 300; i++) {
      step(s, 1 / 60);
      const v = view(s);
      const grid = ["rx", "ry", "canX", "canY", "spongeX", "spongeY", "barFood", "barWater", "barMood", "fxX", "fxY", "shopY", "snailX", "snailY", "shrimpX", "shrimpY", "crabX", "crabY"];
      for (let d = 0; d < 5; d++) grid.push(`dec${d}x`, `dec${d}y`);
      for (let k = 0; k < 3; k++) grid.push(`j${k}x`, `j${k}y`);
      for (let k = 0; k < K.foodN; k++) grid.push(`food${k}x`, `food${k}y`);
      for (let k = 0; k < SPOT_N; k++) grid.push(`spot${k}x`, `spot${k}y`);
      for (const name of grid) expect(Math.abs((v[name] ?? 0) % P), name).toBe(0);
    }
  });

  it("empty slots are all zero; occupied ones are one-hot", () => {
    const v = view(createState(tank([null, jelly(1, 2), null]), seeded()));
    for (const name of specProps().filter((n) => n.startsWith("j0") || n.startsWith("j2"))) expect(v[name], name).toBe(0);
    expect(v.j1on).toBe(1);
    for (const g of ["k", "g"]) expect([0, 1, 2, 3].reduce((a, i) => a + (v[`j1${g}${i}`] ?? 0), 0)).toBe(1);
    for (const g of ["bf", "tf"]) expect([0, 1, 2, 3, 4, 5, 6, 7].reduce((a, i) => a + (v[`j1${g}${i}`] ?? 0), 0)).toBe(1);
    expect(v.j1k1).toBe(1);
    expect(v.j1g2).toBe(1);
  });

  it("the dollar counter hides leading zeros", () => {
    const digits = (dollars: number) => {
      const v = view(createState(tank([jelly(0, 3)], { dollars }), seeded()));
      return [0, 1, 2, 3].map((p) => {
        const on = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => v[`cd${p}n${n}`] === 1);
        expect(on.length).toBeLessThanOrEqual(1);
        return on[0] ?? -1;
      });
    };
    expect(digits(0)).toEqual([0, -1, -1, -1]);
    expect(digits(7)).toEqual([7, -1, -1, -1]);
    expect(digits(1204)).toEqual([4, 0, 2, 1]);
    expect(digits(40)).toEqual([0, 4, -1, -1]);
  });

  it("meters: hungriest fullness, clean water, average mood", () => {
    const s = createState(tank([jelly(0, 3, { fullness: 0.9 }), jelly(1, 3, { fullness: 0.25 })], { murk: 0.5 }), seeded());
    const v = view(s);
    const full = K.barW * P;
    expect(v.barFood).toBe(snap(0.25 * full));
    expect(v.barWater).toBe(snap(0.5 * full));
  });

  it("decor shows when owned; the glow coral glows at night", () => {
    const s = createState(tank([jelly(0, 3)], { owned: [true, false, false, false, true], lastSeen: NOON }), seeded());
    expect(view(s).dec0).toBe(1);
    expect(view(s).dec1).toBe(0);
    expect(view(s).dec4glow).toBe(0);
    toggleLamp(s);
    run(s, 2);
    expect(view(s).dec4glow).toBe(1);
  });
});

describe("moon jelly (v1 behaviour)", () => {
  it("the jelly stays inside the tank for ten minutes", () => {
    const s = createState(moonTank(), seeded(3));
    for (let i = 0; i < 600 * 60; i++) {
      step(s, 1 / 60);
      const j = j0(s);
      expect(j.x - BELL_HALF - P).toBeGreaterThan(K.glassL);
      expect(j.x + BELL_HALF + P).toBeLessThan(K.glassR);
      expect(j.y - BELL_H).toBeGreaterThanOrEqual(K.waterTop + 10);
      expect(j.y).toBeLessThanOrEqual(sandAt(j.x) - RIM_ABOVE_SAND + 1e-9);
    }
  });

  it("dropped food gets eaten, and each meal pays a dollar", () => {
    const s = createState(moonTank({ fullness: 0.2 }), seeded(5));
    expect(feed(s)).toBe(4);
    const events = run(s, 60);
    const ate = count(events, "ate", 0);
    expect(ate).toBeGreaterThanOrEqual(3);
    expect(j0(s).fullness).toBeGreaterThan(0.45);
    expect(s.dollars).toBe(ate);
  });

  it("never thrusts downward: between pulses it only sinks", () => {
    const s = createState(moonTank(), seeded(2));
    const j = j0(s);
    j.target = { x: j.x, y: 780 };
    j.targetKind = "tap";
    j.targetUntil = 1e9;
    let prevVy = j.vy;
    for (let i = 0; i < 600; i++) {
      step(s, 1 / 60);
      // any downward change in velocity is no more than the sink rate
      expect(j.vy - prevVy).toBeLessThanOrEqual((25 / 60) * 1.0001);
      prevVy = j.vy;
    }
  });

  it("cleaning clears the murk, paying 3 only when the water was dirty", () => {
    const s = createState(moonTank({}, { murk: 0.9 }), seeded());
    clean(s);
    const events = run(s, 2);
    expect(count(events, "cleaned")).toBe(1);
    expect(s.murk).toBeLessThan(0.01);
    expect(s.dollars).toBe(3);
    clean(s);
    run(s, 2);
    expect(s.dollars).toBe(3);
  });

  it("petting the bell raises affection and pays a dollar, once per 20 s", () => {
    const s = createState(moonTank(), seeded());
    const before = j0(s).affection;
    expect(tap(s, j0(s).x, j0(s).y - 60)).toBe("pet");
    expect(j0(s).affection).toBeGreaterThan(before);
    expect(s.dollars).toBe(1);
    expect(count(step(s, 1 / 60), "earned", 0)).toBe(1);
    tap(s, j0(s).x, j0(s).y - 60);
    expect(s.dollars).toBe(1);
    run(s, 20);
    tap(s, j0(s).x, j0(s).y - 60);
    expect(s.dollars).toBe(2);
  });

  it("a tap off the bell calls it over", () => {
    const s = createState(moonTank(), seeded());
    expect(tap(s, 150, 300)).toBe("call");
    expect(j0(s).targetKind).toBe("tap");
    expect(view(s).ro).toBeGreaterThan(0);
  });

  it("petting sets off a wiggle that settles", () => {
    const s = createState(moonTank(), seeded());
    tap(s, j0(s).x, j0(s).y - 60);
    const frames = new Set<string>();
    const xs = new Set<number>();
    for (let i = 0; i < 34; i++) {
      step(s, 1 / 60);
      const v = view(s);
      frames.add([0, 1, 2, 3, 4, 5, 6, 7].map((k) => v[`j0bf${k}`]).join(""));
      xs.add((v.j0x ?? 0) - snap(j0(s).x));
    }
    expect(frames.size).toBeGreaterThanOrEqual(3);
    expect(xs).toEqual(new Set([-P, P]));
    expect(view(s).j0flush).toBeGreaterThan(0);
    run(s, 1);
    expect((view(s).j0x ?? 0) - snap(j0(s).x)).toBe(0);
    expect(view(s).j0flush).toBe(0);
  });

  it("eating sets off a wiggle", () => {
    const s = createState(moonTank({ fullness: 0.2 }), seeded(5));
    feed(s);
    let t = 0;
    while (!step(s, 1 / 60).some((e) => e.type === "ate") && t++ < 3600);
    expect(j0(s).wiggleT0).toBeCloseTo(s.t);
  });

  it("the lamp fades to night and back", () => {
    const s = createState(moonTank({}, { lastSeen: NOON }), seeded());
    toggleLamp(s);
    run(s, 2);
    expect(view(s).daylight).toBe(0);
    expect(view(s).moonO).toBe(1);
    expect(view(s).nightShade).toBe(1);
    toggleLamp(s);
    run(s, 2);
    expect(view(s).daylight).toBe(1);
  });

  it("buttons press down briefly", () => {
    const s = createState(moonTank(), seeded());
    feed(s);
    openShop(s);
    expect(view(s).b0y).toBe(P);
    expect(view(s).b3y).toBe(P);
    run(s, 0.2);
    expect(view(s).b0y).toBe(0);
    expect(view(s).b3y).toBe(0);
  });
});

describe("species", () => {
  it("three jellies of different species and stages stay in the water for ten minutes", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 1), jelly(3, 2)]), seeded(11));
    const rand = seeded(99);
    for (let i = 0; i < 600 * 60; i++) {
      if (i % (40 * 60) === 0) feed(s);
      if (i % (13 * 60) === 0) tap(s, 60 + rand() * 600, 80 + rand() * 860);
      step(s, 1 / 60);
      for (const j of s.slots) if (j) expectInside(j);
    }
  });

  it("an upside-down, a polyp and a comb stay put / in the water too", () => {
    const s = createState(tank([jelly(2, 3), jelly(0, 0, { anchor: 2 }), jelly(3, 3)]), seeded(4));
    for (let i = 0; i < 300 * 60; i++) {
      if (i % (30 * 60) === 0) feed(s);
      step(s, 1 / 60);
      for (const j of s.slots) if (j) expectInside(j);
    }
  });

  it("jellies don't pile on top of each other", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3)]), seeded(8));
    const [a, b] = [s.slots[0]!, s.slots[1]!];
    b.x = a.x;
    b.y = a.y;
    let apart = 0;
    for (let i = 0; i < 120 * 60; i++) {
      step(s, 1 / 60);
      if (i > 20 * 60 && Math.hypot(a.x - b.x, a.y - b.y) > 100) apart++;
    }
    expect(apart / (100 * 60)).toBeGreaterThan(0.8);
  });

  it("polyps never move, sway, and catch food dropped for them", () => {
    const s = createState(tank([jelly(0, 0, { anchor: 0, fullness: 0.2 }), jelly(1, 0, { anchor: 2, fullness: 0.25 })]), seeded(6));
    const at = s.slots.map((j) => (j ? { x: j.x, y: j.y } : null));
    expect(at[0]).toEqual(xy(POLYP_ANCHORS[0]!));
    expect(at[1]).toEqual(xy(POLYP_ANCHORS[2]!));
    const frames = new Set<number>();
    let ate = 0;
    for (let i = 0; i < 120 * 60; i++) {
      if (i % (15 * 60) === 0) feed(s);
      ate += count(step(s, 1 / 60), "ate");
      const v = view(s);
      frames.add([0, 1, 2, 3].findIndex((k) => v[`j0bf${k}`] === 1));
      s.slots.forEach((j, k) => j && j.g === 0 && expect({ x: j.x, y: j.y }).toEqual(at[k]));
    }
    expect(frames.size).toBe(4);
    expect(ate).toBeGreaterThan(8);
  });

  it("a comb jelly glides: no pulse thrust, but it moves and shimmers", () => {
    const s = createState(tank([jelly(3, 3), jelly(3, 2)]), seeded(9));
    const start = s.slots.map((j) => (j ? j.x + j.y : 0));
    const frames = new Set<number>();
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      events.push(...step(s, 1 / 60));
      const v = view(s);
      frames.add([0, 1, 2, 3].findIndex((k) => v[`j0bf${k}`] === 1));
    }
    for (const j of s.slots) if (j) expect(j.thrust).toBe(0);
    expect(count(events, "pulse")).toBe(0);
    expect(frames.size).toBe(4);
    s.slots.forEach((j, i) => j && expect(Math.abs(j.x + j.y - start[i]!)).toBeGreaterThan(5));
  });

  it("blubber pulses faster than moon; ephyras faster still", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 3), jelly(0, 1)]), seeded(2));
    const events = run(s, 60);
    const moon = count(events, "pulse", 0);
    const blub = count(events, "pulse", 1);
    const eph = count(events, "pulse", 2);
    expect(blub).toBeGreaterThan(moon);
    expect(eph).toBeGreaterThan(blub);
  });

  it("an upside-down settles on the sand at juvenile and stays there", () => {
    const s = createState(tank([jelly(2, 1, { gp: 11 })], { murk: 0.1 }), seeded(12));
    const j = j0(s);
    j.gp = 12; // ready to grow on the next step
    const events = run(s, 1 / 60);
    expect(events.some((e) => e.type === "grew" && e.slot === 0 && e.stage === 2)).toBe(true);
    expect(j.mode).toBe("settling");
    run(s, 30);
    expect(j.mode).toBe("settled");
    const spot = xy(SETTLE_SPOTS[j.spot]!);
    expect({ x: j.x, y: j.y }).toEqual(spot);
    expect(j.y).toBe(sandAt(j.x));
    for (let i = 0; i < 120 * 60; i++) {
      if (i % (20 * 60) === 0) feed(s);
      if (i % (7 * 60) === 0) tap(s, 600, 300);
      step(s, 1 / 60);
      expect({ x: j.x, y: j.y }).toEqual(spot);
    }
  });

  it("a settled upside-down eats food that lands within reach", () => {
    const s = createState(tank([jelly(2, 3, { fullness: 0.2 })]), seeded(13));
    const j = j0(s);
    expect(j.mode).toBe("settled");
    const f = s.food[0]!;
    Object.assign(f, { state: "sink", x: j.x + 20, y: 600, vy: 45, age: 0, seed: 0 });
    const events = run(s, 15);
    expect(count(events, "ate", 0)).toBe(1);
  });
});

describe("growth", () => {
  it("a fed moon polyp grows through every stage to adult, earning as it goes", () => {
    const s = createState(defaultSave(0), seeded(21), { growthMultiplier: 20 });
    expect(j0(s).g).toBe(0);
    const events: SimEvent[] = [];
    for (let i = 0; i < 180 * 60 && j0(s).g < 3; i++) {
      if (i % (10 * 60) === 0) feed(s);
      events.push(...step(s, 1 / 60));
    }
    expect(j0(s).g).toBe(3);
    expect(events.filter((e) => e.type === "grew").map((e) => e.stage)).toEqual([1, 2, 3]);
    expect(count(events, "adult", 0)).toBe(1);
    const meals = count(events, "ate");
    expect(meals).toBeGreaterThan(0);
    expect(s.dollars).toBe(meals + 5 + 5 + 20);
    expect(events.filter((e) => e.type === "earned").reduce((a, e) => a + (e.amount ?? 0), 0)).toBe(s.dollars);
  });

  it("thresholds are 4 / 12 / 30 points, a meal is one point, good care one a minute", () => {
    const s = createState(tank([jelly(0, 0, { anchor: 0, gp: 3 })]), seeded());
    const j = j0(s);
    run(s, 59);
    expect(j.g).toBe(0);
    run(s, 2);
    expect(j.g).toBe(1);
    expect(j.gp).toBe(4);
    j.gp = 11;
    j.care = 0;
    run(s, 1 / 60);
    expect(j.g).toBe(1);
    j.gp = 12;
    run(s, 1 / 60);
    expect(j.g).toBe(2);
    j.gp = 29.5;
    run(s, 1 / 60);
    expect(j.g).toBe(2);
    j.gp = 30;
    run(s, 1 / 60);
    expect(j.g).toBe(3);
  });

  it("no care points while hungry or the water is murky", () => {
    const hungry = createState(tank([jelly(0, 0, { anchor: 0, fullness: 0.25 })]), seeded());
    run(hungry, 120);
    expect(j0(hungry).gp).toBe(0);
    const murky = createState(tank([jelly(0, 0, { anchor: 0 })], { murk: 0.7 }), seeded());
    run(murky, 120);
    expect(j0(murky).gp).toBe(0);
  });

  it("a polyp buds into an ephyra that swims off the rock, with a sparkle", () => {
    const s = createState(tank([jelly(0, 0, { anchor: 1, gp: 4 })]), seeded());
    const events = run(s, 1 / 60);
    const j = j0(s);
    expect(j.g).toBe(1);
    expect(j.mode).toBe("swim");
    expect(j.anchor).toBe(-1);
    expect(count(events, "grew", 0)).toBe(1);
    expect(s.dollars).toBe(5);
    expect(view(s).fxO).toBe(1);
    run(s, 1);
    expect(view(s).fxO).toBe(0);
  });

  it("time away accrues at most 8 growth points", () => {
    const save = tank([jelly(0, 0, { anchor: 0, fullness: 0.9 })], { lastSeen: 0, murk: 0 });
    expect(applyAway(save, 1000 * 60 * 3).slots[0]!.gp).toBe(3);
    // v8: the glass dirties while you're away, so the clear stretch (murk < 0.6) is about 10 minutes
    expect(applyAway(save, 1000 * 3600 * 5).slots[0]!.gp).toBeGreaterThanOrEqual(6);
    expect(applyAway(save, 1000 * 3600 * 5).slots[0]!.gp).toBeLessThanOrEqual(8);
    expect(applyAway({ ...save, helpers: [true, false, false] }, 1000 * 3600 * 5).slots[0]!.gp).toBe(8);
    expect(applyAway(save, 1000 * 3600 * 5, 20).slots[0]!.gp).toBe(8);
    expect(applyAway(save, 1000 * 60 * 3, 20).slots[0]!.gp).toBe(8);
    // poor care while away earns nothing
    expect(applyAway(tank([jelly(0, 0, { anchor: 0, fullness: 0.2 })], { lastSeen: 0 }), 1000 * 3600).slots[0]!.gp).toBe(0);
  });

  it("time away never starves them", () => {
    const save = applyAway(tank([jelly(0, 3, { fullness: 0.9 }), jelly(1, 2, { fullness: 0.05 })], { lastSeen: 0 }), 1000 * 3600 * 24 * 30);
    expect(save.slots[0]!.fullness).toBeCloseTo(0.1);
    expect(save.slots[1]!.fullness).toBeCloseTo(0.05);
    expect(save.murk).toBeLessThanOrEqual(0.8 + 1e-9);
  });
});

describe("shop", () => {
  it("slides open with an ease-out, ignores water taps while open, and slides shut", () => {
    const s = createState(moonTank(), seeded());
    expect(view(s).shopY).toBe(1500);
    openShop(s);
    expect(isShopOpen(s)).toBe(true);
    run(s, 0.1);
    const early = view(s).shopY!;
    expect(early).toBeLessThan(1500 * 0.6); // ease-out: most of the way early on
    run(s, 0.3);
    expect(view(s).shopY).toBe(0);
    const t = j0(s).targetKind;
    expect(tap(s, 150, 300)).toBeNull();
    expect(tap(s, j0(s).x, j0(s).y - 60)).toBeNull();
    expect(j0(s).targetKind).toBe(t);
    expect(view(s).ro).toBe(0);
    closeShop(s);
    expect(isShopOpen(s)).toBe(false);
    run(s, 0.4);
    expect(view(s).shopY).toBe(1500);
    expect(tap(s, 150, 300)).toBe("call");
  });

  it("buys a polyp into the first free slot at a free anchor", () => {
    const s = createState(tank([jelly(0, 0, { anchor: 0 }), null, jelly(0, 3)], { dollars: 100 }), seeded());
    expect(view(s).lock0).toBe(0);
    expect(buy(s, 0)).toBe("bought");
    expect(s.dollars).toBe(60);
    const j = s.slots[1]!;
    expect(j.k).toBe(1);
    expect(j.g).toBe(0);
    expect(j.anchor).toBe(1);
    expect({ x: j.x, y: j.y }).toEqual(xy(POLYP_ANCHORS[1]!));
    expect(view(s).fxO).toBe(1);
    expect(view(s).j1on).toBe(1);
    expect(view(s).lock0).toBe(1); // tank full now
    expect(buy(s, 0)).toBe("tankFull");
    expect(s.dollars).toBe(60);
  });

  it("anchors in use by polyps are skipped", () => {
    const s = createState(tank([jelly(0, 0, { anchor: 0 }), jelly(1, 0, { anchor: 1 })], { dollars: 200 }), seeded());
    expect(buy(s, 2)).toBe("bought");
    expect(s.slots[2]!.anchor).toBe(2);
    expect(s.slots[2]!.k).toBe(3);
  });

  it("decor is bought once", () => {
    const s = createState(moonTank({}, { dollars: 60 }), seeded());
    expect(buy(s, 3)).toBe("bought");
    expect(s.owned[0]).toBe(true);
    expect(s.dollars).toBe(35);
    const v = view(s);
    expect(v.own3).toBe(1);
    expect(v.lock3).toBe(1);
    expect(v.dec0).toBe(1);
    expect(buy(s, 3)).toBe("owned");
    expect(s.dollars).toBe(35);
  });

  it("can't buy what you can't afford", () => {
    const s = createState(moonTank({}, { dollars: 39 }), seeded());
    expect(view(s).lock0).toBe(1);
    expect(view(s).lock4).toBe(0);
    expect(buy(s, 0)).toBe("cantAfford");
    expect(buy(s, 7)).toBe("cantAfford");
    expect(s.dollars).toBe(39);
    expect(s.slots[1]).toBeNull();
  });
});

describe("saves", () => {
  it("a new game is one moon polyp and no dollars", () => {
    const save = loadSave(null, 5000);
    expect(save.v).toBe(10);
    expect(save.dollars).toBe(0);
    expect(save.slots.length).toBe(7);
    expect(save.slots[0]).toMatchObject({ k: 0, g: 0, anchor: 0 });
    expect(save.slots[1]).toBeNull();
    expect(save.slots[2]).toBeNull();
    expect(loadSave("not json", 5000)).toEqual(save);
    const s = createState(save, seeded());
    expect({ x: j0(s).x, y: j0(s).y }).toEqual(xy(POLYP_ANCHORS[0]!));
  });

  it("migrates a v1 save to one adult moon plus a 10-dollar welcome", () => {
    const v1 = { v: 1 as const, fullness: 0.55, murk: 0.2, affection: 0.66, night: true, lastSeen: 1000 };
    const save = migrateV1(v1);
    expect(save).toMatchObject({ v: 10, dollars: 10, night: true, lastSeen: 1000, tier: 0, cam: 0 });
    // v8: the old murk becomes a few spots on the glass that add up to it
    expect(save.murk).toBeCloseTo(0.2, 9);
    expect(save.spots.length).toBeGreaterThan(0);
    expect(save.slots[0]).toMatchObject({ k: 0, g: 3, fullness: 0.55, affection: 0.66 });
    expect(save.slots[1]).toBeNull();
    // through loadSave, with no time away
    const loaded = loadSave(JSON.stringify(v1), 1000);
    expect(loaded).toEqual(save);
    const s = createState(loaded, seeded());
    // the old lamp setting isn't an override: the clock decides
    expect(s.lamp).toBeNull();
    expect(s.nightTarget).toBe(isNightByClock(1000));
    expect(j0(s).mode).toBe("swim");
  });

  it("round-trips a v3 save", () => {
    const s = createState(tank([jelly(2, 3), jelly(1, 0, { anchor: 2 }), jelly(3, 1)], { dollars: 321, owned: [true, false, true, false, false] }), seeded());
    run(s, 5);
    const saved = toSave(s, 99);
    const loaded = loadSave(JSON.stringify(saved), 99);
    expect(loaded).toEqual(saved);
    const s2 = createState(loaded, seeded());
    expect(s2.slots.map((j) => j && [j.k, j.g, j.anchor, j.spot])).toEqual(s.slots.map((j) => j && [j.k, j.g, j.anchor, j.spot]));
    expect(s2.dollars).toBe(321);
    expect(s2.owned).toEqual([true, false, true, false, false]);
  });

  it("repairs a damaged v2 save", () => {
    const save = loadSave(JSON.stringify({ v: 2, slots: [{ k: 99, g: -1, fullness: "x" }, { k: 0, g: 0, anchor: 0 }], dollars: 1e9 }), 0);
    expect(save.slots[0]).toMatchObject({ k: 8, g: 0, fullness: 0.7 }); // clamped to the last species
    expect(save.dollars).toBe(9999);
    const s = createState(save, seeded());
    // both are polyps: they must not share a rock
    expect(s.slots[0]!.anchor).not.toBe(s.slots[1]!.anchor);
  });
});

// ---------------------------------------------------------------- v3

/** A pellet lying on the sand at centre x. */
function restFood(s: State, i: number, x: number) {
  const f = s.food[i]!;
  Object.assign(f, { state: "rest", x: x - (P + 1), y: sandAt(x) - 2 * P, vy: 0, age: 0, seed: 0, by: -1 });
}
/** A tank with just a polyp on the first rock (it can't reach the middle of the sand). */
const quietTank = (extra: Partial<Save> = {}) => tank([jelly(0, 0, { anchor: 0 })], extra);
const helpersOn = (snail: boolean, shrimp: boolean, crab: boolean) => ({ helpers: [snail, shrimp, crab] });

describe("v3 view", () => {
  it("writes exactly the v3 spec's props, all finite, with everything going on", () => {
    const s = createState(
      tank([jelly(1, 3), jelly(0, 0, { anchor: 1 }), jelly(2, 3)], { dollars: 500, owned: [true, true, true, true, true], ...helpersOn(true, true, true), lastSeen: 1e12 }),
      seeded(3),
    );
    feed(s);
    liftDecor(s, 2);
    moveDecor(s, 2, 100);
    openShop(s);
    setTab(s, 2);
    for (let i = 0; i < 20 * 60; i++) {
      step(s, 1 / 60);
      const v = view(s);
      if (i % 60 === 0) expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
      for (const [name, value] of Object.entries(v)) if (!Number.isFinite(value)) throw new Error(`${name} = ${value}`);
    }
  });

  it("the v3 additions are in the spec list", () => {
    const props = new Set(specProps());
    const want = ["shopTab0", "shopTab1", "shopTab2", "tab0Y", "tab1Y", "tab2Y", "pearl", "own10", "lock10", "own8", "lock9"];
    for (let d = 0; d < 5; d++) want.push(`dec${d}x`, `dec${d}y`, `dec${d}lift`);
    want.push("snailOn", "snailX", "snailY", "snailSX", "snailF0", "snailF1");
    for (const h of ["shrimp", "crab"]) for (const p of ["On", "X", "Y", "SX", "F0", "F1", "F2", "F3"]) want.push(h + p);
    for (const name of want) expect(props.has(name), name).toBe(true);
    expect(props.has("snailF2")).toBe(false);
  });
});

describe("helpers", () => {
  it("the shrimp walks to food resting on the sand and eats it, and that food never turns into murk", () => {
    const withShrimp = createState(quietTank(helpersOn(false, true, false)), seeded(2));
    const without = createState(quietTank(), seeded(2));
    for (const s of [withShrimp, without]) {
      restFood(s, 0, 330);
      restFood(s, 1, 560);
    }
    const events = run(withShrimp, 45);
    run(without, 45);
    expect(count(events, "shrimpAte")).toBe(2);
    expect(withShrimp.food[0]!.state).toBe("off");
    expect(withShrimp.food[1]!.state).toBe("off");
    // shrimp-eaten food feeds no jelly
    expect(count(events, "ate")).toBe(0);
    // left alone, the same two pellets spoil into grime on the glass (0.18 dirt each = +0.06 murk, and more as it grows)
    expect(without.murk - withShrimp.murk).toBeGreaterThan(0.06 - 1e-9);
  });

  it("the shrimp picks and eats with frames 2-3, then goes back to pottering", () => {
    const s = createState(quietTank(helpersOn(false, true, false)), seeded(4));
    restFood(s, 0, s.shrimp.x + 20);
    const frames = new Set<number>();
    for (let i = 0; i < 5 * 60; i++) {
      step(s, 1 / 60);
      const v = view(s);
      frames.add([0, 1, 2, 3].findIndex((f) => v[`shrimpF${f}`] === 1));
      expect([0, 1, 2, 3].reduce((a, f) => a + v[`shrimpF${f}`]!, 0)).toBe(1);
    }
    expect(frames.has(2) && frames.has(3)).toBe(true);
    expect(s.food[0]!.state).toBe("off");
  });

  it("the hermit crab digs up a sand dollar within 8 minutes, with a sparkle", () => {
    const s = createState(quietTank(helpersOn(false, false, true)), seeded(5));
    let dug: SimEvent | undefined;
    const frames = new Set<number>();
    for (let i = 0; i < (8 * 60 + 5) * 60 && !dug; i++) {
      dug = step(s, 1 / 60).find((e) => e.type === "dug");
      const v = view(s);
      frames.add([0, 1, 2, 3].findIndex((f) => v[`crabF${f}`] === 1));
    }
    expect(dug).toEqual({ type: "dug", amount: 5 });
    expect(frames.has(2) && frames.has(3)).toBe(true);
    expect(s.dollars).toBe(5);
    expect(view(s).fxO).toBe(1);
    expect(view(s).fxX).toBe(snap(s.crab.x));
    // and not again straight away: the next dig is 4-8 minutes off
    expect(count(run(s, 200), "dug")).toBe(0);
  });

  it("the snail heads for the dirtiest spot and grazes it while it sits on it", () => {
    const s = createState(quietTank(helpersOn(true, false, false)), seeded(8));
    s.nextVisit = Infinity;
    setMurk(s, 0);
    // a faint spot near the snail, a full one across the tank
    s.spots[0] = { x: s.snail.x + 60, y: s.snail.y, dirt: 0.2, v: 0, peak: 0.2 };
    s.spots[1] = { x: 540, y: 400, dirt: 1, v: 1, peak: 1 };
    s.spots[2] = { x: 300, y: 700, dirt: 0.5, v: 2, peak: 0.5 };
    s.spots[3] = { x: 150, y: 300, dirt: 0.8, v: 0, peak: 0.8 };
    s.nextSpot = Infinity;
    step(s, 1 / 60);
    expect(s.snailSpot).toBe(1);
    let t = 0;
    while (s.spots[1] && s.spots[1].dirt > 0.99 && t++ < 200 * 60) step(s, 1 / 60);
    // it got there and started on it
    expect(Math.hypot(s.snail.x - 540, s.snail.y - 400)).toBeLessThan(10);
    const m = s.murk;
    run(s, 5);
    expect(s.murk).toBeLessThan(m - 0.04);
    expect(Math.hypot(s.snail.x - 540, s.snail.y - 400)).toBeLessThan(10);
  });

  it("helpers stay in the water and on the sand line for ten minutes, and get about", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 2)], { ...helpersOn(true, true, true), dollars: 0 }), seeded(13));
    const seen = { snail: new Set<number>(), shrimp: new Set<number>(), crab: new Set<number>() };
    const facing = { shrimp: new Set<number>(), crab: new Set<number>(), snail: new Set<number>() };
    let snailPath = 0;
    let shrimpPath = 0;
    let crabPath = 0;
    let prev = { sn: { x: s.snail.x, y: s.snail.y }, sh: s.shrimp.x, cr: s.crab.x };
    for (let i = 0; i < 600 * 60; i++) {
      if (i % (45 * 60) === 0) feed(s);
      step(s, 1 / 60);
      const sn = s.snail;
      const sb = snailBounds(sn.x);
      expect(sn.x - SNAIL_SIZE.w / 2).toBeGreaterThan(K.glassL);
      expect(sn.x + SNAIL_SIZE.w / 2).toBeLessThan(K.glassR);
      expect(sn.y - SNAIL_SIZE.h / 2).toBeGreaterThan(K.waterTop);
      expect(sn.y).toBeLessThanOrEqual(sb.y1 + 1e-9);
      expect(sn.y + SNAIL_SIZE.h / 2).toBeLessThanOrEqual(sandAt(sn.x) + 1e-9);
      for (const [h, size] of [
        [s.shrimp, SHRIMP_SIZE],
        [s.crab, CRAB_SIZE],
      ] as const) {
        expect(h.x - size.w / 2).toBeGreaterThan(K.glassL);
        expect(h.x + size.w / 2).toBeLessThan(K.glassR);
        expect(h.y).toBe(sandAt(h.x));
        expect(Number.isFinite(h.x)).toBe(true);
      }
      if (i % 30 === 0) {
        const v = view(s);
        seen.snail.add([0, 1].findIndex((f) => v[`snailF${f}`] === 1));
        seen.shrimp.add([0, 1, 2, 3].findIndex((f) => v[`shrimpF${f}`] === 1));
        seen.crab.add([0, 1, 2, 3].findIndex((f) => v[`crabF${f}`] === 1));
        facing.snail.add(v.snailSX!);
        facing.shrimp.add(v.shrimpSX!);
        facing.crab.add(v.crabSX!);
        expect(v.snailY).toBe(snap(sn.y));
        expect(v.shrimpY).toBe(snap(s.shrimp.y));
      }
      snailPath += Math.hypot(sn.x - prev.sn.x, sn.y - prev.sn.y);
      shrimpPath += Math.abs(s.shrimp.x - prev.sh);
      crabPath += Math.abs(s.crab.x - prev.cr);
      prev = { sn: { x: sn.x, y: sn.y }, sh: s.shrimp.x, cr: s.crab.x };
    }
    // a slow crawl: about 8 px/s while moving, resting now and then
    expect(snailPath).toBeGreaterThan(1500);
    expect(snailPath).toBeLessThan(600 * 8 + 1);
    expect(shrimpPath).toBeGreaterThan(500);
    expect(crabPath).toBeGreaterThan(300);
    expect(seen.snail).toEqual(new Set([0, 1]));
    expect(seen.shrimp.has(0) && seen.shrimp.has(1)).toBe(true);
    expect(seen.crab.has(0) && seen.crab.has(1)).toBe(true);
    for (const f of Object.values(facing)) expect(f).toEqual(new Set([-1, 1]));
    expect(walkerBounds(SHRIMP_SIZE.w).x0).toBeGreaterThan(K.glassL);
  });

  it("helpers are hidden until bought", () => {
    const v = view(createState(quietTank(), seeded()));
    expect([v.snailOn, v.shrimpOn, v.crabOn]).toEqual([0, 0, 0]);
    const w = view(createState(quietTank(helpersOn(true, false, true)), seeded()));
    expect([w.snailOn, w.shrimpOn, w.crabOn]).toEqual([1, 0, 1]);
  });
});

describe("shop v3", () => {
  it("buys the snail, shrimp and crab once each", () => {
    const s = createState(moonTank({}, { dollars: 130 }), seeded());
    expect(view(s).lock8).toBe(0);
    expect(buy(s, 8)).toBe("bought");
    expect(s.dollars).toBe(100);
    expect(view(s)).toMatchObject({ own8: 1, lock8: 1, snailOn: 1, fxO: 1 });
    expect(buy(s, 8)).toBe("owned");
    expect(s.dollars).toBe(100);
    expect(buy(s, 9)).toBe("bought");
    expect(s.dollars).toBe(60);
    expect(view(s)).toMatchObject({ own9: 1, shrimpOn: 1 });
    expect(view(s).lock10).toBe(0);
    expect(buy(s, 10)).toBe("bought");
    expect(s.dollars).toBe(10);
    expect(view(s)).toMatchObject({ own10: 1, lock10: 1, crabOn: 1 });
    expect([buy(s, 8), buy(s, 9), buy(s, 10)]).toEqual(["owned", "owned", "owned"]);
    expect(s.helpers).toEqual([true, true, true]);
    expect(toSave(s, 0).helpers).toEqual([true, true, true]);
  });

  it("locks helpers you can't afford", () => {
    const s = createState(moonTank({}, { dollars: 35 }), seeded());
    const v = view(s);
    expect([v.lock8, v.lock9, v.lock10]).toEqual([0, 1, 1]);
    expect([v.own8, v.own9, v.own10]).toEqual([0, 0, 0]);
    expect(buy(s, 10)).toBe("cantAfford");
    expect(s.helpers).toEqual([false, false, false]);
  });

  it("tabs: one-hot highlight, active card group at 0, the rest moved away; opens on tab 0", () => {
    const s = createState(moonTank(), seeded());
    const tabs = () => {
      const v = view(s);
      return [0, 1, 2, 3].map((t) => [v[`shopTab${t}`], v[`tab${t}Y`]]);
    };
    openShop(s);
    expect(tabs()).toEqual([
      [1, 0],
      [0, 3000],
      [0, 3000],
      [0, 3000],
    ]);
    setTab(s, 2);
    expect(tabs()).toEqual([
      [0, 3000],
      [0, 3000],
      [1, 0],
      [0, 3000],
    ]);
    setTab(s, 3);
    expect(tabs()[3]).toEqual([1, 0]);
    setTab(s, 1);
    expect(tabs()[1]).toEqual([1, 0]);
    setTab(s, 5);
    setTab(s, -1);
    setTab(s, 0.5);
    expect(s.tab).toBe(1);
    closeShop(s);
    run(s, 0.5);
    openShop(s);
    expect(s.tab).toBe(0);
    expect([...TAB_ITEMS.flat()].sort((a, b) => a - b)).toEqual(Array.from({ length: SHOP_ITEMS.length }, (_, i) => i)); // every item on exactly one tab
  });
});

describe("arranging decorations", () => {
  it("defaults to the art's spots", () => {
    const s = createState(moonTank({}, { owned: [true, true, true, true, true] }), seeded());
    const v = view(s);
    DECOR.forEach((d, n) => {
      expect(v[`dec${n}x`]).toBe(snap(d.x));
      expect(v[`dec${n}y`]).toBe(snap(d.y));
      expect(v[`dec${n}lift`]).toBe(0);
    });
  });

  it("lift, move and drop: x clamps inside the glass and y follows the sand", () => {
    const s = createState(moonTank({}, { owned: [true, false, false, false, false] }), seeded());
    const d = DECOR[0]!;
    expect(liftDecor(s, 0)).toBe(true);
    expect(view(s).dec0lift).toBe(1);
    moveDecor(s, 0, -400);
    let v = view(s);
    expect(v.dec0x! - d.w / 2).toBeGreaterThanOrEqual(K.glassL);
    moveDecor(s, 0, 4000);
    v = view(s);
    expect(v.dec0x! + d.w / 2).toBeLessThanOrEqual(K.glassR);
    // follows the sand: keeps its depth below the sand top, so it rises and falls with the dunes
    const depth = d.y - sandAt(d.x);
    const ys = new Set<number>();
    for (const x of [150, 225, 330, 441, 520]) {
      moveDecor(s, 0, x);
      v = view(s);
      expect(v.dec0x).toBe(snap(x));
      expect(v.dec0y).toBe(snap(sandAt(v.dec0x!) + depth));
      expect(v.dec0y! % P).toBe(0);
      ys.add(v.dec0y!);
    }
    expect(ys.size).toBeGreaterThan(2);
    moveDecor(s, 0, Number.NaN);
    expect(Number.isFinite(view(s).dec0x)).toBe(true);
    dropDecor(s);
    expect(view(s).dec0lift).toBe(0);
    expect(s.decorX[0]).toBe(snap(520));
    // it stays where it was put, through a save
    const s2 = createState(loadSave(JSON.stringify(toSave(s, 0)), 0), seeded());
    expect(view(s2).dec0x).toBe(snap(520));
  });

  it("front pieces keep to the front edge of the sand bed", () => {
    for (let n = 1; n < 5; n++) {
      for (const x of [60, 200, 360, 500, 650]) expect(decorY(n, x)).toBeLessThanOrEqual(Math.max(K.waterBot, DECOR[n]!.y));
    }
  });

  it("decorations you don't own can't be lifted or moved", () => {
    const s = createState(moonTank(), seeded());
    expect(liftDecor(s, 1)).toBe(false);
    moveDecor(s, 1, 400);
    expect(s.decorX[1]).toBe(DECOR[1]!.x);
    expect(view(s).dec1lift).toBe(0);
  });

  it("decorAt hits owned decorations only, wherever they've been moved", () => {
    const s = createState(moonTank({}, { owned: [true, false, true, false, false] }), seeded());
    const mid = (n: number) => ({ x: s.decorX[n]!, y: decorBaseY(s, n) - DECOR[n]!.h / 2 });
    expect(decorAt(s, mid(0).x, mid(0).y)).toBe(0);
    expect(decorAt(s, mid(2).x, mid(2).y)).toBe(2);
    expect(decorAt(s, mid(1).x, mid(1).y)).toBe(-1); // the anchor isn't owned
    expect(decorAt(s, mid(3).x, mid(3).y)).toBe(-1); // nor the clam
    expect(decorAt(s, 360, 300)).toBe(-1); // open water
    const was = mid(0);
    moveDecor(s, 0, 150);
    expect(decorAt(s, mid(0).x, mid(0).y)).toBe(0);
    expect(decorAt(s, was.x, was.y)).toBe(-1);
  });
});

describe("names and the jelly card", () => {
  it("new jellies get cozy names not already in the tank", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = createState(tank([jelly(0, 3, { name: NAMES[seed % NAMES.length]! })], { dollars: 500 }), seeded(seed));
      expect(buy(s, 0)).toBe("bought");
      expect(buy(s, 1)).toBe("bought");
      const names = jellies(s).map((j) => j.name);
      expect(new Set(names).size).toBe(3);
      for (const n of names) expect(NAMES).toContain(n);
    }
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(NAMES).size).toBe(NAMES.length);
    for (const n of NAMES) expect(n.length).toBeLessThanOrEqual(12);
  });

  it("renames: trimmed, 1-12 characters, otherwise ignored", () => {
    const s = createState(moonTank(), seeded());
    expect(renameJelly(s, 0, "  Sir Wobble  ")).toBe(true);
    expect(j0(s).name).toBe("Sir Wobble");
    for (const bad of ["", "   ", "Thirteen char", "a\nb"]) {
      expect(renameJelly(s, 0, bad)).toBe(false);
      expect(j0(s).name).toBe("Sir Wobble");
    }
    expect(renameJelly(s, 0, "Twelve chars")).toBe(true);
    expect(j0(s).name).toBe("Twelve chars");
    expect(renameJelly(s, 0, "🪼🪼")).toBe(true);
    expect(renameJelly(s, 1, "Nobody")).toBe(false);
    // the name is saved
    expect(loadSave(JSON.stringify(toSave(s, 0)), 0).slots[0]!.name).toBe("🪼🪼");
  });

  it("jellyInfo: name, species, stage, age in days, fullness, mood", () => {
    const day = 86_400_000;
    const s = createState(tank([null, jelly(1, 2, { name: "Bloop", born: 1e12 - 3.5 * day, fullness: 0.6 })], { lastSeen: 1e12 }), seeded());
    expect(jellyInfo(s, 0)).toBeNull();
    const info = jellyInfo(s, 1)!;
    expect(info).toMatchObject({ name: "Bloop", k: 1, g: 2, ageDays: 3, fullness: 0.6 });
    expect(info.mood).toBeGreaterThan(0);
    expect(info.mood).toBeLessThanOrEqual(1);
  });

  it("jellyAt finds the body under the finger", () => {
    const s = createState(tank([jelly(0, 3), null, jelly(0, 0, { anchor: 2 })]), seeded());
    expect(jellyAt(s, j0(s).x, j0(s).y - 60)).toBe(0);
    const p = s.slots[2]!;
    expect(jellyAt(s, p.x, p.y - 20)).toBe(2);
    expect(jellyAt(s, 360, 80)).toBe(-1);
  });
});

describe("babies", () => {
  /** keep every jelly fed, loved and the water clean */
  const pamper = (s: State) => {
    s.murk = 0;
    for (const j of jellies(s)) {
      j.fullness = 1;
      j.affection = 1;
    }
  };

  it("a happy adult releases a polyp of its own species after 10 minutes of content time", () => {
    const s = createState(tank([jelly(1, 3, { name: "Boba" })]), seeded(3));
    const events: SimEvent[] = [];
    for (let i = 0; i < 590 * 60; i++) {
      pamper(s);
      events.push(...step(s, 1 / 60));
    }
    expect(count(events, "baby")).toBe(0);
    let baby: SimEvent | undefined;
    for (let i = 0; i < 20 * 60 && !baby; i++) {
      pamper(s);
      baby = step(s, 1 / 60).find((e) => e.type === "baby");
    }
    expect(baby).toEqual({ type: "baby", slot: 1, parent: 0 });
    const b = s.slots[1]!;
    expect(b).toMatchObject({ k: 1, g: 0, mode: "fixed" });
    expect({ x: b.x, y: b.y }).toEqual(xy(POLYP_ANCHORS[b.anchor]!));
    expect(b.name).not.toBe("Boba");
    expect(b.born).toBe(s.clock);
    expect(view(s).fxO).toBe(1);
    expect(j0(s).content).toBe(0);
  });

  it("the growth multiplier speeds it up; unhappy or young jellies build no content time", () => {
    const fast = createState(tank([jelly(3, 3)]), seeded(), { growthMultiplier: 20 });
    let born = 0;
    for (let i = 0; i < 31 * 60; i++) {
      pamper(fast);
      born += count(step(fast, 1 / 60), "baby");
    }
    expect(born).toBe(1);
    expect(fast.slots[1]!.k).toBe(3);
    const sad = createState(tank([jelly(0, 3, { fullness: 0.2 })], { murk: 0.5 }), seeded());
    run(sad, 30);
    expect(j0(sad).content).toBe(0);
    const young = createState(tank([jelly(0, 2)]), seeded());
    for (let i = 0; i < 60 * 60; i++) {
      pamper(young);
      step(young, 1 / 60);
    }
    expect(j0(young).content).toBe(0);
  });

  it("a full tank holds the timer at 10 minutes until there's room", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 3), jelly(3, 3)]), seeded(6));
    const events: SimEvent[] = [];
    for (let i = 0; i < 700 * 60; i++) {
      pamper(s);
      events.push(...step(s, 1 / 60));
    }
    expect(count(events, "baby")).toBe(0);
    expect(jellies(s).map((j) => j.content)).toEqual([BABY_SECONDS, BABY_SECONDS, BABY_SECONDS]);
    s.slots[1] = null;
    pamper(s);
    const now = step(s, 1 / 60);
    expect(count(now, "baby")).toBe(1);
    expect(s.slots[1]).toMatchObject({ k: 0, g: 0 }); // slot 0's moon goes first
  });
});

describe("daily pearl", () => {
  const lateEvening = new Date(2026, 9, 1, 23, 59, 0).getTime();
  const clamTank = (extra: Partial<Save> = {}) => quietTank({ owned: [false, false, false, true, false], lastSeen: lateEvening, ...extra });

  it("appears once a day while the clam is owned; a tap collects it for 15", () => {
    const s = createState(clamTank(), seeded());
    expect(count(step(s, 1 / 60), "pearlReady")).toBe(1);
    expect(view(s).pearl).toBe(1);
    expect(count(run(s, 5), "pearlReady")).toBe(0);
    const p = pearlCentre(s);
    expect(tap(s, p.x + 5, p.y - 5)).toBe("pearl");
    expect(s.dollars).toBe(15);
    expect(view(s).pearl).toBe(0);
    expect(view(s).fxO).toBe(1);
    expect(view(s).fxX).toBe(snap(p.x));
    const next = step(s, 1 / 60);
    expect(next.find((e) => e.type === "pearl")).toEqual({ type: "pearl", amount: 15 });
    expect(next.find((e) => e.type === "earned")).toEqual({ type: "earned", amount: 15 });
    // only one a day
    expect(tap(s, p.x, p.y)).not.toBe("pearl");
    expect(s.dollars).toBe(15);
    expect(s.pearlDay).toBe("2026-10-01");
    // past midnight a new one appears, announced once
    const events = run(s, 60);
    expect(dayKey(s.clock)).toBe("2026-10-02");
    expect(count(events, "pearlReady")).toBe(1);
    expect(pearlShowing(s)).toBe(true);
    expect(tap(s, p.x, p.y)).toBe("pearl");
    expect(s.dollars).toBe(30);
    expect(count(run(s, 60), "pearlReady")).toBe(0);
  });

  it("no clam, no pearl", () => {
    const s = createState(quietTank({ lastSeen: lateEvening }), seeded());
    expect(count(run(s, 120), "pearlReady")).toBe(0);
    expect(view(s).pearl).toBe(0);
    const p = pearlCentre(s);
    expect(tap(s, p.x, p.y)).not.toBe("pearl");
    expect(s.dollars).toBe(0);
  });

  it("buying the clam brings today's pearl", () => {
    const s = createState(quietTank({ dollars: 30, lastSeen: lateEvening }), seeded());
    run(s, 1);
    expect(buy(s, 6)).toBe("bought");
    expect(count(step(s, 1 / 60), "pearlReady")).toBe(1);
  });

  it("follows the clam when it's moved", () => {
    const s = createState(clamTank(), seeded());
    const before = pearlCentre(s);
    moveDecor(s, 3, 560);
    const after = pearlCentre(s);
    expect(after.x - before.x).toBe(snap(560) - DECOR[3]!.x);
    expect(tap(s, before.x, before.y)).not.toBe("pearl");
    expect(tap(s, after.x, after.y)).toBe("pearl");
  });

  it("is announced on load when it's a new day, not when today's is already collected", () => {
    const today = dayKey(lateEvening);
    const fresh = createState(loadSave(JSON.stringify(toSave(createState(clamTank({ pearlDay: "2026-09-30" }), seeded()), lateEvening)), lateEvening), seeded());
    expect(count(step(fresh, 1 / 60), "pearlReady")).toBe(1);
    const done = createState(loadSave(JSON.stringify(toSave(createState(clamTank({ pearlDay: today }), seeded()), lateEvening)), lateEvening), seeded());
    expect(count(step(done, 1 / 60), "pearlReady")).toBe(0);
    expect(view(done).pearl).toBe(0);
  });

  it("the sim clock runs from the save's time and can be resynced forward", () => {
    const s = createState(clamTank(), seeded());
    expect(s.clock).toBe(lateEvening);
    run(s, 2);
    expect(Math.abs(s.clock - (lateEvening + 2000))).toBeLessThan(1);
    syncClock(s, lateEvening + 3_600_000);
    expect(dayKey(s.clock)).toBe("2026-10-02");
    syncClock(s, 0);
    expect(dayKey(s.clock)).toBe("2026-10-02");
  });
});

describe("saves v3", () => {
  it("migrates a v2 save: names, born now, default decor, no helpers, pearl today", () => {
    const now = new Date(2026, 9, 1, 12, 0, 0).getTime();
    const v2 = {
      v: 2,
      slots: [
        { k: 0, g: 3, gp: 30, care: 10, fullness: 0.8, affection: 0.5, anchor: -1, spot: -1 },
        { k: 1, g: 0, gp: 1, care: 0, fullness: 0.6, affection: 0.4, anchor: 1, spot: -1 },
        null,
      ],
      dollars: 77,
      murk: 0.2,
      night: false,
      owned: [true, false, false, true, false],
      lastSeen: now,
    };
    const save = loadSave(JSON.stringify(v2), now);
    expect(save).toMatchObject({ v: 10, dollars: 77, helpers: [false, false, false], pearlDay: "", owned: [true, false, false, true, false], tier: 0, cam: 0 });
    expect(save.decorX).toEqual(DECOR.map((d) => d.x));
    const [a, b] = [save.slots[0]!, save.slots[1]!];
    expect(a).toMatchObject({ k: 0, g: 3, born: now, content: 0, fullness: 0.8 });
    expect(b).toMatchObject({ k: 1, g: 0, born: now, content: 0, anchor: 1 });
    expect(NAMES).toContain(a.name);
    expect(NAMES).toContain(b.name);
    expect(a.name).not.toBe(b.name);
    // loading the same save twice gives the same names
    expect(loadSave(JSON.stringify(v2), now)).toEqual(save);
    const s = createState(save, seeded());
    expect(count(step(s, 1 / 60), "pearlReady")).toBe(1);
  });

  it("migrates a v1 save straight to v5", () => {
    const v1 = { v: 1, fullness: 0.55, murk: 0.2, affection: 0.66, night: false, lastSeen: 1000 };
    const save = loadSave(JSON.stringify(v1), 5000);
    expect(save).toMatchObject({ v: 10, dollars: 10, helpers: [false, false, false], pearlDay: "", tier: 0, cam: 0 });
    expect(save.decorX).toEqual(DECOR.map((d) => d.x));
    expect(save.slots[0]).toMatchObject({ k: 0, g: 3, born: 5000, content: 0 });
    expect(NAMES).toContain(save.slots[0]!.name);
  });

  it("round-trips the v3 fields and repairs bad ones", () => {
    const s = createState(
      tank([jelly(0, 3, { name: "Pudding", born: 123, content: 77 })], { ...helpersOn(true, false, true), owned: [false, false, false, true, false], pearlDay: "2026-10-01" }),
      seeded(),
    );
    moveDecor(s, 3, 500);
    const saved = toSave(s, 10);
    const loaded = loadSave(JSON.stringify(saved), 10);
    expect(loaded).toEqual(saved);
    expect(loaded.slots[0]).toMatchObject({ name: "Pudding", born: 123, content: 77 });
    expect(loaded.decorX[3]).toBe(snap(500));
    const bad = loadSave(
      JSON.stringify({ ...saved, decorX: [99999, "x", null], helpers: "yes", pearlDay: "tomorrow", slots: [{ k: 0, g: 3, name: "  ", content: 1e9, born: "x" }] }),
      10,
    );
    expect(bad.decorX[0]).toBe(DECOR[0]!.x1);
    expect(bad.decorX[1]).toBe(DECOR[1]!.x);
    expect(bad.helpers).toEqual([false, false, false]);
    expect(bad.pearlDay).toBe("");
    expect(NAMES).toContain(bad.slots[0]!.name);
    expect(bad.slots[0]).toMatchObject({ content: BABY_SECONDS, born: 10 });
  });
});

describe("trailing tentacles", () => {
  const trailOfView = (v: Record<string, number>, slot = 0) => {
    const on = [...Array(TRAIL_N).keys()].filter((i) => v[`j${slot}tr${i}`] === 1);
    expect(on.length, `j${slot}tr one-hot`).toBe(1);
    for (let i = 0; i < TRAIL_N; i++) expect([0, 1]).toContain(v[`j${slot}tr${i}`]);
    return on[0]!;
  };
  /** park a wander target relative to the jelly that won't be replaced */
  const aim = (s: State, dx: number, dy: number) => {
    const j = j0(s);
    j.target = { x: j.x + dx, y: j.y + dy };
    j.targetKind = "wander";
    j.targetUntil = 1e9;
  };

  it("hysteresis: a speed between the in and out thresholds keeps the current pose", () => {
    const mid = -(PULSE_TRAIL.streamIn + PULSE_TRAIL.streamOut) / 2;
    expect(nextTrail(TRAIL_NEUTRAL, 0, mid, PULSE_TRAIL)).toBe(TRAIL_NEUTRAL);
    expect(nextTrail(TRAIL_STREAM, 0, mid, PULSE_TRAIL)).toBe(TRAIL_STREAM);
    expect(nextTrail(TRAIL_NEUTRAL, 0, -PULSE_TRAIL.streamIn - 1, PULSE_TRAIL)).toBe(TRAIL_STREAM);
    expect(nextTrail(TRAIL_STREAM, 0, -PULSE_TRAIL.streamOut + 1, PULSE_TRAIL)).toBe(TRAIL_NEUTRAL);
    const sink = (PULSE_TRAIL.fanIn + PULSE_TRAIL.fanOut) / 2;
    expect(nextTrail(TRAIL_NEUTRAL, 0, sink, PULSE_TRAIL)).toBe(TRAIL_NEUTRAL);
    expect(nextTrail(TRAIL_FAN, 0, sink, PULSE_TRAIL)).toBe(TRAIL_FAN);
    expect(nextTrail(TRAIL_NEUTRAL, 0, PULSE_TRAIL.fanIn + 1, PULSE_TRAIL)).toBe(TRAIL_FAN);
  });

  it("hysteresis: streams straight when rising, sweeps behind a sideways glide, never streams heading down", () => {
    expect(nextTrail(TRAIL_NEUTRAL, 30, 0, PULSE_TRAIL)).toBe(TRAIL_L); // moving right: trails left
    expect(nextTrail(TRAIL_NEUTRAL, -30, 0, PULSE_TRAIL)).toBe(TRAIL_R);
    expect(nextTrail(TRAIL_NEUTRAL, 10, -30, PULSE_TRAIL)).toBe(TRAIL_STREAM);
    // between the swept in/out ratios the streak keeps its shape
    expect(nextTrail(TRAIL_STREAM, 24, -30, PULSE_TRAIL)).toBe(TRAIL_STREAM);
    expect(nextTrail(TRAIL_L, 24, -30, PULSE_TRAIL)).toBe(TRAIL_L);
    // heading steeply down is never a streak; a sinking glide fans out
    expect(nextTrail(TRAIL_NEUTRAL, 5, 40, PULSE_TRAIL)).toBe(TRAIL_FAN);
    expect(nextTrail(TRAIL_STREAM, 20, 20, GLIDE_TRAIL)).toBe(TRAIL_FAN);
    // a glider at rest relaxes
    expect(nextTrail(TRAIL_NEUTRAL, 1, -1, GLIDE_TRAIL)).toBe(TRAIL_FAN);
  });

  it("a moon jelly rising after a pulse streams its tentacles below it", () => {
    for (const g of [3, 2] as Stage[]) {
      const s = createState(tank([jelly(0, g)]), seeded(4));
      aim(s, 0, -400);
      let pulses = 0;
      let streamedAfter = 0;
      let sinceP = Infinity;
      let streamedThisPulse = false;
      for (let i = 0; i < 9 * 60; i++) {
        const ev = step(s, 1 / 60);
        if (count(ev, "pulse", 0)) {
          if (pulses > 0 && streamedThisPulse) streamedAfter++;
          pulses++;
          sinceP = 0;
          streamedThisPulse = false;
        }
        sinceP += 1 / 60;
        const tr = trailOfView(view(s));
        if (tr === TRAIL_STREAM && sinceP < 1) {
          streamedThisPulse = true;
          expect(j0(s).vy, "streams only while rising").toBeLessThan(0);
        }
        expect([TRAIL_L, TRAIL_R], "rising straight up never sweeps sideways").not.toContain(tr);
      }
      expect(pulses).toBeGreaterThanOrEqual(3);
      expect(streamedAfter, `stage ${g}: every pulse streams`).toBe(pulses - 1);
    }
  });

  it("a jelly that stops pulsing sinks with its tentacles fanned out", () => {
    for (const k of [0, 1] as Species[]) {
      const s = createState(tank([jelly(k, 3)]), seeded(5));
      aim(s, 0, 0); // already there: no thrust, it just sinks
      run(s, 1.5);
      expect(j0(s).vy).toBeGreaterThan(0);
      for (let i = 0; i < 60; i++) {
        step(s, 1 / 60);
        aim(s, 0, 0);
        expect(trailOfView(view(s)), `species ${k}`).toBe(TRAIL_FAN);
      }
    }
  });

  it("doesn't flicker: every pose is held a moment, a few changes per pulse", () => {
    for (const [k, g] of [[0, 3], [1, 3], [0, 2], [1, 2], [3, 3]] as [Species, Stage][]) {
      const s = createState(tank([jelly(k, g)]), seeded(9));
      const hold = (k === 3 ? GLIDE_TRAIL : PULSE_TRAIL).hold;
      let cur = trailOfView(view(s));
      let len = 0;
      let changes = 0;
      let pulses = 0;
      for (let i = 0; i < 40 * 60; i++) {
        pulses += count(step(s, 1 / 60), "pulse", 0);
        const tr = trailOfView(view(s));
        len++;
        if (tr !== cur) {
          if (changes > 0) expect(len / 60, `${k}/${g}: held ${cur}`).toBeGreaterThanOrEqual(hold - 1e-9);
          changes++;
          cur = tr;
          len = 0;
        }
      }
      expect(changes, `${k}/${g} moves its tentacles`).toBeGreaterThan(2);
      if (k !== 3) expect(changes / pulses, `${k}/${g} changes per pulse`).toBeLessThanOrEqual(5);
      else expect(changes, "the comb glides smoothly").toBeLessThan(40);
    }
  });

  it("a comb jelly's tentacles stream behind its glide", () => {
    for (const [dx, want] of [[300, TRAIL_L], [-300, TRAIL_R]] as const) {
      const s = createState(tank([jelly(3, 3)]), seeded(2));
      j0(s).x = 360;
      aim(s, dx, 0);
      run(s, 3);
      expect(trailOfView(view(s))).toBe(want);
    }
    const s = createState(tank([jelly(3, 2)]), seeded(2));
    aim(s, 0, -400);
    run(s, 3);
    expect(trailOfView(view(s))).toBe(TRAIL_STREAM);
  });

  it("polyps, ephyrae and settled upside-downs keep the neutral pose; empty slots write all zeros", () => {
    const s = createState(tank([jelly(0, 0, { anchor: 0 }), jelly(1, 1), jelly(2, 3, { spot: 0 })]), seeded(6));
    for (let i = 0; i < 10 * 60; i++) {
      step(s, 1 / 60);
      if (i % 10) continue;
      const v = view(s);
      for (const slot of [0, 1, 2]) expect(trailOfView(v, slot)).toBe(TRAIL_NEUTRAL);
    }
    const one = createState(tank([jelly(0, 3)]), seeded(6));
    const v = view(one);
    for (let i = 0; i < TRAIL_N; i++) expect(v[`j1tr${i}`]).toBe(0);
  });
});

// ---------------------------------------------------------------- polish round

describe("while you were away", () => {
  const T0 = at(10);
  const MIN = 60_000;
  const back = (save: Save, ms: number) => loadGame(JSON.stringify(save), T0 + ms);

  it("names a jelly that grew, by its stage", () => {
    const polyp = tank([jelly(0, 0, { anchor: 0, gp: 3, fullness: 0.9, name: "Mochi" })], { lastSeen: T0 });
    expect(back(polyp, 120 * MIN).away!.lines).toContain("Mochi budded into an ephyra.");
    const ephyra = tank([jelly(1, 1, { gp: 11, fullness: 0.9, name: "Pudding" })], { lastSeen: T0 });
    expect(back(ephyra, 120 * MIN).away!.lines).toContain("Pudding grew into a juvenile.");
    const juvenile = tank([jelly(3, 2, { gp: 29, fullness: 0.9, name: "Nori" })], { lastSeen: T0 });
    expect(back(juvenile, 120 * MIN).away!.lines).toContain("Nori grew into an adult.");
    // and the stage-up it promises happens on the first step back
    const s = createState(back(polyp, 120 * MIN).save, seeded());
    expect(count(step(s, 1 / 60), "grew", 0)).toBe(1);
  });

  it("says who got hungry", () => {
    const one = back(tank([jelly(0, 3, { fullness: 0.35, name: "Bloop" })], { lastSeen: T0 }), 60 * MIN).away!;
    expect(one.lines).toContain("Bloop got hungry.");
    expect(one.seconds).toBe(3600);
    const two = back(tank([jelly(0, 3, { fullness: 0.35, name: "Bloop" }), jelly(1, 3, { fullness: 0.4, name: "Pip" })], { lastSeen: T0 }), 120 * MIN).away!;
    expect(two.lines).toContain("Bloop and Pip got hungry.");
    // already hungry when you left isn't news
    const still = back(tank([jelly(0, 3, { fullness: 0.2, name: "Bloop" })], { lastSeen: T0 }), 60 * MIN).away!;
    expect(still.lines.some((l) => l.includes("hungry"))).toBe(false);
  });

  it("says when the water got cloudy", () => {
    const away = back(tank([jelly(0, 3, { fullness: 0.9 })], { murk: 0.45, lastSeen: T0 }), 120 * MIN).away!;
    expect(away.lines).toContain("The water got cloudy.");
    // v8: left alone the glass gets grimy within the hour; with the snail it stays lightly cloudy
    expect(back(tank([jelly(0, 3, { fullness: 0.9 })], { murk: 0.1, lastSeen: T0 }), 120 * MIN).away!.lines).toContain("The water got cloudy.");
    const clear = back(tank([jelly(0, 3, { fullness: 0.9 })], { murk: 0.1, helpers: [true, false, false], lastSeen: T0 }), 120 * MIN).away!;
    expect(clear.lines).not.toContain("The water got cloudy.");
  });

  it("says when a new day's pearl is waiting", () => {
    const clam = (pearlDay: string, lastSeen: number) => tank([jelly(0, 3, { fullness: 0.9 })], { owned: [false, false, false, true, false], pearlDay, lastSeen });
    const evening = at(20, 0, 1);
    const morning = at(9, 0, 2);
    const fromEvening = (save: Save) => loadGame(JSON.stringify(save), morning).away!.lines;
    expect(fromEvening(clam(dayKey(evening), evening))).toContain("A pearl is waiting in the clam.");
    // same day, already collected: nothing new
    expect(loadGame(JSON.stringify(clam(dayKey(T0), T0)), T0 + 60 * MIN).away!.lines).not.toContain("A pearl is waiting in the clam.");
    // no clam, no pearl
    expect(fromEvening(tank([jelly(0, 3, { fullness: 0.9 })], { lastSeen: evening })).join(" ")).not.toContain("pearl");
  });

  it("is null for under 10 minutes or a new game", () => {
    const save = tank([jelly(0, 3, { fullness: 0.35 })], { lastSeen: T0 });
    expect(back(save, 9 * MIN).away).toBeNull();
    expect(back(save, 10 * MIN).away).not.toBeNull();
    expect(loadGame(null, T0).away).toBeNull();
    expect(loadGame("garbage", T0).away).toBeNull();
    expect(loadGame(JSON.stringify(save), T0 - 3600_000).away).toBeNull();
  });

  it("at most 4 lines, hunger kept; a quiet absence still gets one", () => {
    const busy = tank(
      [
        jelly(0, 0, { anchor: 0, gp: 3, fullness: 0.32, name: "Mochi" }),
        jelly(1, 1, { gp: 11, fullness: 0.32, name: "Bloop" }),
        jelly(2, 2, { gp: 29, fullness: 0.9, name: "Pip" }),
      ],
      { murk: 0.45, owned: [false, false, false, true, false], pearlDay: dayKey(at(20, 0, 1)), lastSeen: at(20, 0, 1) },
    );
    const lines = loadGame(JSON.stringify(busy), at(9, 0, 2)).away!.lines;
    // three stage-ups, hunger, cloudy water and a pearl: hunger is kept, the lowest priorities drop
    expect(lines).toEqual(["Mochi budded into an ephyra.", "Bloop grew into a juvenile.", "Pip grew into an adult.", "Mochi, Bloop and Pip got hungry."]);
    const quiet = back(tank([jelly(0, 3, { fullness: 0.9, name: "Mochi" })], { murk: 0.05, helpers: [true, false, false], lastSeen: T0 }), 30 * MIN).away!;
    expect(quiet.lines).toEqual(["Mochi drifted about."]);
  });

  it("loadSave is loadGame's save", () => {
    const raw = JSON.stringify(tank([jelly(0, 3, { fullness: 0.35 })], { lastSeen: T0 }));
    expect(loadSave(raw, T0 + 7200_000)).toEqual(loadGame(raw, T0 + 7200_000).save);
  });
});

describe("day and night from the clock", () => {
  it("night is 19:00 to 07:00 local time", () => {
    expect(isNightByClock(at(18, 59))).toBe(false);
    expect(isNightByClock(at(19, 0))).toBe(true);
    expect(isNightByClock(at(6, 59))).toBe(true);
    expect(isNightByClock(at(7, 0))).toBe(false);
    expect(isNightByClock(at(0, 0))).toBe(true);
    expect(nextLightChange(at(12))).toBe(at(19));
    expect(nextLightChange(at(19))).toBe(at(7, 0, 2));
    expect(nextLightChange(at(3))).toBe(at(7));
  });

  it("a new tank shows the clock's state, and follows it", () => {
    const day = createState(moonTank({}, { lastSeen: at(18, 59) }), seeded());
    expect(day.nightTarget).toBe(false);
    expect(view(day).nightShade).toBe(0);
    run(day, 61);
    expect(day.nightTarget).toBe(true);
    const night = createState(moonTank({}, { lastSeen: at(23) }), seeded());
    expect(night.nightTarget).toBe(true);
    expect(view(night).nightShade).toBe(1);
  });

  it("the lamp overrides until the next scheduled change, then the clock takes over", () => {
    const s = createState(moonTank({}, { lastSeen: NOON }), seeded());
    toggleLamp(s);
    expect(s.nightTarget).toBe(true);
    expect(s.lamp).toEqual({ night: true, until: at(19) });
    syncClock(s, at(18, 59));
    step(s, 1 / 60);
    expect(s.nightTarget).toBe(true);
    expect(s.lamp).not.toBeNull();
    syncClock(s, at(19, 0) + 500);
    step(s, 1 / 60);
    expect(s.lamp).toBeNull();
    expect(s.nightTarget).toBe(true);
    // the override is gone: morning comes on schedule
    syncClock(s, at(7, 0, 2) + 500);
    step(s, 1 / 60);
    expect(s.nightTarget).toBe(false);

    // lamp on in the evening: day until 07:00, then (still day) the clock; 19:00 brings night
    const e = createState(moonTank({}, { lastSeen: at(20) }), seeded());
    toggleLamp(e);
    expect(e.nightTarget).toBe(false);
    syncClock(e, at(6, 59, 2));
    step(e, 1 / 60);
    expect(e.nightTarget).toBe(false);
    syncClock(e, at(19, 0, 2) + 500);
    step(e, 1 / 60);
    expect(e.nightTarget).toBe(true);
  });

  it("switching back to the clock's state drops the override", () => {
    const s = createState(moonTank({}, { lastSeen: NOON }), seeded());
    toggleLamp(s);
    toggleLamp(s);
    expect(s.lamp).toBeNull();
    expect(s.nightTarget).toBe(false);
  });

  it("the override survives save and load, and not past its end", () => {
    const s = createState(moonTank({}, { lastSeen: NOON }), seeded());
    toggleLamp(s);
    const raw = JSON.stringify(toSave(s, NOON));
    const soon = createState(loadSave(raw, at(13)), seeded());
    expect(soon.lamp).toEqual({ night: true, until: at(19) });
    expect(soon.nightTarget).toBe(true);
    expect(view(soon).nightShade).toBe(1);
    // back tomorrow morning: the override ran out, it's day by the clock
    const later = createState(loadSave(raw, at(9, 0, 2)), seeded());
    expect(later.lamp).toBeNull();
    expect(later.nightTarget).toBe(false);
    // a damaged override is dropped
    const bad = loadSave(JSON.stringify({ ...toSave(s, NOON), lamp: { night: "yes", until: 5 } }), NOON);
    expect(bad.lamp).toBeNull();
  });
});

describe("rehoming", () => {
  it("only juveniles and adults, and never the last jelly", () => {
    const s = createState(tank([jelly(0, 0, { anchor: 0 }), jelly(1, 1), jelly(0, 3)]), seeded());
    expect(canRehome(s, 0)).toBe(false);
    expect(canRehome(s, 1)).toBe(false);
    expect(rehome(s, 0)).toBeNull();
    expect(rehome(s, 1)).toBeNull();
    expect(canRehome(s, 2)).toBe(true);
    expect(rehome(s, 7)).toBeNull();
    expect(rehomeInfo(s, 0)).toMatchObject({ allowed: false, reward: 0 });
    expect(rehomeInfo(s, 1).allowed).toBe(false);
    expect(rehomeInfo(s, 2)).toEqual({ allowed: true, reward: 30, reason: "" });
    const last = createState(tank([jelly(0, 3, { name: "Mochi" })]), seeded());
    expect(rehomeInfo(last, 0)).toEqual({ allowed: false, reward: 30, reason: "Mochi is your only jelly." });
    expect(canRehome(last, 0)).toBe(false);
    expect(rehome(last, 0)).toBeNull();
    expect(last.slots[0]).not.toBeNull();
  });

  it("pays 15 for a juvenile and 30 for an adult, with events and a sparkle where it was", () => {
    const s = createState(tank([jelly(0, 2, { name: "Pip" }), jelly(1, 3, { name: "Bao" }), jelly(0, 0, { anchor: 0 })]), seeded());
    const { x, y } = j0(s);
    expect(rehome(s, 0)).toEqual({ name: "Pip", dollars: 15 });
    expect(s.dollars).toBe(15);
    expect(s.slots[0]).toBeNull();
    expect(s.fx).not.toBeNull();
    expect(Math.abs(s.fx!.x - x)).toBeLessThan(1);
    expect(s.fx!.y).toBeLessThan(y);
    const ev = step(s, 1 / 60);
    const i = ev.findIndex((e) => e.type === "rehomed");
    expect(ev[i]).toMatchObject({ type: "rehomed", slot: 0 });
    expect(ev[i + 1]).toMatchObject({ type: "earned", slot: 0, amount: 15 });
    expect(Number.isFinite(ev[i + 1]!.x) && Number.isFinite(ev[i + 1]!.y)).toBe(true);
    expect(view(s).fxO).toBe(1);
    expect(view(s).j0on).toBe(0);
    expect(rehome(s, 1)).toEqual({ name: "Bao", dollars: 30 });
    expect(s.dollars).toBe(45);
    expect(count(step(s, 1 / 60), "rehomed", 1)).toBe(1);
    // the polyp stays: it's the last one now
    expect(rehome(s, 2)).toBeNull();
  });

  it("frees the slot so a new polyp can be bought", () => {
    const s = createState(tank([jelly(2, 3, { spot: 0 }), jelly(0, 0, { anchor: 0 }), jelly(1, 0, { anchor: 1 })], { dollars: 100 }), seeded());
    openShop(s);
    expect(buy(s, 0)).toBe("tankFull");
    expect(view(s).lock0).toBe(1);
    expect(rehome(s, 0)?.dollars).toBe(30);
    expect(view(s).lock0).toBe(0);
    expect(buy(s, 0)).toBe("bought");
    expect(s.slots[0]).toMatchObject({ k: 1, g: 0, mode: "fixed", anchor: 2 });
  });

  it("a rehomed upside-down's sand spot goes to the next one to settle", () => {
    const s = createState(tank([jelly(2, 3, { spot: 0 }), jelly(2, 1, { gp: 11 }), jelly(0, 0, { anchor: 0 })]), seeded());
    rehome(s, 0);
    s.slots[1]!.gp = 12;
    run(s, 20);
    expect(s.slots[1]).toMatchObject({ mode: "settled", spot: 0 });
  });
});

describe("shrimp and crab on the open sand", () => {
  const inside = (x: number, w: number) => x - w / 2 >= OPEN_SAND.x0 - 1e-9 && x + w / 2 <= OPEN_SAND.x1 + 1e-9;

  it("OPEN_SAND is the open stretch the art measured", () => {
    expect(OPEN_SAND).toEqual({ x0: 186, x1: 450 });
    expect(openSandBounds(CRAB_SIZE.w).x1).toBeGreaterThan(openSandBounds(CRAB_SIZE.w).x0);
  });

  it("both stay on it for ten minutes; the shrimp leaves only to fetch food, then comes back", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 2)], helpersOn(false, true, true)), seeded(21));
    let outsideNoFood = 0;
    let longest = 0;
    let wentOut = false;
    for (let i = 0; i < 600 * 60; i++) {
      // a pellet lying out by the chest every couple of minutes
      if (i % (120 * 60) === 0) restFood(s, 9, 640);
      step(s, 1 / 60);
      expect(inside(s.crab.x, CRAB_SIZE.w)).toBe(true);
      if (inside(s.shrimp.x, SHRIMP_SIZE.w)) {
        outsideNoFood = 0;
        continue;
      }
      wentOut = true;
      const fetching = s.shrimp.mode === "act" || s.food.some((f) => f.state === "rest");
      outsideNoFood = fetching ? 0 : outsideNoFood + 1 / 60;
      longest = Math.max(longest, outsideNoFood);
    }
    expect(wentOut).toBe(true);
    // the walk back from the chest at the hurry speed
    expect(longest).toBeLessThan(8);
  });

  it("with no food about, the shrimp keeps to the open sand and gets about", () => {
    const s = createState(quietTank(helpersOn(false, true, true)), seeded(4));
    let path = 0;
    let crabPath = 0;
    let prev = { sh: s.shrimp.x, cr: s.crab.x };
    for (let i = 0; i < 600 * 60; i++) {
      step(s, 1 / 60);
      expect(inside(s.shrimp.x, SHRIMP_SIZE.w)).toBe(true);
      expect(inside(s.crab.x, CRAB_SIZE.w)).toBe(true);
      expect(s.shrimp.y).toBe(sandAt(s.shrimp.x));
      path += Math.abs(s.shrimp.x - prev.sh);
      crabPath += Math.abs(s.crab.x - prev.cr);
      prev = { sh: s.shrimp.x, cr: s.crab.x };
    }
    expect(path).toBeGreaterThan(500);
    expect(crabPath).toBeGreaterThan(300);
  });

  it("the shrimp fetches a pellet from behind the rocks and walks straight back", () => {
    const s = createState(tank([jelly(0, 3)], helpersOn(false, true, false)), seeded(2));
    restFood(s, 0, 120);
    let t = 0;
    while (!step(s, 1 / 60).some((e) => e.type === "shrimpAte") && t++ < 60 * 60);
    expect(s.shrimp.x).toBeLessThan(OPEN_SAND.x0);
    run(s, 6);
    expect(inside(s.shrimp.x, SHRIMP_SIZE.w)).toBe(true);
  });
});

describe("the snail grazes the spots", () => {
  const snailTank = (murk: number, lastSeen = 0, tier = 0) => tank([jelly(0, 3, { fullness: 0.9 })], { ...helpersOn(true, false, false), murk, lastSeen, tier });
  const runFast = (s: State, seconds: number, each?: () => void) => {
    s.nextVisit = Infinity; // the snail alone: a visiting diver would wipe the glass too
    for (let i = 0; i < seconds * 10; i++) {
      step(s, 0.1);
      each?.();
    }
  };

  it("brings murk from 0.9 down to lightly cloudy and keeps it there, never below 0.3", () => {
    for (const tier of [0, 2]) {
      const s = createState(snailTank(0.9, 0, tier), seeded());
      runFast(s, 15 * 60);
      expect(s.murk, `tier ${tier}`).toBeLessThan(0.6);
      let lowest = 1;
      let sum = 0;
      let n = 0;
      runFast(s, 30 * 60, () => {
        lowest = Math.min(lowest, s.murk);
        sum += s.murk;
        n++;
      });
      expect(lowest).toBeGreaterThanOrEqual(SNAIL_FLOOR - 1e-9);
      expect(sum / n, `tier ${tier}`).toBeLessThan(0.45);
      // scrubbing (or the old sweep) is what gets the water clear
      clean(s);
      runFast(s, 2);
      expect(s.murk).toBeLessThan(0.01);
    }
  });

  it("without the snail, dirty water stays dirty", () => {
    const s = createState(tank([jelly(0, 3)], { murk: 0.9 }), seeded());
    runFast(s, 10 * 60);
    expect(s.murk).toBeGreaterThan(0.9);
  });

  it("works while you're away too, down to 0.3 and no further", () => {
    expect(applyAway(snailTank(0.9), 15 * 60_000).murk).toBeLessThan(0.4);
    expect(applyAway(snailTank(0.9), 5 * 3600_000).murk).toBeCloseTo(SNAIL_FLOOR, 6);
    expect(applyAway(snailTank(0.1), 48 * 3600_000).murk).toBeCloseTo(SNAIL_FLOOR, 6);
    expect(applyAway(snailTank(0.1), 48 * 3600_000).murk).toBeGreaterThanOrEqual(SNAIL_FLOOR - 1e-9);
    // murky water clears in time for the rest of the absence to count as good care
    expect(applyAway(snailTank(0.9), 3 * 3600_000).slots[0]!.gp).toBeGreaterThan(30);
    expect(loadGame(JSON.stringify(snailTank(0.9, at(10))), at(11)).away!.lines).toContain("The snail cleaned the glass.");
  });
});

describe("demo save", () => {
  const afternoon = at(14);

  it("loads as a night-time tank: Mochi mid-tank, a polyp one meal from budding, the castle, 200 dollars", () => {
    const save = demoSave(afternoon);
    expect(loadSave(JSON.stringify(save), afternoon)).toEqual(save);
    expect(loadGame(JSON.stringify(save), afternoon).away).toBeNull();
    const s = createState(loadSave(JSON.stringify(save), afternoon), seeded(), { growthMultiplier: 1 });
    expect(s.nightTarget).toBe(true);
    expect(s.lamp!.until).toBe(at(19));
    expect(view(s).nightShade).toBe(1);
    expect(s.dollars).toBe(200);
    expect(s.owned).toEqual([true, false, false, false, false]);
    expect(s.helpers).toEqual([false, false, false]);
    expect(s.murk).toBe(0);
    expect(pearlShowing(s)).toBe(false);
    expect(j0(s)).toMatchObject({ name: "Mochi", k: 0, g: 3, mode: "swim" });
    expect(Math.abs(j0(s).x - K.W / 2)).toBeLessThan(60);
    const polyp = s.slots[1]!;
    expect(polyp).toMatchObject({ k: 0, g: 0, anchor: 0, gp: 3 });
    expect(s.slots[2]).toBeNull();
    // exactly the spec's props, and the contract's once it has the v5 ones
    expect(new Set(Object.keys(view(s)))).toEqual(new Set(specProps()));
    if (K.props.includes("wallX")) expect(new Set(Object.keys(view(s)))).toEqual(new Set(K.props));
    expect(view(s).camX).toBe(0);
    expect(view(s).wallX).toBe(720);
    expect(s.tier).toBe(0);
  });

  it("a single feed buds the polyp; left alone it doesn't bud first", () => {
    const idle = createState(demoSave(afternoon), seeded(), { growthMultiplier: 1 });
    expect(count(run(idle, 180), "grew")).toBe(0);
    const s = createState(demoSave(afternoon), seeded(), { growthMultiplier: 1 });
    feed(s);
    const events = run(s, 20);
    expect(events.find((e) => e.type === "grew")).toMatchObject({ slot: 1, stage: 1 });
  });

  it("near a scheduled change, the night holds through the clip", () => {
    const early = at(6, 50);
    const s = createState(demoSave(early), seeded());
    expect(s.nightTarget).toBe(true);
    syncClock(s, early + 3600_000);
    step(s, 1 / 60);
    expect(s.nightTarget).toBe(true);
  });
});

// ---------------------------------------------------------------- v5: bigger tanks you swipe across

describe("v5: tank tiers", () => {
  it("the tiers are Small 720 / 3, Medium 1080 / 5 for 150, Large 1440 / 7 for 400", () => {
    expect(TIERS.map((t) => [t.worldW, t.maxJellies])).toEqual([
      [720, 3],
      [1080, 5],
      [1440, 7],
    ]);
    expect(MAX_SLOTS).toBe(7);
    expect([11, 12].map((i) => [SHOP_ITEMS[i]!.name, SHOP_ITEMS[i]!.price, SHOP_ITEMS[i]!.kind])).toEqual([
      ["MEDIUM TANK", 150, "tank"],
      ["LARGE TANK", 400, "tank"],
    ]);
    expect(TAB_ITEMS[3]!.slice(0, 2)).toEqual([11, 12]); // v11: the themes follow
  });

  it("buying: large needs medium first, each is bought once, and you need the dollars", () => {
    const s = createState(moonTank({}, { dollars: 549 }), seeded());
    openShop(s);
    setTab(s, 3);
    run(s, 0.5);
    let v = view(s);
    expect([v.own11, v.lock11, v.own12, v.lock12]).toEqual([0, 0, 0, 1]);
    if ("needs12" in v) expect(v.needs12).toBe(1);
    expect(buy(s, 12)).toBe("needsMedium");
    expect(s.dollars).toBe(549);
    expect(buy(s, 11)).toBe("bought");
    expect(s.dollars).toBe(399);
    expect(s.tier).toBe(1);
    expect(worldW(s)).toBe(1080);
    expect(maxJellies(s)).toBe(5);
    expect(buy(s, 11)).toBe("owned");
    v = view(s);
    expect([v.own11, v.lock11, v.own12, v.lock12]).toEqual([1, 1, 0, 1]); // 399 < 400
    if ("needs12" in v) expect(v.needs12).toBe(0);
    expect(buy(s, 12)).toBe("cantAfford");
    s.dollars = 400;
    expect(view(s).lock12).toBe(0);
    expect(buy(s, 12)).toBe("bought");
    expect(s.dollars).toBe(0);
    expect(s.tier).toBe(2);
    expect(buy(s, 12)).toBe("owned");
    expect(buy(s, 11)).toBe("owned");
    v = view(s);
    expect([v.own11, v.own12, v.lock11, v.lock12]).toEqual([1, 1, 1, 1]);
    // not enough for the medium either
    const poor = createState(moonTank({}, { dollars: 149 }), seeded());
    expect(buy(poor, 11)).toBe("cantAfford");
    expect(poor.tier).toBe(0);
    expect(view(poor).lock11).toBe(1);
  });

  it("after buying, the shop shuts, the wall slides out over ~1.2 s and the camera follows it to the new space", () => {
    const s = createState(moonTank({}, { dollars: 150 }), seeded());
    openShop(s);
    run(s, 0.5);
    expect(buy(s, 11)).toBe("bought");
    expect(isShopOpen(s)).toBe(false);
    const walls: number[] = [];
    const cams: number[] = [];
    const events: SimEvent[] = [];
    let arrived = -1;
    for (let i = 0; i < 3 * 60; i++) {
      events.push(...step(s, 1 / 60));
      const v = view(s);
      walls.push(v.wallX!);
      cams.push(v.camX!);
      // never shows past the wall
      expect(v.camX!).toBeGreaterThanOrEqual(-(v.wallX! - 720));
      expect(v.camX!).toBeLessThanOrEqual(0);
      if (arrived < 0 && v.wallX === 1080) arrived = (i + 1) / 60;
    }
    // waits for the shop to slide shut, then takes WALL_TIME
    expect(walls[0]).toBe(720);
    expect(walls.at(-1)).toBe(1080);
    for (let i = 1; i < walls.length; i++) expect(walls[i]!).toBeGreaterThanOrEqual(walls[i - 1]!);
    expect(arrived).toBeGreaterThan(0.35 + WALL_TIME - 0.1);
    expect(arrived).toBeLessThan(0.35 + WALL_TIME + 0.1);
    // the camera ends showing the new stretch, the wall at the right edge of the screen
    expect(cams.at(-1)).toBe(-360);
    expect(REVEAL_TIME).toBeGreaterThan(WALL_TIME);
    expect(events.filter((e) => e.type === "upgraded")).toEqual([{ type: "upgraded", tier: 1 }]);
    const rev = events.filter((e) => e.type === "revealed");
    expect(rev.length).toBe(1);
    expect(rev[0]).toMatchObject({ tier: 1 });
    expect(rev[0]!.x!).toBeGreaterThan(720);
    expect(rev[0]!.x!).toBeLessThan(1080);
    // and the camera clamps to the new width
    panBy(s, -5000);
    expect(camX(s)).toBe(-360);
    panBy(s, 5000);
    expect(camX(s)).toBe(0);
  });

  it("the sparkle waits for the wall, then goes off in the new space", () => {
    const s = createState(moonTank({}, { dollars: 150 }), seeded());
    buy(s, 11); // shop shut: no wait
    expect(view(s).fxO).toBe(0);
    let seen = false;
    for (let i = 0; i < 2 * 60; i++) {
      const ev = step(s, 1 / 60);
      if (ev.some((e) => e.type === "revealed")) {
        seen = true;
        const v = view(s);
        expect(v.fxO).toBe(1);
        expect(v.fxX!).toBeGreaterThan(720);
      }
    }
    expect(seen).toBe(true);
  });

  it("a save mid-slide loads at the new width", () => {
    const s = createState(moonTank({}, { dollars: 150 }), seeded());
    buy(s, 11);
    run(s, 0.3);
    const s2 = createState(loadSave(JSON.stringify(toSave(s, 0)), 0), seeded());
    expect(view(s2).wallX).toBe(1080);
  });
});

describe("v5: camera", () => {
  const large = (extra: Partial<Save> = {}) => createState(tank([jelly(0, 3)], { tier: 2, ...extra }), seeded());

  it("panBy moves the view and clamps it to [-(worldW - 720), 0]", () => {
    const s = large();
    expect(camX(s)).toBe(0);
    panBy(s, -300);
    expect(camX(s)).toBe(-300);
    panBy(s, -5000);
    expect(camX(s)).toBe(-720);
    panBy(s, 100.4);
    expect(Math.abs(camX(s) % P)).toBe(0);
    panBy(s, 5000);
    expect(camX(s)).toBe(0);
    panBy(s, NaN);
    expect(camX(s)).toBe(0);
    // a small tank doesn't pan
    const small = createState(moonTank(), seeded());
    panBy(small, -200);
    flingCam(small, -3000);
    run(small, 1);
    expect(camX(small)).toBe(0);
  });

  it("a fling glides on and slows smoothly to rest", () => {
    const s = large();
    flingCam(s, -1500);
    const xs = [s.cam.x];
    for (let i = 0; i < 4 * 60; i++) {
      step(s, 1 / 60);
      xs.push(s.cam.x);
    }
    const speeds = xs.slice(1).map((x, i) => Math.abs(x - xs[i]!));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThanOrEqual(speeds[i - 1]! + 1e-9);
    expect(speeds[0]! * 60).toBeGreaterThan(1300);
    expect(camMoving(s)).toBe(false);
    // it travels about v * tau
    expect(Math.abs(xs.at(-1)! + 1500 * FLING_TAU)).toBeLessThan(30);
    const rest = camX(s);
    run(s, 1);
    expect(camX(s)).toBe(rest);
  });

  it("a hard fling eases into the end of the tank and never goes past it", () => {
    const s = large();
    panBy(s, -400);
    flingCam(s, -4000);
    const xs = [s.cam.x];
    for (let i = 0; i < 3 * 60; i++) {
      step(s, 1 / 60);
      xs.push(s.cam.x);
      expect(s.cam.x).toBeGreaterThanOrEqual(-720);
    }
    expect(camX(s)).toBe(-720);
    expect(camMoving(s)).toBe(false);
    // soft stop: it slows down on the way in, no slam
    const speeds = xs.slice(1).map((x, i) => Math.abs(x - xs[i]!));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThanOrEqual(speeds[i - 1]! + 1e-9);
    // the other way too
    flingCam(s, 6000);
    run(s, 3);
    expect(camX(s)).toBe(0);
  });

  it("camTo eases to centre a world x, clamped to the tank; panning takes over", () => {
    const s = large();
    camTo(s, 1000);
    expect(camMoving(s)).toBe(true);
    run(s, 0.1);
    expect(camX(s)).toBeLessThan(0);
    expect(camX(s)).toBeGreaterThan(-640);
    run(s, 1);
    expect(camX(s)).toBe(snap(360 - 1000));
    expect(camMoving(s)).toBe(false);
    camTo(s, 1400);
    run(s, 1.5);
    expect(camX(s)).toBe(-720);
    camTo(s, 0);
    run(s, 0.2);
    panBy(s, 0);
    const held = camX(s);
    run(s, 1);
    expect(camX(s)).toBe(held);
  });

  it("no panning or flinging while the shop is up", () => {
    const s = large();
    openShop(s);
    panBy(s, -300);
    flingCam(s, -2000);
    run(s, 1);
    expect(camX(s)).toBe(0);
  });

  it("screenToWorld and worldToScreen round-trip, by camX", () => {
    const s = large();
    for (const dx of [0, -123, -360, -5000]) {
      panBy(s, dx);
      for (const x of [-1, 0, 15, 359.5, 705, 720]) {
        expect(worldToScreen(s, screenToWorld(s, x))).toBeCloseTo(x, 9);
        expect(screenToWorld(s, worldToScreen(s, x + 700))).toBeCloseTo(x + 700, 9);
      }
      expect(screenToWorld(s, 0) + camX(s)).toBe(0);
      expect(viewSpan(s).x1 - viewSpan(s).x0).toBe(720);
      expect(viewSpan(s).x0 + camX(s)).toBe(0);
      expect(view(s).camX).toBe(camX(s));
    }
  });

  it("pan hints show when there's more tank that way, eased", () => {
    const small = createState(moonTank(), seeded());
    run(small, 0.5);
    expect([view(small).panL, view(small).panR]).toEqual([0, 0]);
    const s = large();
    // on load they're already right: more tank to the right only
    expect([view(s).panL, view(s).panR]).toEqual([0, 1]);
    panBy(s, -360);
    step(s, 1 / 60);
    const mid = view(s).panL!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    run(s, 0.3);
    expect([view(s).panL, view(s).panR]).toEqual([1, 1]);
    panBy(s, -9999);
    run(s, 0.3);
    expect([view(s).panL, view(s).panR]).toEqual([1, 0]);
    // hidden under the shop
    openShop(s);
    run(s, 0.3);
    expect([view(s).panL, view(s).panR]).toEqual([0, 0]);
  });
});

describe("v5: jellies, anchors and spots by tier", () => {
  it("anchors and settle spots unlock with the tier, enough for every jelly", () => {
    for (let t = 0; t < 3; t++) {
      const anchors = POLYP_ANCHORS.filter((a) => a.tier <= t);
      expect(anchors.length).toBeGreaterThanOrEqual(TIERS[t]!.maxJellies);
      for (const a of anchors) {
        expect(a.x).toBeGreaterThan(K.glassL);
        expect(a.x).toBeLessThan(glassRightOf(TIERS[a.tier]!.worldW));
      }
      const spots = SETTLE_SPOTS.filter((p) => p.tier <= t);
      expect(spots.length).toBeGreaterThanOrEqual(3);
      for (const p of spots) expect(p.y).toBe(sandAt(p.x));
    }
    expect(SETTLE_SPOTS.length).toBeGreaterThanOrEqual(5);
    expect(SETTLE_SPOTS.filter((p) => p.tier > 0).every((p) => p.x > 720)).toBe(true);
    // tier-0 indices stay where earlier saves put them
    expect(POLYP_ANCHORS.slice(0, 3).every((a) => a.tier === 0)).toBe(true);
    expect(SETTLE_SPOTS.slice(0, 3).every((p) => p.tier === 0)).toBe(true);
  });

  for (const tier of [0, 1, 2]) {
    it(`polyps fill a tier-${tier} tank to ${[3, 5, 7][tier]} on that tier's anchors, then tankFull`, () => {
      const s = createState(tank([], { tier, dollars: 9999 }), seeded());
      const max = [3, 5, 7][tier]!;
      for (let n = 0; n < max; n++) expect(buy(s, n % 3)).toBe("bought");
      expect(jellyCount(s)).toBe(max);
      const anchors = jellies(s).map((j) => j.anchor);
      expect(new Set(anchors).size).toBe(max);
      for (const a of anchors) expect(POLYP_ANCHORS[a]!.tier).toBeLessThanOrEqual(tier);
      expect(view(s).lock0).toBe(1);
      expect(buy(s, 0)).toBe("tankFull");
      expect(view(s)[`j${max - 1}on`]).toBe(1);
      if (max < 7) expect(view(s)[`j${max}on`]).toBe(0);
    });
  }

  it("7 grown jellies fit in a large tank; an 8th polyp is tankFull", () => {
    const six = [jelly(0, 3), jelly(1, 3), jelly(3, 3), jelly(0, 2), jelly(1, 2), jelly(2, 3)];
    const s = createState(tank(six, { tier: 2, dollars: 500 }), seeded());
    expect(buy(s, 2)).toBe("bought");
    expect(s.slots[6]).toMatchObject({ k: 3, g: 0 });
    expect(jellyCount(s)).toBe(7);
    expect(buy(s, 0)).toBe("tankFull");
    expect(s.dollars).toBe(390);
  });

  it("babies hold when the tier's max is reached, and come once it grows", () => {
    const happy = (k: Species) => jelly(k, 3, { fullness: 1, affection: 1, content: BABY_SECONDS });
    const s = createState(tank([happy(0), happy(1), happy(3)], { murk: 0, dollars: 150 }), seeded());
    expect(count(run(s, 2), "baby")).toBe(0);
    buy(s, 11);
    const ev = run(s, 3);
    expect(count(ev, "baby")).toBe(2);
    expect(jellyCount(s)).toBe(5);
    for (const j of jellies(s)) if (j.g === 0) expect(POLYP_ANCHORS[j.anchor]!.tier).toBeLessThanOrEqual(1);
  });

  it("upside-downs settle only on spots the tier has; a saved spot from a bigger tank is moved", () => {
    const up = (spot: number) => jelly(2, 3, { spot });
    const far = SETTLE_SPOTS.findIndex((p) => p.tier === 2);
    const s = createState(tank([up(far), up(0), up(1)], { tier: 0 }), seeded());
    const spots = jellies(s).map((j) => j.spot);
    expect(new Set(spots).size).toBe(3);
    for (const sp of spots) expect(SETTLE_SPOTS[sp]!.tier).toBe(0);
    const big = createState(tank([up(far), up(0), up(1), up(2), up(3)], { tier: 2 }), seeded());
    expect(big.slots[0]!.spot).toBe(far);
    expect(big.slots[0]!.x).toBe(SETTLE_SPOTS[far]!.x);
  });

  it("rehoming frees a slot under the tier's max", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 3), jelly(3, 3), jelly(0, 2), jelly(1, 2)], { tier: 1, dollars: 100 }), seeded());
    expect(buy(s, 0)).toBe("tankFull");
    expect(rehome(s, 3)).not.toBeNull();
    expect(view(s).lock0).toBe(0);
    expect(buy(s, 0)).toBe("bought");
  });
});

describe("v5: world coordinates", () => {
  const rightOf = (s: State) => rightGlass(s);
  /** a tank of each tier, as full as it gets, with everything owned */
  function busyTank(tier: number) {
    const all = [jelly(0, 3), jelly(1, 3, { anchor: -1 }), jelly(2, 3), jelly(3, 3), jelly(0, 0, { anchor: 3 }), jelly(1, 1), jelly(3, 2)];
    return createState(
      tank(all.slice(0, [3, 5, 7][tier]), {
        tier,
        dollars: 100,
        owned: [true, true, true, true, true],
        ...helpersOn(true, true, true),
        lastSeen: NOON,
      }),
      seeded(40 + tier),
    );
  }

  for (const tier of [0, 1, 2]) {
    it(`everything stays inside a tier-${tier} world for ten minutes, and spreads across it`, () => {
      const s = busyTank(tier);
      const W = worldW(s);
      const right = rightOf(s);
      let maxX = 0;
      let snailMax = 0;
      for (let i = 0; i < 600 * 60; i++) {
        if (i % (45 * 60) === 0) feed(s);
        if (i % (20 * 60) === 0) flingCam(s, ((i / (20 * 60)) % 2 ? 1 : -1) * 2500);
        if (i % (13 * 60) === 0) tap(s, screenToWorld(s, 360), 400);
        step(s, 1 / 60);
        for (const j of jellies(s)) {
          const g = geomOf(j.k, j.g);
          expect(j.x - g.body.halfW).toBeGreaterThan(K.glassL);
          expect(j.x + g.body.halfW).toBeLessThan(right);
          expect(j.y - g.body.top).toBeGreaterThanOrEqual(K.waterTop);
          if (j.mode === "swim") {
            expect(j.y).toBeLessThanOrEqual(sandAt(j.x) - g.rimAbove + 1e-9);
            maxX = Math.max(maxX, j.x);
          }
        }
        for (const f of s.food) if (f.state !== "off") expect(f.x > K.glassL && f.x < right).toBe(true);
        for (const [h, size] of [
          [s.shrimp, SHRIMP_SIZE],
          [s.crab, CRAB_SIZE],
        ] as const) {
          expect(h.x - size.w / 2).toBeGreaterThan(K.glassL);
          expect(h.x + size.w / 2).toBeLessThan(right);
          expect(h.y).toBe(sandAt(h.x));
        }
        // the crab only digs with its whole body on open sand
        if (s.crab.mode === "act") expect(sandUnder(s.crab.x, CRAB_SIZE.w, helperWorld(right, openSandsOf(tier)))).not.toBeNull();
        expect(s.snail.x + SNAIL_SIZE.w / 2).toBeLessThan(right);
        expect(s.snail.y).toBeLessThanOrEqual(snailBounds(s.snail.x, right).y1 + 1e-9);
        snailMax = Math.max(snailMax, s.snail.x);
        if (i % 60 === 0) {
          const v = view(s);
          for (const [name, value] of Object.entries(v)) if (!Number.isFinite(value)) throw new Error(`${name} = ${value}`);
          expect(v.camX!).toBeLessThanOrEqual(0);
          expect(v.camX!).toBeGreaterThanOrEqual(720 - W);
          expect(v.wallX).toBe(W);
          for (let d = 0; d < 5; d++) {
            expect(v[`dec${d}x`]!).toBeGreaterThan(0);
            expect(v[`dec${d}x`]!).toBeLessThan(W);
          }
        }
      }
      // jellies use the whole width: the last third of the screen's width before the far wall sees a swimmer
      expect(maxX).toBeGreaterThan(W - 240);
      if (tier > 0) expect(snailMax).toBeGreaterThan(720);
    }, 20_000); // ten simulated minutes: slow on a busy machine
  }

  it("the shrimp and crab stroll between the open stretches of a big tank", () => {
    const s = createState(quietTank({ tier: 2, ...helpersOn(false, true, true) }), seeded(9));
    const sands = openSandsOf(2);
    expect(sands.length).toBeGreaterThanOrEqual(2);
    const world = helperWorld(rightOf(s), sands);
    const visited = { shrimp: new Set<number>(), crab: new Set<number>() };
    let digs = 0;
    for (let i = 0; i < 40 * 60 * 10; i++) {
      const ev = step(s, 0.1);
      for (const [name, h, w] of [
        ["shrimp", s.shrimp, SHRIMP_SIZE.w],
        ["crab", s.crab, CRAB_SIZE.w],
      ] as const) {
        const r = sandUnder(h.x, w, world);
        if (r) visited[name].add(sands.findIndex((x) => x.x0 === r.x0));
      }
      if (ev.some((e) => e.type === "dug")) {
        digs++;
        expect(sandUnder(s.crab.x, CRAB_SIZE.w, world)).not.toBeNull();
      }
    }
    expect(visited.shrimp.size).toBeGreaterThanOrEqual(2);
    expect(visited.crab.size).toBeGreaterThanOrEqual(2);
    expect(digs).toBeGreaterThanOrEqual(4);
  });

  it("OPEN_SANDS: today's stretch for tier 0, one more per new zone", () => {
    expect(openSandsOf(0)).toEqual([{ ...OPEN_SAND, tier: 0 }]);
    expect(openSandsOf(1).length).toBeGreaterThan(1);
    expect(openSandsOf(2).length).toBeGreaterThan(openSandsOf(1).length);
    for (const r of OPEN_SANDS) {
      expect(r.x1).toBeLessThan(glassRightOf(TIERS[r.tier]!.worldW));
      expect(openSandBounds(CRAB_SIZE.w, r).x1).toBeGreaterThan(openSandBounds(CRAB_SIZE.w, r).x0);
    }
    expect(walkerBounds(SHRIMP_SIZE.w, glassRightOf(1440)).x1).toBeGreaterThan(1300);
  });

  it("feed drops around the middle of the view, wherever the camera is", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 3)], { tier: 2 }), seeded(3));
    for (const target of [0, -201, -360, -720]) {
      panBy(s, target - s.cam.x);
      for (const f of s.food) f.state = "off";
      expect(feed(s)).toBe(4);
      const v = viewSpan(s);
      for (const f of s.food.filter((f) => f.state === "sink")) {
        expect(f.x).toBeGreaterThan(v.x0 + K.glassL);
        expect(f.x).toBeLessThan(v.x1 - (K.W - K.glassR));
        expect(Math.abs(f.x - (v.x0 + 360))).toBeLessThan(240);
      }
      expect(camMoving(s)).toBe(false);
    }
  });

  it("a hungry polyp off screen gets the pinch, and the camera eases over to show it", () => {
    const far = POLYP_ANCHORS.findIndex((a) => a.tier === 2);
    const s = createState(tank([jelly(0, 3, { fullness: 0.9 }), jelly(0, 0, { anchor: far, fullness: 0.1 })], { tier: 2 }), seeded(3));
    const polyp = s.slots[1]!;
    expect(polyp.x).toBe(POLYP_ANCHORS[far]!.x);
    expect(polyp.x).toBeGreaterThan(viewSpan(s).x1);
    feed(s);
    for (const f of s.food.filter((f) => f.state === "sink")) expect(Math.abs(f.x - polyp.x)).toBeLessThan(80);
    expect(camMoving(s)).toBe(true);
    run(s, 1.2);
    const v = viewSpan(s);
    expect(polyp.x).toBeGreaterThan(v.x0 + 60);
    expect(polyp.x).toBeLessThan(v.x1 - 60);
    // and it eats
    const ev = run(s, 25);
    expect(count(ev, "ate", 1)).toBeGreaterThan(0);
  });

  it("taps and long-press hit tests take world x", () => {
    const s = createState(tank([jelly(0, 3)], { tier: 2, owned: [true, false, false, true, false] }), seeded());
    const j = j0(s);
    j.x = 1200;
    j.y = 500;
    panBy(s, -720);
    expect(jellyAt(s, 1200, 470)).toBe(0);
    expect(tap(s, 1200, 470)).toBe("pet");
    expect(view(s).rx).toBe(1200);
    expect(tap(s, 1432, 400)).toBeNull(); // past the right glass
    moveDecor(s, 0, 1300);
    expect(s.decorX[0]).toBe(snap(1300));
    expect(decorAt(s, 1300, decorBaseY(s, 0) - 20)).toBe(0);
    // the pearl follows the clam out there too
    const off = pearlCentre(s).x - s.decorX[3]!;
    moveDecor(s, 3, 1101);
    const p = pearlCentre(s);
    expect(p.x).toBe(1101 + off);
    expect(tap(s, p.x, p.y)).toBe("pearl");
    // in the small tank the far side is past the glass
    const small = createState(moonTank({}, { owned: [true, false, false, false, false] }), seeded());
    expect(tap(small, 1000, 400)).toBeNull();
    moveDecor(small, 0, 1300);
    expect(small.decorX[0]).toBe(DECOR[0]!.x1);
  });

  it("dragging a decoration to the edge of the water scrolls the tank under it", () => {
    const s = createState(tank([jelly(0, 3)], { tier: 2, owned: [true, false, false, false, false] }), seeded());
    expect(liftDecor(s, 0)).toBe(true);
    moveDecorScreen(s, 0, 300);
    expect(s.decorX[0]).toBe(300);
    run(s, 0.5);
    expect(camX(s)).toBe(0);
    moveDecorScreen(s, 0, 700);
    run(s, 1);
    expect(camX(s)).toBeLessThan(-150);
    expect(s.decorX[0]).toBe(snap(screenToWorld(s, 700)));
    run(s, 3);
    expect(camX(s)).toBe(-720);
    expect(s.decorX[0]).toBe(DECOR[0]!.x1 + 720);
    dropDecor(s);
    moveDecorScreen(s, 0, 20);
    run(s, 1);
    expect(camX(s)).toBe(-720); // not lifted: no scrolling
  });

  it("night, murk and the held sponge are screen-space: the camera doesn't move them", () => {
    const a = createState(tank([jelly(0, 3)], { tier: 2, murk: 0.5 }), seeded());
    const b = createState(tank([jelly(0, 3)], { tier: 2, murk: 0.5 }), seeded());
    panBy(b, -500);
    clean(a);
    clean(b);
    run(a, 0.5);
    run(b, 0.5);
    setCursor(a, 300, 500, true, true);
    setCursor(b, 300, 500, true, true);
    setTool(a, "sponge");
    setTool(b, "sponge");
    for (const k of ["nightShade", "daylight", "murkShade", "spongeX", "spongeY", "spongeO", "spongeF1"]) expect(view(b)[k], k).toBe(view(a)[k]);
  });
});

describe("v5: saves", () => {
  /** what the v4 build wrote: a v3-shaped save */
  const v4 = (extra: Record<string, unknown> = {}) => ({
    v: 3,
    slots: [jelly(0, 3, { name: "Pudding" }), jelly(1, 0, { anchor: 1, name: "Taffy" }), null],
    dollars: 88,
    murk: 0.2,
    night: false,
    lamp: null,
    owned: [true, false, false, false, false],
    helpers: [false, true, false],
    decorX: DECOR.map((d) => d.x),
    pearlDay: "",
    lastSeen: 1000,
    ...extra,
  });

  it("migrates a v4 save (v: 3 or 4) to v5: small tank, camera at 0", () => {
    for (const v of [3, 4]) {
      const save = loadSave(JSON.stringify(v4({ v })), 1000);
      expect(save).toMatchObject({ v: 10, tier: 0, cam: 0, dollars: 88, helpers: [false, true, false] });
      expect(save.slots.length).toBe(7);
      expect(save.slots[0]).toMatchObject({ name: "Pudding", k: 0, g: 3 });
      expect(save.slots[1]).toMatchObject({ name: "Taffy", anchor: 1 });
      expect(save.slots.slice(2).every((j) => j === null)).toBe(true);
      const s = createState(save, seeded());
      expect([view(s).wallX, view(s).camX]).toEqual([720, 0]);
    }
  });

  it("round-trips tier and camera, and repairs bad ones", () => {
    const s = createState(tank([jelly(0, 3)], { tier: 2, dollars: 5 }), seeded());
    panBy(s, -363);
    const saved = toSave(s, 10);
    expect(saved).toMatchObject({ v: 10, tier: 2, cam: -363 });
    const loaded = loadSave(JSON.stringify(saved), 10);
    expect(loaded).toEqual(saved);
    expect(camX(createState(loaded, seeded()))).toBe(-363);
    const fix = (o: Record<string, unknown>) => loadSave(JSON.stringify({ ...saved, ...o }), 10);
    expect(fix({ tier: 9 }).tier).toBe(2);
    expect(fix({ tier: "x" }).tier).toBe(0);
    expect(fix({ tier: 1, cam: -9999 }).cam).toBe(-360);
    expect(fix({ cam: 500 }).cam).toBe(0);
    expect(fix({ tier: 0, cam: -300 }).cam).toBe(0);
    // more jellies than the tier holds: the extras are dropped
    const crowded = fix({ tier: 0, slots: [jelly(0, 3), jelly(1, 3), null, jelly(3, 3), jelly(0, 2), jelly(1, 2)] });
    expect(crowded.slots.filter(Boolean).length).toBe(3);
  });

  it("the demo save is still the small tank and still works", () => {
    const save = demoSave(at(14));
    expect(save).toMatchObject({ v: 10, tier: 0, cam: 0 });
    const s = createState(loadSave(JSON.stringify(save), at(14)), seeded());
    expect([view(s).wallX, view(s).camX, view(s).panL, view(s).panR]).toEqual([720, 0, 0, 0]);
    feed(s);
    expect(count(run(s, 20), "grew")).toBeGreaterThan(0);
  });
});

describe("v5: view", () => {
  it("the spec's v5 props are in the list: 7 slots, camera, wall, hints, TANK tab and items", () => {
    const props = new Set(specProps());
    const want = ["camX", "wallX", "panL", "panR", "shopTab3", "tab3Y", "own11", "lock11", "own12", "lock12"];
    for (let j = 0; j < 7; j++) want.push(`j${j}on`, `j${j}x`, `j${j}y`, `j${j}k3`, `j${j}g3`, `j${j}bf3`, `j${j}tf3`, `j${j}tr4`, `j${j}glow`);
    for (const name of want) expect(props.has(name), name).toBe(true);
    expect(props.has("j7on")).toBe(false);
    expect(props.has("own24")).toBe(false); // v6 adds items 13-17; v11 adds 18-19 (foods) and 20-23 (themes), no new tab
    expect(props.has("shopTab5")).toBe(false);
  });

  it("writes exactly the spec's props, all finite, through an upgrade, flings and a full large tank", () => {
    const s = createState(
      tank([jelly(0, 3), jelly(1, 3), jelly(3, 2)], { dollars: 2000, owned: [true, true, true, true, true], ...helpersOn(true, true, true), lastSeen: 1e12 }),
      seeded(5),
    );
    openShop(s);
    setTab(s, 3);
    buy(s, 11);
    for (let i = 0; i < 30 * 60; i++) {
      if (i === 120) buy(s, 12);
      if (i === 300) for (let n = 0; n < 4; n++) buy(s, n % 3);
      if (i % 200 === 0) flingCam(s, i % 400 ? 3000 : -3000);
      if (i % 300 === 0) feed(s);
      step(s, 1 / 60);
      const v = view(s);
      if (i % 60 === 0) expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
      for (const [name, value] of Object.entries(v)) if (!Number.isFinite(value)) throw new Error(`${name} = ${value}`);
    }
    expect(s.tier).toBe(2);
    expect(jellyCount(s)).toBe(7);
    const v = view(s);
    for (let j = 0; j < 7; j++) expect(v[`j${j}on`]).toBe(1);
  });
});

describe("v6: five more species", () => {
  const NEW_ITEMS = [13, 14, 15, 16, 17];
  const kOf = (i: number) => (SHOP_ITEMS[i] as { k: Species }).k;

  it("the new polyps are on sale, with the crystal needing Medium and the lion's mane needing Large", () => {
    expect(NEW_ITEMS.map((i) => SHOP_ITEMS[i]!.kind)).toEqual(["polyp", "polyp", "polyp", "polyp", "polyp"]);
    const s = createState(tank([jelly(0, 3)], { dollars: 2000 }), seeded());
    expect(buy(s, 15)).toBe("needsMedium");
    expect(buy(s, 17)).toBe("needsLarge");
    expect(view(s).lock15).toBe(1);
    expect(buy(s, 13)).toBe("bought");
    expect(buy(s, 14)).toBe("bought");
    expect(buy(s, 16)).toBe("tankFull"); // three jellies in a small tank
    expect(s.slots.filter(Boolean).map((j) => j!.k)).toEqual([0, 4, 5]);
  });

  it("each new species grows from polyp to adult and stays in the water at the tiers it's allowed in", () => {
    for (const i of NEW_ITEMS) {
      const k = kOf(i);
      const tier = i === 17 ? 2 : i === 15 ? 1 : 0;
      const s = createState(tank([jelly(k, 0, { anchor: 0 })], { tier, dollars: 0 } as Partial<Save>), seeded(k), { growthMultiplier: 20 });
      const events: SimEvent[] = [];
      for (let t = 0; t < 600 && s.slots[0]!.g < 3; t++) {
        if (t % 6 === 0) feed(s);
        events.push(...run(s, 1));
      }
      const j = s.slots[0]!;
      expect(j.g, `species ${k}`).toBe(3);
      expect(count(events, "grew", 0)).toBe(3);
      for (let t = 0; t < 600; t++) {
        step(s, 1 / 10);
        expect(j.x).toBeGreaterThan(0);
        expect(j.x).toBeLessThan(worldW(s));
        expect(j.y).toBeGreaterThan(K.waterTop);
        expect(j.y).toBeLessThan(K.waterBot);
      }
      for (const val of Object.values(view(s))) expect(Number.isFinite(val)).toBe(true);
      expect(view(s)[`j0k${k}`]).toBe(1);
    }
  });

  it("flower hats keep to the lower part of the tank", () => {
    const s = createState(tank([jelly(7, 3)]), seeded(3));
    let low = 0;
    for (let t = 0; t < 1800; t++) {
      step(s, 1 / 10);
      if (s.slots[0]!.y > K.waterTop + (K.waterBot - K.waterTop) * 0.45) low++;
    }
    expect(low / 1800).toBeGreaterThan(0.7);
  });

  it("new species survive a save round-trip", () => {
    const s = createState(tank([jelly(4, 2), jelly(6, 3), jelly(8, 1)], { tier: 2 } as Partial<Save>), seeded());
    const back = createState(loadSave(JSON.stringify(toSave(s, 0)), 0), seeded());
    expect(back.slots.filter(Boolean).map((j) => [j!.k, j!.g])).toEqual([[4, 2], [6, 3], [8, 1]]);
  });
});

describe("v6: the JELLIES tab scrolls", () => {
  it("scrolls within its window, resets on tab change, and knows which taps are inside the list", () => {
    const s = createState(tank([jelly(0, 3)]), seeded());
    scrollShop(s, -100);
    expect(s.shopScroll).toBe(0); // shop closed: nothing scrolls
    openShop(s);
    scrollShop(s, -60);
    expect(s.shopScroll).toBe(Math.min(60, SHOP_SCROLL.max));
    scrollShop(s, -10_000);
    expect(s.shopScroll).toBe(SHOP_SCROLL.max);
    expect(view(s).shopScroll).toBe(-snap3(SHOP_SCROLL.max));
    scrollShop(s, 10_000);
    expect(s.shopScroll).toBe(0);
    scrollShop(s, -40);
    setTab(s, 1);
    expect(s.shopScroll).toBe(0);
    setTab(s, 0);
    expect(inShopView(s, SHOP_SCROLL.viewTop - 1)).toBe(false);
    expect(inShopView(s, (SHOP_SCROLL.viewTop + SHOP_SCROLL.viewBottom) / 2)).toBe(true);
  });
});

function snap3(v: number) {
  return Math.round(v / 3) * 3;
}

// ---------------------------------------------------------------- v7

describe("v7: colour morphs", () => {
  it("about 1 in 10 bought polyps is a morph, with or without ?fast=1", () => {
    for (const growthMultiplier of [1, 20]) {
      const rand = seeded(42);
      let morphs = 0;
      const N = 3000;
      for (let i = 0; i < N; i++) {
        const s = createState(tank([jelly(0, 3)], { dollars: 100 }), rand, { growthMultiplier });
        expect(buy(s, 0)).toBe("bought");
        if (s.slots[1]!.morph) morphs++;
      }
      expect(morphs / N).toBeGreaterThan(0.085);
      expect(morphs / N).toBeLessThan(0.115);
    }
  });

  it("babies roll the same 1 in 10", () => {
    for (const [r, want] of [[0.05, true], [0.5, false]] as const) {
      const s = createState(tank([jelly(0, 3, { fullness: 1, affection: 1, content: BABY_SECONDS - 0.01 })], { murk: 0 }), () => r);
      const ev = run(s, 0.1);
      expect(count(ev, "baby")).toBe(1);
      expect(s.slots[1]!.morph).toBe(want ? 1 : 0);
    }
  });

  it("a morph is fixed for life: it grows, saves and loads as a morph", () => {
    const s = createState(tank([jelly(5, 0, { anchor: 0, morph: 1 })]), seeded());
    s.slots[0]!.gp = 30;
    run(s, 1);
    expect(s.slots[0]!.g).toBe(3);
    const back = createState(loadSave(JSON.stringify(toSave(s, 0)), 0), seeded());
    expect(back.slots[0]!.morph).toBe(1);
    expect(jellyInfo(back, 0)!.morph).toBe(1);
  });

  it("view: morph = 1 and healthy = 0 for a morph; pale overrides; flush draws over it", () => {
    const s = createState(tank([jelly(1, 3, { morph: 1, fullness: 1, affection: 1 }), jelly(1, 3, { fullness: 1, affection: 1 })], { murk: 0 }), seeded());
    let v = view(s);
    expect([v.j0morph, v.j0healthy, v.j0pale]).toEqual([1, 0, 0]);
    expect([v.j1morph, v.j1healthy, v.j1pale]).toEqual([0, 1, 0]);
    tap(s, s.slots[0]!.x, s.slots[0]!.y - 20);
    v = view(s);
    expect([v.j0morph, v.j0flush]).toEqual([1, 1]);
    s.slots[0]!.fullness = 0;
    s.slots[0]!.affection = 0;
    setMurk(s, 1);
    v = view(s);
    expect([v.j0morph, v.j0healthy, v.j0pale]).toEqual([0, 0, 1]);
    expect(v.j2morph).toBe(0);
  });

  it("older saves load with no morphs", () => {
    const old = { ...tank([jelly(0, 3), jelly(3, 1)]), v: 5 } as Record<string, unknown>;
    delete old.journal;
    const save = loadSave(JSON.stringify(old), 0);
    expect(save.v).toBe(10);
    expect(save.slots.filter(Boolean).map((j) => j!.morph)).toEqual([0, 0]);
  });
});

describe("v7: the jelly journal", () => {
  const T0 = at(10);

  it("tracks seen, raised, the first adult's date and name, and morphs", () => {
    const s = createState(tank([jelly(0, 3, { name: "Pudding" })], { dollars: 1000, lastSeen: T0 }), () => 0.5);
    let jn = journal(s);
    expect(jn.length).toBe(9);
    expect(jn[0]).toMatchObject({ seen: true, morphSeen: 0 });
    expect(jn[1]).toEqual({ seen: false, raised: 0, firstAdultAt: null, firstName: null, morphSeen: 0 });
    buy(s, 0); // a blubber polyp
    expect(journal(s)[1]!.seen).toBe(true);
    const b = s.slots.findIndex((j) => j?.k === 1);
    const name = s.slots[b]!.name;
    s.slots[b]!.gp = 30;
    run(s, 2);
    jn = journal(s);
    expect(jn[1]!.raised).toBe(1);
    expect(jn[1]!.firstName).toBe(name);
    expect(jn[1]!.firstAdultAt).toBeGreaterThanOrEqual(T0);
    expect(jn[1]!.firstAdultAt).toBeLessThanOrEqual(T0 + 3000);
    // a second blubber grows up: counted, but the first one's name and date stay
    const first = jn[1]!.firstAdultAt;
    s.rand = () => 0.01; // ...and this one is a morph
    buy(s, 0);
    const b2 = s.slots.findIndex((j, i) => j?.k === 1 && i !== b);
    expect(s.slots[b2]!.morph).toBe(1);
    expect(journal(s)[1]!.morphSeen).toBe(1);
    s.slots[b2]!.gp = 30;
    run(s, 2);
    expect(journal(s)[1]).toMatchObject({ raised: 2, firstName: name, firstAdultAt: first, morphSeen: 1 });
    // and it all survives a save; rehoming doesn't forget
    rehome(s, b);
    const back = createState(loadSave(JSON.stringify(toSave(s, T0)), T0), seeded());
    expect(journal(back)).toEqual(journal(s));
    // journal() is a copy
    journal(back)[1]!.raised = 99;
    expect(journal(back)[1]!.raised).toBe(2);
  });

  it("migrates older saves from the jellies in the tank: adults count as raised, first raised at load time", () => {
    const NOW = at(15);
    const old = {
      ...tank([jelly(0, 3, { name: "Taffy" }), jelly(1, 0, { anchor: 1, name: "Boba" }), jelly(0, 3, { name: "Plum" }), null]),
      v: 5,
    } as Record<string, unknown>;
    delete old.journal;
    const save = loadSave(JSON.stringify(old), NOW);
    expect(save.journal[0]).toEqual({ seen: true, raised: 2, firstAdultAt: NOW, firstName: "Taffy", morphSeen: 0 });
    expect(save.journal[1]).toEqual({ seen: true, raised: 0, firstAdultAt: null, firstName: null, morphSeen: 0 });
    expect(save.journal.slice(2).every((e) => !e.seen && e.raised === 0)).toBe(true);
    // a v1 save's adult moon is in it too
    const v1 = loadSave(JSON.stringify({ v: 1, fullness: 0.5, murk: 0.2, affection: 0.3, night: false, lastSeen: NOW }), NOW);
    expect(v1.journal[0]).toMatchObject({ seen: true, raised: 1, firstAdultAt: NOW });
    // a new game has seen its moon polyp, raised nothing
    expect(defaultSave(NOW).journal[0]).toMatchObject({ seen: true, raised: 0, firstAdultAt: null });
  });

  it("repairs a damaged v7 journal, and marks what's in the tank as seen", () => {
    const saved = toSave(createState(tank([jelly(4, 2)]), seeded()), 0);
    const bad = { ...saved, journal: [{ seen: "yes", raised: -3, firstAdultAt: "x", firstName: 7, morphSeen: "1" }, null, 5] };
    const save = loadSave(JSON.stringify(bad), 0);
    expect(save.journal.length).toBe(9);
    expect(save.journal[0]).toEqual({ seen: false, raised: 0, firstAdultAt: null, firstName: null, morphSeen: 0 });
    expect(save.journal[4]!.seen).toBe(true);
  });
});

describe("v7: visitors", () => {
  const T = createState(tank([jelly(0, 3)]), seeded()); // for the visitor helpers' types
  void T;
  const arrivals = (ev: SimEvent[]) => ev.filter((e) => e.type === "visitorArrived");

  it("one every 3-6 minutes, staying 30-60 s, one at a time", () => {
    const s = createState(tank([jelly(0, 3, { fullness: 1 })], { murk: 0 }), seeded(3));
    const starts: number[] = [];
    const ends: number[] = [];
    const kinds = new Set<string>();
    for (let i = 0; i < 60 * 60 * 10; i++) {
      for (const e of step(s, 0.1)) {
        if (e.type === "visitorArrived") {
          expect(ends.length).toBe(starts.length); // never two at once
          starts.push(s.t);
          kinds.add(e.kind!);
        }
        if (e.type === "visitorLeft") ends.push(s.t);
      }
    }
    expect(starts[0]).toBeGreaterThanOrEqual(180);
    expect(starts[0]).toBeLessThanOrEqual(361);
    for (let i = 0; i < ends.length; i++) {
      expect(ends[i]! - starts[i]!).toBeGreaterThanOrEqual(29.9);
      expect(ends[i]! - starts[i]!).toBeLessThanOrEqual(60.1);
      if (starts[i + 1] !== undefined) {
        expect(starts[i + 1]! - ends[i]!).toBeGreaterThanOrEqual(179.9);
        expect(starts[i + 1]! - ends[i]!).toBeLessThanOrEqual(360.1);
      }
    }
    expect(starts.length).toBeGreaterThanOrEqual(6);
    expect([...kinds].sort()).toEqual(VISITORS.filter((_, k) => visitsDuring(k, null)).sort()); // no event: no bat
  });

  it("never arrives while the shop is open; a visit holds still under the shop", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(4));
    openShop(s);
    expect(arrivals(run(s, 600))).toEqual([]);
    expect(s.visit).toBe(null);
    closeShop(s);
    const ev = run(s, 2);
    expect(arrivals(ev).length).toBe(1);
    const age = s.visit!.age;
    openShop(s);
    run(s, 30);
    expect(s.visit!.age).toBeCloseTo(age + 0.35, 0); // it only aged while the panel slid up
    closeShop(s);
  });

  it("stays in view (inside the glass) for its whole visit, at every tier and camera position", () => {
    for (const tier of [0, 1, 2]) {
      for (const cam of [0, -180, -360, -720]) {
        const s = createState(tank([jelly(0, 3)], { tier, cam }), seeded(10 + tier * 7 - cam));
        const kinds = new Set<number>();
        for (let i = 0; i < 40 * 60 * 10; i++) {
          step(s, 0.1);
          const v = s.visit;
          if (!v || v.on <= 0) continue;
          kinds.add(v.kind);
          const sp = viewSpan(s);
          const b = boxFacing(v.kind, v.sx);
          const x0 = Math.max(sp.x0, K.glassL);
          const x1 = Math.min(sp.x1, rightGlass(s));
          expect(v.x + b.x0, `tier ${tier} cam ${cam} kind ${v.kind}`).toBeGreaterThanOrEqual(x0 - 0.5);
          expect(v.x + b.x1, `tier ${tier} cam ${cam} kind ${v.kind}`).toBeLessThanOrEqual(x1 + 0.5);
          expect(v.y + b.y0).toBeGreaterThanOrEqual(K.waterTop);
          expect(v.y + b.y1).toBeLessThanOrEqual(K.waterBot);
        }
        expect(kinds.size, `tier ${tier} cam ${cam}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("a tap pays 5-10 once per visit, with a sparkle, and it leaves early and happy", () => {
    const pays: number[] = [];
    for (let trial = 0; trial < 12; trial++) {
      const s = createState(tank([jelly(0, 3)], { dollars: 10 }), seeded(20 + trial));
      s.nextVisit = 0;
      run(s, 3);
      const v = s.visit!;
      const c = visitorInfo(s)!;
      expect(c.kind).toBe(VISITORS[v.kind]);
      expect(tap(s, c.x, c.y)).toBe("visitor");
      const got = s.dollars - 10;
      pays.push(got);
      expect(got).toBeGreaterThanOrEqual(5);
      expect(got).toBeLessThanOrEqual(10);
      expect(s.fx).not.toBe(null);
      expect(tap(s, c.x, c.y)).toBe("visitor"); // still in the way, no more pay
      expect(s.dollars).toBe(10 + got);
      const ev = run(s, 4);
      const tapped = ev.find((e) => e.type === "visitorTapped")!;
      expect(tapped).toMatchObject({ kind: c.kind, amount: got });
      expect(ev.find((e) => e.type === "earned")).toMatchObject({ amount: got, x: tapped.x, y: tapped.y });
      expect(count(ev, "visitorLeft")).toBe(1); // gone within 1 + 2.2 s
      expect(s.visit).toBe(null);
    }
    expect(new Set(pays).size).toBeGreaterThan(2);
  });

  it("tap checks the visitor before the jellies", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(5));
    s.nextVisit = 0;
    run(s, 3);
    const c = visitorInfo(s)!;
    s.slots[0]!.x = c.x;
    s.slots[0]!.y = c.y + 30;
    expect(jellyAt(s, c.x, c.y)).toBe(0);
    expect(tap(s, c.x, c.y)).toBe("visitor");
    // away from it, a tap is a tap again
    expect(tap(s, K.glassL + 30, K.waterTop + 30)).not.toBe("visitor");
  });

  it("the murk drops while the diver works: it wipes the spots near it", () => {
    const s = createState(tank([jelly(0, 3)], { murk: 0.5 }), seeded(6));
    const quiet = createState(tank([jelly(0, 3)], { murk: 0.5 }), seeded(6));
    quiet.nextVisit = Infinity;
    s.nextVisit = Infinity;
    s.visit = planVisit(DIVER, { x0: K.glassL, x1: K.glassR }, 0, seeded(7))!;
    run(s, 20);
    run(quiet, 20);
    expect(quiet.murk).toBeGreaterThan(0.5);
    expect(s.murk).toBeLessThan(0.5 - 0.04);
    expect(view(s).diverOn).toBe(1);
  });

  it("view: the visitor's props are written (eased in), the others hidden", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(8));
    s.nextVisit = 0;
    run(s, 0.1);
    const name = VISITOR_PROP[s.visit!.kind]!;
    expect(view(s)[`${name}On`]).toBeGreaterThan(0);
    expect(view(s)[`${name}On`]).toBeLessThan(1);
    run(s, 3);
    const v = view(s);
    expect(v[`${name}On`]).toBe(1);
    expect([0, 1, 2, 3].reduce((a, f) => a + v[`${name}F${f}`]!, 0)).toBe(1);
    for (const other of VISITOR_PROP) if (other !== name) expect(v[`${other}On`]).toBe(0);
    expect(Math.abs(v[`${name}X`]! % P)).toBe(0);
    expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
  });
});

describe("v7: tank share codes", () => {
  const LONG = ["Abcdefghijkl", "Mnopqrstuvwx", "Yz0123456789", "Wobble Wobbl", "Sprinkle Pip", "Boba Bubbles", "Hello Jelly7"];
  const fullLarge = () =>
    createState(
      tank(
        [
          jelly(8, 3, { name: LONG[0]!, morph: 1 }),
          jelly(6, 3, { name: LONG[1]! }),
          jelly(2, 3, { name: LONG[2]!, spot: 5 }),
          jelly(0, 0, { name: LONG[3]!, anchor: 6, morph: 1 }),
          jelly(7, 2, { name: LONG[4]! }),
          jelly(3, 1, { name: LONG[5]! }),
          jelly(5, 3, { name: LONG[6]! }),
        ],
        { tier: 2, owned: [true, true, true, true, true], helpers: [true, true, true], decorX: DECOR.map((d, n) => d.x + [0, 600, 300, 900, 120][n]!) },
      ),
      seeded(),
    );

  it("round-trips exactly", () => {
    for (const s of [fullLarge(), createState(defaultSave(at(9)), seeded()), createState(tank([jelly(4, 3, { name: "Mochi" })], { tier: 1 }), seeded())]) {
      const code = exportTank(s);
      const save = importTank(code, at(12))!;
      expect(save).not.toBe(null);
      const back = createState(save, seeded());
      expect(exportTank(back)).toBe(code);
      expect(back.tier).toBe(s.tier);
      expect(back.owned).toEqual(s.owned);
      expect(back.helpers).toEqual(s.helpers);
      s.owned.forEach((o, n) => o && expect(back.decorX[n]).toBe(s.decorX[n]));
      expect(back.slots.map((j) => j && [j.k, j.g, j.morph, j.name, j.anchor, j.spot])).toEqual(s.slots.map((j) => j && [j.k, j.g, j.morph, j.name, j.anchor, j.spot]));
      expect(save).toMatchObject({ v: 10, dollars: 0, lastSeen: at(12), cam: 0 });
      expect(pearlShowing(back)).toBe(false);
    }
  });

  it("a full Large tank fits in a message", () => {
    const code = exportTank(fullLarge());
    expect(code.length).toBeLessThanOrEqual(400);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    // even with names outside the 6-bit alphabet
    const s = fullLarge();
    s.slots.forEach((j, i) => j && (j.name = "🪼🐢🐠ÉéñÜü海月水母"));
    const wide = exportTank(s);
    expect(wide.length).toBeLessThanOrEqual(440);
    expect(createState(importTank(wide)!, seeded()).slots[0]!.name).toBe("🪼🐢🐠ÉéñÜü海月水母");
  });

  it("rejects garbage", () => {
    const code = exportTank(fullLarge());
    const bad: unknown[] = ["", "   ", "hello", "!!!!", "AAAA", "A".repeat(200), code.slice(0, -1), code.slice(0, -3), code + "A", code + "AA",
      code.replace(/^./, (c) => (c === "B" ? "C" : "B")), code.slice(0, 20) + (code[20] === "x" ? "y" : "x") + code.slice(21), null, 42, {}];
    for (const b of bad) expect(importTank(b as string), String(b)).toBe(null);
    // flipping any single character of a real code is caught
    for (let i = 0; i < code.length; i++) {
      const c = code[i] === "Q" ? "R" : "Q";
      expect(importTank(code.slice(0, i) + c + code.slice(i + 1))).toBe(null);
    }
    // random strings never decode
    const r = seeded(99);
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < 2000; i++) {
      const len = 4 + Math.floor(r() * 120);
      let str = "";
      for (let k = 0; k < len; k++) str += B64[Math.floor(r() * 64)];
      expect(importTank(str)).toBe(null);
    }
    // whitespace around a pasted code is fine
    expect(importTank(`  ${code}\n`)).not.toBe(null);
  });
});

// ---------------------------------------------------------------- v8: hands-on feeding and scrubbing

describe("v8: sprinkling food", () => {
  const empty = () => {
    const s = createState(tank([]), seeded(4));
    s.nextVisit = Infinity;
    return s;
  };
  const live = (s: State) => s.food.filter((f) => f.state === "sink" || f.state === "rest");

  it("the pool holds 16 flakes", () => {
    expect(K.foodN).toBe(16);
    expect(empty().food.length).toBe(16);
  });

  it("drops 1-2 flakes within ±12 px of the point, sinking", () => {
    const s = empty();
    const n = sprinkle(s, 400, 500);
    expect(n === 1 || n === 2).toBe(true);
    const fs = live(s);
    expect(fs.length).toBe(n);
    for (const f of fs) {
      expect(f.state).toBe("sink");
      expect(Math.abs(f.x + P + 1 - 400)).toBeLessThanOrEqual(12 + 1e-9);
      expect(Math.abs(f.y + P + 1 - 500)).toBeLessThanOrEqual(12 + 1e-9);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      run(s, 0.4);
      seen.add(sprinkle(s, 400, 500));
    }
    expect(seen.has(1) && seen.has(2)).toBe(true);
  });

  it("clamps into the water: under the surface, above the sand, inside the glass", () => {
    const s = empty();
    const check = () => {
      for (const f of live(s)) {
        expect(f.x).toBeGreaterThanOrEqual(K.glassL + P - 1e-9);
        expect(f.x).toBeLessThanOrEqual(rightGlass(s) - 4 * P + 1e-9);
        expect(f.y).toBeGreaterThanOrEqual(K.waterTop + 3 - 1e-9);
        expect(f.y).toBeLessThanOrEqual(sandAt(f.x + P + 1) - 2 * P + 1e-9);
      }
    };
    for (const [x, y] of [[-200, -200], [5000, 600], [400, 5000], [K.glassL + 2, K.waterTop + 1]] as const) {
      expect(sprinkle(s, x, y)).toBeGreaterThan(0);
      check();
      run(s, 0.5);
    }
    // a flake put in on the sand rests there straight away
    run(s, 1 / 60);
    expect(s.food.some((f) => f.state === "rest")).toBe(true);
  });

  it("caps the rate at ~10 a second", () => {
    const s = empty();
    let n = 0;
    for (let i = 0; i < 100; i++) n += sprinkle(s, 400, 500);
    expect(n).toBeLessThanOrEqual(POUR_BURST);
    // a drag: one call every ~110 ms for a second
    const t = createState(tank([]), seeded(9));
    let m = 0;
    for (let i = 0; i < 60; i++) {
      if (i % 7 === 0) m += sprinkle(t, 400, 500);
      step(t, 1 / 60);
    }
    expect(m).toBeLessThanOrEqual(POUR_BURST + 10);
    expect(m).toBeGreaterThanOrEqual(9);
  });

  it("when all 16 are in the water, sprinkling does nothing", () => {
    const s = empty();
    let tries = 0;
    while (live(s).length < 16 && tries++ < 200) {
      sprinkle(s, 300 + (tries % 5) * 30, 300);
      step(s, 0.1);
    }
    expect(live(s).length).toBe(16);
    run(s, 1);
    expect(sprinkle(s, 400, 400)).toBe(0);
  });

  it("does nothing while the shop is up", () => {
    const s = empty();
    openShop(s);
    expect(sprinkle(s, 400, 500)).toBe(0);
  });

  it("sprinkled flakes are eaten as before, and meals still pay", () => {
    const s = createState(moonTank({ fullness: 0.2 }), seeded(5));
    s.nextVisit = Infinity;
    const j = j0(s);
    const events: SimEvent[] = [];
    for (let i = 0; i < 4; i++) {
      sprinkle(s, j.x, j.y + 40);
      events.push(...run(s, 0.4));
    }
    events.push(...run(s, 30));
    expect(count(events, "ate", 0)).toBeGreaterThanOrEqual(3);
    expect(s.dollars).toBe(count(events, "ate", 0));
  });
});

describe("v8: tools and the held-item cursor", () => {
  it("Feed and Clean toggle the can and the sponge; picking one up puts the other down", () => {
    const s = createState(moonTank(), seeded());
    expect(s.tool).toBe("none");
    expect(toggleTool(s, "food")).toBe("food");
    run(s, 1);
    let v = view(s);
    expect([v.toolFood, v.toolSponge, v.b0y, v.b1y]).toEqual([1, 0, P, 0]);
    expect(toggleTool(s, "sponge")).toBe("sponge");
    run(s, 1);
    v = view(s);
    expect([v.toolFood, v.toolSponge, v.b0y, v.b1y]).toEqual([0, 1, 0, P]);
    expect(toggleTool(s, "sponge")).toBe("none");
    run(s, 1);
    v = view(s);
    expect([v.toolFood, v.toolSponge, v.b0y, v.b1y]).toEqual([0, 0, 0, 0]);
    expect(setTool(s, "food")).toBe("food");
    expect(setTool(s, "none")).toBe("none");
  });

  it("the shop opening and a jelly close-up put the tool down; it can't be picked up meanwhile", () => {
    const s = createState(moonTank(), seeded());
    setTool(s, "food");
    openShop(s);
    expect(s.tool).toBe("none");
    expect(setTool(s, "sponge")).toBe("none");
    closeShop(s);
    run(s, 1);
    setTool(s, "sponge");
    focusJelly(s, 0);
    expect(s.tool).toBe("none");
    expect(setTool(s, "food")).toBe("none");
  });

  it("the can follows the pointer in screen space and tips while pouring; the sponge squishes", () => {
    const s = createState(tank([jelly(0, 3)], { tier: 2 }), seeded());
    panBy(s, -400);
    setTool(s, "food");
    setCursor(s, 301, 452, false, true);
    let v = view(s);
    expect([v.canO, v.canX, v.canY, v.canF0, v.canF1, v.spongeO]).toEqual([1, snap(301), snap(452), 1, 0, 0]);
    setCursor(s, 301, 452, true, true);
    v = view(s);
    expect([v.canF0, v.canF1]).toEqual([0, 1]);
    // a quick tap still shows a pour
    setCursor(s, 301, 452, false, true);
    sprinkle(s, screenToWorld(s, 301), 452);
    expect(view(s).canF1).toBe(1);
    run(s, 0.5);
    expect(view(s).canF1).toBe(0);
    setCursor(s, 301, 452, false, false);
    expect(view(s).canO).toBe(0);
    setTool(s, "sponge");
    setCursor(s, 200, 300, true, true);
    v = view(s);
    expect([v.spongeO, v.spongeX, v.spongeY, v.spongeF0, v.spongeF1, v.canO]).toEqual([1, 201, 300, 0, 1, 0]);
    setCursor(s, 200, 300, false, true);
    expect([view(s).spongeF0, view(s).spongeF1]).toEqual([1, 0]);
  });
});

describe("v8: dirt spots", () => {
  /** a tank whose glass is clean and stays that way unless the test says so */
  const glass = (extra: Partial<Save> = {}, slots: (SaveJelly | null)[] = [jelly(0, 3)]) => {
    const s = createState(tank(slots, { murk: 0, ...extra }), seeded(3));
    s.nextVisit = Infinity;
    s.nextSpot = Infinity;
    return s;
  };
  const put = (s: State, i: number, x: number, y: number, dirt: number, v = 0) => {
    s.spots[i] = { x, y, dirt, v, peak: dirt };
  };

  it("murk is clamp(sum of dirt / 6)", () => {
    expect(murkOf([])).toBe(0);
    expect(murkOf([{ x: 0, y: 0, dirt: 1, v: 0 }, { x: 0, y: 0, dirt: 0.5, v: 1 }, null])).toBeCloseTo(0.25, 12);
    expect(murkOf(Array.from({ length: 12 }, () => ({ x: 0, y: 0, dirt: 1, v: 2 })))).toBe(1);
    const s = glass();
    put(s, 0, 300, 400, 1);
    put(s, 5, 500, 700, 1);
    put(s, 9, 200, 600, 1);
    step(s, 1 / 60);
    expect(s.murk).toBeCloseTo(0.5, 3);
    const v = view(s);
    expect(v.barWater).toBe(snap(0.5 * K.barW * P));
    expect(v.murkShade).toBeGreaterThan(0);
  });

  it("view: per spot x, y (world), an opacity that keeps faint spots readable, and a one-hot kind", () => {
    const s = glass();
    put(s, 0, 301, 400, 0.05, 2);
    put(s, 1, 500, 600, 0.5, 1);
    put(s, 2, 200, 300, 1, 0);
    const v = view(s);
    expect([v.spot0x, v.spot0y]).toEqual([snap(301), 399]);
    expect([v.spot0v0, v.spot0v1, v.spot0v2]).toEqual([0, 0, 1]);
    expect([v.spot1v0, v.spot1v1, v.spot1v2]).toEqual([0, 1, 0]);
    expect(v.spot0o).toBeGreaterThanOrEqual(0.25);
    expect(v.spot0o).toBeLessThan(v.spot1o!);
    expect(v.spot1o).toBeLessThan(v.spot2o!);
    expect(v.spot2o).toBe(1);
    expect(v.spot3o).toBe(0);
    for (let i = 0; i < SPOT_N; i++) expect([0, 1, 2].reduce((a, k) => a + v[`spot${i}v${k}`]!, 0)).toBe(1);
  });

  it("spots appear every 90-150 s, grow from faint to full in ~5 minutes, and stop at 12, all on the water", () => {
    const s = createState(tank([jelly(0, 3)], { murk: 0, tier: 1 }), seeded(3));
    s.nextVisit = Infinity;
    const born: number[] = [];
    let n = 0;
    for (let i = 0; i < 40 * 60 * 10; i++) {
      step(s, 0.1);
      const now = s.spots.filter(Boolean).length;
      if (now > n) born.push(s.t);
      n = now;
    }
    expect(n).toBe(12);
    expect(born.length).toBe(12);
    for (let i = 1; i < born.length; i++) {
      expect(born[i]! - born[i - 1]!).toBeGreaterThanOrEqual(90 - 0.2);
      expect(born[i]! - born[i - 1]!).toBeLessThanOrEqual(150 + 0.2);
    }
    // the first ones are full by now; the last one is still faint-ish
    const sorted = s.spots.map((sp) => sp!.dirt).sort((a, b) => a - b);
    expect(sorted[11]).toBe(1);
    expect(s.murk).toBe(1);
    const R = SPOT_R;
    for (const sp of s.spots) {
      expect(sp!.x - R).toBeGreaterThanOrEqual(K.glassL - 1e-9);
      expect(sp!.x + R).toBeLessThanOrEqual(rightGlass(s) + 1e-9);
      expect(sp!.y - R).toBeGreaterThanOrEqual(K.waterTop - 1e-9);
      expect(sp!.y + R).toBeLessThanOrEqual(sandAt(sp!.x) + 1e-9);
    }
    // a new spot grows from 0.05 to full over ~5 minutes
    const t = glass();
    t.nextSpot = 0;
    step(t, 0.1);
    const sp = t.spots.find(Boolean)!;
    expect(sp.dirt).toBeLessThan(0.06);
    t.nextSpot = Infinity;
    run(t, 150);
    expect(sp.dirt).toBeGreaterThan(0.5);
    expect(sp.dirt).toBeLessThan(0.6);
    run(t, 150);
    expect(sp.dirt).toBe(1);
  });

  it("scrubbing clears a full spot in 1.5-2 s of steady rubbing, pays +1 once, and fires spotCleaned", () => {
    const s = glass({ dollars: 5 });
    put(s, 4, 402, 501, 1, 1);
    setTool(s, "sponge");
    const events: SimEvent[] = [];
    let frames = 0;
    let removed = 0;
    // rubbing back and forth over it at 600 px/s
    while (s.spots[4] && frames < 600) {
      const x = 402 + 40 * Math.sin((frames / 60) * 2 * Math.PI * 2.4);
      removed += scrubAt(s, x, 501, 10);
      events.push(...step(s, 1 / 60));
      frames++;
    }
    expect(frames / 60).toBeGreaterThanOrEqual(1.5);
    expect(frames / 60).toBeLessThanOrEqual(2);
    expect(removed).toBeGreaterThan(1);
    events.push(...step(s, 1 / 60));
    expect(events.filter((e) => e.type === "spotCleaned")).toEqual([{ type: "spotCleaned", x: 402, y: 501 }]);
    expect(events.find((e) => e.type === "earned")).toEqual({ type: "earned", amount: 1, x: 402, y: 501 });
    expect(s.dollars).toBe(6);
    expect(view(s).fxO).toBeGreaterThan(0);
    expect(s.murk).toBe(0);
    // nothing left to scrub: no more pay
    expect(scrubAt(s, 402, 501, 50)).toBe(0);
    expect(count(run(s, 1), "spotCleaned")).toBe(0);
    expect(s.dollars).toBe(6);
  });

  it("only spots within ~55 px are scrubbed; faint spots come off for free; a pointer jump isn't a scrub", () => {
    const s = glass();
    put(s, 0, 300, 400, 0.3);
    put(s, 1, 420, 400, 1);
    const got = scrubAt(s, 300, 400, 100);
    expect(got).toBeCloseTo(100 / 1050, 6);
    expect(s.spots[1]!.dirt).toBe(1);
    // one call counts at most 160 px of movement
    expect(scrubAt(s, 420, 400, 10_000)).toBeCloseTo(160 / 1050, 6);
    while (s.spots[0]) scrubAt(s, 300, 400, 50);
    expect(count(run(s, 0.1), "spotCleaned")).toBe(0);
    expect(s.dollars).toBe(0);
  });

  it("rotting food starts or feeds a spot low on the glass near its x", () => {
    const s = glass({}, [jelly(0, 0, { anchor: 0 })]); // a polyp far off: nothing eats the pellet
    restFood(s, 0, 500);
    run(s, 31);
    const sp = s.spots.find(Boolean)!;
    expect(sp).toBeTruthy();
    expect(Math.abs(sp.x - 500)).toBeLessThan(SPOT_R);
    expect(sp.y).toBeGreaterThan(K.waterBot - 4 * SPOT_R);
    expect(sp.dirt).toBeGreaterThan(0.18);
    expect(sp.dirt).toBeLessThan(0.2);
    const d0 = sp.dirt;
    restFood(s, 1, 520);
    run(s, 31);
    expect(s.spots.filter(Boolean).length).toBe(1);
    expect(sp.dirt).toBeGreaterThan(d0 + 0.17);
  });

  it("the diver wipes the spots near it", () => {
    const s = glass();
    s.visit = planVisit(DIVER, { x0: K.glassL, x1: K.glassR }, 0, seeded(7))!;
    run(s, 2);
    const c = visitorInfo(s)!;
    put(s, 0, c.x, c.y, 1);
    put(s, 1, K.glassL + 70, K.waterTop + 70, 1);
    run(s, 4);
    expect(s.spots[0]?.dirt ?? 0).toBeLessThan(0.7);
    expect(s.spots[1]!.dirt).toBe(1);
  });

  it("while you're away spots appear and grow (to murk 0.8 at most); the snail cleans during it", () => {
    const save = tank([jelly(0, 3, { fullness: 0.9 })], { murk: 0, lastSeen: 0 });
    const after = applyAway(save, 30 * 60_000);
    expect(after.spots.length).toBeGreaterThanOrEqual(4);
    expect(after.murk).toBeCloseTo(0.8, 6);
    expect(after.murk).toBeCloseTo(murkOf(after.spots), 12);
    expect(applyAway(save, 48 * 3600_000).murk).toBeLessThanOrEqual(0.8 + 1e-9);
    const snail = applyAway({ ...save, helpers: [true, false, false] }, 30 * 60_000);
    expect(snail.murk).toBeLessThan(0.45);
    const s = createState(after, seeded());
    expect(s.murk).toBeCloseTo(after.murk, 12);
  });

  it("saves v8: spots round-trip; older saves start with a few spots that add up to their murk", () => {
    const s = glass();
    put(s, 0, 300, 399, 0.7, 2);
    put(s, 3, 600, 801, 0.2, 1);
    const saved = toSave(s, 1000);
    expect(saved.v).toBe(10);
    expect(saved.spots).toEqual([
      { x: 300, y: 399, dirt: 0.7, v: 2 },
      { x: 600, y: 801, dirt: 0.2, v: 1 },
    ]);
    const back = loadSave(JSON.stringify(saved), 1000);
    expect(back.spots).toEqual(saved.spots);
    expect(back.murk).toBeCloseTo(0.15, 12);
    // a v7 save with murk 0.5
    const old = { ...tank([jelly(0, 3)], { murk: 0.5, lastSeen: 1000 }), v: 7 } as Record<string, unknown>;
    delete old.spots;
    const m = loadSave(JSON.stringify(old), 1000);
    expect(m.v).toBe(10);
    expect(m.murk).toBeCloseTo(0.5, 9);
    expect(m.spots.length).toBeGreaterThanOrEqual(3);
    expect(m.spots.length).toBeLessThanOrEqual(12);
    for (const sp of m.spots) {
      expect(sp.dirt).toBeGreaterThan(0);
      expect(sp.dirt).toBeLessThanOrEqual(1);
      expect([0, 1, 2]).toContain(sp.v);
    }
    // a clean old tank starts clean; garbage spots are dropped
    expect(loadSave(JSON.stringify({ ...old, murk: 0 }), 1000).spots).toEqual([]);
    const bad = { ...saved, spots: [{ x: "a" }, null, { x: 300, y: 400, dirt: -1, v: 0 }, { x: 99999, y: -5, dirt: 2, v: 9 }] };
    const fixed = loadSave(JSON.stringify(bad), 1000).spots;
    expect(fixed.length).toBe(1);
    expect(fixed[0]!.dirt).toBe(1);
    expect(fixed[0]!.v).toBe(2);
    expect(fixed[0]!.x).toBeLessThanOrEqual(K.glassR);
  });

  it("view writes exactly the contract's props with tools, spots and flakes in play", () => {
    const s = createState(tank([jelly(0, 3), jelly(1, 0, { anchor: 1 })], { murk: 0.6 }), seeded());
    setTool(s, "food");
    setCursor(s, 300, 400, true, true);
    sprinkle(s, 300, 400);
    run(s, 0.3);
    const v = view(s);
    expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
    expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
    for (const gone of ["wipeX", "wipeO", "algae0", "algae1", "algae2"]) expect(K.props).not.toContain(gone);
    for (const [name, value] of Object.entries(v)) expect(Number.isFinite(value), name).toBe(true);
  });
});

describe("v10 motion", () => {
  const SQUEEZES = [0.22, 0.25, 0.28, 0.3, 0.34];
  /** the frames a pulse walks through, with consecutive repeats collapsed, and how long each is held */
  const walk = (frameAt: (p: number) => number, n = 4000) => {
    const seq: number[] = [];
    const dwell = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const f = frameAt(i / n);
      if (seq[seq.length - 1] !== f) seq.push(f);
      dwell.set(f, (dwell.get(f) ?? 0) + 1 / n);
    }
    return { seq, dwell };
  };
  const bfOf = (v: Record<string, number>, slot = 0) => [0, 1, 2, 3, 4, 5, 6, 7].findIndex((i) => v[`j${slot}bf${i}`] === 1);
  const tfOf = (v: Record<string, number>, slot = 0) => [0, 1, 2, 3, 4, 5, 6, 7].findIndex((i) => v[`j${slot}tf${i}`] === 1);
  const DEG = Math.PI / 180;

  it("the 8-frame pulse follows the eased curve: squeeze, release, overshoot, settle, rest, swell", () => {
    for (const sq of SQUEEZES) {
      const { seq, dwell } = walk((p) => pulseFrame(p, sq));
      // squeeze 2-3-4 (peak), release 5, overshoot 6, settle 7, rest 0, then the swell (anticipation) 1 before the next squeeze
      expect(seq).toEqual([2, 3, PULSE_PEAK, 5, PULSE_OVERSHOOT, 7, PULSE_REST, PULSE_SWELL]);
      // eased, not linear: the power stroke is quick, the peak is held longest within it, the settle eases out
      const d = (f: number) => dwell.get(f) ?? 0;
      expect(d(2) + d(3) + d(4)).toBeLessThan(sq);
      expect(d(4)).toBeGreaterThan(d(2));
      expect(d(4)).toBeGreaterThan(d(3));
      expect(d(7)).toBeGreaterThan(d(6));
      expect(d(6)).toBeGreaterThan(d(5));
      expect(d(PULSE_REST)).toBeGreaterThan(0.1);
      expect(d(PULSE_SWELL)).toBeCloseTo(1 - SWELL_AT, 2);
      const spread = [...dwell.values()];
      expect(Math.max(...spread) / Math.min(...spread)).toBeGreaterThan(3);
    }
  });

  it("a swimming adult pulses through the curve, each squeeze after a swell and the thrust starting with it", () => {
    for (const k of [0, 1, 5, 8] as Species[]) {
      const s = createState(tank([jelly(k, 3)]), seeded(3 + k));
      const seq: number[] = [];
      let pulsedOn = 0;
      let pulses = 0;
      for (let i = 0; i < 20 * 60; i++) {
        const ev = step(s, 1 / 60);
        const f = bfOf(view(s));
        if (count(ev, "pulse", 0)) {
          pulses++;
          if (f === 2) pulsedOn++;
        }
        if (seq[seq.length - 1] !== f) seq.push(f);
      }
      expect(pulses).toBeGreaterThan(4);
      expect(pulsedOn).toBe(pulses); // the beat event lands on the first squeeze frame
      const next: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 0, 0: 1 };
      // at 60 fps the quick squeeze frames can't be skipped... except a happy wiggle, which there isn't here
      for (let i = 1; i < seq.length; i++) expect(seq[i], `${k}: ${seq.slice(0, i + 1).join(",")}`).toBe(next[seq[i - 1]!]);
    }
  });

  it("a settled upside-down pulses in place on the same curve; polyps, ephyrae and the comb keep 4 frames", () => {
    const s = createState(tank([jelly(2, 3), jelly(0, 0, { anchor: 0 }), jelly(1, 1), jelly(3, 3)]), seeded(5));
    run(s, 2);
    const seen = [new Set<number>(), new Set<number>(), new Set<number>(), new Set<number>()];
    const up: number[] = [];
    for (let i = 0; i < 12 * 60; i++) {
      step(s, 1 / 60);
      const v = view(s);
      for (let k = 0; k < 4; k++) seen[k]!.add(bfOf(v, k));
      const f = bfOf(v, 0);
      if (up[up.length - 1] !== f) up.push(f);
    }
    expect(s.slots[0]!.mode).toBe("settled");
    expect(seen[0]!.size).toBe(8);
    const at = up.indexOf(2);
    expect(up.slice(at, at + 8)).toEqual([2, 3, 4, 5, 6, 7, 0, 1]);
    for (const k of [1, 2, 3]) expect(Math.max(...seen[k]!)).toBeLessThanOrEqual(3);
  });

  it("tentacles ripple smoothly through 8 sway frames, two waves per beat", () => {
    for (const k of [0, 5, 8, 2] as Species[]) {
      const s = createState(tank([jelly(k, 3)]), seeded(8 + k));
      let prev = tfOf(view(s));
      const seen = new Set<number>([prev]);
      let wraps = 0;
      let pulses = 0;
      for (let i = 0; i < 30 * 60; i++) {
        pulses += count(step(s, 1 / 60), "pulse", 0);
        const tf = tfOf(view(s));
        expect(tf).toBeGreaterThanOrEqual(0);
        const d = (tf - prev + 8) % 8;
        expect(d, `${k}: ${prev} -> ${tf}`).toBeLessThanOrEqual(1); // never skips or runs backwards
        if (d === 1 && tf === 0) wraps++;
        seen.add(tf);
        prev = tf;
      }
      expect(seen.size).toBe(8);
      if (k !== 2) expect(wraps / pulses).toBeCloseTo(TENT_WAVES_PER_PULSE, 0);
    }
    // polyps and ephyrae keep their 4
    const s = createState(tank([jelly(0, 0, { anchor: 0 }), jelly(1, 1)]), seeded(2));
    for (let i = 0; i < 10 * 60; i++) {
      step(s, 1 / 60);
      const v = view(s);
      expect(Math.max(tfOf(v, 0), tfOf(v, 1))).toBeLessThanOrEqual(3);
    }
  });

  it("the lean follows the travel direction, eases in with a little overshoot, and stays within 10 degrees", () => {
    for (const dir of [1, -1]) {
      const t = newTilt();
      let peak = 0;
      const outs: number[] = [];
      for (let i = 0; i < 6 * 60; i++) {
        stepTilt(t, dir * 60, -25, 1 / 60, false);
        peak = Math.max(peak, dir * t.a);
        outs.push(t.out);
        expect(Math.abs(t.out)).toBeLessThanOrEqual(TILT.max + 1e-9);
      }
      const target = tiltTarget(dir * 60, -25);
      expect(Math.sign(target)).toBe(dir); // toward the travel: right = clockwise (positive)
      expect(Math.abs(t.out - target)).toBeLessThan(0.75 * DEG); // settled on it
      expect(dir * outs[6]!).toBeLessThan(0.5 * Math.abs(target)); // a little lag: not there after 0.1 s
      expect(TILT.max).toBeCloseTo(10 * DEG);
      // a target inside the limit overshoots a little, then settles back
      const u = newTilt();
      let over = 0;
      for (let i = 0; i < 6 * 60; i++) {
        stepTilt(u, dir * 16, -20, 1 / 60, false);
        over = Math.max(over, dir * u.a);
      }
      const tgt = Math.abs(tiltTarget(dir * 16, -20));
      expect(over).toBeGreaterThan(tgt * 1.03);
      expect(over).toBeLessThan(tgt * 1.3);
      expect(dir * u.a).toBeCloseTo(tgt, 2);
    }
    // upright when still, or heading down
    expect(tiltTarget(0, 0)).toBe(0);
    expect(tiltTarget(8, 30)).toBe(0);
    const t = newTilt();
    for (let i = 0; i < 300; i++) stepTilt(t, 40, -20, 1 / 60, false);
    for (let i = 0; i < 300; i++) stepTilt(t, 5, 25, 1 / 60, false);
    expect(Math.abs(t.out)).toBeLessThanOrEqual(0.5 * DEG);
  });

  it("swimming jellies lean while they travel and never jitter; polyps and settled jellies never lean", () => {
    const s = createState(tank([jelly(0, 3), jelly(8, 3), jelly(3, 3), jelly(0, 0, { anchor: 0 }), jelly(2, 3)], { tier: 1 }), seeded(12));
    const rand = seeded(42);
    // a jitter is a step undone almost at once: A -> B -> A with B held for under a tenth of a second
    const runs = [0, 0, 0].map(() => [] as { r: number; n: number }[]);
    let flicker = 0;
    let most = 0;
    for (let i = 0; i < 90 * 60; i++) {
      if (i % (6 * 60) === 0) tap(s, 80 + rand() * 560, 120 + rand() * 600);
      step(s, 1 / 60);
      const v = view(s);
      for (let k = 0; k < 3; k++) {
        const r = v[`j${k}rot`]!;
        expect(Math.abs(r)).toBeLessThanOrEqual(10 * DEG + 1e-4);
        most = Math.max(most, Math.abs(r));
        const rk = runs[k]!;
        const cur = rk[rk.length - 1];
        if (cur && cur.r === r) cur.n++;
        else {
          const [a, b] = [rk[rk.length - 2], cur];
          if (a && b && a.r === r && b.n < 6) flicker++;
          rk.push({ r, n: 1 });
        }
      }
      expect(v.j3rot).toBe(0); // polyp
      if (s.slots[4]!.mode === "settled") expect(v.j4rot).toBe(0);
    }
    expect(flicker).toBe(0);
    expect(most).toBeGreaterThan(3 * DEG);
  });

  it("the view writes the v10 props: bf0..7, tf0..7 and rot for every slot, and nothing else", () => {
    for (let s = 0; s < MAX_SLOTS; s++) for (const n of ["bf7", "tf7", "rot"]) expect(K.props).toContain(`j${s}${n}`);
    const s = createState(tank([jelly(0, 3), null, jelly(2, 3), jelly(3, 2), jelly(0, 0, { anchor: 0 })], { tier: 1 }), seeded());
    run(s, 3);
    expect(new Set(Object.keys(view(s)))).toEqual(new Set(K.props));
    expect(new Set(Object.keys(view(s)))).toEqual(new Set(specProps()));
  });
});

// ---------------------------------------------------------------- v11: foods and favourites

describe("v11: foods", () => {
  const fed = (extra: Partial<Save> = {}, slots: (SaveJelly | null)[] = []) => {
    const s = createState(tank(slots, { foods: [true, true, true], ...extra }), seeded(4));
    s.nextVisit = Infinity;
    return s;
  };
  const live = (s: State) => s.food.filter((f) => f.state === "sink" || f.state === "rest");

  it("three kinds: the can pours flakes, the jar brine shrimp, the bottle plankton; the view shows each pellet's kind", () => {
    expect(FOOD_TOOLS).toEqual(["food", "shrimp", "plankton"]);
    expect(FOOD_NAMES).toEqual(["Flakes", "Brine shrimp", "Plankton"]);
    for (const [tool, kind] of [["food", 0], ["shrimp", 1], ["plankton", 2]] as const) {
      const s = fed();
      expect(foodKindOf(tool)).toBe(kind);
      expect(isFoodTool(tool)).toBe(true);
      expect(setTool(s, tool)).toBe(tool);
      const n = sprinkle(s, 400, 500);
      expect(n).toBeGreaterThan(0);
      const fs = live(s);
      expect(fs.every((f) => f.kind === kind)).toBe(true);
      const v = view(s);
      s.food.forEach((f, i) => {
        expect([0, 1, 2].map((k) => v[`food${i}k${k}`])).toEqual([0, 1, 2].map((k) => (k === f.kind ? 1 : 0)));
      });
    }
    expect(isFoodTool("sponge")).toBe(false);
    expect(isFoodTool("none")).toBe(false);
    // an explicit kind wins; with nothing in hand it's flakes
    const s = fed();
    sprinkle(s, 300, 400, 2);
    expect(live(s).every((f) => f.kind === 2)).toBe(true);
    const t = fed();
    sprinkle(t, 300, 400);
    expect(live(t).every((f) => f.kind === 0)).toBe(true);
    // feed() (demo) drops flakes
    const u = fed();
    feed(u);
    expect(live(u).every((f) => f.kind === 0)).toBe(true);
  });

  it("the pool is shared: 16 pellets of any mix, and the rate cap counts them all", () => {
    const s = fed();
    let tries = 0;
    const tools = ["food", "shrimp", "plankton"] as const;
    while (live(s).length < 16 && tries++ < 300) {
      setTool(s, tools[tries % 3]!);
      sprinkle(s, 300 + (tries % 5) * 30, 300);
      step(s, 0.1);
    }
    expect(live(s).length).toBe(16);
    expect(new Set(live(s).map((f) => f.kind)).size).toBe(3);
    expect(sprinkle(s, 400, 400)).toBe(0);
    const t = fed();
    setTool(t, "plankton");
    let n = 0;
    for (let i = 0; i < 50; i++) n += sprinkle(t, 400, 500);
    expect(n).toBeLessThanOrEqual(POUR_BURST);
  });

  it("the jar and the bottle can't be picked up until they're bought; then they toggle like the can", () => {
    const s = createState(moonTank({}, { dollars: 200 }), seeded());
    expect(setTool(s, "shrimp")).toBe("none");
    expect(toggleTool(s, "plankton")).toBe("none");
    let v = view(s);
    expect([v.haveShrimp, v.havePlankton]).toEqual([0, 0]);
    openShop(s);
    expect(buy(s, 18)).toBe("bought");
    expect(buy(s, 18)).toBe("owned");
    closeShop(s);
    run(s, 1);
    expect(s.dollars).toBe(160);
    v = view(s);
    expect([v.haveShrimp, v.havePlankton]).toEqual([1, 0]);
    expect(toggleTool(s, "shrimp")).toBe("shrimp");
    run(s, 0.5);
    v = view(s);
    expect([v.toolShrimp, v.toolFood, v.toolPlankton, v.b4y, v.b0y]).toEqual([1, 0, 0, P, 0]);
    expect(setTool(s, "plankton")).toBe("shrimp"); // not owned: the jar stays in hand
    expect(toggleTool(s, "food")).toBe("food"); // picking the can up puts the jar down
    expect(view(s).toolShrimp).toBe(0);
    expect(toggleTool(s, "food")).toBe("none");
  });

  it("each food has its own held cursor: it follows the pointer and tips while pouring", () => {
    const s = fed();
    setTool(s, "plankton");
    setCursor(s, 301, 452, false, true);
    let v = view(s);
    expect([v.bottleO, v.bottleX, v.bottleY, v.bottleF0, v.bottleF1, v.canO, v.jarO, v.spongeO]).toEqual([1, snap(301), snap(452), 1, 0, 0, 0, 0]);
    setCursor(s, 301, 452, true, true);
    v = view(s);
    expect([v.bottleF0, v.bottleF1]).toEqual([0, 1]);
    setTool(s, "shrimp"); // switching tools lifts the press
    setCursor(s, 301, 452, true, true);
    v = view(s);
    expect([v.jarO, v.jarF1, v.bottleO, v.bottleF1, v.canO]).toEqual([1, 1, 0, 0, 0]);
    setCursor(s, 301, 452, false, false);
    expect(view(s).jarO).toBe(0);
  });
});

describe("v11: favourite foods", () => {
  it("every species has one: plankton for moon, comb, crystal, flower hat; brine shrimp for the rest", () => {
    expect(Array.from({ length: 9 }, (_, k) => favouriteFood(k as Species))).toEqual([2, 1, 1, 2, 1, 1, 2, 2, 1]);
    expect(FOOD_NAMES[favouriteFood(1)]).toBe("Brine shrimp");
  });

  /** a fed adult blubber (favourite: brine shrimp) and one pellet of `kind` dropped into its arms */
  const meal = (kind: 0 | 1 | 2) => {
    const s = createState(tank([jelly(1, 3, { fullness: 0.3 })], { foods: [true, true, true] }), seeded(3));
    s.nextVisit = Infinity;
    const j = j0(s);
    const gp0 = j.gp;
    const full0 = j.fullness;
    const f = s.food[0]!;
    Object.assign(f, { state: "sink", kind, x: j.x - 4, y: j.y + 20, vy: 0, age: 0, by: -1 });
    const events = run(s, 1 / 60);
    return { s, j, gp: j.gp - gp0, full: j.fullness - full0, events };
  };

  it("eating a favourite grows twice as fast, fills a little more and pleases it (wiggle and a longer flush)", () => {
    const plain = meal(0);
    const fav = meal(1);
    const other = meal(2);
    expect(count(plain.events, "ate", 0)).toBe(1);
    expect(count(fav.events, "ate", 0)).toBe(1);
    expect(fav.gp).toBeCloseTo(2 * plain.gp, 9);
    expect(other.gp).toBeCloseTo(plain.gp, 9);
    expect(fav.full).toBeGreaterThan(plain.full);
    const e = fav.events.find((x) => x.type === "ate")!;
    expect(e.fav).toBe(true);
    expect(e.food).toBe(1);
    expect(plain.events.find((x) => x.type === "ate")!.fav).toBeUndefined();
    // both meals wiggle and flush; the favourite's flush lasts longer
    run(plain.s, 1.2);
    run(fav.s, 1.2);
    expect(view(plain.s).j0flush).toBe(0);
    expect(view(fav.s).j0flush).toBeGreaterThan(0);
    // meals still pay a dollar each
    expect(fav.s.dollars).toBe(1);
  });

  it("with several foods in the water, a jelly chases its favourite", () => {
    for (const [k, fav, other] of [[1, 1, 2], [0, 2, 1], [6, 2, 0]] as const) {
      const s = createState(tank([jelly(k, 3, { fullness: 0.2 })], { foods: [true, true, true] }), seeded(6));
      s.nextVisit = Infinity;
      const j = j0(s);
      j.x = 360;
      j.y = 500;
      // the other food is right below it; its favourite about twice as far away
      Object.assign(s.food[0]!, { state: "sink", kind: other, x: 360 - 4, y: 640, vy: 0, age: 0 });
      Object.assign(s.food[1]!, { state: "sink", kind: fav, x: 480 - 4, y: 700, vy: 0, age: 0 });
      step(s, 1 / 60);
      expect(j.targetKind).toBe("food");
      expect(Math.abs(j.target!.x - 480)).toBeLessThan(Math.abs(j.target!.x - 360));
    }
    // with only other foods around it still eats them
    const s = createState(tank([jelly(1, 3, { fullness: 0.2 })]), seeded(6));
    s.nextVisit = Infinity;
    sprinkle(s, j0(s).x, j0(s).y + 40);
    expect(count(run(s, 20), "ate", 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- v11: tank themes

describe("v11: tank themes", () => {
  const rich = (extra: Partial<Save> = {}) => {
    const s = createState(moonTank({}, { dollars: 1000, ...extra }), seeded());
    s.nextVisit = Infinity;
    return s;
  };
  const themeHot = (s: State) => [0, 1, 2, 3].map((t) => view(s)[`theme${t}`]);

  it("starts on the Reef, theme0..3 one-hot", () => {
    const s = rich();
    expect(s.theme).toBe(0);
    expect(themeHot(s)).toEqual([1, 0, 0, 0]);
    const v = view(s);
    expect([v.use20, v.own20, v.lock20]).toEqual([1, 0, 0]);
    for (const i of [21, 22, 23]) expect([v[`use${i}`], v[`own${i}`], v[`lock${i}`]]).toEqual([0, 0, 0]);
    expect(SHOP_ITEMS.slice(20).map((it) => [it.name, it.kind])).toEqual([["REEF", "theme"], ["KELP FOREST", "theme"], ["CORAL GARDEN", "theme"], ["ARCTIC", "theme"]]);
    for (const it of SHOP_ITEMS.slice(21)) expect(it.price >= 120 && it.price <= 200).toBe(true);
  });

  it("buying a theme applies it: the shop slides shut, 'themed' comes out, a sparkle once it's down", () => {
    const s = rich();
    openShop(s);
    setTab(s, 3);
    run(s, 0.5);
    expect(buy(s, 22)).toBe("bought");
    expect(s.dollars).toBe(1000 - SHOP_ITEMS[22]!.price);
    expect(s.theme).toBe(2);
    expect(isShopOpen(s)).toBe(false);
    const events = run(s, 1);
    expect(events.filter((e) => e.type === "themed").map((e) => e.theme)).toEqual([2]);
    expect(themeHot(s)).toEqual([0, 0, 1, 0]);
    const v = view(s);
    expect([v.use22, v.own22, v.lock22]).toEqual([1, 0, 0]);
    expect([v.use20, v.own20]).toEqual([0, 1]);
    expect(themeInfo(s)).toEqual({ theme: 2, name: "Coral Garden", owned: [true, false, true, false] });
  });

  it("owned themes are picked again by tapping their card (no charge); the one in use does nothing", () => {
    const s = rich();
    openShop(s);
    buy(s, 21);
    const left = s.dollars;
    openShop(s);
    expect(buy(s, 20)).toBe("selected");
    expect(s.theme).toBe(0);
    expect(isShopOpen(s)).toBe(false);
    openShop(s);
    expect(buy(s, 20)).toBe("owned");
    expect(isShopOpen(s)).toBe(true);
    expect(buy(s, 21)).toBe("selected");
    expect(s.theme).toBe(1);
    expect(s.dollars).toBe(left);
    expect(setTheme(s, 3)).toBe(false); // not owned
    expect(setTheme(s, 9)).toBe(false);
    expect(s.theme).toBe(1);
    expect(setTheme(s, 0)).toBe(true);
    expect(s.theme).toBe(0);
  });

  it("can't buy one without the dollars; it shows locked", () => {
    const s = rich({ dollars: 150 });
    expect(view(s).lock23).toBe(1);
    expect(view(s).lock21).toBe(0);
    openShop(s);
    expect(buy(s, 23)).toBe("cantAfford");
    expect(s.theme).toBe(0);
    expect(s.dollars).toBe(150);
  });

  it("owned themes, the theme in use and owned foods persist; damaged values fall back", () => {
    const s = rich();
    openShop(s);
    buy(s, 23);
    openShop(s);
    buy(s, 19);
    const saved = toSave(s, 5000);
    expect(saved).toMatchObject({ v: 10, theme: 3, themes: [true, false, false, true], foods: [true, false, true] });
    const back = createState(loadSave(JSON.stringify(saved), 5000), seeded());
    expect([back.theme, back.themes, back.foods]).toEqual([3, [true, false, false, true], [true, false, true]]);
    expect(themeHot(back)).toEqual([0, 0, 0, 1]);
    // a theme that isn't owned (or nonsense) loads as the Reef; flakes and the Reef are always owned
    const bad = loadSave(JSON.stringify({ ...saved, theme: 2, themes: [false, "x"], foods: null }), 5000);
    expect([bad.theme, bad.themes, bad.foods]).toEqual([0, [true, false, false, false], [true, false, false]]);
  });

  it("older saves migrate to v9 with only flakes and the Reef", () => {
    const v8 = { ...toSave(rich(), 1000), v: 8 } as Record<string, unknown>;
    delete v8.foods;
    delete v8.themes;
    delete v8.theme;
    const m = loadSave(JSON.stringify(v8), 2000);
    expect(m).toMatchObject({ v: 10, theme: 0, themes: [true, false, false, false], foods: [true, false, false] });
    const v1 = loadSave(JSON.stringify({ v: 1, fullness: 0.5, murk: 0.2, affection: 0.5, night: false, lastSeen: 1000 }), 2000);
    expect(v1).toMatchObject({ v: 10, theme: 0, themes: [true, false, false, false], foods: [true, false, false] });
    expect(defaultSave(0)).toMatchObject({ v: 10, theme: 0, foods: [true, false, false] });
  });

  it("share codes carry the theme; a Reef tank's code is unchanged (version 1)", () => {
    const s = rich();
    const reefCode = exportTank(s);
    openShop(s);
    buy(s, 21);
    const kelpCode = exportTank(s);
    expect(kelpCode).not.toBe(reefCode);
    const save = importTank(kelpCode, at(12))!;
    expect(save.theme).toBe(1);
    expect(save.themes[1]).toBe(true);
    const back = createState(save, seeded());
    expect(back.theme).toBe(1);
    expect(exportTank(back)).toBe(kelpCode);
    setTheme(s, 0);
    expect(exportTank(s)).toBe(reefCode);
    expect(importTank(reefCode, at(12))!.theme).toBe(0);
  });

  it("the view writes exactly the contract's props with foods, tools and themes in play", () => {
    const s = rich();
    openShop(s);
    buy(s, 18);
    openShop(s);
    buy(s, 19);
    openShop(s);
    buy(s, 21);
    run(s, 1);
    setTool(s, "plankton");
    setCursor(s, 300, 400, true, true);
    sprinkle(s, 300, 400);
    run(s, 0.5);
    const v = view(s);
    expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
    expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
    for (const [name, value] of Object.entries(v)) expect(Number.isFinite(value), name).toBe(true);
    for (const t of ["shrimp", "plankton"]) expect((K as unknown as { triggers: string[] }).triggers).toContain(t);
    const buttons = K.buttons as unknown as { name: string }[];
    for (const t of ["feed", "shrimp", "plankton", "clean", "lamp", "shop"]) expect(buttons.map((b) => b.name)).toContain(t);
  });
});
