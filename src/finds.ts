/**
 * Sea glass and shells (v16): little finds the tank turns up while it's looked after, kept in a jar and laid out
 * in the journal's Collection drawer. Pure: no DOM, no State. sim.ts rolls for a find when something stirs the
 * sand or the glass, with its own seeded random stream, and grants each set's reward once (FindSave.sets).
 * Read-only tanks (the demo, a friend's tank from a share code) never roll.
 *
 * Where finds come from (chance per event, before the day's slowdown):
 *   scrub  a dirty spot scrubbed off the glass (one that pays)              12%
 *   sift   every SIFT_STEP px the sponge is rubbed over the sand            6%
 *   dig    the hermit crab digs (every 4-8 minutes)                         12%
 *   ride   a jelly rides the bubbler to the top where you can see it        6%
 * The day's first two finds come at those rates, the next two at 40% of them, any more at 10%: a casual day
 * (ten spots, a little sifting) turns up about 1.2, 1.7 with the crab and the bubbler, and a long session about 4.
 *
 * What a find is: sea glass (55%) or a shell (45%), then by weight within its set. A kind not found yet weighs
 * NEW_BOOST + NEW_DRY x (finds since the last new kind) times its usual weight, so the rare ones (cobalt, red,
 * the nautilus) do turn up and both sets fill in 14-26 finds (median 19): 12-17 days of casual play. While today's
 * "Find a piece of sea glass" request is open, sea glass is GLASS_WANTED of finds. A duplicate is kept (the
 * count goes up) and pays its `dup` in sand dollars.
 *
 * Sets: all five colours of sea glass leave a sea-glass wind chime hanging from the hood (decoration 11, shop
 * item 36); all five shells a shell grotto (decoration 12, shop item 37). The shop never sells them.
 */

export type FindSource = "scrub" | "sift" | "dig" | "ride";
export const FIND_SOURCES: readonly FindSource[] = ["scrub", "sift", "dig", "ride"];

/** The two sets. */
export const GLASS = 0;
export const SHELLS = 1;

export interface FindItem {
  /** the art and the journal's key (sg{index} in journal-art.json) */
  key: string;
  name: string;
  set: number;
  /** relative weight inside its set (each set's add to 100) */
  weight: number;
  /** sand dollars a duplicate pays */
  dup: number;
  /** 0 common, 1 rare, 2 very rare (the drawer's label) */
  rare: number;
}

export const FIND_ITEMS: readonly FindItem[] = [
  { key: "green", name: "Green sea glass", set: GLASS, weight: 34, dup: 2, rare: 0 },
  { key: "brown", name: "Brown sea glass", set: GLASS, weight: 30, dup: 2, rare: 0 },
  { key: "white", name: "White sea glass", set: GLASS, weight: 25, dup: 2, rare: 0 },
  { key: "cobalt", name: "Cobalt sea glass", set: GLASS, weight: 8, dup: 5, rare: 1 },
  { key: "red", name: "Red sea glass", set: GLASS, weight: 3, dup: 10, rare: 2 },
  { key: "cowrie", name: "Cowrie shell", set: SHELLS, weight: 30, dup: 2, rare: 0 },
  { key: "scallop", name: "Scallop shell", set: SHELLS, weight: 30, dup: 2, rare: 0 },
  { key: "conch", name: "Conch shell", set: SHELLS, weight: 22, dup: 3, rare: 0 },
  { key: "fossil", name: "Sand dollar fossil", set: SHELLS, weight: 14, dup: 3, rare: 0 },
  { key: "nautilus", name: "Nautilus shell", set: SHELLS, weight: 4, dup: 6, rare: 1 },
];
export const FIND_N = FIND_ITEMS.length;

export interface FindSet {
  title: string;
  /** the journal's line under it */
  hint: string;
  items: readonly number[];
  /** the shop item and the decoration it leaves */
  item: number;
  decor: number;
  /** what it's called in a sentence */
  reward: string;
  /** the unlock note */
  note: string;
}

export const FIND_SETS: readonly FindSet[] = [
  {
    title: "Sea glass rainbow", hint: "Every colour of sea glass", items: [0, 1, 2, 3, 4], item: 36, decor: 11, reward: "a sea-glass wind chime",
    note: "Every colour of sea glass, even the red. They're strung on a wind chime now, hanging from the hood.",
  },
  {
    title: "Shell shelf", hint: "All five shells", items: [5, 6, 7, 8, 9], item: 37, decor: 12, reward: "a shell grotto",
    note: "All five shells, nautilus and all. They line a little grotto on the sand now.",
  },
];
export const FIND_SET_N = FIND_SETS.length;

/** Chance of a find per event, by source. */
export const FIND_CHANCE: Readonly<Record<FindSource, number>> = { scrub: 0.12, sift: 0.06, dig: 0.12, ride: 0.06 };
/** px of sponge rubbed over the sand per sift. */
export const SIFT_STEP = 480;
/** the share of finds that are sea glass, normally and while the sea-glass request is open */
export const GLASS_SHARE = 0.55;
export const GLASS_WANTED = 0.85;
/** an unfound kind's weight is multiplied by NEW_BOOST + NEW_DRY * (finds since the last new kind) */
export const NEW_BOOST = 4;
export const NEW_DRY = 2;
/** how much the day's finds so far slow the next one down */
export const dayFactor = (today: number): number => (today < 2 ? 1 : today < 4 ? 0.4 : 0.1);
/** the most of one kind the save keeps count of */
const COUNT_MAX = 9999;

