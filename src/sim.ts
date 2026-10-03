/**
 * The tank simulation. Pure: no DOM, no Rive. Units are artboard px (the
 * artboard is 720x1284); `view()` snaps positions to the P-pixel grid so the
 * sprites stay crisp.
 *
 * WORLD vs SCREEN (v5): the tank is 720 / 1080 / 1440 wide by tier and the
 * screen shows 720 of it. Every sim position (jellies, food, helpers, decor,
 * the pearl, ripple, sparkle, dirt spots) is a WORLD x in 0..worldW; the art draws them
 * inside the World node, offset by `camX` (≤ 0). The night, murk, vignette and
 * the held can / sponge (v8) are screen-space. Taps, long-presses and drags take
 * world x: the host converts with screenToWorld(s, x); things it floats over
 * the canvas (name tags, pops) go back through worldToScreen(s, x).
 *
 * Up to 7 jellies live in slots 0..6 (3 / 5 / 7 by tier). Murk, night, food,
 * dollars and decor are tank-wide. Species/stage/world tables live in ./species.ts.
 *
 * EVENTS (for main.ts to wire sound to): `step()` returns SimEvent[], each
 * `{ type, slot?, stage?, amount? }`:
 *   "ate"     slot      a jelly caught a pellet
 *   "pulse"   slot      a swimming pulse-jelly started a pulse (not comb juvenile/adult, polyps or settled)
 *   "cleaned"           the cleaning sweep finished
 *   "grew"    slot, stage  a jelly reached a new stage (1 ephyra, 2 juvenile, 3 adult); one per stage
 *   "adult"   slot      it just became an adult (fires after its "grew")
 *   "earned"  amount, slot?, x?, y?  dollars were added (meal, clean, pet, stage reward, rehoming)
 *   "baby"    slot, parent  an adult released a polyp of its species into `slot`
 *   "dug"     amount    the hermit crab turned up a sand dollar (an "earned" comes with it)
 *   "shrimpAte"         the cleaner shrimp ate a pellet off the sand
 *   "pearlReady"        today's pearl appeared in the clam (once per day; also on the first step after load)
 *   "pearl"   amount    the pearl was collected (queued by `tap()`, with its "earned")
 *   "rehomed" slot, x, y  a jelly left for a new home (queued by `rehome()`, then its "earned",
 *                       which also carries x, y: the slot is already empty when they come out)
 *   "upgraded" tier     a bigger tank was bought (queued by `buy()`); the shop closes, the wall
 *                       starts sliding out once it's shut and the camera follows it
 *   "revealed" tier, x, y  the wall reached the new width; a sparkle goes off at x, y (world)
 *   "visitorArrived" kind  a visitor (VISITORS: "turtle" | "seahorse" | "diver") came into view
 *   "visitorTapped" kind, amount, x, y  it was tapped (once per visit; queued by `tap()`, with its
 *                       "earned", which carries the same x, y: the visitor's middle, world)
 *   "visitorLeft" kind  it has gone (faded out)
 *   "spotCleaned" x, y  (v8) a dirt spot that had dirt >= 0.4 was scrubbed off the glass (world x, y);
 *                       queued by `scrubAt()`, with a sparkle there and its "earned" (+1, same x, y)
 *   "themed"  theme     (v11) a tank theme was bought or picked again (queued by `buy()` / `setTheme()`);
 *                       the shop slides shut so the new look shows
 *   "requestDone" request, amount  (v12) a daily request was finished (index into requests(s).items); its "earned"
 *                       (no slot, no x/y) comes straight after it. Daily requests run only with SimOptions.requests
 *   "keepsake" keepsake (v13) a journal milestone was reached in play (index into MILESTONES, ./keepsakes.ts); its
 *                       reward is already granted (a decoration placed at its spot with a sparkle, or a theme owned).
 *                       Milestones reached at load are granted quietly: keepsakesAtLoad(s). Only with SimOptions.keepsakes
 *   "ate" also carries `fav: true` (v11) when the pellet was the jelly's favourite food: double growth,
 *                       a little more fullness and a bigger happy flush
 *   "rode"    slot, x, y, seen  (v13) a jelly rode the bubbler's column to the top (x: the column, y: the jelly);
 *                       `seen` when the bubbler was on screen (that's what the "watch a jelly ride" request counts)
 *
 * v13 PERSONALITIES (./traits.ts): every jelly has a trait for life (Jelly.trait; saves before v13 derive one from
 * the name). Shy ones hide by the rocks when the glass is tapped near them or a held item is swept past fast;
 * curious ones come to look at a held item in the water and greet visitors; sleepy ones pulse slower, keep low
 * and settle an hour before night; social ones gather round the others by day too.
 * v13 BUBBLER (decoration 10, shop item 24; ./currents.ts): its column lifts swimmers and fresh food; now and then a
 * wander becomes a ride up it (targetKind "ride"), most often for curious and social jellies.
 *
 * v11 FOODS: flakes (the can, always owned), brine shrimp (a jar) and plankton (a bottle) are bought in the
 * shop and stand on the tool shelf; each is a tool ("food" | "shrimp" | "plankton"; isFoodTool()), and
 * sprinkle() pours whichever one is in hand. Every species has a favourite (favouriteFood(k)).
 * v11 THEMES: s.theme 0 Reef, 1 Kelp Forest, 2 Coral Garden, 3 Arctic recolours the world backdrop
 * (theme0..3 one-hot); bought in the shop (TANK tab), re-picked by tapping an owned card (setTheme).
 *
 * v8 TOOLS: `s.tool` is "none" | "food" | "sponge". The host picks them up and puts them down
 * (setTool / toggleTool), moves the held item with setCursor (SCREEN coordinates), and, with the can,
 * calls sprinkle(world x, y) on a tap and every ~110 ms of a drag; with the sponge, scrubAt(world x, y,
 * distance moved). Dirt lives in spots on the glass (./dirt.ts); murk = clamp(sum(dirt) / 6).
 * Pets and the pearl earn inside `tap()`; those events are queued and come
 * out of the next `step()`. `buy()` and `tap()` report through their return
 * values.
 */
import {
  ADULT,
  BOTTOM_DWELLERS,
  BUBBLER,
  FAV_CHASE,
  FAV_MEAL,
  FLAKES,
  FOOD_KINDS,
  FOOD_NAMES,
  MEAL,
  THEME_N,
  THEME_NAMES,
  favouriteFood,
  foodItem,
  themeItem,
  keepsakeOf,
  SPECIES_N,
  AWAY_GROWTH_CAP,
  AWAY_LINES_MAX,
  AWAY_SUMMARY_MIN,
  BABY_MOOD,
  BABY_SECONDS,
  CARE_SECONDS,
  CLAM,
  COMB,
  CRAB,
  CRAB_SIZE,
  DAY_FROM,
  DECOR,
  DECOR_N,
  DIG_REWARD,
  EARN,
  EPHYRA,
  GROWTH,
  HELPER_N,
  JUVENILE,
  K,
  LURE_RADIUS,
  MAX_DOLLARS,
  MAX_SLOTS,
  MOON,
  MORPH_CHANCE,
  MORPH_CLASSIC,
  MORPH_GHOST,
  MORPH_IDS,
  MORPH_INHERIT,
  MORPH_NONE,
  SEASON_MORPH_CHANCE,
  NIGHT_FROM,
  OPEN_SAND,
  OPEN_SANDS,
  P,
  PEARL,
  PEARL_REWARD,
  PET_COOLDOWN,
  POLYP,
  POLYP_ANCHORS,
  POLYP_SWAY,
  REHOME_PAY,
  SETTLED_PULSE,
  SETTLE_SPOTS,
  SHOP_CLOSED_Y,
  SHOP_ITEMS,
  SHOP_OPEN_Y,
  SHRIMP,
  SNAIL,
  SNAIL_FLOOR,
  STAGE_REWARD,
  TAB_HIDDEN_Y,
  TAB_ITEMS,
  TAB_N,
  TIERS,
  TIER_N,
  TRAIL_FAN,
  TRAIL_L,
  TRAIL_N,
  TRAIL_NEUTRAL,
  TRAIL_R,
  TRAIL_STREAM,
  UPSIDE,
  buttonCentre,
  clamp,
  decorClampX,
  decorY,
  geomOf,
  glassRightOf,
  maxJelliesOf,
  openSandsOf,
  sandAt,
  snap,
  specProps,
  shopCardCentre,
  swimOf,
  trailOf,
  trailsOf,
  worldWOf,
  type Geom,
  type FoodKind,
  type Species,
  type TrailParams,
  type Stage,
} from "./species";
import { helperWorld, newCrab, newShrimp, newSnail, stepCrab, stepShrimp, stepSnail, type HelperWorld, type RestingFood, type Snail, type Walker } from "./helpers";
import { EDGE_SCROLL, EDGE_ZONE, FLING_MAX, FLING_REST, VIEW_W, camLo, easeTime, newCam, stepCam, type Cam } from "./camera";
import { NAMES, cleanName, pickName } from "./names";
import { TENT_WAVES_PER_PULSE, bodyFramesOf, newTilt, pulseFrame, pulseFrame4, stepTilt, tentFrame, tentFramesOf, type Tilt } from "./motion";
import { QUIET, calmOf, gatherPoint, gatherTarget, nightGlow, quietPeriod, quietScale } from "./motion";
import {
  DIVER_REACH,
  DIVER_SCRUB,
  PAY_DIRT,
  ROT_HURRY,
  SCRUB_PER_PX,
  SCRUB_REACH,
  SCRUB_STEP_MAX,
  SNAIL_SCRUB,
  SPOT_GAP_MIN,
  SPOT_GAP_SPREAD,
  SPOT_KINDS,
  SPOT_N,
  SPOT_PAY,
  addSpot,
  dirtAway,
  dirtiest,
  growSpots,
  murkOf,
  rng,
  rotInto,
  spotOpacity,
  spotSlots,
  spotsForMurk,
  spotsFromSave,
  toSaveSpots,
  type SaveSpot,
  type Spot,
} from "./dirt";
import {
  DIVER,
  VISITORS,
  VISITOR_PROP,
  VISIT_GAP_MIN,
  VISIT_GAP_SPREAD,
  VISIT_PAY_MIN,
  VISIT_PAY_STEPS,
  cheer,
  planVisit,
  settled,
  stepVisit,
  visitOver,
  visitorCentre,
  visitorHit,
  visitsDuring,
  type Visit,
  type VisitorKind,
} from "./visitors";
import { decodeTank, encodeTank, hasPlace, type TankCode } from "./tankcode";
import {
  CURIOUS,
  CURIOUS_BELOW,
  CURIOUS_SIDE,
  CURIOUS_VISIT,
  RIDE_CHANCE,
  SHY,
  SHY_FAST,
  SHY_FOOD_DELAY,
  SHY_FOOD_HOLD,
  SHY_HIDE,
  SHY_RADIUS,
  SHY_SINK,
  SHY_TRUST,
  SLEEPY,
  SLEEPY_PERIOD,
  SOCIAL,
  SOCIAL_PULL,
  TRAIT_N,
  TRAIT_NAMES,
  TRAIT_PHRASES,
  drowsy,
  rollTrait,
  traitBit,
  traitFromName,
  traitOf,
  type Trait,
} from "./traits";
import { COLUMN_HALF, CURRENT_HALF, CURRENT_PUSH, CURRENT_TOP_GAP, GLIDE_SHARE, RIDE_AWAY, RIDE_GIVE_UP, RIDE_KICK, RIDE_PUSH, RIDE_TOP, currentAt, foodLift } from "./currents";
import { SEASONS, type SeasonId } from "./season";
import { SPRINKLE_NEAR, advance, copyRequests, planRequests, requestText, requestsOf, rewardOf, type DailyRequests, type Deed, type Request, type RequestKind } from "./requests";
import { MILESTONES, copyKeep, countDay, isEarned, keepFacts, keepOf, newlyReached, progressOf, seedKeep, type KeepSave } from "./keepsakes";

export { K, clamp, sandAt, specProps, SHOP_ITEMS, POLYP_ANCHORS, SETTLE_SPOTS, DECOR, TAB_ITEMS, NAMES, OPEN_SAND, OPEN_SANDS, TIERS, MAX_SLOTS, geomOf };
export type { Species, Stage, Snail, Walker, Cam, Visit, VisitorKind, Spot, SaveSpot, FoodKind };
export { favouriteFood, FOOD_NAMES, FOOD_KINDS, THEME_N, THEME_NAMES, foodItem, themeItem };
export { SPOT_N, murkOf, spotsForMurk };
export { VISITORS };
export { MORPH_NONE, MORPH_CLASSIC, MORPH_GHOST, requestText, rewardOf };
export type { DailyRequests, Request, RequestKind, KeepSave };
export { MILESTONES };
export { TRAIT_NAMES, TRAIT_PHRASES, traitFromName };
export type { Trait };

// ---------------------------------------------------------------- saves

export interface SaveV1 {
  v: 1;
  fullness: number;
  murk: number;
  affection: number;
  night: boolean;
  lastSeen: number;
}

export interface SaveJelly {
  k: Species;
  g: Stage;
  /** cumulative growth points */
  gp: number;
  /** seconds of good care towards the next point */
  care: number;
  fullness: number;
  affection: number;
  /** polyp rock anchor index, -1 when not a polyp */
  anchor: number;
  /** settle spot index for upside-down juveniles/adults, -1 otherwise */
  spot: number;
  name: string;
  /** epoch ms */
  born: number;
  /** growth-scaled seconds of content time (adult, mood > 0.7) towards the next baby */
  content: number;
  /** v12: its colour morph, fixed for life: 0 none, 1 classic (v7's rare colour, 1 in 10 births), 2 ghost (a season's).
   *  v7..v9 saves wrote a boolean (true = classic); loading takes either */
  morph: number;
  /** v13 (optional): its personality, 0 shy, 1 curious, 2 sleepy, 3 social (./traits.ts). Missing: derived from
   *  its name and species (traitFromName), so older saves load the same every time */
  trait?: number;
}

/** v7: what the jelly journal knows about one species (journal(s)[k]). */
export interface JournalEntry {
  /** ever owned, at any stage */
  seen: boolean;
  /** how many reached adult */
  raised: number;
  /** when the first one reached adult (epoch ms) */
  firstAdultAt: number | null;
  /** that first adult's name */
  firstName: string | null;
  /** v12: the colour morphs ever owned, a bitmask by morph id (bit id - 1: 1 classic, 2 ghost); v7..v9 saves wrote a boolean */
  morphSeen: number;
  /** v13: the personalities met in this species, a bitmask by trait (bit t); older saves: from the jellies in the tank */
  traitSeen: number;
}

/** The lamp button's override of the clock: show `night` until `until` (epoch ms, the next 07:00 or 19:00). */
export interface LampOverride {
  night: boolean;
  until: number;
}

/**
 * The save version written by toSave (v6 changed no save fields; v8 added the dirt spots; v9 foods and themes; v10 morph
 * ids instead of a boolean, the morphSeen bitmask and today's requests; v11 jelly traits, the keepsakes' `keep` and
 * decorations 5..10, the keepsakes and the bubbler). The save key stays jellytank:v5.
 */
export const SAVE_VERSION = 11;

export interface Save {
  v: 11;
  /** always length 7 (MAX_SLOTS); null = empty slot */
  slots: (SaveJelly | null)[];
  dollars: number;
  /** derived from `spots` (clamp(sum(dirt) / 6)); kept for the away summary and older readers */
  murk: number;
  /** v8: dirt spots on the glass (world), at most SPOT_N */
  spots: SaveSpot[];
  /** whether night was showing when saved (informational: on load the clock and `lamp` decide) */
  night: boolean;
  /** an unexpired lamp override, or null to follow the clock */
  lamp: LampOverride | null;
  /** decorations owned, DECOR_N long (v11: 0..4 bought, 5..9 keepsakes, 10 the bubbler; older saves are padded) */
  owned: boolean[];
  /** snail, shrimp, crab bought */
  helpers: boolean[];
  /** where each decoration's base sits (x, artboard units) */
  decorX: number[];
  /** local YYYY-MM-DD of the last pearl collected ("" = never) */
  pearlDay: string;
  lastSeen: number;
  /** v5: tank tier 0 Small, 1 Medium, 2 Large */
  tier: number;
  /** v5: the camera offset (camX, ≤ 0) when saved */
  cam: number;
  /** v7: the jelly journal, one entry per species (index = k) */
  journal: JournalEntry[];
  /** v9: food kinds owned (index = FoodKind; flakes always true) */
  foods: boolean[];
  /** v9: tank themes owned (index = theme; Reef always true) and the one in use */
  themes: boolean[];
  theme: number;
  /** v12 (optional): today's daily requests and how far along they are; absent until the first is planned */
  requests?: DailyRequests;
  /** v13 (optional): keepsakes earned and the facts the journal can't tell (./keepsakes.ts); absent until first evaluated */
  keep?: KeepSave;
  /** v15 (optional): decorations put away in the drawer (owned, not in the tank), DECOR_N long; absent = every owned one is placed */
  stored?: boolean[];
}

// ---------------------------------------------------------------- state

export type FoodState = "off" | "sink" | "rest" | "eaten";

export interface Food {
  state: FoodState;
  /** v11: flakes, brine shrimp or plankton */
  kind: FoodKind;
  x: number;
  y: number;
  vy: number;
  age: number;
  seed: number;
  /** where it was when eaten, so it can be drawn into the jelly */
  ex: number;
  ey: number;
  /** slot that ate it */
  by: number;
}

export type Mode = "fixed" | "swim" | "settling" | "settled";

export interface Jelly {
  k: Species;
  g: Stage;
  gp: number;
  care: number;
  fullness: number;
  affection: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** pulse phase (sway for polyps, shimmer for comb) */
  pulse: number;
  tent: number;
  /** trailing-tentacle pose (TRAIL_FAN..TRAIL_R), the sim time it was entered, and the eased velocity it reads */
  trail: number;
  trailAt: number;
  svx: number;
  svy: number;
  /** v10: the lean into turns (j{s}rot) */
  tilt: Tilt;
  target: { x: number; y: number } | null;
  /** v13: "hide" a shy jelly's retreat, "visit" a curious one saying hello to a visitor, "ride" up the bubbler */
  targetKind: "wander" | "tap" | "food" | "hide" | "visit" | "ride" | null;
  targetUntil: number;
  /** when the last happy wiggle started (eating, petting, growing) */
  wiggleT0: number;
  /** v11: when it last ate its favourite food (a longer, brighter flush) */
  loveT0: number;
  /** sim time when petting pays a dollar again */
  petReadyAt: number;
  anchor: number;
  spot: number;
  mode: Mode;
  /** total pulse impulse ever applied (px/s); comb juveniles/adults keep this at 0 */
  thrust: number;
  name: string;
  born: number;
  content: number;
  /** v12: morph id (0 none, 1 classic, 2 ghost) */
  morph: number;
  /** v13: its personality (./traits.ts) */
  trait: Trait;
  /** v13: a bubbler ride: 0 none, 1 heading for the column, 2 rising in it */
  ride: number;
}

export type SimEventType = "ate" | "pulse" | "cleaned" | "grew" | "adult" | "earned" | "baby" | "dug" | "shrimpAte" | "pearlReady" | "pearl" | "rehomed" | "upgraded" | "revealed" | "visitorArrived" | "visitorTapped" | "visitorLeft" | "spotCleaned" | "themed" | "requestDone" | "rode" | "keepsake";
export interface SimEvent {
  type: SimEventType;
  slot?: number;
  stage?: number;
  amount?: number;
  /** "baby": the parent's slot */
  parent?: number;
  /** "rehomed" and its "earned": where the jelly was (body centre, world); "revealed": the sparkle; "spotCleaned": the spot */
  x?: number;
  y?: number;
  /** "upgraded", "revealed": the new tank tier */
  tier?: number;
  /** "visitorArrived", "visitorTapped", "visitorLeft": which visitor */
  kind?: VisitorKind;
  /** v11 "ate": the pellet was the jelly's favourite food; and which food it was */
  fav?: boolean;
  food?: FoodKind;
  /** v11 "themed": the theme now in use */
  theme?: number;
  /** v12 "requestDone": which of today's requests (index into requests(s).items) */
  request?: number;
  /** v13 "rode": the bubbler was on screen when the ride reached the top */
  seen?: boolean;
  /** v13 "keepsake": which milestone (index into MILESTONES) */
  keepsake?: number;
}

