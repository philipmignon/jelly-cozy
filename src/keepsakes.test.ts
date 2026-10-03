import { describe, expect, it } from "vitest";
import { KEEPSAKE_N, MILESTONES, countDay, keepFacts, keepOf, newlyReached, progressOf, seedKeep, type KeepSave } from "./keepsakes";
import { DECOR_N, KEEP_DECOR0, SPECIES_N, TAB_ITEMS, THEME_N, keepsakeOf } from "./species";
import { CODE_VERSION, CODE_VERSION_V5, decodeTank } from "./tankcode";
import {
  DECOR,
  K,
  SHOP_ITEMS,
  SHOP_SCROLLS,
  buy,
  createState,
  dayKey,
  exportTank,
  importTank,
  inShopView,
  journalFrom,
  keepsakes,
  keepsakesAtLoad,
  loadGame,
  openShop,
  scrollShop,
  setTab,
  step,
  toSave,
  view,
  type JournalEntry,
  type Save,
  type SaveJelly,
  type SimEvent,
  type SimOptions,
  type Species,
  type Stage,
  type State,
} from "./sim";

/** local wall-clock times, so day counting doesn't depend on the machine's time zone */
const at = (day: number, h = 12, m = 0) => new Date(2026, 9, day, h, m).getTime();
const NOON = at(2);
const ON: SimOptions = { keepsakes: true };

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
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 0.8, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: NOON, content: 0, morph: 0, ...extra,
});
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 12, foods: [true, false, false], themes: [true, false, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null, owned: Array.from({ length: DECOR_N }, () => false), helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: NOON, tier: 0, cam: 0, journal: journalFrom(slots, NOON), ...extra,
});
/** A journal with `raised` adults of the first `kinds` species, and a morph seen on species 0 if `morph`. */
const journalOf = (kinds: number, morph = false): JournalEntry[] =>
  Array.from({ length: SPECIES_N }, (_, k) => ({
    seen: k < kinds || (morph && k === 0),
    raised: k < kinds ? 1 : 0,
    firstAdultAt: k < kinds ? NOON : null,
    firstName: k < kinds ? "Mochi" : null,
    morphSeen: morph && k === 0 ? 1 : 0,
    traitSeen: 0,
  }));
const keep = (extra: Partial<KeepSave> = {}): KeepSave => ({ earned: 0, days: 1, lastDay: dayKey(NOON), requests: 0, ...extra });
const keepsakeEvents = (ev: SimEvent[]) => ev.filter((e) => e.type === "keepsake").map((e) => e.keepsake);

describe("v13 keepsakes: the milestones", () => {
  it("each milestone leaves one keepsake shop item that says it's that milestone's", () => {
    expect(MILESTONES.map((m) => m.item)).toEqual([25, 26, 27, 28, 29, 30]);
    MILESTONES.forEach((m, i) => expect(keepsakeOf(SHOP_ITEMS[m.item])).toBe(i));
    expect(SHOP_ITEMS.flatMap((it, i) => (keepsakeOf(it) >= 0 ? [i] : []))).toEqual(MILESTONES.map((m) => m.item));
    // decorations 5..9 and theme 4; a keepsake is never priced, and every keepsake card sits on DECOR or TANK
    expect(MILESTONES.slice(0, 5).map((m) => SHOP_ITEMS[m.item])).toEqual([0, 1, 2, 3, 4].map((n) => expect.objectContaining({ kind: "decor", d: KEEP_DECOR0 + n, price: 0 })));
    expect(SHOP_ITEMS[30]).toMatchObject({ kind: "theme", theme: THEME_N - 1, price: 0 });
    for (const m of MILESTONES) expect(TAB_ITEMS[1]!.includes(m.item) || TAB_ITEMS[3]!.includes(m.item)).toBe(true);
    expect(KEEPSAKE_N).toBe(6);
  });

  it("progress comes from the journal and the two counts, capped at the target", () => {
    const f = keepFacts(journalOf(2, true), keep({ days: 3, requests: 12 }));
    expect(f).toEqual({ adults: 2, kinds: 2, morphs: 1, days: 3, requests: 12 });
    expect(MILESTONES.map((_, m) => progressOf(m, f))).toEqual([1, 2, 1, 3, 10, 2]);
    expect(newlyReached(keep(), f)).toEqual([0, 2, 4]);
    expect(newlyReached(keep({ earned: 0b101 }), f)).toEqual([4]);
  });

  it("days count once each, going forward only", () => {
    const k = keep({ days: 0, lastDay: "" });
    expect(countDay(k, "2026-10-02")).toBe(true);
    expect(countDay(k, "2026-10-02")).toBe(false);
    expect(countDay(k, "2026-10-01")).toBe(false); // a clock set back doesn't count again
    expect(countDay(k, "2026-10-05")).toBe(true); // distinct days, not consecutive
    expect(k).toMatchObject({ days: 2, lastDay: "2026-10-05" });
  });

  it("repairs a saved keep, and seeds one from the days a save can prove", () => {
    expect(keepOf(undefined)).toBeNull();
    expect(keepOf({ earned: 1e9, days: -3, lastDay: "soon", requests: "x" })).toEqual({ earned: 0b111111, days: 0, lastDay: "", requests: 0 });
    expect(seedKeep(["2026-10-01", "2026-09-28", "2026-10-01", "nope"], 2)).toEqual({ earned: 0, days: 2, lastDay: "2026-10-01", requests: 2 });
  });
});