/** The optional `finds` save field (absent until the first find). */
export interface FindSave {
  /** how many of each kind found, all time (index = FIND_ITEMS) */
  n: number[];
  /** sets completed, a bitmask by set: each one's reward is granted once */
  sets: number;
  /** the local day (YYYY-MM-DD) of the last find, and how many that day */
  day: string;
  today: number;
  /** finds since the last new kind */
  dry: number;
}

export const newFinds = (): FindSave => ({ n: Array.from({ length: FIND_N }, () => 0), sets: 0, day: "", today: 0, dry: 0 });
export const copyFinds = (f: FindSave): FindSave => ({ ...f, n: [...f.n] });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALL_SETS = (1 << FIND_SET_N) - 1;
const count = (v: unknown, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.floor(v))) : 0);

/** A saved `finds`, repaired; null when there isn't one. A set only counts as done if its kinds are all there. */
export function findsOf(raw: unknown): FindSave | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = Array.from({ length: FIND_N }, (_, i) => count(Array.isArray(o.n) ? o.n[i] : 0, COUNT_MAX));
  const f: FindSave = {
    n,
    sets: 0,
    day: typeof o.day === "string" && DAY_RE.test(o.day) ? o.day : "",
    today: count(o.today, 1000),
    dry: count(o.dry, 1000),
  };
  f.sets = count(o.sets, ALL_SETS) & ALL_SETS & completeSets(f);
  return f;
}

/** Sets whose every kind has been found (a bitmask), whether or not they've been granted yet. */
export function completeSets(f: Pick<FindSave, "n">): number {
  return FIND_SETS.reduce((m, s, i) => (s.items.every((k) => (f.n[k] ?? 0) > 0) ? m | (1 << i) : m), 0);
}

export const setDone = (f: Pick<FindSave, "sets">, set: number): boolean => (f.sets & (1 << set)) !== 0;
/** How many of set's kinds have been found (0..5). */
export const setProgress = (f: Pick<FindSave, "n">, set: number): number => FIND_SETS[set]?.items.filter((k) => (f.n[k] ?? 0) > 0).length ?? 0;
/** Kinds found at least once. */
export const kindsFound = (f: Pick<FindSave, "n">): number => f.n.filter((c) => c > 0).length;

/** Finds already made on `day` (0 if the last was another day). */
export const findsToday = (f: FindSave | null, day: string): number => (f && f.day === day ? f.today : 0);

/** The chance a `src` event turns up a find on `day`, given the finds so far. */
export function findChance(src: FindSource, f: FindSave | null, day: string): number {
  return (FIND_CHANCE[src] ?? 0) * dayFactor(findsToday(f, day));
}

/** Each kind's weight for the next find: its set's share, its weight in the set, boosted if not found yet. */
export function findWeights(f: FindSave | null, glassWanted = false): number[] {
  const glass = glassWanted ? GLASS_WANTED : GLASS_SHARE;
  const boost = NEW_BOOST + NEW_DRY * (f?.dry ?? 0);
  return FIND_ITEMS.map((it, i) => (it.set === GLASS ? glass : 1 - glass) * (it.weight / 100) * ((f?.n[i] ?? 0) > 0 ? 1 : boost));
}

/** Which kind a find is, from a 0..1 random. */
export function pickFind(f: FindSave | null, r: number, glassWanted = false): number {
  const w = findWeights(f, glassWanted);
  const total = w.reduce((a, b) => a + b, 0);
  let x = Math.min(0.999999, Math.max(0, r)) * total;
  for (let i = 0; i < w.length; i++) {
    x -= w[i]!;
    if (x < 0) return i;
  }
  return w.length - 1;
}

export interface Added {
  /** the first of its kind */
  first: boolean;
  /** sand dollars a duplicate pays (0 for a new one) */
  pay: number;
  /** sets this find just completed (each comes once: grant their rewards) */
  sets: number[];
}

/** Keep a find of kind `item` made on `day`: counts, the day's tally, the dry streak and any set it completes. */
export function addFind(f: FindSave, item: number, day: string): Added {
  const it = FIND_ITEMS[item];
  if (!it) return { first: false, pay: 0, sets: [] };
  const first = (f.n[item] ?? 0) === 0;
  f.n[item] = Math.min(COUNT_MAX, (f.n[item] ?? 0) + 1);
  f.today = f.day === day ? f.today + 1 : 1;
  f.day = DAY_RE.test(day) ? day : f.day;
  f.dry = first ? 0 : f.dry + 1;
  const sets: number[] = [];
  const done = completeSets(f);
  FIND_SETS.forEach((_, s) => {
    if (done & (1 << s) && !setDone(f, s)) {
      f.sets |= 1 << s;
      sets.push(s);
    }
  });
  return { first, pay: first ? 0 : it.dup, sets };
}

/** The set (if any) whose reward is shop item i, else -1. */
export const setOfItem = (i: number): number => FIND_SETS.findIndex((s) => s.item === i);
/** The set (if any) whose reward is decoration d, else -1. */
export const setOfDecor = (d: number): number => FIND_SETS.findIndex((s) => s.decor === d);
