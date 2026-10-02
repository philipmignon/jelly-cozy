/**
 * Daily requests (v12): one or two small jobs a day, drawn from things the player can already do with
 * the tank they have. Pure: no DOM, no State. sim.ts plans them on the first step of each local day,
 * feeds them deeds (a pellet eaten, a spot scrubbed, a pet...) and pays each one once, through earn().
 *
 * Kinds (target, n):
 *   "feed"     species k (or -1: any jelly), `food`; n pellets of that food eaten   (10 for a species' favourite, 5 any)
 *   "scrub"    -1; n dirty spots scrubbed off the glass (2 or 3)                       (4 a spot)
 *   "pet"      -1; n pets                                                              (5)
 *   "pearl"    -1; today's pearl collected (only with the clam, pearl still waiting)   (5)
 *   "sprinkle" decoration d; n pellets sprinkled near it (only owned decorations)      (6)
 *   "visitor"  -1; a visitor tapped                                                    (10)
 * Unfinished requests don't carry over: a new day (or a day away) replaces them.
 */
import { FOOD_KINDS, FOOD_NAMES, SPECIES_N, SPECIES_NAMES, favouriteFood, type FoodKind, type Species } from "./species";
import { rng } from "./dirt";

export type RequestKind = "feed" | "scrub" | "pet" | "pearl" | "sprinkle" | "visitor";
export const REQUEST_KINDS: readonly RequestKind[] = ["feed", "scrub", "pet", "pearl", "sprinkle", "visitor"];

export interface Request {
  kind: RequestKind;
  /** feed: species (-1 any jelly); sprinkle: decoration; otherwise -1 */
  target: number;
  /** feed: the food kind */
  food?: FoodKind;
  /** how many it takes */
  n: number;
  progress: number;
  /** paid (once) */
  done: boolean;
}

export interface DailyRequests {
  /** local YYYY-MM-DD they were planned for */
  day: string;
  items: Request[];
}

/** What the tank has, for planning: only requests it can finish are offered. */
export interface RequestTank {
  /** species of the jellies in the tank (repeats allowed) */
  species: readonly Species[];
  /** food kinds owned (index = FoodKind) */
  foods: readonly boolean[];
  /** decorations owned (index = decor) */
  decor: readonly boolean[];
  /** the clam's pearl is waiting today */
  pearl: boolean;
}

/** Something the player did that a request may count. */
export type Deed =
  | { kind: "ate"; k: Species; food: FoodKind }
  | { kind: "scrub" }
  | { kind: "pet" }
  | { kind: "pearl" }
  | { kind: "sprinkle"; decor: number; n: number }
  | { kind: "visitor" };

/** At most this many a day. */
export const REQUESTS_PER_DAY = 2;
/** Pellets of a species' favourite food it takes; pellets of a food for any jelly. */
export const FEED_FAV_N = 3;
export const FEED_ANY_N = 6;
export const PET_N = 5;
export const SPRINKLE_N = 8;
/** A pellet counts as "by" a decoration within this many px (world x) of its base. */
export const SPRINKLE_NEAR = 100;
const DECOR_NAMES = ["castle", "anchor", "dive helmet", "giant clam", "glow coral"];

/** Sand dollars a request pays: 5..15, more for the fussier ones. */
export function rewardOf(r: Pick<Request, "kind" | "target" | "n">): number {
  switch (r.kind) {
    case "feed":
      return r.target >= 0 ? 10 : 5;
    case "scrub":
      return Math.min(15, 4 * r.n);
    case "pet":
    case "pearl":
      return 5;
    case "sprinkle":
      return 6;
    case "visitor":
      return 10;
  }
}

const an = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);

/** The line on the note: "Feed brine shrimp to a sea nettle". */
export function requestText(r: Request): string {
  switch (r.kind) {
    case "feed": {
      const food = (FOOD_NAMES[r.food ?? 0] ?? "Flakes").toLowerCase();
      return r.target >= 0 ? `Feed ${food} to ${an((SPECIES_NAMES[r.target] ?? "jelly").toLowerCase())}` : `Feed your jellies ${food}`;
    }
    case "scrub":
      return `Scrub ${r.n} dirty spots off the glass`;
    case "pet":
      return `Pet your jellies ${r.n} times`;
    case "pearl":
      return "Collect the pearl from the clam";
    case "sprinkle":
      return `Sprinkle food by the ${DECOR_NAMES[r.target] ?? "rocks"}`;
    case "visitor":
      return "Say hello to a visitor";
  }
}

/** A repeatable seed from a day key, so a day's requests come out the same however often they're planned. */
function daySeed(day: string): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  return h >>> 0;
}

