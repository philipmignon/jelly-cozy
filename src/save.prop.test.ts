/**
 * Property tests for saves (fast-check): whatever localStorage holds, loadGame gives back a valid current save
 * without throwing; a save written by toSave reads back as itself; every older version's shape migrates.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cleanName } from "./names";
import { createState, loadGame, step, toSave, SAVE_VERSION, type Save } from "./sim";
import { DECOR_N, FOOD_KINDS, HELPER_N, MAX_DOLLARS, MAX_SLOTS, MORPH_KNOWN, SPECIES_N, THEME_N, TIER_N, maxJelliesOf } from "./species";
import { REQUESTS_PER_DAY } from "./requests";
import { KEEPSAKE_N } from "./keepsakes";

// one fixed seed, so CI never flakes; FC_SEED=<n> replays another, FC_SEED=random explores
if (process.env.FC_SEED !== "random") fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 20261003) });
/** FC_SCALE=10 runs every property ten times as long */
const runs = (n: number) => Math.round(n * Number(process.env.FC_SCALE ?? 1));

const NOW = new Date(2026, 9, 3, 14, 30).getTime();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A save as localStorage keeps it (JSON has no -0: a spot of -0 and of 0 are the same save). */
const asStored = (s: Save): unknown => JSON.parse(JSON.stringify(s));
const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const bools = (xs: unknown, n: number) => Array.isArray(xs) && xs.length === n && xs.every((b) => typeof b === "boolean");

/** Every field a current save must have, in range. Returns the first problem, or "" (so a failure says what broke). */
function problem(s: Save, now: number): string {
  if (s.v !== SAVE_VERSION) return `v ${s.v}`;
  if (!Array.isArray(s.slots) || s.slots.length !== MAX_SLOTS) return "slots length";
  if (!Number.isInteger(s.tier) || s.tier < 0 || s.tier >= TIER_N) return "tier";
  if (s.slots.filter(Boolean).length > maxJelliesOf(s.tier)) return "more jellies than the tier holds";
  for (const j of s.slots) {
    if (j === null) continue;
    if (!Number.isInteger(j.k) || j.k < 0 || j.k >= SPECIES_N) return `species ${j.k}`;
    if (!Number.isInteger(j.g) || j.g < 0 || j.g > 3) return `stage ${j.g}`;
    for (const f of ["gp", "care", "fullness", "affection", "anchor", "spot", "born", "content", "morph"] as const) if (!finite(j[f])) return `jelly ${f} ${j[f]}`;
    if (j.fullness < 0 || j.fullness > 1 || j.affection < 0 || j.affection > 1) return "needs out of 0..1";
    if (cleanName(j.name) !== j.name) return `name ${JSON.stringify(j.name)}`;
    if (j.trait !== undefined && (!Number.isInteger(j.trait) || j.trait < 0 || j.trait > 3)) return `trait ${j.trait}`;
    if (!MORPH_KNOWN.includes(j.morph)) return `morph ${j.morph}`;
    if (j.pair !== undefined && (!Number.isInteger(j.pair) || j.pair < 0 || j.pair >= MAX_SLOTS)) return `pair ${j.pair}`;
  }
  if (!Number.isInteger(s.dollars) || s.dollars < 0 || s.dollars > MAX_DOLLARS) return `dollars ${s.dollars}`;
  if (!finite(s.murk) || s.murk < 0 || s.murk > 1) return `murk ${s.murk}`;
  if (!Array.isArray(s.spots) || !s.spots.every((p) => finite(p.x) && finite(p.y) && finite(p.dirt) && finite(p.v))) return "spots";
  if (typeof s.night !== "boolean") return "night";
  if (s.lamp !== null && !(typeof s.lamp.night === "boolean" && finite(s.lamp.until))) return "lamp";
  if (!bools(s.owned, DECOR_N) || !bools(s.helpers, HELPER_N)) return "owned/helpers";
  if (!Array.isArray(s.decorX) || s.decorX.length !== DECOR_N || !s.decorX.every(finite)) return "decorX";
  if (s.pearlDay !== "" && !DAY.test(s.pearlDay)) return `pearlDay ${s.pearlDay}`;
  if (s.lastSeen !== now) return `lastSeen ${s.lastSeen}`;
  if (!finite(s.cam) || s.cam > 0) return `cam ${s.cam}`;
  if (!Array.isArray(s.journal) || s.journal.length !== SPECIES_N) return "journal length";
  for (const e of s.journal) {
    if (typeof e.seen !== "boolean" || !Number.isInteger(e.raised) || e.raised < 0) return "journal entry";
    if (e.firstAdultAt !== null && !finite(e.firstAdultAt)) return "journal firstAdultAt";
    if (e.firstName !== null && cleanName(e.firstName) !== e.firstName) return "journal firstName";
    if (!Number.isInteger(e.morphSeen) || !Number.isInteger(e.traitSeen)) return "journal bitmasks";
  }
  if (!bools(s.foods, FOOD_KINDS) || s.foods[0] !== true) return "foods";
  if (!bools(s.themes, THEME_N) || s.themes[0] !== true) return "themes";
  if (!Number.isInteger(s.theme) || !s.themes[s.theme]) return `theme ${s.theme}`;
  if (s.requests) {
    if (!DAY.test(s.requests.day) || s.requests.items.length > REQUESTS_PER_DAY) return "requests";
    for (const r of s.requests.items) if (r.progress < 0 || r.progress > r.n || r.done !== (r.progress >= r.n)) return `request progress ${r.progress}/${r.n} ${r.done}`;
  }
  if (s.keep) {
    const k = s.keep;
    if (!Number.isInteger(k.earned) || k.earned < 0 || k.earned >= 1 << KEEPSAKE_N) return "keep.earned";
    if (!Number.isInteger(k.days) || k.days < 0 || !Number.isInteger(k.requests) || k.requests < 0) return "keep counts";
    if (k.lastDay !== "" && !DAY.test(k.lastDay)) return "keep.lastDay";
  }
  if (s.stored && (!bools(s.stored, DECOR_N) || s.stored.some((st, n) => st && !s.owned[n]))) return "stored";
  if (s.visitorsSeen) for (const v of Object.values(s.visitorsSeen)) if (!v || !Number.isInteger(v.n) || v.n < 1 || !finite(v.first)) return "visitorsSeen";
  // and it survives the trip through localStorage unchanged (no NaN, Infinity or undefined hiding in it)
  if (JSON.stringify(JSON.parse(JSON.stringify(s))) !== JSON.stringify(s)) return "not plain JSON";
  return "";
}

