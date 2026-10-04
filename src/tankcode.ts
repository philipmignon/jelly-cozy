/**
 * Tank share codes (v7): a compact, URL-safe text form of a tank's layout, for showing someone
 * else's tank read-only. sim.ts wraps this as exportTank(s) / importTank(code).
 *
 * What's in a code: the tier, which helpers are owned, which decorations are owned and where they
 * stand, and each jelly's slot, species, stage, morph, rock anchor (polyps) or sand spot (settled
 * upside-downs) and name. Not in it: dollars, needs, growth, murk, the clock.
 *
 * Bits, most significant first:
 *   4 version (1, or 2 with a theme) | 2 tier | [v2: 2 theme] | 3 helpers | 5 decor owned, then 9 bits x/3 per owned decoration |
 *   3 jelly count, then per jelly: 3 slot, 4 species, 2 stage, 1 morph, [3 anchor | 3 spot],
 *   name: 1 mode; 0 -> 6 bits index into NAMES; 1 -> 4 bits length, then per character
 *   6 bits from NAME_CHARS, or 63 + a 21-bit code point.
 * Zero bits pad to a whole byte, then a 16-bit Fletcher checksum; the bytes go out as base64url.
 * v11: a tank with a theme other than the Reef writes version 2, which adds the theme after the tier;
 * a Reef tank still writes version 1, so its code is exactly what it was before themes.
 * v12: a tank with a ghost morph (morph id 2) writes version 3 (Reef) or 4 (themed): each jelly's morph is
 * 2 bits (its id) instead of 1. Tanks without one keep versions 1 and 2, so their codes don't change.
 * v13: one superset, version 5, for a tank the older versions can't carry: a decoration past the first five
 * (a keepsake, 5..9, or the bubbler, 10), the keepsake theme (4, Moonlit Lagoon), or a jelly whose trait isn't the
 * one its name gives (traitFromName):
 *   4 version (5) | 2 tier | 3 theme | 3 helpers | 4 decoration count D | D owned bits, then 9 bits x/3 per owned one |
 *   3 jelly count, then per jelly: 3 slot, 4 species, 2 stage, 2 morph, 2 trait, [3 place], name (as above).
 * D is one past the last owned decoration (0 when none), so a game with more decorations reads it unchanged.
 * Every other tank keeps versions 1-4, so its code doesn't change; reading those, each jelly's trait comes from its
 * name (the same rule that gives jellies from before traits theirs) and the later decorations aren't owned.
 * v16 (pairs): version 6 is version 5 with each jelly's morph in 3 bits instead of 2, written only for a tank with a
 * morph id of 3 or more (a pair's dusk 4 or pearl 5; 3 is reserved for the winter frost morph):
 *   4 version (6) | 2 tier | 3 theme | 3 helpers | 4 decoration count D | D owned bits, then 9 bits x/3 per owned one |
 *   3 jelly count, then per jelly: 3 slot, 4 species, 2 stage, 3 morph, 2 trait, [3 place], name (as above).
 * Every other tank writes exactly what it wrote before (versions 1-5).
 */
import { DECOR_N, HELPER_N, MAX_SLOTS, MORPH_KNOWN, P, POLYP_ANCHORS, SETTLE_SPOTS, SPECIES_N, THEME_N, TIER_N, UPSIDE, decorClampX, maxJelliesOf } from "./species";
import { NAMES, cleanName } from "./names";
import { TRAIT_N, traitFromName } from "./traits";

export const CODE_VERSION = 1;
/** v11: codes for themed tanks */
export const CODE_VERSION_THEMED = 2;
/** v12: codes with 2-bit morph ids (a ghost in the tank), Reef and themed */
export const CODE_VERSION_MORPHS = 3;
export const CODE_VERSION_MORPHS_THEMED = 4;
/** v13: the superset: keepsakes, the bubbler, theme 4, 2-bit morphs, traits */
export const CODE_VERSION_V5 = 5;
/** v13: how many decorations, and themes, versions 1..4 can carry */
export const CODE_DECOR = 5;
export const CODE_THEMES = 4;
/** v16: version 6, version 5 with 3-bit morphs (a dusk or pearl in the tank) */
export const CODE_VERSION_V6 = 6;
/** v12: morph ids versions 1..5 carry (0 none, 1 classic, 2 ghost); version 6 carries any MORPH_KNOWN id below 8 */
const MORPH_IDS = 3;
/** Characters a custom name packs in 6 bits; anything else costs 27. */
export const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ";
const ESC = 63;