const req = (kind: RequestKind, n: number, target = -1, food?: FoodKind): Request =>
  food === undefined ? { kind, target, n, progress: 0, done: false } : { kind, target, food, n, progress: 0, done: false };

/**
 * The day's requests for this tank: up to REQUESTS_PER_DAY of different kinds, each one the tank can
 * finish (a favourite-food request only for a species in the tank whose favourite is owned, the pearl
 * only with one waiting, a decoration only if owned). Uses its own random stream seeded by the day.
 */
export function planRequests(day: string, t: RequestTank): DailyRequests {
  const r = rng(daySeed(day));
  const pick = <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!;
  const kinds = [...new Set(t.species)];
  const pool: [weight: number, make: () => Request][] = [];
  if (kinds.length) {
    const favs = kinds.filter((k) => t.foods[favouriteFood(k)] === true);
    const owned = Array.from({ length: FOOD_KINDS }, (_, f) => f as FoodKind).filter((f) => f === 0 || t.foods[f] === true);
    pool.push([3, () => {
      if (favs.length && r() < 0.65) {
        const k = pick(favs);
        return req("feed", FEED_FAV_N, k, favouriteFood(k));
      }
      return req("feed", FEED_ANY_N, -1, pick(owned));
    }]);
    pool.push([2, () => req("pet", PET_N)]);
  }
  pool.push([3, () => req("scrub", r() < 0.5 ? 2 : 3)]);
  if (t.pearl) pool.push([2, () => req("pearl", 1)]);
  const decor = t.decor.flatMap((o, d) => (o ? [d] : []));
  if (decor.length) pool.push([2, () => req("sprinkle", SPRINKLE_N, pick(decor))]);
  pool.push([1, () => req("visitor", 1)]);
  const items: Request[] = [];
  while (items.length < REQUESTS_PER_DAY && pool.length) {
    const total = pool.reduce((a, p) => a + p[0], 0);
    let x = r() * total;
    let i = 0;
    while (i < pool.length - 1 && x >= pool[i]![0]) x -= pool[i++]![0];
    items.push(pool[i]![1]());
    pool.splice(i, 1);
  }
  return { day, items };
}

/** How much a deed moves request r on (0 if it doesn't count). */
function worth(r: Request, d: Deed): number {
  switch (d.kind) {
    case "ate":
      return r.kind === "feed" && r.food === d.food && (r.target < 0 || r.target === d.k) ? 1 : 0;
    case "sprinkle":
      return r.kind === "sprinkle" && r.target === d.decor ? d.n : 0;
    default:
      return r.kind === d.kind ? 1 : 0;
  }
}

/** Count a deed; returns the indexes of the requests it just finished (each finishes once: pay those). */
export function advance(day: DailyRequests, d: Deed): number[] {
  const done: number[] = [];
  day.items.forEach((r, i) => {
    if (r.done) return;
    const w = worth(r, d);
    if (w <= 0) return;
    r.progress = Math.min(r.n, r.progress + w);
    if (r.progress >= r.n) {
      r.done = true;
      done.push(i);
    }
  });
  return done;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** A saved day of requests, repaired; null if it's missing or not a day of requests at all. Bad items are dropped. */
export function requestsOf(raw: unknown): DailyRequests | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.day !== "string" || !DAY_RE.test(o.day) || !Array.isArray(o.items)) return null;
  const items = o.items.slice(0, REQUESTS_PER_DAY).flatMap((v): Request[] => {
    if (!v || typeof v !== "object") return [];
    const q = v as Record<string, unknown>;
    const kind = REQUEST_KINDS.find((k) => k === q.kind);
    const n = int(q.n, 1, 99);
    if (!kind || n === null) return [];
    const target = kind === "feed" ? int(q.target, -1, SPECIES_N - 1) : kind === "sprinkle" ? int(q.target, 0, DECOR_NAMES.length - 1) : -1;
    const food = kind === "feed" ? int(q.food, 0, FOOD_KINDS - 1) : 0;
    if (target === null || food === null) return [];
    const r = req(kind, n, target, kind === "feed" ? (food as FoodKind) : undefined);
    r.done = q.done === true || (int(q.progress, 0, 99) ?? 0) >= n;
    r.progress = r.done ? n : int(q.progress, 0, 99) ?? 0;
    return [r];
  });
  return { day: o.day, items };
}

/** A deep copy (saves and the host get copies, never the live requests). */
export const copyRequests = (d: DailyRequests): DailyRequests => ({ day: d.day, items: d.items.map((r) => ({ ...r })) });
