import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { describeJelly, eventWords } from "./a11y";
import { BABY_SECONDS, MORPH_CHANCE, MORPH_INHERIT, MORPH_KNOWN, SPECIES_NAMES } from "./species";
import { TRAIT_INHERIT } from "./traits";
import {
  PAIR_NEAR,
  PAIR_NEW_CHANCE,
  PAIR_SECONDS,
  PAIR_SPARK_EVERY,
  PAIR_SPARK_TIME,
  canPair,
  colourHow,
  newColourOf,
  pairBabyNote,
  pairMorph,
  pairOdds,
  pairTrait,
  recipeOf,
  stepBond,
} from "./pairs";
import { GROUPS, groupsFor, jellyGroups, morphGroup } from "./spritegroups";
import { decodeTank, encodeTank, needsV6, type TankCode } from "./tankcode";
import { traitFromName } from "./traits";
import {
  DECOR,
  K,
  MORPH_CLASSIC,
  MORPH_DUSK,
  MORPH_GHOST,
  MORPH_NONE,
  MORPH_PEARL,
  createState,
  exportTank,
  importTank,
  jellyInfo,
  journal,
  journalFrom,
  loadSave,
  mateSlot,
  morphOf,
  morphSeen,
  pairUp,
  pairs,
  rehome,
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
const NAMES = ["Mochi", "Pip", "Tofu", "Nori", "Suki", "Momo", "Bloop"];
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 1, affection: 1, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 1, ...extra,
});
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 12, foods: [true, false, false], themes: [true, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => (slots[i] ? { ...slots[i]!, name: slots[i]!.name === "Mochi" ? NAMES[i]! : slots[i]!.name } : null)),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null, owned: [false, false, false, false, false], helpers: [false, false, false],
  // local noon, so day or night doesn't depend on the machine's time zone
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: new Date(2026, 5, 1, 12).getTime(), tier: 0, cam: 0, journal: journalFrom(slots, 0), ...extra,
});
const ON: SimOptions = { pairs: true };
/** Step `seconds`, keeping slot b's body `gap` px beside slot a's (so they stay together), happy and fed. */
function together(s: State, a: number, b: number, seconds: number, gap = 60): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds * 30; i++) {
    const ja = s.slots[a];
    const jb = s.slots[b];
    for (const j of [ja, jb]) if (j) (j.fullness = 1), (j.affection = 1);
    if (ja && jb) {
      jb.x = ja.x + gap;
      jb.y = ja.y;
    }
    out.push(...step(s, 1 / 30));
  }
  return out;
}

