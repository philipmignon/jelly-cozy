/**
 * Seasonal events in the sim (the Halloween decor prop and the bat visitor) and quiet nights (slower, sparser
 * pulses, gathering, the bell's night glow).
 */
import { describe, expect, it } from "vitest";
import { QUIET, calmOf, gatherPoint, gatherTarget, nightGlow, quietPeriod } from "./motion";
import {
  DECOR,
  K,
  createState,
  feed,
  journalFrom,
  nightGather,
  rightGlass,
  setEvent,
  step,
  tap,
  view,
  viewSpan,
  visitorInfo,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";
import { BAT, BAT_HANG_Y, VISITORS, boxFacing, planVisit, settled } from "./visitors";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const run = (s: State, seconds: number, dt = 1 / 60) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds / dt; i++) events.push(...step(s, dt));
  return events;
};
const count = (events: SimEvent[], type: string, slot?: number) => events.filter((e) => e.type === type && (slot === undefined || e.slot === slot)).length;
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 0.7, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 1,
  ...extra,
});
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 11, foods: [true, false, false], themes: [true, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null,
  owned: [false, false, false, false, false], helpers: [false, false, false], decorX: DECOR.map((d) => d.x),
  pearlDay: "", lastSeen: 0, tier: 0, cam: 0, journal: journalFrom(slots, 0),
  ...extra,
});
/** Day or night by the lamp, held for the whole test. */
const light = (s: State, night: boolean) => {
  s.lamp = { night, until: s.clock + 20 * 3_600_000 };
  s.nightTarget = night;
  s.night = night ? 1 : 0;
  return s;
};

