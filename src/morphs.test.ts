import { describe, expect, it } from "vitest";
import { BABY_SECONDS, MORPH_CHANCE, MORPH_INHERIT, SEASON_MORPH_CHANCE } from "./species";
import { decodeTank } from "./tankcode";
import { traitFromName } from "./traits";
import {
  DECOR,
  K,
  MORPH_CLASSIC,
  MORPH_GHOST,
  MORPH_NONE,
  buy,
  createState,
  exportTank,
  importTank,
  journal,
  journalFrom,
  loadGame,
  loadSave,
  morphOf,
  morphSeen,
  setMurk,
  specProps,
  step,
  toSave,
  view,
  type Save,
  type SaveJelly,
  type SimEvent,
  type SimOptions,
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
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 0.7, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 1, ...extra,
});
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 12, foods: [true, false, false], themes: [true, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null, owned: [false, false, false, false, false], helpers: [false, false, false],
  // local noon, so day or night doesn't depend on the machine's time zone (CI runs in UTC)
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: new Date(2026, 9, 1, 12).getTime(), tier: 0, cam: 0, journal: journalFrom(slots, 0), ...extra,
});

/** A happy adult of `morph` about to release a baby: the baby's morph (one birth). */
function birth(morph: number, rand: () => number, opts: SimOptions = {}): number {
  const s = createState(tank([jelly(0, 3, { morph, fullness: 1, affection: 1, content: BABY_SECONDS - 0.01 })]), rand, opts);
  const ev = run(s, 0.05);
  expect(ev.filter((e) => e.type === "baby").length).toBe(1);
  return s.slots[1]!.morph;
}
/** How often each morph id comes out of N births. */
function odds(morph: number, opts: SimOptions = {}, N = 3000, seed = 7): [number, number, number] {
  const rand = seeded(seed);
  const n = [0, 0, 0];
  for (let i = 0; i < N; i++) n[birth(morph, rand, opts)]!++;
  return [n[0]! / N, n[1]! / N, n[2]! / N];
}

