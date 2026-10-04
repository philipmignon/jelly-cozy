/**
 * ---- nursery ---- the nursery bowl: buying it, capacity, where babies go, moving between the tank and the bowl,
 * growing and moving out, its food, time away (hidden tab == reload), saves, share codes, the journal and the view.
 */
import { describe, expect, it } from "vitest";
import { BABY_SECONDS, CARE_SECONDS, DECOR_N, GROWTH, NURSERY_ITEM, NUR_CAP, NUR_FOOD_N, SHOP_ITEMS, TAB_ITEMS, nurseryProps } from "./species";
import { NURSERY, fromBowl, zoomAt } from "./nursery";
import { eventWords, keyAction } from "./a11y";
import {
  DECOR,
  K,
  applyAway,
  buy,
  catchUp,
  closeNursery,
  createState,
  exportTank,
  importTank,
  isNurseryOpen,
  journal,
  journalFrom,
  jellyCount,
  loadGame,
  moveToNursery,
  moveToTank,
  nurseryAt,
  nurseryCentre,
  nurseryCount,
  nurseryFeed,
  nurseryInfo,
  nurserySprinkle,
  nurseryTap,
  openNursery,
  openShop,
  setReducedMotion,
  specProps,
  step,
  toNurseryInfo,
  toSave,
  toTankInfo,
  view,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";

const T = new Date(2026, 9, 1, 12).getTime(); // local noon
const HOUR = 3_600_000;
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 0.9, affection: 0.6, anchor: -1, spot: -1, name: "Mochi", born: T, content: 0, morph: 0, trait: 1, ...extra,
});
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 13, foods: [true, false, false], themes: [true, false, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null, owned: Array.from({ length: DECOR_N }, () => false), helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: T, tier: 0, cam: 0, journal: journalFrom(slots, T), ...extra,
});
const nursery = (...slots: (SaveJelly | null)[]) => ({ slots: Array.from({ length: NUR_CAP }, (_, i) => slots[i] ?? null) });
/** the small tank, full: a happy adult moon about to have a baby, a juvenile blubber, a fried-egg polyp */
const fullTank = (extra: Partial<Save> = {}, content = BABY_SECONDS - 0.5) =>
  tank([jelly(0, 3, { name: "Mochi", content, fullness: 0.95, affection: 0.95 }), jelly(1, 2, { name: "Tofu" }), jelly(4, 0, { name: "Pip", anchor: 0 })], extra);
const run = (s: State, seconds: number, dt = 1 / 30) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) out.push(...step(s, dt));
  return out;
};
const of = (events: SimEvent[], type: string) => events.filter((e) => e.type === type);

describe("nursery: the shop", () => {
  it("is sold once on the TANK tab, at a tank-like price", () => {
    expect(SHOP_ITEMS[NURSERY_ITEM]).toMatchObject({ name: "NURSERY", kind: "nursery" });
    expect(TAB_ITEMS[3]).toContain(NURSERY_ITEM);
    expect((K.shopCards as unknown[])[NURSERY_ITEM]).toMatchObject({ tab: 3 });
    const price = SHOP_ITEMS[NURSERY_ITEM]!.price;
    expect(price).toBeGreaterThan(50);
    expect(price).toBeLessThanOrEqual(400);
    const s = createState(fullTank({ dollars: price - 1 }, 0), seeded());
    openShop(s);
    expect(buy(s, NURSERY_ITEM)).toBe("cantAfford");
    s.dollars = price + 10;
    expect(buy(s, NURSERY_ITEM)).toBe("bought");
    expect(s.dollars).toBe(10);
    expect(s.nursery?.slots).toHaveLength(NUR_CAP);
    expect(buy(s, NURSERY_ITEM)).toBe("owned");
    expect(s.dollars).toBe(10);
    expect(view(s)[`own${NURSERY_ITEM}`]).toBe(1);
  });
});

