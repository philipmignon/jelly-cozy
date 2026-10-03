/**
 * Jelly personalities (v13). Every jelly has one trait for life, picked at birth: a bought polyp rolls
 * one at random; a baby shares its parent's TRAIT_INHERIT of the time and rolls otherwise. Jellies from
 * before traits (and share codes that don't carry one) get a trait derived from their name and species,
 * so loading the same save twice gives the same personalities. Pure: sim.ts owns the behaviour.
 *
 *   shy      a tap on the glass nearby or a fast-moving held item sends it to the nearest rock or
 *            decoration to linger low for a while; it waits a moment before going for sinking food.
 *            One that trusts you (affection >= SHY_TRUST) stays put.
 *   curious  drifts over to whatever you're holding while it's in the water; heads over to say hello
 *            when a visitor arrives; rides the bubbler most often.
 *   sleepy   longer pauses between pulses, wanders lower in the tank, and turns in for the night an
 *            hour early (from 18:00, unless the lamp says it's day).
 *   social   keeps close to the other swimmers by day too (the quiet-night gathering, round the group).
 */
import { NIGHT_FROM } from "./species";

export type Trait = 0 | 1 | 2 | 3;
export const SHY: Trait = 0;
export const CURIOUS: Trait = 1;
export const SLEEPY: Trait = 2;
export const SOCIAL: Trait = 3;
export const TRAIT_N = 4;
export const TRAIT_NAMES = ["Shy", "Curious", "Sleepy", "Social"] as const;
/** The jelly card's line. */
export const TRAIT_PHRASES = [
  "Shy — hides by the rocks",
  "Curious — comes to see what you're holding",
  "Sleepy — slow pulses and early nights",
  "Social — likes to swim with friends",
] as const;

/** A baby shares its parent's trait this often (otherwise it rolls, which can land on the same one). */
export const TRAIT_INHERIT = 0.35;

// ---------------------------------------------------------------- tuning

/** shy: a tap or a fast held item this near its body centre (world px) startles it */
export const SHY_RADIUS = 200;
/** shy: a held item moving faster than this (artboard px/s) counts as startling */
export const SHY_FAST = 1400;
/** shy: how long it lingers by its hiding place, s */
export const SHY_HIDE = 7;
/** shy: for this long after a fright it won't come out even for food, s */
export const SHY_FOOD_HOLD = 2.5;
/** shy: sinking food has to have been in the water this long before it goes for it, s */
export const SHY_FOOD_DELAY = 1.2;
/** shy: while it heads down to hide it sinks this much faster (px/s², on top of the usual 25) */
export const SHY_SINK = 40;
/** shy: from this affection on it trusts you and doesn't startle */
export const SHY_TRUST = 0.75;
/** curious: how long it hangs about a visitor, s */
export const CURIOUS_VISIT = 8;
/** curious: where it hovers relative to the held item (its bell's origin, artboard px): beside and a bit below */
export const CURIOUS_SIDE = 70;
export const CURIOUS_BELOW = 60;
/** sleepy: idle pulses take this much longer */
export const SLEEPY_PERIOD = 1.35;
/** sleepy: in the hour before night it's already this calm (the quiet-night calm, 0..1) */
export const SLEEPY_DUSK = 0.6;
/** social: how strongly its wander targets pull to the group by day (as quiet-night calm, 0..1) */
export const SOCIAL_PULL = 1;
/** Chance a wander pick is a ride up the bubbler's column instead, by trait (shy, curious, sleepy, social). */
export const RIDE_CHANCE: readonly number[] = [0.02, 0.15, 0.05, 0.12];

/** A saved trait, or null if it's missing or not one. */
export const traitOf = (v: unknown): Trait | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < TRAIT_N ? (v as Trait) : null);

/** The trait a jelly from before traits gets: a hash of its name and species (FNV-1a), the same every load. */
export function traitFromName(name: string, k: number): Trait {
  const s = `${name}/${k}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % TRAIT_N) as Trait;
}

/** A newborn's trait: a bought polyp's (no parent) is uniform; a baby's is its parent's TRAIT_INHERIT of the time, else uniform. */
export function rollTrait(r: () => number, parent: Trait | null): Trait {
  if (parent !== null && r() < TRAIT_INHERIT) return parent;
  return Math.min(TRAIT_N - 1, Math.floor(r() * TRAIT_N)) as Trait;
}

/** v13: a trait's bit in JournalEntry.traitSeen. */
export const traitBit = (t: number): number => (t >= 0 && t < TRAIT_N ? 1 << t : 0);
/** The trait names in a traitSeen bitmask, in trait order. */
export const traitsIn = (mask: number): string[] => TRAIT_NAMES.filter((_, t) => (mask & traitBit(t)) !== 0);

/**
 * Sleepy jellies turn in early: SLEEPY_DUSK calm in the local hour before night, unless the lamp has been
 * switched to day. `hour` is the local clock's hour, `lampDay` whether a lamp override is holding day.
 */
export const drowsy = (hour: number, lampDay: boolean): number => (!lampDay && hour === NIGHT_FROM - 1 ? SLEEPY_DUSK : 0);
