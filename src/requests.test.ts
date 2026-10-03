import { describe, expect, it } from "vitest";
import { FEED_ANY_N, FEED_FAV_N, PET_N, SPRINKLE_N, advance, planRequests, requestText, requestsOf, rewardOf, type DailyRequests, type RequestTank } from "./requests";
import { favouriteFood, type FoodKind } from "./species";
import {
  DECOR,
  createState,
  dayKey,
  journalFrom,
  loadGame,
  pearlCentre,
  requests,
  scrubAt,
  setTool,
  sprinkle,
  step,
  tap,
  toSave,
  visitorInfo,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const run = (s: State, seconds: number) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * 60; i++) events.push(...step(s, 1 / 60));
  return events;
};
const at = (h: number, m = 0, day = 1, s = 0) => new Date(2026, 9, day, h, m, s).getTime();
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 0.7, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 1, ...extra,
});
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 11, foods: [true, false, false], themes: [true, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null, owned: [false, false, false, false, false], helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: at(10), tier: 0, cam: 0, journal: journalFrom(slots, 0), ...extra,
});
const on = { requests: true } as const;
const done = (ev: SimEvent[]) => ev.filter((e) => e.type === "requestDone");
/** today's requests replaced by these (for driving one kind at a time) */
function set(s: State, items: DailyRequests["items"]): void {
  requests(s); // plans today (so the day key matches the clock)
  s.requests!.items = items;
}
const item = (kind: DailyRequests["items"][number]["kind"], n: number, target = -1, food?: FoodKind) =>
  food === undefined ? { kind, target, n, progress: 0, done: false } : { kind, target, food, n, progress: 0, done: false };

// ---------------------------------------------------------------- planning (pure)

const SPECIES_ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8] as Species[];
function randomTank(r: () => number): RequestTank {
  const n = Math.floor(r() * 5);
  return {
    species: Array.from({ length: n }, () => SPECIES_ALL[Math.floor(r() * 9)]!),
    foods: [true, r() < 0.5, r() < 0.5],
    decor: Array.from({ length: 5 }, () => r() < 0.3),
    pearl: r() < 0.4,
  };
}

describe("v12 daily requests: planning", () => {
  it("one or two a day, different kinds, each one this tank can finish, paying 5-15", () => {
    const r = seeded(3);
    for (let d = 0; d < 600; d++) {
      const t = randomTank(r);
      const day = dayKey(at(9, 0, 1) + d * 86_400_000);
      const plan = planRequests(day, t);
      expect(plan.day).toBe(day);
      expect(plan.items.length).toBeGreaterThanOrEqual(1);
      expect(plan.items.length).toBeLessThanOrEqual(2);
      expect(new Set(plan.items.map((q) => q.kind)).size).toBe(plan.items.length);
      for (const q of plan.items) {
        expect(q).toMatchObject({ progress: 0, done: false });
        expect(rewardOf(q)).toBeGreaterThanOrEqual(5);
        expect(rewardOf(q)).toBeLessThanOrEqual(15);
        expect(requestText(q).length).toBeGreaterThan(8);
        if (q.kind === "feed") {
          expect(t.species.length).toBeGreaterThan(0);
          expect(t.foods[q.food!]).toBe(true);
          // a named species is in the tank and it's that species' favourite
          if (q.target >= 0) {
            expect(t.species).toContain(q.target);
            expect(q.food).toBe(favouriteFood(q.target as Species));
            expect(q.n).toBe(FEED_FAV_N);
          } else expect(q.n).toBe(FEED_ANY_N);
        }
        if (q.kind === "pet") expect(t.species.length).toBeGreaterThan(0);
        if (q.kind === "pearl") expect(t.pearl).toBe(true);
        if (q.kind === "sprinkle") expect(t.decor[q.target]).toBe(true);
        if (q.kind === "scrub") expect([2, 3]).toContain(q.n);
      }
    }
  });

  it("the same day plans the same requests; days differ", () => {
    const t: RequestTank = { species: [0, 5], foods: [true, true, true], decor: [true, true, false, true, false], pearl: true };
    expect(planRequests("2026-10-02", t)).toEqual(planRequests("2026-10-02", t));
    const plans = new Set(Array.from({ length: 30 }, (_, d) => JSON.stringify(planRequests(dayKey(at(9, 0, 1 + d)), t).items)));
    expect(plans.size).toBeGreaterThan(5);
  });

  it("'feed plankton to a sea nettle' never happens: favourites only for jellies in the tank, with the food owned", () => {
    // a sea nettle's favourite is brine shrimp: with only plankton bought it can't be asked for
    const nettle: RequestTank = { species: [5], foods: [true, false, true], decor: [false, false, false, false, false], pearl: false };
    for (let d = 0; d < 200; d++) {
      for (const q of planRequests(dayKey(at(9, 0, 1) + d * 86_400_000), nettle).items) {
        if (q.kind === "feed") expect(q.target).toBe(-1);
      }
    }
    const texts = new Set<string>();
    const both: RequestTank = { ...nettle, foods: [true, true, true] };
    for (let d = 0; d < 300; d++) for (const q of planRequests(dayKey(at(9, 0, 1) + d * 86_400_000), both).items) texts.add(requestText(q));
    expect(texts).toContain("Feed brine shrimp to a sea nettle");
    expect([...texts].some((t) => /plankton to/.test(t))).toBe(false);
  });

  it("an empty tank still gets a request (scrub, a visitor)", () => {
    const plan = planRequests("2026-10-02", { species: [], foods: [true, false, false], decor: [false, false, false, false, false], pearl: false });
    expect(plan.items.length).toBeGreaterThan(0);
    for (const q of plan.items) expect(["scrub", "visitor"]).toContain(q.kind);
  });

  it("advance counts only matching deeds, caps at n and finishes each request once", () => {
    const day: DailyRequests = { day: "2026-10-02", items: [item("feed", 3, 5, 1), item("sprinkle", 8, 2)] };
    expect(advance(day, { kind: "ate", k: 5, food: 0 })).toEqual([]);
    expect(advance(day, { kind: "ate", k: 0, food: 1 })).toEqual([]);
    expect(advance(day, { kind: "ate", k: 5, food: 1 })).toEqual([]);
    expect(advance(day, { kind: "ate", k: 5, food: 1 })).toEqual([]);
    expect(advance(day, { kind: "ate", k: 5, food: 1 })).toEqual([0]);
    expect(advance(day, { kind: "ate", k: 5, food: 1 })).toEqual([]);
    expect(day.items[0]).toMatchObject({ progress: 3, done: true });
    expect(advance(day, { kind: "sprinkle", decor: 1, n: 5 })).toEqual([]);
    expect(advance(day, { kind: "sprinkle", decor: 2, n: 5 })).toEqual([]);
    expect(advance(day, { kind: "sprinkle", decor: 2, n: 5 })).toEqual([1]);
    expect(day.items[1]).toMatchObject({ progress: 8, done: true });
  });

  it("requestsOf repairs a saved day: bad days and items go, progress is capped", () => {
    expect(requestsOf(null)).toBe(null);
    expect(requestsOf({ day: "yesterday", items: [] })).toBe(null);
    expect(requestsOf({ day: "2026-10-02" })).toBe(null);
    const r = requestsOf({
      day: "2026-10-02",
      items: [{ kind: "pet", n: 5, progress: 99, done: false }, { kind: "bake", n: 1 }, { kind: "feed", target: 12, food: 0, n: 3 }],
    });
    expect(r).toEqual({ day: "2026-10-02", items: [{ kind: "pet", target: -1, n: 5, progress: 5, done: true }] });
    expect(requestsOf({ day: "2026-10-02", items: [{ kind: "sprinkle", target: 3, n: 8, progress: 2, done: false }] })!.items[0]).toEqual({ ...item("sprinkle", 8, 3), progress: 2 });
  });
});

