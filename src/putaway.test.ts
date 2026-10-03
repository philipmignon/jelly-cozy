/**
 * v15: putting decorations away (the drawer while dragging, the shop card), placing them where there's room,
 * the overlap outlines, the optional `stored` save field, share codes, and reduce motion's `calm` for the .riv.
 */
import { describe, expect, it } from "vitest";
import { BUBBLER, CLAM, DECOR_N, KEEP_DECOR0 } from "./species";
import {
  DECOR,
  DRAWER,
  K,
  bubbleColumn,
  buy,
  clearSpotFor,
  createState,
  decorAt,
  decorBaseY,
  decorOverlaps,
  dropDecor,
  exportTank,
  importTank,
  journalFrom,
  liftDecor,
  loadSave,
  moveDecor,
  moveDecorScreen,
  openShop,
  overDrawer,
  pearlShowing,
  placeDecor,
  placed,
  putAway,
  screenToWorld,
  setReducedMotion,
  step,
  storedDecor,
  toSave,
  view,
  type Save,
  type SaveJelly,
  type State,
} from "./sim";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const NOON = new Date(2026, 9, 1, 12).getTime();
const run = (s: State, seconds: number, dt = 1 / 60) => {
  for (let i = 0; i < seconds / dt; i++) step(s, dt);
};
const moon: SaveJelly = { k: 0, g: 3, gp: 30, care: 0, fullness: 0.7, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 0 };
const owned = (...ds: number[]) => Array.from({ length: DECOR_N }, (_, d) => ds.includes(d));
const tank = (extra: Partial<Save> = {}): Save => ({
  v: 12, foods: [true, false, false], themes: [true, false, false, false, false], theme: 0,
  slots: [moon, null, null, null, null, null, null],
  dollars: 0, murk: 0, spots: [], night: false, lamp: null,
  owned: owned(), helpers: [false, false, false], decorX: DECOR.map((d) => d.x),
  pearlDay: "", lastSeen: NOON, tier: 0, cam: 0, journal: journalFrom([moon], 0),
  ...extra,
});
/** the middle of decoration n (world), for decorAt */
const mid = (s: State, n: number) => ({ x: s.decorX[n]!, y: decorBaseY(s, n) - DECOR[n]!.h / 2 });
/** the shop item that sells (or awards) decoration d */
const itemOf = (d: number) => [3, 4, 5, 6, 7, 24, 25, 26, 27, 28, 29][[0, 1, 2, 3, 4, BUBBLER, 5, 6, 7, 8, 9].indexOf(d)]!;
const drawerMid = { x: DRAWER.x + DRAWER.w / 2, y: DRAWER.y + 20 };