export interface CodeJelly {
  slot: number;
  k: number;
  g: number;
  /** v12: morph id, 0 none, 1 classic, 2 ghost (v7..v11: a boolean, true = classic) */
  morph: number;
  /** polyp: its rock anchor; settled upside-down (juvenile/adult): its sand spot; otherwise -1 */
  place: number;
  name: string;
  /** v13: its personality (0..3); missing: traitFromName(name, k) */
  trait?: number;
}

export interface TankCode {
  tier: number;
  /** v11: the tank theme, 0 Reef (the default when absent) .. 3 Arctic */
  theme?: number;
  helpers: boolean[];
  /** per decoration: its base x (world, artboard units) when owned, else null */
  decor: (number | null)[];
  jellies: CodeJelly[];
}

/** v13: the trait a jelly in a code has (its own, else the one its name gives). */
const traitIn = (j: CodeJelly): number => j.trait ?? traitFromName(j.name, j.k);
/** v13: does this layout need version 5? A decoration past the first five (a keepsake or the bubbler), the keepsake
 *  theme, or a jelly whose trait isn't the one its name gives. */
export const needsV5 = (t: TankCode): boolean =>
  (t.theme ?? 0) >= CODE_THEMES ||
  t.decor.some((x, n) => n >= CODE_DECOR && x !== null && x !== undefined) ||
  t.jellies.some((j) => traitIn(j) !== traitFromName(j.name, j.k));

/** v16: does this layout need version 6? A jelly whose morph id doesn't fit versions 1..5's (3 or more). */
export const needsV6 = (t: TankCode): boolean => t.jellies.some((j) => j.morph >= MORPH_IDS);

/** Does this jelly carry a place (anchor or spot) in the code? */
export const hasPlace = (k: number, g: number) => g === 0 || (k === UPSIDE && g >= 2);

// ---------------------------------------------------------------- bits

class Bits {
  bytes: number[] = [];
  private acc = 0;
  private n = 0;
  put(v: number, w: number): void {
    for (let i = w - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((v >>> i) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flush(): number[] {
    if (this.n) this.put(0, 8 - this.n);
    return this.bytes;
  }
}

class Reader {
  private i = 0;
  constructor(private bytes: number[]) {}
  get(w: number): number {
    let v = 0;
    for (let k = 0; k < w; k++) {
      const byte = this.bytes[this.i >> 3];
      if (byte === undefined) throw new Error("short");
      v = v * 2 + ((byte >> (7 - (this.i & 7))) & 1);
      this.i++;
    }
    return v;
  }
  /** what's left must be the zero padding of the last byte */
  done(): boolean {
    if (this.bytes.length - (this.i >> 3) > ((this.i & 7) ? 1 : 0)) return false;
    return (this.i & 7) === 0 || this.get(8 - (this.i & 7)) === 0;
  }
}

function fletcher(bytes: number[]): number {
  let a = 0;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 255;
    b = (b + a) % 255;
  }
  return (b << 8) | a;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toB64(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

function fromB64(s: string): number[] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) n = (n << 6) | (k < chunk.length ? B64.indexOf(chunk[k]!) : 0);
    const bytes = chunk.length - 1;
    for (let k = 0; k < bytes; k++) out.push((n >> (16 - 8 * k)) & 255);
    // the unused low bits of the last character must be zero (one spelling per code)
    if (chunk.length < 4 && (n & ((1 << (8 * (3 - bytes))) - 1)) !== 0) return null;
  }
  return out;
}

// ---------------------------------------------------------------- encode / decode

function putName(w: Bits, name: string): void {
  const i = NAMES.indexOf(name);
  if (i >= 0) {
    w.put(0, 1);
    w.put(i, 6);
    return;
  }
  const chars = [...name];
  w.put(1, 1);
  w.put(chars.length, 4);
  for (const ch of chars) {
    const c = NAME_CHARS.indexOf(ch);
    if (c >= 0) w.put(c, 6);
    else {
      w.put(ESC, 6);
      w.put(ch.codePointAt(0)!, 21);
    }
  }
}

function getName(r: Reader): string | null {
  if (r.get(1) === 0) {
    return NAMES[r.get(6)] ?? null;
  }
  const n = r.get(4);
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = r.get(6);
    if (c !== ESC) s += NAME_CHARS[c]!;
    else {
      const cp = r.get(21);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      const ch = String.fromCodePoint(cp);
      // one spelling per code: putName writes a NAME_CHARS character in 6 bits, never escaped
      if (NAME_CHARS.includes(ch)) return null;
      s += ch;
    }
  }
  // ...and a built-in name by its index, never letter by letter
  return NAMES.includes(s) ? null : s;
}

