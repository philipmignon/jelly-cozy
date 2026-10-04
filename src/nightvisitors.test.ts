/**
 * v14: the night visitors (octopus, manta ray, hermit crab), the visitor log and the "Spot a night visitor" request.
 */
import { describe, expect, it } from "vitest";
import { eventWords } from "./a11y";
import { planRequests, requestText, rewardOf } from "./requests";
import {
  DECOR,
  K,
  camX,
  createState,
  decorBaseY,
  journalFrom,
  loadGame,
  putAway,
  rightGlass,
  setReducedMotion,
  step,
  tap,
  toSave,
  toggleLamp,
  view,
  viewSpan,
  visitorInfo,
  visitorLog,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";
import {
  FAR_PARALLAX,
  HERMIT,
  HERMIT_HOME,
  MANTA,
  OCTOPUS,
  OCTO_SPOTS,
  VISITORS,
  boxOf,
  farToWorld,
  nightVisitor,
  planVisit,
  type Visit,
} from "./visitors";
import { noteSighting, visitLogRows, visitorsSeenOf } from "./visitlog";

const P = K.P;
const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m).getTime();
const NIGHT = at(22);

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const run = (s: State, seconds: number, dt = 1 / 60) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds / dt; i++) events.push(...step(s, dt));
  return events;
};
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 1, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 1, ...extra,
});
const owned = (...ns: number[]) => Array.from({ length: DECOR.length }, (_, i) => ns.includes(i));
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 13, foods: [true, false, false], themes: [true, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 10, murk: 0, spots: [], night: true, lamp: null, owned: owned(), helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: NIGHT, tier: 0, cam: 0, journal: journalFrom(slots, 0), ...extra,
});
const stretch = (s: State) => {
  const v = viewSpan(s);
  return { x0: Math.max(v.x0, K.glassL), x1: Math.min(v.x1, rightGlass(s)), cam: camX(s) };
};
/** a night visitor of `kind` placed in the tank now */
function visit(s: State, kind: number, home: { x: number; y: number } | null = null): Visit {
  s.nextVisit = Infinity;
  const v = planVisit(kind, stretch(s), s.tier, seeded(9), { home });
  expect(v, `planned ${VISITORS[kind]}`).not.toBe(null);
  s.visit = v;
  return v!;
}

