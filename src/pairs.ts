/**
 * Pairs and colour genetics (v16). Pure: no DOM, no Rive, no sim state; sim.ts owns the behaviour and draws every
 * random number from its own streams (the morph rolls from s.rand, the trait rolls from s.traitRand).
 *
 * PAIRING. Two adult jellies of the same species, neither paired yet, build a bond while both are content (mood above
 * BABY_MOOD) and their bodies are within PAIR_NEAR of each other: PAIR_SECONDS of that (growth-scaled, like babies'
 * content time) and they pair for life. Apart, the bond fades at PAIR_FADE of the rate it builds. A jelly has one
 * mate at most. Rehoming either one ends the pair. Jellies of different species never pair.
 *
 * A PAIR'S BABY. When a paired adult's content time fills, the baby has both parents (and both start a new wait):
 *   colour  a pair whose colours make a recipe (PAIR_RECIPES) has PAIR_NEW_CHANCE of a new colour neither shows:
 *           classic x classic -> dusk (4), classic x ghost -> pearl (5). Otherwise one parent is picked at random and
 *           passes its colour MORPH_INHERIT of the time (as a single parent does); otherwise the usual rolls: the base
 *           1 in 10 classic, then (in season) the season's morph. A dusk or pearl parent passes its colour on too.
 *   trait   parent A's TRAIT_INHERIT of the time, parent B's TRAIT_INHERIT of the time, else a uniform roll.
 * The polyp still needs a free slot and rock: a full tank holds the baby back, as for one parent.
 *
 * Morph id 3 is winter's frost: no recipe makes it, but a frost parent passes it on like any colour (and in winter
 * the season's roll can give it).
 */
import { MORPH_CHANCE, MORPH_CLASSIC, MORPH_DUSK, MORPH_FROST, MORPH_GHOST, MORPH_INHERIT, MORPH_NONE, MORPH_PEARL, SEASON_MORPH_CHANCE } from "./species";
import { TRAIT_INHERIT, TRAIT_N, type Trait } from "./traits";

// ---------------------------------------------------------------- tuning

/** two jellies' body centres closer than this (world px) count as together */
export const PAIR_NEAR = 170;
/** growth-scaled seconds together (both content) before two jellies pair */
export const PAIR_SECONDS = 150;
/** apart, the bond fades at this share of the rate it builds */
export const PAIR_FADE = 0.5;
/** chance a paired swimmer's new wander target is beside its mate instead */
export const PAIR_DRIFT = 0.3;
/** how far beside its mate it aims (world px) */
export const PAIR_SIDE = 70;
/** a pair close together shares a tiny sparkle every this many seconds (pairs take turns) */
export const PAIR_SPARK_EVERY = 11;
/** ...within this distance of each other (world px) */
export const PAIR_SPARK_NEAR = 240;
/** how long one sparkle lasts, s */
export const PAIR_SPARK_TIME = 1.4;
/** chance a pair whose colours make a recipe has a baby of the new colour */
export const PAIR_NEW_CHANCE = 0.06;

/** The parent colours that can make a new one, and what they make (order of the parents doesn't matter). */
export const PAIR_RECIPES: readonly { a: number; b: number; makes: number }[] = [
  { a: MORPH_CLASSIC, b: MORPH_CLASSIC, makes: MORPH_DUSK },
  { a: MORPH_CLASSIC, b: MORPH_GHOST, makes: MORPH_PEARL },
];

/** The new colour a pair of these colours can make, or MORPH_NONE. */
export function newColourOf(a: number, b: number): number {
  const r = PAIR_RECIPES.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  return r ? r.makes : MORPH_NONE;
}

/** The recipe that makes colour `id` ([parent colour, parent colour]), or null if no pair makes it. */
export const recipeOf = (id: number): readonly [number, number] | null => {
  const r = PAIR_RECIPES.find((p) => p.makes === id);
  return r ? [r.a, r.b] : null;
};

// ---------------------------------------------------------------- pairing

/** What pairing looks at in a jelly. */
export interface PairJelly {
  k: number;
  g: number;
  /** its mate's slot, -1 for none */
  pair: number;
}

/** Can these two (still unpaired) jellies pair? Same species, both adults, neither paired. */
export const canPair = (a: PairJelly, b: PairJelly): boolean => a.k === b.k && a.g === 3 && b.g === 3 && a.pair < 0 && b.pair < 0;

