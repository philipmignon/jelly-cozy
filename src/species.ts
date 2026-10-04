/**
 * World geometry and species tables for the tank sim. Pure data + helpers.
 * Reads `contract.json` (exported by tools/gen.py) and falls back to the
 * approximate values in docs/v2-spec.md for any key the contract lacks.
 */
import contract from "./contract.json";
import { SEASONS } from "./season";
import { GEL_N } from "./gels";
import { FIND_N } from "./finds";

export interface Body {
  /** half body width */
  halfW: number;
  /** how far the body extends above the slot origin */
  top: number;
  /** how far tentacles/arms reach below the slot origin */
  reach: number;
}

export interface Contract {
  P: number;
  LW: number;
  LH: number;
  W: number;
  H: number;
  waterTop: number;
  waterBot: number;
  glassL: number;
  glassR: number;
  sandTop: number[];
  cabTop: number;
  foodN: number;
  barW: number;
  props: string[];
  /** the props that live in the global view model (World): written through its instance, not the artboard's */
  globals?: { name: string; props: string[] };
  polypAnchors?: unknown;
  settleSpots?: unknown;
  bodies?: unknown;
  shopOpenY?: unknown;
  shopClosedY?: unknown;
  buttons?: unknown;
  /** v3: per decor { name, x, y, w, h }: default base point (bottom-centre) and hit box */
  decor?: unknown;
  /** v3: { dx, dy, r }: pearl centre relative to the clam's base point, tap radius */
  pearl?: unknown;
  snailSize?: unknown;
  shrimpSize?: unknown;
  crabSize?: unknown;
  shopCards?: unknown;
  shopTabs?: unknown;
  tabAwayY?: unknown;
  /** v5: [{ worldW, maxJellies, price }] per tank tier */
  tiers?: unknown;
  /** v5: [{ x0, x1, tier }] open-sand ranges (world x) the shrimp and crab keep to */
  openSand?: unknown;
  /** v5: [{ x0, x1, tier }] the world x span decorations may occupy from that tier on */
  decorRange?: unknown;
  /** v8: how many dirt spots the glass holds, and half a spot's art extent (artboard px) */
  spotN?: unknown;
  spotR?: unknown;
}

export const K = contract as unknown as Contract;
export const P = K.P;

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** Snap to the pixel grid (never -0). */
export const snap = (v: number) => Math.round(v / P) * P + 0;

/**
 * Top of the sand under world x. sandTop is indexed by logical x and may cover only the
 * first 720 (v2-v4 contracts) or the whole 1440 world; past its end this is gen.py's own
 * sand_top() formula (which reproduces the exported 720 exactly).
 */
export const sandAt = (x: number) => {
  const i = Math.floor((Number.isFinite(x) ? x : 0) / P);
  const st = K.sandTop;
  if (i < 0) return st[0] ?? 960;
  if (i < st.length) return st[i] ?? 960;
  return (318 + Math.round(3 * Math.sin(i * 0.05) + 2 * Math.sin(i * 0.13 + 1))) * P;
};

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// ---------------------------------------------------------------- tank tiers (v5)

export interface Tier {
  /** world width: the right wall's x */
  worldW: number;
  maxJellies: number;
  /** shop price (0 for the starter tank) */
  price: number;
}
const TIER_FALLBACK: Tier[] = [
  { worldW: 720, maxJellies: 3, price: 0 },
  { worldW: 1080, maxJellies: 5, price: 150 },
  { worldW: 1440, maxJellies: 7, price: 400 },
];
/** Small, Medium, Large: from contract.tiers, entry by entry, falling back to docs/v5-spec.md. */
export const TIERS: readonly Tier[] = (() => {
  const raw = Array.isArray(K.tiers) ? K.tiers : [];
  let prevW = K.W;
  return TIER_FALLBACK.map((fb, i) => {
    const o = obj(raw[i]);
    const w = num(o.worldW);
    const m = num(o.maxJellies);
    const pr = num(o.price);
    const worldW = w !== null && w >= prevW ? Math.round(w / P) * P : Math.max(prevW, fb.worldW);
    prevW = worldW;
    return {
      worldW,
      maxJellies: m !== null && m >= 1 && m <= 12 ? Math.round(m) : fb.maxJellies,
      price: pr !== null && pr >= 0 ? Math.round(pr) : fb.price,
    };
  });
})();
export const TIER_N = TIERS.length;
/** Jelly slots j0..j6: the biggest tank's max. */
export const MAX_SLOTS = Math.max(...TIERS.map((t) => t.maxJellies));
export const worldWOf = (tier: number) => TIERS[clamp(Math.round(tier), 0, TIER_N - 1)]!.worldW;
export const maxJelliesOf = (tier: number) => TIERS[clamp(Math.round(tier), 0, TIER_N - 1)]!.maxJellies;
/** World x of the inside of the right glass for a world this wide (the left glass stays at K.glassL). */
export const glassRightOf = (worldW: number) => worldW - (K.W - K.glassR);

/** The tier a contract entry is tagged with (untagged = 0, the starter tank). */
const tierTag = (v: unknown): number => {
  const t = num(obj(v).tier);
  return t === null ? 0 : clamp(Math.round(t), 0, TIER_N - 1);
};

/**
 * Per tier: the contract's entries for that tier when it has any, else the fallback's.
 * Sorted by tier (stable), so tier-0 indices stay what v2-v4 saves recorded.
 */
function byTier<T extends { x: number; tier: number }>(fromContract: T[], fallback: T[]): T[] {
  const out: T[] = [];
  for (let t = 0; t < TIER_N; t++) {
    const w = TIERS[t]!.worldW;
    const ok = (e: T) => e.tier === t && e.x > 0 && e.x < w;
    const c = fromContract.filter(ok);
    out.push(...(c.length ? c : fallback.filter(ok)));
  }
  return out;
}

/** Accepts [x, y] or {x, y}. */
function toPoint(v: unknown): { x: number; y: number } | null {
  if (Array.isArray(v)) {
    const x = num(v[0]);
    const y = num(v[1]);
    return x !== null && y !== null ? { x, y } : null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const x = num(o.x);
    const y = num(o.y);
    return x !== null && y !== null ? { x, y } : null;
  }
  return null;
}

export interface Anchor {
  x: number;
  y: number;
  /** the tank tier that makes it available */
  tier: number;
}

/**
 * Polyp anchors: base of the stalk on a rock, world units, tier-tagged (contract.polypAnchors).
 * FALLBACK: tier 0 is the v2 three; tiers 1 and 2 are invented rock tops at the edges of the
 * new zones (the Medium reef and the Large cave), two each, so 3 / 5 / 7 match the jelly max.
 */
