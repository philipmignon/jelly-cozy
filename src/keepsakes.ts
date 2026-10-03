/**
 * Keepsakes (v13): milestones in the jelly journal that each leave the player something for the tank, a
 * decoration or a tank theme the shop doesn't sell (SHOP_ITEMS 25..30, `keepsake` = the milestone here).
 * Pure: no DOM, no State. sim.ts keeps the two facts the journal can't tell (distinct days the tank was
 * kept, daily requests finished), evaluates the milestones on load and every step, and grants each reward
 * once (KeepSave.earned). Read-only tanks (the demo, visits) never evaluate them.
 *
 * Milestones (what counts, how many):
 *   0 first adult        any jelly raised to adult (journal raised, summed)        1  -> message in a bottle (25)
 *   1 three kinds        species with one raised to adult                           3  -> lighthouse (26)
 *   2 a rare colour      species with a colour morph ever owned (classic or ghost)  1  -> jelly lantern (27)
 *   3 a week             distinct local days the tank was played                     7  -> ship's wheel (28)
 *   4 ten requests       daily requests finished, all time                          10  -> postbox (29)
 *   5 all nine           species with one raised to adult                            9  -> Moonlit Lagoon theme (30)
 */
import { SPECIES_N } from "./species";

/** The optional `keep` save field. */
export interface KeepSave {
  /** milestones reached, a bitmask by milestone index (bit m): each one's reward is granted once */
  earned: number;
  /** distinct local days the tank was played, and the last one counted (YYYY-MM-DD) */
  days: number;
  lastDay: string;
  /** daily requests finished, all time (from v13; older saves start from the day's finished ones) */
  requests: number;
}

/** What the milestones are judged on. */
export interface KeepFacts {
  /** jellies raised to adult, all species */
  adults: number;
  /** species with at least one raised to adult */
  kinds: number;
  /** species with a colour morph seen */
  morphs: number;
  days: number;
  requests: number;
}

export interface Milestone {
  /** the journal's line */
  title: string;
  /** how many it takes */
  n: number;
  of: (f: KeepFacts) => number;
  /** the shop item it leaves (SHOP_ITEMS index) and what it's called in a sentence */
  item: number;
  reward: string;
  /** the unlock note */
  note: string;
}

export const MILESTONES: readonly Milestone[] = [
  { title: "Raise your first adult", n: 1, of: (f) => f.adults, item: 25, reward: "a message in a bottle",
    note: "Your first jelly grew up. A message in a bottle drifted down for you." },
  { title: "Raise three kinds of jelly", n: 3, of: (f) => f.kinds, item: 26, reward: "a little lighthouse",
    note: "You've raised three kinds of jelly. A little lighthouse washed up for you." },
  { title: "Spot a rare colour", n: 1, of: (f) => f.morphs, item: 27, reward: "a jelly lantern",
    note: "You spotted a jelly in a rare colour. Someone left a jelly lantern by the glass." },
  { title: "Keep your tank 7 days", n: 7, of: (f) => f.days, item: 28, reward: "a ship's wheel",
    note: "You've kept your tank on seven different days. A ship's wheel settled into the sand." },
  { title: "Finish 10 daily requests", n: 10, of: (f) => f.requests, item: 29, reward: "a little postbox",
    note: "You finished ten daily requests. A little postbox turned up to hold the notes." },
  { title: "Raise all nine kinds", n: SPECIES_N, of: (f) => f.kinds, item: 30, reward: "the Moonlit Lagoon",
    note: "You've raised all nine kinds of jelly. The Moonlit Lagoon is yours: pick it in the shop's TANK tab." },
];
export const KEEPSAKE_N = MILESTONES.length;

/** The journal's side of the facts: entries with `raised` and `morphSeen`. */
export function keepFacts(journal: readonly { raised: number; morphSeen: number }[], keep: KeepSave): KeepFacts {
  return {
    adults: journal.reduce((a, e) => a + e.raised, 0),
    kinds: journal.filter((e) => e.raised > 0).length,
    morphs: journal.filter((e) => e.morphSeen !== 0).length,
    days: keep.days,
    requests: keep.requests,
  };
}

/** How far along milestone m is: 0..n. */
export const progressOf = (m: number, f: KeepFacts): number => {
  const ms = MILESTONES[m];
  return ms ? Math.max(0, Math.min(ms.n, Math.floor(ms.of(f)))) : 0;
};

export const isEarned = (keep: Pick<KeepSave, "earned">, m: number): boolean => (keep.earned & (1 << m)) !== 0;

/** Milestones reached by these facts and not yet earned, in order. */
export const newlyReached = (keep: KeepSave, f: KeepFacts): number[] =>
  MILESTONES.flatMap((ms, m) => (!isEarned(keep, m) && progressOf(m, f) >= ms.n ? [m] : []));

/** Count a local day (YYYY-MM-DD) the tank was played; each counts once, and only going forward. */
export function countDay(keep: KeepSave, day: string): boolean {
  if (!DAY_RE.test(day) || day <= keep.lastDay) return false;
  keep.days++;
  keep.lastDay = day;
  return true;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALL = (1 << KEEPSAKE_N) - 1;
const count = (v: unknown, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.floor(v))) : 0);

/** A saved `keep`, repaired; null when there isn't one (an older save: see seedKeep). */
export function keepOf(raw: unknown): KeepSave | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    earned: count(o.earned, ALL) & ALL,
    days: count(o.days, 100_000),
    lastDay: typeof o.lastDay === "string" && DAY_RE.test(o.lastDay) ? o.lastDay : "",
    requests: count(o.requests, 100_000),
  };
}

/**
 * A first `keep` for a save from before keepsakes: the days it can prove it was played (the local days its
 * jellies were born and its species first grew up, as day keys) and today's finished requests. Nothing earned yet.
 */
export function seedKeep(days: readonly string[], requestsDone: number): KeepSave {
  const seen = [...new Set(days.filter((d) => DAY_RE.test(d)))].sort();
  return { earned: 0, days: seen.length, lastDay: seen[seen.length - 1] ?? "", requests: count(requestsDone, 100_000) };
}

export const copyKeep = (k: KeepSave): KeepSave => ({ ...k });
