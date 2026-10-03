/**
 * v15: time in a hidden tab counts exactly like time away (closing the tab and opening it again later).
 */
import { describe, expect, it } from "vitest";
import { DECOR, catchUp, createState, journalFrom, loadGame, step, toSave, type Save, type SaveJelly, type State } from "./sim";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const T = new Date(2026, 9, 1, 12).getTime(); // noon: no quiet-night motion in the run-up
const HOUR = 3_600_000;
const jelly = (k: SaveJelly["k"], g: SaveJelly["g"], extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 0.9, affection: 0.6, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 1, ...extra,
});
const tank = (extra: Partial<Save> = {}): Save => {
  const slots = [jelly(0, 2, { gp: 25 }), jelly(1, 0, { name: "Bloop", anchor: 0, gp: 3, fullness: 0.7 }), null, null, null, null, null];
  return {
    v: 12, foods: [true, false, false], themes: [true, false, false, false, false], theme: 0, slots,
    dollars: 30, murk: 0, spots: [], night: false, lamp: null, owned: DECOR.map((_, i) => i === 0), helpers: [true, false, false],
    decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: T, tier: 0, cam: 0, journal: journalFrom(slots, 0), ...extra,
  };
};
const run = (s: State, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) step(s, 1 / 60);
};

describe("v15: a hidden tab catches up like time away", () => {
  it("3 h hidden gives the same save as closing the tab and opening it 3 h later", () => {
    // the same tank, played the same way for a minute
    const a = createState(tank(), seeded(7));
    const b = createState(tank(), seeded(7));
    run(a, 60);
    run(b, 60);
    const hiddenAt = a.clock;
    expect(b.clock).toBe(hiddenAt);
    const back = hiddenAt + 3 * HOUR;

    // a: closed (saved), opened 3 h later
    const reopened = loadGame(JSON.stringify(toSave(a, hiddenAt)), back);
    const fromReload = toSave(createState(reopened.save, seeded(9)), back);

    // b: the tab hidden for 3 h (no frames, no steps), then shown
    const away = catchUp(b, hiddenAt, back);
    const fromHidden = toSave(b, back);

    expect(fromHidden).toEqual(fromReload);
    expect(away).toEqual(reopened.away);
    expect(away!.seconds).toBe(3 * 3600);
    expect(away!.lines.length).toBeGreaterThan(0);
    // and it did something: hungrier, dirtier
    expect(b.slots[0]!.fullness).toBeLessThan(a.slots[0]!.fullness);
    expect(fromHidden.spots.length).toBeGreaterThan(0);
  });

  it("the same summary rule as a reload: nothing to say under 10 minutes; the clock catches up either way", () => {
    const s = createState(tank(), seeded(3));
    run(s, 5);
    const from = s.clock;
    expect(catchUp(s, from, from + 5 * 60_000)).toBe(null);
    expect(s.clock).toBe(from + 5 * 60_000);
    expect(catchUp(s, s.clock, s.clock - 1000)).toBe(null); // the clock never runs back
  });

  it("a visitor mid-path, the camera and a held tool carry on from where they were", () => {
    const s = createState(tank({ tier: 2, cam: -300 }), seeded(4));
    run(s, 2);
    s.nextVisit = 0;
    run(s, 1);
    const v = s.visit;
    const cam = s.cam.x;
    s.tool = "food";
    catchUp(s, s.clock, s.clock + HOUR);
    expect(s.visit).toBe(v);
    expect(s.cam.x).toBe(cam);
    expect(s.tool).toBe("food");
    run(s, 1); // and the first step back is a normal one
    expect(s.slots[0]).not.toBe(null);
  });
});