describe("v14: night visitors", () => {
  it("come only at night, now and then in place of a day visitor, each rarer than each day one", () => {
    const tally = (lastSeen: number) => {
      const s = createState(tank([jelly(0, 3)], { lastSeen }), seeded(41));
      const n = new Map<string, number>();
      for (const e of run(s, 60 * 60 * 8, 0.5)) if (e.type === "visitorArrived") n.set(e.kind!, (n.get(e.kind!) ?? 0) + 1);
      return n;
    };
    const day = tally(at(9));
    for (const k of ["octopus", "manta", "hermit"]) expect(day.has(k), k).toBe(false);
    const night = tally(at(19, 5));
    for (const k of ["octopus", "manta", "hermit"]) expect(night.get(k) ?? 0, k).toBeGreaterThan(0);
    const fewestDay = Math.min(...["turtle", "seahorse", "diver"].map((k) => night.get(k) ?? 0));
    for (const k of ["octopus", "manta", "hermit"]) expect(night.get(k)!, k).toBeLessThan(fewestDay);
  });

  it("stay in view (inside the glass, in the water) at every tier and camera position", () => {
    for (const tier of [0, 1, 2]) {
      for (const cam of [0, -360, -720]) {
        const s = createState(tank([jelly(0, 3)], { tier, cam, owned: owned(2) }), seeded(5 + tier));
        for (const kind of [OCTOPUS, MANTA, HERMIT]) {
          const home = kind === HERMIT ? { x: s.decorX[2]!, y: decorBaseY(s, 2) } : null;
          s.nextVisit = Infinity;
          const v = planVisit(kind, stretch(s), tier, seeded(3 + tier), { home });
          if (!v) continue; // e.g. no rock in this view for the octopus
          s.visit = v;
          while (s.visit) {
            step(s, 0.1);
            const w = s.visit;
            if (!w || w.on * w.vis <= 0.05) continue;
            const st = stretch(s);
            const b = boxOf(w);
            const label = `${VISITORS[kind]} tier ${tier} cam ${cam}`;
            expect(w.x + b.x0, label).toBeGreaterThanOrEqual(st.x0 - 0.5);
            expect(w.x + b.x1, label).toBeLessThanOrEqual(st.x1 + 0.5);
            expect(w.y + b.y0, label).toBeGreaterThanOrEqual(K.waterTop);
            expect(w.y + b.y1, label).toBeLessThanOrEqual(K.waterBot);
          }
        }
      }
    }
  });

  it("the octopus rises from behind its rock, changes colour, reaches for a jelly (flicking) and slips back", () => {
    const frames = (reduced: boolean) => {
      const s = createState(tank([jelly(0, 3)]), seeded(6));
      setReducedMotion(s, reduced);
      const v = visit(s, OCTOPUS);
      const sp = OCTO_SPOTS[v.spot]!;
      s.slots[0]!.x = sp.x + 150;
      expect(v.dy).toBe(sp.rise); // starts hidden under the rock's edge
      const seen = new Set<number>();
      let c1 = 0;
      let minDy = Infinity;
      for (let i = 0; i < 25 * 60 && s.visit; i++) {
        step(s, 1 / 60);
        s.slots[0]!.x = sp.x + 150; // the jelly holds still nearby
        s.slots[0]!.y = sp.y - 200;
        seen.add(v.f);
        c1 = Math.max(c1, v.c1);
        minDy = Math.min(minDy, v.dy);
      }
      expect(minDy).toBeLessThan(1); // all the way up
      expect(c1).toBeGreaterThan(0.9); // went rock-grey
      expect(view(s)[`octoS${v.spot}`]).toBe(1);
      return seen;
    };
    const normal = frames(false);
    expect(normal.has(2) && normal.has(3)).toBe(true);
    const calm = frames(true);
    expect(calm.has(2)).toBe(true);
    expect(calm.has(3)).toBe(false); // no tip flick with reduced motion
  });

  it("the octopus flushes pale when greeted, pays, and slips back behind the rock", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(7));
    const v = visit(s, OCTOPUS);
    run(s, 6);
    const c = visitorInfo(s)!;
    expect(c.kind).toBe("octopus");
    expect(tap(s, c.x, c.y)).toBe("visitor");
    expect(s.dollars).toBeGreaterThanOrEqual(15);
    const ev = run(s, 0.6);
    expect(v.c2).toBeGreaterThan(0.9);
    expect(ev.find((e) => e.type === "visitorTapped")?.kind).toBe("octopus");
    const sp = OCTO_SPOTS[v.spot]!;
    run(s, 3.5);
    expect(s.visit).toBe(null);
    expect(v.dy).toBeGreaterThan(sp.rise * 0.9);
  });

  it("the manta glides in the Far layer: its world x follows the camera's parallax; greeted, it eases faster (not with reduced motion)", () => {
    const pace = (reduced: boolean) => {
      const s = createState(tank([jelly(0, 3)], { tier: 2, cam: -360 }), seeded(8));
      setReducedMotion(s, reduced);
      const v = visit(s, MANTA);
      run(s, 3);
      expect(v.x).toBeCloseTo(farToWorld(v.gx, camX(s)), 6);
      expect(view(s).mantaX).toBe(Math.round(v.gx / P) * P);
      const before = Math.abs(v.vx);
      const c = visitorInfo(s)!;
      expect(tap(s, c.x, c.y)).toBe("visitor");
      const g0 = v.gx;
      run(s, 0.9);
      return Math.abs(v.gx - g0) / 0.9 / before;
    };
    expect(pace(false)).toBeGreaterThan(1.15);
    expect(pace(true)).toBeCloseTo(1, 2);
    expect(farToWorld(100, -100)).toBeCloseTo(100 + 100 * (1 - FAR_PARALLAX), 6);
  });

  it("the hermit crab walks to the dive helmet, slips in and peeks out of its port", () => {
    const s = createState(tank([jelly(0, 3)], { owned: owned(2) }), seeded(10));
    const home = { x: s.decorX[2]!, y: decorBaseY(s, 2) };
    const v = visit(s, HERMIT, home);
    expect(v.home).toBe(true);
    expect(v.f).toBeLessThan(2);
    let peeked = false;
    for (let i = 0; i < 20 * 60 && s.visit; i++) {
      step(s, 1 / 60);
      if (v.f >= 2 && v.vis > 0.9) {
        peeked = true;
        expect(v.x).toBe(home.x + HERMIT_HOME.dx);
        expect(v.y).toBe(home.y + HERMIT_HOME.dy);
      }
    }
    expect(peeked).toBe(true);
    // without the helmet it wanders the sand
    const t = createState(tank([jelly(0, 3)]), seeded(11));
    const w = visit(t, HERMIT, null);
    expect(w.home).toBe(false);
    const x0 = w.x;
    run(t, 4);
    expect(Math.abs(w.x - x0)).toBeGreaterThan(20);
    expect(w.f).toBeLessThan(2);
  });

  it("v15: a helmet put away is no home: the crab heading for it scuttles off, and the next one wanders the sand", () => {
    const s = createState(tank([jelly(0, 3)], { owned: owned(2) }), seeded(10));
    const v = visit(s, HERMIT, { x: s.decorX[2]!, y: decorBaseY(s, 2) });
    expect(v.home).toBe(true);
    expect(putAway(s, 2)).toBe(true);
    step(s, 1 / 60);
    expect(v.home).toBe(false);
    expect(v.leaveAt).toBeLessThanOrEqual(v.age);
    run(s, 10);
    expect(s.visit).toBe(null);
    // the sim plans the next hermit with no home while the helmet stays in the drawer
    s.lastVisitor = MANTA;
    for (let i = 0; i < 4000 && s.visit?.kind !== HERMIT; i++) {
      s.visit = null;
      s.nextVisit = 0;
      step(s, 1 / 60);
    }
    expect(s.visit?.kind).toBe(HERMIT);
    expect(s.visit!.home).toBe(false);
  });

  it("they leave when the light comes on", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(12));
    visit(s, MANTA);
    run(s, 2);
    toggleLamp(s); // day
    run(s, 3);
    expect(s.visit).toBe(null);
  });
});