describe("v12: babies inherit colour morphs", () => {
  it("a plain parent: the base 1 in 10 classic, never a ghost without a season", () => {
    const [none, classic, ghost] = odds(MORPH_NONE);
    expect(classic).toBeGreaterThan(MORPH_CHANCE - 0.02);
    expect(classic).toBeLessThan(MORPH_CHANCE + 0.02);
    expect(ghost).toBe(0);
    expect(none).toBeCloseTo(1 - classic, 10);
  });

  it("a classic parent passes it on about half the time (plus the base roll on the rest)", () => {
    const [, classic, ghost] = odds(MORPH_CLASSIC);
    const want = MORPH_INHERIT + (1 - MORPH_INHERIT) * MORPH_CHANCE; // 0.55
    expect(classic).toBeGreaterThan(want - 0.03);
    expect(classic).toBeLessThan(want + 0.03);
    expect(ghost).toBe(0);
  });

  it("a ghost parent passes on the ghost about half the time, with or without the season", () => {
    for (const opts of [{}, { seasonalMorph: () => MORPH_GHOST }]) {
      const [, classic, ghost] = odds(MORPH_GHOST, opts);
      expect(ghost).toBeGreaterThan(MORPH_INHERIT - 0.03);
      expect(ghost).toBeLessThan(MORPH_INHERIT + 0.06); // the season can add a few more
      expect(classic).toBeGreaterThan(0.02);
      expect(classic).toBeLessThan(0.08);
    }
  });

  it("a season makes ghost babies possible, a small chance, only while it's on", () => {
    const seen: number[] = [];
    const [, classic, ghost] = odds(MORPH_NONE, { seasonalMorph: (now) => (seen.push(now), MORPH_GHOST) });
    const want = (1 - MORPH_CHANCE) * SEASON_MORPH_CHANCE; // 0.072
    expect(ghost).toBeGreaterThan(want - 0.02);
    expect(ghost).toBeLessThan(want + 0.02);
    expect(classic).toBeGreaterThan(MORPH_CHANCE - 0.02);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((t) => Number.isFinite(t))).toBe(true);
    // no season (null), or a nonsense id: plain
    expect(odds(MORPH_NONE, { seasonalMorph: () => null }, 1000)[2]).toBe(0);
    expect(odds(MORPH_NONE, { seasonalMorph: () => 7 }, 1000)[2]).toBe(0);
  });

  it("is deterministic under the sim's RNG", () => {
    const a = Array.from({ length: 40 }, ((r) => () => birth(MORPH_CLASSIC, r, { seasonalMorph: () => MORPH_GHOST }))(seeded(99)));
    const b = Array.from({ length: 40 }, ((r) => () => birth(MORPH_CLASSIC, r, { seasonalMorph: () => MORPH_GHOST }))(seeded(99)));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it("bought polyps keep the plain 1 in 10 and never roll the season", () => {
    const rand = seeded(5);
    let classic = 0;
    for (let i = 0; i < 2000; i++) {
      const s = createState(tank([jelly(0, 3)], { dollars: 100 }), rand, { seasonalMorph: () => MORPH_GHOST });
      expect(buy(s, 0)).toBe("bought");
      expect(s.slots[1]!.morph).not.toBe(MORPH_GHOST);
      if (s.slots[1]!.morph === MORPH_CLASSIC) classic++;
    }
    expect(classic / 2000).toBeGreaterThan(0.08);
    expect(classic / 2000).toBeLessThan(0.12);
  });

  it("the journal notes which morphs were raised, per species", () => {
    const s = createState(tank([jelly(0, 3, { morph: MORPH_GHOST, fullness: 1, affection: 1 }), jelly(1, 3)]), seeded());
    let jn = journal(s);
    expect(morphSeen(jn[0]!, MORPH_GHOST)).toBe(true);
    expect(morphSeen(jn[0]!, MORPH_CLASSIC)).toBe(false);
    expect(jn[1]!.morphSeen).toBe(0);
    // the moon releases a baby that rolls the classic colour (a low draw: inherits the ghost, so make it plain first)
    s.rand = () => 0.01;
    s.slots[0]!.morph = MORPH_NONE;
    s.slots[0]!.content = BABY_SECONDS - 0.01;
    run(s, 0.05);
    jn = journal(s);
    expect(morphSeen(jn[0]!, MORPH_CLASSIC) && morphSeen(jn[0]!, MORPH_GHOST)).toBe(true);
    expect(jn[0]!.morphSeen).toBe(3);
  });
});

describe("v12: morph ids in saves (v7..v9 wrote booleans)", () => {
  it("morphOf: true is classic, 1, 2 and 3 (winter's frost) stay, anything else is none", () => {
    expect([true, false, 0, 1, 2, 3, 4, -1, 1.5, "2", null, undefined].map(morphOf)).toEqual([1, 0, 0, 1, 2, 3, 0, 0, 0, 0, 0, 0]);
  });

  it("loadSave migrates a v9 save's boolean morphs and journal to v10", () => {
    const raw = {
      ...tank([jelly(0, 3), jelly(1, 0, { anchor: 1 }), jelly(5, 2)]),
      v: 9,
      journal: tank([]).journal.map((e, k) => ({ ...e, morphSeen: k === 2 })),
    } as unknown as Record<string, unknown>;
    const slots = raw.slots as Record<string, unknown>[];
    slots[0]!.morph = true;
    slots[1]!.morph = false;
    slots[2]!.morph = 2;
    const save = loadSave(JSON.stringify(raw), 0);
    expect(save.v).toBe(12);
    expect(save.slots.slice(0, 3).map((j) => j!.morph)).toEqual([1, 0, 2]);
    // journal: the old true became the classic bit; what's in the tank is noted too
    expect(save.journal[2]!.morphSeen).toBe(1);
    expect(save.journal[0]!.morphSeen).toBe(1);
    expect(save.journal[5]!.morphSeen).toBe(2);
    expect(save.journal[1]!.morphSeen).toBe(0);
    // and a new save writes ids, which load back the same
    const back = loadSave(JSON.stringify(toSave(createState(save, seeded()), 0)), 0);
    expect(back.slots.slice(0, 3).map((j) => j!.morph)).toEqual([1, 0, 2]);
    expect(back.journal).toEqual(save.journal);
  });

  it("every save version from v2 to v12 loads (v6 never existed: it changed no save fields)", () => {
    const base = tank([jelly(0, 3, { morph: 2 })]);
    for (const v of [2, 3, 4, 5, 7, 8, 9, 10, 11, 12]) {
      const { save } = loadGame(JSON.stringify({ ...base, v }), 0);
      expect(save.v).toBe(12);
      expect([save.slots[0]!.g, save.slots[0]!.morph], `v${v}`).toEqual([3, 2]);
    }
    // a newer game's save isn't guessed at: a fresh tank (one plain moon polyp)
    for (const v of [6, 13]) {
      const { save } = loadGame(JSON.stringify({ ...base, v }), 0);
      expect([save.slots[0]!.g, save.slots[0]!.morph], `v${v}`).toEqual([0, 0]);
    }
  });

  it("a damaged morphSeen keeps only known bits", () => {
    const raw = { ...tank([]), journal: tank([]).journal.map((e, k) => ({ ...e, morphSeen: [15, -1, "3", 2.5][k] ?? 0 })) };
    const save = loadSave(JSON.stringify(raw), 0);
    expect(save.journal.slice(0, 4).map((e) => e.morphSeen)).toEqual([7, 0, 0, 0]); // bits for morphs 1-3
  });
});

describe("v12: the view writes one switch per morph", () => {
  it("ghost = 1 only for a ghost, morph = 1 only for a classic; pale overrides both", () => {
    const happy = { fullness: 1, affection: 1 };
    const s = createState(tank([jelly(1, 3, { ...happy, morph: MORPH_GHOST }), jelly(1, 3, { ...happy, morph: MORPH_CLASSIC }), jelly(1, 3, happy)]), seeded());
    let v = view(s);
    expect([v.j0ghost, v.j0morph, v.j0healthy, v.j0pale]).toEqual([1, 0, 0, 0]);
    expect([v.j1ghost, v.j1morph, v.j1healthy, v.j1pale]).toEqual([0, 1, 0, 0]);
    expect([v.j2ghost, v.j2morph, v.j2healthy, v.j2pale]).toEqual([0, 0, 1, 0]);
    expect(v.j3ghost).toBe(0);
    expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
    if (K.props.includes("j0ghost")) expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
    s.slots[0]!.fullness = 0;
    s.slots[0]!.affection = 0;
    setMurk(s, 1);
    v = view(s);
    expect([v.j0ghost, v.j0morph, v.j0healthy, v.j0pale]).toEqual([0, 0, 0, 1]);
  });
});

/** v13: a jelly with the trait its name gives, so a code needs no version 5 for it */
const named = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}) => jelly(k, g, { ...extra, trait: traitFromName(extra.name ?? "Mochi", k) });