describe("quiet nights: motion helpers", () => {
  it("calm eases in with the night", () => {
    expect(calmOf(0)).toBe(0);
    expect(calmOf(1)).toBe(1);
    expect(calmOf(0.5)).toBeCloseTo(0.5);
    expect(calmOf(0.2)).toBeLessThan(0.2);
    expect(calmOf(-1)).toBe(0);
  });

  it("idle pulses stretch the most at night; chasing food barely slows", () => {
    expect(quietPeriod(2, 0, false)).toBe(2);
    expect(quietPeriod(2, 1, false)).toBeCloseTo(2 * QUIET.period);
    expect(quietPeriod(2, 1, true)).toBeCloseTo(2 * QUIET.busyPeriod);
    expect(QUIET.period).toBeGreaterThan(QUIET.busyPeriod);
  });

  it("the gathering point drifts slowly through the middle of the view's water", () => {
    let last = gatherPoint(0, 0, 720, 100, 900);
    for (let t = 0.5; t < 600; t += 0.5) {
      const p = gatherPoint(t, 0, 720, 100, 900);
      expect(p.x).toBeGreaterThanOrEqual(0.3 * 720 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(0.7 * 720 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(100 + 0.35 * 800 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(100 + 0.6 * 800 + 1e-9);
      expect(Math.hypot(p.x - last.x, p.y - last.y) / 0.5).toBeLessThan(10); // px/s
      last = p;
    }
    const a = gatherPoint(0, 0, 720, 100, 900);
    const b = gatherPoint(40, 0, 720, 100, 900);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(50); // it does wander
  });

  it("wander targets are pulled toward the point by night only, each slot to its own place", () => {
    const free = { x: 100, y: 200 };
    const pt = { x: 400, y: 500 };
    expect(gatherTarget(free, pt, 0, 0, 0.5)).toEqual(free);
    const spots = [0, 1, 2, 3, 4].map((slot) => gatherTarget(free, pt, slot, 1, 0.5));
    for (const g of spots) {
      expect(Math.hypot(g.x - pt.x, g.y - pt.y)).toBeLessThan(Math.hypot(free.x - pt.x, free.y - pt.y) * 0.6);
    }
    expect(new Set(spots.map((g) => `${Math.round(g.x)},${Math.round(g.y)}`)).size).toBe(5);
  });

  it("the bell glows only at night, brightest for the crystal and comb, swelling on the squeeze", () => {
    expect(nightGlow(0, 6, 0.1)).toBe(0);
    expect(nightGlow(1, 6, 0.6)).toBeGreaterThan(nightGlow(1, 0, 0.6));
    expect(nightGlow(1, 3, 0.6)).toBeGreaterThan(nightGlow(1, 1, 0.6));
    expect(nightGlow(1, 0, 0.29, 0.3)).toBeGreaterThan(nightGlow(1, 0, 0.9, 0.3));
    for (let p = 0; p < 1; p += 0.01) {
      const g = nightGlow(1, 6, p);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});

describe("quiet nights: the tank settles", () => {
  it("an idle jelly pulses less often at night", () => {
    const pulses = (night: boolean) => {
      const s = light(createState(tank([jelly(0, 3, { fullness: 1 })]), seeded(2)), night);
      s.nextVisit = Infinity;
      return count(run(s, 120, 1 / 30), "pulse", 0);
    };
    const day = pulses(false);
    const night = pulses(true);
    expect(day).toBeGreaterThan(30);
    expect(night).toBeLessThan(day * 0.75);
  });

  it("swimmers drift slower at night", () => {
    const speed = (night: boolean) => {
      const s = light(createState(tank([jelly(0, 3, { fullness: 1 }), jelly(1, 3, { fullness: 1 }), jelly(5, 3, { fullness: 1 })]), seeded(3)), night);
      s.nextVisit = Infinity;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 180 * 30; i++) {
        step(s, 1 / 30);
        for (const j of s.slots) if (j) (sum += Math.hypot(j.vx, j.vy)), n++;
      }
      return sum / n;
    };
    expect(speed(true)).toBeLessThan(speed(false) * 0.85);
  });

  it("at night they loosely gather round the drifting point", () => {
    const spread = (night: boolean, seed: number) => {
      const s = light(createState(tank([0, 1, 5, 6, 8].map((k) => jelly(k as Species, 3, { fullness: 1 })), { tier: 1 }), seeded(seed)), night);
      s.nextVisit = Infinity;
      let total = 0;
      let samples = 0;
      for (let i = 0; i < 400 * 10; i++) {
        step(s, 1 / 10);
        if (i > 100 * 10 && i % 10 === 0) {
          const g = nightGather(s);
          for (const j of s.slots) if (j) total += Math.hypot(j.x - g.x, j.y - g.y);
          samples += 5;
        }
      }
      return total / samples;
    };
    for (const seed of [4, 9]) expect(spread(true, seed)).toBeLessThan(spread(false, seed) * 0.8);
  });

  it("the gathering point stays in the water the player is looking at", () => {
    const s = light(createState(tank([jelly(0, 3)], { tier: 2, cam: -600 }), seeded(5)), true);
    for (let t = 0; t < 300; t += 7) {
      s.t = t;
      const g = nightGather(s);
      const sp = viewSpan(s);
      expect(g.x).toBeGreaterThanOrEqual(Math.max(sp.x0, K.glassL));
      expect(g.x).toBeLessThanOrEqual(Math.min(sp.x1, rightGlass(s)));
      expect(g.y).toBeGreaterThan(K.waterTop);
      expect(g.y).toBeLessThan(K.waterBot);
    }
  });

  it("food is still chased at night", () => {
    const s = light(createState(tank([jelly(0, 3, { fullness: 0.2 })]), seeded(6)), true);
    s.nextVisit = Infinity;
    feed(s);
    expect(count(run(s, 30), "ate", 0)).toBeGreaterThan(0);
  });

  it("view: nglow is 0 by day and lights at night; ghost is 0 until the morph id lands", () => {
    const s = light(createState(tank([jelly(6, 3), jelly(0, 3)]), seeded(7)), false);
    run(s, 1);
    expect(view(s).j0nglow).toBe(0);
    light(s, true);
    let max = 0;
    for (let i = 0; i < 180; i++) {
      step(s, 1 / 60);
      max = Math.max(max, view(s).j0nglow!);
    }
    expect(max).toBeGreaterThan(0.5);
    expect(view(s).j0ghost).toBe(0);
    expect(view(s).j2nglow).toBe(0); // an empty slot
    expect(new Set(Object.keys(view(s)))).toEqual(new Set(K.props));
  });
});

describe("seasons in the tank: Halloween", () => {
  it("the decor prop follows the event", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(8));
    expect(view(s).evHalloween).toBe(0);
    setEvent(s, "halloween");
    expect(view(s).evHalloween).toBe(1);
    setEvent(s, null);
    expect(view(s).evHalloween).toBe(0);
  });

  it("the bat only visits during Halloween, and it comes along with the others", () => {
    const kinds = (event: "halloween" | null) => {
      const s = createState(tank([jelly(0, 3, { fullness: 1 })], { murk: 0 }), seeded(11));
      setEvent(s, event);
      const seen = new Set<string>();
      for (let i = 0; i < 60 * 60 * 6; i++) for (const e of step(s, 0.5)) if (e.type === "visitorArrived") seen.add(e.kind!);
      return seen;
    };
    expect(kinds(null).has("bat")).toBe(false);
    const hw = kinds("halloween");
    expect(hw.has("bat")).toBe(true);
    expect(hw.size).toBe(VISITORS.length);
  });

  it("flutters in, hangs from the hood's lip, stays in view at every tier and camera, then flutters off", () => {
    for (const tier of [0, 1, 2]) {
      for (const cam of [0, -360, -720]) {
        const s = createState(tank([jelly(0, 3)], { tier, cam }), seeded(20 + tier - cam));
        s.nextVisit = Infinity;
        s.visit = planVisit(BAT, { x0: Math.max(viewSpan(s).x0, K.glassL), x1: Math.min(viewSpan(s).x1, rightGlass(s)) }, tier, seeded(3 + tier))!;
        setEvent(s, "halloween");
        expect(s.visit).not.toBe(null);
        const frames = new Set<number>();
        let hung = 0;
        while (s.visit) {
          step(s, 0.05);
          const v = s.visit;
          if (!v) break;
          frames.add(v.f);
          const b = boxFacing(v.kind, v.sx);
          const sp = viewSpan(s);
          expect(v.x + b.x0).toBeGreaterThanOrEqual(Math.max(sp.x0, K.glassL) - 0.5);
          expect(v.x + b.x1).toBeLessThanOrEqual(Math.min(sp.x1, rightGlass(s)) + 0.5);
          expect(v.y + b.y0).toBeGreaterThanOrEqual(K.waterTop);
          expect(v.y + b.y1).toBeLessThanOrEqual(K.waterBot);
          if (settled(v) && v.age > 4) {
            expect(v.y).toBe(BAT_HANG_Y);
            expect(v.f).toBeLessThan(2);
            hung++;
          }
        }
        expect(hung).toBeGreaterThan(20);
        expect([...frames].sort()).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it("a tap on the hanging bat pays once and sends it off happily", () => {
    const s = createState(tank([jelly(0, 3)], { dollars: 10 }), seeded(12));
    setEvent(s, "halloween");
    s.visit = planVisit(BAT, { x0: K.glassL, x1: K.glassR }, 0, seeded(4))!;
    s.nextVisit = Infinity;
    run(s, 5);
    const c = visitorInfo(s)!;
    expect(c.kind).toBe("bat");
    expect(tap(s, c.x, c.y)).toBe("visitor");
    expect(s.dollars).toBeGreaterThanOrEqual(15);
    const ev = run(s, 4);
    expect(count(ev, "visitorLeft")).toBe(1);
    expect(s.visit).toBe(null);
  });

  it("when the event goes off, a visiting bat leaves", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(13));
    setEvent(s, "halloween");
    s.visit = planVisit(BAT, { x0: K.glassL, x1: K.glassR }, 0, seeded(5))!;
    s.nextVisit = Infinity;
    run(s, 6);
    setEvent(s, null);
    expect(count(run(s, 3), "visitorLeft")).toBe(1);
    expect(view(s).batOn).toBe(0);
  });

  it("its perch keeps clear of the settings gear at the top right", () => {
    for (let i = 0; i < 50; i++) {
      const v = planVisit(BAT, { x0: K.glassL, x1: K.glassR }, 0, seeded(100 + i))!;
      expect(v.gx).toBeLessThanOrEqual(K.glassR - 40 * K.P - boxFacing(BAT, 1).x1);
      expect(v.gy).toBe(BAT_HANG_Y);
    }
  });
});