const ANCHOR_FALLBACK: Anchor[] = [
  { x: 90, y: 933, tier: 0 },
  { x: 156, y: 966, tier: 0 },
  { x: 666, y: 969, tier: 0 },
  { x: 777, y: 951, tier: 1 },
  { x: 1029, y: 945, tier: 1 },
  { x: 1137, y: 954, tier: 2 },
  { x: 1386, y: 942, tier: 2 },
];
export const POLYP_ANCHORS: readonly Anchor[] = byTier(
  (Array.isArray(K.polypAnchors) ? K.polypAnchors : []).flatMap((v): Anchor[] => {
    const p = toPoint(v);
    return p ? [{ ...p, tier: tierTag(v) }] : [];
  }),
  ANCHOR_FALLBACK,
);

/**
 * Where settled upside-down jellies rest: x on the sand, y = sand top there unless the contract
 * says otherwise; tier-tagged (contract.settleSpots: numbers = tier 0, or {x, tier}).
 * FALLBACK: tier 0 is the v2 three; tiers 1 and 2 get two each on their open sand.
 */
const SPOT_FALLBACK: Anchor[] = [
  [240, 0],
  [384, 0],
  [570, 0],
  [864, 1],
  [954, 1],
  [1215, 2],
  [1314, 2],
].map(([x, tier]) => ({ x: x!, y: sandAt(x!), tier: tier! }));
export const SETTLE_SPOTS: readonly Anchor[] = byTier(
  (Array.isArray(K.settleSpots) ? K.settleSpots : []).flatMap((v): Anchor[] => {
    const n = num(v);
    if (n !== null) return [{ x: n, y: sandAt(n), tier: 0 }];
    const o = obj(v);
    const x = num(o.x);
    return x === null ? [] : [{ x, y: num(o.y) ?? sandAt(x), tier: tierTag(v) }];
  }),
  SPOT_FALLBACK,
);

export const SHOP_OPEN_Y = num(K.shopOpenY) ?? 0;
export const SHOP_CLOSED_Y = num(K.shopClosedY) ?? 1500;

/** Centre of a named button from `contract.buttons`, whatever shape gen.py chose; null if absent. */
export function buttonCentre(name: string): { x: number; y: number } | null {
  const raw = K.buttons;
  let b: unknown = null;
  if (Array.isArray(raw)) b = raw.find((e) => e && typeof e === "object" && (e as Record<string, unknown>).name === name);
  else if (raw && typeof raw === "object") b = (raw as Record<string, unknown>)[name];
  if (!b) return null;
  if (Array.isArray(b)) {
    const [x, y, w, h] = b.map(num);
    if (x == null || y == null) return null;
    return { x: x + (w ?? 0) / 2, y: y + (h ?? 0) / 2 };
  }
  if (typeof b === "object") {
    const o = b as Record<string, unknown>;
    const x = num(o.x);
    const y = num(o.y);
    if (x === null || y === null) return null;
    return { x: x + (num(o.w) ?? num(o.width) ?? 0) / 2, y: y + (num(o.h) ?? num(o.height) ?? 0) / 2 };
  }
  return null;
}

// ---------------------------------------------------------------- species & stages

export type Species = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Stage = 0 | 1 | 2 | 3;
export const MOON: Species = 0;
export const BLUBBER: Species = 1;
export const UPSIDE: Species = 2;
export const COMB: Species = 3;
export const FRIED: Species = 4;
export const NETTLE: Species = 5;
export const CRYSTAL: Species = 6;
export const FLOWER: Species = 7;
export const LION: Species = 8;
export const SPECIES_N = 9;
const ALL_SPECIES = Array.from({ length: SPECIES_N }, (_, k) => k as Species);
/** Display names for the jelly card, by species index. */
export const SPECIES_NAMES = [
  "Moon jelly", "Blue blubber", "Upside-down jelly", "Comb jelly",
  "Fried egg jelly", "Sea nettle", "Crystal jelly", "Flower hat jelly", "Lion's mane",
] as const;
export const POLYP: Stage = 0;
export const EPHYRA: Stage = 1;
export const JUVENILE: Stage = 2;
export const ADULT: Stage = 3;

/** Moon adult: the v1 bell. Widest frame 62 logical px, tallest 40, oral arms reach ~63 below the rim. */
const MOON_ADULT: Body = { halfW: 31 * P, top: 40 * P, reach: 190 };
const scaled = (b: Body, f: number): Body => ({ halfW: Math.round(b.halfW * f), top: Math.round(b.top * f), reach: Math.round(b.reach * f) });
const POLYP_BODY: Body = { halfW: 15, top: 54, reach: 0 };
const EPHYRA_BODY: Body = { halfW: 24, top: 20, reach: 20 };
const ADULTS: Record<Species, Body> = {
  0: MOON_ADULT,
  1: { halfW: 90, top: 108, reach: 120 }, // chunky bell, short thick arms
  2: { halfW: 84, top: 72, reach: 0 }, // settled: flat bell on the sand, arms wave upward
  3: { halfW: 54, top: 75, reach: 210 }, // egg body around its centre, two long trailing tentacles
  // fallbacks only: gen.py measures the real bodies into contract.bodies
  4: { halfW: 90, top: 66, reach: 66 }, // flat disc and yolk dome, short club arms
  5: { halfW: 81, top: 114, reach: 280 }, // striped dome, very long tentacles
  6: { halfW: 87, top: 84, reach: 120 }, // flat glassy dome, short fringe
  7: { halfW: 84, top: 150, reach: 45 }, // small bell, tentacles curl up over it
  8: { halfW: 120, top: 150, reach: 360 }, // the giant: a curtain of a mane
};

function contractBody(k: number, g: number): Body | null {
  const all = K.bodies;
  if (!Array.isArray(all)) return null;
  const row: unknown = all[k];
  if (!Array.isArray(row)) return null;
  const b: unknown = row[g];
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const halfW = num(o.halfW);
  const top = num(o.top);
  const reach = num(o.reach);
  return halfW !== null && top !== null && reach !== null ? { halfW, top, reach } : null;
}

export function bodyOf(k: Species, g: Stage): Body {
  const c = contractBody(k, g);
  if (c) return c;
  if (g === POLYP) return POLYP_BODY;
  if (g === EPHYRA) return EPHYRA_BODY;
  return g === ADULT ? ADULTS[k] : scaled(ADULTS[k], 0.6);
}

export interface Geom {
  body: Body;
  /** the swimmer's origin never sinks lower than this above the sand, so its arms still reach the sand */
  rimAbove: number;
  /** soft swim bounds for the origin: springs push it back inside */
  bounds: { x0: number; x1: number; y0: number; y1: number };
  /** hard limits: the whole body stays in the water, 2 px clear of the glass */
  hard: { x0: number; x1: number; y0: number };
}

