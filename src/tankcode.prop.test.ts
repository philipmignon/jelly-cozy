/**
 * Property tests for share codes and backup codes (fast-check): any tank the game can hold survives
 * code -> tank -> code exactly; decoding never throws and accepts only what encode would write; backup codes
 * carry any save unchanged.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cleanName, NAMES } from "./names";
import { decodeSave, encodeSave } from "./share";
import { createState, exportTank, importTank, loadGame, toSave, DECOR, POLYP_ANCHORS, SETTLE_SPOTS } from "./sim";
import { DECOR_N, HELPER_N, MAX_SLOTS, SPECIES_N, THEME_N, TIER_N, UPSIDE, decorClampX, maxJelliesOf, P } from "./species";
import { NAME_CHARS, decodeTank, encodeTank, hasPlace, validTank, type CodeJelly, type TankCode } from "./tankcode";
import { traitFromName } from "./traits";

// one fixed seed, so CI never flakes; FC_SEED=<n> replays another, FC_SEED=random explores
if (process.env.FC_SEED !== "random") fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 20261003) });
/** FC_SCALE=10 runs every property ten times as long */
const runs = (n: number) => Math.round(n * Number(process.env.FC_SCALE ?? 1));

const NOW = new Date(2026, 9, 3, 14, 30).getTime();

// ---------------------------------------------------------------- arbitraries

/** Names: the built-in ones, short custom ones from the cheap alphabet, and ones with accents, emoji, inner spaces. */
const nameArb = fc.oneof(
  fc.constantFrom(...NAMES),
  fc.string({ unit: fc.constantFrom(...NAME_CHARS), minLength: 1, maxLength: 12 }),
  fc.string({ unit: fc.constantFrom(..."aZ9 éñ🍡ü漢"), minLength: 1, maxLength: 12 }),
).map((n) => n.trim()).filter((n) => cleanName(n) === n);

const jellyArb = fc.record({
  slot: fc.integer({ min: 0, max: MAX_SLOTS - 1 }),
  k: fc.integer({ min: 0, max: SPECIES_N - 1 }),
  g: fc.integer({ min: 0, max: 3 }),
  morph: fc.integer({ min: 0, max: 2 }),
  trait: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
  name: nameArb,
  pick: fc.nat(),
});

/** A tank layout the game could hold: decorations on the grid inside the tier, rocks and sand spots not shared. */
const tankArb = fc
  .record({
    tier: fc.integer({ min: 0, max: TIER_N - 1 }),
    theme: fc.integer({ min: 0, max: THEME_N - 1 }),
    helpers: fc.array(fc.boolean(), { minLength: HELPER_N, maxLength: HELPER_N }),
    decor: fc.array(fc.option(fc.integer({ min: -100, max: 2400 }), { nil: null }), { minLength: DECOR_N, maxLength: DECOR_N }),
    jellies: fc.uniqueArray(jellyArb, { selector: (j) => j.slot, maxLength: MAX_SLOTS }),
    // half the tanks only use what versions 1..4 can say (no keepsake decor or theme, traits from names)
    legacy: fc.boolean(),
  })
  .map(({ tier, theme: th, helpers, decor, jellies, legacy }): TankCode => {
    const theme = legacy ? th % 4 : th;
    const anchors = POLYP_ANCHORS.flatMap((a, i) => (a.tier <= tier ? [i] : []));
    const spots = SETTLE_SPOTS.flatMap((a, i) => (a.tier <= tier ? [i] : []));
    const take = (free: number[], pick: number) => (free.length ? free.splice(pick % free.length, 1)[0]! : -1);
    const js: CodeJelly[] = jellies.slice(0, maxJelliesOf(tier)).map(({ pick, trait, ...j }) => {
      let g = j.g;
      let place = -1;
      if (hasPlace(j.k, g)) {
        place = take(g === 0 ? anchors : spots, pick);
        if (place < 0) g = 1; // no free rock or spot: an ephyra, which has no place
      }
      return { ...j, g, place, ...(trait === undefined || legacy ? {} : { trait }) };
    });
    const t: TankCode = {
      tier,
      ...(theme ? { theme } : {}),
      helpers,
      decor: decor.map((x, n) => (x === null || (legacy && n >= 5) ? null : decorClampX(n, x, tier))),
      jellies: js,
    };
    return t;
  })
  .filter(validTank);

