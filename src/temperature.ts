/**
 * Temperature: the heater and the chiller (shop items 34 and 35), the thermostat's three settings and the water
 * drifting toward them, and what each species thinks of it. Pure: no DOM, no Rive. sim.ts keeps a Climate in its
 * State, steps it, and folds comfort into mood and growth; the view writes the thermometer and the devices.
 *
 * Settings: Cool (-1, needs the chiller), Room (0, always) and Warm (1, needs the heater). The heater's shelf unit
 * flips Warm <-> Room, the chiller's Cool <-> Room. The water eases toward the setting's temperature (TEMP_TAU).
 *
 * Comfort (comfortOf): a species that likes it cool is happiest at or below TEMP_COOL_MAX, one that likes it warm
 * at or above TEMP_WARM_MIN; at room temperature neither minds (so a tank without either device plays as it always
 * has); the opposite end makes them a little less happy and grow a little slower. Nothing is ever harmed by it.
 */
import { clamp, type Species } from "./species";

// ---------------------------------------------------------------- the numbers

/** The thermostat's settings, °C. */
export const TEMP_ROOM = 22;
export const TEMP_COOL = 17;
export const TEMP_WARM = 27;
/** At or below this the water counts as cool, at or above that as warm (°C); in between is room temperature. */
export const TEMP_COOL_MAX = 19.5;
export const TEMP_WARM_MIN = 24.5;
/** The water eases toward the setting with this time constant, s (it's most of the way there in a few minutes). */
export const TEMP_TAU = 120;
/** "settled": the water is this close to the setting (°C). */
export const TEMP_NEAR = 0.5;
/** Mood: a little happier where it likes it, a little less at the opposite end (added to moodOf). */
export const TEMP_MOOD_GOOD = 0.06;
export const TEMP_MOOD_BAD = -0.08;
/** Growth: good care pays its growth points this much faster (or slower). */
export const TEMP_GROW_GOOD = 1.25;
export const TEMP_GROW_BAD = 0.7;

/** -1 likes it cool, 1 likes it warm, 0 doesn't mind. */
export type TempPref = -1 | 0 | 1;
/**
 * Lion's mane, moon and crystal jellies come from cold or temperate seas; upside-downs, fried eggs and flower hats
 * from warm shallow ones. Blue blubbers, comb jellies and sea nettles take what they get.
 */
export const TEMP_PREF: Record<Species, TempPref> = {
  0: -1, // moon
  1: 0, // blue blubber
  2: 1, // upside-down
  3: 0, // comb
  4: 1, // fried egg
  5: 0, // sea nettle
  6: -1, // crystal
  7: 1, // flower hat
  8: -1, // lion's mane
};
export const tempPref = (k: Species): TempPref => TEMP_PREF[k] ?? 0;

/** The thermostat setting: -1 cool, 0 room, 1 warm. */
export type Setting = -1 | 0 | 1;
export const setPoint = (set: Setting): number => (set < 0 ? TEMP_COOL : set > 0 ? TEMP_WARM : TEMP_ROOM);

/** Which end of the range the water is at: -1 cool, 0 room, 1 warm. */
export const zoneOf = (temp: number): Setting => (temp <= TEMP_COOL_MAX ? -1 : temp >= TEMP_WARM_MIN ? 1 : 0);

/** 1 where it likes it, -1 at the opposite end, 0 otherwise (and always 0 for a species that doesn't mind). */
export function comfortOf(k: Species, temp: number): -1 | 0 | 1 {
  const p = tempPref(k);
  const z = zoneOf(temp);
  if (p === 0 || z === 0) return 0;
  return p === z ? 1 : -1;
}
export const tempMood = (k: Species, temp: number): number => {
  const c = comfortOf(k, temp);
  return c > 0 ? TEMP_MOOD_GOOD : c < 0 ? TEMP_MOOD_BAD : 0;
};
export const tempGrowth = (k: Species, temp: number): number => {
  const c = comfortOf(k, temp);
  return c > 0 ? TEMP_GROW_GOOD : c < 0 ? TEMP_GROW_BAD : 1;
};

// ---------------------------------------------------------------- the tank's climate

export interface Climate {
  heater: boolean;
  chiller: boolean;
  set: Setting;
  /** the water, °C */
  temp: number;
  /** the water had reached its setting at the last step (for the "temp" event) */
  settled: boolean;
  /** sim time the heater's / chiller's shelf unit stops looking pressed */
  pressHeat: number;
  pressCool: number;
}

export const newClimate = (): Climate => ({ heater: false, chiller: false, set: 0, temp: TEMP_ROOM, settled: true, pressHeat: 0, pressCool: 0 });

/** The save field: only there once a device is owned (or the water isn't at room temperature). */
export interface SaveClimate {
  heater?: boolean;
  chiller?: boolean;
  set?: number;
  temp?: number;
}

