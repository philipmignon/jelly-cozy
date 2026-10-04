/**
 * Save version 13 (v16's features): a v12 save, written before lamp gels, temperature, sea glass, pairs, the nursery
 * and morph ids 3-5, loads as a v13 save with every new thing at its default, and a v13 save carrying them reads back.
 */
import { describe, expect, it } from "vitest";
import { createState, loadGame, toSave, SAVE_VERSION } from "./sim";
import { GEL_CLEAR } from "./gels";
import { TEMP_ROOM } from "./temperature";

const NOON = new Date(2026, 9, 3, 12).getTime();
const seeded = () => {
  let x = 7;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
};

/** What a v12 build wrote: no gels, gel, climate, finds, nursery, pair; morphs 0-2 only. */
const v12 = {
  v: 12,
  slots: [
    { k: 0, g: 3, gp: 30, care: 0, fullness: 0.8, affection: 0.6, anchor: -1, spot: -1, name: "Mochi", born: NOON - 864e5, content: 0, morph: 2, trait: 1 },
    { k: 0, g: 3, gp: 30, care: 0, fullness: 0.8, affection: 0.6, anchor: -1, spot: -1, name: "Pip", born: NOON - 864e5, content: 0, morph: 1, trait: 0 },
    null, null, null, null, null,
  ],
  dollars: 123,
  murk: 0,
  spots: [],
  night: false,
  lamp: null,
  owned: [false, false, false, true, false, false, false, false, false, false, false],
  helpers: [false, false, false],
  decorX: [],
  pearlDay: "",
  lastSeen: NOON,
  tier: 0,
  cam: 0,
  foods: [true, false, false],
  themes: [true, false, false, false, false],
  theme: 0,
};

describe("save v13", () => {
  it("SAVE_VERSION is 13", () => expect(SAVE_VERSION).toBe(13));

  it("a v12 save loads with the v16 features at their defaults", () => {
    const { save } = loadGame(JSON.stringify(v12), NOON);
    expect(save.v).toBe(13);
    expect(save.dollars).toBe(123);
    expect(save.slots.slice(0, 2).map((j) => j?.morph)).toEqual([2, 1]);
    for (const f of ["gels", "gel", "climate", "finds", "nursery"]) expect(f in save, f).toBe(false);
    const s = createState(save, seeded(), { finds: true, pairs: true });
    expect(s.gels.on).toBe(GEL_CLEAR);
    expect(s.gels.owned.filter(Boolean).length).toBe(1);
    expect([s.climate.heater, s.climate.chiller, s.climate.set, s.climate.temp]).toEqual([false, false, 0, TEMP_ROOM]);
    expect(s.finds).toBeNull();
    expect(s.nursery).toBeNull();
    expect(s.slots.filter(Boolean).map((j) => j!.pair)).toEqual([-1, -1]);
    // and it saves back as v13 without inventing the optional fields
    const out = toSave(s, NOON);
    expect(out.v).toBe(13);
    for (const f of ["gels", "gel", "climate", "finds", "nursery"]) expect(f in out, f).toBe(false);
  });

  it("a v12 save that somehow holds a newer morph id keeps it (3 frost, 4 dusk, 5 pearl are known now)", () => {
    const raw = { ...v12, slots: v12.slots.map((j, i) => (j && i === 0 ? { ...j, morph: 3 } : j)) };
    expect(loadGame(JSON.stringify(raw), NOON).save.slots[0]!.morph).toBe(3);
  });
});
