/**
 * Temperature (./temperature.ts and its place in the sim): the heater and the chiller, the water drifting to the
 * setting, each species' preference in mood and growth (never harm), time away, the thermometer and the units in
 * the view, saves, the card's and the journal's words, and the daily request.
 */
import { describe, expect, it } from "vitest";
import {
  TEMP_COOL,
  TEMP_GROW_BAD,
  TEMP_GROW_GOOD,
  TEMP_MOOD_BAD,
  TEMP_MOOD_GOOD,
  TEMP_PREF,
  TEMP_ROOM,
  TEMP_TAU,
  TEMP_WARM,
  climateField,
  climateOf,
  comfortOf,
  driftTemp,
  newClimate,
  prefWords,
  settingWords,
  settledWords,
  stepClimate,
  tempGrowth,
  tempMood,
  tempPhrase,
  toggleDevice,
  zoneOf,
} from "./temperature";
import { eventWords, keyAction } from "./a11y";
import { advance, planRequests, requestText, requestsOf, rewardOf } from "./requests";
import { DECOR_N, SPECIES_N, TAB_ITEMS } from "./species";
import {
  DECOR,
  K,
  SHOP_ITEMS,
  buy,
  climateInfo,
  createState,
  jellyInfo,
  journalFrom,
  loadGame,
  moodOf,
  openShop,
  requests,
  specProps,
  step,
  tapClimate,
  toSave,
  view,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";

const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const run = (s: State, seconds: number, fps = 60) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * fps; i++) events.push(...step(s, 1 / fps));
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
const state = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}, opts = {}) => createState(tank(slots, extra), seeded(), opts);
const MOON = 0 as Species;
const BLUBBER = 1 as Species;
const UPSIDE = 2 as Species;
const LION = 8 as Species;