// ---------------------------------------------------------------- in the sim

describe("v12 daily requests: in the sim", () => {
  it("off unless asked for (demo, visits, tests): nothing planned, nothing paid, the loaded field kept", () => {
    const saved = { day: dayKey(at(10)), items: [item("pet", 1)] };
    const s = createState(tank([jelly(0, 3)], { requests: saved }), seeded());
    expect(requests(s)).toBe(null);
    tap(s, s.slots[0]!.x, s.slots[0]!.y - 20);
    expect(done(run(s, 1))).toEqual([]);
    expect(toSave(s, at(10)).requests).toEqual(saved);
    // and a save that never had them has no field
    expect("requests" in toSave(createState(tank([jelly(0, 3)]), seeded()), at(10))).toBe(false);
  });

  it("planned on the first step of the day, for the tank as it is", () => {
    const s = createState(tank([jelly(5, 3)], { foods: [true, true, false], owned: [false, false, false, true, false] }), seeded(), on);
    run(s, 0.1);
    const r = requests(s)!;
    expect(r.day).toBe(dayKey(at(10)));
    expect(r.items.length).toBe(2);
    for (const q of r.items) expect(q.text).toBe(requestText(q));
    expect(toSave(s, at(10)).requests!.items.length).toBe(2);
  });

  it("feeding: pellets of the asked-for food eaten by the asked-for jelly; pays once, through earn", () => {
    const s = createState(tank([jelly(5, 3, { fullness: 0.2 }), jelly(1, 3, { fullness: 0.2 })], { foods: [true, true, false], dollars: 0 }), seeded(), on);
    set(s, [item("feed", 3, 5, 1)]);
    const ev: SimEvent[] = [];
    for (let t = 0; t < 40 && !s.requests!.items[0]!.done; t++) {
      for (const j of s.slots) if (j) sprinkle(s, j.x, j.y + 20, 1);
      ev.push(...run(s, 0.5));
    }
    const d = done(ev);
    expect(d).toEqual([{ type: "requestDone", request: 0, amount: 10 }]);
    // the "earned" for it comes straight after, with no slot (the host floats it over the note)
    const i = ev.indexOf(d[0]!);
    expect(ev[i + 1]).toEqual({ type: "earned", amount: 10 });
    // only the nettle's brine shrimp counted
    const ate = ev.slice(0, i).filter((e) => e.type === "ate" && e.food === 1 && s.slots[e.slot!]?.k === 5).length;
    expect(ate).toBeGreaterThanOrEqual(3);
    // more meals don't pay again
    for (let t = 0; t < 6; t++) {
      for (const j of s.slots) if (j) sprinkle(s, j.x, j.y + 20, 1);
      expect(done(run(s, 0.5))).toEqual([]);
    }
  });

  it("scrubbing dirty spots, petting, the pearl and a visitor count; each pays its reward", () => {
    const s = createState(tank([jelly(0, 3)], { owned: [false, false, false, true, false], dollars: 0 }), seeded(), on);
    set(s, [item("scrub", 2), item("pet", PET_N)]);
    for (const [i, x] of [[0, 300], [1, 500]] as const) s.spots[i] = { x, y: 500, dirt: 1, v: 0, peak: 1 };
    setTool(s, "sponge");
    const ev: SimEvent[] = [];
    for (const x of [300, 500]) for (let k = 0; k < 200 && s.spots[x === 300 ? 0 : 1]; k++) (scrubAt(s, x + (k % 2 ? 20 : -20), 500, 10), ev.push(...step(s, 1 / 60)));
    ev.push(...run(s, 0.1));
    expect(done(ev)).toEqual([{ type: "requestDone", request: 0, amount: 8 }]);
    setTool(s, "none");
    for (let k = 0; k < PET_N; k++) {
      const j = s.slots[0]!;
      expect(tap(s, j.x, j.y - 20)).toBe("pet");
    }
    expect(done(run(s, 0.1))).toEqual([{ type: "requestDone", request: 1, amount: 5 }]);
    // the pearl
    set(s, [item("pearl", 1), item("visitor", 1)]);
    const p = pearlCentre(s);
    expect(tap(s, p.x, p.y)).toBe("pearl");
    expect(done(run(s, 0.1))).toEqual([{ type: "requestDone", request: 0, amount: 5 }]);
    // a visitor greeted: tap its middle once it's in view
    s.nextVisit = 0;
    run(s, 4);
    const v = visitorInfo(s)!;
    expect(v).toBeTruthy();
    expect(tap(s, v.x, v.y)).toBe("visitor");
    expect(done(run(s, 0.1))).toEqual([{ type: "requestDone", request: 1, amount: 10 }]);
  });

  it("sprinkling food by a decoration counts its pellets (and only near that one)", () => {
    const s = createState(tank([jelly(0, 3)], { owned: [true, false, false, false, false] }), seeded(), on);
    set(s, [item("sprinkle", SPRINKLE_N, 0)]);
    const castle = s.decorX[0]!;
    setTool(s, "food");
    for (let k = 0; k < 20; k++) {
      sprinkle(s, castle + 400, 400);
      run(s, 0.3);
    }
    expect(s.requests!.items[0]!.progress).toBe(0);
    for (const f of s.food) f.state = "off"; // room in the pellet pool again
    const ev: SimEvent[] = [];
    for (let k = 0; k < 20 && !s.requests!.items[0]!.done; k++) {
      sprinkle(s, castle + 30, 400);
      ev.push(...run(s, 0.3));
    }
    expect(done(ev)).toEqual([{ type: "requestDone", request: 0, amount: 6 }]);
  });

  it("rolls over at local midnight: new requests, the old ones' progress gone", () => {
    const s = createState(tank([jelly(0, 3)], { lastSeen: at(23, 59, 1, 50) }), seeded(), on);
    run(s, 1);
    expect(requests(s)!.day).toBe(dayKey(at(12, 0, 1)));
    s.requests!.items[0]!.progress = 1;
    run(s, 15);
    const r = requests(s)!;
    expect(r.day).toBe(dayKey(at(12, 0, 2)));
    expect(r.items.every((q) => q.progress === 0 && !q.done)).toBe(true);
  });

  it("days away don't stack, and a finished request isn't paid again after loading", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(), on);
    set(s, [item("pet", 1), item("scrub", 3)]);
    tap(s, s.slots[0]!.x, s.slots[0]!.y - 20);
    expect(done(run(s, 0.1)).length).toBe(1);
    const json = JSON.stringify(toSave(s, at(10, 5)));
    // the same day: the done one stays done, the other keeps its place
    const again = createState(loadGame(json, at(11)).save, seeded(), on);
    expect(requests(again)!.items.map((q) => [q.kind, q.done])).toEqual([["pet", true], ["scrub", false]]);
    tap(again, again.slots[0]!.x, again.slots[0]!.y - 20);
    expect(done(run(again, 0.1))).toEqual([]);
    // three days later: just that day's (one or two), nothing carried over
    const later = createState(loadGame(json, at(10, 0, 4)).save, seeded(), on);
    run(later, 0.1);
    const r = requests(later)!;
    expect(r.day).toBe(dayKey(at(10, 0, 4)));
    expect(r.items.length).toBeLessThanOrEqual(2);
    expect(r.items.every((q) => q.progress === 0 && !q.done)).toBe(true);
  });
});