/** What a layout means, whichever version spells it: theme 0 by default, traits from names, jellies by slot. */
const meaning = (t: TankCode) => ({
  tier: t.tier,
  theme: t.theme ?? 0,
  helpers: t.helpers,
  decor: t.decor,
  jellies: [...t.jellies].sort((a, b) => a.slot - b.slot).map((j) => ({ ...j, trait: j.trait ?? traitFromName(j.name, j.k) })),
});

const fletcher = (bytes: number[]) => {
  let a = 0;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 255;
    b = (b + a) % 255;
  }
  return (b << 8) | a;
};
/** Random bytes with a correct checksum: past the cheap check, so the decoder itself gets exercised. */
const checksummed = fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 60 }).map((bytes) => {
  const sum = fletcher(bytes);
  return Buffer.from([...bytes, sum >> 8, sum & 255]).toString("base64url");
});
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** A real code with one character changed, dropped or added. */
const mutated = fc.tuple(tankArb, fc.nat(), fc.constantFrom(...B64URL), fc.constantFrom("swap", "drop", "add")).map(([t, i, ch, how]) => {
  const c = encodeTank(t);
  const at = i % c.length;
  return how === "swap" ? c.slice(0, at) + ch + c.slice(at + 1) : how === "drop" ? c.slice(0, at) + c.slice(at + 1) : c.slice(0, at) + ch + c.slice(at);
});
const garbage = fc.oneof(fc.string({ maxLength: 80 }), fc.string({ unit: fc.constantFrom(...B64URL), maxLength: 120 }), checksummed, mutated);

// ---------------------------------------------------------------- share codes

describe("share codes", () => {
  it("encode -> decode keeps the layout", () => {
    fc.assert(
      fc.property(tankArb, (t) => {
        const c = encodeTank(t);
        expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
        const back = decodeTank(c);
        expect(back).not.toBeNull();
        expect(meaning(back!)).toEqual(meaning(t));
      }),
      { numRuns: runs(300) },
    );
  });

  it("exportTank(createState(importTank(c))) === c", () => {
    fc.assert(
      fc.property(tankArb, fc.integer({ min: NOW - 400 * 864e5, max: NOW + 400 * 864e5 }), (t, now) => {
        const c = encodeTank(t);
        const save = importTank(c, now);
        expect(save).not.toBeNull();
        expect(exportTank(createState(save!, () => 0.5))).toBe(c);
        // and the visit's tank is a save the game would load as it is
        expect(JSON.stringify(loadGame(JSON.stringify(save), now).save.slots.map((j) => j && [j.k, j.g, j.name, j.morph]))).toBe(
          JSON.stringify(save!.slots.map((j) => j && [j.k, j.g, j.name, j.morph])),
        );
      }),
      { numRuns: runs(200) },
    );
  });

  it("decoding garbage never throws; whatever it accepts is a valid layout spelled exactly as encode spells it", () => {
    fc.assert(
      fc.property(garbage, fc.constantFrom("", " ", "\n"), (code, pad) => {
        const t = decodeTank(pad + code + pad);
        if (t === null) return;
        expect(validTank(t)).toBe(true);
        expect(encodeTank(t)).toBe(code);
      }),
      { numRuns: runs(1500) },
    );
  });

  it("one spelling per name: a built-in name spelt letter by letter, or a plain letter escaped, is not a code", () => {
    // the same tank (one moon ephyra called Puff) three ways; only encodeTank's is accepted
    expect(decodeTank("EACAQwBY0w")?.jellies[0]?.name).toBe("Puff");
    expect(encodeTank(decodeTank("EACAQwBY0w")!)).toBe("EACAQwBY0w");
    expect(decodeTank("EACAVD7n367q")).toBeNull(); // "Puff" as P, u, f, f
    expect(decodeTank("EACAUfwACCA-Bw")).toBeNull(); // "A" as an escaped code point
  });

  it("importTank never throws on garbage, and what it accepts makes a tank", () => {
    fc.assert(
      fc.property(fc.oneof(garbage, fc.anything().map((x) => x as string)), (code) => {
        const save = importTank(code, NOW);
        if (save) createState(save, () => 0.5);
      }),
      { numRuns: runs(500) },
    );
  });

  it("decoration positions in a code are on the grid and inside the tank", () => {
    fc.assert(
      fc.property(tankArb, (t) => {
        decodeTank(encodeTank(t))!.decor.forEach((x, n) => {
          if (x === null) return;
          expect(x % P).toBe(0);
          expect(decorClampX(n, x, t.tier)).toBe(x);
          expect(DECOR[n]).toBeDefined();
        });
      }),
      { numRuns: runs(100) },
    );
  });
});