describe("nursery: where babies go", () => {
  it("a baby born into a full tank goes to the nursery", () => {
    const s = createState(fullTank({ nursery: nursery() }), seeded());
    const ev = run(s, 1);
    const baby = of(ev, "baby");
    expect(baby).toHaveLength(1);
    expect(baby[0]).toMatchObject({ nursery: true, slot: 0, parent: 0 });
    expect(nurseryCount(s)).toBe(1);
    expect(s.nursery!.slots[0]).toMatchObject({ k: 0, g: 0, mode: "fixed" });
    expect(jellyCount(s)).toBe(3);
    expect(s.slots[0]!.content).toBeLessThan(5); // the parent starts over
  });

  it("with room in the tank the baby is born there, as before", () => {
    const save = fullTank({ nursery: nursery() });
    save.slots[1] = null;
    const s = createState(save, seeded());
    const baby = of(run(s, 1), "baby");
    expect(baby).toHaveLength(1);
    expect(baby[0]!.nursery).toBeUndefined();
    expect(nurseryCount(s)).toBe(0);
  });

  it("no nursery, or a full one: the parent holds at the threshold", () => {
    for (const n of [undefined, nursery(...[0, 1, 2, 3].map((i) => jelly(0, 0, { name: `N${i}`, anchor: i })))]) {
      const s = createState(fullTank(n ? { nursery: n } : {}), seeded());
      expect(of(run(s, 2), "baby")).toHaveLength(0);
      expect(s.slots[0]!.content).toBe(BABY_SECONDS);
      expect(nurseryCount(s)).toBe(n ? NUR_CAP : 0);
    }
  });

  it("holds NUR_CAP little ones, each polyp on its own spot", () => {
    const s = createState(fullTank({ nursery: nursery() }), seeded());
    for (let i = 0; i < NUR_CAP + 2; i++) {
      s.slots[0]!.content = BABY_SECONDS;
      run(s, 0.1);
    }
    expect(nurseryCount(s)).toBe(NUR_CAP);
    expect(new Set(s.nursery!.slots.map((j) => j!.anchor)).size).toBe(NUR_CAP);
    for (const j of s.nursery!.slots) expect(j!.x).toBe(NURSERY.anchors[j!.anchor]!.x);
    expect(new Set([...s.slots, ...s.nursery!.slots].flatMap((j) => (j ? [j.name] : []))).size).toBe(3 + NUR_CAP); // names stay unique
  });
});

describe("nursery: moving between the tank and the bowl", () => {
  it("a polyp or an ephyra moves in from its card; a juvenile, the last jelly, or a full bowl can't", () => {
    const s = createState(fullTank({ nursery: nursery() }, 0), seeded());
    expect(toNurseryInfo(s, 1)).toMatchObject({ allowed: false });
    expect(moveToNursery(s, 1)).toBeNull();
    expect(toNurseryInfo(s, 2)).toEqual({ allowed: true, reason: "" });
    const r = moveToNursery(s, 2);
    expect(r).toEqual({ name: "Pip", n: 0 });
    expect(s.slots[2]).toBeNull();
    expect(s.nursery!.slots[0]).toMatchObject({ name: "Pip", k: 4, g: 0, mode: "fixed" });
    expect(of(run(s, 0.1), "nurseryIn")).toEqual([{ type: "nurseryIn", slot: 0, from: 2 }]);
    // the only jelly can't leave the tank
    const lone = createState(tank([jelly(0, 0, { anchor: 0 })], { nursery: nursery() }), seeded());
    expect(toNurseryInfo(lone, 0)).toMatchObject({ allowed: false, reason: expect.stringMatching(/only jelly/) });
    // without a bowl there's no row at all
    expect(toNurseryInfo(createState(fullTank({}, 0), seeded()), 2)).toBeNull();
    // a full bowl
    const fullBowl = createState(fullTank({ nursery: nursery(...[0, 1, 2, 3].map((i) => jelly(0, 0, { name: `N${i}`, anchor: i }))) }, 0), seeded());
    expect(toNurseryInfo(fullBowl, 2)).toMatchObject({ allowed: false, reason: "The nursery is full." });
  });

  it("back to the tank when there's room (a polyp needs a free rock)", () => {
    const s = createState(fullTank({ nursery: nursery(jelly(2, 0, { name: "Kiki", anchor: 1, gp: 2 }), jelly(5, 1, { name: "Nemo", gp: 6 })) }, 0), seeded());
    expect(toTankInfo(s, 0)).toMatchObject({ allowed: false, reason: expect.stringMatching(/full/) });
    expect(moveToTank(s, 0)).toBeNull();
    s.slots[1] = null; // Tofu rehomed
    const r = moveToTank(s, 1);
    expect(r?.name).toBe("Nemo");
    const j = s.slots[r!.slot]!;
    expect(j).toMatchObject({ name: "Nemo", k: 5, g: 1, gp: 6, mode: "swim" });
    expect(s.nursery!.slots[1]).toBeNull();
    expect(of(run(s, 0.1), "nurseryOut")).toEqual([{ type: "nurseryOut", slot: r!.slot, from: 1 }]);
    expect(toTankInfo(s, 0)).toMatchObject({ allowed: false }); // full again
  });
});

