/**
 * Lamp gels (./gels.ts and their place in the sim): owned and on the lamp, saved, bought and picked from the shop,
 * stepped through on the wheel, and what the view writes (the tint layers, UV and what fluoresces).
 */
import { describe, expect, it } from "vitest";
import { GEL_BLUE, GEL_CLEAR, GEL_N, GEL_UV, GEL_WARM, anyGel, gelFields, gelWords, gelsOf, newGels, nextGel, setGel, uvLightOf } from "./gels";
import { eventWords, keyAction } from "./a11y";
import { DECOR_N, TAB_ITEMS } from "./species";
import {
  DECOR,
  K,
  SHOP_ITEMS,
  buy,
  createState,
  cycleGel,
  gelInfo,
  isShopOpen,
  journalFrom,
  loadGame,
  openShop,
  specProps,
  step,
  toSave,
  toggleLamp,
  useGel,
  view,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";

/** local noon: a test tank is never at night by the clock (wherever the machine is) */
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();
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
  v: 13, foods: [true, false, false], themes: [true, false, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 0, murk: 0, spots: [], night: false, lamp: null, owned: Array.from({ length: DECOR_N }, () => false), helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: NOON, tier: 0, cam: 0, journal: journalFrom(slots, NOON), ...extra,
});
const state = (extra: Partial<Save> = {}, slots: (SaveJelly | null)[] = [jelly(0, 3)]) => createState(tank(slots, extra), seeded());
const GEL_ITEM = [-1, 31, 32, 33];

describe("lamp gels: the pure part", () => {
  it("starts with only Clear, on the lamp", () => {
    const g = newGels();
    expect(g.owned).toEqual([true, false, false, false]);
    expect(g.on).toBe(GEL_CLEAR);
    expect(anyGel(g)).toBe(false);
    expect(gelFields(g)).toEqual({});
  });

  it("repairs a saved set: Clear always owned, an unowned or odd gel on the lamp falls back to Clear", () => {
    expect(gelsOf([false, true, false, true], 3)).toMatchObject({ owned: [true, true, false, true], on: 3 });
    expect(gelsOf([true, true], 2).on).toBe(GEL_CLEAR); // not owned
    expect(gelsOf([true, true], 1.5).on).toBe(GEL_CLEAR);
    expect(gelsOf([true, true], 9).on).toBe(GEL_CLEAR);
    expect(gelsOf("junk", "x")).toEqual(newGels());
    expect(gelsOf(undefined, undefined)).toEqual(newGels());
  });

  it("saves only what's worth saving: the owned list once one is bought, the gel while it isn't Clear", () => {
    const g = gelsOf([true, true, true, false], 0);
    expect(gelFields(g)).toEqual({ gels: [true, true, true, false] });
    setGel(g, GEL_BLUE);
    expect(gelFields(g)).toEqual({ gels: [true, true, true, false], gel: 2 });
    expect(gelsOf(gelFields(g).gels, gelFields(g).gel)).toMatchObject({ owned: g.owned, on: g.on });
  });

  it("the wheel steps through the owned gels and Clear, in order, wrapping", () => {
    const g = gelsOf([true, true, false, true], 0);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      setGel(g, nextGel(g));
      seen.push(g.on);
    }
    expect(seen).toEqual([GEL_WARM, GEL_UV, GEL_CLEAR, GEL_WARM]);
    expect(setGel(g, GEL_BLUE)).toBe(false); // not owned
    expect(setGel(g, -1)).toBe(false);
    expect(nextGel(newGels())).toBe(GEL_CLEAR); // nothing else to step to
  });

  it("UV light follows the lamp; any other gel has none", () => {
    const g = gelsOf([true, true, true, true], GEL_UV);
    expect(uvLightOf(g, 1)).toBe(1);
    expect(uvLightOf(g, 0.5)).toBe(0.5);
    expect(uvLightOf(g, 0)).toBe(0);
    setGel(g, GEL_WARM);
    expect(uvLightOf(g, 1)).toBe(0);
  });

  it("has words for the screen reader", () => {
    expect(gelWords(GEL_WARM)).toBe("Warm amber gel on the lamp.");
    expect(gelWords(GEL_CLEAR)).toBe("Clear lamp: no gel.");
    expect(eventWords({ type: "gel", gel: GEL_UV }, () => null)).toEqual({ text: "UV gel on the lamp.", low: false });
    expect(keyAction({ key: "g" }, { onCanvas: true, shopOpen: false })).toEqual({ kind: "gel" });
    expect(keyAction({ key: "G" }, { onCanvas: false, shopOpen: false })).toEqual({ kind: "gel" });
    expect(keyAction({ key: "g" }, { onCanvas: true, shopOpen: true })).toBeNull();
  });
});