describe("v14: the visitor log", () => {
  it("counts every arrival, notes the first, says so, and saves it as an optional field", () => {
    const s = createState(tank([jelly(0, 3)], { lastSeen: at(12) }), seeded(13));
    expect(toSave(s, 0).visitorsSeen).toBeUndefined(); // absent until the first sighting
    s.nextVisit = 0;
    const first = run(s, 1).find((e) => e.type === "visitorArrived")!;
    expect(first.first).toBe(true);
    const kind = first.kind!;
    expect(s.visitorsSeen[kind]).toEqual({ n: 1, first: expect.any(Number) });
    const saved = toSave(s, at(12, 5));
    expect(saved.visitorsSeen?.[kind]?.n).toBe(1);
    const back = createState(loadGame(JSON.stringify(saved), at(12, 6)).save, seeded(1));
    expect(back.visitorsSeen[kind]?.n).toBe(1);
    const rows = visitorLog(back);
    expect(rows.map((r) => r.kind)).toEqual([...VISITORS]);
    expect(rows.find((r) => r.kind === kind)!.n).toBe(1);
    expect(rows.filter((r) => r.n === 0).every((r) => r.first === null)).toBe(true);
    expect(rows.filter((r) => r.night).map((r) => r.kind)).toEqual(["octopus", "manta", "hermit"]);
    // the a11y line
    expect(eventWords({ type: "visitorArrived", kind: "octopus", first: true }, () => null)?.text).toBe("An octopus is peeking over a rock. New in your visitor log.");
    expect(eventWords({ type: "visitorArrived", kind: "manta" }, () => null)?.text).toBe("A manta ray is gliding past overhead.");
    expect(eventWords({ type: "visitorTapped", kind: "hermit", amount: 6 }, () => null)?.text).toBe("You greeted the hermit crab: +6 sand dollars.");
  });

  it("old saves start empty; bad entries are dropped", () => {
    const s = createState(loadGame(JSON.stringify(tank([jelly(0, 3)])), NIGHT).save, seeded(1));
    expect(s.visitorsSeen).toEqual({});
    expect(visitorsSeenOf({ turtle: { n: 2, first: 5 }, octopus: { n: 0, first: 5 }, manta: "x", ghost: { n: 1, first: 1 }, hermit: { n: 1.7, first: 9 } }))
      .toEqual({ turtle: { n: 2, first: 5 }, hermit: { n: 1, first: 9 } });
    expect(visitorsSeenOf([1, 2])).toEqual({});
    const log = {};
    expect(noteSighting(log, "manta", 100)).toBe(true);
    expect(noteSighting(log, "manta", 200)).toBe(false);
    expect(visitLogRows(log).find((r) => r.kind === "manta")).toMatchObject({ n: 2, first: 100, name: "manta ray" });
  });
});

describe("v14: Spot a night visitor", () => {
  it("is only planned at night, and a night visitor's arrival finishes it", () => {
    const base = { species: [0 as Species], foods: [true, false, false], decor: owned(), pearl: false };
    let offered = 0;
    for (let d = 1; d <= 28; d++) {
      const day = `2026-10-${String(d).padStart(2, "0")}`;
      expect(planRequests(day, base).items.some((r) => r.kind === "night")).toBe(false);
      if (planRequests(day, { ...base, night: true }).items.some((r) => r.kind === "night")) offered++;
    }
    expect(offered).toBeGreaterThan(0);
    const r = { kind: "night" as const, target: -1, n: 1, progress: 0, done: false };
    expect(requestText(r)).toBe("Spot a night visitor");
    expect(rewardOf(r)).toBe(12);

    const s = createState(tank([jelly(0, 3)]), seeded(14), { requests: true });
    run(s, 0.1);
    s.requests!.items = [{ ...r }];
    s.nextVisit = Infinity;
    // a night visitor comes into view
    s.lastVisitor = -1;
    const v = planVisit(MANTA, stretch(s), 0, seeded(2));
    expect(v).not.toBe(null);
    let ev: SimEvent[] = [];
    // drive the scheduler until a night visitor arrives (force the night pick)
    for (let tries = 0; tries < 200 && !ev.some((e) => e.type === "visitorArrived" && nightVisitor(VISITORS.indexOf(e.kind!))); tries++) {
      s.visit = null;
      s.nextVisit = 0;
      ev = run(s, 0.05);
    }
    expect(ev.some((e) => e.type === "requestDone")).toBe(true);
    expect(s.requests!.items[0]!.done).toBe(true);
  });
});
