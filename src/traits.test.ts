/**
 * v13: jelly personalities (shy, curious, sleepy, social) and the bubbler (decoration 10, shop item 24) with its current.
 */
import { describe, expect, it } from "vitest";
import { BUBBLER, DECOR_N, KEEP_DECOR0, SHOP_ITEMS, TAB_ITEMS } from "./species";
import { CURIOUS, RIDE_CHANCE, SHY, SHY_FOOD_DELAY, SHY_TRUST, SLEEPY, SOCIAL, TRAIT_INHERIT, TRAIT_N, TRAIT_PHRASES, drowsy, rollTrait, traitFromName, traitsIn } from "./traits";
import { COLUMN_HALF, CURRENT_HALF, FOOD_LIFT_TIME, currentAt, foodLift } from "./currents";
import { CODE_VERSION_V5, decodeTank, encodeTank } from "./tankcode";
import { planRequests, requestText, rewardOf, type DailyRequests } from "./requests";
import {
  DECOR,
  K,
  bubbleColumn,
  buy,
  createState,
  dayKey,
  decorAt,
  dropDecor,
  exportTank,
  importTank,
  jellyInfo,
  journal,
  journalFrom,
  geomOf,
  liftDecor,
  loadGame,
  openShop,
  loadSave,
  moveDecor,
  requests,
  setCursor,
  setReducedMotion,
  setTool,
  sprinkle,
  step,
  tap,
  toSave,
  view,
  type Jelly,
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
const run = (s: State, seconds: number, dt = 1 / 60) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds / dt; i++) events.push(...step(s, dt));
  return events;
};
const count = (events: SimEvent[], type: string, slot?: number) => events.filter((e) => e.type === type && (slot === undefined || e.slot === slot)).length;
/** local wall-clock times, so day/night and the sleepy hour don't depend on the machine's time zone */
const at = (h: number, m = 0) => new Date(2026, 9, 1, h, m).getTime();
const NOON = at(12);
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 0.7, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: CURIOUS,
  ...extra,
});
const owned = (...ds: number[]) => Array.from({ length: DECOR_N }, (_, d) => ds.includes(d));
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 12, foods: [true, false, false], themes: [true, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null,
  owned: owned(), helpers: [false, false, false], decorX: DECOR.map((d) => d.x),
  pearlDay: "", lastSeen: NOON, tier: 0, cam: 0, journal: journalFrom(slots, 0),
  ...extra,
});
const centre = (j: Jelly) => ({ x: j.x, y: j.y });
const noVisits = (s: State) => {
  s.nextVisit = Infinity;
  return s;
};

describe("traits: the rules", () => {
  it("a jelly from before traits gets one from its name and species: always the same, every trait reachable", () => {
    expect(traitFromName("Mochi", 0)).toBe(traitFromName("Mochi", 0));
    const seen = new Set<number>();
    for (const name of ["Mochi", "Bloop", "Taffy", "Plum", "Boba", "Pip", "Nori", "Kiwi", "Dot", "Sago"]) {
      for (let k = 0; k < 9; k++) {
        const t = traitFromName(name, k);
        expect(t >= 0 && t < TRAIT_N).toBe(true);
        seen.add(t);
      }
    }
    expect(seen.size).toBe(TRAIT_N);
  });

  it("a bought polyp's trait is uniform; a baby shares its parent's TRAIT_INHERIT of the time, else rolls", () => {
    const r = seeded(5);
    const n = 20000;
    const bought = new Array(TRAIT_N).fill(0);
    for (let i = 0; i < n; i++) bought[rollTrait(r, null)]++;
    for (const c of bought) expect(c / n).toBeCloseTo(1 / TRAIT_N, 1);
    let same = 0;
    for (let i = 0; i < n; i++) if (rollTrait(r, SLEEPY) === SLEEPY) same++;
    expect(same / n).toBeCloseTo(TRAIT_INHERIT + (1 - TRAIT_INHERIT) / TRAIT_N, 1);
  });

  it("the card's line and the journal's list", () => {
    expect(TRAIT_PHRASES[SHY]).toBe("Shy — hides by the rocks");
    for (const p of TRAIT_PHRASES) expect(p).not.toContain("!");
    expect(traitsIn(0)).toEqual([]);
    expect(traitsIn((1 << SHY) | (1 << SOCIAL))).toEqual(["Shy", "Social"]);
  });

  it("sleepy jellies turn in an hour early, unless the lamp says it's day", () => {
    expect(drowsy(18, false)).toBeGreaterThan(0);
    expect(drowsy(18, true)).toBe(0);
    expect(drowsy(12, false)).toBe(0);
  });
});