const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** A saved climate, repaired: no devices, room temperature when it's missing; a setting needs its device. */
export function climateOf(raw: unknown): Climate {
  const c = newClimate();
  if (!raw || typeof raw !== "object") return c;
  const o = raw as Record<string, unknown>;
  c.heater = o.heater === true;
  c.chiller = o.chiller === true;
  const set = Math.round(finite(o.set, 0));
  c.set = set > 0 && c.heater ? 1 : set < 0 && c.chiller ? -1 : 0;
  c.temp = Math.round(clamp(finite(o.temp, setPoint(c.set)), TEMP_COOL - 3, TEMP_WARM + 3) * 100) / 100;
  c.settled = Math.abs(c.temp - setPoint(c.set)) <= TEMP_NEAR;
  return c;
}

/** The optional `climate` save field (absent while there's nothing to say: no devices, room temperature). */
export function climateField(c: Climate): { climate?: SaveClimate } {
  if (!c.heater && !c.chiller && c.set === 0 && Math.abs(c.temp - TEMP_ROOM) < 0.01) return {};
  const out: SaveClimate = { temp: Math.round(c.temp * 100) / 100 };
  if (c.heater) out.heater = true;
  if (c.chiller) out.chiller = true;
  if (c.set !== 0) out.set = c.set;
  return { climate: out };
}

/** The water after `seconds` easing toward the setting. */
export const driftTemp = (temp: number, set: Setting, seconds: number): number => {
  const target = setPoint(set);
  return target + (temp - target) * Math.exp(-Math.max(0, seconds) / TEMP_TAU);
};

/** What the climate does in a step: "settled" once when the water reaches a new setting. */
export function stepClimate(c: Climate, dt: number): "settled" | null {
  c.temp = driftTemp(c.temp, c.set, dt);
  const near = Math.abs(c.temp - setPoint(c.set)) <= TEMP_NEAR;
  const was = c.settled;
  c.settled = near;
  return near && !was ? "settled" : null;
}

/** Can the thermostat be set to `set` (its device owned)? */
export const canSet = (c: Climate, set: Setting): boolean => set === 0 || (set > 0 ? c.heater : c.chiller);

/** Change the setting (only to one whose device is owned); returns whether it changed. */
export function setClimate(c: Climate, set: Setting): boolean {
  if (!canSet(c, set) || c.set === set) return false;
  c.set = set;
  c.settled = Math.abs(c.temp - setPoint(set)) <= TEMP_NEAR;
  return true;
}

/** A shelf unit tapped: the heater flips Warm <-> Room, the chiller Cool <-> Room. Null if it isn't owned. */
export function toggleDevice(c: Climate, dir: 1 | -1): Setting | null {
  if (dir > 0 ? !c.heater : !c.chiller) return null;
  setClimate(c, c.set === dir ? 0 : dir);
  return c.set;
}

// ---------------------------------------------------------------- words

/** The temperature as the thermometer reads it: whole degrees. */
export const tempReading = (temp: number): number => Math.round(clamp(temp, 0, 99));

/** The jelly card's line: "Likes it cool — a bit warm in here", or null for a species that doesn't mind. */
export function tempPhrase(k: Species, temp: number): string | null {
  const p = tempPref(k);
  if (p === 0) return null;
  const likes = p < 0 ? "Likes it cool" : "Likes it warm";
  const c = comfortOf(k, temp);
  return c > 0 ? `${likes} — just right` : c < 0 ? `${likes} — a bit ${p < 0 ? "warm" : "chilly"} in here` : likes;
}

/** The journal's row: what water a species likes. */
export function prefWords(k: Species): string {
  const p = tempPref(k);
  return p < 0 ? `Cool water (${Math.floor(TEMP_COOL_MAX)}° or less)` : p > 0 ? `Warm water (${Math.ceil(TEMP_WARM_MIN)}° or more)` : "Any temperature";
}

/** What the screen reader hears when unit `dir` (1 heater, -1 chiller) leaves the thermostat at `set`
 *  ("Heater on: warming the water to 27 degrees."). */
export function settingWords(dir: number, set: number): string {
  const name = dir > 0 ? "Heater" : "Chiller";
  if (set === Math.sign(dir)) return `${name} on: ${dir > 0 ? "warming" : "cooling"} the water to ${setPoint(set as Setting)} degrees.`;
  return `${name} off: the water goes back to room temperature, ${TEMP_ROOM} degrees.`;
}

/** ...and when the water gets there ("The water is warm now: 27 degrees."). */
export const settledWords = (set: number, reading: number): string =>
  set === 0 ? `The water is back to room temperature: ${reading} degrees.` : `The water is ${set < 0 ? "cool" : "warm"} now: ${reading} degrees.`;