describe("v16 pairs: the rules (pure)", () => {
  it("same species, both adults, neither paired", () => {
    const a = { k: 0, g: 3, pair: -1 };
    expect(canPair(a, { k: 0, g: 3, pair: -1 })).toBe(true);
    expect(canPair(a, { k: 1, g: 3, pair: -1 })).toBe(false); // never across species
    expect(canPair(a, { k: 0, g: 2, pair: -1 })).toBe(false); // a juvenile
    expect(canPair(a, { k: 0, g: 3, pair: 4 })).toBe(false); // already paired
  });
  it("a bond builds together, fades (slower) apart, never below zero", () => {
    expect(stepBond(10, true, 2)).toBe(12);
    expect(stepBond(10, true, 2, 20)).toBe(50); // growth-scaled
    expect(stepBond(10, false, 2)).toBe(9);
    expect(stepBond(0.2, false, 2)).toBe(0);
  });
  it("recipes: classic x classic makes dusk, classic x ghost makes pearl, either order; nothing else does", () => {
    expect(newColourOf(MORPH_CLASSIC, MORPH_CLASSIC)).toBe(MORPH_DUSK);
    expect(newColourOf(MORPH_CLASSIC, MORPH_GHOST)).toBe(MORPH_PEARL);
    expect(newColourOf(MORPH_GHOST, MORPH_CLASSIC)).toBe(MORPH_PEARL);
    for (const [a, b] of [[0, 0], [0, 1], [0, 2], [2, 2], [4, 4], [4, 5], [5, 1], [4, 1]] as const) expect(newColourOf(a, b), `${a}x${b}`).toBe(MORPH_NONE);
    expect(recipeOf(MORPH_DUSK)).toEqual([MORPH_CLASSIC, MORPH_CLASSIC]);
    expect(recipeOf(MORPH_CLASSIC)).toBeNull();
  });
  it("the odds add up, and keep the new colours rare", () => {
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2], [4, 0], [5, 5]] as const) {
      for (const season of [MORPH_NONE, MORPH_GHOST]) {
        const sum = [...pairOdds(a, b, season).values()].reduce((x, y) => x + y, 0);
        expect(sum, `${a}x${b}`).toBeCloseTo(1, 12);
      }
    }
    expect(pairOdds(1, 1).get(MORPH_DUSK)).toBeCloseTo(PAIR_NEW_CHANCE, 12);
    expect(pairOdds(1, 2).get(MORPH_PEARL)).toBeCloseTo(PAIR_NEW_CHANCE, 12);
    expect(PAIR_NEW_CHANCE).toBeLessThanOrEqual(0.1);
    expect(pairOdds(0, 0).get(MORPH_DUSK)).toBeUndefined();
    // a dusk parent passes dusk on (half the time it's the one picked, then MORPH_INHERIT)
    expect(pairOdds(4, 0).get(MORPH_DUSK)).toBeCloseTo(0.5 * MORPH_INHERIT, 12);
    expect(pairOdds(4, 4).get(MORPH_DUSK)).toBeCloseTo(MORPH_INHERIT, 12);
  });
  it("pairMorph follows pairOdds under a seeded RNG", () => {
    const r = seeded(11);
    for (const [a, b, season] of [[1, 1, 0], [1, 2, 0], [0, 0, 2], [1, 0, 0], [5, 2, 0]] as const) {
      const n = new Map<number, number>();
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const m = pairMorph(r, a, b, season);
        n.set(m, (n.get(m) ?? 0) + 1);
      }
      for (const [id, p] of pairOdds(a, b, season)) expect(Math.abs((n.get(id) ?? 0) / N - p), `${a}x${b} -> ${id}`).toBeLessThan(0.012);
      for (const id of n.keys()) expect(pairOdds(a, b, season).has(id), `${a}x${b} made ${id}`).toBe(true);
    }
  });
  it("never makes the reserved id 3, and only ids the build knows", () => {
    const r = seeded(3);
    for (let i = 0; i < 5000; i++) {
      const m = pairMorph(r, [0, 1, 2, 4, 5][i % 5]!, [0, 1, 2, 4, 5][(i * 7) % 5]!, i % 2 ? MORPH_GHOST : MORPH_NONE);
      expect(m).not.toBe(3);
      expect(MORPH_KNOWN).toContain(m);
    }
  });
  it("a pair's baby's trait is A's or B's TRAIT_INHERIT each, else uniform", () => {
    const r = seeded(5);
    const n = [0, 0, 0, 0];
    const N = 20000;
    for (let i = 0; i < N; i++) n[pairTrait(r, 0, 3)]!++;
    const rest = 1 - 2 * TRAIT_INHERIT;
    expect(n[0]! / N).toBeCloseTo(TRAIT_INHERIT + rest / 4, 1);
    expect(n[3]! / N).toBeCloseTo(TRAIT_INHERIT + rest / 4, 1);
    expect(n[1]! / N).toBeCloseTo(rest / 4, 1);
  });
  it("the words", () => {
    expect(pairBabyNote("Mochi", "Pip", MORPH_DUSK)).toBe("Mochi and Pip had a baby — a dusk-coloured one!");
    expect(pairBabyNote("Mochi", "Pip", MORPH_NONE)).toBe("Mochi and Pip had a baby!");
    expect(colourHow(MORPH_PEARL)).toBe("From a pair: rare × ghost");
    expect(colourHow(MORPH_DUSK)).toBe("From a pair: rare × rare");
  });
});

