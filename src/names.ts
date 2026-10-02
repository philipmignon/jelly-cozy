/** Jelly names: a cozy list (snacks, soft things, little sounds), no real people. */
import { NAME_MAX } from "./species";

export const NAMES: readonly string[] = [
  "Mochi", "Bloop", "Pudding", "Tapioca", "Boba", "Dumpling", "Noodle", "Biscuit",
  "Marshmallow", "Pebble", "Bubbles", "Jellybean", "Puff", "Wobble", "Squish", "Sprinkle",
  "Custard", "Taffy", "Gumdrop", "Waffle", "Muffin", "Pancake", "Plum", "Lychee",
  "Sago", "Nori", "Miso", "Udon", "Tofu", "Bao", "Daifuku", "Wiggles",
  "Drizzle", "Doodle", "Pip", "Fizz", "Nimbus", "Glimmer", "Dewdrop", "Snowpea",
];

/** A name not in `used`, starting from a random point in the list (r in [0, 1)). */
export function pickName(used: Iterable<string>, r: number): string {
  const taken = new Set(used);
  const n = NAMES.length;
  const start = Math.floor((Number.isFinite(r) ? Math.abs(r) % 1 : 0) * n);
  for (let i = 0; i < n; i++) {
    const name = NAMES[(start + i) % n]!;
    if (!taken.has(name)) return name;
  }
  // more jellies than names (can't happen with 7 slots and 40 names): number them
  for (let k = 2; ; k++) {
    const name = `${NAMES[start % n]!} ${k}`;
    if (!taken.has(name)) return name;
  }
}

/** The name a player typed, trimmed; null unless it is 1..12 characters with no control characters. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return null;
  const len = [...name].length;
  return len >= 1 && len <= NAME_MAX ? name : null;
}