// ---------------------------------------------------------------- arbitraries

/** Numbers a damaged save might hold: ordinary ones, edge cases and the non-finite. */
const num = fc.oneof(
  fc.double({ min: -2, max: 2, noNaN: true }),
  fc.integer({ min: -10, max: 100 }),
  fc.constantFrom(0, -0, 1, -1, 0.5, 1e9, -1e9, 1e308, -1e308, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity),
  fc.double(),
);
/** Something in place of anything: right type, wrong type, nothing. */
const junk = fc.oneof(num, fc.string({ maxLength: 20 }), fc.boolean(), fc.constant(null), fc.constant(undefined), fc.array(fc.integer(), { maxLength: 3 }), fc.object({ maxDepth: 1 }));
const field = <T>(a: fc.Arbitrary<T>) => fc.oneof({ weight: 3, arbitrary: a as fc.Arbitrary<unknown> }, { weight: 1, arbitrary: junk });
const time = fc.oneof(fc.integer({ min: NOW - 400 * 864e5, max: NOW + 864e5 }), num);
const name = fc.oneof(fc.constantFrom("Mochi", "Bloop", "Pâte 🍡", "", "   ", "x".repeat(40), "a\u0000b", "\ud800"), fc.string({ maxLength: 16 }));
const dayStr = fc.oneof(fc.constantFrom("2026-10-03", "2026-10-02", "", "2026-1-1", "garbage"), fc.string({ maxLength: 10 }));

const jellyArb = fc.record(
  {
    k: field(fc.integer({ min: 0, max: SPECIES_N - 1 })),
    g: field(fc.integer({ min: 0, max: 3 })),
    gp: field(fc.double({ min: 0, max: 100, noNaN: true })),
    care: field(num),
    fullness: field(fc.double({ min: 0, max: 1, noNaN: true })),
    affection: field(fc.double({ min: 0, max: 1, noNaN: true })),
    anchor: field(fc.integer({ min: -1, max: 8 })),
    spot: field(fc.integer({ min: -1, max: 8 })),
    name: field(name),
    born: field(time),
    content: field(num),
    morph: field(fc.oneof(fc.boolean(), fc.integer({ min: 0, max: 6 }))),
    trait: field(fc.integer({ min: -1, max: 4 })),
    // v16: a mate's slot (or junk)
    pair: field(fc.integer({ min: -2, max: 8 })),
  },
  { requiredKeys: [] },
);
const requestArb = fc.record(
  {
    kind: field(fc.constantFrom("feed", "scrub", "pet", "pearl", "sprinkle", "visitor", "ride", "night", "dance")),
    target: field(fc.integer({ min: -2, max: 12 })),
    food: field(fc.integer({ min: -1, max: 4 })),
    n: field(fc.integer({ min: 0, max: 120 })),
    progress: field(fc.integer({ min: -5, max: 120 })),
    done: field(fc.boolean()),
  },
  { requiredKeys: [] },
);