describe("v16 pairs: in the tank", () => {
  it("two content adults of a species that keep close pair after PAIR_SECONDS", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3)]), seeded(), ON);
    let ev = together(s, 0, 1, PAIR_SECONDS - 5);
    expect(pairs(s)).toEqual([]);
    ev = together(s, 0, 1, 10);
    expect(pairs(s)).toEqual([[0, 1]]);
    expect(ev.filter((e) => e.type === "paired")).toEqual([expect.objectContaining({ type: "paired", slot: 0, mate: 1 })]);
    expect(s.slots[0]!.pair).toBe(1);
    expect(s.slots[1]!.pair).toBe(0);
    expect(jellyInfo(s, 0)!.mate).toBe("Pip");
    expect(jellyInfo(s, 1)!.mate).toBe("Mochi");
  });
  it("not with pairs off (the default: the demo, visits), not across species, not when apart, not when glum", () => {
    const off = createState(tank([jelly(0, 3), jelly(0, 3)]), seeded());
    together(off, 0, 1, PAIR_SECONDS * 2);
    expect(pairs(off)).toEqual([]);
    const kinds = createState(tank([jelly(0, 3), jelly(1, 3)]), seeded(), ON);
    together(kinds, 0, 1, PAIR_SECONDS * 2);
    expect(pairs(kinds)).toEqual([]);
    const apart = createState(tank([jelly(0, 3), jelly(0, 3)]), seeded(), ON);
    together(apart, 0, 1, PAIR_SECONDS * 2, PAIR_NEAR + 80);
    expect(pairs(apart)).toEqual([]);
    const glum = createState(tank([jelly(0, 3), jelly(0, 3)]), seeded(), ON);
    for (let i = 0; i < PAIR_SECONDS * 2 * 30; i++) {
      glum.slots[0]!.fullness = 0.05;
      glum.slots[1]!.x = glum.slots[0]!.x + 60;
      glum.slots[1]!.y = glum.slots[0]!.y;
      step(glum, 1 / 30);
    }
    expect(pairs(glum)).toEqual([]);
    const young = createState(tank([jelly(0, 3), jelly(0, 2)]), seeded(), ON);
    together(young, 0, 1, PAIR_SECONDS * 2);
    expect(pairs(young)).toEqual([]);
  });
  it("one mate each: of three, two pair and the third waits", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3), jelly(0, 3)]), seeded(), ON);
    for (let i = 0; i < (PAIR_SECONDS + 10) * 30; i++) {
      for (const j of s.slots) if (j) (j.fullness = 1), (j.affection = 1);
      s.slots[1]!.x = s.slots[0]!.x + 50;
      s.slots[2]!.x = s.slots[0]!.x - 50;
      s.slots[1]!.y = s.slots[2]!.y = s.slots[0]!.y;
      step(s, 1 / 30);
    }
    expect(pairs(s).length).toBe(1);
    expect(s.slots.filter((j) => j && j.pair >= 0).length).toBe(2);
  });
  it("rehoming one ends the pair; the mate is free to pair again", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3), jelly(0, 3)]), seeded(), ON);
    expect(pairUp(s, 0, 1)).toBe(true);
    expect(pairUp(s, 0, 2)).toBe(false); // 0 is taken
    expect(rehome(s, 1)).not.toBeNull();
    expect(pairs(s)).toEqual([]);
    expect(s.slots[0]!.pair).toBe(-1);
    expect(jellyInfo(s, 0)!.mate).toBeNull();
    together(s, 0, 2, PAIR_SECONDS + 5);
    expect(pairs(s)).toEqual([[0, 2]]);
  });
  it("a pair's baby: both parents start a new wait, the event names the mate, and the journal notes its colour", () => {
    const s = createState(tank([jelly(0, 3, { morph: MORPH_CLASSIC }), jelly(0, 3, { morph: MORPH_CLASSIC, content: 300 })]), seeded(), ON);
    pairUp(s, 0, 1);
    s.slots[0]!.content = BABY_SECONDS - 0.01;
    s.rand = () => 0.01; // the recipe roll comes up: a dusk baby
    const ev = together(s, 0, 1, 0.1);
    const baby = ev.find((e) => e.type === "baby")!;
    expect(baby).toMatchObject({ parent: 0, mate: 1 });
    expect(s.slots[baby.slot!]!.morph).toBe(MORPH_DUSK);
    expect(s.slots[0]!.content).toBeLessThan(1);
    expect(s.slots[1]!.content).toBeLessThan(1);
    expect(morphSeen(journal(s)[0]!, MORPH_DUSK)).toBe(true);
    expect(journal(s)[0]!.morphSeen & 0b11000).toBe(0b01000); // bit 3 = id 4
  });
  it("babies still respect the tank's capacity: a full tank holds a pair's baby back", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3), jelly(0, 1)]), seeded(), ON); // the small tank holds 3
    pairUp(s, 0, 1);
    s.slots[0]!.content = BABY_SECONDS - 0.01;
    const ev = together(s, 0, 1, 2);
    expect(ev.filter((e) => e.type === "baby")).toEqual([]);
    expect(s.slots.filter(Boolean).length).toBe(3);
    expect(s.slots[0]!.content).toBe(BABY_SECONDS); // held at the threshold
  });
  it("seeded: a pair's babies come out the same every run", () => {
    const run = () => {
      const s = createState(tank([jelly(0, 3, { morph: MORPH_CLASSIC }), jelly(0, 3, { morph: MORPH_GHOST })], { tier: 2 }), seeded(42), { ...ON, growthMultiplier: 50 });
      pairUp(s, 0, 1);
      const out: number[] = [];
      for (let i = 0; i < 40 * 30 && out.length < 4; i++) {
        for (const e of together(s, 0, 1, 1 / 30)) if (e.type === "baby") out.push(s.slots[e.slot!]!.morph, s.slots[e.slot!]!.trait);
      }
      return out;
    };
    const a = run();
    expect(a.length).toBe(4);
    expect(run()).toEqual(a);
  });
  it("a paired swimmer drifts over beside its mate now and then", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3)], { tier: 2 }), seeded(9), ON);
    pairUp(s, 0, 1);
    let near = 0;
    let n = 0;
    for (let i = 0; i < 400 * 30; i++) {
      s.slots[1]!.x = 1200;
      s.slots[1]!.y = 500;
      const before = s.slots[0]!.target;
      step(s, 1 / 30);
      const t = s.slots[0]!.target;
      if (t && t !== before && s.slots[0]!.targetKind === "wander") {
        n++;
        if (Math.abs(t.x - 1200) < 100 && Math.abs(t.y - 500) < 40) near++;
      }
    }
    expect(n).toBeGreaterThan(15);
    expect(near / n).toBeGreaterThan(0.12);
    expect(near / n).toBeLessThan(0.6);
  });
  it("a pair close together shares a tiny sparkle now and then (pairX/Y, pairO, one twinkle frame)", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3)]), seeded(), ON);
    pairUp(s, 0, 1);
    let lit = 0;
    let frames = new Set<number>();
    for (let i = 0; i < (PAIR_SPARK_EVERY * 2 + 1) * 30; i++) {
      together(s, 0, 1, 1 / 30);
      const v = view(s);
      expect(v.pairF0! + v.pairF1! + v.pairF2!).toBe(1);
      if (v.pairO! > 0) {
        lit++;
        expect(Math.abs(v.pairX! - (s.slots[0]!.x + 30))).toBeLessThan(6);
        frames.add([v.pairF0, v.pairF1, v.pairF2].indexOf(1));
      }
    }
    expect(lit / 30).toBeGreaterThan(PAIR_SPARK_TIME * 1.5);
    expect(frames.size).toBe(3);
    // reduce motion: the sparkle still shows, held on its middle frame
    s.reducedMotion = true;
    frames = new Set();
    for (let i = 0; i < (PAIR_SPARK_EVERY + 1) * 30; i++) {
      together(s, 0, 1, 1 / 30);
      const v = view(s);
      if (v.pairO! > 0) frames.add([v.pairF0, v.pairF1, v.pairF2].indexOf(1));
    }
    expect([...frames]).toEqual([1]);
    // apart: no sparkle
    const far = createState(tank([jelly(0, 3), jelly(0, 3)]), seeded(), ON);
    pairUp(far, 0, 1);
    for (let i = 0; i < (PAIR_SPARK_EVERY + 2) * 30; i++) {
      together(far, 0, 1, 1 / 30, 400);
      expect(view(far).pairO).toBe(0);
    }
  });
});