describe("put away: the rules", () => {
  it("a put-away decoration is still owned but out of the tank: not drawn, not hit, no pearl, no column", () => {
    const s = createState(tank({ owned: owned(0, CLAM, BUBBLER) }), seeded());
    expect(pearlShowing(s)).toBe(true);
    const c = mid(s, 0);
    expect(decorAt(s, c.x, c.y)).toBe(0);
    expect(putAway(s, 0) && putAway(s, CLAM) && putAway(s, BUBBLER)).toBe(true);
    expect(s.owned[0] && s.owned[CLAM] && s.owned[BUBBLER]).toBe(true);
    expect(placed(s, 0)).toBe(false);
    expect(decorAt(s, c.x, c.y)).toBe(-1);
    expect(liftDecor(s, 0)).toBe(false);
    expect(pearlShowing(s)).toBe(false);
    expect(bubbleColumn(s)).toBeNull();
    const v = view(s);
    expect([v.dec0, v[`dec${CLAM}`], v[`dec${BUBBLER}`], v.pearl]).toEqual([0, 0, 0, 0]);
    expect(storedDecor(s)).toEqual([0, CLAM, BUBBLER]);
    // only what's in the tank can be put away; only what's in the drawer can be placed
    expect(putAway(s, 0)).toBe(false);
    expect(putAway(s, 1)).toBe(false);
    expect(placeDecor(s, 1)).toBe(false);
    expect(placeDecor(s, 0)).toBe(true);
    expect(placeDecor(s, 0)).toBe(false);
    expect(view(s).dec0).toBe(1);
  });

  it("placing one again finds room: its own spot when that's free, else clear of what's on the sand", () => {
    const s = createState(tank({ owned: owned(0, 1, 2, 3, 4) }), seeded());
    putAway(s, 2);
    expect(placeDecor(s, 2)).toBe(true);
    expect(s.decorX[2]).toBe(clearSpotFor(s, 2));
    // its spot taken: the helmet lands somewhere else, overlapping less than it would have at home
    putAway(s, 2);
    moveDecor(s, 3, DECOR[2]!.x);
    const home = DECOR[2]!.x;
    placeDecor(s, 2);
    const overlap = (x: number) => Math.max(0, (DECOR[2]!.w + DECOR[3]!.w) / 2 - Math.abs(x - s.decorX[3]!));
    expect(overlap(s.decorX[2]!)).toBeLessThan(overlap(home));
    expect(s.fx).not.toBeNull(); // a sparkle where it landed
  });

  it("buying a decoration lands it where there's room (its own spot on an empty sand)", () => {
    const s = createState(tank({ dollars: 500, owned: owned() }), seeded());
    expect(buy(s, 3)).toBe("bought");
    expect(s.decorX[0]).toBe(DECOR[0]!.x);
    // the helmet's spot is taken by the castle: it goes elsewhere
    moveDecor(s, 0, DECOR[2]!.x);
    expect(buy(s, 5)).toBe("bought");
    expect(s.decorX[2]).not.toBe(DECOR[2]!.x);
  });

  it("the shop card swaps it: put away, then placed again, never charged; the badges follow", () => {
    const s = createState(tank({ dollars: 10, owned: owned(1, KEEP_DECOR0) }), seeded());
    openShop(s);
    for (const d of [1, KEEP_DECOR0]) {
      const i = itemOf(d);
      expect([view(s)[`own${i}`], view(s)[`away${i}`], view(s)[`lock${i}`]]).toEqual([1, 0, 0]);
      expect(buy(s, i)).toBe("putAway");
      expect([view(s)[`own${i}`], view(s)[`away${i}`], view(s)[`lock${i}`]]).toEqual([0, 1, 0]);
      expect(buy(s, i)).toBe("placed");
      expect(view(s)[`own${i}`]).toBe(1);
    }
    expect(s.dollars).toBe(10);
    expect(s.shop.open).toBe(true); // the shop stays open for both
  });
});

describe("put away: the drawer while dragging", () => {
  it("shows while a decoration is carried; over it the decoration stays put, fades, and a drop puts it away", () => {
    const s = createState(tank({ owned: owned(0, 2) }), seeded());
    expect(view(s).storeO).toBe(0);
    expect(liftDecor(s, 2)).toBe(true);
    run(s, 0.3);
    let v = view(s);
    expect(v.storeO).toBe(1);
    expect(v.storeY).toBe(0);
    expect(v.storeHot).toBe(0);
    moveDecorScreen(s, 2, 300, 900);
    expect(s.decorX[2]).toBe(300);
    expect(overDrawer(drawerMid.x, drawerMid.y)).toBe(true);
    moveDecorScreen(s, 2, drawerMid.x, drawerMid.y);
    v = view(s);
    expect(v.storeHot).toBe(1);
    expect(v.dec2).toBeLessThan(1);
    expect(s.decorX[2]).toBe(300); // it doesn't follow the finger into the cabinet
    expect(dropDecor(s)).toBe("stored");
    expect(s.stored[2]).toBe(true);
    expect(view(s).dec2).toBe(0);
    run(s, 0.3);
    expect(view(s).storeO).toBe(0);
  });

  it("moving off the drawer again and letting go just sets it down", () => {
    const s = createState(tank({ owned: owned(2) }), seeded());
    liftDecor(s, 2);
    moveDecorScreen(s, 2, drawerMid.x, drawerMid.y);
    moveDecorScreen(s, 2, 420, 950);
    expect(view(s).storeHot).toBe(0);
    expect(dropDecor(s)).toBe("placed");
    expect(placed(s, 2)).toBe(true);
    expect(s.decorX[2]).toBe(420);
    expect(dropDecor(s)).toBeNull();
  });

  it("the drop box lies below the water, clear of the edges that scroll the tank", () => {
    expect(DRAWER.y).toBeGreaterThanOrEqual(K.waterBot);
    expect(DRAWER.x).toBeGreaterThan(K.glassL + 84);
    expect(DRAWER.x + DRAWER.w).toBeLessThan(K.glassR - 84);
    expect(overDrawer(drawerMid.x, K.waterBot - 30)).toBe(false); // a finger on a decoration at the bottom of the sand
  });

  it("reduce motion: the drawer is just there, no slide", () => {
    const s = createState(tank({ owned: owned(0) }), seeded());
    setReducedMotion(s, true);
    liftDecor(s, 0);
    step(s, 1 / 60);
    expect([view(s).storeO, view(s).storeY]).toEqual([1, 0]);
  });

  it("the decorations the carried one overlaps light their outlines", () => {
    const s = createState(tank({ owned: owned(0, 2, 3) }), seeded());
    expect(decorOverlaps(s)).toEqual([]);
    liftDecor(s, 2);
    moveDecor(s, 2, s.decorX[3]!);
    expect(decorOverlaps(s)).toContain(3);
    const v = view(s);
    expect(v.dec3ov).toBe(1);
    expect(v.dec2ov).toBe(0);
    moveDecor(s, 2, 660);
    expect(decorOverlaps(s)).not.toContain(3);
    dropDecor(s);
    expect(view(s).dec3ov).toBe(0);
  });
});