describe("traits: saves, births, the card and the journal", () => {
  it("an old save's jellies get their name's trait on load, the same every load, and keep it from then on", () => {
    const old = tank([jelly(0, 3, { name: "Taffy" }), jelly(4, 2, { name: "Boba" })]);
    for (const j of old.slots) if (j) delete (j as { trait?: number }).trait;
    const a = loadSave(JSON.stringify(old), NOON);
    const b = loadSave(JSON.stringify(old), NOON + 5000);
    expect(a.slots[0]!.trait).toBe(traitFromName("Taffy", 0));
    expect(a.slots[1]!.trait).toBe(traitFromName("Boba", 4));
    expect(b.slots.map((j) => j?.trait)).toEqual(a.slots.map((j) => j?.trait));
    // a saved trait is kept, and a damaged one falls back to the name's
    const saved = tank([jelly(0, 3, { name: "Taffy", trait: SOCIAL }), jelly(1, 3, { name: "Plum", trait: 9 })]);
    const back = loadSave(JSON.stringify(saved), NOON);
    expect(back.slots[0]!.trait).toBe(SOCIAL);
    expect(back.slots[1]!.trait).toBe(traitFromName("Plum", 1));
    const s = createState(back, seeded());
    expect(toSave(s, NOON).slots[0]!.trait).toBe(SOCIAL);
    expect(jellyInfo(s, 0)!.trait).toBe(SOCIAL);
  });

  it("a bought polyp rolls its own trait (from the traits' own stream); a baby often takes its parent's", () => {
    const s = createState(tank([jelly(0, 3, { trait: SHY, fullness: 1, affection: 1 })], { dollars: 5000, tier: 2 }), seeded());
    const before = s.rand;
    s.traitRand = () => 0.6; // uniform roll: floor(0.6 * 4) = 2
    expect(buy(s, 0)).toBe("bought");
    const polyp = s.slots.find((j, i) => j && i > 0)!;
    expect(polyp.trait).toBe(SLEEPY);
    expect(s.rand).toBe(before);
    // a baby: inherits when the first draw is under TRAIT_INHERIT
    const draws = [0.1];
    s.traitRand = () => draws.shift() ?? 0.99;
    s.slots[0]!.content = 1e9;
    const ev = run(s, 0.1);
    const baby = ev.find((e) => e.type === "baby")!;
    expect(s.slots[baby.slot!]!.trait).toBe(SHY);
    // the journal has met both
    expect(journal(s)[0]!.traitSeen & (1 << SHY)).toBeTruthy();
    expect(journal(s)[1]!.traitSeen).toBe(1 << SLEEPY);
  });
});

/** An adult moon of trait t at (x, y), in a tank with an idle partner far away. */
function one(trait: number, x = 360, y = 540, extra: Partial<Save> = {}, j: Partial<SaveJelly> = {}) {
  const s = noVisits(createState(tank([jelly(0, 3, { trait, fullness: 1, ...j })], extra), seeded(3)));
  const me = s.slots[0]!;
  me.x = x;
  me.y = y;
  return { s, me };
}