/** A save of any version from 1 to 13 (6 never existed), with every field possibly damaged or missing. */
const saveish = fc.record(
  {
    v: fc.oneof({ weight: 6, arbitrary: fc.integer({ min: 1, max: 13 }) }, { weight: 1, arbitrary: junk }),
    slots: field(fc.array(fc.oneof(jellyArb, fc.constant(null), junk), { maxLength: 9 })),
    dollars: field(num),
    murk: field(num),
    spots: field(fc.array(fc.record({ x: num, y: num, dirt: num, v: num }, { requiredKeys: [] }), { maxLength: 12 })),
    night: field(fc.boolean()),
    lamp: field(fc.record({ night: field(fc.boolean()), until: field(time) }, { requiredKeys: [] })),
    owned: field(fc.array(fc.oneof(fc.boolean(), junk), { maxLength: 13 })),
    helpers: field(fc.array(fc.boolean(), { maxLength: 4 })),
    decorX: field(fc.array(num, { maxLength: 13 })),
    pearlDay: field(dayStr),
    lastSeen: field(time),
    tier: field(fc.integer({ min: -1, max: 3 })),
    cam: field(num),
    journal: field(fc.array(fc.record({ seen: junk, raised: num, firstAdultAt: num, firstName: field(name), morphSeen: field(fc.oneof(fc.boolean(), fc.integer())), traitSeen: num }, { requiredKeys: [] }), { maxLength: 10 })),
    foods: field(fc.array(fc.boolean(), { maxLength: 4 })),
    themes: field(fc.array(fc.boolean(), { maxLength: 6 })),
    theme: field(fc.integer({ min: -1, max: 6 })),
    requests: field(fc.record({ day: field(dayStr), items: field(fc.array(requestArb, { maxLength: 4 })) }, { requiredKeys: [] })),
    keep: field(fc.record({ earned: num, days: num, lastDay: dayStr, requests: num }, { requiredKeys: [] })),
    stored: field(fc.array(fc.oneof(fc.boolean(), junk), { maxLength: 13 })),
    visitorsSeen: field(fc.dictionary(fc.constantFrom("turtle", "seahorse", "diver", "bat", "octopus", "manta", "hermit", "__proto__", "x"), fc.record({ n: num, first: num }, { requiredKeys: [] }))),
    fullness: field(num),
    affection: field(num),
  },
  { requiredKeys: ["v"] },
);

/** Raw localStorage contents: nothing, any string, any JSON, a damaged save of some version, or a cut-off one. */
const raw = fc.oneof(
  fc.constant(null),
  fc.string({ maxLength: 40 }),
  fc.json({ maxDepth: 3 }),
  saveish.map((o) => JSON.stringify(o)),
  fc.tuple(saveish, fc.nat()).map(([o, n]) => {
    const s = JSON.stringify(o);
    return s.slice(0, n % (s.length + 1));
  }),
);
const nowArb = fc.integer({ min: NOW - 30 * 864e5, max: NOW + 30 * 864e5 });

// ---------------------------------------------------------------- properties

describe("loadGame on anything", () => {
  it("never throws, and always gives a valid current-version save that the sim can run", () => {
    fc.assert(
      fc.property(raw, nowArb, (r, now) => {
        const { save } = loadGame(r, now);
        expect(problem(save, now)).toBe("");
        const s = createState(save, () => 0.5, { requests: true, keepsakes: true });
        step(s, 0.1);
        expect(problem(toSave(s, now), now)).toBe("");
      }),
      { numRuns: runs(300) },
    );
  });

  it("is a fixed point: loading what it loaded changes nothing", () => {
    fc.assert(
      fc.property(raw, nowArb, (r, now) => {
        const once = loadGame(r, now).save;
        expect(asStored(loadGame(JSON.stringify(once), now).save)).toEqual(asStored(once));
      }),
      { numRuns: runs(150) },
    );
  });
});

describe("toSave -> loadGame", () => {
  it("round-trips: a tank saved and loaded at the same moment comes back as it was saved", () => {
    fc.assert(
      fc.property(raw, nowArb, fc.integer({ min: 0, max: 120 }), (r, now, frames) => {
        const loaded = loadGame(r, now).save;
        // keepOf caps its counters at 100,000 on load, but the live tank counts past the cap (countDay, finished
        // requests), so a tank 100,000 days in wouldn't read back exactly: 270 years of play, left out here
        fc.pre((loaded.keep?.days ?? 0) < 99_000 && (loaded.keep?.requests ?? 0) < 99_000);
        const s = createState(loaded, () => 0.25, { requests: true, keepsakes: true });
        for (let i = 0; i < frames; i++) step(s, 1 / 30);
        const saved = toSave(s, now);
        expect(asStored(loadGame(JSON.stringify(saved), now).save)).toEqual(asStored(saved));
      }),
      { numRuns: runs(100) },
    );
  });
});