describe("v13 keepsakes in the tank", () => {
  it("an old save that already reached milestones gets them all at load, quietly, as one list", () => {
    // all nine raised, a rare colour seen, jellies born on three different days; no `keep` field (a v12 save)
    const save = tank([jelly(0, 3, { born: at(1) }), jelly(1, 3, { born: at(2) })], { journal: journalOf(SPECIES_N, true), lastSeen: at(4) });
    const s = createState(loadGame(JSON.stringify(save), at(4)).save, seeded(), ON);
    expect(keepsakesAtLoad(s)).toEqual([0, 1, 2, 5]);
    expect(s.owned.slice(KEEP_DECOR0, KEEP_DECOR0 + 5)).toEqual([true, true, true, false, false]); // bottle, lighthouse, lantern
    expect(s.themes[4]).toBe(true);
    expect(s.theme).toBe(0); // owned, not applied
    expect(s.keep).toMatchObject({ days: 3, requests: 0, earned: 0b100111 });
    expect(keepsakeEvents(run(s, 1))).toEqual([]); // no popups: the host shows one summary
    // saved and loaded again: nothing new, nothing twice
    const again = createState(loadGame(JSON.stringify(toSave(s, at(4, 13))), at(4, 13)).save, seeded(), ON);
    expect(keepsakesAtLoad(again)).toEqual([]);
    expect(keepsakeEvents(run(again, 1))).toEqual([]);
    expect(again.owned.slice(KEEP_DECOR0, KEEP_DECOR0 + 5)).toEqual([true, true, true, false, false]);
  });

  it("a milestone reached in play grants its keepsake once, with an event and a sparkle on it", () => {
    // a juvenile with enough growth for adult: it grows up on the first step
    const s = createState(tank([jelly(0, 2, { gp: 30 })], { keep: keep() }), seeded(), ON);
    expect(keepsakesAtLoad(s)).toEqual([]);
    expect(s.owned[KEEP_DECOR0]).toBe(false);
    const ev = run(s, 0.5);
    expect(ev.some((e) => e.type === "adult")).toBe(true);
    expect(keepsakeEvents(ev)).toEqual([0]);
    expect(s.owned[KEEP_DECOR0]).toBe(true);
    expect(s.fx).toMatchObject({ x: DECOR[KEEP_DECOR0]!.x });
    expect(view(s)[`dec${KEEP_DECOR0}`]).toBe(1);
    expect(keepsakeEvents(run(s, 2))).toEqual([]);
    expect(toSave(s, NOON).keep).toMatchObject({ earned: 1 });
  });

  it("finished requests and new days count towards theirs", () => {
    const s = createState(tank([jelly(0, 2)], { keep: keep({ requests: 9, days: 6, lastDay: dayKey(at(1)) }) }), seeded(), ON);
    // loading on a new day is the seventh: the ship's wheel, at load
    expect(keepsakesAtLoad(s)).toEqual([3]);
    s.queued.push({ type: "requestDone", request: 0, amount: 5 });
    expect(keepsakeEvents(run(s, 0.1))).toEqual([4]);
    expect(s.keep).toMatchObject({ requests: 10, days: 7 });
    expect(s.owned.slice(KEEP_DECOR0, KEEP_DECOR0 + 5)).toEqual([false, false, false, true, true]);
  });

  it("a day turning over in play counts too", () => {
    const s = createState(tank([jelly(0, 2)], { keep: keep({ days: 6 }), lastSeen: at(2, 23, 59) }), seeded(), ON);
    expect(keepsakesAtLoad(s)).toEqual([]);
    expect(keepsakeEvents(run(s, 61))).toEqual([3]);
    expect(s.keep!.days).toBe(7);
  });

  it("read-only tanks (keepsakes off) never evaluate, grant or count anything", () => {
    const save = tank([jelly(0, 3)], { journal: journalOf(SPECIES_N, true) });
    const s = createState(save, seeded());
    expect(keepsakesAtLoad(s)).toEqual([]);
    expect(s.keep).toBeNull();
    expect(s.owned.slice(KEEP_DECOR0, KEEP_DECOR0 + 5).some(Boolean)).toBe(false);
    s.queued.push({ type: "requestDone", request: 0, amount: 5 });
    expect(keepsakeEvents(run(s, 1))).toEqual([]);
    expect(toSave(s, NOON).keep).toBeUndefined();
    // the journal page still shows how far along it is
    expect(keepsakes(s).map((r) => [r.progress, r.n, r.earned])).toEqual([[1, 1, false], [3, 3, false], [1, 1, false], [0, 7, false], [0, 10, false], [9, 9, false]]);
  });

  it("the journal rows: progress such as 2 of 3 kinds, and earned ones show done", () => {
    const s = createState(tank([jelly(0, 3)], { journal: journalOf(2), keep: keep({ days: 4, requests: 3 }) }), seeded(), ON);
    const rows = keepsakes(s);
    expect(rows.map((r) => `${r.progress}/${r.n}${r.earned ? " earned" : ""}`)).toEqual(["1/1 earned", "2/3", "0/1", "4/7", "3/10", "2/9"]);
    expect(rows[1]).toMatchObject({ title: "Raise three kinds of jelly", reward: "a little lighthouse" });
  });

  it("the shop: a keepsake isn't for sale until earned; then the theme is picked like a bought one", () => {
    const s = createState(tank([jelly(0, 2)], { dollars: 5000, keep: keep() }), seeded(), ON);
    openShop(s);
    const v = view(s);
    expect([25, 26, 27, 28, 29, 30].map((i) => v[`lock${i}`])).toEqual([1, 1, 1, 1, 1, 1]);
    expect([25, 26, 27, 28, 29, 30].map((i) => v[`own${i}`])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(buy(s, 26)).toBe("keepsake");
    expect(buy(s, 30)).toBe("keepsake");
    expect(s.dollars).toBe(5000);
    expect(s.owned[6]).toBe(false);
    expect(s.themes[4]).toBe(false);
    // earned (the lighthouse and the lagoon): bright cards, OWNED; the decoration is in, the theme can be used
    s.keep!.earned = 0b100010;
    s.owned[6] = true;
    s.themes[4] = true;
    const w = view(s);
    expect([w.lock26, w.own26, w.lock30, w.own30, w.use30]).toEqual([0, 1, 0, 1, 0]);
    expect(buy(s, 26)).toBe("putAway"); // v15: an earned keepsake can be put away like a bought decoration
    expect(s.owned[6]).toBe(true);
    expect(buy(s, 26)).toBe("placed");
    expect(buy(s, 30)).toBe("selected");
    expect(s.theme).toBe(4);
    expect(view(s).theme4).toBe(1);
    expect(s.dollars).toBe(5000);
  });

  it("a save without the field loads unchanged when keepsakes are off, and old fields still round-trip", () => {
    const save = tank([jelly(0, 3)]);
    const loaded = loadGame(JSON.stringify(save), NOON).save;
    expect(loaded.keep).toBeUndefined();
    const withKeep = loadGame(JSON.stringify({ ...save, keep: keep({ earned: 1, days: 5, requests: 4 }) }), NOON).save;
    expect(withKeep.keep).toEqual(keep({ earned: 1, days: 5, requests: 4 }));
  });
});

describe("v13 keepsakes: share codes and the shop's scrolling tabs", () => {
  it("a tank with keepsakes writes a version 5 code that round-trips; one without keeps its old code", () => {
    const plain = createState(tank([jelly(0, 3)]), seeded());
    const before = exportTank(plain);
    expect(decodeTank(before)!.decor.length).toBe(DECOR_N);
    expect(exportTank(createState(importTank(before, NOON)!, seeded()))).toBe(before);
    const fancy = createState(tank([jelly(0, 3)], { themes: [true, false, false, false, true], theme: 4 }), seeded());
    fancy.owned[6] = true;
    fancy.owned[0] = true;
    const code = exportTank(fancy);
    const bytes = Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(bytes[0]! >> 4).toBe(CODE_VERSION_V5);
    expect(Buffer.from(before.replace(/-/g, "+").replace(/_/g, "/"), "base64")[0]! >> 4).toBe(CODE_VERSION);
    const back = importTank(code, NOON)!;
    expect(back.theme).toBe(4);
    expect(back.owned[6]).toBe(true);
    expect(back.owned[0]).toBe(true);
    expect(exportTank(createState(back, seeded()))).toBe(code);
  });

  it("DECOR and TANK scroll now that the keepsakes joined them; taps outside the window don't count", () => {
    expect(SHOP_SCROLLS[1]?.max ?? 0).toBeGreaterThan(0);
    expect(SHOP_SCROLLS[3]?.max ?? 0).toBeGreaterThan(0);
    expect(SHOP_SCROLLS[2]).toBeNull();
    const s = createState(tank([jelly(0, 3)]), seeded());
    openShop(s);
    setTab(s, 1);
    scrollShop(s, -10_000);
    expect(s.shopScroll).toBe(SHOP_SCROLLS[1]!.max);
    const w = SHOP_SCROLLS[1]!;
    expect(view(s).shopScrollBar).toBe(Math.round((w.trackTop + w.trackH - w.thumbH) / K.P) * K.P);
    expect(inShopView(s, w.viewTop - 1)).toBe(false);
    setTab(s, 2);
    expect(s.shopScroll).toBe(0);
    scrollShop(s, -100);
    expect(s.shopScroll).toBe(0); // SUPPLIES fits: no scrolling
    expect(inShopView(s, 0)).toBe(true);
  });
});