/** Is this tank layout one the game could hold? (Everything decode accepts, and only that.) */
export function validTank(t: TankCode): boolean {
  if (!Number.isInteger(t.tier) || t.tier < 0 || t.tier >= TIER_N) return false;
  if (t.theme !== undefined && (!Number.isInteger(t.theme) || t.theme < 0 || t.theme >= THEME_N)) return false;
  if (t.helpers.length !== HELPER_N || t.decor.length !== DECOR_N) return false;
  for (let n = 0; n < DECOR_N; n++) {
    const x = t.decor[n];
    if (x === null || x === undefined) continue;
    if (!Number.isFinite(x) || x % P !== 0 || x < 0 || x / P > 511 || decorClampX(n, x, t.tier) !== x) return false;
  }
  if (t.jellies.length > maxJelliesOf(t.tier)) return false;
  const slots = new Set<number>();
  const anchors = new Set<number>();
  const spots = new Set<number>();
  for (const j of t.jellies) {
    if (!Number.isInteger(j.slot) || j.slot < 0 || j.slot >= MAX_SLOTS || slots.has(j.slot)) return false;
    slots.add(j.slot);
    if (!Number.isInteger(j.k) || j.k < 0 || j.k >= SPECIES_N || !Number.isInteger(j.g) || j.g < 0 || j.g > 3) return false;
    if (cleanName(j.name) !== j.name) return false;
    if (!Number.isInteger(j.morph) || !MORPH_KNOWN.includes(j.morph) || j.morph > 7) return false;
    if (j.trait !== undefined && (!Number.isInteger(j.trait) || j.trait < 0 || j.trait >= TRAIT_N)) return false;
    if (j.g === 0) {
      const a = POLYP_ANCHORS[j.place];
      if (!a || a.tier > t.tier || anchors.has(j.place)) return false;
      anchors.add(j.place);
    } else if (hasPlace(j.k, j.g)) {
      const p = SETTLE_SPOTS[j.place];
      if (!p || p.tier > t.tier || spots.has(j.place)) return false;
      spots.add(j.place);
    } else if (j.place !== -1) return false;
  }
  return true;
}

/** The code for a tank layout (jellies in slot order). Throws on a layout validTank rejects. */
export function encodeTank(t: TankCode): string {
  if (!validTank(t)) throw new Error("not a valid tank");
  const w = new Bits();
  const theme = t.theme ?? 0;
  if (needsV6(t)) return encodeV5(t, w, theme, true);
  if (needsV5(t)) return encodeV5(t, w, theme);
  const wide = t.jellies.some((j) => j.morph > 1);
  w.put(wide ? (theme ? CODE_VERSION_MORPHS_THEMED : CODE_VERSION_MORPHS) : theme ? CODE_VERSION_THEMED : CODE_VERSION, 4);
  w.put(t.tier, 2);
  if (theme) w.put(theme, 2);
  for (let i = 0; i < HELPER_N; i++) w.put(t.helpers[i] ? 1 : 0, 1);
  for (let n = 0; n < CODE_DECOR; n++) w.put(t.decor[n] === null ? 0 : 1, 1);
  for (let n = 0; n < CODE_DECOR; n++) if (t.decor[n] !== null) w.put(t.decor[n]! / P, 9);
  const js = [...t.jellies].sort((a, b) => a.slot - b.slot);
  w.put(js.length, 3);
  for (const j of js) {
    w.put(j.slot, 3);
    w.put(j.k, 4);
    w.put(j.g, 2);
    if (wide) w.put(j.morph, 2);
    else w.put(j.morph ? 1 : 0, 1);
    if (hasPlace(j.k, j.g)) w.put(j.place, 3);
    putName(w, j.name);
  }
  return finish(w);
}

const finish = (w: Bits): string => {
  const bytes = w.flush();
  const sum = fletcher(bytes);
  return toB64([...bytes, sum >> 8, sum & 255]);
};

/** Versions 5 and 6 (`wide`: 3-bit morphs). */
function encodeV5(t: TankCode, w: Bits, theme: number, wide = false): string {
  w.put(wide ? CODE_VERSION_V6 : CODE_VERSION_V5, 4);
  w.put(t.tier, 2);
  w.put(theme, 3);
  for (let i = 0; i < HELPER_N; i++) w.put(t.helpers[i] ? 1 : 0, 1);
  // one past the last owned decoration: the fewest bits, and one spelling
  let nd = DECOR_N;
  while (nd > 0 && t.decor[nd - 1] === null) nd--;
  w.put(nd, 4);
  for (let n = 0; n < nd; n++) w.put(t.decor[n] === null ? 0 : 1, 1);
  for (let n = 0; n < nd; n++) if (t.decor[n] !== null) w.put(t.decor[n]! / P, 9);
  const js = [...t.jellies].sort((a, b) => a.slot - b.slot);
  w.put(js.length, 3);
  for (const j of js) {
    w.put(j.slot, 3);
    w.put(j.k, 4);
    w.put(j.g, 2);
    w.put(j.morph, wide ? 3 : 2);
    w.put(traitIn(j), 2);
    if (hasPlace(j.k, j.g)) w.put(j.place, 3);
    putName(w, j.name);
  }
  return finish(w);
}