describe("temperature: the pure part", () => {
  it("cool, room and warm water", () => {
    expect(zoneOf(TEMP_COOL)).toBe(-1);
    expect(zoneOf(TEMP_ROOM)).toBe(0);
    expect(zoneOf(TEMP_WARM)).toBe(1);
    expect(zoneOf(19.5)).toBe(-1);
    expect(zoneOf(19.6)).toBe(0);
    expect(zoneOf(24.5)).toBe(1);
  });

  it("each species: cool lovers, warm lovers and those that don't mind; room temperature suits everyone", () => {
    expect([0, 6, 8].map((k) => TEMP_PREF[k as Species])).toEqual([-1, -1, -1]); // moon, crystal, lion's mane
    expect([2, 4, 7].map((k) => TEMP_PREF[k as Species])).toEqual([1, 1, 1]); // upside-down, fried egg, flower hat
    expect([1, 3, 5].map((k) => TEMP_PREF[k as Species])).toEqual([0, 0, 0]); // blubber, comb, nettle
    for (let k = 0; k < SPECIES_N; k++) {
      expect(comfortOf(k as Species, TEMP_ROOM)).toBe(0);
      expect(tempMood(k as Species, TEMP_ROOM)).toBe(0);
      expect(tempGrowth(k as Species, TEMP_ROOM)).toBe(1);
    }
    expect([comfortOf(MOON, TEMP_COOL), comfortOf(MOON, TEMP_WARM)]).toEqual([1, -1]);
    expect([comfortOf(UPSIDE, TEMP_COOL), comfortOf(UPSIDE, TEMP_WARM)]).toEqual([-1, 1]);
    expect([comfortOf(BLUBBER, TEMP_COOL), comfortOf(BLUBBER, TEMP_WARM)]).toEqual([0, 0]);
    expect(tempMood(LION, TEMP_COOL)).toBe(TEMP_MOOD_GOOD);
    expect(tempMood(LION, TEMP_WARM)).toBe(TEMP_MOOD_BAD);
    expect(tempGrowth(UPSIDE, TEMP_WARM)).toBe(TEMP_GROW_GOOD);
    expect(tempGrowth(UPSIDE, TEMP_COOL)).toBe(TEMP_GROW_BAD);
    expect(TEMP_GROW_BAD).toBeGreaterThan(0); // slower, never stopped
  });

  it("the water eases toward the setting and says so once when it gets there", () => {
    expect(driftTemp(TEMP_ROOM, 1, TEMP_TAU)).toBeCloseTo(TEMP_WARM - (TEMP_WARM - TEMP_ROOM) / Math.E, 6);
    expect(driftTemp(TEMP_ROOM, 1, 1e6)).toBeCloseTo(TEMP_WARM, 6);
    const c = newClimate();
    c.heater = true;
    expect(toggleDevice(c, 1)).toBe(1);
    expect(c.settled).toBe(false);
    let said = 0;
    for (let t = 0; t < 1200; t++) if (stepClimate(c, 1) === "settled") said++;
    expect(said).toBe(1);
    expect(c.temp).toBeCloseTo(TEMP_WARM, 1);
  });

  it("each unit flips its own setting; the other unit's goes off; a unit that isn't owned does nothing", () => {
    const c = newClimate();
    expect(toggleDevice(c, 1)).toBeNull();
    c.heater = true;
    c.chiller = true;
    expect(toggleDevice(c, 1)).toBe(1);
    expect(toggleDevice(c, -1)).toBe(-1); // the chiller takes over
    expect(toggleDevice(c, -1)).toBe(0);
    expect(toggleDevice(c, 1)).toBe(1);
    expect(toggleDevice(c, 1)).toBe(0);
  });

  it("repairs a saved climate: a setting needs its unit, the water stays in a sane range; saves nothing by default", () => {
    expect(climateOf(undefined)).toEqual(newClimate());
    expect(climateOf({ set: 1 }).set).toBe(0); // no heater
    expect(climateOf({ heater: true, set: 1, temp: 25 })).toMatchObject({ heater: true, set: 1, temp: 25, settled: false });
    expect(climateOf({ chiller: true, set: -3, temp: -40 })).toMatchObject({ set: -1, temp: TEMP_COOL - 3 });
    expect(climateOf({ temp: "hot" }).temp).toBe(TEMP_ROOM);
    expect(climateField(newClimate())).toEqual({});
    const c = climateOf({ heater: true, set: 1, temp: 23.456 });
    expect(climateField(c)).toEqual({ climate: { heater: true, set: 1, temp: 23.46 } });
  });

  it("has words: the card's line, the journal's, the screen reader's", () => {
    expect(tempPhrase(MOON, TEMP_ROOM)).toBe("Likes it cool");
    expect(tempPhrase(MOON, TEMP_COOL)).toBe("Likes it cool — just right");
    expect(tempPhrase(MOON, TEMP_WARM)).toBe("Likes it cool — a bit warm in here");
    expect(tempPhrase(UPSIDE, TEMP_COOL)).toBe("Likes it warm — a bit chilly in here");
    expect(tempPhrase(BLUBBER, TEMP_WARM)).toBeNull();
    expect(prefWords(LION)).toBe("Cool water (19° or less)");
    expect(prefWords(UPSIDE)).toBe("Warm water (25° or more)");
    expect(prefWords(BLUBBER)).toBe("Any temperature");
    expect(settingWords(1, 1)).toBe("Heater on: warming the water to 27 degrees.");
    expect(settingWords(-1, -1)).toBe("Chiller on: cooling the water to 17 degrees.");
    expect(settingWords(1, 0)).toBe("Heater off: the water goes back to room temperature, 22 degrees.");
    expect(settledWords(1, 27)).toBe("The water is warm now: 27 degrees.");
    expect(eventWords({ type: "thermo", dir: -1, set: -1 }, () => null)?.text).toBe("Chiller on: cooling the water to 17 degrees.");
    expect(eventWords({ type: "settled", set: 0, temp: 22 }, () => null)?.text).toBe("The water is back to room temperature: 22 degrees.");
    expect(keyAction({ key: "h" }, { onCanvas: true, shopOpen: false })).toEqual({ kind: "heater" });
    expect(keyAction({ key: "C" }, { onCanvas: false, shopOpen: false })).toEqual({ kind: "chiller" });
  });
});