export interface State {
  t: number;
  rand: () => number;
  growthMultiplier: number;
  slots: (Jelly | null)[];
  food: Food[];
  murk: number;
  /** night is showing (the clock's state, or the lamp override's) */
  nightTarget: boolean;
  /** eased 0..1 toward nightTarget */
  night: number;
  /** the lamp button's override, null = follow the clock */
  lamp: LampOverride | null;
  dollars: number;
  owned: boolean[];
  ripple: { x: number; y: number; t0: number } | null;
  /** the old cleaning sweep (clean(), demo/tests): every spot fades out over WIPE_TIME */
  wipe: { t0: number; murk0: number; dirt0: number[] } | null;
  /** v8: dirt spots on the glass, fixed slots (spot{i} in the view), null = clean glass there */
  spots: (Spot | null)[];
  /** sim time the next spot appears, and the spots' own random stream */
  nextSpot: number;
  dirtRand: () => number;
  /** the spot the snail is working on (-1 none) */
  snailSpot: number;
  /** v8: what's in hand */
  tool: Tool;
  /** v8: the pointer (SCREEN coordinates), pressed, and whether the held item is shown */
  cursor: { x: number; y: number; down: boolean; visible: boolean };
  /** v8: sprinkling's rate limit (a token bucket) and when the last flake went in */
  pour: { tokens: number; at: number; last: number };
  pressUntil: number[];
  shop: { open: boolean; from: number; to: number; t0: number };
  /** how far the JELLIES tab is scrolled down (artboard px, 0..SHOP_SCROLL.max) */
  shopScroll: number;
  fx: { x: number; y: number; t0: number } | null;
  /** events raised outside step() (pet dollars, the pearl), emitted by the next step() */
  queued: SimEvent[];
  /** wall clock, epoch ms: starts at the save's time, advanced by dt */
  clock: number;
  /** active shop tab 0..2 */
  tab: number;
  decorX: number[];
  /** decoration being arranged, -1 none */
  lifted: number;
  /** v15: decorations put away (owned, kept in the drawer, not in the tank), DECOR_N long */
  stored: boolean[];
  /** v15: the put-away drawer that shows while a decoration is carried: eased in 0..1, and the finger over it */
  drawer: { e: number; hot: boolean };
  helpers: boolean[];
  snail: Snail;
  shrimp: Walker;
  crab: Walker;
  pearlDay: string;
  /** whether the pearl was showing on the last step (for pearlReady) */
  pearlWas: boolean;
  /** v5: tank tier (0..2) */
  tier: number;
  /** the right wall sliding out after an upgrade (null = at the tier's width) */
  wall: { from: number; to: number; t0: number } | null;
  cam: Cam;
  /** the jelly card's close-up: which slot, whether it's wanted, and the eased progress 0..1 */
  focus: { slot: number; on: boolean; e: number };
  /** pan hint chevrons, eased 0..1 */
  hints: { l: number; r: number };
  /**
   * Reduce motion (the player's setting, or the OS's prefers-reduced-motion; the host sets it with
   * setReducedMotion, src/a11y.ts stores it). Not saved. Anything new that moves for show should read it:
   * when on, the camera jumps instead of flinging or easing, the close-up and the shop snap, a petted jelly
   * doesn't shimmy, bells pulse gentler (no peak squeeze or overshoot frame) and the comb shimmers slower.
   * HTML overlays read the same setting from :root[data-jt-reduce-motion].
   */
  reducedMotion: boolean;
  /** screen x of the finger dragging a decoration (for edge scrolling), null when not dragging */
  dragX: number | null;
  /** v7: the journal, index = species */
  journal: JournalEntry[];
  /** v7: the visitor in the tank (null = none) and when the next one is due (sim time) */
  visit: Visit | null;
  nextVisit: number;
  lastVisitor: number;
  /** v11: food kinds owned (flakes always), themes owned (Reef always) and the theme in use */
  foods: boolean[];
  themes: boolean[];
  theme: number;
  /** the seasonal event showing (src/season.ts; the host sets it with setEvent), null = none. Not saved. */
  event: SeasonId | null;
  /** v12: today's requests (null until planned; kept as loaded while requests are off) and whether they run */
  requests: DailyRequests | null;
  requestsOn: boolean;
  /** v12: SimOptions.seasonalMorph */
  seasonalMorph: ((now: number) => number | null) | null;
  /** v13: newborns' traits come from their own random stream (like the dirt), so the rest stays as it was */
  traitRand: () => number;
  /** v13: how far the held item moved since the last step, and its eased speed (artboard px/s): a fast one startles shy jellies */
  cursorTravel: number;
  cursorSpeed: number;
  /** v13: keepsakes earned and the days/requests counts (null: an older save, kept as loaded while keepsakes are off),
   *  whether milestones are evaluated, and the ones granted quietly while loading (for the host's one summary note) */
  keep: KeepSave | null;
  keepOn: boolean;
  keepAtLoad: number[];
}

/** v8: what the player has in hand. v11: "shrimp" (the brine shrimp jar) and "plankton" (the bottle) are foods too. */
export type Tool = "none" | "food" | "sponge" | "shrimp" | "plankton";
/** v11: the tool that pours each food kind (index = FoodKind). */
export const FOOD_TOOLS = ["food", "shrimp", "plankton"] as const;
/** v11: the food kind a tool pours, or -1 (none, sponge). */
export const foodKindOf = (tool: Tool): FoodKind | -1 => {
  const k = (FOOD_TOOLS as readonly string[]).indexOf(tool);
  return k < 0 ? -1 : (k as FoodKind);
};
/** v11: is it a food (the can, the jar or the bottle)? The host sprinkles with any of them. */
export const isFoodTool = (tool: Tool) => foodKindOf(tool) >= 0;

export interface SimOptions {
  /** ×20 when the URL has ?fast=1 */
  growthMultiplier?: number;
  /**
   * v12: the morph an active season offers babies (MORPH_GHOST around Halloween), or null when no season is on.
   * A baby that rolled plain is that morph SEASON_MORPH_CHANCE of the time. Called with the sim clock (epoch ms).
   */
  seasonalMorph?: (now: number) => number | null;
  /** v12: run the daily requests (the host's own tank). Off by default: the demo, visits and tests don't get them. */
  requests?: boolean;
  /** v13: evaluate the journal's milestones and grant keepsakes (the host's own tank). Off by default, like requests. */
  keepsakes?: boolean;
}

/** v1 geometry, kept for reference: the moon adult. */
const MOON_GEOM = geomOf(MOON, ADULT);
export const BELL_HALF = MOON_GEOM.body.halfW;
export const BELL_H = MOON_GEOM.body.top;
export const BOUNDS = MOON_GEOM.bounds;
export const HARD = MOON_GEOM.hard;
export const RIM_ABOVE_SAND = MOON_GEOM.rimAbove;

/** Food sprite is 3x3 logical px drawn from its top-left; this finds its middle. */
const FOOD_MID = P + 1;
const RATES = {
  /** full -> empty while you watch, seconds */
  hungerActive: 60 * 8,
  /** full -> empty while away, seconds */
  hungerAway: 3600 * 6,
  affectionDecay: 60 * 6,
};
const GOOD_FULLNESS = 0.3;
const GOOD_MURK = 0.6;
const SHOP_SLIDE = 0.35;
const WIPE_TIME = 1.6;
/** v8 sprinkling: flakes land within this of the point (±12 px), at most POUR_RATE a second (bursts of POUR_BURST) */
export const SPRINKLE_SPREAD = 12;
export const POUR_RATE = 10;
export const POUR_BURST = 3;
/** the can shows its pouring frame this long after a flake goes in */
const POUR_SHOW = 0.2;
/** a swimmer's starting spot per slot (clamped into the tank it's in) */
const START_X = [360, 220, 500, 870, 960, 1230, 1320];
/** the right wall slides out to the new width over this long after an upgrade, s */
export const WALL_TIME = 1.2;
/** the camera's reveal of the new space (a little slower than the wall, so the wall is seen moving), s */
export const REVEAL_TIME = 1.5;
/** height of the sparkle in the new space when the wall arrives */
const REVEAL_FX_Y = 540;
/** v11: and of the one that greets a new theme */
const THEME_FX_Y = 480;
/** pan hints fade in/out over this long, s */
const HINT_TIME = 0.25;

const freshJelly = (k: Species, g: Stage, name: string, born: number, morph = MORPH_NONE, trait: number = traitFromName(name, k)): SaveJelly => ({
  k,
  g,
  gp: GROWTH[g],
  care: 0,
  fullness: 0.7,
  affection: 0.4,
  anchor: g === POLYP ? 0 : -1,
  spot: -1,
  name,
  born,
  content: 0,
  morph,
  trait,
});

// ---------------------------------------------------------------- the jelly journal (v7)

const blankEntry = (): JournalEntry => ({ seen: false, raised: 0, firstAdultAt: null, firstName: null, morphSeen: 0, traitSeen: 0 });
/** v13: a saved jelly's trait: as saved, else derived from its name and species. */
const traitOfSave = (j: Pick<SaveJelly, "trait" | "name" | "k">): Trait => traitOf(j.trait) ?? traitFromName(j.name, j.k);

/** v12: a saved morph as an id: v7..v9's true is the classic one; anything unknown is none. */
export const morphOf = (v: unknown): number => (v === true ? MORPH_CLASSIC : typeof v === "number" && Number.isInteger(v) && v > 0 && v < MORPH_IDS ? v : MORPH_NONE);
/** v12: a morph id's bit in JournalEntry.morphSeen (0 for none). */
export const morphBit = (id: number): number => (id > MORPH_NONE && id < MORPH_IDS ? 1 << (id - 1) : 0);
/** v12: a saved morphSeen as a bitmask: v7..v9's true is the classic one. */
const morphSeenOf = (v: unknown): number =>
  v === true ? morphBit(MORPH_CLASSIC) : typeof v === "number" && Number.isInteger(v) && v > 0 ? v & ((1 << (MORPH_IDS - 1)) - 1) : 0;
/** v12: has this journal entry seen morph `id`? */
export const morphSeen = (e: Pick<JournalEntry, "morphSeen">, id: number): boolean => (e.morphSeen & morphBit(id)) !== 0;
export const emptyJournal = (): JournalEntry[] => Array.from({ length: SPECIES_N }, blankEntry);

/** A journal built from the jellies in a tank: each is seen; adults count as raised, first raised at `now`. */
export function journalFrom(slots: readonly (SaveJelly | null)[], now: number): JournalEntry[] {
  const jn = emptyJournal();
  for (const j of slots) {
    if (!j) continue;
    const e = jn[j.k]!;
    e.seen = true;
    e.morphSeen |= morphBit(morphOf(j.morph));
    e.traitSeen |= traitBit(traitOfSave(j));
    if (j.g === ADULT) {
      e.raised++;
      if (e.firstAdultAt === null) {
        e.firstAdultAt = now;
        e.firstName = j.name;
      }
    }
  }
  return jn;
}

/** A saved journal repaired entry by entry; anything in the tank now is marked seen. */
function journalOf(raw: unknown, slots: readonly (SaveJelly | null)[], now: number): JournalEntry[] {
  if (!Array.isArray(raw)) return journalFrom(slots, now);
  const jn = emptyJournal().map((_, k): JournalEntry => {
    const o = raw[k] && typeof raw[k] === "object" ? (raw[k] as Record<string, unknown>) : {};
    const at = finite(o.firstAdultAt, NaN);
    const raised = Math.max(0, Math.floor(finite(o.raised, 0)));
    return {
      seen: o.seen === true || raised > 0,
      raised,
      firstAdultAt: Number.isFinite(at) ? at : null,
      firstName: cleanName(o.firstName),
      morphSeen: morphSeenOf(o.morphSeen),
      traitSeen: typeof o.traitSeen === "number" && Number.isInteger(o.traitSeen) && o.traitSeen > 0 ? o.traitSeen & ((1 << TRAIT_N) - 1) : 0,
    };
  });
  for (const j of slots) {
    if (!j) continue;
    jn[j.k]!.seen = true;
    jn[j.k]!.morphSeen |= morphBit(morphOf(j.morph));
    jn[j.k]!.traitSeen |= traitBit(traitOfSave(j));
  }
  return jn;
}

const copyJournal = (jn: readonly JournalEntry[]): JournalEntry[] => jn.map((e) => ({ ...e }));

/** The journal, one entry per species (index = k): a copy. */
export const journal = (s: State): JournalEntry[] => copyJournal(s.journal);

/** Note a jelly in the journal (it's in the tank now). */
function noteJelly(s: State, j: Jelly): void {
  const e = s.journal[j.k]!;
  e.seen = true;
  e.morphSeen |= morphBit(j.morph);
  e.traitSeen |= traitBit(j.trait);
}

/** A repeatable 0..1 from a timestamp, so loading the same save twice names jellies the same. */
const seedOf = (now: number, i: number) => {
  const x = Math.sin((Math.floor(now / 1000) % 100000) * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const defaultDecorX = () => DECOR.map((d) => d.x);
const emptySlots = (): (SaveJelly | null)[] => Array.from({ length: MAX_SLOTS }, () => null);
const withSlots = (first: (SaveJelly | null)[]) => emptySlots().map((_, i) => first[i] ?? null);
const noHelpers = () => Array.from({ length: HELPER_N }, () => false);
const noDecor = () => Array.from({ length: DECOR_N }, () => false);
/** v9: just the flakes, and just the Reef. */
const starterFoods = () => Array.from({ length: FOOD_KINDS }, (_, k) => k === FLAKES);
const starterThemes = () => Array.from({ length: THEME_N }, (_, t) => t === 0);
/** Owned flags from a save (missing or damaged: the starter set); index 0 is always owned. */
const ownedList = (raw: unknown, n: number) => Array.from({ length: n }, (_, i) => i === 0 || (Array.isArray(raw) && raw[i] === true));
/** The theme in use from a save: an owned one, else the Reef. */
const themeOf = (raw: unknown, themes: readonly boolean[]) => {
  const t = Math.round(finite(raw, 0));
  return t >= 0 && t < THEME_N && themes[t] ? t : 0;
};

/** A new game: one moon polyp on the first rock, no dollars. */
export function defaultSave(now = Date.now()): Save {
  const slots = withSlots([freshJelly(MOON, POLYP, pickName([], seedOf(now, 0)), now)]);
  const spots = spotsForMurk(0.1, tierRight(0), rng(now));
  return {
    v: 11,
    slots,
    dollars: 0,
    murk: murkOf(spots),
    spots: toSaveSpots(spots),
    night: isNightByClock(now),
    lamp: null,
    owned: noDecor(),
    helpers: noHelpers(),
    decorX: defaultDecorX(),
    pearlDay: "",
    lastSeen: now,
    tier: 0,
    cam: 0,
    journal: journalFrom(slots, now),
    foods: starterFoods(),
    themes: starterThemes(),
    theme: 0,
  };
}

/** v1 had one adult moon: keep its needs, add a welcome gift. `now` (default: its lastSeen) is its birthday. */
export function migrateV1(v1: SaveV1, now = v1.lastSeen): Save {
  const j: SaveJelly = { ...freshJelly(MOON, ADULT, pickName([], seedOf(now, 0)), now), fullness: clamp(v1.fullness), affection: clamp(v1.affection) };
  const spots = spotsForMurk(clamp(finite(v1.murk, 0.1)), tierRight(0), rng(v1.lastSeen));
  return {
    v: 11,
    slots: withSlots([j]),
    dollars: 10,
    murk: murkOf(spots),
    spots: toSaveSpots(spots),
    night: !!v1.night,
    lamp: null,
    owned: noDecor(),
    helpers: noHelpers(),
    decorX: defaultDecorX(),
    pearlDay: "",
    lastSeen: v1.lastSeen,
    tier: 0,
    cam: 0,
    journal: journalFrom([j], now),
    foods: starterFoods(),
    themes: starterThemes(),
    theme: 0,
  };
}

const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
/** World x of the inside of the right glass for a tier. */
const tierRight = (tier: number) => glassRightOf(worldWOf(tier));

/** A saved lamp override, or null if it's missing or damaged (expiry is checked against the clock in createState). */
function lampOf(v: unknown): LampOverride | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const until = finite(o.until, NaN);
  return typeof o.night === "boolean" && Number.isFinite(until) ? { night: o.night, until } : null;
}
const stageOrSpecies = (v: unknown) => clamp(Math.round(finite(v, 0)), 0, 3) as Stage;
const speciesOf = (v: unknown) => clamp(Math.round(finite(v, 0)), 0, SPECIES_N - 1) as Species;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A v2..v7 save, repaired field by field. Before v7: no morphs, and the journal is filled from the
 * jellies in the tank (adults count as raised, first raised at load time). v2 → v3: names assigned, born = now,
 * no content time, no helpers, decorations at their default spots, pearl available today.
 * Before v5: the small tank (tier 0), camera at 0. Jellies past the tier's max are dropped.
 * Before v8: no dirt spots: a few appear, adding up to the saved murk. From v8 murk is derived from the spots.
 * Before v9: only flakes and the Reef are owned, the Reef in use.
 */
function sanitize(raw: Record<string, unknown>, now: number): Save {
  const slotsIn = Array.isArray(raw.slots) ? raw.slots : [];
  const slots: (SaveJelly | null)[] = [];
  const used: string[] = [];
  const tier = clamp(Math.round(finite(raw.tier, 0)), 0, TIER_N - 1);
  let kept = 0;
  for (let i = 0; i < MAX_SLOTS; i++) {
    const r: unknown = slotsIn[i];
    if (!r || typeof r !== "object" || kept >= maxJelliesOf(tier)) {
      slots.push(null);
      continue;
    }
    kept++;
    const o = r as Record<string, unknown>;
    const g = stageOrSpecies(o.g);
    const name = cleanName(o.name) ?? pickName(used, seedOf(now, i));
    used.push(name);
    slots.push({
      k: speciesOf(o.k),
      g,
      gp: Math.max(GROWTH[g], finite(o.gp, GROWTH[g])),
      care: clamp(finite(o.care, 0), 0, CARE_SECONDS),
      fullness: clamp(finite(o.fullness, 0.7)),
      affection: clamp(finite(o.affection, 0.4)),
      anchor: Math.round(finite(o.anchor, -1)),
      spot: Math.round(finite(o.spot, -1)),
      name,
      born: finite(o.born, now),
      content: clamp(finite(o.content, 0), 0, BABY_SECONDS),
      morph: morphOf(o.morph),
      trait: traitOf(o.trait) ?? traitFromName(name, speciesOf(o.k)),
    });
  }
  const ownedIn = Array.isArray(raw.owned) ? raw.owned : [];
  const owned = Array.from({ length: DECOR_N }, (_, i) => ownedIn[i] === true);
  const helpersIn = Array.isArray(raw.helpers) ? raw.helpers : [];
  const decorIn = Array.isArray(raw.decorX) ? raw.decorX : [];
  const foods = ownedList(raw.foods, FOOD_KINDS);
  const themes = ownedList(raw.themes, THEME_N);
  const spots =
    raw.v === 8 || raw.v === 9 || raw.v === 10 || raw.v === 11 ? spotsFromSave(raw.spots, tierRight(tier)) : spotsForMurk(clamp(finite(raw.murk, 0.1)), tierRight(tier), rng(finite(raw.lastSeen, now)));
  return {
    v: 11,
    slots,
    dollars: clamp(Math.floor(finite(raw.dollars, 0)), 0, MAX_DOLLARS),
    murk: murkOf(spots),
    spots: toSaveSpots(spots),
    night: raw.night === true,
    lamp: lampOf(raw.lamp),
    owned,
    helpers: Array.from({ length: HELPER_N }, (_, i) => helpersIn[i] === true),
    decorX: DECOR.map((d, n) => decorClampX(n, finite(decorIn[n], d.x), tier)),
    pearlDay: typeof raw.pearlDay === "string" && DAY_RE.test(raw.pearlDay) ? raw.pearlDay : "",
    lastSeen: finite(raw.lastSeen, now),
    tier,
    cam: snap(clamp(finite(raw.cam, 0), camLo(worldWOf(tier)), 0)),
    journal: raw.v === 7 || raw.v === 8 || raw.v === 9 || raw.v === 10 || raw.v === 11 ? journalOf(raw.journal, slots, now) : journalFrom(slots, now),
    foods,
    themes,
    theme: themeOf(raw.theme, themes),
    ...requestsField(requestsOf(raw.requests)),
    ...keepField(keepOf(raw.keep)),
    ...storedField(storedOf(raw.stored, owned)),
  };
}

/** v12: the optional `requests` save field: only there once a day has been planned. */
const requestsField = (r: DailyRequests | null): { requests?: DailyRequests } => (r ? { requests: copyRequests(r) } : {});
/** v13: the optional `keep` save field: only there once keepsakes have been evaluated. */
const keepField = (k: KeepSave | null): { keep?: KeepSave } => (k ? { keep: copyKeep(k) } : {});
/** v15: which owned decorations a save has put away (missing or damaged: none; only owned ones can be). */
const storedOf = (raw: unknown, owned: readonly boolean[]) => Array.from({ length: DECOR_N }, (_, i) => owned[i] === true && Array.isArray(raw) && raw[i] === true);
/** v15: the optional `stored` save field: only there while something is put away. */
const storedField = (st: readonly boolean[]): { stored?: boolean[] } => (st.some(Boolean) ? { stored: [...st] } : {});

// ---------------------------------------------------------------- day and night

const HOUR = 3_600_000;

/** Night by the local wall clock: 19:00 up to (not including) 07:00. */
export function isNightByClock(ms: number): boolean {
  const h = new Date(ms).getHours();
  return h >= NIGHT_FROM || h < DAY_FROM;
}

/** The next scheduled change of light strictly after `ms`: the next local 07:00 or 19:00. */
export function nextLightChange(ms: number): number {
  const d = new Date(ms);
  for (let add = 0; add < 3; add++) {
    for (const h of [DAY_FROM, NIGHT_FROM]) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, h).getTime();
      if (t > ms) return t;
    }
  }
  return ms + 12 * HOUR;
}

/** The override if it still holds at `clock` (and isn't absurdly far off), else null. */
const liveLamp = (lamp: LampOverride | null | undefined, clock: number): LampOverride | null =>
  lamp && lamp.until > clock && lamp.until - clock <= 24 * HOUR ? { night: lamp.night, until: lamp.until } : null;

// ---------------------------------------------------------------- time away

/**
 * Time away still matters, but nothing ever dies: hunger floors at 10%.
 * Good care (fullness > 0.3, murk < 0.6) keeps paying growth points while
 * away, at most 8 per absence; stage-ups happen on the first step() back.
 * v8: the glass gets dirty as if the time passed (spots appear and grow, for up to 20 minutes and to
 * murk 0.8 at most); the snail keeps grazing the whole absence, down to lightly cloudy (0.3).
 */