describe("older versions migrate", () => {
  // the fields each version added (v6 changed none and never wrote a save)
  const ADDED: Record<number, string[]> = {
    2: ["slots", "dollars", "murk", "night", "owned", "lastSeen"],
    3: ["helpers", "decorX", "pearlDay"],
    4: [],
    5: ["tier", "cam"],
    7: ["journal"],
    8: ["spots"],
    9: ["foods", "themes", "theme"],
    10: ["requests"],
    11: ["keep"],
    12: ["stored", "visitorsSeen"],
    13: ["gels", "gel", "climate", "finds", "nursery"],
  };
  const fieldsOf = (v: number) => Object.entries(ADDED).flatMap(([at, fs]) => (Number(at) <= v ? fs : []));
  const plausibleJelly = (v: number) =>
    fc.record({
      k: fc.integer({ min: 0, max: SPECIES_N - 1 }),
      g: fc.integer({ min: 0, max: 3 }),
      gp: fc.integer({ min: 0, max: 40 }),
      fullness: fc.double({ min: 0, max: 1, noNaN: true }),
      affection: fc.double({ min: 0, max: 1, noNaN: true }),
      anchor: fc.integer({ min: -1, max: 2 }),
      spot: fc.constant(-1),
      ...(v >= 3 ? { name: fc.constantFrom("Mochi", "Bloop", "Puff"), born: fc.integer({ min: NOW - 90 * 864e5, max: NOW }), content: fc.nat(100) } : {}),
      ...(v >= 7 ? { morph: v >= 13 ? fc.constantFrom(...MORPH_KNOWN) : v >= 10 ? fc.integer({ min: 0, max: 2 }) : fc.boolean() } : {}),
      ...(v >= 11 ? { trait: fc.integer({ min: 0, max: 3 }) } : {}),
    });
  const versioned = fc.constantFrom(2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13).chain((v) =>
    fc.tuple(
      fc.constant(v),
      fc.record({ save: saveish, slots: fc.array(fc.option(plausibleJelly(v), { nil: null }), { minLength: 1, maxLength: 7 }), tier: fc.integer({ min: 0, max: 2 }), dollars: fc.integer({ min: 0, max: 20000 }) }),
    ),
  );

  it("v2..v13: the right shape loads as a current save keeping the jellies the tier holds, their species and the dollars", () => {
    fc.assert(
      fc.property(versioned, nowArb, ([v, { save, slots, tier, dollars }], now) => {
        const keep = new Set(fieldsOf(v));
        const o: Record<string, unknown> = { v };
        for (const [f, x] of Object.entries(save)) if (keep.has(f)) o[f] = x;
        Object.assign(o, { slots, dollars, lastSeen: now - 3600_000 }, v >= 5 ? { tier } : {});
        const { save: out, away } = loadGame(JSON.stringify(o), now);
        expect(problem(out, now)).toBe("");
        const t = v >= 5 ? tier : 0;
        const want = slots.slice(0, MAX_SLOTS).flatMap((j, i) => (j ? [[i, j.k]] : [])).slice(0, maxJelliesOf(t));
        expect(out.tier).toBe(t);
        expect(out.slots.flatMap((j, i) => (j ? [[i, j.k]] : []))).toEqual(want);
        expect(out.dollars).toBe(Math.min(dollars, MAX_DOLLARS));
        // an hour away from a real save: a summary, never a "new game"
        expect(away).not.toBeNull();
      }),
      { numRuns: runs(200) },
    );
  });

  it("v1 (one adult moon) gets its needs carried over and the welcome gift", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean(), nowArb, (fullness, murk, affection, night, now) => {
        const { save } = loadGame(JSON.stringify({ v: 1, fullness, murk, affection, night, lastSeen: now }), now);
        expect(problem(save, now)).toBe("");
        const js = save.slots.filter((j) => j !== null);
        expect(js.map((j) => [j.k, j.g])).toEqual([[0, 3]]);
        expect(js[0]!.fullness).toBeCloseTo(fullness, 9);
        expect(save.dollars).toBe(10);
      }),
      { numRuns: runs(100) },
    );
  });

  it("v6 and unknown versions are not saves: a new game", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(6), fc.integer({ min: 13, max: 1000 }), fc.integer({ max: 0 })), saveish, nowArb, (v, o, now) => {
        const { save, away } = loadGame(JSON.stringify({ ...o, v }), now);
        expect(problem(save, now)).toBe("");
        expect(away).toBeNull();
        expect(save.slots.filter(Boolean).map((j) => [j!.k, j!.g])).toEqual([[0, 0]]);
      }),
      { numRuns: runs(60) },
    );
  });
});