describe("nursery: growing up", () => {
  it("fed, a little one earns a point a minute and a polyp buds into an ephyra in the bowl", () => {
    const s = createState(fullTank({ nursery: nursery(jelly(0, 0, { name: "Kiki", anchor: 2, gp: 3, care: CARE_SECONDS - 1 })) }, 0), seeded());
    const ev = run(s, 2);
    const grew = of(ev, "grew");
    expect(grew).toEqual([{ type: "grew", slot: 0, stage: 1, nursery: true }]);
    expect(of(ev, "earned").some((e) => e.nursery && e.slot === 0)).toBe(true);
    expect(s.nursery!.slots[0]).toMatchObject({ g: 1, mode: "swim", anchor: -1 });
  });

  it("grown enough for a juvenile: it moves to the tank by itself and grows up there", () => {
    const save = fullTank({ nursery: nursery(jelly(0, 1, { name: "Nemo", gp: GROWTH[2] - 1, care: CARE_SECONDS - 0.5 })) }, 0);
    save.slots[1] = null; // room
    const s = createState(save, seeded());
    const ev = run(s, 1);
    const out = of(ev, "nurseryOut");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: 0, auto: true });
    const grew = of(ev, "grew").find((e) => !e.nursery);
    expect(grew).toMatchObject({ slot: out[0]!.slot, stage: 2 });
    expect(s.slots[out[0]!.slot!]).toMatchObject({ name: "Nemo", g: 2 });
    expect(nurseryCount(s)).toBe(0);
  });

  it("with the tank full it waits, ready, its growth held, and goes as soon as there's room", () => {
    const s = createState(fullTank({ nursery: nursery(jelly(0, 1, { name: "Nemo", gp: GROWTH[2] - 1, care: CARE_SECONDS - 0.5 })) }, 0), seeded());
    let ev = run(s, 1);
    expect(of(ev, "nurseryReady")).toEqual([{ type: "nurseryReady", slot: 0 }]);
    expect(nurseryInfo(s, 0)).toMatchObject({ ready: true, g: 1 });
    ev = run(s, 3 * 60); // three more minutes of care
    expect(of(ev, "nurseryReady")).toHaveLength(0); // said once
    expect(s.nursery!.slots[0]!.gp).toBe(GROWTH[2]); // held
    expect(view(s).nurReady).toBe(1);
    expect(view(s).nr0o).toBe(1);
    s.slots[1] = null;
    ev = run(s, 0.2);
    expect(of(ev, "nurseryOut")).toHaveLength(1);
    expect(nurseryCount(s)).toBe(0);
    expect(view(s).nurReady).toBe(0);
  });

  it("the journal knows a nursery baby from birth, and counts it raised once it's grown (in the tank)", () => {
    const s = createState(tank([jelly(7, 3, { name: "Hat", content: BABY_SECONDS, fullness: 0.95, affection: 0.95 }), jelly(1, 2, { name: "Tofu" }), jelly(4, 0, { name: "Pip", anchor: 0 })], { nursery: nursery() }), seeded());
    s.journal[7] = { seen: true, raised: 1, firstAdultAt: T, firstName: "Hat", morphSeen: 0, traitSeen: 0 };
    run(s, 0.5);
    expect(s.nursery!.slots[0]?.k).toBe(7);
    expect(journal(s)[7]!.raised).toBe(1);
    // grown (fast-forwarded): out to the tank, then on to adult there
    s.slots[1] = null;
    s.nursery!.slots[0]!.gp = GROWTH[2];
    s.nursery!.slots[0]!.g = 1;
    s.nursery!.slots[0]!.mode = "swim";
    run(s, 0.2);
    const n = s.slots.findIndex((j) => j?.k === 7 && j.g === 2);
    expect(n).toBeGreaterThanOrEqual(0);
    s.slots[n]!.gp = GROWTH[3];
    run(s, 0.2);
    expect(journal(s)[7]!.raised).toBe(2);
  });
});

