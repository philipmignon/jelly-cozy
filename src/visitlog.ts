/**
 * The visitor log (v14): which visitors the tank has had, how often, and when each first came. Pure: sim.ts
 * notes a sighting when a visitor arrives (in view), keeps the log in State.visitorsSeen and saves it as the
 * optional `visitorsSeen` field (absent until the first sighting; older saves start empty). The journal's
 * Visitors page lists every kind from visitorLog(), "???" until met.
 */
import { VISITORS, VISITOR_NAMES, VISITOR_NIGHT, VISITOR_SEASON, type VisitorKind } from "./visitors";

export interface Sighting {
  /** times seen */
  n: number;
  /** the first time, epoch ms */
  first: number;
}

/** Sightings by visitor kind ("turtle", "octopus"...); a kind never seen has no entry. */
export type VisitorsSeen = Partial<Record<VisitorKind, Sighting>>;

const MAX_N = 1_000_000;

/** A saved log, repaired: unknown kinds and bad entries are dropped. */
export function visitorsSeenOf(raw: unknown): VisitorsSeen {
  const out: VisitorsSeen = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const kind of VISITORS) {
    const e = o[kind];
    if (!e || typeof e !== "object") continue;
    const { n, first } = e as Record<string, unknown>;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || typeof first !== "number" || !Number.isFinite(first) || first <= 0) continue;
    out[kind] = { n: Math.min(MAX_N, Math.floor(n)), first };
  }
  return out;
}

/** A deep copy (saves get copies, never the live log). */
export const copySeen = (seen: VisitorsSeen): VisitorsSeen => visitorsSeenOf(seen);

/** Note a sighting of `kind` at `now`; true when it's the first ever. */
export function noteSighting(seen: VisitorsSeen, kind: VisitorKind, now: number): boolean {
  const e = seen[kind];
  if (e) {
    e.n = Math.min(MAX_N, e.n + 1);
    return false;
  }
  seen[kind] = { n: 1, first: now };
  return true;
}

/** One row of the journal's Visitors page. */
export interface VisitorRow {
  kind: VisitorKind;
  /** "sea turtle" */
  name: string;
  /** times seen (0: not met yet) */
  n: number;
  /** first seen, epoch ms (null: not met yet) */
  first: number | null;
  /** only comes at night */
  night: boolean;
  /** the seasonal event it comes with ("halloween"), null = all year */
  season: string | null;
}

/** Every visitor kind, in order (day visitors, the seasonal bat, then the night ones), with what the log knows. */
export function visitLogRows(seen: VisitorsSeen): VisitorRow[] {
  return VISITORS.map((kind, k) => {
    const e = seen[kind];
    return { kind, name: VISITOR_NAMES[k] ?? kind, n: e?.n ?? 0, first: e?.first ?? null, night: VISITOR_NIGHT[k] === true, season: VISITOR_SEASON[k] ?? null };
  });
}