describe("v12: share codes carry ghosts", () => {
  it("a tank with a ghost round-trips (version 3, or 4 themed); tanks without one keep their old codes", () => {
    const plain = createState(tank([named(0, 3, { name: "Taffy", morph: MORPH_CLASSIC }), named(2, 3, { name: "Boba", spot: 1 })]), seeded());
    const code = exportTank(plain);
    expect(decodeTank(code)!.jellies.map((j) => j.morph)).toEqual([1, 0]);
    // the first 4 bits are the version
    const version = (c: string) => Buffer.from(c, "base64url")[0]! >> 4;
    expect(version(code)).toBe(1);
    for (const theme of [0, 2]) {
      const s = createState(
        tank([named(0, 3, { name: "Taffy", morph: MORPH_CLASSIC }), named(2, 3, { name: "Boba", spot: 1, morph: MORPH_GHOST }), named(1, 0, { name: "Pip", anchor: 1 })], {
          theme,
          themes: [true, true, true, true],
        }),
        seeded(),
      );
      const c = exportTank(s);
      expect(version(c)).toBe(theme ? 4 : 3);
      const back = createState(importTank(c, 0)!, seeded());
      expect(back.slots.slice(0, 3).map((j) => j!.morph)).toEqual([1, 2, 0]);
      expect(back.theme).toBe(theme);
      expect(exportTank(back)).toBe(c);
    }
  });
});
