import { describe, expect, it } from "vitest";
import {
  FIND_CHANCE,
  FIND_ITEMS,
  FIND_N,
  FIND_SETS,
  GLASS,
  SHELLS,
  addFind,
  completeSets,
  dayFactor,
  findChance,
  findWeights,
  findsOf,
  newFinds,
  pickFind,
  setOfDecor,
  setOfItem,
  setProgress,
  type FindSave,
  type FindSource,
} from "./finds";
import { rng } from "./dirt";
import { DECOR_N, SG_CHIME, SG_GROTTO, SHOP_ITEMS, collectionOf } from "./species";

const DAY = "2026-10-03";
/** the nth day after DAY, as a day key */
const dayN = (n: number) => new Date(Date.UTC(2026, 9, 3 + n)).toISOString().slice(0, 10);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** Finds until both sets are complete, with a seeded stream. */
function findsToComplete(seed: number): number {
  const r = rng(seed);
  const f = newFinds();
  let n = 0;
  while (completeSets(f) !== 3 && n < 500) {
    addFind(f, pickFind(f, r()), DAY);
    n++;
  }
  return n;
}

/** A casual player's days: so many of each event a day, each a roll. Returns finds a day and days to both sets. */
function play(seed: number, perDay: Partial<Record<FindSource, number>>, days = 60) {
  const r = rng(seed);
  const f = newFinds();
  const perDayFinds: number[] = [];
  let done = -1;
  for (let d = 0; d < days; d++) {
    const day = dayN(d);
    let today = 0;
    for (const [src, n] of Object.entries(perDay) as [FindSource, number][]) {
      for (let i = 0; i < n; i++) {
        if (r() < findChance(src, f, day)) {
          addFind(f, pickFind(f, r()), day);
          today++;
        }
      }
    }
    perDayFinds.push(today);
    if (done < 0 && completeSets(f) === 3) done = d + 1;
  }
  return { mean: perDayFinds.reduce((a, b) => a + b, 0) / days, done };
}

describe("v16 finds: the table", () => {
  it("ten kinds: five colours of sea glass (cobalt rare, red very rare), five shells (the nautilus rare)", () => {
    expect(FIND_N).toBe(10);
    expect(FIND_ITEMS.filter((it) => it.set === GLASS).map((it) => it.key)).toEqual(["green", "brown", "white", "cobalt", "red"]);
    expect(FIND_ITEMS.filter((it) => it.set === SHELLS).map((it) => it.key)).toEqual(["cowrie", "scallop", "conch", "fossil", "nautilus"]);
    for (const set of [GLASS, SHELLS]) expect(FIND_ITEMS.filter((it) => it.set === set).reduce((a, it) => a + it.weight, 0)).toBe(100);
    expect(FIND_ITEMS.find((it) => it.key === "red")!.rare).toBe(2);
    expect(FIND_ITEMS.find((it) => it.key === "cobalt")!.rare).toBe(1);
    expect(FIND_ITEMS.find((it) => it.key === "nautilus")!.rare).toBe(1);
    // rarer pays more as a duplicate
    expect(FIND_ITEMS.find((it) => it.key === "red")!.dup).toBeGreaterThan(FIND_ITEMS.find((it) => it.key === "green")!.dup);
  });

  it("the sets leave decorations 11 and 12 (shop items 36 and 37), which the shop never sells", () => {
    expect(FIND_SETS.map((s) => [s.decor, s.item])).toEqual([[SG_CHIME, 36], [SG_GROTTO, 37]]);
    expect(DECOR_N).toBe(13);
    for (const s of FIND_SETS) {
      const it = SHOP_ITEMS[s.item]!;
      expect(it.kind === "decor" && it.d).toBe(s.decor);
      expect(collectionOf(it)).toBe(FIND_SETS.indexOf(s));
      expect(setOfItem(s.item)).toBe(FIND_SETS.indexOf(s));
      expect(setOfDecor(s.decor)).toBe(FIND_SETS.indexOf(s));
    }
    // 31..35 are the lamp gels and the heater/chiller: real items, sold
    for (let i = 31; i <= 35; i++) expect(["gel", "climate"]).toContain(SHOP_ITEMS[i]!.kind);
  });

  it("chances per source, slowing after the day's first few finds", () => {
    expect(findChance("scrub", null, DAY)).toBe(FIND_CHANCE.scrub);
    const f = newFinds();
    addFind(f, 0, DAY);
    addFind(f, 0, DAY);
    expect(findChance("scrub", f, DAY)).toBeCloseTo(FIND_CHANCE.scrub * 0.4);
    expect(findChance("scrub", f, dayN(1))).toBe(FIND_CHANCE.scrub); // a new day
    addFind(f, 0, DAY);
    addFind(f, 0, DAY);
    expect(findChance("dig", f, DAY)).toBeCloseTo(FIND_CHANCE.dig * 0.1);
    expect([0, 1, 2, 3, 4, 9].map(dayFactor)).toEqual([1, 1, 0.4, 0.4, 0.1, 0.1]);
  });

  it("a kind not found yet is likelier the longer it's been since the last new one", () => {
    const f = newFinds();
    f.n[0] = 3;
    const w0 = findWeights(f);
    f.dry = 5;
    const w5 = findWeights(f);
    expect(w5[4]! / w5[0]!).toBeGreaterThan(w0[4]! / w0[0]!);
    expect(w5[0]).toBe(w0[0]); // a found one weighs the same
  });

  it("the sea-glass request tips finds towards glass", () => {
    const r = rng(9);
    const share = (wanted: boolean) => {
      let glass = 0;
      for (let i = 0; i < 4000; i++) if (FIND_ITEMS[pickFind(null, r(), wanted)]!.set === GLASS) glass++;
      return glass / 4000;
    };
    expect(share(false)).toBeGreaterThan(0.5);
    expect(share(false)).toBeLessThan(0.6);
    expect(share(true)).toBeGreaterThan(0.8);
  });
});