describe("shy", () => {
  it("a tap on the glass nearby sends it to the nearest rock or decoration, low down; it lingers there", () => {
    const { s, me } = one(SHY, 360, 500, { owned: owned(1) });
    expect(tap(s, 500, 420)).toBe("call");
    expect(me.targetKind).toBe("hide");
    const b = me.target!;
    expect(b.y).toBeGreaterThan(720);
    run(s, 5);
    expect(me.targetKind).toBe("hide");
    expect(me.y).toBeGreaterThan(650);
    expect(Math.abs(me.x - b.x)).toBeLessThan(120);
  });

  it("a far tap, or one that pets it, or a jelly that trusts you: no fright (and a tap calls a jelly that isn't hiding)", () => {
    const far = one(SHY, 200, 500);
    tap(far.s, 600, 300);
    expect(far.me.targetKind).not.toBe("hide");
    const pet = one(SHY, 360, 540);
    expect(tap(pet.s, 360, 500)).toBe("pet");
    expect(pet.me.targetKind).not.toBe("hide");
    const trusting = one(SHY, 360, 500, {}, { affection: SHY_TRUST + 0.1 });
    expect(tap(trusting.s, 500, 420)).toBe("call");
    expect(trusting.me.targetKind).toBe("tap");
    // two jellies by the tap: the shy one hides, the curious one is called
    const s = noVisits(createState(tank([jelly(0, 3, { trait: SHY }), jelly(0, 3, { trait: CURIOUS, name: "Pip" })]), seeded()));
    Object.assign(s.slots[0]!, { x: 250, y: 500 });
    Object.assign(s.slots[1]!, { x: 500, y: 520 });
    expect(tap(s, 380, 470)).toBe("call");
    expect(s.slots[0]!.targetKind).toBe("hide");
    expect(s.slots[1]!.targetKind).toBe("tap");
  });

  it("with reduce motion it still hides, but drifts there gently instead of darting", () => {
    const speed = (reduce: boolean) => {
      const { s, me } = one(SHY, 360, 500, { owned: owned(1) });
      setReducedMotion(s, reduce);
      tap(s, 500, 420);
      expect(me.targetKind).toBe("hide");
      let top = 0;
      for (let i = 0; i < 90; i++) {
        step(s, 1 / 60);
        top = Math.max(top, Math.hypot(me.vx, me.vy));
      }
      return top;
    };
    expect(speed(true)).toBeLessThan(speed(false) * 0.8);
  });

  it("a held item swept fast past it startles it; moved slowly, it doesn't", () => {
    const fast = one(SHY, 360, 500);
    setTool(fast.s, "food");
    setCursor(fast.s, 300, 450, false, true);
    for (let i = 0; i < 10; i++) {
      setCursor(fast.s, 300 + (i % 2 ? 60 : 0), 450, false, true);
      step(fast.s, 1 / 60);
    }
    expect(fast.me.targetKind).toBe("hide");
    const slow = one(SHY, 360, 500);
    setTool(slow.s, "food");
    for (let i = 0; i < 60; i++) {
      setCursor(slow.s, 300 + i, 450, false, true);
      step(slow.s, 1 / 60);
    }
    expect(slow.me.targetKind).not.toBe("hide");
  });

  it("is slower to go for sinking food, but still eats it", () => {
    const { s, me } = one(SHY, 360, 540, {}, { fullness: 0.2 });
    sprinkle(s, 360, 300, 0);
    step(s, 1 / 60);
    expect(me.targetKind).not.toBe("food");
    run(s, SHY_FOOD_DELAY);
    expect(me.targetKind).toBe("food");
    expect(count(run(s, 30), "ate", 0)).toBeGreaterThan(0);
  });
});

describe("curious", () => {
  it("drifts over to the held item while it's in the water", () => {
    const { s, me } = one(CURIOUS, 200, 800);
    setTool(s, "sponge");
    setCursor(s, 520, 400, false, true);
    const d0 = Math.hypot(me.x - 520, me.y - 400);
    run(s, 30);
    const curious = Math.hypot(me.x - 520, me.y - 400);
    expect(curious).toBeLessThan(d0 * 0.4);
    // a sleepy jelly doesn't care
    const other = one(SLEEPY, 200, 800);
    setTool(other.s, "sponge");
    setCursor(other.s, 520, 400, false, true);
    run(other.s, 30);
    expect(Math.hypot(other.me.x - 520, other.me.y - 400)).toBeGreaterThan(curious * 1.5);
  });

  it("is the first to say hello when a visitor arrives", () => {
    const s = createState(tank([jelly(0, 3, { trait: CURIOUS }), jelly(1, 3, { trait: SHY, name: "Pip" })]), seeded(2));
    s.nextVisit = 0;
    const ev = run(s, 0.5);
    expect(count(ev, "visitorArrived")).toBe(1);
    expect(s.slots[0]!.targetKind).toBe("visit");
    expect(s.slots[1]!.targetKind).not.toBe("visit");
  });
});