function makeGeom(b: Body): Geom {
  const rimAbove = b.reach >= 60 ? b.reach - 30 : Math.max(b.reach + 6, 20);
  return {
    body: b,
    rimAbove,
    bounds: {
      x0: K.glassL + b.halfW + 8 * P,
      x1: K.glassR - b.halfW - 8 * P,
      y0: K.waterTop + b.top + 11 * P,
      y1: 810 + 160 - rimAbove,
    },
    hard: { x0: K.glassL + b.halfW + 2 * P, x1: K.glassR - b.halfW - 2 * P, y0: K.waterTop + 10 + b.top },
  };
}

const GEOMS: Geom[][] = ALL_SPECIES.map((k) => ([0, 1, 2, 3] as Stage[]).map((g) => makeGeom(bodyOf(k, g))));
export const geomOf = (k: Species, g: Stage): Geom => GEOMS[k]![g]!;

// ---------------------------------------------------------------- movement

export interface PulseParams {
  glide: false;
  /** seconds per pulse when wandering / when chasing food or a tap */
  idle: number;
  busy: number;
  /** peak thrust during the squeeze */
  forceIdle: number;
  forceBusy: number;
  /** fraction of the cycle spent squeezing */
  squeeze: number;
  /** seconds before a wander target is replaced: min + rand * spread */
  wanderMin: number;
  wanderSpread: number;
  /** random sideways kick at the start of each pulse, px/s */
  twitch: number;
}

export interface GlideParams {
  glide: true;
  speedIdle: number;
  speedBusy: number;
  /** how quickly velocity eases toward the desired velocity, 1/s */
  ease: number;
  /** seconds per comb-row shimmer cycle */
  shimmer: number;
  wanderMin: number;
  wanderSpread: number;
}

export const MOON_SWIM: PulseParams = { glide: false, idle: 2.1, busy: 1.15, forceIdle: 210, forceBusy: 350, squeeze: 0.3, wanderMin: 6, wanderSpread: 5, twitch: 0 };
export const BLUBBER_SWIM: PulseParams = { glide: false, idle: 1.45, busy: 0.85, forceIdle: 290, forceBusy: 460, squeeze: 0.25, wanderMin: 2.5, wanderSpread: 3, twitch: 10 };
export const EPHYRA_SWIM: PulseParams = { glide: false, idle: 0.7, busy: 0.45, forceIdle: 170, forceBusy: 260, squeeze: 0.35, wanderMin: 2.5, wanderSpread: 3, twitch: 30 };
/** v6 species: a stately fried egg, an elegant nettle, a gentle crystal, a hopping flower hat, a majestic lion's mane. */
export const FRIED_SWIM: PulseParams = { glide: false, idle: 2.6, busy: 1.5, forceIdle: 170, forceBusy: 290, squeeze: 0.3, wanderMin: 7, wanderSpread: 6, twitch: 0 };
export const NETTLE_SWIM: PulseParams = { glide: false, idle: 2.3, busy: 1.3, forceIdle: 200, forceBusy: 330, squeeze: 0.3, wanderMin: 6, wanderSpread: 6, twitch: 0 };
export const CRYSTAL_SWIM: PulseParams = { glide: false, idle: 2.5, busy: 1.4, forceIdle: 180, forceBusy: 300, squeeze: 0.28, wanderMin: 7, wanderSpread: 6, twitch: 0 };
/** short hops with long rests near the bottom (sim keeps its wander targets low) */
export const FLOWER_SWIM: PulseParams = { glide: false, idle: 3.4, busy: 1.2, forceIdle: 240, forceBusy: 360, squeeze: 0.22, wanderMin: 4, wanderSpread: 4, twitch: 8 };
export const LION_SWIM: PulseParams = { glide: false, idle: 3.0, busy: 1.8, forceIdle: 240, forceBusy: 340, squeeze: 0.34, wanderMin: 9, wanderSpread: 7, twitch: 0 };
/** Species that keep to the lower part of the tank when they wander. */
export const BOTTOM_DWELLERS: readonly Species[] = [FLOWER];
export const COMB_GLIDE: GlideParams = { glide: true, speedIdle: 26, speedBusy: 48, ease: 0.9, shimmer: 0.9, wanderMin: 8, wanderSpread: 6 };

/** Juvenile and adult swim like their species; every ephyra is quick and twitchy. */
export function swimOf(k: Species, g: Stage): PulseParams | GlideParams {
  if (g <= EPHYRA) return EPHYRA_SWIM;
  if (k === BLUBBER) return BLUBBER_SWIM;
  if (k === COMB) return COMB_GLIDE;
  if (k === FRIED) return FRIED_SWIM;
  if (k === NETTLE) return NETTLE_SWIM;
  if (k === CRYSTAL) return CRYSTAL_SWIM;
  if (k === FLOWER) return FLOWER_SWIM;
  if (k === LION) return LION_SWIM;
  return MOON_SWIM;
}

// ---------------------------------------------------------------- trailing tentacles

/**
 * Trail poses (contract `trailPoses`, view props j{s}tr0..tr4, one-hot). Each pose has its own
 * four sway frames (tf). TRAIL_L / TRAIL_R name the side the streak trails to: a jelly moving
 * right trails its tentacles to the left.
 */
export const TRAIL_FAN = 0;
export const TRAIL_NEUTRAL = 1;
export const TRAIL_STREAM = 2;
export const TRAIL_L = 3;
export const TRAIL_R = 4;
export const TRAIL_N = 5;

/** Speeds are artboard px/s, measured on the eased (low-passed) velocity. */
export interface TrailParams {
  /** stream (straight or swept) once the eased speed passes `streamIn`; drop back below `streamOut` */
  streamIn: number;
  streamOut: number;
  /** fan out once sinking faster than `fanIn` (eased vy, down positive); relax back below `fanOut` */
  fanIn: number;
  fanOut: number;
  /** also fan out when nearly still (gliders only; 0 = off): below `restIn`, until above `restOut` */
  restIn: number;
  restOut: number;
  /** sideways/upward speed ratio that sweeps the streak to one side, and the ratio that straightens it again */
  sweptIn: number;
  sweptOut: number;
  /** velocity easing time constant, s */
  tau: number;
  /** a pose is held at least this long before it can change, s */
  hold: number;
}

/**
 * Bell pulsers peak around 30-40 px/s upward a few tenths of a second into a pulse and sink at
 * 11-15 px/s between pulses; the comb glides at a steady 26-48 px/s and never sinks.
 */
