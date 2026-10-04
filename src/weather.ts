/**
 * The weather outside the room's window (src/room.ts draws it; src/audio.ts plays the rain). Pure: the host passes
 * the date, the season showing and the query string.
 *
 * It only rains (or snows) in the evening, from 18:00 until the sky turns to dawn at 5:30, and it is decided once per
 * evening from the local date, so an evening either rains or it doesn't, on every reload and in every tab: the hours
 * after midnight belong to the evening before. About one evening in four rains; while the winter season shows, about
 * one in two snows instead (and it never rains then).
 *
 * Testing: `?weather=rain|snow|none` forces it whatever the date and hour; `?sky=dusk|night` makes it evening and
 * `?sky=dawn|day` not (as the room's window sky does).
 */
import type { SeasonId } from "./season";

export type Weather = "rain" | "snow";

/** The share of evenings that rain, and (while winter shows) that snow. */
export const RAIN_ODDS = 0.25;
export const SNOW_ODDS = 0.5;
/** Evening: from this hour on, until the morning's EVENING_TO (the room's dusk and night). */
export const EVENING_FROM = 18;
export const EVENING_TO = 5.5;

/** The `?weather=` override: a Weather, null for `none`, undefined when there is none (or it's not one we know). */
export function weatherOverride(search: string): Weather | null | undefined {
  let v: string | null;
  try {
    v = new URLSearchParams(search).get("weather");
  } catch {
    return undefined;
  }
  if (v === null) return undefined;
  v = v.trim().toLowerCase();
  if (v === "rain" || v === "snow") return v;
  return v === "none" || v === "off" ? null : undefined;
}

/** The evening `now` falls in, as its local date "YYYY-MM-DD", or null in the daytime. `?sky=` decides when present. */
export function eveningOf(now: Date, search = ""): string | null {
  let sky: string | null = null;
  try {
    sky = new URLSearchParams(search).get("sky");
  } catch {
    /* no override */
  }
  const h = now.getHours() + now.getMinutes() / 60;
  const evening = sky === "dusk" || sky === "night" ? true : sky === "dawn" || sky === "day" ? false : h >= EVENING_FROM || h < EVENING_TO;
  if (!evening) return null;
  // after midnight (or a forced evening in the small hours): the evening that began the day before
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (h < 12 ? 1 : 0));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A steady 0..1 from a day's key: FNV-1a, so every browser agrees. */
export function dayRoll(key: string): number {
  let h = 0x811c9dc5;
  for (const ch of `weather:${key}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 2 ** 32;
}

/** The weather now: rain, snow or null (clear, or daytime). `season` is the event showing (state.event). */
export function weatherAt(now: Date, season: SeasonId | null, search = ""): Weather | null {
  const forced = weatherOverride(search);
  if (forced !== undefined) return forced;
  const day = eveningOf(now, search);
  if (!day) return null;
  const r = dayRoll(day);
  if (season === "winter") return r < SNOW_ODDS ? "snow" : null;
  return r < RAIN_ODDS ? "rain" : null;
}