describe("v16 finds: rates", () => {
  it("both sets fill in about 14-26 finds (median under 22)", () => {
    const ns = Array.from({ length: 400 }, (_, i) => findsToComplete(1000 + i));
    expect(median(ns)).toBeGreaterThanOrEqual(15);
    expect(median(ns)).toBeLessThanOrEqual(22);
    expect(Math.max(...ns)).toBeLessThan(60);
  });

  it("a casual day (ten spots, a little sifting) turns up one or two; both sets take a week or two", () => {
    const runs = Array.from({ length: 120 }, (_, i) => play(500 + i, { scrub: 10, sift: 1 }));
    const mean = runs.reduce((a, r) => a + r.mean, 0) / runs.length;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(2);
    const days = median(runs.map((r) => r.done));
    expect(days).toBeGreaterThanOrEqual(7);
    expect(days).toBeLessThanOrEqual(21);
  });

  it("the crab and the bubbler help; a long session can't strip the beach in a day", () => {
    const helped = Array.from({ length: 120 }, (_, i) => play(900 + i, { scrub: 10, sift: 2, dig: 4, ride: 3 }));
    expect(median(helped.map((r) => r.done))).toBeLessThan(median(Array.from({ length: 120 }, (_, i) => play(500 + i, { scrub: 10, sift: 1 }).done)));
    const grind = Array.from({ length: 60 }, (_, i) => play(1300 + i, { scrub: 40, sift: 30, dig: 12, ride: 15 }, 20));
    expect(grind.reduce((a, r) => a + r.mean, 0) / grind.length).toBeLessThan(5);
    expect(median(grind.map((r) => r.done))).toBeGreaterThanOrEqual(3);
  });
});

describe("v16 finds: keeping them", () => {
  it("a first is just kept; a duplicate counts and pays its few sand dollars", () => {
    const f = newFinds();
    expect(addFind(f, 5, DAY)).toEqual({ first: true, pay: 0, sets: [] });
    expect(addFind(f, 5, DAY)).toEqual({ first: false, pay: FIND_ITEMS[5]!.dup, sets: [] });
    expect(f.n[5]).toBe(2);
    expect(f.today).toBe(2);
    expect(f.dry).toBe(1);
    addFind(f, 6, DAY);
    expect(f.dry).toBe(0);
  });

  it("completing a set reports it once, ever", () => {
    const f = newFinds();
    const sets: number[] = [];
    for (const i of [0, 1, 2, 3]) sets.push(...addFind(f, i, DAY).sets);
    expect(sets).toEqual([]);
    expect(setProgress(f, GLASS)).toBe(4);
    expect(addFind(f, 4, DAY).sets).toEqual([GLASS]);
    expect(addFind(f, 4, DAY).sets).toEqual([]); // the red again: a duplicate, not a second completion
    for (const i of [5, 6, 7, 8]) addFind(f, i, DAY);
    expect(addFind(f, 9, DAY).sets).toEqual([SHELLS]);
    expect(f.sets).toBe(3);
    for (let i = 0; i < 10; i++) expect(addFind(f, i, DAY).sets).toEqual([]);
  });

  it("a saved `finds` is repaired: counts clamped, a set only done if its kinds are all there", () => {
    expect(findsOf(undefined)).toBeNull();
    expect(findsOf("junk")).toBeNull();
    const f = findsOf({ n: [1, -3, "x", 2.7, 1e9], sets: 3, day: "nope", today: 4, dry: 2 })!;
    expect(f.n).toEqual([1, 0, 0, 2, 9999, 0, 0, 0, 0, 0]);
    expect(f.sets).toBe(0); // brown and white were never found
    expect(f.day).toBe("");
    const full: FindSave = { n: [1, 1, 1, 1, 1, 0, 1, 1, 1, 1], sets: 3, day: DAY, today: 1, dry: 0 };
    expect(findsOf(full)!.sets).toBe(1);
    expect(findsOf(JSON.parse(JSON.stringify(full)))).toEqual({ ...full, sets: 1 });
  });
});