export const PULSE_TRAIL: TrailParams = { streamIn: 14, streamOut: 8, fanIn: 6, fanOut: 2, restIn: 0, restOut: 0, sweptIn: 1, sweptOut: 0.6, tau: 0.12, hold: 0.18 };
export const GLIDE_TRAIL: TrailParams = { streamIn: 12, streamOut: 7, fanIn: 10, fanOut: 5, restIn: 4, restOut: 6, sweptIn: 1, sweptOut: 0.6, tau: 0.25, hold: 0.3 };

/** Juvenile and adult moon, blubber and comb trail; polyps, ephyrae and upside-downs (arms up) don't. */
export function trailsOf(k: Species, g: Stage): boolean {
  return g >= JUVENILE && k !== UPSIDE && k !== FLOWER;
}

export function trailOf(k: Species, g: Stage): TrailParams {
  return swimOf(k, g).glide ? GLIDE_TRAIL : PULSE_TRAIL;
}

/** Seconds per sway cycle (polyp) and per slow in-place pulse (settled upside-down). */
export const POLYP_SWAY = 2.6;
export const SETTLED_PULSE = 3.2;
/** Food within this distance drifts toward a polyp (and a settled upside-down). */
export const LURE_RADIUS = 120;

// ---------------------------------------------------------------- growth & economy

/** Cumulative growth points to reach each stage. */
export const GROWTH = [0, 4, 12, 30] as const;
/** Dollars for reaching each stage. */
export const STAGE_REWARD = [0, 5, 5, 20] as const;
/** Good care earns one growth point per this many seconds. */
export const CARE_SECONDS = 60;
export const AWAY_GROWTH_CAP = 8;
export const MAX_DOLLARS = 9999;
export const PET_COOLDOWN = 20;
export const EARN = { meal: 1, clean: 3, pet: 1 } as const;

// ---------------------------------------------------------------- v11: foods and favourites

/** What a pellet is: 0 flakes (the can, always owned), 1 brine shrimp (a jar), 2 plankton (a bottle). */
export type FoodKind = 0 | 1 | 2;
export const FLAKES: FoodKind = 0;
export const BRINE: FoodKind = 1;
export const PLANKTON: FoodKind = 2;
export const FOOD_KINDS = 3;
/** Display names, by food kind (for the journal: "Favourite food: Brine shrimp"). */
export const FOOD_NAMES = ["Flakes", "Brine shrimp", "Plankton"] as const;
/**
 * Each species' favourite food. Small-mouthed, plankton-sieving bells (moon, comb, crystal, flower hat)
 * like plankton; the big-armed hunters and the upside-down's frilly arms (blubber, upside-down, fried
 * egg, sea nettle, lion's mane) like brine shrimp. Nobody's favourite is flakes: they're the staple.
 */
export const FAVOURITE: Record<Species, FoodKind> = {
  0: PLANKTON, // moon
  1: BRINE, // blue blubber
  2: BRINE, // upside-down
  3: PLANKTON, // comb
  4: BRINE, // fried egg
  5: BRINE, // sea nettle
  6: PLANKTON, // crystal
  7: PLANKTON, // flower hat
  8: BRINE, // lion's mane
};
/** The species' favourite food kind (FOOD_NAMES[favouriteFood(k)] is its name). */
export const favouriteFood = (k: Species): FoodKind => FAVOURITE[k] ?? FLAKES;
/** A meal: growth points (× the growth multiplier), fullness and affection, plain and favourite. */
export const MEAL = { gp: 1, full: 0.12, love: 0.04 } as const;
export const FAV_MEAL = { gp: 2, full: 0.16, love: 0.08 } as const;
/** A jelly choosing what to chase counts a favourite pellet this much nearer than it is. */
export const FAV_CHASE = 0.4;

// ---------------------------------------------------------------- v11: tank themes

/** 0 Reef (the default, always owned), 1 Kelp Forest, 2 Coral Garden, 3 Arctic; v13: 4 Moonlit Lagoon (a keepsake). */
export const THEME_N = 5;
export const THEME_NAMES = ["Reef", "Kelp Forest", "Coral Garden", "Arctic", "Moonlit Lagoon"] as const;

export type ShopItem =
  | { name: string; price: number; kind: "polyp"; k: Species; needTier?: number }
  | { name: string; price: number; kind: "decor"; d: number; keepsake?: number; collection?: number }
  | { name: string; price: number; kind: "helper"; h: number }
  | { name: string; price: number; kind: "tank"; tier: number }
  | { name: string; price: number; kind: "food"; f: FoodKind }
  | { name: string; price: number; kind: "theme"; theme: number; keepsake?: number }
  // ---- lamp gels ---- a coloured filter for the lamp (./gels.ts); ---- temperature ---- the heater (+1), the chiller (-1)
  | { name: string; price: number; kind: "gel"; gel: number }
  | { name: string; price: number; kind: "climate"; dir: 1 | -1 }
  // ---- nursery ---- the nursery bowl (bought once)
  | { name: string; price: number; kind: "nursery" };