describe("put away: saves and share codes", () => {
  it("an older save (no `stored`) has every owned decoration placed; the field is only written while one is away", () => {
    const old = tank({ owned: owned(0, 1) });
    const s = createState(loadSave(JSON.stringify(old), NOON), seeded());
    expect(placed(s, 0) && placed(s, 1)).toBe(true);
    expect("stored" in toSave(s, NOON)).toBe(false);
    putAway(s, 1);
    const save = toSave(s, NOON);
    expect(save.v).toBe(12);
    expect(save.stored).toEqual(owned(1));
    const back = createState(loadSave(JSON.stringify(save), NOON), seeded());
    expect(placed(back, 0)).toBe(true);
    expect(back.stored[1]).toBe(true);
    expect(back.owned[1]).toBe(true);
    placeDecor(back, 1);
    expect("stored" in toSave(back, NOON)).toBe(false);
  });

  it("a damaged `stored` is ignored; one not owned can't be away", () => {
    const bad = { ...tank({ owned: owned(0) }), stored: [true, true, "x"] };
    const s = createState(loadSave(JSON.stringify(bad), NOON), seeded());
    expect(s.stored[0]).toBe(true);
    expect(s.stored[1]).toBe(false);
    expect(loadSave(JSON.stringify({ ...tank(), stored: "yes" }), NOON).stored).toBeUndefined();
  });

  it("v12: a v11 save (no stored, no visitorsSeen) loads with everything placed and an empty visitor log", () => {
    const v11 = { ...tank({ owned: owned(0, CLAM), dollars: 42 }), v: 11 } as Record<string, unknown>;
    const save = loadSave(JSON.stringify(v11), NOON);
    expect(save.v).toBe(12);
    expect(save.dollars).toBe(42);
    expect(save.owned).toEqual(owned(0, CLAM));
    expect("stored" in save).toBe(false);
    expect("visitorsSeen" in save).toBe(false);
    const s = createState(save, seeded());
    expect(placed(s, 0) && placed(s, CLAM)).toBe(true);
    expect(storedDecor(s)).toEqual([]);
    expect(s.visitorsSeen).toEqual({});
    // every version from 2 to 12 loads except 6 (never written); 6 and 13 are a new game
    for (const v of [2, 3, 4, 5, 7, 8, 9, 10, 11, 12]) expect(loadSave(JSON.stringify({ ...tank({ dollars: 42 }), v }), NOON).dollars, `v${v}`).toBe(42);
    for (const v of [6, 13]) expect(loadSave(JSON.stringify({ ...tank({ dollars: 42 }), v }), NOON).dollars, `v${v}`).not.toBe(42);
  });

  it("share codes leave put-away decorations out", () => {
    const s = createState(tank({ owned: owned(0, CLAM, BUBBLER) }), seeded());
    putAway(s, CLAM);
    putAway(s, BUBBLER);
    const seen = importTank(exportTank(s), NOON)!;
    expect(seen.owned).toEqual(owned(0));
  });
});

describe("calm: reduce motion inside the .riv", () => {
  it("view writes calm from the reduce motion setting", () => {
    const s = createState(tank(), seeded());
    expect(view(s).calm).toBe(0);
    setReducedMotion(s, true);
    expect(view(s).calm).toBe(1);
    expect(K.props).toContain("calm");
  });

  it("dragging still works in world terms after a pan", () => {
    const s = createState(tank({ owned: owned(0), tier: 2, cam: -360 }), seeded());
    liftDecor(s, 0);
    moveDecorScreen(s, 0, 360, 900);
    expect(s.decorX[0]).toBe(screenToWorld(s, 360));
  });
});