describe("nursery: the open bowl", () => {
  it("opens and closes (the zoom eases; reduce motion snaps), and the shop shuts it", () => {
    const s = createState(fullTank({ nursery: nursery(jelly(0, 0, { anchor: 0, name: "Kiki" })) }, 0), seeded());
    expect(openNursery(s)).toBe(true);
    run(s, 0.1);
    expect(s.nursery!.e).toBeGreaterThan(0);
    expect(s.nursery!.e).toBeLessThan(1);
    run(s, 0.5);
    expect(s.nursery!.e).toBe(1);
    expect(view(s)).toMatchObject({ nurOpen: 1, nurBowl: 0, nurX: NURSERY.cx, nurY: NURSERY.cy, nurS: 1 });
    openShop(s);
    expect(isNurseryOpen(s)).toBe(false);
    expect(openNursery(s)).toBe(false); // not while the shop is up
    run(s, 1);
    expect(view(s).nurBowl).toBe(0); // hidden under the shop
    const calm = createState(fullTank({ nursery: nursery() }, 0), seeded());
    setReducedMotion(calm, true);
    openNursery(calm);
    run(calm, 1 / 30);
    expect(calm.nursery!.e).toBe(1);
    closeNursery(calm);
    run(calm, 1 / 30);
    expect(calm.nursery!.e).toBe(0);
    expect(view(calm)).toMatchObject({ nurOpen: 0, nurBowl: 1, nurS: zoomAt(0).s });
  });

  it("food sprinkled in the bowl sinks and is eaten there; the tank's food is untouched", () => {
    const s = createState(fullTank({ nursery: nursery(jelly(0, 0, { anchor: 1, name: "Kiki", fullness: 0.3 })) }, 0), seeded());
    expect(nurserySprinkle(s, NURSERY.cx, NURSERY.cy)).toBe(0); // closed
    openNursery(s);
    run(s, 0.5);
    const a = NURSERY.anchors[1]!;
    const p = fromBowl(a.x, a.y - 100);
    let n = 0;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 6; i++) {
      n += nurserySprinkle(s, p.x, p.y);
      ev.push(...run(s, 0.4));
    }
    expect(n).toBeGreaterThan(0);
    expect(s.food.every((f) => f.state === "off")).toBe(true);
    ev.push(...run(s, 15));
    expect(of(ev, "ate").filter((e) => e.nursery && e.slot === 0).length).toBeGreaterThan(0);
    expect(s.nursery!.slots[0]!.fullness).toBeGreaterThan(0.3);
    expect(nurseryFeed(s, 0)).toBeGreaterThan(0); // the keyboard's F, over it
  });

  it("taps: on a little one it's petted; off the bowl the close-up closes", () => {
    const s = createState(fullTank({ nursery: nursery(jelly(0, 0, { anchor: 0, name: "Kiki", affection: 0.2 })) }, 0), seeded());
    openNursery(s);
    run(s, 0.5);
    const c = nurseryCentre(s, 0)!;
    expect(nurseryAt(s, c.x, c.y)).toBe(0);
    expect(nurseryTap(s, c.x, c.y)).toBe("pet");
    expect(s.nursery!.slots[0]!.affection).toBeGreaterThan(0.2);
    expect(nurseryTap(s, NURSERY.cx, NURSERY.cy - 30)).toBe("call");
    expect(nurseryTap(s, 20, 1000)).toBe("close");
    expect(isNurseryOpen(s)).toBe(false);
  });
});

describe("nursery: saves, time away and share codes", () => {
  const withBowl = () =>
    fullTank({ nursery: nursery(jelly(0, 0, { name: "Kiki", anchor: 2, gp: 1, fullness: 0.8 }), null, jelly(5, 1, { name: "Nemo", gp: 9, fullness: 0.7, morph: 1 })) }, 0);

  it("round-trips through a save; absent stays absent; a damaged one is repaired", () => {
    const s = createState(withBowl(), seeded());
    const saved = toSave(s, T);
    expect(saved.nursery?.slots.map((j) => j && [j.name, j.k, j.g, j.anchor])).toEqual([["Kiki", 0, 0, 2], null, ["Nemo", 5, 1, -1], null]);
    const again = createState(loadGame(JSON.stringify(saved), T).save, seeded());
    expect(toSave(again, T)).toEqual(saved);
    expect(toSave(createState(fullTank(), seeded()), T).nursery).toBeUndefined();
    expect(loadGame(JSON.stringify({ ...saved, nursery: "junk" }), T).save.nursery).toBeUndefined();
    const fixed = loadGame(JSON.stringify({ ...saved, nursery: { slots: [{ k: 1, g: 3, name: "Big", gp: 40 }, { k: 0, g: 0, anchor: 2 }, { k: 0, g: 0, anchor: 2 }] } }), T).save.nursery!;
    expect(fixed.slots[0]).toMatchObject({ g: 1, gp: GROWTH[2] }); // no adults in the bowl
    expect(fixed.slots[1]!.anchor).not.toBe(fixed.slots[2]!.anchor);
  });

  it("time away ages the bowl like the tank, growth held at the move-out mark", () => {
    const save = toSave(createState(withBowl(), seeded()), T);
    const after = applyAway(save, T + 6 * HOUR);
    const [a, , b] = after.nursery!.slots;
    expect(a!.fullness).toBeLessThan(0.8);
    expect(a!.gp).toBeGreaterThan(1);
    expect(b!.gp).toBeLessThanOrEqual(GROWTH[2]);
    const away = loadGame(JSON.stringify(save), T + 6 * HOUR).away!;
    expect(away.lines.join(" ")).toMatch(/nursery|Kiki|Nemo/);
  });

  it("3 h hidden gives the same save as closing the tab and opening it 3 h later, nursery included", () => {
    const a = createState(withBowl(), seeded(7));
    const b = createState(withBowl(), seeded(7));
    run(a, 60, 1 / 60);
    run(b, 60, 1 / 60);
    const hiddenAt = a.clock;
    const back = hiddenAt + 3 * HOUR;
    const reopened = loadGame(JSON.stringify(toSave(a, hiddenAt)), back);
    const fromReload = toSave(createState(reopened.save, seeded(9)), back);
    const away = catchUp(b, hiddenAt, back);
    const fromHidden = toSave(b, back);
    expect(fromHidden).toEqual(fromReload);
    expect(fromHidden.nursery).toBeDefined();
    expect(away).toEqual(reopened.away);
    expect(b.nursery!.slots[0]!.fullness).toBeLessThan(a.nursery!.slots[0]!.fullness);
  });

  it("share codes leave the nursery out (backups are the whole save, so they keep it)", () => {
    const s = createState(withBowl(), seeded());
    const plain = createState(fullTank({}, 0), seeded());
    expect(exportTank(s)).toBe(exportTank(plain));
    expect(importTank(exportTank(s), T)!.nursery).toBeUndefined();
    expect(JSON.parse(JSON.stringify(toSave(s, T))).nursery.slots[0].name).toBe("Kiki");
  });
});