export const SHOP_ITEMS: readonly ShopItem[] = [
  { name: "BLUE BLUBBER", price: 40, kind: "polyp", k: BLUBBER },
  { name: "UPSIDE-DOWN", price: 70, kind: "polyp", k: UPSIDE },
  { name: "COMB JELLY", price: 110, kind: "polyp", k: COMB },
  { name: "CASTLE", price: 25, kind: "decor", d: 0 },
  { name: "ANCHOR", price: 20, kind: "decor", d: 1 },
  { name: "DIVE HELMET", price: 35, kind: "decor", d: 2 },
  { name: "GIANT CLAM", price: 30, kind: "decor", d: 3 },
  { name: "GLOW CORAL", price: 45, kind: "decor", d: 4 },
  { name: "SNAIL", price: 30, kind: "helper", h: 0 },
  { name: "CLEANER SHRIMP", price: 40, kind: "helper", h: 1 },
  { name: "HERMIT CRAB", price: 50, kind: "helper", h: 2 },
  { name: "MEDIUM TANK", price: TIERS[1]!.price, kind: "tank", tier: 1 },
  { name: "LARGE TANK", price: TIERS[2]!.price, kind: "tank", tier: 2 },
  { name: "FRIED EGG", price: 60, kind: "polyp", k: FRIED },
  { name: "SEA NETTLE", price: 90, kind: "polyp", k: NETTLE },
  { name: "CRYSTAL JELLY", price: 130, kind: "polyp", k: CRYSTAL, needTier: 1 },
  { name: "FLOWER HAT", price: 160, kind: "polyp", k: FLOWER },
  { name: "LION'S MANE", price: 250, kind: "polyp", k: LION, needTier: 2 },
  // v11: foods (they join the can on the tool shelf) and tank themes (buying one applies it)
  { name: "BRINE SHRIMP", price: 40, kind: "food", f: BRINE },
  { name: "PLANKTON", price: 70, kind: "food", f: PLANKTON },
  { name: "REEF", price: 0, kind: "theme", theme: 0 },
  { name: "KELP FOREST", price: 140, kind: "theme", theme: 1 },
  { name: "CORAL GARDEN", price: 170, kind: "theme", theme: 2 },
  { name: "ARCTIC", price: 200, kind: "theme", theme: 3 },
  // v13: the bubbler (decoration 10, after the keepsakes): a column of bubbles the jellies ride
  { name: "BUBBLER", price: 80, kind: "decor", d: 10 },
  // v13 keepsakes (./keepsakes.ts): earned from the journal's milestones, never sold; `keepsake` = the milestone
  { name: "MESSAGE IN A BOTTLE", price: 0, kind: "decor", d: 5, keepsake: 0 },
  { name: "LIGHTHOUSE", price: 0, kind: "decor", d: 6, keepsake: 1 },
  { name: "JELLY LANTERN", price: 0, kind: "decor", d: 7, keepsake: 2 },
  { name: "SHIP'S WHEEL", price: 0, kind: "decor", d: 8, keepsake: 3 },
  { name: "POSTBOX", price: 0, kind: "decor", d: 9, keepsake: 4 },
  { name: "MOONLIT LAGOON", price: 0, kind: "theme", theme: 4, keepsake: 5 },
  // ---- lamp gels ---- (TANK tab): buying one puts it on the lamp; tap an owned one's card to use it (again: off)
  { name: "WARM GEL", price: 60, kind: "gel", gel: 1 },
  { name: "BLUE GEL", price: 80, kind: "gel", gel: 2 },
  { name: "UV GEL", price: 150, kind: "gel", gel: 3 },
  // ---- temperature ---- (SUPPLIES tab): units on the shelf's back wall; tap one to switch it on or off
  { name: "HEATER", price: 90, kind: "climate", dir: 1 },
  { name: "CHILLER", price: 110, kind: "climate", dir: -1 },
  // ---- sea glass ---- the collection's set rewards (./finds.ts): never sold, `collection` = the set that leaves it
  { name: "SEA-GLASS CHIME", price: 0, kind: "decor", d: 11, collection: 0 },
  { name: "SHELL GROTTO", price: 0, kind: "decor", d: 12, collection: 1 },
  // ---- end sea glass ----
  // ---- nursery ---- shop id 38. Nothing hard-codes the index: it is NURSERY_ITEM here, and gen.py finds its card by kind
  { name: "NURSERY", price: 120, kind: "nursery" },
];
/** v13: the milestone that earns shop item `it` (./keepsakes.ts), or -1 for anything the shop sells. */
export const keepsakeOf = (it: ShopItem | undefined): number => (it && (it.kind === "decor" || it.kind === "theme") ? it.keepsake ?? -1 : -1);
/** v16: the collection set that earns shop item `it` (./finds.ts), or -1. */
export const collectionOf = (it: ShopItem | undefined): number => (it && it.kind === "decor" ? it.collection ?? -1 : -1);
/** The shop item that sells food kind f (18 BRINE SHRIMP, 19 PLANKTON), -1 for flakes. */
export const foodItem = (f: number) => SHOP_ITEMS.findIndex((it) => it.kind === "food" && it.f === f);
/** The shop item for theme n (20 REEF .. 23 ARCTIC). */
export const themeItem = (n: number) => SHOP_ITEMS.findIndex((it) => it.kind === "theme" && it.theme === n);
/** ---- nursery ---- the shop item that sells the nursery bowl */
export const NURSERY_ITEM = SHOP_ITEMS.findIndex((it) => it.kind === "nursery");
/** The shop item that upgrades to tier t (11 MEDIUM, 12 LARGE). */
export const tankItem = (t: number) => SHOP_ITEMS.findIndex((it) => it.kind === "tank" && it.tier === t);
/** v13: decorations 0..4 are sold, 5..9 are keepsakes (from KEEP_DECOR0), 10 is the bubbler (sold, shop item 24);
 *  v16: 11 the sea-glass wind chime (hangs from the hood), 12 the shell grotto: the collection's set rewards */
export const DECOR_N = 13;
/** v16: the sea-glass wind chime and the shell grotto (./finds.ts FIND_SETS) */
export const SG_CHIME = 11;
export const SG_GROTTO = 12;
export const KEEP_DECOR0 = 5;
/** v13: the bubbler's decoration index (shop item 24) */
export const BUBBLER = 10;
export const HELPER_N = 3;
export const SNAIL = 0;
export const SHRIMP = 1;
export const CRAB = 2;
/** Shop tabs: JELLIES, DECOR, SUPPLIES (helpers + v11 foods), TANK (sizes + v11 themes), as item index ranges. */
export const TAB_ITEMS: readonly (readonly number[])[] = [
  [0, 13, 1, 14, 2, 15, 16, 17], // JELLIES scrolls (contract.shopScroll)
  [3, 4, 5, 6, 7, 24, 25, 26, 27, 28, 29, 36, 37], // v13: the bubbler, then the keepsakes (v16: and the collection's rewards); DECOR and TANK scroll too (contract.shopScrollTabs)
  [8, 9, 10, 18, 19, 34, 35], // ---- temperature ---- the heater and the chiller
  [11, 12, NURSERY_ITEM, 20, 21, 22, 23, 30, 31, 32, 33], // ---- nursery ---- beside the tank sizes; ---- lamp gels ---- after the themes
];
export const TAB_N = TAB_ITEMS.length;
/** A tab's card group sits at y 0 when active and this far away when not (so hidden cards can't be hit). */
export const TAB_HIDDEN_Y = num(K.tabAwayY) ?? 3000;

// ---------------------------------------------------------------- v3 tuning

/** Babies: an adult whose mood stays above this builds content time... */
export const BABY_MOOD = 0.7;
/** ...and releases a polyp every this many (growth-scaled) seconds of it. */
export const BABY_SECONDS = 600;
export const PEARL_REWARD = 15;
export const DIG_REWARD = 5;
/** the crab digs every DIG_MIN + rand * DIG_SPREAD seconds, for DIG_TIME seconds */
export const DIG_MIN = 240;
export const DIG_SPREAD = 240;
export const DIG_TIME = 2;
export const SNAIL_SPEED = 8;
export const SHRIMP_SPEED = 20;
/** the shrimp hurries when it has food to get to */
export const SHRIMP_FOOD_SPEED = 42;
export const SHRIMP_EAT_TIME = 1;
export const CRAB_SPEED = 11;
export const NAME_MAX = 12;
/** v7: a new jelly (a baby, or a bought polyp) is a rare colour morph this often. ?fast=1 doesn't change it. */
export const MORPH_CHANCE = 0.1;
/** v12 morph ids (SaveJelly.morph): 0 none, 1 classic (the v7 rare palette), 2 ghost (the Halloween palette), 3 frost (winter's). */
export const MORPH_NONE = 0;
export const MORPH_CLASSIC = 1;
export const MORPH_GHOST = 2;
export const MORPH_FROST = 3;
/** v16 (pairs): the colours only a pair's baby can have, dusk (classic x classic) and pearl (classic x ghost):
 *  ./pairs.ts. */