describe("v16 pairs: saves", () => {
  it("a pair survives a save and a load; the field is absent for an unpaired jelly", () => {
    const s = createState(tank([jelly(0, 3), jelly(0, 3), jelly(1, 3)]), seeded(), ON);
    pairUp(s, 0, 1);
    const save = toSave(s, 0);
    expect(save.slots[0]!.pair).toBe(1);
    expect(save.slots[1]!.pair).toBe(0);
    expect("pair" in save.slots[2]!).toBe(false);
    const back = createState(loadSave(JSON.stringify(save), save.lastSeen), seeded(), ON);
    expect(pairs(back)).toEqual([[0, 1]]);
    expect(mateSlot(back, 2)).toBe(-1);
  });
  it("a pair that doesn't hold (one-sided, across species, not adults, itself, junk) is dropped on load", () => {
    const load = (slots: (SaveJelly | null)[]) => pairs(createState(loadSave(JSON.stringify(tank(slots)), 0), seeded(), ON));
    expect(load([jelly(0, 3, { pair: 1 }), jelly(0, 3)])).toEqual([]);
    expect(load([jelly(0, 3, { pair: 1 }), jelly(1, 3, { pair: 0 })])).toEqual([]);
    expect(load([jelly(0, 3, { pair: 1 }), jelly(0, 2, { pair: 0 })])).toEqual([]);
    expect(load([jelly(0, 3, { pair: 0 })])).toEqual([]);
    expect(load([jelly(0, 3, { pair: 9 as number }), jelly(0, 3, { pair: "1" as unknown as number })])).toEqual([]);
    expect(load([jelly(0, 3, { pair: 1 }), jelly(0, 3, { pair: 0 })])).toEqual([[0, 1]]);
  });
  it("pairs off: a saved pair is kept as loaded (and saved again) but does nothing", () => {
    const s = createState(loadSave(JSON.stringify(tank([jelly(0, 3, { pair: 1 }), jelly(0, 3, { pair: 0 })])), 0), seeded());
    expect(toSave(s, 0).slots[0]!.pair).toBe(1);
    s.slots[0]!.content = BABY_SECONDS - 0.01;
    const ev = together(s, 0, 1, 0.1);
    expect(ev.find((e) => e.type === "baby")?.mate).toBeUndefined();
  });
  it("morph ids 4 and 5 load, and winter's frost 3; 6 loads as none; morphSeen keeps the bits of known ids", () => {
    expect([4, 5, 3, 6].map(morphOf)).toEqual([4, 5, 3, 0]);
    const raw = { ...tank([]), journal: tank([]).journal.map((e, k) => ({ ...e, morphSeen: [63, 8, 16, 32][k] ?? 0 })) };
    expect(loadSave(JSON.stringify(raw), 0).journal.slice(0, 4).map((e) => e.morphSeen)).toEqual([31, 8, 16, 0]);
    const jn = journalFrom([jelly(0, 3, { morph: MORPH_PEARL }), jelly(1, 3, { morph: MORPH_DUSK })], 0);
    expect(morphSeen(jn[0]!, MORPH_PEARL) && morphSeen(jn[1]!, MORPH_DUSK)).toBe(true);
  });
});