describe("sleepy", () => {
  it("pauses longer between pulses and keeps lower than a curious jelly", () => {
    const pulses = (trait: number) => {
      const { s, me } = one(trait);
      let y = 0;
      let n = 0;
      const ev: SimEvent[] = [];
      for (let i = 0; i < 240 * 30; i++) {
        ev.push(...step(s, 1 / 30));
        y += me.y;
        n++;
      }
      return { pulses: count(ev, "pulse", 0), y: y / n };
    };
    const sleepy = pulses(SLEEPY);
    const curious = pulses(CURIOUS);
    expect(sleepy.pulses).toBeLessThan(curious.pulses * 0.85);
    expect(sleepy.y).toBeGreaterThan(curious.y + 60);
  });

  it("settles in an hour before night (fewer pulses at 18:30 than at noon); a curious one doesn't", () => {
    const pulses = (trait: number, clock: number) => {
      const { s } = one(trait, 360, 540, { lastSeen: clock });
      return count(run(s, 120, 1 / 30), "pulse", 0);
    };
    expect(pulses(SLEEPY, at(18, 30))).toBeLessThan(pulses(SLEEPY, NOON) * 0.85);
    expect(pulses(CURIOUS, at(18, 30))).toBe(pulses(CURIOUS, NOON));
  });
});

describe("social", () => {
  it("stays nearer the others by day than an independent jelly does", () => {
    const spread = (trait: number) => {
      const s = noVisits(createState(tank([jelly(0, 3, { trait }), jelly(0, 3, { trait: SLEEPY, name: "Pip" }), jelly(1, 3, { trait: SLEEPY, name: "Dot" })]), seeded(9)));
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 300 * 30; i++) {
        step(s, 1 / 30);
        const [a, b, c] = [s.slots[0]!, s.slots[1]!, s.slots[2]!];
        sum += Math.hypot(a.x - (b.x + c.x) / 2, a.y - (b.y + c.y) / 2);
        n++;
      }
      return sum / n;
    };
    expect(spread(SOCIAL)).toBeLessThan(spread(CURIOUS) * 0.8);
  });
});

describe("every trait still eats and can be petted", () => {
  for (const trait of [SHY, CURIOUS, SLEEPY, SOCIAL]) {
    it(`trait ${trait}`, () => {
      const { s, me } = one(trait, 360, 540, {}, { fullness: 0.2 });
      expect(tap(s, me.x, me.y - 40)).toBe("pet");
      run(s, 3);
      sprinkle(s, 300, 400, 0);
      expect(count(run(s, 40), "ate", 0)).toBeGreaterThan(0);
    });
  }
});

