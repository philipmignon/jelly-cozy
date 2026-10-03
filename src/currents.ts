/**
 * The bubbler's current (v13): the column of bubbles over the airstone volcano (decoration BUBBLER, shop
 * item 24) lifts the water it rises through. Pure numbers; sim.ts applies them.
 *
 * Any swimmer whose body centre is within CURRENT_HALF of the column (and below the surface, above the
 * crater) is pushed up, strongest in the middle; a jelly riding it on purpose gets RIDE_PUSH instead.
 * Gliders (comb jellies) ease their own velocity, so they feel GLIDE_SHARE of it. Sinking food sprinkled
 * into the column is carried up for a moment before it sinks.
 */

/** Half the column's width, world px: a rider counts as in it from here. */
export const COLUMN_HALF = 36;
/** The passive push fades to nothing this far from the column's middle. */
export const CURRENT_HALF = 48;
/** Upward push in the middle of the column, px/s² (a pulse jelly sinks at 25 between beats). */
export const CURRENT_PUSH = 40;
/** ...and for a jelly riding it on purpose. */
export const RIDE_PUSH = 110;
/** What share of the push a glider feels. */
export const GLIDE_SHARE = 0.3;
/** A rider is at the top this near its highest allowed y. */
export const RIDE_TOP = 30;
/** A ride that hasn't reached the top by now is given up, s. */
export const RIDE_GIVE_UP = 30;
/** After the top it tips out sideways (px/s) and drifts down this far to one side of the column, world px. */
export const RIDE_KICK = 45;
export const RIDE_AWAY = 140;
/** Under the surface the column spreads out: no passive push in its top this-many px (so nothing gets pinned there). */
export const CURRENT_TOP_GAP = 160;
/** Food in the column rises at up to this, px/s, fading out over FOOD_LIFT_TIME after it goes in. */
export const FOOD_LIFT = 70;
export const FOOD_LIFT_TIME = 1.4;

/** 0..1: how hard the column pushes at horizontal offset dx (from its middle), height y; top/bottom bound it. */
export function currentAt(dx: number, y: number, top: number, bottom: number, half = CURRENT_HALF): number {
  if (y < top || y > bottom) return 0;
  const a = Math.abs(dx);
  return a >= half ? 0 : 1 - a / half;
}

/** How fast a pellet `age` s old in the column's middle (strength w 0..1) is carried up, px/s. */
export const foodLift = (w: number, age: number): number => (age >= FOOD_LIFT_TIME ? 0 : FOOD_LIFT * w * (1 - age / FOOD_LIFT_TIME));