describe("temperature in the tank", () => {
  it("the heater and the chiller are sold on the SUPPLIES tab (items 34, 35) and come switched off", () => {
    expect(SHOP_ITEMS[34]).toMatchObject({ kind: "climate", dir: 1 });
    expect(SHOP_ITEMS[35]).toMatchObject({ kind: "climate", dir: -1 });
    expect(TAB_ITEMS[2]).toEqual(expect.arrayContaining([34, 35]));
    const s = state([jelly(0, 3)], { dollars: 300 });
    openShop(s);
    expect(buy(s, 34)).toBe("bought");
    expect(buy(s, 34)).toBe("owned");
    expect(s.dollars).toBe(300 - SHOP_ITEMS[34]!.price);
    expect(climateInfo(s)).toMatchObject({ heater: true, chiller: false, set: 0, reading: TEMP_ROOM });
    const v = view(s);
    expect([v.haveHeat, v.haveCool, v.heatOn, v.own34, v.lock34, v.own35]).toEqual([1, 0, 0, 1, 1, 0]);
    expect(buy(state([jelly(0, 3)], { dollars: 5 }), 35)).toBe("cantAfford");
  });

  it("tapping a unit switches it, says so, and the thermometer follows the water", () => {
    const s = state([jelly(UPSIDE, 3)], { climate: { heater: true, chiller: true } });
    expect(tapClimate(s, 1)).toBe(1);
    const first = run(s, 0.1);
    expect(first.find((e) => e.type === "thermo")).toMatchObject({ dir: 1, set: 1 });
    expect(view(s).heatPress).toBeGreaterThan(0);
    let v = view(s);
    expect([v.heatOn, v.coolOn, v.tc1n2, v.tc0n2, v.tmpRoom]).toEqual([1, 0, 1, 1, 1]);
    const later = run(s, 15 * 60, 4);
    expect(later.filter((e) => e.type === "settled")).toEqual([{ type: "settled", set: 1, temp: TEMP_WARM }]);
    v = view(s);
    expect([v.tc1n2, v.tc0n7, v.tmpWarm, v.tmpRoom]).toEqual([1, 1, 1, 0]);
    expect(tapClimate(s, -1)).toBe(-1);
    run(s, 15 * 60, 4);
    v = view(s);
    expect([v.heatOn, v.coolOn, v.tc1n1, v.tc0n7, v.tmpCool]).toEqual([0, 1, 1, 1, 1]);
    expect(tapClimate(state([jelly(0, 3)]), 1)).toBeNull(); // no heater
  });

  it("a jelly is a little happier in the water it likes, a little less at the other end; others don't mind", () => {
    const s = state([jelly(UPSIDE, 3), jelly(MOON, 3), jelly(BLUBBER, 3)], { climate: { heater: true, chiller: true } });
    const at = (temp: number) => {
      s.climate.temp = temp;
      return s.slots.slice(0, 3).map((j) => moodOf(s, j!));
    };
    const room = at(TEMP_ROOM);
    const warm = at(TEMP_WARM);
    expect(warm[0]).toBeCloseTo(room[0]! + TEMP_MOOD_GOOD, 9);
    expect(warm[1]).toBeCloseTo(room[1]! + TEMP_MOOD_BAD, 9);
    expect(warm[2]).toBe(room[2]);
    s.climate.temp = TEMP_WARM;
    expect(jellyInfo(s, 1)?.temp).toBe(TEMP_WARM);
    expect(tempPhrase(MOON, jellyInfo(s, 1)!.temp)).toBe("Likes it cool — a bit warm in here");
  });

  it("good care grows a jelly faster in the water it likes and slower in the wrong one, never stopping it", () => {
    const grown = (temp: number) => {
      const s = state([jelly(LION, 2, { gp: 12 })], { climate: { heater: true, chiller: true, set: temp < TEMP_ROOM ? -1 : temp > TEMP_ROOM ? 1 : 0, temp } });
      s.slots[0]!.fullness = 1;
      run(s, 600, 4);
      return s.slots[0]!.gp;
    };
    const room = grown(TEMP_ROOM);
    const cool = grown(TEMP_COOL);
    const warm = grown(TEMP_WARM);
    expect(cool).toBeGreaterThan(room);
    expect(warm).toBeLessThan(room);
    expect(warm).toBeGreaterThan(12);
  });

  it("time away: the water settles toward its setting, and growth goes at the rate it settled to", () => {
    const saved = toSave(state([jelly(MOON, 2, { gp: 12, fullness: 1 })], { climate: { chiller: true, set: -1, temp: TEMP_ROOM } }), NOON);
    expect(saved.climate).toEqual({ chiller: true, set: -1, temp: TEMP_ROOM });
    const { save } = loadGame(JSON.stringify(saved), NOON + 2 * 3600_000);
    expect(save.climate?.temp).toBeCloseTo(TEMP_COOL, 2);
    const room = loadGame(JSON.stringify({ ...saved, climate: undefined }), NOON + 2 * 3600_000).save;
    expect(save.slots[0]!.gp).toBeGreaterThanOrEqual(room.slots[0]!.gp);
    expect(createState(save, seeded()).climate).toMatchObject({ chiller: true, set: -1 });
    expect("climate" in toSave(state([jelly(0, 3)]), NOON)).toBe(false);
  });

  it("writes exactly the contract's props with the units on the shelf", () => {
    const s = state([jelly(0, 3)], { climate: { heater: true, chiller: true, set: -1, temp: 18 } });
    run(s, 0.5);
    const v = view(s);
    expect(new Set(Object.keys(v))).toEqual(new Set(K.props));
    expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
  });
});