export const MORPH_DUSK = 4;
export const MORPH_PEARL = 5;
export const MORPH_IDS = 6;
/** The morph ids this build knows (anything else loads as none). */
export const MORPH_KNOWN: readonly number[] = [MORPH_NONE, MORPH_CLASSIC, MORPH_GHOST, MORPH_FROST, MORPH_DUSK, MORPH_PEARL];
/** v12: a morph parent's baby is the same morph this often (otherwise it rolls like a plain parent's). */
export const MORPH_INHERIT = 0.5;
/** v12: while a season offers a morph (SimOptions.seasonalMorph), a baby that rolled plain is that morph this often. */
export const SEASON_MORPH_CHANCE = 0.08;

// ---------------------------------------------------------------- polish round

export interface SandRange {
  x0: number;
  x1: number;
  tier: number;
}
/**
 * Open stretches of sand, world x, tier-tagged (contract.openSand). Outside them the shrimp and
 * crab would be hidden behind the scenery. Tier 0's is between the reef rocks (left) and the chest
 * (right). FALLBACK for the new zones: the sand between their invented anchors (see ANCHOR_FALLBACK).
 */
const SAND_FALLBACK: SandRange[] = [
  { x0: 186, x1: 450, tier: 0 },
  { x0: 810, x1: 1002, tier: 1 },
  { x0: 1176, x1: 1356, tier: 2 },
];
export const OPEN_SANDS: readonly SandRange[] = byTier(
  (Array.isArray(K.openSand) ? K.openSand : []).flatMap((v): (SandRange & { x: number })[] => {
    const o = obj(v);
    const x0 = num(o.x0);
    const x1 = num(o.x1);
    return x0 !== null && x1 !== null && x1 - x0 >= 60 ? [{ x0, x1, tier: tierTag(v), x: x0 }] : [];
  }),
  SAND_FALLBACK.map((r) => ({ ...r, x: r.x0 })),
).map(({ x0, x1, tier }) => ({ x0, x1, tier }));
/** The starter tank's open sand (the v4 OPEN_SAND). */
export const OPEN_SAND: { x0: number; x1: number } = (({ x0, x1 }) => ({ x0, x1 }))(OPEN_SANDS[0]!);
/** The open-sand ranges a tank of this tier has, sorted by x. */
export const openSandsOf = (tier: number) => OPEN_SANDS.filter((r) => r.tier <= tier).sort((a, b) => a.x0 - b.x0);
/** v8: the snail grazes dirt spots while murk is above this ("lightly cloudy"); scrubbing gets the glass clear. */
export const SNAIL_FLOOR = 0.3;
/** Dollars for rehoming a jelly, by stage (polyps and ephyras can't be rehomed). */
export const REHOME_PAY = [0, 0, 15, 30] as const;
/** Night by the local clock: from NIGHT_FROM:00 until DAY_FROM:00. */
export const NIGHT_FROM = 19;
export const DAY_FROM = 7;
/** Shorter absences get no "while you were away" summary, seconds. */
export const AWAY_SUMMARY_MIN = 600;
export const AWAY_LINES_MAX = 4;

// ---------------------------------------------------------------- v3 geometry (contract, with fallbacks)

type Rect = { x: number; y: number; w: number; h: number };

function toRect(v: unknown): Rect | null {
  if (Array.isArray(v)) {
    const [x, y, w, h] = v.map(num);
    return x != null && y != null && w != null && h != null ? { x, y, w, h } : null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const x = num(o.x);
    const y = num(o.y);
    const w = num(o.w) ?? num(o.width);
    const h = num(o.h) ?? num(o.height);
    return x !== null && y !== null && w !== null && h !== null ? { x, y, w, h } : null;
  }
  return null;
}

function toSize(v: unknown, fallback: { w: number; h: number }): { w: number; h: number } {
  if (!v || typeof v !== "object") return fallback;
  const o = v as Record<string, unknown>;
  const w = num(o.w) ?? num(o.width);
  const h = num(o.h) ?? num(o.height);
  return w !== null && h !== null && w > 0 && h > 0 ? { w, h } : fallback;
}

export interface DecorGeom {
  name: string;
  /** default base point (bottom-centre of the art) */
  x: number;
  y: number;
  /** hit box: x - w/2 .. x + w/2, y - h .. y */
  w: number;
  h: number;
  /** how far the default base sits below the sand top there; kept as it moves so front pieces stay in front */
  sink: number;
  /** x range that keeps the art inside the glass (always includes the default x) */
  x0: number;
  x1: number;
  /** v16: it hangs from the hood: its base y stays put wherever it's moved, and nothing on the sand is in its way */
  hang: boolean;
}

/** gen.py's v2 spots and the art's measured extents (half width taken from the wider side). */
const DECOR_FALLBACK: Rect[] = [
  { x: 339, y: 963, w: 90, h: 144 }, // castle
  { x: 51, y: 1047, w: 102, h: 93 }, // anchor
  { x: 591, y: 1047, w: 96, h: 69 }, // dive helmet
  { x: 348, y: 1047, w: 108, h: 72 }, // giant clam
  { x: 210, y: 1047, w: 90, h: 39 }, // glow coral
  // v13 keepsakes (gen.py's keepsakes block)
  { x: 282, y: 1047, w: 114, h: 39 }, // message in a bottle
  { x: 666, y: 1047, w: 78, h: 162 }, // lighthouse
  { x: 420, y: 1047, w: 60, h: 96 }, // jelly lantern
  { x: 138, y: 1047, w: 108, h: 78 }, // ship's wheel
  { x: 564, y: 1047, w: 54, h: 81 }, // postbox
  { x: 420, y: 1047, w: 138, h: 66 }, // v13: bubbler (decor 10)
  // ---- sea glass ---- (gen.py's sea glass block): the wind chime hangs from the hood (its base is the lowest bead)
  { x: 576, y: 186, w: 72, h: 144 }, // v16: sea-glass wind chime (decor 11)
  { x: 504, y: 1047, w: 120, h: 75 }, // v16: shell grotto (decor 12)
];
const DECOR_NAMES = ["Castle", "Anchor", "Helmet", "Clam", "GlowCoral", "Bottle", "Lighthouse", "Lantern", "Wheel", "Postbox", "Bubbler", "SgChime", "SgGrotto"];
/** v16: decorations that hang from the hood instead of standing on the sand (fallback; contract decor[n].hang) */
const HANG_FALLBACK = [SG_CHIME];