describe("v16 pairs: the view", () => {
  it("dusk = 1 only for a dusk, pearl = 1 only for a pearl; healthy 0 while one shows; pale overrides both", () => {
    const s = createState(tank([jelly(1, 3, { morph: MORPH_DUSK }), jelly(1, 3, { morph: MORPH_PEARL }), jelly(1, 3)]), seeded());
    let v = view(s);
    expect([v.j0dusk, v.j0pearl, v.j0healthy, v.j0morph, v.j0ghost]).toEqual([1, 0, 0, 0, 0]);
    expect([v.j1dusk, v.j1pearl, v.j1healthy, v.j1morph, v.j1ghost]).toEqual([0, 1, 0, 0, 0]);
    expect([v.j2dusk, v.j2pearl, v.j2healthy]).toEqual([0, 0, 1]);
    expect([v.j3dusk, v.j3pearl]).toEqual([0, 0]);
    expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
    expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
    for (const j of s.slots) if (j) (j.fullness = 0), (j.affection = 0);
    setMurk(s, 1);
    v = view(s);
    expect([v.j0dusk, v.j0pearl, v.j0healthy, v.j0pale]).toEqual([0, 0, 0, 1]);
    expect([v.j1dusk, v.j1pearl, v.j1healthy, v.j1pale]).toEqual([0, 0, 0, 1]);
  });
});