export function applyAway(save: Save, now: number, growthMultiplier = 1): Save {
  const away = Math.max(0, (now - save.lastSeen) / 1000);
  const tier = clamp(Math.round(finite(save.tier, 0)), 0, TIER_N - 1);
  const right = tierRight(tier);
  const start = Array.isArray(save.spots) ? spotsFromSave(save.spots, right) : spotsForMurk(save.murk, right, rng(save.lastSeen));
  const dirt = dirtAway(start, away, right, save.helpers[SNAIL] === true, SNAIL_FLOOR, GOOD_MURK, Math.floor(finite(save.lastSeen, 0) / 1000) + 7);
  return {
    ...save,
    slots: save.slots.map((j) => {
      if (!j) return null;
      const fullGood = j.fullness > GOOD_FULLNESS ? (j.fullness - GOOD_FULLNESS) * RATES.hungerAway : 0;
      const good = dirt.goodTime(Math.min(away, fullGood));
      const pts = Math.min(AWAY_GROWTH_CAP, Math.floor((good * growthMultiplier) / CARE_SECONDS));
      return {
        ...j,
        gp: j.gp + pts,
        fullness: Math.max(Math.min(j.fullness, 0.1), j.fullness - away / RATES.hungerAway),
        affection: Math.max(0, j.affection - away / (RATES.affectionDecay * 20)),
      };
    }),
    murk: dirt.murk,
    spots: toSaveSpots(dirt.spots),
    lastSeen: now,
  };
}

/** Parse whatever localStorage held into a v11 save (no time away yet); `fresh` = it was a brand-new game. */
function parseSave(raw: string | null, now: number): { save: Save; fresh: boolean } {
  try {
    const d: unknown = raw ? JSON.parse(raw) : null;
    const o = d && typeof d === "object" ? (d as Record<string, unknown>) : null;
    if (o?.v === 11 || o?.v === 10 || o?.v === 9 || o?.v === 8 || o?.v === 7 || o?.v === 5 || o?.v === 4 || o?.v === 3 || o?.v === 2) return { save: sanitize(o, now), fresh: false };
    if (o?.v === 1)
      return {
        save: migrateV1(
          {
            v: 1,
            fullness: finite(o.fullness, 0.7),
            murk: finite(o.murk, 0.1),
            affection: finite(o.affection, 0.4),
            night: o.night === true,
            lastSeen: finite(o.lastSeen, now),
          },
          now,
        ),
        fresh: false,
      };
  } catch {
    /* garbage: start fresh */
  }
  return { save: defaultSave(now), fresh: true };
}

/** Parse whatever localStorage held (v1..v11, no v6; garbage or nothing), migrate to v11, and apply time away. */
export function loadSave(raw: string | null, now: number, opts: SimOptions = {}): Save {
  return loadGame(raw, now, opts).save;
}

export interface AwaySummary {
  /** how long the player was away */
  seconds: number;
  /** short past-tense lines, at most 4 */
  lines: string[];
}

/** The highest stage `gp` points reach from stage g (stage-ups only go up). */
function stageFor(g: Stage, gp: number): Stage {
  let out = g;
  while (out < ADULT && gp >= GROWTH[(out + 1) as Stage]) out = (out + 1) as Stage;
  return out;
}

const GREW_TO = ["", "budded into an ephyra", "grew into a juvenile", "grew into an adult"] as const;

/** "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What changed while the tank was left alone, from the save before and after applyAway:
 * jellies that will grow on the first step back, jellies that got hungry, the water
 * turning cloudy (or the snail clearing it), a new day's pearl. Null when away < 10 minutes.
 */