export const DECOR: DecorGeom[] = DECOR_FALLBACK.map((fb, n) => {
  const raw: unknown = Array.isArray(K.decor) ? K.decor[n] : null;
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const x = num(o.x) ?? fb.x;
  const y = num(o.y) ?? fb.y;
  const w = Math.max(P, num(o.w) ?? fb.w);
  const h = Math.max(P, num(o.h) ?? fb.h);
  const lo = Math.ceil((K.glassL + w / 2) / P) * P;
  const hi = Math.floor((K.glassR - w / 2) / P) * P;
  return {
    name: typeof o.name === "string" ? o.name : DECOR_NAMES[n]!,
    x,
    y,
    w,
    h,
    sink: y - sandAt(x),
    x0: Math.min(lo, x),
    x1: Math.max(hi, x),
    hang: typeof o.hang === "boolean" ? o.hang : HANG_FALLBACK.includes(n),
  };
});

/**
 * The world x span a decoration's art may occupy in a tank of this tier: the envelope of
 * contract.decorRange entries for tiers up to it, else inside the glass (left glass to the
 * tier's right glass).
 */
export function decorSpan(tier: number): { x0: number; x1: number } {
  const t = clamp(Math.round(tier), 0, TIER_N - 1);
  const rs = (Array.isArray(K.decorRange) ? K.decorRange : []).flatMap((v) => {
    const o = obj(v);
    const x0 = num(o.x0);
    const x1 = num(o.x1);
    return x0 !== null && x1 !== null && x1 > x0 && tierTag(v) <= t ? [{ x0, x1 }] : [];
  });
  const glass = { x0: K.glassL, x1: glassRightOf(TIERS[t]!.worldW) };
  if (!rs.length) return glass;
  return { x0: Math.max(glass.x0, Math.min(...rs.map((r) => r.x0))), x1: Math.min(glass.x1, Math.max(...rs.map((r) => r.x1))) };
}

/** Clamp a decoration's x so its art stays inside the tier's span (the glass), on the pixel grid. */
export const decorClampX = (n: number, x: number, tier = 0) => {
  const d = DECOR[n]!;
  const sp = tier === 0 && !Array.isArray(K.decorRange) ? null : decorSpan(tier);
  const lo = sp ? Math.min(d.x, Math.ceil((sp.x0 + d.w / 2) / P) * P) : d.x0;
  const hi = sp ? Math.max(d.x, Math.floor((sp.x1 - d.w / 2) / P) * P) : d.x1;
  return clamp(snap(Number.isFinite(x) ? x : d.x), lo, hi);
};
/** Base y for a decoration at x: the sand top there plus its default depth, never below the water's bottom edge. */
export const decorY = (n: number, x: number) => {
  const d = DECOR[n]!;
  if (d.hang) return d.y; // v16: it hangs from the hood
  return Math.min(Math.max(K.waterBot, d.y), snap(sandAt(x) + d.sink));
};

/** Pearl centre relative to the clam's base point, and its tap radius. Fallback measured from clam_art. */
export const PEARL: { dx: number; dy: number; r: number } = (() => {
  const o = K.pearl && typeof K.pearl === "object" ? (K.pearl as Record<string, unknown>) : {};
  return { dx: num(o.dx) ?? 0, dy: num(o.dy) ?? -33, r: Math.max(12, num(o.r) ?? 30) };
})();
export const CLAM = 3;

export const SNAIL_SIZE = toSize(K.snailSize, { w: 48, h: 36 });
export const SHRIMP_SIZE = toSize(K.shrimpSize, { w: 60, h: 36 });
export const CRAB_SIZE = toSize(K.crabSize, { w: 54, h: 42 });

/** Centre of shop card i when its tab is active (sparkle spot on purchase); null if the contract lacks it. */
export function shopCardCentre(i: number): { x: number; y: number } | null {
  const r = Array.isArray(K.shopCards) ? toRect(K.shopCards[i]) : null;
  return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
}