describe("lamp gels in the tank", () => {
  it("are sold on the TANK tab as items 31-33, UV the dearest", () => {
    for (let n = 1; n < GEL_N; n++) {
      const it = SHOP_ITEMS[GEL_ITEM[n]!]!;
      expect(it.kind).toBe("gel");
      expect(it.kind === "gel" && it.gel).toBe(n);
      expect(TAB_ITEMS[3]).toContain(GEL_ITEM[n]);
    }
    expect(SHOP_ITEMS[33]!.price).toBeGreaterThan(SHOP_ITEMS[31]!.price);
    expect(SHOP_ITEMS[33]!.price).toBeGreaterThan(SHOP_ITEMS[32]!.price);
  });

  it("buying one puts it on the lamp and slides the shop shut; its card then switches it on and off", () => {
    const s = state({ dollars: 500 });
    openShop(s);
    expect(buy(s, 31)).toBe("bought");
    expect(s.dollars).toBe(500 - SHOP_ITEMS[31]!.price);
    expect(gelInfo(s)).toEqual({ on: GEL_WARM, owned: [true, true, false, false] });
    expect(isShopOpen(s)).toBe(false);
    expect(run(s, 0.1).filter((e) => e.type === "gel")).toEqual([{ type: "gel", gel: GEL_WARM }]);
    openShop(s);
    expect(buy(s, 31)).toBe("selected"); // the one on: off again
    expect(s.gels.on).toBe(GEL_CLEAR);
    expect(buy(s, 31)).toBe("selected");
    expect(s.gels.on).toBe(GEL_WARM);
    expect(s.dollars).toBe(500 - SHOP_ITEMS[31]!.price); // paid once
  });

  it("can't be bought without the dollars", () => {
    const s = state({ dollars: 10 });
    openShop(s);
    expect(buy(s, 33)).toBe("cantAfford");
    expect(s.gels.owned[GEL_UV]).toBe(false);
    expect(view(s).lock33).toBe(1);
  });

  it("the wheel steps through what's owned; with nothing bought it does nothing", () => {
    const none = state();
    expect(cycleGel(none)).toBe(-1);
    expect(view(none).haveGel).toBe(0);
    const s = state({ gels: [true, false, true, true] });
    expect(view(s).haveGel).toBe(1);
    expect([cycleGel(s), cycleGel(s), cycleGel(s)]).toEqual([GEL_BLUE, GEL_UV, GEL_CLEAR]);
    expect(view(s).gelPress).toBeGreaterThan(0); // the wheel bobs
    run(s, 0.3);
    expect(view(s).gelPress).toBe(0);
    expect(useGel(s, GEL_WARM)).toBe(false); // not owned
  });

  it("the view writes one gel at a time, the shop's badges, and UV only under the UV gel with the lamp on", () => {
    const s = state({ gels: [true, true, true, true], gel: GEL_UV }, [jelly(6, 3), null, jelly(3, 2)]);
    let v = view(s);
    expect([v.gel0, v.gel1, v.gel2, v.gel3]).toEqual([0, 0, 0, 1]);
    expect([v.use33, v.own33, v.own31, v.use31, v.lock31]).toEqual([1, 0, 1, 0, 0]);
    expect(v.uvLight).toBe(1);
    // every jelly reads uvLight from the World global view model: no per-slot copies any more
    expect([v.j0uv, v.j1uv, v.j2uv]).toEqual([undefined, undefined, undefined]);
    expect(K.globals?.props).toContain("uvLight");
    toggleLamp(s); // lights off: moonlight, no UV
    run(s, 2);
    v = view(s);
    expect(v.uvLight).toBe(0);
    expect(v.gel3).toBe(1); // still on the lamp (the .riv fades its layers with daylight)
    useGel(s, GEL_WARM);
    toggleLamp(s);
    run(s, 2);
    expect(view(s).uvLight).toBe(0);
  });

  it("writes exactly the contract's props with a gel on", () => {
    const s = state({ gels: [true, true, true, true], gel: GEL_BLUE, dollars: 99 });
    run(s, 0.5);
    const v = view(s);
    expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
    expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
    for (const [name, value] of Object.entries(v)) expect(Number.isFinite(value), name).toBe(true);
  });

  it("are saved and loaded (absent from a save that never bought one)", () => {
    const s = state({ dollars: 500 });
    openShop(s);
    buy(s, 32);
    const saved = toSave(s, NOON);
    expect(saved.gels).toEqual([true, false, true, false]);
    expect(saved.gel).toBe(GEL_BLUE);
    const back = createState(loadGame(JSON.stringify(saved), NOON + 60_000).save, seeded());
    expect(gelInfo(back)).toEqual({ on: GEL_BLUE, owned: [true, false, true, false] });
    const plain = toSave(state(), NOON);
    expect("gels" in plain).toBe(false);
    expect("gel" in plain).toBe(false);
    expect(gelInfo(createState(loadGame(JSON.stringify(plain), NOON).save, seeded())).on).toBe(GEL_CLEAR);
  });
});