export function awaySummary(before: Save, after: Save): AwaySummary | null {
  const seconds = Math.max(0, (after.lastSeen - before.lastSeen) / 1000);
  if (seconds < AWAY_SUMMARY_MIN) return null;
  // [priority (lower is kept first when there are too many), line]; listed in reading order
  const picks: [number, string][] = [];
  const hungry: string[] = [];
  before.slots.forEach((b, i) => {
    const a = after.slots[i];
    if (!b || !a) return;
    const g = stageFor(a.g, a.gp);
    if (g > b.g) picks.push([1, `${a.name} ${GREW_TO[g]}.`]);
    if (b.fullness >= GOOD_FULLNESS && a.fullness < GOOD_FULLNESS) hungry.push(a.name);
  });
  if (hungry.length) picks.push([0, `${listNames(hungry)} got hungry.`]);
  if (before.murk < 0.5 && after.murk >= 0.5) picks.push([3, "The water got cloudy."]);
  else if (before.helpers[SNAIL] && before.murk > SNAIL_FLOOR && after.murk <= before.murk - 0.1) picks.push([4, "The snail cleaned the glass."]);
  const today = dayKey(after.lastSeen);
  if (after.owned[CLAM] && after.stored?.[CLAM] !== true && after.pearlDay !== today && dayKey(before.lastSeen) !== today) picks.push([2, "A pearl is waiting in the clam."]);
  if (!picks.length) {
    const names = after.slots.filter((j): j is SaveJelly => j !== null).map((j) => j.name);
    picks.push([5, names.length === 1 ? `${names[0]} drifted about.` : "The jellies drifted about."]);
  }
  const keep = new Set(
    picks
      .map((p, i) => ({ p: p[0], i }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .slice(0, AWAY_LINES_MAX)
      .map((e) => e.i),
  );
  return { seconds, lines: picks.filter((_, i) => keep.has(i)).map((p) => p[1]) };
}

/**
 * loadSave plus a "while you were away" summary: null for a brand-new game or an
 * absence under 10 minutes.
 */
export function loadGame(raw: string | null, now: number, opts: SimOptions = {}): { save: Save; away: AwaySummary | null } {
  const { save: before, fresh } = parseSave(raw, now);
  const save = applyAway(before, now, opts.growthMultiplier ?? 1);
  return { save, away: fresh ? null : awaySummary(before, save) };
}

/**
 * A tank set up for a short promo clip (pair it with growthMultiplier 1): an adult moon
 * called Mochi mid-tank; a hungry moon polyp on the first rock one meal from budding
 * (hungry enough that care alone won't bud it first, and the Feed pinch drops over it);
 * 200 dollars; the castle; no helpers; clear water; night by a lamp override that holds
 * at least half an hour, so the clip opens on the glow; no pearl. The small tank, camera at 0.
 */
export function demoSave(now = Date.now()): Save {
  let until = nextLightChange(now);
  if (until - now < HOUR / 2) until = nextLightChange(until);
  const slots = withSlots([
    { ...freshJelly(MOON, ADULT, "Mochi", now - 3 * 24 * HOUR), fullness: 0.85, affection: 0.7 },
    { ...freshJelly(MOON, POLYP, "Bloop", now), gp: GROWTH[EPHYRA] - 1, fullness: 0.25, affection: 0.6, anchor: 0 },
  ]);
  return {
    v: 11,
    slots,
    dollars: 200,
    murk: 0,
    spots: [],
    night: true,
    lamp: { night: true, until },
    owned: noDecor().map((_, n) => n === 0),
    helpers: noHelpers(),
    decorX: defaultDecorX(),
    pearlDay: dayKey(now),
    lastSeen: now,
    tier: 0,
    cam: 0,
    journal: journalFrom(slots, now - 2 * 24 * HOUR),
    foods: starterFoods(),
    themes: starterThemes(),
    theme: 0,
  };
}

function modeFor(k: Species, g: Stage): Mode {
  if (g === POLYP) return "fixed";
  if (k === UPSIDE && g >= JUVENILE) return "settled";
  return "swim";
}

/** First rock anchor this tier has that no other polyp sits on; -1 if all taken. */
function freeAnchor(slots: (Jelly | null)[], tier: number, except: Jelly | null = null): number {
  const used = new Set(slots.filter((j) => j && j !== except && j.mode === "fixed").map((j) => j!.anchor));
  return POLYP_ANCHORS.findIndex((a, i) => a.tier <= tier && !used.has(i));
}

/** First settle spot this tier has that no other upside-down uses; else the nearest one it has. */
function freeSpot(slots: (Jelly | null)[], j: Jelly, tier: number): number {
  const used = new Set(slots.filter((o) => o && o !== j && (o.mode === "settled" || o.mode === "settling")).map((o) => o!.spot));
  const free = SETTLE_SPOTS.findIndex((p, i) => p.tier <= tier && !used.has(i));
  if (free >= 0) return free;
  let best = 0;
  SETTLE_SPOTS.forEach((p, i) => {
    if (p.tier <= tier && Math.abs(p.x - j.x) < Math.abs(SETTLE_SPOTS[best]!.x - j.x)) best = i;
  });
  return best;
}

/** A species/stage geometry with its right-hand x limits at a right glass of `right` (world x). */
function geomAt(k: Species, g: Stage, right: number): Geom {
  const base = geomOf(k, g);
  const dx = right - K.glassR;
  return dx === 0 ? base : { ...base, bounds: { ...base.bounds, x1: base.bounds.x1 + dx }, hard: { ...base.hard, x1: base.hard.x1 + dx } };
}

/** The tank the jellies swim in now: its right glass follows the wall as it slides out. */
const geomIn = (s: State, k: Species, g: Stage) => geomAt(k, g, rightGlass(s));

function makeJelly(sj: SaveJelly, slot: number, slots: (Jelly | null)[], tier: number, right: number): Jelly {
  const j: Jelly = {
    k: sj.k,
    g: sj.g,
    gp: sj.gp,
    care: sj.care,
    fullness: sj.fullness,
    affection: sj.affection,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    pulse: slot * 0.31,
    tent: slot * 0.27,
    trail: TRAIL_NEUTRAL,
    trailAt: -Infinity,
    svx: 0,
    svy: 0,
    tilt: newTilt(),
    target: null,
    targetKind: null,
    targetUntil: 0,
    wiggleT0: -Infinity,
    loveT0: -Infinity,
    petReadyAt: 0,
    anchor: -1,
    spot: -1,
    mode: modeFor(sj.k, sj.g),
    thrust: 0,
    name: sj.name,
    born: sj.born,
    content: sj.content,
    morph: morphOf(sj.morph),
    trait: traitOfSave(sj),
    ride: 0,
  };
  if (j.mode === "fixed") {
    const ok =
      sj.anchor >= 0 && sj.anchor < POLYP_ANCHORS.length && POLYP_ANCHORS[sj.anchor]!.tier <= tier && !slots.some((o) => o && o.mode === "fixed" && o.anchor === sj.anchor);
    j.anchor = ok ? sj.anchor : Math.max(0, freeAnchor(slots, tier));
    const a = POLYP_ANCHORS[j.anchor]!;
    j.x = a.x;
    j.y = a.y;
  } else if (j.mode === "settled") {
    const ok = sj.spot >= 0 && sj.spot < SETTLE_SPOTS.length && SETTLE_SPOTS[sj.spot]!.tier <= tier && !slots.some((o) => o && o.mode === "settled" && o.spot === sj.spot);
    j.spot = ok ? sj.spot : freeSpot(slots, j, tier);
    const p = SETTLE_SPOTS[j.spot]!;
    j.x = p.x;
    j.y = p.y;
  } else {
    const b = geomAt(j.k, j.g, right).bounds;
    j.x = clamp(START_X[slot] ?? 360, b.x0, b.x1);
    j.y = clamp(540, b.y0, b.y1);
  }
  return j;
}

export function createState(save: Save, rand: () => number = Math.random, opts: SimOptions = {}): State {
  const tier = clamp(Math.round(finite(save.tier, 0)), 0, TIER_N - 1);
  const worldW = worldWOf(tier);
  const right = glassRightOf(worldW);
  const slots: (Jelly | null)[] = Array.from({ length: MAX_SLOTS }, () => null);
  let kept = 0;
  save.slots.slice(0, MAX_SLOTS).forEach((sj, i) => {
    if (!sj || kept >= maxJelliesOf(tier)) return;
    slots[i] = makeJelly(sj, i, slots, tier, right);
    kept++;
  });
  const world = helperWorld(right, openSandsOf(tier));
  const helpers = Array.from({ length: HELPER_N }, (_, i) => save.helpers?.[i] === true);
  const clock = finite(save.lastSeen, Date.now());
  // the clock decides day or night, unless the lamp was switched and that hasn't run out
  const lamp = liveLamp(save.lamp, clock);
  const nightNow = lamp ? lamp.night : isNightByClock(clock);
  // the glass: the saved spots (older hand-made saves: spots for their murk)
  // the dirt has its own random stream, so it doesn't shift everything else's
  const dirtRand = rng(Math.floor(clock / 1000) + 11);
  const spots = spotSlots(Array.isArray(save.spots) ? spotsFromSave(save.spots, right) : spotsForMurk(finite(save.murk, 0.1), right, rng(clock)));
  const state: State = {
    t: 0,
    rand,
    growthMultiplier: opts.growthMultiplier ?? 1,
    slots,
    food: Array.from({ length: K.foodN }, () => ({ state: "off" as FoodState, kind: FLAKES, x: 0, y: 0, vy: 0, age: 0, seed: 0, ex: 0, ey: 0, by: -1 })),
    murk: murkOf(spots),
    nightTarget: nightNow,
    night: nightNow ? 1 : 0,
    lamp,
    dollars: clamp(Math.floor(save.dollars), 0, MAX_DOLLARS),
    owned: Array.from({ length: DECOR_N }, (_, i) => save.owned[i] === true),
    ripple: null,
    wipe: null,
    spots,
    dirtRand,
    nextSpot: SPOT_GAP_MIN * 0.5 + dirtRand() * SPOT_GAP_SPREAD,
    snailSpot: -1,
    tool: "none",
    cursor: { x: K.W / 2, y: 540, down: false, visible: false },
    pour: { tokens: POUR_BURST, at: 0, last: -Infinity },
    pressUntil: [0, 0, 0, 0, 0, 0],
    shop: { open: false, from: SHOP_CLOSED_Y, to: SHOP_CLOSED_Y, t0: -Infinity },
    shopScroll: 0,
    fx: null,
    queued: [],
    clock,
    tab: 0,
    decorX: DECOR.map((d, n) => decorClampX(n, save.decorX?.[n] ?? d.x, tier)),
    lifted: -1,
    stored: storedOf(save.stored, save.owned),
    drawer: { e: 0, hot: false },
    helpers,
    snail: newSnail(rand, 0, world),
    shrimp: newShrimp(),
    crab: newCrab(rand),
    pearlDay: typeof save.pearlDay === "string" ? save.pearlDay : "",
    pearlWas: false,
    tier,
    wall: null,
    cam: newCam(clamp(finite(save.cam, 0), camLo(worldW), 0)),
    focus: { slot: -1, on: false, e: 0 },
    hints: { l: 0, r: 0 },
    reducedMotion: false,
    dragX: null,
    journal: journalOf(save.journal, save.slots, clock),
    visit: null,
    nextVisit: VISIT_GAP_MIN + rand() * VISIT_GAP_SPREAD,
    lastVisitor: -1,
    foods: ownedList(save.foods, FOOD_KINDS),
    themes: ownedList(save.themes, THEME_N),
    theme: 0,
    event: null,
    requests: requestsOf(save.requests),
    requestsOn: opts.requests === true,
    seasonalMorph: opts.seasonalMorph ?? null,
    traitRand: rng(Math.floor(clock / 1000) + 23),
    cursorTravel: 0,
    cursorSpeed: 0,
    keep: keepOf(save.keep),
    keepOn: opts.keepsakes === true,
    keepAtLoad: [],
  };
  state.theme = themeOf(save.theme, state.themes);
  for (const j of jellies(state)) noteJelly(state, j);
  if (state.keepOn) state.keepAtLoad = loadKeepsakes(state, save);
  // the hints start where they belong: no fade-in on load
  state.hints = { l: hintTarget(state, -1), r: hintTarget(state, 1) };
  return state;
}

export function toSave(s: State, now: number): Save {
  return {
    v: 11,
    slots: s.slots.map((j) =>
      j
        ? { k: j.k, g: j.g, gp: j.gp, care: j.care, fullness: j.fullness, affection: j.affection, anchor: j.anchor, spot: j.spot, name: j.name, born: j.born, content: j.content, morph: j.morph, trait: j.trait }
        : null,
    ),
    dollars: s.dollars,
    murk: murkOf(s.spots),
    spots: toSaveSpots(s.spots),
    night: s.nightTarget,
    lamp: liveLamp(s.lamp, s.clock),
    owned: [...s.owned],
    helpers: [...s.helpers],
    decorX: [...s.decorX],
    pearlDay: s.pearlDay,
    lastSeen: now,
    tier: s.tier,
    cam: camX(s),
    journal: copyJournal(s.journal),
    foods: [...s.foods],
    themes: [...s.themes],
    theme: s.theme,
    ...requestsField(s.requests),
    ...keepField(s.keep),
    ...storedField(storedOf(s.stored, s.owned)),
  };
}

export const jellies = (s: State) => s.slots.filter((j): j is Jelly => j !== null);
export const jellyCount = (s: State) => jellies(s).length;

// ---------------------------------------------------------------- world and camera (v5)

/** World width of the tank's tier (the right wall's resting x): 720 / 1080 / 1440. */
export const worldW = (s: State) => worldWOf(s.tier);
/** Most jellies this tank holds: 3 / 5 / 7. */
export const maxJellies = (s: State) => maxJelliesOf(s.tier);

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** The right wall's world x now: the tier's width, or on its way there after an upgrade (unsnapped). */
export function wallX(s: State): number {
  const w = s.wall;
  if (!w) return worldW(s);
  const p = clamp((s.t - w.t0) / WALL_TIME);
  return w.from + (w.to - w.from) * smoothstep(p);
}
/** World x of the inside of the right glass now. */
export const rightGlass = (s: State) => glassRightOf(wallX(s));
/** The leftmost camera offset now: -(wallX - 720). */
const camMin = (s: State) => camLo(wallX(s));

/** The World node's x (≤ 0), on the pixel grid: the pan offset, before any close-up. */
export const camX = (s: State) => snap(s.cam.x);

// ---------------------------------------------------------------- close-up on a jelly (its card is open)

/** 4/3 turns each 3-unit art pixel into exactly 4: the zoomed sprites stay on a whole-pixel grid. */
export const ZOOM = 4 / 3;
/** where the focused jelly's body sits on screen: high, so the card fits below it */
const FOCUS_AT = { x: 360, y: 330 };
const FOCUS_TIME = 0.35;
/** the bottom of the water on screen: the cabinet covers everything below */
const WATER_SCREEN_BOTTOM = 1068;
const easeIO = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Ease the camera into a close-up of a jelly (the host calls this when its card opens). */
export function focusJelly(s: State, slot: number): void {
  if (!s.slots[slot]) return;
  setTool(s, "none");
  s.focus.slot = slot;
  s.focus.on = true;
}
/** Ease back out (card closed). */
export function unfocus(s: State): void {
  s.focus.on = false;
}

/** The World nodes' transform: screen = world × z + (tx, ty). */
export function viewXform(s: State): { z: number; tx: number; ty: number } {
  const base = { z: 1, tx: camX(s), ty: 0 };
  const j = s.slots[s.focus.slot];
  const e = easeIO(clamp(s.focus.e));
  if (e <= 0 || !j) return base;
  const fy = j.y - geomOf(j.k, j.g).body.top / 2;
  const tx = clamp(FOCUS_AT.x - j.x * ZOOM, VIEW_W - wallX(s) * ZOOM, 0);
  const ty = clamp(FOCUS_AT.y - fy * ZOOM, WATER_SCREEN_BOTTOM * (1 - ZOOM), 0);
  return { z: 1 + (ZOOM - 1) * e, tx: Math.round(base.tx + (tx - base.tx) * e), ty: Math.round(ty * e) };
}

/** Artboard (screen) x → world x. */
export const screenToWorld = (s: State, x: number) => {
  const f = viewXform(s);
  return (x - f.tx) / f.z;
};
/** World x → artboard (screen) x. */
export const worldToScreen = (s: State, x: number) => {
  const f = viewXform(s);
  return x * f.z + f.tx;
};
/** World y → artboard (screen) y (differs from y only in a close-up). */
export const worldToScreenY = (s: State, y: number) => {
  const f = viewXform(s);
  return y * f.z + f.ty;
};
/** The world x range on screen (the artboard's width). */
export const viewSpan = (s: State) => ({ x0: screenToWorld(s, 0), x1: screenToWorld(s, VIEW_W) });

/** The shop is up (or sliding): the tank doesn't take taps or pans. */
const shopBlocks = (s: State) => s.shop.open || shopY(s) < SHOP_CLOSED_Y - 0.5;

/**
 * Drag the view by dx artboard px (finger moving right = dx > 0 = see further left).
 * Takes over from any fling or ease; clamped to the tank. Ignored while the shop is up.
 */
export function panBy(s: State, dx: number): void {
  if (shopBlocks(s) || !Number.isFinite(dx)) return;
  s.cam.ease = null;
  s.cam.v = 0;
  s.cam.x = clamp(s.cam.x + dx, camMin(s), 0);
}

/**
 * Let go of a pan at vx artboard px/s: the view glides on, slowing smoothly (v·e^(-t/0.4 s)),
 * and eases to a stop at the end of the tank instead of hitting it. Ignored while the shop is up.
 */
export function flingCam(s: State, vx: number): void {
  if (shopBlocks(s) || !Number.isFinite(vx)) return;
  s.cam.ease = null;
  const v = clamp(vx, -FLING_MAX, FLING_MAX);
  s.cam.v = Math.abs(v) < FLING_REST || s.reducedMotion ? 0 : v;
}

/** Ease the view to centre on world x (as near as the tank's ends allow). */
export function camTo(s: State, x: number): void {
  if (!Number.isFinite(x)) return;
  const to = clamp(VIEW_W / 2 - x, camLo(worldW(s)), 0);
  s.cam.v = 0;
  if (s.reducedMotion) {
    s.cam.ease = null;
    s.cam.x = to;
    return;
  }
  s.cam.ease = { from: s.cam.x, to, t0: s.t, dur: easeTime(to - s.cam.x) };
}

/** Reduce motion on or off (State.reducedMotion). Turning it on lands any camera move where it was going. */
export function setReducedMotion(s: State, on: boolean): void {
  s.reducedMotion = !!on;
  if (!s.reducedMotion) return;
  s.cam.v = 0;
  if (s.cam.ease) {
    s.cam.x = clamp(s.cam.ease.to, camMin(s), 0);
    s.cam.ease = null;
  }
}

/** Is the camera still moving (fling or ease)? */
export const camMoving = (s: State) => s.cam.v !== 0 || s.cam.ease !== null;

/** 1 when there's more tank that way (dir -1 left, +1 right) and the shop isn't up. */
function hintTarget(s: State, dir: -1 | 1): number {
  if (s.shop.open) return 0;
  return (dir < 0 ? s.cam.x < -0.5 : s.cam.x > camMin(s) + 0.5) ? 1 : 0;
}
export const moodOf = (s: State, j: Jelly) => clamp(0.5 * j.fullness + 0.3 * (1 - s.murk) + 0.2 * j.affection);
/** Average mood across the tank. */
export function mood(s: State): number {
  const js = jellies(s);
  return js.length ? js.reduce((a, j) => a + moodOf(s, j), 0) / js.length : 0;
}

/** Add sand dollars (capped at MAX_DOLLARS) and report what was actually earned. Exported for friends' gifts. */
export function earn(s: State, amount: number, events: SimEvent[], slot?: number): void {
  const before = s.dollars;
  s.dollars = Math.min(MAX_DOLLARS, s.dollars + amount);
  const got = s.dollars - before;
  if (got > 0) events.push(slot === undefined ? { type: "earned", amount: got } : { type: "earned", amount: got, slot });
}

/** Where on the body a pellet is drawn into, and where sparkles burst. */
function bodyCentre(j: Jelly): { x: number; y: number } {
  const b = geomOf(j.k, j.g).body;
  if (j.k === COMB && j.g >= JUVENILE) return { x: j.x, y: j.y };
  return { x: j.x, y: j.y - b.top * 0.5 };
}

// ---------------------------------------------------------------- actions

/**
 * Drop a pinch of food (up to 4 flakes) around the middle of the view. If the hungriest
 * jelly can't swim (a polyp, a settled upside-down) it goes over that one instead, and if
 * that's off screen the camera eases over so the drop is seen. Returns the flakes dropped.
 */
export function feed(s: State): number {
  s.pressUntil[0] = s.t + 0.14;
  let dropped = 0;
  const right = rightGlass(s);
  // a hungry jelly that can't swim gets the pinch dropped over it
  let hungriest: Jelly | null = null;
  for (const j of jellies(s)) if (!hungriest || j.fullness < hungriest.fullness) hungriest = j;
  let cx: number;
  if (hungriest && hungriest.mode !== "swim") {
    cx = clamp(hungriest.x + (s.rand() - 0.5) * 60, K.glassL + 40, right - 40);
    const v = viewSpan(s);
    if (hungriest.x < v.x0 + K.glassL + 60 || hungriest.x > v.x1 - (K.W - K.glassR) - 60) camTo(s, hungriest.x);
  } else {
    cx = screenToWorld(s, VIEW_W / 2) - 200 + s.rand() * 400;
  }
  for (const f of s.food) {
    if (dropped >= 4) break;
    if (f.state !== "off") continue;
    f.state = "sink";
    f.kind = FLAKES;
    f.x = clamp(cx + (s.rand() - 0.5) * 70, K.glassL + P, right - 4 * P);
    f.y = K.waterTop + 3 - dropped * 6;
    f.vy = 35 + s.rand() * 20;
    f.age = 0;
    f.seed = s.rand() * 10;
    f.by = -1;
    dropped++;
  }
  return dropped;
}

/** The old one-shot sweep (demo and tests; the Clean button now picks up the sponge): every spot fades over 1.6 s. */
export function clean(s: State): void {
  s.pressUntil[1] = s.t + 0.14;
  if (s.wipe) return;
  s.wipe = { t0: s.t, murk0: s.murk, dirt0: s.spots.map((sp) => (sp ? sp.dirt : 0)) };
}

// ---------------------------------------------------------------- v8: things you pick up

/** The press-offset prop each tool's shelf item bobs on: b0y can, b1y sponge, b4y jar, b5y bottle. */
const BTN_OF: Record<Exclude<Tool, "none">, number> = { food: 0, sponge: 1, shrimp: 4, plankton: 5 };

/** v11: does the player have this tool on the shelf? (The jar and the bottle are bought; the can and sponge always are.) */
export function hasTool(s: State, tool: Tool): boolean {
  const k = foodKindOf(tool);
  return k <= 0 || s.foods[k] === true;
}

/**
 * Pick up `tool` (or put it down with "none"). Picking something up puts the other one down. Ignored
 * (and the hand emptied) while the shop is up or a jelly's card is open. A food that hasn't been bought
 * can't be picked up (the hand stays as it was). Returns what's in hand now.
 */
export function setTool(s: State, tool: Tool): Tool {
  const known = tool === "food" || tool === "sponge" || tool === "shrimp" || tool === "plankton";
  if (known && !hasTool(s, tool)) return s.tool;
  const want: Tool = known ? tool : "none";
  const now: Tool = want !== "none" && (shopBlocks(s) || s.focus.on) ? "none" : want;
  if (now !== s.tool) {
    for (const t of [s.tool, now]) if (t !== "none") s.pressUntil[BTN_OF[t]] = s.t + 0.14;
    s.tool = now;
    s.cursor.down = false;
  }
  return s.tool;
}

/** What the shelf items do (feed: "food", clean: "sponge", v11 shrimp: "shrimp", plankton: "plankton"): pick it up, or put it down if it's in hand. */
export const toggleTool = (s: State, tool: Exclude<Tool, "none">): Tool => setTool(s, s.tool === tool ? "none" : tool);

/**
 * Where the pointer is, in SCREEN (artboard) coordinates, whether it's pressed, and whether the held
 * item should show (e.g. false when the pointer leaves the canvas). The can's spout / the sponge's
 * middle sits on the point; pressed, the can tips and pours and the sponge squishes.
 */
export function setCursor(s: State, x: number, y: number, down: boolean, visible: boolean): void {
  // v13: how far a shown item travels (a fast one startles shy jellies)
  if (s.cursor.visible && visible && Number.isFinite(x) && Number.isFinite(y)) s.cursorTravel += Math.hypot(x - s.cursor.x, y - s.cursor.y);
  if (Number.isFinite(x)) s.cursor.x = x;
  if (Number.isFinite(y)) s.cursor.y = y;
  s.cursor.down = !!down;
  s.cursor.visible = !!visible;
}

/**
 * Sprinkle food at a WORLD point: 1-2 pellets within ±12 px of it, clamped inside the water (under the
 * surface, above the sand, inside the glass). At most ~10 a second (bursts of 3) and only while the
 * pool (food0..15) has free pellets. v11: the pellets are whatever food is in hand (flakes from the can,
 * brine shrimp from the jar, plankton from the bottle; flakes with nothing in hand), or `kind` if given.
 * Returns how many went in (0: none free, or too soon).
 */
export function sprinkle(s: State, x: number, y: number, kind?: FoodKind): number {
  if (shopBlocks(s) || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const held = foodKindOf(s.tool);
  const pellet: FoodKind = kind === 0 || kind === 1 || kind === 2 ? kind : held !== -1 ? held : FLAKES;
  const pour = s.pour;
  pour.tokens = Math.min(POUR_BURST, pour.tokens + Math.max(0, s.t - pour.at) * POUR_RATE);
  pour.at = s.t;
  const right = rightGlass(s);
  let want = Math.min(Math.floor(pour.tokens + 1e-9), s.rand() < 0.5 ? 1 : 2);
  let n = 0;
  for (const f of s.food) {
    if (want <= 0) break;
    if (f.state !== "off") continue;
    const cx = clamp(x + (s.rand() - 0.5) * 2 * SPRINKLE_SPREAD, K.glassL + P + FOOD_MID, right - 4 * P + FOOD_MID);
    const fx = cx - FOOD_MID;
    const floor = sandAt(cx) - 2 * P;
    f.state = "sink";
    f.kind = pellet;
    f.x = fx;
    f.y = clamp(y + (s.rand() - 0.5) * 2 * SPRINKLE_SPREAD - FOOD_MID, K.waterTop + 3, floor);
    f.vy = 18 + s.rand() * 14;
    f.age = 0;
    f.seed = s.rand() * 10;
    f.by = -1;
    want--;
    n++;
  }
  pour.tokens -= n;
  if (n > 0) pour.last = s.t;
  // v12: pellets sprinkled by a decoration count towards a "sprinkle by the castle" request
  if (n > 0 && s.requestsOn)
    s.owned.forEach((_, d) => placed(s, d) && Math.abs(x - (s.decorX[d] ?? DECOR[d]!.x)) <= SPRINKLE_NEAR && requestDeed(s, { kind: "sprinkle", decor: d, n }, s.queued));
  return n;
}

/** Sum the glass's dirt into murk. */
const syncMurk = (s: State) => {
  s.murk = murkOf(s.spots);
};

/** Spot i is gone. Scrubbed off by the player (`paid`) from a real mess: sparkle, "spotCleaned", +1. */
function spotGone(s: State, i: number, paid: boolean): void {
  const sp = s.spots[i];
  if (!sp) return;
  s.spots[i] = null;
  if (s.snailSpot === i) s.snailSpot = -1;
  if (!paid || sp.peak < PAY_DIRT) return;
  s.fx = { x: sp.x, y: sp.y, t0: s.t };
  s.queued.push({ type: "spotCleaned", x: sp.x, y: sp.y });
  const before = s.dollars;
  s.dollars = Math.min(MAX_DOLLARS, s.dollars + SPOT_PAY);
  if (s.dollars > before) s.queued.push({ type: "earned", amount: s.dollars - before, x: sp.x, y: sp.y });
}

/**
 * Rub the sponge at a WORLD point, having moved `distance` px since the last call: every spot whose middle
 * is within ~60 px loses dirt in proportion (a full spot takes ~1.75 s of steady rubbing at 600 px/s; one
 * call counts at most 160 px). A spot that had >= 0.4 dirt and comes clean pays +1 with a sparkle
 * ("spotCleaned" and "earned" come out of the next step). Returns how much dirt came off.
 */
export function scrubAt(s: State, x: number, y: number, distance: number): number {
  if (shopBlocks(s) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(distance)) return 0;
  const amount = clamp(distance, 0, SCRUB_STEP_MAX) * SCRUB_PER_PX;
  if (amount <= 0) return 0;
  let got = 0;
  s.spots.forEach((sp, i) => {
    if (!sp || Math.hypot(sp.x - x, sp.y - y) > SCRUB_REACH) return;
    const take = Math.min(sp.dirt, amount);
    sp.dirt -= take;
    got += take;
    if (sp.dirt <= 1e-9) spotGone(s, i, true);
  });
  syncMurk(s);
  return got;
}

/** Dirty spots on the glass now: slot, where (world), dirt and kind. */
export const spots = (s: State) => s.spots.flatMap((sp, i) => (sp ? [{ i, x: sp.x, y: sp.y, dirt: sp.dirt, v: sp.v }] : []));

/** Replace the glass with spots adding up to `murk` (demo, tests, debug). */
export function setMurk(s: State, murk: number): void {
  s.spots = spotSlots(spotsForMurk(murk, rightGlass(s), s.dirtRand));
  s.snailSpot = -1;
  if (s.wipe) s.wipe = null;
  syncMurk(s);
}

/**
 * The lamp overrides the clock: flip what's showing and hold it until the next
 * scheduled change (07:00 or 19:00), when the clock takes over again. Flipping
 * back to the clock's own state just drops the override.
 */
export function toggleLamp(s: State): void {
  s.pressUntil[2] = s.t + 0.14;
  const night = !s.nightTarget;
  s.lamp = night === isNightByClock(s.clock) ? null : { night, until: nextLightChange(s.clock) };
  s.nightTarget = night;
}

/**
 * The seasonal event to show (the host: activeSeason(now, location.search, decor setting)), or null. Its decor
 * shows on the season's prop and its visitors may come; a seasonal visitor already in the tank leaves when the
 * event goes off.
 */
export function setEvent(s: State, id: SeasonId | null): void {
  s.event = id;
  const v = s.visit;
  if (v && !visitsDuring(v.kind, id) && v.age < v.leaveAt) v.leaveAt = v.age;
}

/** Night is showing because of the clock (false) or the lamp override (true). */
export const lampOverridden = (s: State) => s.lamp !== null;

/** Is the jelly in `slot` a juvenile or adult, with at least one other jelly staying behind? */
export function canRehome(s: State, slot: number): boolean {
  const j = s.slots[slot];
  return !!j && j.g >= JUVENILE && jellyCount(s) > 1;
}

/** For the jelly card: whether `slot` can be rehomed, what it would pay, and (when it can't) why, in a short line. */
export function rehomeInfo(s: State, slot: number): { allowed: boolean; reward: number; reason: string } {
  const j = s.slots[slot];
  if (!j) return { allowed: false, reward: 0, reason: "" };
  const reward = REHOME_PAY[j.g];
  if (j.g === POLYP) return { allowed: false, reward, reason: "Polyps stay on their rock." };
  if (j.g === EPHYRA) return { allowed: false, reward, reason: "Still too little to move." };
  if (jellyCount(s) <= 1) return { allowed: false, reward, reason: `${j.name} is your only jelly.` };
  return { allowed: true, reward, reason: "" };
}

/**
 * Send a grown jelly to a new home: frees its slot (and its sand spot), pays 15 for a
 * juvenile or 30 for an adult, and sparkles where it was. Queues "rehomed" then
 * "earned" (both with the slot and the jelly's x, y), out of the next step().
 * Null for polyps, ephyras, empty slots and the last jelly in the tank.
 */
export function rehome(s: State, slot: number): { name: string; dollars: number } | null {
  const j = s.slots[slot];
  if (!j || !canRehome(s, slot)) return null;
  const c = bodyCentre(j);
  const pay = REHOME_PAY[j.g];
  s.fx = { x: c.x, y: c.y, t0: s.t };
  s.queued.push({ type: "rehomed", slot, x: c.x, y: c.y });
  const before = s.dollars;
  s.dollars = Math.min(MAX_DOLLARS, s.dollars + pay);
  const got = s.dollars - before;
  if (got > 0) s.queued.push({ type: "earned", amount: got, slot, x: c.x, y: c.y });
  // pellets on their way into it finish on their own
  for (const f of s.food) if (f.by === slot && f.state === "eaten") f.by = -1;
  s.slots[slot] = null;
  return { name: j.name, dollars: got };
}

export const shopY = (s: State) => {
  const p = s.reducedMotion ? 1 : clamp((s.t - s.shop.t0) / SHOP_SLIDE);
  const e = 1 - (1 - p) ** 3;
  return s.shop.from + (s.shop.to - s.shop.from) * e;
};
export const isShopOpen = (s: State) => s.shop.open;

/** Room for one more polyp: under the tier's max and a free rock anchor. */
const roomForPolyp = (s: State) => jellyCount(s) < maxJellies(s) && freeAnchor(s.slots, s.tier) >= 0;

/** Opens on the JELLIES tab. */
export function openShop(s: State): void {
  s.pressUntil[3] = s.t + 0.14;
  setTool(s, "none");
  if (s.shop.open) return;
  s.tab = 0;
  s.shopScroll = 0;
  s.shop = { open: true, from: shopY(s), to: SHOP_OPEN_Y, t0: s.t };
}

type ScrollWindow = { max?: number; viewTop?: number; viewBottom?: number; trackTop?: number; trackH?: number };
const scrollWindow = (c: ScrollWindow) => {
  const max = Math.max(0, c.max ?? 0);
  const trackH = c.trackH ?? 759;
  return {
    max,
    viewTop: c.viewTop ?? 216,
    viewBottom: c.viewBottom ?? 975,
    trackTop: c.trackTop ?? 216,
    trackH,
    thumbH: Math.round((trackH * trackH) / (trackH + max)),
  };
};
/** The JELLIES tab's scroll window (contract.shopScroll), artboard px. */
export const SHOP_SCROLL = scrollWindow((K as unknown as { shopScroll?: ScrollWindow }).shopScroll ?? {});
/**
 * v13: every tab's scroll window (contract.shopScrollTabs; null = its cards all fit). DECOR and TANK scroll too
 * once the keepsakes join them. Contracts without the list: only the JELLIES tab scrolls.
 */
export const SHOP_SCROLLS: readonly (ReturnType<typeof scrollWindow> | null)[] = Array.from({ length: TAB_N }, (_, t) => {
  const tabs = (K as unknown as { shopScrollTabs?: (ScrollWindow | null)[] }).shopScrollTabs;
  const c = Array.isArray(tabs) ? tabs[t] : t === 0 ? {} : null;
  return c ? (t === 0 && !Array.isArray(tabs) ? SHOP_SCROLL : scrollWindow(c)) : null;
});
/** The open tab's scroll window, or null when it doesn't scroll. */
const tabScroll = (s: State) => SHOP_SCROLLS[s.tab] ?? null;

/** Scroll the open tab by dy artboard px (a finger dragging up gives dy < 0 and scrolls down). */
export function scrollShop(s: State, dy: number): void {
  const w = tabScroll(s);
  if (!s.shop.open || !w) return;
  s.shopScroll = clamp(s.shopScroll - dy, 0, w.max);
}

/** Is an artboard y inside the visible card window of the open tab, if it scrolls? (Hidden cards still hit-test in Rive.) */
export const inShopView = (s: State, y: number) => {
  const w = tabScroll(s);
  return !w || (y >= w.viewTop && y <= w.viewBottom);
};

/** Switch the shop tab (0 JELLIES, 1 DECOR, 2 HELPERS, 3 TANK); out-of-range is ignored. */
export function setTab(s: State, t: number): void {
  if (Number.isInteger(t) && t >= 0 && t < TAB_N) {
    if (t !== s.tab) s.shopScroll = 0;
    s.tab = t;
  }
}

export function closeShop(s: State): void {
  if (!s.shop.open) return;
  s.shop = { open: false, from: shopY(s), to: SHOP_CLOSED_Y, t0: s.t };
}

/**
 * "bought": paid for (a theme is applied straight away); "selected" (v11): an owned theme was picked again
 * (no charge; the host should persist and play its "ui" sound); "owned": nothing to do (a helper, food, a tank
 * already that big, or the theme already in use). v15: an owned decoration's card puts it away ("putAway") or, if
 * it's in the drawer, places it again ("placed"): no charge, the host persists. The shop stays open for both.
 */
export type BuyResult = "bought" | "cantAfford" | "tankFull" | "owned" | "needsMedium" | "needsLarge" | "selected" | "keepsake" | "putAway" | "placed";

/** A unique name for a new jelly. */
const newName = (s: State) => pickName(jellies(s).map((j) => j.name), s.rand());

/**
 * v12: the morph a new polyp gets. Bought (no parent): the base 1-in-10 classic roll. A baby: its parent's
 * morph MORPH_INHERIT of the time; otherwise (and always for a plain parent) the base roll, then, while a
 * season offers a morph (SimOptions.seasonalMorph), SEASON_MORPH_CHANCE of that. Draws only from s.rand.
 */
function birthMorph(s: State, parent: Jelly | null): number {
  if (parent && parent.morph !== MORPH_NONE && s.rand() < MORPH_INHERIT) return parent.morph;
  if (s.rand() < MORPH_CHANCE) return MORPH_CLASSIC;
  if (!parent || !s.seasonalMorph) return MORPH_NONE;
  const season = morphOf(s.seasonalMorph(s.clock));
  return season !== MORPH_NONE && s.rand() < SEASON_MORPH_CHANCE ? season : MORPH_NONE;
}

/** Put a new polyp of species k into a free slot at a free rock anchor; null if there's no room (the tier's max). */
function addPolyp(s: State, k: Species, parent: Jelly | null = null): { slot: number; j: Jelly } | null {
  const slot = s.slots.findIndex((j) => !j);
  const anchor = freeAnchor(s.slots, s.tier);
  if (slot < 0 || anchor < 0 || jellyCount(s) >= maxJellies(s)) return null;
  const morph = birthMorph(s, parent);
  // v13: a personality of its own, or (sometimes) its parent's; from the traits' own random stream
  const trait = rollTrait(s.traitRand, parent ? parent.trait : null);
  const j = makeJelly({ ...freshJelly(k, POLYP, newName(s), s.clock, morph, trait), anchor }, slot, s.slots, s.tier, rightGlass(s));
  s.slots[slot] = j;
  noteJelly(s, j);
  const c = bodyCentre(j);
  s.fx = { x: c.x, y: c.y, t0: s.t };
  return { slot, j };
}

/**
 * The tank grows to `tier`: the shop slides shut, then the right wall slides out to the new
 * width over WALL_TIME while the camera eases right to show the new space; a sparkle goes off
 * in the middle of it when the wall arrives.
 */
function upgradeTank(s: State, tier: number): void {
  const delay = shopBlocks(s) ? SHOP_SLIDE : 0;
  closeShop(s);
  const from = wallX(s);
  s.tier = tier;
  const to = worldW(s);
  const t0 = s.t + delay;
  s.wall = { from, to, t0 };
  s.cam.v = 0;
  s.cam.ease = { from: s.cam.x, to: camLo(to), t0, dur: REVEAL_TIME };
  s.queued.push({ type: "upgraded", tier });
}

/**
 * v11: use tank theme n (0 Reef, 1 Kelp Forest, 2 Coral Garden, 3 Arctic) if it's owned. The shop slides
 * shut so the new look shows, with a sparkle mid-view once it's down, and "themed" comes out of the next
 * step(). Returns false (nothing changes) for a theme that isn't owned or doesn't exist; true otherwise
 * (also when it's already the one in use, which changes nothing).
 */
export function setTheme(s: State, n: number): boolean {
  if (!Number.isInteger(n) || n < 0 || n >= THEME_N || !s.themes[n]) return false;
  if (n === s.theme) return true;
  s.theme = n;
  const delay = shopBlocks(s) ? SHOP_SLIDE : 0;
  closeShop(s);
  s.fx = { x: screenToWorld(s, VIEW_W / 2), y: THEME_FX_Y, t0: s.t + delay };
  s.queued.push({ type: "themed", theme: n });
  return true;
}

/** The theme in use (0 Reef .. 3 Arctic) and which are owned. */
export const themeInfo = (s: State) => ({ theme: s.theme, name: THEME_NAMES[s.theme] ?? THEME_NAMES[0], owned: [...s.themes] });

export function buy(s: State, i: number): BuyResult {
  const item = SHOP_ITEMS[i];
  if (!item) return "cantAfford";
  // v13: a keepsake isn't sold: until its milestone is reached the card just says how to earn it ("keepsake");
  // once earned it's owned like a bought one (a theme can be picked again, a decoration is already in)
  const owns = item.kind === "theme" ? s.themes[item.theme] === true : item.kind === "decor" && s.owned[item.d] === true;
  if (keepsakeOf(item) >= 0 && !owns) return "keepsake";
  if (item.kind === "theme") {
    if (s.themes[item.theme]) return item.theme === s.theme ? "owned" : setTheme(s, item.theme) ? "selected" : "owned";
    if (s.dollars < item.price) return "cantAfford";
    s.dollars -= item.price;
    s.themes[item.theme] = true;
    setTheme(s, item.theme);
    return "bought";
  }
  if (item.kind === "tank") {
    if (s.tier >= item.tier) return "owned";
    if (s.tier < item.tier - 1) return "needsMedium";
    if (s.dollars < item.price) return "cantAfford";
    s.dollars -= item.price;
    upgradeTank(s, item.tier);
    return "bought";
  }
  if (item.kind === "decor" && s.owned[item.d]) return putAway(s, item.d) ? "putAway" : placeDecor(s, item.d) ? "placed" : "owned";
  if (item.kind === "helper" && s.helpers[item.h]) return "owned";
  if (item.kind === "food" && s.foods[item.f]) return "owned";
  if (item.kind === "polyp" && item.needTier !== undefined && s.tier < item.needTier) return item.needTier >= 2 ? "needsLarge" : "needsMedium";
  if (item.kind === "polyp" && !roomForPolyp(s)) return "tankFull";
  if (s.dollars < item.price) return "cantAfford";
  if (item.kind === "polyp") {
    addPolyp(s, item.k);
  } else {
    if (item.kind === "decor") {
      // v14: the bubbler is wide and the small tank is crowded: it lands on the open sand with the most room.
      // v15: every decoration does (its own spot when that's free)
      s.decorX[item.d] = clearSpotFor(s, item.d);
      s.owned[item.d] = true;
      s.stored[item.d] = false;
    }
    else if (item.kind === "food") s.foods[item.f] = true;
    else {
      s.helpers[item.h] = true;
      // a fresh helper starts from its home spot
      if (item.h === SNAIL) s.snail = newSnail(s.rand, s.t, helpersWorld(s));
      else if (item.h === SHRIMP) s.shrimp = newShrimp(s.t);
      else s.crab = newCrab(s.rand, s.t);
    }
    // the card is on screen; the sparkle lives in the world
    const c = shopCardCentre(i) ?? buttonCentre(`buy${i}`) ?? { x: K.W / 2, y: 640 };
    s.fx = { x: screenToWorld(s, c.x), y: c.y, t0: s.t };
  }
  s.dollars -= item.price;
  return "bought";
}

// ---------------------------------------------------------------- jellies: hit test, card, names

/** The jelly whose body is under (x, y), nearest body centre first; -1 if none. */
export function jellyAt(s: State, x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  s.slots.forEach((j, i) => {
    if (!j || !hit(j, x, y)) return;
    const c = bodyCentre(j);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export interface JellyInfo {
  name: string;
  k: Species;
  g: Stage;
  /** whole days since it was born (sim clock) */
  ageDays: number;
  fullness: number;
  mood: number;
  /** v12: its morph id (0 none, 1 classic, 2 ghost) */
  morph: number;
  /** v13: its personality (TRAIT_NAMES / TRAIT_PHRASES) */
  trait: Trait;
}

export function jellyInfo(s: State, slot: number): JellyInfo | null {
  const j = s.slots[slot];
  if (!j) return null;
  return { name: j.name, k: j.k, g: j.g, ageDays: Math.max(0, Math.floor((s.clock - j.born) / 86_400_000)), fullness: j.fullness, mood: moodOf(s, j), morph: j.morph, trait: j.trait };
}

/** Trimmed, 1..12 characters; anything else is ignored. Returns whether the name changed. */
export function renameJelly(s: State, slot: number, name: string): boolean {
  const j = s.slots[slot];
  const clean = cleanName(name);
  if (!j || clean === null) return false;
  j.name = clean;
  return true;
}

// ---------------------------------------------------------------- decorations

/** Base y of decoration n where it stands now. */
export const decorBaseY = (s: State, n: number) => decorY(n, s.decorX[n] ?? DECOR[n]!.x);

/** v15: is decoration n in the tank (owned and not put away)? Everything that sees the sand asks this, not `owned`. */
export const placed = (s: State, n: number) => s.owned[n] === true && s.stored[n] !== true;

/** The placed decoration under (x, y), front-most (lowest base) first; -1 if none. */
export function decorAt(s: State, x: number, y: number): number {
  let best = -1;
  let bestKey = -Infinity;
  for (let n = 0; n < DECOR_N; n++) {
    if (!placed(s, n)) continue;
    const d = DECOR[n]!;
    const bx = s.decorX[n]!;
    const by = decorBaseY(s, n);
    if (Math.abs(x - bx) > d.w / 2 || y > by || y < by - d.h) continue;
    // in front first; then the one whose middle is nearer
    const key = by * 1000 - Math.abs(x - bx);
    if (key > bestKey) {
      bestKey = key;
      best = n;
    }
  }
  return best;
}

/** Pick up a placed decoration to arrange it. Returns false (and does nothing) if it isn't in the tank. */
export function liftDecor(s: State, n: number): boolean {
  if (!placed(s, n)) return false;
  s.lifted = n;
  s.dragX = null;
  s.drawer.hot = false;
  return true;
}

/** Slide decoration n to world x (clamped inside the tank's glass); its y follows the sand. */
export function moveDecor(s: State, n: number, x: number): void {
  if (!placed(s, n) || !Number.isFinite(x)) return;
  s.decorX[n] = decorClampX(n, x, s.tier);
}

/**
 * Drag the lifted decoration with the finger at artboard (screen) x. Near either edge of the
 * water the camera scrolls that way (up to 420 px/s) and the decoration rides along under the
 * finger, so it can be carried across the whole tank. v15: with the finger's y too, over the
 * put-away drawer (overDrawer) the decoration stays where it was and dropDecor() puts it away.
 */
export function moveDecorScreen(s: State, n: number, screenX: number, screenY?: number): void {
  if (!placed(s, n) || !Number.isFinite(screenX)) return;
  const lifted = s.lifted === n;
  s.drawer.hot = lifted && screenY !== undefined && overDrawer(screenX, screenY);
  if (s.drawer.hot) {
    s.dragX = null; // no edge scrolling while it hangs over the drawer
    return;
  }
  if (lifted) s.dragX = screenX;
  moveDecor(s, n, screenToWorld(s, screenX));
}

/**
 * Let go of the lifted decoration: "stored" if it was over the drawer (it's put away), "placed" if it was
 * set down on the sand, null if nothing was lifted.
 */
export function dropDecor(s: State): "stored" | "placed" | null {
  const n = s.lifted;
  const into = s.drawer.hot;
  s.lifted = -1;
  s.dragX = null;
  s.drawer.hot = false;
  if (n < 0) return null;
  return into && putAway(s, n) ? "stored" : "placed";
}

// ---- put away (v15) ----

/** The drawer's drop box while a decoration is carried (SCREEN, artboard units) and how far it slides up (contract `store`). */
export const DRAWER = (() => {
  const o = (K as unknown as { store?: { x?: number; y?: number; w?: number; h?: number; slide?: number } }).store ?? {};
  return { x: o.x ?? 216, y: o.y ?? 1050, w: o.w ?? 288, h: o.h ?? 234, slide: o.slide ?? 24 };
})();
/** Is a SCREEN point over the put-away drawer? */
export const overDrawer = (x: number, y: number) => x >= DRAWER.x && x <= DRAWER.x + DRAWER.w && y >= DRAWER.y && y <= DRAWER.y + DRAWER.h;
/** the drawer slides in and out over this long, s */
const DRAWER_TIME = 0.18;
/** decorations overlapping by less than this (artboard px) don't count as in each other's way */
const OVERLAP_MIN = 2 * P;

/**
 * Put decoration n away in the drawer: still owned (a keepsake too), just not in the tank. Returns false if it
 * isn't in the tank. Anything about it in the water stops: the pearl hides with the clam, the bubbler's column stops.
 */
export function putAway(s: State, n: number): boolean {
  if (!placed(s, n)) return false;
  if (s.lifted === n) {
    s.lifted = -1;
    s.dragX = null;
    s.drawer.hot = false;
  }
  s.stored[n] = true;
  return true;
}

/**
 * Take decoration n out of the drawer: it goes where there's room (clearSpotFor: its own spot if that's free) with a
 * sparkle. Returns false if it isn't owned or isn't put away.
 */
export function placeDecor(s: State, n: number): boolean {
  if (!s.owned[n] || !s.stored[n]) return false;
  s.stored[n] = false;
  s.decorX[n] = clearSpotFor(s, n);
  const d = DECOR[n]!;
  s.fx = { x: s.decorX[n]!, y: decorBaseY(s, n) - d.h / 2, t0: s.t };
  return true;
}

/** Decorations owned and put away, by index. */
export const storedDecor = (s: State): number[] => s.stored.flatMap((st, n) => (st && s.owned[n] ? [n] : []));

/** v15: the placed decorations the lifted one overlaps now (their outlines light up), [] when nothing is lifted. */
export function decorOverlaps(s: State): number[] {
  const n = s.lifted;
  if (n < 0 || !placed(s, n) || s.drawer.hot) return [];
  const x = s.decorX[n]!;
  const w = DECOR[n]!.w;
  const out: number[] = [];
  for (let m = 0; m < DECOR_N; m++) {
    if (m === n || !placed(s, m)) continue;
    const gap = Math.abs(x - s.decorX[m]!) - (w + DECOR[m]!.w) / 2;
    if (gap < -OVERLAP_MIN) out.push(m);
  }
  return out;
}

// ---- end put away ----

// ---------------------------------------------------------------- daily pearl

/** Local calendar day of an epoch-ms time, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Today's pearl is in the clam: the clam is owned and today's isn't collected. */
export const pearlShowing = (s: State) => placed(s, CLAM) && s.pearlDay !== dayKey(s.clock);

// ---------------------------------------------------------------- daily requests (v12)

/** What the tank has now, for planning a day's requests (./requests.ts). */
const requestTank = (s: State) => ({
  species: jellies(s).map((j) => j.k),
  foods: s.foods,
  decor: s.owned.map((_, n) => placed(s, n)),
  pearl: pearlShowing(s),
  bubbler: placed(s, BUBBLER),
});

/** Plan today's requests if the day has turned (or none were planned yet). Unfinished ones from another day just go. */
function rollRequests(s: State): DailyRequests | null {
  if (!s.requestsOn) return null;
  const today = dayKey(s.clock);
  if (!s.requests || s.requests.day !== today) s.requests = planRequests(today, requestTank(s));
  return s.requests;
}

/** Count a deed towards today's requests; each one it finishes pays its reward once ("requestDone", then "earned"). */
function requestDeed(s: State, deed: Deed, out: SimEvent[]): void {
  const day = rollRequests(s);
  if (!day) return;
  for (const i of advance(day, deed)) {
    const amount = rewardOf(day.items[i]!);
    out.push({ type: "requestDone", request: i, amount });
    earn(s, amount, out);
  }
}

/** The step's events that requests count: pellets eaten, spots scrubbed, the pearl, a visitor greeted. */
function stepRequests(s: State, events: SimEvent[]): void {
  if (!rollRequests(s)) return;
  for (const e of events.slice()) {
    const j = e.slot === undefined ? null : s.slots[e.slot];
    if (e.type === "ate" && j && e.food !== undefined) requestDeed(s, { kind: "ate", k: j.k, food: e.food }, events);
    else if (e.type === "spotCleaned") requestDeed(s, { kind: "scrub" }, events);
    else if (e.type === "pearl") requestDeed(s, { kind: "pearl" }, events);
    else if (e.type === "visitorTapped") requestDeed(s, { kind: "visitor" }, events);
    else if (e.type === "rode" && e.seen) requestDeed(s, { kind: "ride" }, events);
  }
}

/** Today's requests (a copy), each with its line and reward; null when requests are off (demo, visits). */
export function requests(s: State): { day: string; items: (Request & { text: string; reward: number })[] } | null {
  const day = rollRequests(s);
  if (!day) return null;
  return { day: day.day, items: copyRequests(day).items.map((r) => ({ ...r, text: requestText(r), reward: rewardOf(r) })) };
}

// ---------------------------------------------------------------- keepsakes (v13)

/** Milestone m's reward: its decoration goes in where there's room (v15: clearSpotFor), or its theme is owned. Returns the decoration (-1: a theme). */
function grantKeepsake(s: State, m: number): number {
  const item = SHOP_ITEMS[MILESTONES[m]?.item ?? -1];
  if (item?.kind === "decor") {
    // v15: a new one goes where there's room; one already owned (re-granted at every load) stays put, or put away
    if (!s.owned[item.d]) s.decorX[item.d] = clearSpotFor(s, item.d);
    s.owned[item.d] = true;
    return item.d;
  }
  if (item?.kind === "theme") s.themes[item.theme] = true;
  return -1;
}

/** Local days a save from before keepsakes can show it was played: its jellies' births, its species' first adults, today. */
function playedDays(save: Save, now: number): string[] {
  const at = [now, ...save.slots.flatMap((j) => (j ? [j.born] : [])), ...(Array.isArray(save.journal) ? save.journal : []).map((e) => e?.firstAdultAt)];
  return at.flatMap((t) => (typeof t === "number" && Number.isFinite(t) && t > 0 && t <= now ? [dayKey(t)] : []));
}

/**
 * Keepsakes at load (SimOptions.keepsakes): an older save gets its first `keep` (seedKeep), today counts as a day
 * played, rewards already earned are made sure of, and every milestone the save reaches now is granted quietly,
 * all at once. Returns those, for the host's one summary note.
 */
function loadKeepsakes(s: State, save: Save): number[] {
  const keep = s.keep ?? seedKeep(playedDays(save, s.clock), s.requests?.items.filter((r) => r.done).length ?? 0);
  s.keep = keep;
  countDay(keep, dayKey(s.clock));
  MILESTONES.forEach((_, m) => isEarned(keep, m) && grantKeepsake(s, m));
  const reached = newlyReached(keep, keepFacts(s.journal, keep));
  for (const m of reached) {
    keep.earned |= 1 << m;
    grantKeepsake(s, m);
  }
  return reached;
}

/** Count the step's finished requests and a new day, then grant any milestone reached: "keepsake", with a sparkle on a decoration. */
function stepKeepsakes(s: State, events: SimEvent[]): void {
  const keep = s.keep;
  if (!s.keepOn || !keep) return;
  keep.requests += events.filter((e) => e.type === "requestDone").length;
  countDay(keep, dayKey(s.clock));
  for (const m of newlyReached(keep, keepFacts(s.journal, keep))) {
    keep.earned |= 1 << m;
    const d = grantKeepsake(s, m);
    if (d >= 0) s.fx = { x: s.decorX[d] ?? DECOR[d]!.x, y: decorBaseY(s, d) - DECOR[d]!.h / 2, t0: s.t };
    events.push({ type: "keepsake", keepsake: m });
  }
}

/** v13: one row per milestone for the journal's keepsakes page: how far along (0..n), earned, and the shop item it leaves. */
export function keepsakes(s: State): { m: number; title: string; progress: number; n: number; earned: boolean; item: number; reward: string }[] {
  const keep = s.keep ?? seedKeep([], 0);
  const f = keepFacts(s.journal, keep);
  return MILESTONES.map((ms, m) => {
    const earned = isEarned(keep, m);
    return { m, title: ms.title, progress: earned ? ms.n : progressOf(m, f), n: ms.n, earned, item: ms.item, reward: ms.reward };
  });
}

/** v13: the milestones granted quietly while loading (an older save that already reached them), for one summary note. */
export const keepsakesAtLoad = (s: State): number[] => [...s.keepAtLoad];

/** Where the pearl is (follows the clam). */
export function pearlCentre(s: State): { x: number; y: number } {
  return { x: (s.decorX[CLAM] ?? DECOR[CLAM]!.x) + PEARL.dx, y: decorBaseY(s, CLAM) + PEARL.dy };
}

/**
 * Jump the sim clock to the real time (the host can call it when the tab comes back:
 * frames stop while it's hidden, so the dt-advanced clock falls behind). Never goes back.
 */
export function syncClock(s: State, now: number): void {
  if (Number.isFinite(now) && now > s.clock) s.clock = now;
}

function hit(j: Jelly, x: number, y: number): boolean {
  const b = geomOf(j.k, j.g).body;
  const halfW = Math.max(b.halfW + 2, 30);
  const top = Math.max(b.top + 5, 30);
  const below = j.k === COMB && j.g >= JUVENILE ? b.top : 10;
  return Math.abs(x - j.x) <= halfW && y >= j.y - top && y <= j.y + below;
}

/** Where a jelly's body is (world), for the host to point at it (keyboard focus, its pets); null if the slot is empty. */
export function jellyCentre(s: State, slot: number): { x: number; y: number } | null {
  const j = s.slots[slot];
  return j ? bodyCentre(j) : null;
}

/**
 * Pet the jelly in `slot` (a tap on its body, or the keyboard's Enter): it wiggles, likes you a little more,
 * pays EARN.pet if it hasn't lately, and counts toward a "pet" request. False if the slot is empty or the
 * shop is up.
 */
export function petJelly(s: State, slot: number): boolean {
  const pj = s.slots[slot];
  if (!pj || shopBlocks(s)) return false;
  pj.affection = clamp(pj.affection + 0.08);
  pj.wiggleT0 = s.t;
  if (pj.mode === "swim") pj.vy -= 25;
  if (s.t >= pj.petReadyAt) {
    pj.petReadyAt = s.t + PET_COOLDOWN;
    earn(s, EARN.pet, s.queued, slot);
  }
  requestDeed(s, { kind: "pet" }, s.queued);
  return true;
}

/**
 * A tap in the water, world coordinates (x from screenToWorld). On a visitor: the first tap of a visit
 * pays 5-10 with a sparkle, and it leaves a little early, happily ("visitor" either way).
 * On today's pearl: collect it (+15).
 * On a jelly's body: pet it. Elsewhere: call the nearest swimmer over. Does
 * nothing while the shop is up.
 */
export function tap(s: State, x: number, y: number): "visitor" | "pearl" | "pet" | "call" | null {
  if (s.shop.open || shopY(s) < SHOP_CLOSED_Y - 0.5) return null;
  if (s.visit && visitorHit(s.visit, x, y)) {
    tapVisitor(s, s.visit);
    return "visitor";
  }
  if (pearlShowing(s)) {
    const p = pearlCentre(s);
    if (Math.hypot(x - p.x, y - p.y) <= PEARL.r) {
      s.pearlDay = dayKey(s.clock);
      s.fx = { x: p.x, y: p.y, t0: s.t };
      s.queued.push({ type: "pearl", amount: PEARL_REWARD });
      earn(s, PEARL_REWARD, s.queued);
      return "pearl";
    }
  }
  if (x < K.glassL || x > rightGlass(s) || y < K.waterTop || y > K.waterBot) return null;
  s.ripple = { x, y, t0: s.t };
  const pet = jellyAt(s, x, y);
  // v13: a tap on the glass startles shy jellies nearby (not the one being petted)
  const startled = startle(s, x, y, s.slots[pet] ?? null);
  if (petJelly(s, pet)) return "pet";
  let call: Jelly | null = null;
  let callD = Infinity;
  for (const j of jellies(s)) {
    if (j.mode !== "swim" || startled.has(j)) continue;
    const c = bodyCentre(j);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < callD) {
      callD = d;
      call = j;
    }
  }
  if (call) {
    call.affection = clamp(call.affection + 0.02);
    if (call.targetKind !== "food") {
      call.ride = 0;
      const g = geomIn(s, call.k, call.g);
      // bring the bell to the finger: rim a little below the tap
      const off = call.k === COMB && call.g >= JUVENILE ? 0 : Math.min(40, g.body.top / 3);
      call.target = { x: clamp(x, g.bounds.x0, g.bounds.x1), y: clamp(y + off, g.bounds.y0, g.bounds.y1) };
      call.targetKind = "tap";
      call.targetUntil = s.t + 4;
    }
  }
  return "call";
}

// ---------------------------------------------------------------- visitors (v7)

/** The world stretch a visitor must stay in: what's on screen, inside the glass. */
function visitStretch(s: State): { x0: number; x1: number } {
  const v = viewSpan(s);
  return { x0: Math.max(v.x0, K.glassL), x1: Math.min(v.x1, rightGlass(s)) };
}

/** The visitor in the tank: which one, where (world), and whether it's still visible; null if none. */
export function visitorInfo(s: State): { kind: VisitorKind; x: number; y: number; on: number; paid: boolean } | null {
  const v = s.visit;
  if (!v) return null;
  const c = visitorCentre(v);
  return { kind: VISITORS[v.kind]!, x: c.x, y: c.y, on: v.on, paid: v.paid };
}

/** Where the diver would go next (its origin, world): the dirtiest spot it can reach on screen, or null. */
function diverAim(s: State, v: Visit): { x: number; y: number } | null {
  const c = visitorCentre(v);
  const ox = c.x - v.x;
  const oy = c.y - v.y;
  const k = dirtiest(s.spots, (sp) => sp.x - ox >= v.lo && sp.x - ox <= v.hi && sp.y - oy >= v.ylo + 40 && sp.y - oy <= Math.max(v.ylo + 40, v.yhi));
  const sp = s.spots[k];
  return sp ? { x: sp.x - ox, y: sp.y - oy } : null;
}

function tapVisitor(s: State, v: Visit): void {
  if (v.paid) return;
  v.paid = true;
  cheer(v);
  const c = visitorCentre(v);
  const amount = VISIT_PAY_MIN + Math.min(VISIT_PAY_STEPS - 1, Math.floor(s.rand() * VISIT_PAY_STEPS));
  s.fx = { x: c.x, y: c.y, t0: s.t };
  const before = s.dollars;
  s.dollars = Math.min(MAX_DOLLARS, s.dollars + amount);
  s.queued.push({ type: "visitorTapped", kind: VISITORS[v.kind]!, amount, x: c.x, y: c.y });
  if (s.dollars > before) s.queued.push({ type: "earned", amount: s.dollars - before, x: c.x, y: c.y });
}

/**
 * Schedule and run the visitors. One every 3-6 minutes, never while the shop is up (nor during a
 * jelly's close-up or the wall sliding out): it waits until those are done. While the shop is up an
 * ongoing visit holds still (the panel covers it). The diver cleans the glass while it works.
 */
function stepVisitors(s: State, dt: number, events: SimEvent[]): void {
  const blocked = shopBlocks(s);
  if (!s.visit) {
    if (s.t < s.nextVisit || blocked || s.focus.on || s.wall) return;
    const kinds = VISITORS.map((_, k) => k).filter((k) => k !== s.lastVisitor && visitsDuring(k, s.event));
    for (let i = kinds.length - 1; i > 0; i--) {
      const r = Math.floor(s.rand() * (i + 1));
      [kinds[i], kinds[r]] = [kinds[r]!, kinds[i]!];
    }
    for (const k of kinds) {
      const v = planVisit(k, visitStretch(s), s.tier, s.rand);
      if (!v) continue;
      s.visit = v;
      s.lastVisitor = k;
      events.push({ type: "visitorArrived", kind: VISITORS[k]! });
      // v13: curious jellies are the first to say hello
      for (const j of jellies(s)) {
        if (j.mode !== "swim" || j.trait !== CURIOUS || j.targetKind === "food" || j.targetKind === "tap") continue;
        j.targetKind = "visit";
        j.targetUntil = s.t + CURIOUS_VISIT;
        j.ride = 0;
      }
      break;
    }
    if (!s.visit) s.nextVisit = s.t + 10; // nothing fits this view: try again shortly
    return;
  }
  if (blocked) return;
  const v = s.visit;
  stepVisit(v, dt, s.rand, v.kind === DIVER ? diverAim(s, v) : null);
  if (v.kind === DIVER && settled(v)) {
    // the diver wipes the spots it's working on
    const c = visitorCentre(v);
    s.spots.forEach((sp, i) => {
      if (!sp || Math.hypot(sp.x - c.x, sp.y - c.y) > DIVER_REACH) return;
      sp.dirt -= Math.min(sp.dirt, DIVER_SCRUB * dt);
      if (sp.dirt <= 1e-9) spotGone(s, i, false);
    });
    syncMurk(s);
  }
  if (visitOver(v)) {
    events.push({ type: "visitorLeft", kind: VISITORS[v.kind]! });
    s.visit = null;
    s.nextVisit = s.t + VISIT_GAP_MIN + s.rand() * VISIT_GAP_SPREAD;
  }
}

// ---------------------------------------------------------------- share codes (v7)

/**
 * The tank as a short URL-safe code (base64url, ~60-130 characters for a full Large tank): tier,
 * helpers, decorations and where they stand, and each jelly's slot, species, stage, morph, anchor
 * or sand spot, and name; v11: the theme (a Reef tank's code is the same as before); v13: traits and the
 * bubbler (only when there's something an older code can't say: see ./tankcode.ts). Dollars, needs,
 * foods and the clock are left out.
 */
export function exportTank(s: State): string {
  const t: TankCode = {
    tier: s.tier,
    theme: s.theme,
    helpers: [...s.helpers],
    decor: s.owned.map((_, n) => (placed(s, n) ? snap(s.decorX[n] ?? DECOR[n]!.x) : null)),
    jellies: s.slots.flatMap((j, slot) =>
      j ? [{ slot, k: j.k, g: j.g, morph: j.morph, trait: j.trait, place: j.g === POLYP ? j.anchor : hasPlace(j.k, j.g) ? j.spot : -1, name: j.name }] : [],
    ),
  };
  return encodeTank(t);
}

/**
 * A Save for viewing someone's tank read-only (don't persist it), or null if `code` isn't a valid
 * code. The jellies are well fed and content, the water clear, no pearl waiting; lastSeen = now,
 * so no time away applies. exportTank(createState(importTank(c))) === c.
 */
export function importTank(code: string, now = Date.now()): Save | null {
  const t = decodeTank(code);
  if (!t) return null;
  const slots = emptySlots();
  for (const c of t.jellies) {
    const k = c.k as Species;
    const g = c.g as Stage;
    slots[c.slot] = {
      // v13: the trait the code carries (older codes: derived from the name, as for older saves)
      ...freshJelly(k, g, c.name, now, c.morph, c.trait ?? traitFromName(c.name, k)),
      fullness: 0.85,
      affection: 0.7,
      anchor: g === POLYP ? c.place : -1,
      spot: hasPlace(k, g) && g !== POLYP ? c.place : -1,
    };
  }
  const themes = starterThemes();
  const theme = clamp(Math.round(t.theme ?? 0), 0, THEME_N - 1);
  themes[theme] = true;
  return {
    v: 11,
    slots,
    dollars: 0,
    murk: 0,
    spots: [],
    night: isNightByClock(now),
    lamp: null,
    owned: t.decor.map((x) => x !== null),
    helpers: [...t.helpers],
    decorX: t.decor.map((x, n) => x ?? DECOR[n]!.x),
    pearlDay: dayKey(now),
    lastSeen: now,
    tier: t.tier,
    cam: 0,
    journal: journalFrom(slots, now),
    foods: starterFoods(),
    themes,
    theme,
  };
}

// ---------------------------------------------------------------- step

/** Can this jelly catch a pellet whose middle is at (fx, fy)? */
function catches(j: Jelly, fx: number, fy: number): boolean {
  const b = geomOf(j.k, j.g).body;
  if (j.mode === "fixed") {
    // anywhere along the stalk and crown
    const dy = clamp(j.y - fy, 0, b.top);
    return Math.hypot(fx - j.x, fy - (j.y - dy)) <= b.halfW + 18;
  }
  if (j.mode === "settled" || j.mode === "settling") {
    return Math.abs(fx - j.x) <= b.halfW + 18 && fy >= j.y - b.top - 18 && fy <= j.y + 12;
  }
  // under the bell, within the oral arms' reach
  return Math.abs(fx - j.x) <= Math.max(b.halfW * 0.65, 20) && fy >= j.y - 10 && fy <= j.y + Math.max(b.reach, 26);
}

/** The point food drifts toward, for jellies that lure it. */
function lurePoint(j: Jelly): { x: number; y: number } | null {
  const b = geomOf(j.k, j.g).body;
  if (j.mode === "fixed") return { x: j.x, y: j.y - b.top * 0.8 };
  if (j.mode === "settled") return { x: j.x, y: j.y - b.top * 0.4 };
  return null;
}

function stageUp(s: State, slot: number, j: Jelly, events: SimEvent[]): void {
  const from = j.g;
  j.g = (from + 1) as Stage;
  if (from === POLYP) {
    // the ephyra buds off the top of the stalk and swims away
    j.y -= geomOf(j.k, POLYP).body.top;
    j.anchor = -1;
    j.mode = "swim";
    j.vy = -30;
    j.target = null;
    j.targetKind = null;
  } else if (j.k === UPSIDE && j.g === JUVENILE) {
    j.mode = "settling";
    j.spot = freeSpot(s.slots, j, s.tier);
    j.target = null;
    j.targetKind = null;
  }
  if (j.mode === "swim") {
    // the bigger body has to fit in the water straight away
    const g = geomIn(s, j.k, j.g);
    j.x = clamp(j.x, g.hard.x0, g.hard.x1);
    j.y = clamp(j.y, g.hard.y0, Math.min(sandAt(j.x) - g.rimAbove, g.bounds.y1));
  }
  j.wiggleT0 = s.t;
  const c = bodyCentre(j);
  s.fx = { x: c.x, y: c.y, t0: s.t };
  events.push({ type: "grew", slot, stage: j.g });
  if (j.g === ADULT) {
    events.push({ type: "adult", slot });
    const e = s.journal[j.k]!;
    e.seen = true;
    e.raised++;
    if (e.firstAdultAt === null) {
      e.firstAdultAt = s.clock;
      e.firstName = j.name;
    }
  }
  earn(s, STAGE_REWARD[j.g], events, slot);
}

function swim(s: State, slot: number, j: Jelly, dt: number, events: SimEvent[]): void {
  const g = geomIn(s, j.k, j.g);
  const { bounds, hard } = g;
  const sw = swimOf(j.k, j.g);

  // v13: hiding, saying hello and riding the bubbler are errands too. With reduce motion a frightened shy jelly
  // doesn't dart: it drifts to its hiding place at its idle pace and sinks only a little faster.
  const gentleHide = j.targetKind === "hide" && s.reducedMotion;
  const busy = j.targetKind !== null && j.targetKind !== "wander" && !gentleHide;
  const target = j.target ?? { x: j.x, y: j.y };
  const tx = target.x - j.x;
  const ty = target.y - j.y;
  const dist = Math.hypot(tx, ty);

  // quiet nights: idle jellies pulse less often and push more gently; gliders slow down (sleepy ones from an hour early)
  const calm = calmFor(s, j);
  // v13: a sleepy jelly rests longer between idle pulses
  const lazy = !busy && j.trait === SLEEPY ? SLEEPY_PERIOD : 1;
  if (sw.glide) {
    // comb: cilia, not a bell: no thrust, just a smooth glide; the rows shimmer all the time
    j.pulse = (j.pulse + (dt / sw.shimmer) * (s.reducedMotion ? 0.35 : 1)) % 1;
    const speed = busy ? sw.speedBusy : sw.speedIdle * quietScale(QUIET.glide, calm);
    const want = dist > 6 ? Math.min(speed, dist * 0.6) / dist : 0;
    const a = 1 - Math.exp(-sw.ease * dt);
    j.vx += (tx * want - j.vx) * a;
    j.vy += (ty * want - j.vy) * a;
  } else {
    // pulse the bell, thrust during the squeeze
    let period = quietPeriod(busy ? sw.busy : sw.idle, calm, busy) * lazy;
    if (j.fullness < 0.2) period *= 1.3;
    const prev = j.pulse;
    j.pulse = (j.pulse + dt / period) % 1;
    const squeezing = j.pulse < sw.squeeze;
    if (squeezing && dist > 15) {
      // a jelly can only push away from its bell: aim up and across, never down
      const up = ty < -10 ? ty : -Math.min(30, Math.max(10, dist * 0.2));
      const len = Math.hypot(tx * 0.9, up) || 1;
      const force = (busy ? sw.forceBusy : sw.forceIdle * quietScale(QUIET.force, calm)) * Math.sin((j.pulse / sw.squeeze) * Math.PI);
      if (ty < 40) {
        j.vx += ((tx * 0.9) / len) * force * dt;
        j.vy += (up / len) * force * dt;
      } else {
        j.vx += Math.sign(tx) * Math.min(1, Math.abs(tx) / 50) * force * 0.35 * dt;
      }
      j.thrust += Math.abs(force) * dt;
    }
    if (prev > j.pulse) {
      events.push({ type: "pulse", slot });
      if (sw.twitch) j.vx += (s.rand() - 0.5) * 2 * sw.twitch * quietScale(QUIET.twitch, calm);
    }
    // sink between pulses, water drag; v13: a frightened shy jelly folds up and drops faster toward its hiding place
    j.vy += (j.targetKind === "hide" && ty > 20 ? 25 + (gentleHide ? SHY_SINK / 4 : SHY_SINK) : 25) * dt;
    const drag = Math.exp(-1.6 * dt);
    j.vx *= drag;
    j.vy *= drag;
  }
  j.x += j.vx * dt;
  j.y += j.vy * dt;
  if (j.x < bounds.x0) j.vx += (bounds.x0 - j.x) * 4 * dt;
  if (j.x > bounds.x1) j.vx -= (j.x - bounds.x1) * 4 * dt;
  if (j.y < bounds.y0) j.vy += (bounds.y0 - j.y) * 4 * dt;
  if (j.x < hard.x0 || j.x > hard.x1) {
    j.x = clamp(j.x, hard.x0, hard.x1);
    j.vx = 0;
  }
  if (j.y < hard.y0) {
    j.y = hard.y0;
    j.vy = Math.max(0, j.vy);
  }
  const floor = Math.min(bounds.y1, sandAt(j.x) - g.rimAbove);
  if (j.y > floor) {
    j.y = floor;
    j.vy = Math.min(0, j.vy);
  }
  if (!sw.glide && j.g >= JUVENILE) {
    // v10: the ripple runs with the bell: TENT_WAVES_PER_PULSE waves down the tentacles per beat
    let period = quietPeriod(busy ? sw.busy : sw.idle, calm, busy) * lazy;
    if (j.fullness < 0.2) period *= 1.3;
    j.tent = (j.tent + (dt * TENT_WAVES_PER_PULSE) / period) % 1;
  } else {
    // tentacles sway faster when it swims
    j.tent = (j.tent + dt * (0.9 + Math.min(1.5, Math.hypot(j.vx, j.vy) / 40))) % 1;
  }
}

/**
 * The trail pose for an eased velocity (artboard px/s, y down), with hysteresis around `cur`:
 * rising or gliding fast pulls the tentacles into a streak (straight below when mostly rising,
 * swept to the side behind a mostly sideways glide); sinking (or, for gliders, nearly stopping)
 * fans them out; anything in between is the neutral sway. Never streams while heading down.
 */
export function nextTrail(cur: number, svx: number, svy: number, tp: TrailParams): number {
  const side = Math.abs(svx);
  const up = -svy;
  const speed = Math.hypot(svx, svy);
  const streaming = cur === TRAIL_STREAM || cur === TRAIL_L || cur === TRAIL_R;
  const ahead = up > 0 || svy < 0.5 * side; // rising, or gliding no steeper than ~27 degrees down
  if (speed > (streaming ? tp.streamOut : tp.streamIn) && ahead) {
    const swept = cur === TRAIL_L || cur === TRAIL_R;
    if (up <= 0 || side > (swept ? tp.sweptOut : tp.sweptIn) * up) {
      // a swept streak only flips sides once the glide has clearly turned
      if (swept && Math.sign(svx) !== (cur === TRAIL_L ? 1 : -1) && side < tp.streamIn) return cur;
      return svx > 0 ? TRAIL_L : TRAIL_R;
    }
    return TRAIL_STREAM;
  }
  const fanned = cur === TRAIL_FAN;
  if (svy > (fanned ? tp.fanOut : tp.fanIn)) return TRAIL_FAN;
  if (tp.restIn > 0 && speed < (fanned ? tp.restOut : tp.restIn)) return TRAIL_FAN;
  return TRAIL_NEUTRAL;
}

/** Ease the velocity the tentacles feel and move to the pose it asks for (holding each pose a moment). */
function stepTrail(s: State, j: Jelly, dt: number): void {
  if (j.mode !== "swim" || !trailsOf(j.k, j.g)) {
    j.trail = TRAIL_NEUTRAL;
    j.svx = 0;
    j.svy = 0;
    return;
  }
  const tp = trailOf(j.k, j.g);
  const a = 1 - Math.exp(-dt / tp.tau);
  j.svx += (j.vx - j.svx) * a;
  j.svy += (j.vy - j.svy) * a;
  if (s.t - j.trailAt < tp.hold) return;
  const next = nextTrail(j.trail, j.svx, j.svy, tp);
  if (next !== j.trail) {
    j.trail = next;
    j.trailAt = s.t;
  }
}

/** Quiet nights: where the swimmers loosely gather now (world), drifting slowly through the view's mid water. */
export function nightGather(s: State): { x: number; y: number } {
  const span = viewSpan(s);
  const x0 = Math.max(span.x0, K.glassL);
  const x1 = Math.min(span.x1, rightGlass(s));
  return gatherPoint(s.t, x0, x1, BOUNDS.y0, BOUNDS.y1);
}

// ---------------------------------------------------------------- v13: personalities and the bubbler

/** The quiet-night calm a jelly feels: the night's, and for a sleepy one at least SLEEPY_DUSK in the hour before it. */
function calmFor(s: State, j: Jelly): number {
  const calm = calmOf(s.night);
  if (j.trait !== SLEEPY) return calm;
  return Math.max(calm, drowsy(new Date(s.clock).getHours(), s.lamp !== null && !s.lamp.night));
}

/** The bubbler's column (world): its middle x, the crater it rises from and the surface; null when it isn't owned. */
export function bubbleColumn(s: State): { x: number; top: number; bottom: number } | null {
  if (!placed(s, BUBBLER)) return null;
  const d = DECOR[BUBBLER]!;
  return { x: s.decorX[BUBBLER] ?? d.x, top: K.waterTop, bottom: decorBaseY(s, BUBBLER) - d.h * 0.8 };
}

/** Where a curious jelly wants to be: the held item while it's in the water (world), or null. */
function heldInWater(s: State): { x: number; y: number } | null {
  const c = s.cursor;
  if (s.tool === "none" || !c.visible || shopBlocks(s) || c.y < K.waterTop || c.y > K.waterBot) return null;
  return { x: screenToWorld(s, c.x), y: c.y };
}

/** The middle of the other swimmers (a social jelly's day-time gathering point), or null if it swims alone. */
function groupPoint(s: State, me: Jelly): { x: number; y: number } | null {
  let n = 0;
  let x = 0;
  let y = 0;
  for (const o of jellies(s)) {
    if (o === me || o.mode !== "swim") continue;
    x += o.x;
    y += o.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/** v14: a gap this wide (artboard px) either side is room enough; past it, nearer the default spot wins. */
const ROOM_ENOUGH = 12;
/** something on the sand: base centre, width, from which tier; `cost` scales an overlap with it (the chest is the
 *  worst thing to land on, the season's little pumpkins the least) */
type SandRun = { x: number; w: number; tier?: number; cost?: number };

/**
 * v14: where decoration n goes when it arrives (v15: any decoration bought, a keepsake earned, or one taken out of
 * the drawer): its default spot if nothing's there, else the spot in this tank's width with the most room from the
 * placed decorations, the chest and the season's decor on the
 * sand (contract `chest`, seasons.*.sand), the nearest to the default among those with room enough. Where nothing
 * has room (a small tank fills up), an overlap costs more the bigger the thing: the chest most, pumpkins and the
 * rocks in front of the sand outside OPEN_SANDS least.
 */
export function clearSpotFor(s: State, n: number): number {
  const d = DECOR[n]!;
  const taken: SandRun[] = s.owned.flatMap((_, m) => (placed(s, m) && m !== n ? [{ x: s.decorX[m] ?? DECOR[m]!.x, w: DECOR[m]!.w }] : []));
  const k = K as unknown as { chest?: SandRun; seasons?: Record<string, { sand?: SandRun[] }> };
  if (k.chest) taken.push({ ...k.chest, cost: 4 });
  if (s.event) for (const r of k.seasons?.[s.event]?.sand ?? []) if ((r.tier ?? 0) <= s.tier) taken.push({ ...r, cost: 0.5 });
  // ...and the sand the rocks and kelp stand in front of (between the stretches of open sand): half hidden is a pity
  let edge = K.glassL;
  for (const o of OPEN_SANDS.filter((o) => o.tier <= s.tier).sort((a, b) => a.x0 - b.x0)) {
    if (o.x0 > edge) taken.push({ x: (edge + o.x0) / 2, w: o.x0 - edge, cost: 0.5 });
    edge = Math.max(edge, o.x1);
  }
  const right = rightGlass(s);
  if (right > edge) taken.push({ x: (edge + right) / 2, w: right - edge, cost: 0.5 });
  const room = (x: number) =>
    Math.min(
      ROOM_ENOUGH,
      ...taken.map((t) => {
        const gap = Math.max(t.x - t.w / 2 - (x + d.w / 2), x - d.w / 2 - (t.x + t.w / 2));
        return gap < 0 ? gap * (t.cost ?? 1) : gap;
      }),
    );
  let lo = decorClampX(n, -1e9, s.tier);
  let hi = decorClampX(n, 1e9, s.tier);
  if (n === BUBBLER) {
    // ...where every kind of jelly can swim into its column (the big ones keep further from the glass)
    for (let k = 0; k < SPECIES_N; k++) {
      const b = geomIn(s, k as Species, ADULT).bounds;
      lo = Math.max(lo, Math.ceil((b.x0 - COLUMN_HALF / 2) / P) * P);
      hi = Math.min(hi, Math.floor((b.x1 + COLUMN_HALF / 2) / P) * P);
    }
  }
  let best = clamp(decorClampX(n, d.x, s.tier), lo, hi);
  let bestRoom = room(best);
  for (let x = lo; x <= hi; x += P) {
    const r = room(x);
    if (r > bestRoom || (r === bestRoom && Math.abs(x - d.x) < Math.abs(best - d.x))) {
      best = x;
      bestRoom = r;
    }
  }
  return best;
}

/**
 * A shy jelly takes fright at (fx, fy): it heads for the nearest owned decoration or rock that isn't
 * where the fright came from, keeps low there for SHY_HIDE s and ignores food for the first SHY_FOOD_HOLD.
 */
function hide(s: State, j: Jelly, fx: number, fy: number): void {
  const b = geomIn(s, j.k, j.g).bounds;
  const spots: { x: number; y: number }[] = [];
  s.owned.forEach((_, n) => placed(s, n) && spots.push({ x: s.decorX[n] ?? DECOR[n]!.x, y: decorBaseY(s, n) }));
  POLYP_ANCHORS.forEach((a) => a.tier <= s.tier && spots.push(a));
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const p of spots) {
    if (p.x < b.x0 - 60 || p.x > b.x1 + 60) continue;
    // somewhere away from the fright, then the nearest
    const d = Math.hypot(p.x - j.x, p.y - j.y) + (Math.hypot(p.x - fx, p.y - fy) < SHY_RADIUS * 0.6 ? 2000 : 0);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  const x = best ? best.x : j.x + Math.sign(j.x - fx || 1) * SHY_RADIUS;
  j.target = { x: clamp(x, b.x0, b.x1), y: b.y1 - 10 };
  j.targetKind = "hide";
  j.targetUntil = s.t + SHY_HIDE;
  j.ride = 0;
}

/** Startle the shy swimmers near (x, y) (world) that don't trust you yet, except `spare`; returns them. */
function startle(s: State, x: number, y: number, spare: Jelly | null, again = true): Set<Jelly> {
  const out = new Set<Jelly>();
  for (const j of jellies(s)) {
    if (j === spare || j.mode !== "swim" || j.trait !== SHY || j.affection >= SHY_TRUST) continue;
    if (!again && j.targetKind === "hide") continue;
    const c = bodyCentre(j);
    if (Math.hypot(c.x - x, c.y - y) > SHY_RADIUS) continue;
    hide(s, j, x, y);
    out.add(j);
  }
  return out;
}

/** Where a jelly heading for the column aims: the column, about level with itself (a pulse jelly can't swim down). */
const rideApproach = (j: Jelly, col: { x: number; bottom: number }, b: Geom["bounds"]) => ({
  x: clamp(col.x, b.x0, b.x1),
  y: clamp(Math.min(j.y - 20, col.bottom - 80), b.y0 + 100, b.y1),
});

/** Head for the bubbler's column to ride it up (a wander pick that came up "ride"). */
function startRide(s: State, j: Jelly, col: { x: number; bottom: number }, b: Geom["bounds"]): void {
  j.target = rideApproach(j, col, b);
  j.targetKind = "ride";
  j.targetUntil = s.t + RIDE_GIVE_UP;
  j.ride = 1;
}

/**
 * A ride in progress: into the column, then straight up it; at the top it's done ("rode", `seen` when the
 * bubbler is on screen) and it drifts back down to one side. Returns false when the ride is off (no
 * bubbler any more, or too long without getting there): the caller picks a new wander target.
 */
function stepRide(s: State, slot: number, j: Jelly, b: Geom["bounds"], events: SimEvent[]): boolean {
  const col = bubbleColumn(s);
  if (!col || s.t > j.targetUntil) {
    j.ride = 0;
    return false;
  }
  const c = bodyCentre(j);
  if (j.ride === 1 && Math.abs(c.x - col.x) < COLUMN_HALF) j.ride = 2;
  if (j.ride !== 2) {
    j.target = rideApproach(j, col, b);
    return true;
  }
  if (j.y > b.y0 + RIDE_TOP) {
    j.target = { x: clamp(col.x, b.x0, b.x1), y: b.y0 };
    return true;
  }
  // over the top: drift back down beside the column, on the roomier side
  j.ride = 0;
  const v = viewSpan(s);
  events.push({ type: "rode", slot, x: col.x, y: c.y, seen: col.x >= v.x0 && col.x <= v.x1 });
  const side = col.x - b.x0 > b.x1 - col.x ? -1 : 1;
  j.vx += side * RIDE_KICK; // it lets go and tips out of the column
  j.vy = Math.max(0, j.vy);
  j.target = { x: clamp(col.x + side * RIDE_AWAY, b.x0, b.x1), y: b.y0 + (b.y1 - b.y0) * 0.55 };
  j.targetKind = "wander";
  j.targetUntil = s.t + 6;
  return true;
}

/** The bubbler's current lifts the swimmers in its column (riders much harder); gliders feel a share of it. */
function stepCurrent(s: State, dt: number): void {
  const col = bubbleColumn(s);
  if (!col) return;
  for (const j of jellies(s)) {
    if (j.mode !== "swim") continue;
    const c = bodyCentre(j);
    const w = currentAt(c.x - col.x, c.y, col.top + CURRENT_TOP_GAP, col.bottom);
    const riding = j.ride === 2 && Math.abs(c.x - col.x) < CURRENT_HALF;
    if (w <= 0 && !riding) continue;
    const share = swimOf(j.k, j.g).glide ? GLIDE_SHARE : 1;
    j.vy -= (riding ? RIDE_PUSH * Math.max(w, 0.5) : CURRENT_PUSH * w) * share * dt;
    // a rider is kept in the middle of the column
    if (riding) j.vx += (col.x - c.x) * 2 * dt;
  }
}

function chooseTargets(s: State, events: SimEvent[]): void {
  const claimed = new Set<Food>();
  const held = heldInWater(s);
  s.slots.forEach((j, slot) => {
    if (!j || j.mode !== "swim") return;
    const g = geomIn(s, j.k, j.g);
    const reach = Math.max(g.body.reach, 26);
    let best: Food | null = null;
    let bestD = Infinity;
    let bestFree: Food | null = null;
    let bestFreeD = Infinity;
    const fav = favouriteFood(j.k);
    // v13: just after a fright a shy jelly stays hidden, food or not; later it lets sinking food settle a moment first
    const fresh = j.targetKind === "hide" && s.t < j.targetUntil - SHY_HIDE + SHY_FOOD_HOLD;
    const shy = j.trait === SHY;
    for (const f of fresh ? [] : s.food) {
      if (f.state !== "sink" && f.state !== "rest") continue;
      if (shy && f.state === "sink" && f.age < SHY_FOOD_DELAY) continue;
      // v11: a favourite pellet counts as much nearer, so with several foods in the water it's chased first
      const d = Math.hypot(f.x + FOOD_MID - j.x, f.y + FOOD_MID - (j.y + reach * 0.42)) * (f.kind === fav ? FAV_CHASE : 1);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
      if (!claimed.has(f) && d < bestFreeD) {
        bestFreeD = d;
        bestFree = f;
      }
    }
    const f = bestFree ?? best;
    if (f) {
      claimed.add(f);
      // park the rim above the pellet so it drifts into the tentacles
      j.target = { x: clamp(f.x + FOOD_MID, g.bounds.x0, g.bounds.x1), y: clamp(f.y - reach * 0.37, g.bounds.y0, g.bounds.y1) };
      j.targetKind = "food";
      j.ride = 0;
      return;
    }
    const b = g.bounds;
    let free = j.targetKind === "food" || !j.target || s.t > j.targetUntil;
    if (!free && j.targetKind === "ride") free = !stepRide(s, slot, j, b, events);
    else if (!free && j.targetKind === "visit") {
      // v13: a curious jelly hovers near the visitor (a little way off, on its own side)
      if (!s.visit) free = true;
      else {
        const v = visitorCentre(s.visit);
        const away = Math.sign(j.x - v.x) || 1;
        j.target = { x: clamp(v.x + away * 80, b.x0, b.x1), y: clamp(v.y + 30, b.y0, b.y1) };
      }
    }
    if (free) {
      const sw = swimOf(j.k, j.g);
      const col = bubbleColumn(s);
      // v13: now and then a wander becomes a ride up the bubbler (curious and social jellies most often)
      if (col && j.g >= EPHYRA && s.rand() < (RIDE_CHANCE[j.trait] ?? 0)) {
        startRide(s, j, col, b);
        return;
      }
      const low = BOTTOM_DWELLERS.includes(j.k) && j.g >= JUVENILE; // flower hats hop about near the sand
      const sleepy = j.trait === SLEEPY && !low; // v13: sleepy jellies keep to the lower water
      const yTop = low ? b.y0 + (b.y1 - b.y0) * 0.6 : sleepy ? b.y0 + (b.y1 - b.y0) * 0.4 : b.y0 + 50;
      const ySpan = low ? (b.y1 - b.y0) * 0.4 : sleepy ? Math.max(0, (b.y1 - b.y0) * 0.6 - 40) : Math.max(0, b.y1 - b.y0 - 150);
      j.target = {
        x: b.x0 + 40 + s.rand() * Math.max(0, b.x1 - b.x0 - 80),
        y: yTop + s.rand() * ySpan,
      };
      j.targetKind = "wander";
      j.targetUntil = s.t + sw.wanderMin + s.rand() * sw.wanderSpread;
      j.ride = 0;
      // quiet nights: wander less often, and loosely gather round the shared point (bottom dwellers only in x)
      const calm = calmFor(s, j);
      if (calm > 0) j.targetUntil = s.t + (j.targetUntil - s.t) * quietScale(QUIET.hold, calm);
      // v13: a social jelly gathers with the others by day too (round the group), and keeps closest at night
      const social = j.trait === SOCIAL;
      const point = calm > 0 ? nightGather(s) : social ? groupPoint(s, j) : null;
      if (point) {
        const gt = gatherTarget(j.target, point, slot, social ? Math.max(calm, SOCIAL_PULL) : calm, (slot * 0.618034 + 0.3) % 1);
        j.target = { x: clamp(gt.x, b.x0, b.x1), y: low ? j.target.y : clamp(gt.y, b.y0, b.y1) };
      }
    }
    // v13: a curious jelly comes over to look at whatever you're holding in the water (beside it, a little below)
    if (held && j.trait === CURIOUS && j.targetKind === "wander") {
      const side = Math.sign(j.x - held.x) || 1;
      j.target = { x: clamp(held.x + side * CURIOUS_SIDE, b.x0, b.x1), y: clamp(held.y + CURIOUS_BELOW, b.y0, b.y1) };
      j.targetUntil = Math.min(j.targetUntil, s.t + 1.5);
    }
  });
}

/** Jellies nudge each other apart; polyps and settled ones are rocks to the swimmers. */
function repel(s: State, dt: number): void {
  const js = jellies(s);
  for (let a = 0; a < js.length; a++) {
    for (let b = a + 1; b < js.length; b++) {
      const ja = js[a]!;
      const jb = js[b]!;
      const ma = ja.mode === "swim";
      const mb = jb.mode === "swim";
      if (!ma && !mb) continue;
      const ga = geomOf(ja.k, ja.g).body;
      const gb = geomOf(jb.k, jb.g).body;
      const ca = bodyCentre(ja);
      const cb = bodyCentre(jb);
      const ra = Math.max(ga.halfW, ga.top / 2) * 0.85;
      const rb = Math.max(gb.halfW, gb.top / 2) * 0.85;
      let dx = ca.x - cb.x;
      let dy = ca.y - cb.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-3) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      const overlap = ra + rb - d;
      if (overlap <= 0) continue;
      const push = 6 * overlap * dt;
      const share = ma && mb ? 0.5 : 1;
      if (ma) {
        ja.vx += (dx / d) * push * share;
        ja.vy += (dy / d) * push * share;
      }
      if (mb) {
        jb.vx -= (dx / d) * push * share;
        jb.vy -= (dy / d) * push * share;
      }
    }
  }
}

export function step(s: State, dt: number): SimEvent[] {
  const events: SimEvent[] = s.queued.splice(0);
  s.t += dt;
  s.clock += dt * 1000;
  const mult = s.growthMultiplier;

  stepView(s, dt, events);
  if (s.focus.on && !s.slots[s.focus.slot]) s.focus.on = false;
  s.focus.e = s.reducedMotion ? (s.focus.on ? 1 : 0) : clamp(s.focus.e + (s.focus.on ? dt : -dt) / FOCUS_TIME);

  // the glass gets dirty: spots grow, and a new one appears every 90-150 s while there's room
  stepDirt(s, dt);
  for (const j of jellies(s)) {
    j.fullness = clamp(j.fullness - dt / RATES.hungerActive);
    j.affection = clamp(j.affection - dt / RATES.affectionDecay);
  }

  // day and night: the clock, unless the lamp's override still holds
  if (s.lamp && s.clock >= s.lamp.until) s.lamp = null;
  s.nightTarget = s.lamp ? s.lamp.night : isNightByClock(s.clock);
  const nt = s.nightTarget ? 1 : 0;
  s.night += clamp(nt - s.night, -dt / 1.2, dt / 1.2);

  // cleaning sweep (clean(): demo and tests)
  if (s.wipe) {
    const p = (s.t - s.wipe.t0) / WIPE_TIME;
    const w = s.wipe;
    s.spots.forEach((sp, i) => {
      if (sp && w.dirt0[i] !== undefined && w.dirt0[i]! > 0) sp.dirt = w.dirt0[i]! * (1 - clamp(p));
    });
    if (p >= 1) {
      for (let i = 0; i < s.spots.length; i++) spotGone(s, i, false);
    }
    syncMurk(s);
    if (p >= 1) {
      const dirty = s.wipe.murk0 > 0.3;
      s.wipe = null;
      events.push({ type: "cleaned" });
      if (dirty) earn(s, EARN.clean, events);
    }
  }

  // v13: a held item swept fast through the water startles the shy jellies near it
  if (dt > 0) s.cursorSpeed += (s.cursorTravel / dt - s.cursorSpeed) * (1 - Math.exp(-dt / 0.08));
  s.cursorTravel = 0;
  const held = heldInWater(s);
  if (held && s.cursorSpeed > SHY_FAST) startle(s, held.x, held.y, null, false);

  // food
  const col = bubbleColumn(s);
  for (const f of s.food) {
    if (f.state === "off") continue;
    f.age += dt;
    if (f.state === "sink") {
      f.y += f.vy * dt;
      // v13: sprinkled into the bubbler's column, it's carried up a little before it sinks
      if (col) f.y = Math.max(K.waterTop + 3, f.y - foodLift(currentAt(f.x + FOOD_MID - col.x, f.y, col.top, col.bottom, COLUMN_HALF), f.age) * dt);
      f.x = clamp(f.x + Math.sin(f.age * 2.2 + f.seed) * 15 * dt, K.glassL + P, rightGlass(s) - 4 * P);
      // rest with the pellet's bottom row pressed into the top row of sand
      const floor = sandAt(f.x + FOOD_MID) - 2 * P;
      if (f.y >= floor) {
        f.y = floor;
        f.state = "rest";
        f.age = 0;
      }
    } else if (f.state === "rest" && f.age > 30 && !s.helpers[SHRIMP]) {
      // left on the sand it spoils into grime low on the glass; with the shrimp around it waits to be eaten instead
      f.state = "off";
      rotInto(s.spots, f.x + FOOD_MID, s.dirtRand, rightGlass(s));
      s.nextSpot -= ROT_HURRY;
      syncMurk(s);
    } else if (f.state === "eaten" && f.age > 0.3) {
      f.state = "off";
    }
    if (f.state !== "sink" && f.state !== "rest") continue;
    // polyps (and settled upside-downs) draw nearby food in on a gentle current
    for (const j of jellies(s)) {
      const lp = lurePoint(j);
      if (!lp) continue;
      const dx = lp.x - (f.x + FOOD_MID);
      const dy = lp.y - (f.y + FOOD_MID);
      const d = Math.hypot(dx, dy);
      if (d < LURE_RADIUS && d > 1) {
        const v = (12 + 28 * (1 - d / LURE_RADIUS)) * dt;
        f.x += (dx / d) * v;
        f.y = Math.min(f.y + (dy / d) * v, sandAt(f.x + FOOD_MID) - 2 * P);
      }
    }
    const fx = f.x + FOOD_MID;
    const fy = f.y + FOOD_MID;
    for (let i = 0; i < s.slots.length; i++) {
      const j = s.slots[i];
      if (!j || !catches(j, fx, fy)) continue;
      f.state = "eaten";
      f.age = 0;
      f.ex = f.x;
      f.ey = f.y;
      f.by = i;
      // v11: its favourite food grows it twice as fast, fills a little more and pleases it like a pet
      const fav = favouriteFood(j.k) === f.kind;
      const meal = fav ? FAV_MEAL : MEAL;
      j.fullness = clamp(j.fullness + meal.full);
      j.affection = clamp(j.affection + meal.love);
      j.wiggleT0 = s.t;
      if (fav) j.loveT0 = s.t;
      j.gp += meal.gp * mult;
      events.push(fav ? { type: "ate", slot: i, food: f.kind, fav: true } : { type: "ate", slot: i, food: f.kind });
      earn(s, EARN.meal, events, i);
      break;
    }
  }

  // move
  chooseTargets(s, events);
  s.slots.forEach((j, i) => {
    if (!j) return;
    if (j.mode === "swim") {
      swim(s, i, j, dt, events);
    } else if (j.mode === "fixed") {
      j.pulse = (j.pulse + dt / POLYP_SWAY) % 1;
      j.tent = (j.tent + dt * 0.45) % 1;
    } else {
      j.pulse = (j.pulse + dt / quietPeriod(SETTLED_PULSE, calmOf(s.night), false)) % 1; // slower on quiet nights
      j.tent = (j.tent + dt * 0.5) % 1;
      if (j.mode === "settling") {
        // drift down onto the home spot, then stay put
        const p = SETTLE_SPOTS[j.spot]!;
        const dx = p.x - j.x;
        const dy = p.y - j.y;
        const d = Math.hypot(dx, dy);
        const v = Math.min(45, d * 0.9 + 6) * dt;
        if (d <= v) {
          j.x = p.x;
          j.y = p.y;
          j.mode = "settled";
        } else {
          j.x += (dx / d) * v;
          j.y += (dy / d) * v;
        }
        j.vx = 0;
        j.vy = 0;
      }
    }
  });
  stepCurrent(s, dt);
  repel(s, dt);
  for (const j of s.slots) {
    if (!j) continue;
    stepTrail(s, j, dt);
    // v10: lean into turns; polyps and settling/settled jellies stand upright
    stepTilt(j.tilt, j.vx, j.vy, dt, j.mode !== "swim" || j.g === POLYP);
  }
  stepHelpers(s, dt, events);

  // growth: good care pays a point a minute; stage-ups happen here
  s.slots.forEach((j, i) => {
    if (!j) return;
    if (j.fullness > GOOD_FULLNESS && s.murk < GOOD_MURK) {
      j.care += dt * mult;
      while (j.care >= CARE_SECONDS) {
        j.care -= CARE_SECONDS;
        j.gp += 1;
      }
    }
    while (j.g < ADULT && j.gp >= GROWTH[(j.g + 1) as Stage]) stageUp(s, i, j, events);
  });

  babies(s, dt, events);
  stepVisitors(s, dt, events);
  syncMurk(s);

  // daily pearl: announce it once when it appears (also right after loading on a new day)
  const pearl = pearlShowing(s);
  if (pearl && !s.pearlWas) events.push({ type: "pearlReady" });
  s.pearlWas = pearl;
  // v12: today's requests (planned on the first step of a day) count what just happened
  stepRequests(s, events);
  stepKeepsakes(s, events);

  return events;
}

/** The wall slides, the camera moves (fling, ease, edge scroll under a dragged decoration), the hints fade. */
function stepView(s: State, dt: number, events: SimEvent[]): void {
  if (s.wall && s.t >= s.wall.t0 + WALL_TIME) {
    // the wall is out: a sparkle in the middle of the new space
    const x = snap((s.wall.from + s.wall.to) / 2);
    s.wall = null;
    s.fx = { x, y: REVEAL_FX_Y, t0: s.t };
    events.push({ type: "revealed", tier: s.tier, x, y: REVEAL_FX_Y });
  }
  const lo = camMin(s);
  if (s.lifted >= 0 && s.dragX !== null) {
    // carrying a decoration to the edge of the water scrolls the tank under it
    const l = K.glassL + EDGE_ZONE;
    const r = K.glassR - EDGE_ZONE;
    const push = s.dragX < l ? (l - s.dragX) / EDGE_ZONE : s.dragX > r ? -(s.dragX - r) / EDGE_ZONE : 0;
    if (push !== 0) {
      s.cam.ease = null;
      s.cam.v = 0;
      s.cam.x = clamp(s.cam.x + clamp(push, -1, 1) * EDGE_SCROLL * dt, lo, 0);
      moveDecor(s, s.lifted, screenToWorld(s, s.dragX));
    }
  }
  if (s.reducedMotion) {
    // no glide, no ease: a move lands where it was going (an upgrade's, once its wall starts out)
    s.cam.v = 0;
    if (s.cam.ease && s.t >= s.cam.ease.t0) {
      s.cam.x = s.cam.ease.to;
      s.cam.ease = null;
    }
  }
  stepCam(s.cam, s.t, dt, lo);
  // v15: the put-away drawer slides up while a decoration is carried (no slide with reduce motion)
  const want = s.lifted >= 0 ? 1 : 0;
  s.drawer.e = s.reducedMotion ? want : clamp(s.drawer.e + Math.sign(want - s.drawer.e) * (dt / DRAWER_TIME), Math.min(want, s.drawer.e), Math.max(want, s.drawer.e));
  const k = dt / HINT_TIME;
  s.hints.l += clamp(hintTarget(s, -1) - s.hints.l, -k, k);
  s.hints.r += clamp(hintTarget(s, 1) - s.hints.r, -k, k);
}

/** Spots grow and new ones appear (not during the old sweep, which fades them all). */
function stepDirt(s: State, dt: number): void {
  if (s.wipe) return;
  growSpots(s.spots, dt);
  if (s.spots.every((sp) => sp)) {
    s.nextSpot = Math.max(s.nextSpot, s.t + SPOT_GAP_MIN);
  } else if (s.t >= s.nextSpot) {
    addSpot(s.spots, s.dirtRand, rightGlass(s));
    s.nextSpot = s.t + SPOT_GAP_MIN + s.dirtRand() * SPOT_GAP_SPREAD;
  }
  syncMurk(s);
}

/**
 * The spot the snail is after: while the water is dirtier than lightly cloudy it keeps to the spot it
 * picked until that's clean, then takes the dirtiest (nearer first when about as dirty); below that it
 * wanders. -1 = none.
 */
function snailGoal(s: State): number {
  if (s.murk <= SNAIL_FLOOR) {
    s.snailSpot = -1;
    return -1;
  }
  if (!s.spots[s.snailSpot]) {
    // the dirtiest, but a nearer one wins when it's nearly as dirty: it's a slow crawl across a big tank
    let best = -1;
    let bestScore = 0;
    s.spots.forEach((sp, i) => {
      if (!sp) return;
      const score = sp.dirt * (1 - Math.min(0.5, Math.hypot(sp.x - s.snail.x, sp.y - s.snail.y) / 2000));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    s.snailSpot = best;
  }
  return s.snailSpot;
}

/** Where the helpers live now: inside the (sliding) right glass, on the tier's open sand. */
const helpersWorld = (s: State): HelperWorld => helperWorld(rightGlass(s), openSandsOf(s.tier));

function stepHelpers(s: State, dt: number, events: SimEvent[]): void {
  const world = helpersWorld(s);
  if (s.helpers[SNAIL]) {
    const k = snailGoal(s);
    const sp = s.spots[k] ?? null;
    if (stepSnail(s.snail, s.t, dt, s.rand, sp, world) && sp) {
      // it grazes the spot it sits on, never past lightly cloudy
      sp.dirt -= Math.min(sp.dirt, SNAIL_SCRUB * dt, Math.max(0, (murkOf(s.spots) - SNAIL_FLOOR) * 6));
      if (sp.dirt <= 1e-9) spotGone(s, k, false);
      syncMurk(s);
    }
  }
  if (s.helpers[SHRIMP]) {
    const resting: RestingFood = s.food.map((f) => (f.state === "rest" ? f.x + FOOD_MID : null));
    const ate = stepShrimp(s.shrimp, s.t, dt, s.rand, resting, world);
    const f = s.food[ate];
    if (f) {
      f.state = "off";
      f.by = -1;
      events.push({ type: "shrimpAte" });
    }
  }
  if (s.helpers[CRAB] && stepCrab(s.crab, s.t, dt, s.rand, world)) {
    s.fx = { x: s.crab.x, y: s.crab.y - CRAB_SIZE.h / 2, t0: s.t };
    events.push({ type: "dug", amount: DIG_REWARD });
    earn(s, DIG_REWARD, events);
  }
}

/**
 * Adults whose mood stays above 0.7 build content time; every 10 (growth-scaled)
 * minutes of it they release a polyp of their own species. With no free slot or
 * rock (or the tank at its tier's max) the timer holds at 10 minutes until there's room.
 */
function babies(s: State, dt: number, events: SimEvent[]): void {
  s.slots.forEach((j, parent) => {
    if (!j || j.g !== ADULT || moodOf(s, j) <= BABY_MOOD) return;
    j.content = Math.min(BABY_SECONDS, j.content + dt * s.growthMultiplier);
    if (j.content < BABY_SECONDS) return;
    const born = addPolyp(s, j.k, j);
    if (!born) return; // full: hold at the threshold
    j.content = 0;
    j.wiggleT0 = s.t;
    events.push({ type: "baby", slot: born.slot, parent });
  });
}

// ---------------------------------------------------------------- view

export type View = Record<string, number>;

/** Body frame for a pulse phase: the eased 8-frame curve where the stage draws 8, else the v2 four. */
/** Reduce motion's 8-frame beat: swell -> rest, peak -> the deeper squeeze before it, overshoot -> settle. */
const GENTLE_FRAME: readonly number[] = [0, 0, 2, 3, 3, 5, 7, 7];

function bellFrame(j: Jelly, pulse: number, squeeze = 0.3): number {
  return bodyFramesOf(j.k, j.g) === 8 ? pulseFrame(pulse, squeeze) : pulseFrame4(pulse, squeeze);
}

const WIGGLE_TIME = 0.6;
/** v10: body and tentacle frame props per slot (bf0..7, tf0..7); stages with 4 frames use the first four. */
const FRAME_N = 8;
const FLUSH_TIME = 1.0;
/** v11: the flush after a favourite meal */
const LOVE_FLUSH_TIME = 1.8;
const RIPPLE_TIME = 0.6;
const FX_TIME = 0.7;

const smooth = smoothstep;
/** The large card's "NEEDS MEDIUM" note: written only when the contract lists it. */
const NEEDS12 = K.props.includes("needs12");
const NEEDS15 = K.props.includes("needs15");
const NEEDS17 = K.props.includes("needs17");

function writeSlot(v: View, s: State, slot: number, j: Jelly | null, night: number): void {
  const p = `j${slot}`;
  if (!j) {
    for (const name of ["on", "x", "y", "healthy", "pale", "flush", "glow", "morph", "rot", "ghost", "nglow"]) v[p + name] = 0;
    for (let i = 0; i < SPECIES_N; i++) v[`${p}k${i}`] = 0;
    for (let i = 0; i < 4; i++) v[`${p}g${i}`] = 0;
    for (const g of ["bf", "tf"]) for (let i = 0; i < FRAME_N; i++) v[`${p}${g}${i}`] = 0;
    for (let i = 0; i < TRAIL_N; i++) v[`${p}tr${i}`] = 0;
    return;
  }
  const m = moodOf(s, j);
  // happy wiggle: three quick squeezes and a one-pixel shimmy, no thrust
  const wp = (s.t - j.wiggleT0) / WIGGLE_TIME;
  const wiggling = wp >= 0 && wp < 1;
  const shimmy = wiggling && !s.reducedMotion ? (Math.floor(wp * 8) % 2 ? P : -P) : 0;
  v[p + "on"] = 1;
  v[p + "x"] = snap(j.x) + shimmy;
  v[p + "y"] = snap(j.y);
  let bf: number;
  if (wiggling && !s.reducedMotion) bf = bellFrame(j, (wp * 3) % 1);
  else if (j.mode === "fixed") bf = Math.floor(j.pulse * 4) % 4;
  else if (j.mode !== "swim") bf = bellFrame(j, j.pulse);
  else {
    const sw = swimOf(j.k, j.g);
    bf = sw.glide ? Math.floor(j.pulse * 4) % 4 : bellFrame(j, j.pulse, sw.squeeze);
  }
  // reduce motion: a gentler beat, without the swell, the peak squeeze or the overshoot
  if (s.reducedMotion && bodyFramesOf(j.k, j.g) === 8) bf = GENTLE_FRAME[bf] ?? bf;
  // juveniles and adults ripple through 8 sway frames off their own clock (wiggling too, so it never jumps)
  const nt = tentFramesOf(j.g);
  const tf = wiggling && nt === 4 ? Math.floor(wp * 8) % 4 : tentFrame(j.tent, nt);
  for (let i = 0; i < SPECIES_N; i++) v[`${p}k${i}`] = i === j.k ? 1 : 0;
  for (let i = 0; i < 4; i++) v[`${p}g${i}`] = i === j.g ? 1 : 0;
  for (let i = 0; i < FRAME_N; i++) {
    v[`${p}bf${i}`] = i === bf ? 1 : 0;
    v[`${p}tf${i}`] = i === tf ? 1 : 0;
  }
  v[p + "rot"] = Math.round(j.tilt.out * 1e4) / 1e4;
  for (let i = 0; i < TRAIL_N; i++) v[`${p}tr${i}`] = i === j.trail ? 1 : 0;
  // palettes: pale overrides the morph colours; flush is drawn over whichever shows. v12: one switch per morph id
  const pale = m < 0.35 ? 1 : 0;
  const morph = j.morph === MORPH_CLASSIC && !pale ? 1 : 0;
  const ghost = j.morph === MORPH_GHOST && !pale ? 1 : 0;
  v[p + "pale"] = pale;
  v[p + "morph"] = morph;
  v[p + "ghost"] = ghost;
  v[p + "healthy"] = pale || morph || ghost ? 0 : 1;
  // rosy flush over whichever body is showing, fading out in steps; a favourite meal holds it longer (v11)
  const fp = (s.t - j.wiggleT0) / FLUSH_TIME;
  const lp = (s.t - j.loveT0) / LOVE_FLUSH_TIME;
  const step3 = (q: number) => (q < 0 || q >= 1 ? 0 : q < 0.5 ? 1 : q < 0.75 ? 0.6 : 0.3);
  v[p + "flush"] = Math.max(step3(fp), step3(lp));
  const glowDay = 0.25 + 0.2 * m;
  const glowNight = 0.6 + 0.4 * m;
  v[p + "glow"] = glowDay + (glowNight - glowDay) * night;
  // quiet nights: the bell's own soft light, swelling with each squeeze
  const sq = j.mode === "swim" ? (swimOf(j.k, j.g) as { squeeze?: number }).squeeze ?? 0.5 : 0.4;
  v[p + "nglow"] = nightGlow(night, j.k, j.pulse, sq);
}

export function view(s: State): View {
  const v: View = {};
  // the night overlay carries its own alpha: write the eased fade straight
  const night = smooth(clamp(s.night));
  v.nightShade = night;
  v.daylight = 1 - night;
  v.sunO = s.nightTarget ? 0 : 1;
  v.moonO = s.nightTarget ? 1 : 0;

  // the water clouds a little with the murk; the grime itself is the spots on the glass
  v.murkShade = clamp(s.murk) * 0.6;
  for (let i = 0; i < SPOT_N; i++) {
    const sp = s.spots[i];
    v[`spot${i}x`] = sp ? snap(sp.x) : 0;
    v[`spot${i}y`] = sp ? snap(sp.y) : 0;
    v[`spot${i}o`] = sp ? Math.round(spotOpacity(sp.dirt) * 100) / 100 : 0;
    const kind = sp ? sp.v : 0;
    for (let k = 0; k < SPOT_KINDS; k++) v[`spot${i}v${k}`] = k === kind ? 1 : 0;
  }

  for (let i = 0; i < MAX_SLOTS; i++) writeSlot(v, s, i, s.slots[i] ?? null, night);

  s.food.forEach((f, i) => {
    let x = f.x;
    let y = f.y;
    let o = f.state === "sink" || f.state === "rest" ? 1 : 0;
    if (f.state === "eaten") {
      // drawn up the arms into the body
      const j = s.slots[f.by];
      const c = j ? bodyCentre(j) : { x: f.ex + FOOD_MID, y: f.ey + FOOD_MID };
      const p = clamp(f.age / 0.3);
      x = f.ex + (c.x - FOOD_MID - f.ex) * p;
      y = f.ey + (c.y - f.ey) * p;
      o = p < 0.5 ? 1 : 0.5;
    }
    v[`food${i}x`] = snap(x);
    v[`food${i}y`] = snap(y);
    v[`food${i}o`] = o;
    for (let k = 0; k < FOOD_KINDS; k++) v[`food${i}k${k}`] = k === f.kind ? 1 : 0;
  });

  // ripple: a ring that widens and fades
  const rp = s.ripple ? (s.t - s.ripple.t0) / RIPPLE_TIME : 1;
  if (s.ripple && rp < 1) {
    const e = 1 - (1 - rp) * (1 - rp);
    v.rx = snap(s.ripple.x);
    v.ry = snap(s.ripple.y);
    v.rs = 0.3 + 1.1 * e;
    v.ro = 0.8 * (1 - rp);
  } else {
    v.rx = s.ripple ? snap(s.ripple.x) : 0;
    v.ry = s.ripple ? snap(s.ripple.y) : 0;
    v.rs = 1;
    v.ro = 0;
  }

  // sparkle burst: pops, grows and fades
  const xp = s.fx ? (s.t - s.fx.t0) / FX_TIME : 1;
  v.fxX = s.fx ? snap(s.fx.x) : 0;
  v.fxY = s.fx ? snap(s.fx.y) : 0;
  if (s.fx && xp >= 0 && xp < 1) {
    const e = 1 - (1 - xp) ** 2;
    v.fxS = 0.4 + 1.2 * e;
    v.fxO = xp < 0.3 ? 1 : 1 - (xp - 0.3) / 0.7;
  } else {
    v.fxS = 1;
    v.fxO = 0;
  }

  // v8: the held item follows the pointer (screen space): the can tips while pouring, the sponge squishes.
  // v11: so do the brine shrimp jar and the plankton bottle
  const c = s.cursor;
  const sponge = s.tool === "sponge" && c.visible;
  const pours = c.down || s.t - s.pour.last < POUR_SHOW;
  for (const [name, tool] of [["can", "food"], ["jar", "shrimp"], ["bottle", "plankton"]] as const) {
    const shown = s.tool === tool && c.visible;
    v[`${name}X`] = snap(c.x);
    v[`${name}Y`] = snap(c.y);
    v[`${name}O`] = shown ? 1 : 0;
    v[`${name}F0`] = shown && pours ? 0 : 1;
    v[`${name}F1`] = shown && pours ? 1 : 0;
  }
  v.spongeX = snap(c.x);
  v.spongeY = snap(c.y);
  v.spongeO = sponge ? 1 : 0;
  v.spongeF0 = sponge && c.down ? 0 : 1;
  v.spongeF1 = sponge && c.down ? 1 : 0;
  v.toolFood = s.tool === "food" ? 1 : 0;
  v.toolSponge = s.tool === "sponge" ? 1 : 0;
  v.toolShrimp = s.tool === "shrimp" ? 1 : 0;
  v.toolPlankton = s.tool === "plankton" ? 1 : 0;
  // v11: bought foods stand on the shelf (their hit boxes are moved away until then)
  v.haveShrimp = s.foods[1] ? 1 : 0;
  v.havePlankton = s.foods[2] ? 1 : 0;
  for (let t = 0; t < THEME_N; t++) v[`theme${t}`] = t === s.theme ? 1 : 0;
  // seasonal events: each season's decor shows on its own prop (evHalloween)
  for (const season of SEASONS) v[season.prop] = s.event === season.id ? 1 : 0;

  const js = jellies(s);
  const full = K.barW * P;
  const hungriest = js.length ? Math.min(...js.map((j) => j.fullness)) : 0;
  v.barFood = snap(hungriest * full);
  v.barWater = snap((1 - s.murk) * full);
  v.barMood = snap(mood(s) * full);
  // a held tool keeps its shelf item pressed (b4y the jar, b5y the bottle: v11)
  const held = [s.tool === "food", s.tool === "sponge", false, false, s.tool === "shrimp", s.tool === "plankton"];
  for (let i = 0; i < 6; i++) v[`b${i}y`] = held[i] || s.t < (s.pressUntil[i] ?? 0) ? P : 0;

  // sand dollar counter: ones in position 0, no leading zeros, a lone 0 when broke
  const digits = String(clamp(Math.floor(s.dollars), 0, MAX_DOLLARS));
  for (let pos = 0; pos < 4; pos++) {
    const ch = digits[digits.length - 1 - pos];
    const d = ch === undefined ? -1 : Number(ch);
    for (let n = 0; n < 10; n++) v[`cd${pos}n${n}`] = n === d ? 1 : 0;
  }

  // shop
  v.shopY = snap(shopY(s));
  if (K.props.includes("shopScroll")) {
    // one scroll offset and thumb position for whichever tab is open (v13: each scrolling tab has its own thumb)
    const w = tabScroll(s) ?? SHOP_SCROLL;
    v.shopScroll = -snap(s.shopScroll);
    const frac = w.max > 0 ? s.shopScroll / w.max : 0;
    v.shopScrollBar = snap(w.trackTop + (w.trackH - w.thumbH) * frac);
  }
  const tankFull = !roomForPolyp(s);
  SHOP_ITEMS.forEach((item, i) => {
    // v13: a keepsake's card is locked until its milestone is reached, whatever the dollars
    const keep = keepsakeOf(item) >= 0;
    if (item.kind === "theme") {
      // v11: owned themes stay bright (tap to use one again): "IN USE" on the active one, "OWNED" on the rest
      const has = s.themes[item.theme] === true;
      const using = s.theme === item.theme;
      v[`own${i}`] = has && !using ? 1 : 0;
      v[`use${i}`] = using ? 1 : 0;
      v[`lock${i}`] = !has && (keep || s.dollars < item.price) ? 1 : 0;
      return;
    }
    if (item.kind === "decor") {
      // v15: an owned decoration's card stays bright (tap it to put it away or place it again): "IN TANK" or
      // "STORED". An earned keepsake too (no "can't afford" wash): it was never for sale
      const has = s.owned[item.d] === true;
      v[`own${i}`] = has && !s.stored[item.d] ? 1 : 0;
      v[`away${i}`] = has && s.stored[item.d] ? 1 : 0;
      v[`lock${i}`] = has ? 0 : keep || s.dollars < item.price ? 1 : 0;
      return;
    }
    const owned =
      item.kind === "helper"
        ? s.helpers[item.h] === true
        : item.kind === "tank"
          ? s.tier >= item.tier
          : item.kind === "food"
            ? s.foods[item.f] === true
            : false;
    const tooSmall = item.kind === "polyp" && item.needTier !== undefined && s.tier < item.needTier;
    const blocked = (item.kind === "polyp" && (tankFull || tooSmall)) || (item.kind === "tank" && s.tier < item.tier - 1);
    v[`own${i}`] = owned ? 1 : 0;
    v[`lock${i}`] = owned || blocked || s.dollars < item.price ? 1 : 0;
  });
  if (NEEDS12) v.needs12 = s.tier < 1 ? 1 : 0;
  if (NEEDS15) v.needs15 = s.tier < 1 ? 1 : 0;
  if (NEEDS17) v.needs17 = s.tier < 2 ? 1 : 0;
  for (let t = 0; t < TAB_N; t++) {
    v[`shopTab${t}`] = t === s.tab ? 1 : 0;
    v[`tab${t}Y`] = t === s.tab ? 0 : TAB_HIDDEN_Y;
  }

  // decorations: shown when placed (v15: not put away), where they've been arranged; one carried over the
  // drawer shows faint, and the ones it overlaps light their outlines
  const over = decorOverlaps(s);
  for (let d = 0; d < DECOR_N; d++) {
    const lifted = s.lifted === d && placed(s, d);
    v[`dec${d}`] = placed(s, d) ? (lifted && s.drawer.hot ? 0.45 : 1) : 0;
    v[`dec${d}x`] = snap(s.decorX[d] ?? DECOR[d]!.x);
    v[`dec${d}y`] = snap(decorBaseY(s, d));
    v[`dec${d}lift`] = lifted ? 1 : 0;
    v[`dec${d}ov`] = over.includes(d) ? 1 : 0;
  }
  v.dec4glow = night * (placed(s, 4) ? 1 : 0);
  // v15: the put-away drawer, sliding up from the cabinet's top edge while a decoration is carried
  v.storeO = Math.round(s.drawer.e * 100) / 100;
  v.storeY = snap((1 - s.drawer.e) * DRAWER.slide);
  v.storeHot = s.drawer.hot && s.lifted >= 0 ? 1 : 0;
  // v15: reduce motion reaches into the .riv: the water's own loops (caustics, shafts, sheen, bubbles) still or
  // slow, and the parallax layers move with the camera
  v.calm = s.reducedMotion ? 1 : 0;
  v.pearl = pearlShowing(s) ? 1 : 0;

  // helpers
  const sn = s.snail;
  v.snailOn = s.helpers[SNAIL] ? 1 : 0;
  v.snailX = snap(sn.x);
  v.snailY = snap(sn.y);
  v.snailSX = sn.sx;
  for (let f = 0; f < 2; f++) v[`snailF${f}`] = f === sn.f ? 1 : 0;
  const walkers: [string, Walker, boolean][] = [
    ["shrimp", s.shrimp, s.helpers[SHRIMP] === true],
    ["crab", s.crab, s.helpers[CRAB] === true],
  ];
  for (const [name, h, on] of walkers) {
    v[`${name}On`] = on ? 1 : 0;
    v[`${name}X`] = snap(h.x);
    v[`${name}Y`] = snap(h.y);
    v[`${name}SX`] = h.sx;
    for (let f = 0; f < 4; f++) v[`${name}F${f}`] = f === h.f ? 1 : 0;
  }

  // the camera, the right wall, and the chevrons saying there's more tank that way
  const xf = viewXform(s);
  v.camX = xf.tx;
  v.camY = xf.ty;
  v.camZ = xf.z;
  v.wallX = snap(wallX(s));
  v.panL = clamp(s.hints.l);
  v.panR = clamp(s.hints.r);

  // visitors (world): the one in the tank, eased in and out; the others hidden
  VISITOR_PROP.forEach((name, k) => {
    const vis = s.visit && s.visit.kind === k ? s.visit : null;
    v[`${name}On`] = vis ? clamp(vis.on) : 0;
    v[`${name}X`] = vis ? snap(vis.x) : 0;
    v[`${name}Y`] = vis ? snap(vis.y) : 0;
    v[`${name}SX`] = vis ? vis.sx : 1;
    for (let f = 0; f < 4; f++) v[`${name}F${f}`] = (vis ? vis.f : 0) === f ? 1 : 0;
  });
  return v;
}