describe("nursery: keys and words", () => {
  it("U opens the nursery; its events are said with the bowl's names", () => {
    expect(keyAction({ key: "u" }, { onCanvas: false, shopOpen: false })).toEqual({ kind: "nursery" });
    expect(keyAction({ key: "U" }, { onCanvas: true, shopOpen: false })).toEqual({ kind: "nursery" });
    expect(keyAction({ key: "u" }, { onCanvas: true, shopOpen: true })).toBeNull();
    const tankJ = { name: "Mochi", k: 0, g: 2 };
    const bowlJ = { name: "Kiki", k: 0, g: 0 };
    const look = (_slot: number, inBowl?: boolean) => (inBowl ? bowlJ : tankJ);
    expect(eventWords({ type: "baby", slot: 0, nursery: true }, look)?.text).toMatch(/born in the nursery: Kiki/);
    expect(eventWords({ type: "grew", slot: 0, nursery: true }, () => ({ name: "Kiki", k: 0, g: 1 }))?.text).toBe("Kiki budded into a baby moon jelly in the nursery.");
    expect(eventWords({ type: "nurseryIn", slot: 1 }, look)?.text).toBe("Kiki moved into the nursery.");
    expect(eventWords({ type: "nurseryOut", slot: 3, auto: true }, look)?.text).toBe("Mochi is big enough for the tank and moved in.");
    expect(eventWords({ type: "nurseryReady", slot: 2 }, look)?.text).toMatch(/Kiki is ready for the tank/);
    expect(eventWords({ type: "ate", slot: 0, nursery: true }, look)).toMatchObject({ text: "Kiki ate.", low: true });
  });
});

describe("nursery: the view", () => {
  it("writes exactly the contract's props, with or without a bowl, open or not", () => {
    const states = [createState(fullTank(), seeded()), createState(fullTank({ nursery: nursery(jelly(0, 0, { anchor: 0 }), jelly(3, 1, { name: "Combo" })) }), seeded())];
    openNursery(states[1]!);
    run(states[1]!, 0.2);
    nurserySprinkle(states[1]!, NURSERY.cx, NURSERY.cy);
    for (const s of states) {
      const v = view(s);
      expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
      expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
      for (const [k, x] of Object.entries(v)) expect(Number.isFinite(x), k).toBe(true);
    }
    for (const name of nurseryProps()) expect(K.props).toContain(name);
    expect(nurseryProps().filter((p) => p.startsWith("nf")).length).toBe(NUR_FOOD_N * 6);
    const none = view(states[0]!);
    // no bowl: all quiet (the zoom sits on the hanging bowl's spot; an unused pellet is a flake, as in the tank)
    for (const name of nurseryProps().filter((p) => !/^nur[SXY]$|^nf\d+k0$/.test(p))) expect(none[name], name).toBe(0);
    const open = view(states[1]!);
    expect(open.nj0on).toBe(1);
    expect(open.nj1k3).toBe(1);
    expect(open.nj2on).toBe(0);
  });
});