describe("temperature: the daily request", () => {
  const base = { species: [MOON, BLUBBER] as Species[], foods: [true, false, false], decor: [], pearl: false };
  const days = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);

  it("is offered only with a jelly that minds, the unit that gets there, and the water not there already", () => {
    const offered = (climate?: { heater: boolean; chiller: boolean; zone: number }, species = base.species) =>
      days.some((d) => planRequests(d, { ...base, species, ...(climate ? { climate } : {}) }).items.some((r) => r.kind === "temp"));
    expect(offered(undefined)).toBe(false);
    expect(offered({ heater: true, chiller: false, zone: 0 })).toBe(false); // the moon likes it cool: needs the chiller
    expect(offered({ heater: false, chiller: true, zone: 0 })).toBe(true);
    expect(offered({ heater: false, chiller: true, zone: -1 })).toBe(false); // already cool
    expect(offered({ heater: true, chiller: true, zone: 0 }, [BLUBBER])).toBe(false); // doesn't mind
    const r = days.map((d) => planRequests(d, { ...base, climate: { heater: false, chiller: true, zone: 0 } })).flatMap((p) => p.items).find((q) => q.kind === "temp")!;
    expect(r.target).toBe(MOON);
    expect(requestText(r)).toBe("Set the tank to what a moon jelly likes");
    expect(rewardOf(r)).toBe(8);
    expect(requestsOf({ day: "2026-07-01", items: [r] })?.items[0]).toEqual(r);
  });

  it("is done once the water suits that species", () => {
    const day = { day: "2026-07-01", items: [{ kind: "temp" as const, target: MOON, n: 1, progress: 0, done: false }] };
    expect(advance(day, { kind: "temp", k: LION })).toEqual([]);
    expect(advance(day, { kind: "temp", k: MOON })).toEqual([0]);
  });

  it("in play: switching the chiller on finishes it once the water gets cool, and pays", () => {
    const s = state([jelly(MOON, 3)], { climate: { chiller: true }, dollars: 0 }, { requests: true });
    s.requests = { day: requests(s)!.day, items: [{ kind: "temp", target: MOON, n: 1, progress: 0, done: false }] };
    run(s, 10, 4);
    expect(s.requests.items[0]!.done).toBe(false);
    tapClimate(s, -1);
    const evs = run(s, 10 * 60, 4);
    expect(evs.some((e) => e.type === "requestDone")).toBe(true);
    expect(s.dollars).toBeGreaterThanOrEqual(8);
  });
});