describe("the bubbler", () => {
  const bubbled = (trait = CURIOUS, extra: Partial<Save> = {}) => one(trait, 200, 700, { owned: owned(BUBBLER), ...extra });

  it("is shop item 24 on the DECOR tab, decoration 10 (after the keepsakes), about 80 dollars; it shows when bought", () => {
    const item = SHOP_ITEMS[24]!;
    expect(item).toMatchObject({ name: "BUBBLER", kind: "decor", d: BUBBLER });
    expect(item.price).toBeGreaterThanOrEqual(70);
    expect(item.price).toBeLessThanOrEqual(90);
    expect(TAB_ITEMS[1]).toContain(24);
    const s = createState(tank([jelly(0, 3)], { dollars: 100 }), seeded());
    expect(view(s)[`dec${BUBBLER}`]).toBe(0);
    expect(bubbleColumn(s)).toBeNull();
    expect(buy(s, 24)).toBe("bought");
    expect(s.dollars).toBe(100 - item.price);
    expect(view(s)[`dec${BUBBLER}`]).toBe(1);
    expect(buy(s, 24)).toBe("putAway"); // v15: its card puts it away (no refund, no charge)
    expect(bubbleColumn(s)).toBeNull();
    expect(s.dollars).toBe(100 - item.price);
    expect(toSave(s, NOON).owned[BUBBLER]).toBe(true);
  });

  it("lands on open sand when bought: its default spot when that's clear, else the roomiest spot every jelly can reach", () => {
    const fresh = createState(tank([jelly(0, 3)], { dollars: 100 }), seeded());
    openShop(fresh);
    expect(buy(fresh, 24)).toBe("bought");
    expect(fresh.decorX[BUBBLER]).toBe(DECOR[BUBBLER]!.x);
    // the ship's wheel (a keepsake) where it would go, and Halloween's pumpkins and cauldron out: the gap between
    // them is a little narrow, so it shares the squeeze rather than landing on any one thing
    const busy = createState(tank([jelly(0, 3)], { dollars: 100, owned: owned(8) }), seeded());
    busy.event = "halloween";
    openShop(busy);
    expect(buy(busy, 24)).toBe("bought");
    const x = busy.decorX[BUBBLER]!;
    const half = DECOR[BUBBLER]!.w / 2;
    const apart = (cx: number, w: number) => x + half <= cx - w / 2 || x - half >= cx + w / 2;
    expect(x).not.toBe(DECOR[BUBBLER]!.x);
    expect(apart(DECOR[8]!.x, DECOR[8]!.w)).toBe(true);
    const chest = (K as unknown as { chest: { x: number; w: number } }).chest;
    expect(apart(chest.x, chest.w)).toBe(true);
    for (let k = 0; k < 9; k++) {
      const b = geomOf(k as Species, 3).bounds;
      expect(x).toBeGreaterThanOrEqual(b.x0 - COLUMN_HALF);
      expect(x).toBeLessThanOrEqual(b.x1 + COLUMN_HALF);
    }
  });

  it("can be picked up and moved along the sand like the others; the column follows", () => {
    const { s } = bubbled();
    const d = DECOR[BUBBLER]!;
    expect(decorAt(s, d.x, d.y - 10)).toBe(BUBBLER);
    expect(liftDecor(s, BUBBLER)).toBe(true);
    moveDecor(s, BUBBLER, 300);
    dropDecor(s);
    expect(bubbleColumn(s)!.x).toBe(300);
    expect(view(s)[`dec${BUBBLER}x`]).toBe(300);
  });

  it("the column pushes a swimmer in it up (gently), and nothing outside it", () => {
    expect(currentAt(0, 500, 42, 990)).toBe(1);
    expect(currentAt(CURRENT_HALF, 500, 42, 990)).toBe(0);
    expect(currentAt(0, 1000, 42, 990)).toBe(0);
    const rise = (x: number) => {
      const { s, me } = bubbled(SLEEPY);
      const col = bubbleColumn(s)!;
      me.x = col.x + x;
      me.y = 700;
      me.target = { x: me.x, y: 700 };
      me.targetUntil = Infinity;
      run(s, 3);
      return 700 - me.y;
    };
    expect(rise(0)).toBeGreaterThan(rise(200) + 15);
  });

  it("food sprinkled into the column rises a little before it sinks", () => {
    expect(foodLift(1, 0)).toBeGreaterThan(30);
    expect(foodLift(1, FOOD_LIFT_TIME)).toBe(0);
    const { s } = bubbled(SLEEPY);
    s.slots[0]!.x = 600;
    const col = bubbleColumn(s)!;
    sprinkle(s, col.x, 600, 0);
    const f = s.food.find((p) => p.state === "sink")!;
    const y0 = f.y;
    run(s, 0.4);
    expect(f.y).toBeLessThan(y0);
    run(s, 4);
    expect(f.y).toBeGreaterThan(y0);
  });

  it("sometimes a wander becomes a ride: into the column, up to the top, then back down to one side", () => {
    const { s, me } = bubbled(CURIOUS);
    expect(RIDE_CHANCE[CURIOUS]!).toBeGreaterThan(RIDE_CHANCE[SHY]!);
    me.targetUntil = 0;
    s.rand = () => 0.01;
    step(s, 1 / 60);
    expect(me.targetKind).toBe("ride");
    s.rand = seeded(4);
    let ev: SimEvent[] = [];
    let topY = Infinity;
    for (let i = 0; i < 40 * 60 && !ev.some((e) => e.type === "rode"); i++) {
      ev = ev.concat(step(s, 1 / 60));
      topY = Math.min(topY, me.y);
    }
    const rode = ev.find((e) => e.type === "rode")!;
    expect(rode).toBeDefined();
    expect(rode.seen).toBe(true);
    expect(topY).toBeLessThan(K.waterTop + 300);
    expect(Math.abs(me.x - bubbleColumn(s)!.x)).toBeLessThan(COLUMN_HALF * 2);
    expect(me.targetKind).toBe("wander");
    run(s, 5);
    expect(me.y).toBeGreaterThan(topY + 40);
  });

  it("no bubbler: no rides, no current; the random stream is untouched", () => {
    const a = one(CURIOUS, 200, 700);
    const b = one(CURIOUS, 200, 700);
    const ev = run(a.s, 60);
    run(b.s, 60);
    expect(count(ev, "rode")).toBe(0);
    expect(a.me.x).toBe(b.me.x);
  });

  it("daily requests: 'watch a jelly ride the bubbler' only with the bubbler, pays 8", () => {
    const days = Array.from({ length: 60 }, (_, i) => `2026-11-${String((i % 28) + 1).padStart(2, "0")}`);
    const base = { species: [0 as Species], foods: [true, false, false], decor: owned(), pearl: false };
    expect(days.some((d) => planRequests(d, base).items.some((r) => r.kind === "ride"))).toBe(false);
    expect(days.some((d) => planRequests(d, { ...base, decor: owned(BUBBLER), bubbler: true }).items.some((r) => r.kind === "ride"))).toBe(true);
    const r = { kind: "ride" as const, target: -1, n: 1, progress: 0, done: false };
    expect(rewardOf(r)).toBe(8);
    expect(requestText(r)).toBe("Watch a jelly ride the bubbler");
    // a ride in view finishes it
    const { s, me } = bubbled(CURIOUS);
    s.requestsOn = true;
    s.requests = { day: dayKey(s.clock), items: [{ ...r }] } as DailyRequests;
    me.targetUntil = 0;
    s.rand = () => 0.01;
    step(s, 1 / 60);
    s.rand = seeded(4);
    const before = s.dollars;
    const ev = run(s, 40);
    expect(ev.find((e) => e.type === "requestDone")?.amount).toBe(8);
    expect(s.dollars).toBe(before + 8);
    expect(requests(s)!.items[0]!.done).toBe(true);
  });
});

