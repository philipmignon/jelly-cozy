/**
 * Seasonal events: which one is on by the player's local calendar. Pure (no DOM): the host passes the date,
 * the URL's query string and the "Seasonal decor" setting, and hands the result to the sim (setEvent).
 *
 * A season is a table entry plus art. Its art lives in tools/gen.py under the season's sprite prefix
 * (Halloween: `hw_*`) and shows on one view-model prop (`prop`, 0/1) that the sim writes; seasonal visitors
 * are tagged in visitors.ts (VISITOR_SEASON). Adding winter later: one more row here, its art, its visitor.
 *
 * Testing: `?season=halloween` forces an event on whatever the date, `?season=none` forces it off.
 */

export type SeasonId = "halloween";

export interface Season {
  id: SeasonId;
  name: string;
  /** first and last day, inclusive, as [month 1-12, day]; `to` before `from` wraps over the new year */
  from: readonly [number, number];
  to: readonly [number, number];
  /** the view-model prop that shows its decor (contract props) */
  prop: string;
  /** the morph id a jelly born during it may get (2 ghost), or null */
  morph: number | null;
  /** its sprite prefix in gen.py (for the lead's on-demand asset groups) */
  sprites: string;
}

export const SEASONS: readonly Season[] = [
  { id: "halloween", name: "Halloween", from: [10, 1], to: [11, 2], prop: "evHalloween", morph: 2, sprites: "hw_" },
];

/** The morph id of the ghost-pale Halloween morph (the morph model: 0 none, 1 classic rare colour, 2 ghost). */
export const GHOST_MORPH = 2;

/** localStorage key for the "Seasonal decor" setting ("0" = off; anything else, or nothing, = on). */
export const SEASON_DECOR_KEY = "jellytank:seasonDecor";

const dayOfYear = (month: number, day: number) => month * 100 + day; // ordinal is enough for comparisons

/** Is the local calendar day of `date` inside the season (inclusive at both ends)? */
export function inSeason(season: Season, date: Date): boolean {
  const d = dayOfYear(date.getMonth() + 1, date.getDate());
  const a = dayOfYear(season.from[0], season.from[1]);
  const b = dayOfYear(season.to[0], season.to[1]);
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** The season the calendar is in on `now` (epoch ms or a Date, local time), or null. */
export function seasonAt(now: number | Date): Season | null {
  const date = typeof now === "number" ? new Date(now) : now;
  if (Number.isNaN(date.getTime())) return null;
  return SEASONS.find((s) => inSeason(s, date)) ?? null;
}

export const seasonById = (id: string): Season | null => SEASONS.find((s) => s.id === id) ?? null;

/**
 * The `?season=` override in a query string: a Season to force it on, null for `none` (forced off), or
 * undefined when there is no (recognised) override.
 */
export function seasonOverride(search: string): Season | null | undefined {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get("season");
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "none" || v === "off") return null;
  return seasonById(v) ?? undefined;
}

/**
 * The season to show: the URL override if there is one, else the calendar's; and nothing when the player
 * turned seasonal decor off (an explicit `?season=` still wins, so a test link always shows it).
 */
export function activeSeason(now: number | Date, search = "", decorOn = true): Season | null {
  const forced = seasonOverride(search);
  if (forced !== undefined) return forced;
  return decorOn ? seasonAt(now) : null;
}

/**
 * The morph a jelly born at `now` may roll instead of the classic one: GHOST_MORPH (2) during Halloween,
 * else null. `search` honours the `?season=` override, like activeSeason. The birth logic decides the odds.
 */
export function seasonalMorph(now: number | Date, search = ""): number | null {
  const forced = seasonOverride(search);
  const s = forced !== undefined ? forced : seasonAt(now);
  return s?.morph ?? null;
}

/** The "Seasonal decor" setting from storage: on unless it was turned off. Never throws. */
export function readSeasonDecor(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(SEASON_DECOR_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeSeasonDecor(storage: Pick<Storage, "setItem"> | null | undefined, on: boolean): void {
  try {
    storage?.setItem(SEASON_DECOR_KEY, on ? "1" : "0");
  } catch {
    /* private mode: it lasts for this visit */
  }
}