/** The layout in a code, or null for anything that isn't exactly a code encodeTank would write. */
export function decodeTank(code: unknown): TankCode | null {
  if (typeof code !== "string") return null;
  const all = fromB64(code.trim());
  if (!all || all.length < 4) return null;
  const bytes = all.slice(0, -2);
  if (fletcher(bytes) !== ((all[all.length - 2]! << 8) | all[all.length - 1]!)) return null;
  try {
    const r = new Reader(bytes);
    const version = r.get(4);
    if (version === CODE_VERSION_V5) return decodeV5(r);
    if (version === CODE_VERSION_V6) return decodeV5(r, true);
    if (version < CODE_VERSION || version > CODE_VERSION_MORPHS_THEMED) return null;
    const themed = version === CODE_VERSION_THEMED || version === CODE_VERSION_MORPHS_THEMED;
    const wide = version >= CODE_VERSION_MORPHS;
    const tier = r.get(2);
    const theme = themed ? r.get(2) : 0;
    // one spelling per code: a Reef tank is always written as version 1 (or 3)
    if (themed && theme === 0) return null;
    const helpers = Array.from({ length: HELPER_N }, () => r.get(1) === 1);
    const owned = Array.from({ length: DECOR_N }, (_, n) => n < CODE_DECOR && r.get(1) === 1);
    const decor = owned.map((o) => (o ? r.get(9) * P : null));
    const n = r.get(3);
    const jellies: CodeJelly[] = [];
    for (let i = 0; i < n; i++) {
      const slot = r.get(3);
      const k = r.get(4);
      const g = r.get(2);
      const morph = r.get(wide ? 2 : 1);
      if (morph >= MORPH_IDS) return null;
      const place = hasPlace(k, g) ? r.get(3) : -1;
      const name = getName(r);
      if (name === null) return null;
      jellies.push({ slot, k, g, morph, place, name });
    }
    if (!r.done()) return null;
    // ...and 2-bit morphs only when there's a ghost to carry
    if (wide !== jellies.some((j) => j.morph > 1)) return null;
    for (let i = 1; i < jellies.length; i++) if (jellies[i]!.slot <= jellies[i - 1]!.slot) return null;
    const t: TankCode = theme ? { tier, theme, helpers, decor, jellies } : { tier, helpers, decor, jellies };
    return validTank(t) ? t : null;
  } catch {
    return null;
  }
}

/** v13: the rest of a version 5 code (throws on a short read, like the rest of decodeTank); v16: `wide`, version 6's. */
function decodeV5(r: Reader, wide = false): TankCode | null {
  const tier = r.get(2);
  const theme = r.get(3);
  const helpers = Array.from({ length: HELPER_N }, () => r.get(1) === 1);
  // a code from a game with more decorations than this one can't be shown
  const nd = r.get(4);
  if (nd > DECOR_N) return null;
  const owned = Array.from({ length: DECOR_N }, (_, n) => n < nd && r.get(1) === 1);
  // ...and D is exactly one past the last owned one
  if (nd > 0 && !owned[nd - 1]) return null;
  const decor = owned.map((o) => (o ? r.get(9) * P : null));
  const n = r.get(3);
  const jellies: CodeJelly[] = [];
  for (let i = 0; i < n; i++) {
    const slot = r.get(3);
    const k = r.get(4);
    const g = r.get(2);
    const morph = r.get(wide ? 3 : 2);
    const trait = r.get(2);
    if (wide ? !MORPH_KNOWN.includes(morph) : morph >= MORPH_IDS) return null;
    const place = hasPlace(k, g) ? r.get(3) : -1;
    const name = getName(r);
    if (name === null) return null;
    jellies.push({ slot, k, g, morph, place, name, trait });
  }
  if (!r.done()) return null;
  for (let i = 1; i < jellies.length; i++) if (jellies[i]!.slot <= jellies[i - 1]!.slot) return null;
  const t: TankCode = theme ? { tier, theme, helpers, decor, jellies } : { tier, helpers, decor, jellies };
  // one spelling per code: version 5 only for a layout the older versions can't carry, 6 only for 3-bit morphs
  return validTank(t) && (wide ? needsV6(t) : needsV5(t)) ? t : null;
}