/** Every number the host writes, by the names in docs/v2-spec.md, v3, v5, v7 and v8-spec.md. */
export function specProps(foodN = K.foodN): string[] {
  const out = ["nightShade", "daylight", "sunO", "moonO", "murkShade"];
  // v8: dirt spots on the glass replace the algae layers
  const spotN = num((K as unknown as { spotN?: unknown }).spotN) ?? 12;
  for (let i = 0; i < spotN; i++) out.push(`spot${i}x`, `spot${i}y`, `spot${i}o`, `spot${i}v0`, `spot${i}v1`, `spot${i}v2`);
  for (let i = 0; i < foodN; i++) out.push(`food${i}x`, `food${i}y`, `food${i}o`);
  out.push("rx", "ry", "rs", "ro", "barFood", "barWater", "barMood", "b0y", "b1y", "b2y", "b3y");
  // v8: the held food can and sponge (the old sweeping sponge wipeX/wipeO is gone), and the buttons' held glow
  out.push("canX", "canY", "canO", "canF0", "canF1", "spongeX", "spongeY", "spongeO", "spongeF0", "spongeF1", "toolFood", "toolSponge");
  // v11: what each pellet is (one-hot), the brine shrimp jar and plankton bottle in hand and on the shelf, the theme
  for (let i = 0; i < foodN; i++) for (let k = 0; k < FOOD_KINDS; k++) out.push(`food${i}k${k}`);
  for (const c of ["jar", "bottle"]) out.push(`${c}X`, `${c}Y`, `${c}O`, `${c}F0`, `${c}F1`);
  out.push("toolShrimp", "toolPlankton", "haveShrimp", "havePlankton", "b4y", "b5y");
  for (let t = 0; t < THEME_N; t++) out.push(`theme${t}`);
  for (let s = 0; s < MAX_SLOTS; s++) for (const key of JELLY_KEYS) out.push(`j${s}${key}`);
  // v16 (pairs): the tiny sparkle a pair shares (world), its twinkle frames one-hot
  out.push("pairX", "pairY", "pairO", "pairF0", "pairF1", "pairF2");
  // seasonal events: each season's decor prop (evHalloween, evWinter)
  for (const season of SEASONS) out.push(season.prop);
  out.push("fxX", "fxY", "fxS", "fxO");
  for (let p = 0; p < 4; p++) for (let d = 0; d < 10; d++) out.push(`cd${p}n${d}`);
  out.push("shopY");
  SHOP_ITEMS.forEach((_, i) => out.push(`own${i}`, `lock${i}`));
  // v11: the "IN USE" badge on the active theme's card
  SHOP_ITEMS.forEach((it, i) => (it.kind === "theme" || it.kind === "gel") && out.push(`use${i}`)); // ---- lamp gels ---- theirs too
  // v15: the "STORED" badge on a decoration's card while it's put away
  SHOP_ITEMS.forEach((it, i) => it.kind === "decor" && out.push(`away${i}`));
  for (let t = 0; t < TAB_N; t++) out.push(`shopTab${t}`, `tab${t}Y`);
  for (let d = 0; d < DECOR_N; d++) out.push(`dec${d}`, `dec${d}x`, `dec${d}y`, `dec${d}lift`);
  out.push("dec4glow", "pearl");
  // v15: put away: the overlap outlines while carrying one, the drawer; reduce motion's `calm` for the .riv's own loops
  for (let d = 0; d < DECOR_N; d++) out.push(`dec${d}ov`);
  out.push("storeO", "storeY", "storeHot", "calm");
  // ---- sea glass ---- (v16) a find rising from where it was found and flying to the jar in the hood: where (screen),
  // how bright and big, its glow, which kind (sg{i}, one-hot); the jar (shown in the player's own tank) and its bump
  out.push("sgX", "sgY", "sgO", "sgS", "sgGlow", "sgJar", "sgJarS");
  for (let i = 0; i < FIND_N; i++) out.push(`sg${i}`);
  out.push("snailOn", "snailX", "snailY", "snailSX", "snailF0", "snailF1");
  for (const h of ["shrimp", "crab"]) out.push(`${h}On`, `${h}X`, `${h}Y`, `${h}SX`, `${h}F0`, `${h}F1`, `${h}F2`, `${h}F3`);
  out.push("camX", "camY", "camZ", "wallX", "panL", "panR");
  // v7 visitors: turtle, seahorse ("horse"), diver; the Halloween bat; winter's penguin
  for (const v of ["turtle", "horse", "diver", "bat", "penguin"]) out.push(`${v}On`, `${v}X`, `${v}Y`, `${v}SX`, `${v}F0`, `${v}F1`, `${v}F2`, `${v}F3`);
  // v14 night visitors: the manta and the hermit crab like the others; the octopus by spot (octoS{i}), with octoDY and its colours
  for (const v of ["manta", "hermit"]) out.push(`${v}On`, `${v}X`, `${v}Y`, `${v}SX`, `${v}F0`, `${v}F1`, `${v}F2`, `${v}F3`);
  const octoSpots = (K as unknown as { octoSpots?: unknown[] }).octoSpots;
  out.push("octoOn", "octoSX", "octoF0", "octoF1", "octoF2", "octoF3", "octoDY", "octoC1", "octoC2");
  for (let i = 0; i < (Array.isArray(octoSpots) && octoSpots.length ? octoSpots.length : 1); i++) out.push(`octoS${i}`);
  // ---- lamp gels ---- the tint layers (one-hot), the wheel by the switch, the UV light and what fluoresces under it
  for (let g = 0; g < GEL_N; g++) out.push(`gel${g}`);
  out.push("haveGel", "gelPress", "uvLight"); // (each jelly's own `uv` is one of JELLY_KEYS)
  // ---- temperature ---- the hood thermometer (two digits, one-hot; its colour by zone) and the shelf's two units
  for (let p = 0; p < 2; p++) for (let d = 0; d < 10; d++) out.push(`tc${p}n${d}`);
  out.push("tmpCool", "tmpRoom", "tmpWarm", "haveHeat", "haveCool", "heatOn", "coolOn", "heatPress", "coolPress");
  // optional: the art's "NEEDS MEDIUM" note on the large card, written only if the contract has it
  for (const n of ["needs12", "needs15", "needs17", "shopScroll", "shopScrollBar"]) if (K.props.includes(n)) out.push(n);
  out.push(...nurseryProps()); // ---- nursery ----
  return out;
}

/** What one placed jelly writes after its prefix (j{s}{key} in the tank; nj{n}{key} in the nursery). */
export const JELLY_KEYS: readonly string[] = (() => {
  const out = ["on", "x", "y", "morph"];
  for (let i = 0; i < SPECIES_N; i++) out.push(`k${i}`);
  for (let i = 0; i < 4; i++) out.push(`g${i}`);
  // v10: 8 pulse frames and 8 tentacle ripple frames (4-frame stages use the first four)
  for (const g of ["bf", "tf"]) for (let i = 0; i < 8; i++) out.push(`${g}${i}`);
  for (let i = 0; i < TRAIL_N; i++) out.push(`tr${i}`);
  out.push("healthy", "pale", "flush", "glow", "rot");
  // Halloween's ghost-pale morph palette; quiet nights' bell glow; winter's frost morph palette
  out.push("ghost", "nglow", "frost");
  // v16 (pairs): the two colours only a pair's baby can have (in the nursery too: a pair's baby can be born there)
  out.push("dusk", "pearl");
  // (the UV gel's strength isn't per jelly: every jelly reads uvLight from the World global view model)
  return out;
})();

// ---- nursery ---- (shop item NURSERY_ITEM) a small bowl hung on the hood's lip, for raising polyps and ephyrae

/** How many little ones the bowl holds, and its pellet pool (nf0..5). */
export const NUR_CAP = 4;
export const NUR_FOOD_N = 6;

/**
 * The nursery's view props: the open bowl (nurOpen; its centre nurX, nurY and scale nurS while it zooms out of the
 * hanging bowl; the scrim nurDim), the hanging bowl (nurBowl; nurDot{n} a tiny jelly per resident, nurReady when one is
 * waiting to move), its pellets (nf{i}x/y/o, nf{i}k0..2), the "ready to move" tags (nr{n}x/y/o) and its jellies
 * (nj{n}{key}: nested Jelly instances, like j{s}).
 */
export function nurseryProps(): string[] {
  const out = ["nurOpen", "nurX", "nurY", "nurS", "nurDim", "nurBowl", "nurReady"];
  for (let n = 0; n < NUR_CAP; n++) out.push(`nurDot${n}`);
  for (let i = 0; i < NUR_FOOD_N; i++) {
    out.push(`nf${i}x`, `nf${i}y`, `nf${i}o`);
    for (let k = 0; k < FOOD_KINDS; k++) out.push(`nf${i}k${k}`);
  }
  for (let n = 0; n < NUR_CAP; n++) out.push(`nr${n}x`, `nr${n}y`, `nr${n}o`);
  for (let n = 0; n < NUR_CAP; n++) for (const key of JELLY_KEYS) out.push(`nj${n}${key}`);
  return out;
}
// ---- end nursery ----