// ---------------------------------------------------------------- backup codes

describe("backup codes", () => {
  const saveLike = fc.record({ v: fc.integer(), slots: fc.array(fc.jsonValue(), { maxLength: 5 }) }).chain((base) =>
    fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 6 }).map((extra) => ({ ...extra, ...base })),
  );

  it("any save-shaped JSON round-trips exactly (unicode, emoji, lone surrogates as JSON escapes)", () => {
    fc.assert(
      fc.property(saveLike, (o) => {
        const json = JSON.stringify(o);
        const code = encodeSave(json);
        expect(code).toMatch(/^JTSAVE1\.[A-Za-z0-9_-]*$/);
        expect(decodeSave(code)).toBe(json);
        expect(decodeSave(`\n  ${code} `)).toBe(json);
      }),
      { numRuns: runs(300) },
    );
  });

  it("a real tank backed up and restored loads as the same save", () => {
    fc.assert(
      fc.property(tankArb, (t) => {
        const s = createState(importTank(encodeTank(t), NOW)!, () => 0.5);
        const json = JSON.stringify(toSave(s, NOW));
        expect(JSON.stringify(loadGame(decodeSave(encodeSave(json)), NOW).save)).toBe(JSON.stringify(loadGame(json, NOW).save));
      }),
      { numRuns: runs(100) },
    );
  });

  it("decoding anything never throws; it accepts only a save-shaped JSON", () => {
    const tampered = fc.tuple(saveLike, fc.nat(), fc.constantFrom(...B64URL, "=", ".", "!")).map(([o, i, ch]) => {
      const c = encodeSave(JSON.stringify(o));
      const at = 8 + (i % Math.max(1, c.length - 8));
      return c.slice(0, at) + ch + c.slice(at + 1);
    });
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 60 }), fc.string({ maxLength: 60 }).map((s) => `JTSAVE1.${s}`), tampered), (code) => {
        const json = decodeSave(code);
        if (json === null) return;
        const o = JSON.parse(json) as { v: unknown; slots: unknown };
        expect(typeof o.v).toBe("number");
        expect(Array.isArray(o.slots)).toBe(true);
      }),
      { numRuns: runs(500) },
    );
  });
});

// sanity: the layouts generated reach the interesting cases (every version, places, ghosts, custom names)
describe("the tank arbitrary", () => {
  it("covers versions 1..5, polyps on rocks, settled upside-downs, ghosts and custom names", () => {
    const sample = fc.sample(tankArb, { numRuns: 400, seed: 7 });
    const versions = new Set(sample.map((t) => Buffer.from(encodeTank(t), "base64url")[0]! >> 4));
    expect([...versions].sort()).toEqual([1, 2, 3, 4, 5]);
    const js = sample.flatMap((t) => t.jellies);
    expect(js.some((j) => j.g === 0 && j.place >= 0)).toBe(true);
    expect(js.some((j) => j.k === UPSIDE && j.g >= 2 && j.place >= 0)).toBe(true);
    expect(js.some((j) => j.morph === 2)).toBe(true);
    expect(js.some((j) => !NAMES.includes(j.name))).toBe(true);
  });
});