describe("v16 pairs: sprite groups", () => {
  it("a dusk or pearl jelly needs its own colour's group; the others don't", () => {
    expect(morphGroup(MORPH_DUSK)).toBe("mo-dusk");
    expect(morphGroup(MORPH_PEARL)).toBe("mo-pearl");
    expect(jellyGroups({ k: 5, morph: MORPH_DUSK })).toEqual(["sp-nettle", "mo-dusk"]);
    expect(jellyGroups({ k: 0, morph: MORPH_PEARL })).toEqual(["sp-moon", "mo-pearl"]);
    expect(groupsFor([{ k: 0, morph: 0 }, { k: 0, morph: 1 }, { k: 3, morph: 2 }], null)).toEqual(["sp-moon", "sp-comb", "ev-halloween"]);
    expect(groupsFor([{ k: 0, morph: 4 }, { k: 0, morph: 5 }, { k: 0, morph: 4 }], null)).toEqual(["sp-moon", "mo-dusk", "mo-pearl"]);
  });
  it("both groups ship, hold every species and stage, and no other pack holds their art", () => {
    for (const [g, prefix] of [["mo-dusk", "mo_dusk_"], ["mo-pearl", "mo_pearl_"]] as const) {
      expect(GROUPS[g], g).toBeDefined();
      const pack = JSON.parse(readFileSync(new URL(`../public/sprites/${g}.json`, import.meta.url), "utf8")) as { sprites: Record<string, string> };
      const names = Object.keys(pack.sprites);
      expect(names.every((n) => n.startsWith(prefix))).toBe(true);
      const bells = names.filter((n) => /^mo_[a-z]+_[A-Z][a-z]+(Polyp|Ephyra|Juvenile|Adult)\d$/.test(n));
      expect(bells.length).toBeGreaterThanOrEqual(SPECIES_NAMES.length * 4 * 4); // every species, stage and frame
      expect(names).toContain(`${prefix}MoonAdult0`);
      expect(names).toContain(`${prefix}LionsmaneAdult7`);
    }
    for (const g of Object.keys(GROUPS).filter((g) => !g.startsWith("mo-"))) {
      const pack = JSON.parse(readFileSync(new URL(`../public/sprites/${g}.json`, import.meta.url), "utf8")) as { sprites: Record<string, string> };
      expect(Object.keys(pack.sprites).some((n) => n.startsWith("mo_")), g).toBe(false);
    }
  });
});