/** A bond after dt more seconds (`scale`: the growth multiplier), together (and both content) or not. */
export const stepBond = (bond: number, together: boolean, dt: number, scale = 1): number =>
  together ? bond + dt * scale : Math.max(0, bond - dt * scale * PAIR_FADE);

/** The bonds' key for two slots (unordered). */
export const bondKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

// ---------------------------------------------------------------- a pair's baby

/**
 * A pair's baby's colour, from parents of colours `a` and `b`. `season`: the morph a season offers now (MORPH_NONE when
 * none). Draws from `r` only as far as it needs (a recipe roll only for a recipe pair).
 */
export function pairMorph(r: () => number, a: number, b: number, season: number = MORPH_NONE): number {
  const made = newColourOf(a, b);
  if (made !== MORPH_NONE && r() < PAIR_NEW_CHANCE) return made;
  const from = r() < 0.5 ? a : b;
  if (from !== MORPH_NONE && r() < MORPH_INHERIT) return from;
  if (r() < MORPH_CHANCE) return MORPH_CLASSIC;
  return season !== MORPH_NONE && r() < SEASON_MORPH_CHANCE ? season : MORPH_NONE;
}

/** A pair's baby's trait: A's TRAIT_INHERIT of the time, B's TRAIT_INHERIT of the time, else uniform. */
export function pairTrait(r: () => number, a: Trait, b: Trait): Trait {
  const x = r();
  if (x < TRAIT_INHERIT) return a;
  if (x < 2 * TRAIT_INHERIT) return b;
  return Math.min(TRAIT_N - 1, Math.floor(r() * TRAIT_N)) as Trait;
}

/**
 * The exact odds of a pair's baby's colour (morph id -> probability), for the journal's notes and the tests.
 * `season` as pairMorph's.
 */
export function pairOdds(a: number, b: number, season: number = MORPH_NONE): Map<number, number> {
  const out = new Map<number, number>();
  const add = (id: number, p: number) => p > 0 && out.set(id, (out.get(id) ?? 0) + p);
  const made = newColourOf(a, b);
  const rest = made !== MORPH_NONE ? 1 - PAIR_NEW_CHANCE : 1;
  add(made, made !== MORPH_NONE ? PAIR_NEW_CHANCE : 0);
  for (const from of [a, b]) {
    let p = rest * 0.5;
    if (from !== MORPH_NONE) {
      add(from, p * MORPH_INHERIT);
      p *= 1 - MORPH_INHERIT;
    }
    add(MORPH_CLASSIC, p * MORPH_CHANCE);
    p *= 1 - MORPH_CHANCE;
    if (season !== MORPH_NONE) {
      add(season, p * SEASON_MORPH_CHANCE);
      p *= 1 - SEASON_MORPH_CHANCE;
    }
    add(MORPH_NONE, p);
  }
  return out;
}

// ---------------------------------------------------------------- words

/** How each colour is said in a note ("a dusk-coloured one"). */
export const COLOUR_WORDS: Readonly<Record<number, string>> = {
  [MORPH_CLASSIC]: "a rare-coloured one",
  [MORPH_GHOST]: "a ghost-pale one",
  [MORPH_FROST]: "a frost-blue one",
  [MORPH_DUSK]: "a dusk-coloured one",
  [MORPH_PEARL]: "a pearl-coloured one",
};
/** A colour's short name ("classic", "ghost"...), for the journal's recipe lines. */
export const COLOUR_NAMES: Readonly<Record<number, string>> = {
  [MORPH_NONE]: "plain",
  [MORPH_CLASSIC]: "rare",
  [MORPH_GHOST]: "ghost",
  [MORPH_FROST]: "frost",
  [MORPH_DUSK]: "dusk",
  [MORPH_PEARL]: "pearl",
};

/** The note when a pair's baby is born: "Mochi and Pip had a baby!" (with its colour when it has one). */
export function pairBabyNote(a: string, b: string, morph: number): string {
  const colour = COLOUR_WORDS[morph];
  return colour ? `${a} and ${b} had a baby — ${colour}!` : `${a} and ${b} had a baby!`;
}

/** The journal's line for how a colour comes about (shown once it has been raised). */
export function colourHow(id: number): string {
  const r = recipeOf(id);
  if (r) return `From a pair: ${COLOUR_NAMES[r[0]]} × ${COLOUR_NAMES[r[1]]}`;
  if (id === MORPH_CLASSIC) return "Born now and then, 1 in 10";
  if (id === MORPH_GHOST) return "Born around Halloween";
  if (id === MORPH_FROST) return "Born in winter";
  return "";
}
