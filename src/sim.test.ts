import { describe, expect, it } from "vitest";
import { applyAway, clean, createState, defaultSave, feed, step, tap, toggleLamp, view } from "./sim";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const run = (s: ReturnType<typeof createState>, seconds: number) => {
  const events: string[] = [];
  for (let i = 0; i < seconds * 60; i++) events.push(...step(s, 1 / 60));
  return events;
};

describe("tank sim", () => {
  it("writes every view property the .riv declares", () => {
    const s = createState(defaultSave(), seeded());
    const v = view(s);
    const props = Object.keys(v);
    for (const name of ["jx", "jy", "bf0", "tf3", "food9o", "rf2", "barMood", "b2y", "glow", "algae2"]) {
      expect(props).toContain(name);
    }
  });

  it("the jelly stays inside the tank for ten minutes", () => {
    const s = createState(defaultSave(), seeded(3));
    for (let i = 0; i < 600 * 60; i++) {
      step(s, 1 / 60);
      expect(s.jx).toBeGreaterThan(8);
      expect(s.jx).toBeLessThan(136);
      expect(s.jy).toBeGreaterThan(20);
      expect(s.jy).toBeLessThan(180);
    }
  });

  it("dropped food gets eaten", () => {
    const s = createState({ ...defaultSave(), fullness: 0.2 }, seeded(5));
    expect(feed(s)).toBe(4);
    const events = run(s, 60);
    const ate = events.filter((e) => e === "ate").length;
    expect(ate).toBeGreaterThanOrEqual(3);
    expect(s.fullness).toBeGreaterThan(0.45);
  });

  it("cleaning clears the murk", () => {
    const s = createState({ ...defaultSave(), murk: 0.9 }, seeded());
    clean(s);
    expect(run(s, 2)).toContain("cleaned");
    expect(s.murk).toBeLessThan(0.01);
  });

  it("petting the bell raises affection", () => {
    const s = createState(defaultSave(), seeded());
    const before = s.affection;
    expect(tap(s, s.jx, s.jy - 8)).toBe("pet");
    expect(s.affection).toBeGreaterThan(before);
  });

  it("petting sets off a wiggle that settles", () => {
    const s = createState(defaultSave(), seeded());
    tap(s, s.jx, s.jy - 8);
    const frames = new Set<string>();
    const xs = new Set<number>();
    for (let i = 0; i < 34; i++) {
      step(s, 1 / 60);
      const v = view(s);
      frames.add([0, 1, 2, 3].map((k) => v[`bf${k}`]).join(""));
      xs.add((v.jx ?? 0) - Math.round(s.jx) * 5);
    }
    expect(frames.size).toBeGreaterThanOrEqual(3);
    expect(xs).toEqual(new Set([-5, 5]));
    expect(view(s).flush).toBeGreaterThan(0);
    run(s, 1);
    expect((view(s).jx ?? 0) - Math.round(s.jx) * 5).toBe(0);
    expect(view(s).flush).toBe(0);
  });

  it("eating sets off a wiggle", () => {
    const s = createState({ ...defaultSave(), fullness: 0.2 }, seeded(5));
    feed(s);
    let t = 0;
    while (!step(s, 1 / 60).includes("ate") && t++ < 3600);
    expect(s.wiggleT0).toBeCloseTo(s.t);
  });

  it("the lamp fades to night and back", () => {
    const s = createState(defaultSave(), seeded());
    toggleLamp(s);
    run(s, 2);
    expect(view(s).daylight).toBe(0);
    expect(view(s).moonO).toBe(1);
    toggleLamp(s);
    run(s, 2);
    expect(view(s).daylight).toBe(1);
  });

  it("time away never starves it", () => {
    const save = applyAway({ ...defaultSave(), fullness: 0.9, lastSeen: 0 }, 1000 * 3600 * 24 * 30);
    expect(save.fullness).toBeCloseTo(0.1);
    expect(save.murk).toBeLessThanOrEqual(0.8);
  });
});