describe("v16 pairs: share codes (version 6)", () => {
  const named = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}) => jelly(k, g, { ...extra, trait: traitFromName(extra.name ?? "Mochi", k) });
  it("a tank with a dusk or pearl writes version 6 and round-trips; others keep their old codes", () => {
    const s = createState(tank([named(0, 3, { name: "Mochi", morph: MORPH_DUSK }), named(0, 3, { name: "Pip", morph: MORPH_PEARL }), named(2, 3, { name: "Boba", spot: 1, morph: MORPH_GHOST })]), seeded());
    const code = exportTank(s);
    expect(Buffer.from(code, "base64url")[0]! >> 4).toBe(6);
    const t = decodeTank(code)!;
    expect(t.jellies.map((j) => j.morph)).toEqual([MORPH_DUSK, MORPH_PEARL, MORPH_GHOST]);
    expect(exportTank(createState(importTank(code)!, seeded()))).toBe(code);
    // the same tank with the pair's colours swapped for older ones: a version 3 code, as before
    s.slots[0]!.morph = MORPH_CLASSIC;
    s.slots[1]!.morph = MORPH_NONE;
    expect(Buffer.from(exportTank(s), "base64url")[0]! >> 4).toBe(3);
  });
  it("one spelling: a version 6 code whose morphs all fit 2 bits, or one with an unknown id (6, 7), is not a code", () => {
    const t: TankCode = { tier: 0, helpers: [false, false, false], decor: Array.from({ length: DECOR.length }, () => null), jellies: [{ slot: 0, k: 0, g: 1, morph: MORPH_PEARL, place: -1, name: "Pip" }] };
    expect(needsV6(t)).toBe(true);
    const code = encodeTank(t);
    expect(decodeTank(code)).toEqual(t.jellies[0] && { ...t, jellies: [{ ...t.jellies[0], trait: traitFromName("Pip", 0) }] });
    expect(() => encodeTank({ ...t, jellies: [{ ...t.jellies[0]!, morph: 6 }] })).toThrow();
    // winter's frost (3) goes out as version 6 and comes back
    const frost = encodeTank({ ...t, jellies: [{ ...t.jellies[0]!, morph: 3 }] });
    expect(Buffer.from(frost, "base64url")[0]! >> 4).toBe(6);
    expect(decodeTank(frost)!.jellies[0]!.morph).toBe(3);
    // hand-built: the same bits with morph 1 (fits versions 1..5) and with morphs 6, 7 (unknown)
    const bytes = [...Buffer.from(code, "base64url")].slice(0, -2);
    const bits = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
    // version 4 | tier 2 | theme 3 | helpers 3 | D 4 | jelly count 3 | slot 3 | k 4 | g 2 | morph 3 ...
    const at = 4 + 2 + 3 + 3 + 4 + 3 + 3 + 4 + 2;
    for (const m of [1, 6, 7]) {
      const b2 = bits.slice(0, at) + m.toString(2).padStart(3, "0") + bits.slice(at + 3);
      const out = (b2.match(/.{8}/g) ?? []).map((x) => parseInt(x, 2));
      let a = 0;
      let c = 0;
      for (const x of out) (a = (a + x) % 255), (c = (c + a) % 255);
      const forged = Buffer.from([...out, c, a]).toString("base64url");
      expect(decodeTank(forged), `morph ${m}`).toBeNull();
    }
  });
});

describe("v16 pairs: what a screen reader hears", () => {
  const names = ["Mochi", "Pip", "Bean"];
  const who = (slot: number) => ({ name: names[slot]!, k: 0, g: slot === 2 ? 0 : 3 });
  it("a new pair, a pair's baby (both parents named), and a paired jelly's description", () => {
    expect(eventWords({ type: "paired", slot: 0, mate: 1 }, who)?.text).toBe("Mochi and Pip are a pair now.");
    expect(eventWords({ type: "baby", slot: 2, parent: 0, mate: 1 }, who)?.text).toBe("A new jelly was born to Mochi and Pip: Bean, a moon jelly polyp.");
    expect(eventWords({ type: "baby", slot: 2, parent: 0 }, who)?.text).toBe("A new jelly was born: Bean, a moon jelly polyp.");
    expect(describeJelly({ name: "Mochi", k: 0, g: 3, fullness: 1, mood: 1, morph: 4, mate: "Pip" })).toBe("Mochi, adult moon jelly, dusk colour, full, happy, paired with Pip");
    expect(describeJelly({ name: "Pip", k: 0, g: 3, fullness: 1, mood: 1, morph: 5, mate: null })).toBe("Pip, adult moon jelly, pearl colour, full, happy");
  });
});