describe("share codes (v13)", () => {
  const version = (c: string) => Buffer.from(c, "base64url")[0]! >> 4;

  it("a tank whose jellies have their name's traits and no bubbler keeps its old code", () => {
    const s = createState(tank([jelly(0, 3, { name: "Taffy", trait: traitFromName("Taffy", 0) })]), seeded());
    const c = exportTank(s);
    expect(version(c)).toBe(1);
    expect(decodeTank(c)!.jellies[0]!.trait).toBeUndefined();
    // read back, the jelly gets its name's trait
    expect(importTank(c, NOON)!.slots[0]!.trait).toBe(traitFromName("Taffy", 0));
  });

  it("traits and the bubbler travel in version 5, and round-trip", () => {
    const other = (traitFromName("Taffy", 0) + 1) % TRAIT_N;
    const s = createState(tank([jelly(0, 3, { name: "Taffy", trait: other }), jelly(3, 2, { name: "Pip", trait: SOCIAL })], { owned: owned(0, BUBBLER), theme: 2, themes: [true, false, true, false] }), seeded());
    s.decorX[BUBBLER] = 300;
    const c = exportTank(s);
    expect(version(c)).toBe(5);
    const back = createState(importTank(c, NOON)!, seeded());
    expect(back.slots[0]!.trait).toBe(other);
    expect(back.slots[1]!.trait).toBe(SOCIAL);
    expect(back.owned[BUBBLER]).toBe(true);
    expect(back.decorX[BUBBLER]).toBe(300);
    expect(back.theme).toBe(2);
    expect(exportTank(back)).toBe(c);
    // the bubbler alone is enough for version 5
    const only = createState(tank([jelly(0, 3, { name: "Taffy", trait: traitFromName("Taffy", 0) })], { owned: owned(BUBBLER) }), seeded());
    expect(version(exportTank(only))).toBe(5);
  });

  it("one version 5 for both: every keepsake, the bubbler, the lagoon, a ghost and traits round-trip together", () => {
    const all = Array.from({ length: DECOR_N }, (_, d) => d);
    const save = tank(
      [jelly(0, 3, { name: "Taffy", trait: (traitFromName("Taffy", 0) + 1) % TRAIT_N, morph: 2 }), jelly(3, 2, { name: "Pip", trait: SHY, spot: 0 }), jelly(1, 0, { name: "Bean", trait: SLEEPY, anchor: 1 })],
      { owned: owned(...all), tier: 2, themes: [true, false, false, false, true], theme: 4 },
    );
    const s = createState(save, seeded());
    const c = exportTank(s);
    expect(version(c)).toBe(CODE_VERSION_V5);
    const t = decodeTank(c)!;
    expect(t.theme).toBe(4);
    expect(t.decor.every((x) => x !== null)).toBe(true);
    expect(t.jellies.map((j) => [j.morph, j.trait])).toEqual([[2, (traitFromName("Taffy", 0) + 1) % TRAIT_N], [0, SHY], [0, SLEEPY]]);
    const back = createState(importTank(c, NOON)!, seeded());
    expect(back.owned).toEqual(owned(...all));
    expect(back.theme).toBe(4);
    expect(exportTank(back)).toBe(c);
  });

  it("version 5 carries decorations only up to the last owned one, and only that spelling decodes", () => {
    const s = createState(tank([jelly(0, 3, { name: "Taffy", trait: traitFromName("Taffy", 0) })], { owned: owned(0, KEEP_DECOR0) }), seeded());
    const t = decodeTank(exportTank(s))!;
    expect(t.decor.slice(0, KEEP_DECOR0 + 1).map((x) => x !== null)).toEqual([true, false, false, false, false, true]);
    // a hand-made code with a longer decoration count (trailing unowned bits) isn't one encodeTank writes
    const bits: number[] = [];
    const put = (v: number, w: number) => { for (let i = w - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    const code = (nd: number) => {
      bits.length = 0;
      put(CODE_VERSION_V5, 4); put(0, 2); put(0, 3); put(0, 3); put(nd, 4);
      for (let n = 0; n < nd; n++) put(n === KEEP_DECOR0 ? 1 : 0, 1);
      put(DECOR[KEEP_DECOR0]!.x / 3, 9);
      put(0, 3);
      while (bits.length % 8) bits.push(0);
      const bytes = Array.from({ length: bits.length / 8 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8).join(""), 2));
      let a = 0, b = 0;
      for (const x of bytes) { a = (a + x) % 255; b = (b + a) % 255; }
      return Buffer.from([...bytes, b, a]).toString("base64url");
    };
    const exact = decodeTank(code(KEEP_DECOR0 + 1));
    expect(exact?.decor[KEEP_DECOR0]).toBe(DECOR[KEEP_DECOR0]!.x);
    expect(encodeTank(exact!)).toBe(code(KEEP_DECOR0 + 1));
    expect(decodeTank(code(KEEP_DECOR0 + 2))).toBeNull();
    expect(decodeTank(code(DECOR_N + 1))).toBeNull();
  });
});

describe("v11 saves", () => {
  it("a v10 save (no traits, no keepsakes, five decorations) loads as v11: traits from names, keep seeded, arrays padded", () => {
    const v10 = {
      ...tank([jelly(0, 3, { name: "Taffy" }), jelly(2, 1, { name: "Pip" })]),
      v: 10,
      owned: [true, false, false, true, false],
      decorX: DECOR.slice(0, 5).map((d) => d.x),
    } as Record<string, unknown>;
    for (const j of v10.slots as (Record<string, unknown> | null)[]) if (j) delete j.trait;
    const { save } = loadGame(JSON.stringify(v10), NOON);
    expect(save.v).toBe(12);
    expect(save.slots[0]!.trait).toBe(traitFromName("Taffy", 0));
    expect(save.slots[1]!.trait).toBe(traitFromName("Pip", 2));
    expect(save.owned).toEqual(owned(0, 3));
    expect(save.decorX).toEqual(DECOR.map((d) => d.x));
    expect(save.decorX[BUBBLER]).toBe(DECOR[BUBBLER]!.x);
    expect(save.keep).toBeUndefined();
    const s = createState(save, seeded(), { keepsakes: true });
    expect(s.keep).not.toBeNull();
    expect(s.keep!.days).toBe(1);
    expect(s.keep!.earned & 1).toBe(1); // an adult already raised: the bottle, quietly
    const out = toSave(s, NOON);
    expect(out.v).toBe(12);
    expect(out.keep).toMatchObject({ days: 1, lastDay: dayKey(NOON) });
    expect(out.slots[0]!.trait).toBe(traitFromName("Taffy", 0));
    expect(out.owned.length).toBe(DECOR_N);
  });
});
