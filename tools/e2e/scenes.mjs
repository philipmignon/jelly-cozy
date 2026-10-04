/**
 * What the visual flows (flows/visual-tank.mjs, flows/visual-ui.mjs) share: the saves behind their scenes, and
 * `snap`, which settles the tank, takes the screenshot and compares it with its reference (visual.mjs).
 *
 * Every scene runs on the virtual clock from the same start (lib.mjs NOW: a June noon, local time) and seed, with
 * the font served locally, so a scene draws the same pixels every run. Waits for things that load on real time
 * (the room's art, a long-press) never step the clock (no `pump`): how long they take mustn't change how far the
 * tank has moved.
 */
import { NOW, blank, dayKey, entry, jelly, save } from "./lib.mjs";
import { compare, textBoxes } from "./visual.mjs";

export const WIDE = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };
export const SMALL = { width: 360, height: 640 };

const NAMES = ["Mochi", "Tofu", "Bloop", "Pip", "Nori", "Suki", "Momo"];
const owned = (...ns) => Array.from({ length: 11 }, (_, n) => ns.includes(n));

/** two adults (a moon, a fried egg) and a blubber juvenile: the everyday tank */
export const everyday = (over = {}) =>
  save({
    slots: [jelly(0, 3, { name: "Mochi" }), jelly(4, 3, { name: "Tofu" }), jelly(1, 2, { name: "Bloop" })],
    journal: [entry(1), entry(0), blank(), blank(), entry(1), blank(), blank(), blank(), blank()],
    owned: owned(3, 5),
    dollars: 120,
    ...over,
  });

/**
 * The full tank: the large tank (tier 2), seven species raised, every decoration bought (the bubbler too), the
 * five keepsake decorations earned, the helpers. Milestones 0-4 are earned and in step with the journal (7 kinds,
 * a rare colour, 7 days, 10 requests), so no keepsake note comes up over it.
 */
export const full = () =>
  save({
    tier: 2,
    slots: [0, 1, 2, 3, 4, 5, 6].map((k) => jelly(k, 3, { name: NAMES[k], morph: k === 2 ? 1 : 0 })),
    journal: Array.from({ length: 9 }, (_, k) => (k < 7 ? entry(1, { morphSeen: k === 2 ? 1 : 0 }) : blank())),
    owned: owned(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
    helpers: [true, true, true],
    keep: { earned: 0b11111, days: 7, lastDay: dayKey(NOW), requests: 10 },
    dollars: 900,
  });

/** Halloween: a ghost moon (the season's morph, its milestone earned) and a comb jelly */
export const halloween = () =>
  save({
    slots: [jelly(0, 3, { name: "Mochi", morph: 2 }), jelly(2, 3, { name: "Bloop" })],
    journal: [entry(1, { morphSeen: 2 }), blank(), entry(1), blank(), blank(), blank(), blank(), blank(), blank()],
    owned: owned(3, 5, 7),
    keep: { earned: 0b101, days: 1, lastDay: dayKey(NOW), requests: 0 },
    dollars: 40,
  });

/**
 * Tolerances, % of a scene's pixels that may differ (visual.mjs): `pct` against a set made on this platform and
 * Chrome major (default 0: the virtual clock's renders are byte-identical run to run), `foreign` against one made
 * elsewhere, HTML text left out (default 0.05%).
 *
 * The foreign defaults come from checking the Metal renders against the SwiftShader set (two GPUs, the worst case
 * for "another renderer"), HTML text left out: 0.000-0.033% for most scenes. Four scenes draw pixel art scaled by a
 * fraction (the phones, the room, the journal's keepsake icons), where each GPU rounds nearest-neighbour sampling
 * its own way: 0.2-1.0% there, so they get about 1.5x that. The old chest lid (README, "Reference screenshots")
 * moves 0.3% of the day scenes' pixels: day-new, full-tank, calm and drawer-carrying catch it at 0.05%.
 */
const TOL = {
  "phone-390x844": { foreign: 1.5 },
  "small-360x640": { foreign: 0.65 },
  "room-day": { foreign: 0.4 },
  "room-halloween-dusk": { foreign: 0.4 },
  "journal-keepsakes": { foreign: 0.5 },
};

/**
 * Settle, screenshot (shots/e2e-v-<scene>.png) and compare with reference/<set>/<scene>.png. `settle`: idle first
 * (false when the scene is mid-gesture and must stay there).
 */
export async function snap(t, scene, tol = TOL[scene], { settle = true } = {}) {
  if (settle) await t.idle();
  const text = await t.eval(textBoxes); // what a run on another platform leaves out (visual.mjs)
  const png = await t.shot(`v-${scene}`);
  return compare(t, scene, png, tol, text);
}

/** close the scene's page (the browser's WebGL contexts are limited; a flow runs many scenes) */
export async function done(t) {
  const ctx = t.ctx;
  t.contexts = t.contexts.filter((c) => c !== ctx);
  await ctx.close().catch(() => {});
}
