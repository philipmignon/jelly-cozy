import { describe, expect, it } from "vitest";
import { CALM_FPS, QUIET_REDUCED_S, QUIET_S, createPacer, lively, readBatterySaver, wakes, writeBatterySaver } from "./pace";
import { createState, defaultSave, feed, flingCam, focusJelly, openShop, step, type SimEvent, type State } from "./sim";

/** A fake display: rAF callbacks run when the test advances time, at `hz`. */
function display(hz: number) {
  let t = 0;
  let next = 1;
  const cbs = new Map<number, (t: number) => void>();
  const rive = { draws: 0, stops: 0, drawFrame() { this.draws++; }, stopRendering() { this.stops++; } };
  let reduced = false;
  const env = {
    raf: (cb: (t: number) => void) => (cbs.set(next, cb), next++),
    caf: (id: number) => void cbs.delete(id),
    now: () => t,
    reduced: () => reduced,
  };
  const pacer = createPacer(rive, env);
  /** run `seconds` of display frames; returns frames drawn per second over them */
  const run = (seconds: number, each?: () => void) => {
    const d0 = rive.draws;
    const frames = Math.round(seconds * hz);
    for (let i = 0; i < frames; i++) {
      t += 1000 / hz;
      const due = [...cbs.entries()];
      cbs.clear();
      for (const [, cb] of due) cb(t);
      each?.();
    }
    return (rive.draws - d0) / seconds;
  };
  return { pacer, rive, run, setReduced: (on: boolean) => (reduced = on), pending: () => cbs.size };
}

const seeded = (seed = 1) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};
const tank = (tier = 0): State => createState({ ...defaultSave(Date.UTC(2026, 5, 1, 12)), tier }, seeded(3), { requests: false, keepsakes: false });
const settle = (s: State, seconds: number) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * 60; i++) events.push(...step(s, 1 / 60));
  return events;
};

describe("frame pacing", () => {
  it("draws every display frame while the player is active, and the calm rate once it's quiet", () => {
    const d = display(60);
    d.pacer.start();
    expect(d.run(1, () => d.pacer.wake())).toBe(60);
    d.run(QUIET_S); // goes quiet
    expect(d.pacer.calm).toBe(true);
    expect(d.run(2)).toBe(CALM_FPS);
  });

  it("is back to every frame on the next display frame after input", () => {
    const d = display(60);
    d.pacer.start();
    d.run(QUIET_S + 1);
    d.pacer.wake();
    const before = d.rive.draws;
    d.run(1 / 60);
    expect(d.rive.draws - before).toBe(1);
    expect(d.run(1)).toBe(60);
  });

  it("keeps the calm rate near 30 on faster displays", () => {
    for (const hz of [90, 120]) {
      const d = display(hz);
      d.pacer.start();
      d.run(QUIET_S + 1);
      expect(d.run(2)).toBe(CALM_FPS);
    }
  });

  it("stays awake while the tank is lively, whatever the input", () => {
    const d = display(60);
    const s = tank();
    settle(s, 5);
    expect(lively(s)).toBe(false);
    feed(s);
    d.pacer.start();
    expect(d.run(QUIET_S + 2, () => d.pacer.frame(s))).toBe(60);
  });

  it("goes calm sooner with reduce motion on, and the battery saver keeps the calm rate always", () => {
    const d = display(60);
    d.pacer.start();
    d.setReduced(true);
    d.run(QUIET_REDUCED_S + 0.1);
    expect(d.pacer.calm).toBe(true);
    d.setReduced(false);
    d.pacer.saver = true;
    expect(d.run(1, () => d.pacer.wake())).toBe(CALM_FPS);
  });

  it("draws nothing once stopped (a hidden tab), and picks up again on start", () => {
    const d = display(60);
    d.pacer.start();
    d.run(0.5);
    d.pacer.stop();
    expect(d.pending()).toBe(0);
    expect(d.run(2)).toBe(0);
    d.pacer.start();
    d.pacer.start(); // twice: still one loop
    expect(d.pending()).toBe(1);
    expect(d.run(1, () => d.pacer.wake())).toBe(60);
  });

  it("never leaves Rive's own loop scheduled: every display frame stops it, drawn or not", () => {
    const d = display(60);
    d.pacer.start();
    d.run(QUIET_S + 1);
    const stops = d.rive.stops;
    const draws = d.rive.draws;
    d.run(1);
    // one stop per display frame, plus one after each draw
    expect(d.rive.stops - stops).toBe(60 + (d.rive.draws - draws));
  });
});

describe("what keeps the tank lively", () => {
  it("is quiet when nothing moves fast, lively with food in the water, a fling, the shop sliding or the close-up easing", () => {
    const s = tank();
    settle(s, 3);
    expect(lively(s)).toBe(false);

    feed(s);
    expect(lively(s)).toBe(true);
    settle(s, 60); // eaten or dissolved
    expect(s.food.every((f) => f.state === "off")).toBe(true);

    openShop(s);
    expect(lively(s)).toBe(true);
    settle(s, 2);
    expect(lively(s)).toBe(false); // open and still

    const t = tank(2); // the large tank pans
    settle(t, 1);
    flingCam(t, -600);
    expect(t.cam.v).not.toBe(0);
    expect(lively(t)).toBe(true);

    const u = tank();
    settle(u, 1);
    focusJelly(u, u.slots.findIndex(Boolean));
    step(u, 1 / 60);
    expect(lively(u)).toBe(true);
    settle(u, 3);
    expect(lively(u)).toBe(false); // closed in and holding
  });

  it("v15: lively while the put-away drawer slides back down after a drop", () => {
    const s = tank();
    settle(s, 1);
    s.drawer.e = 0.6; // easing out, nothing carried
    expect(s.lifted).toBe(-1);
    expect(lively(s)).toBe(true);
    settle(s, 2);
    expect(s.drawer.e).toBe(0);
    expect(lively(s)).toBe(false);
  });

  it("only the bells' steady pulses don't count as something happening", () => {
    expect(wakes({ type: "pulse" })).toBe(false);
    expect(wakes({ type: "ate" })).toBe(true);
    expect(wakes({ type: "visitorArrived" })).toBe(true);
    // a quiet minute of an ordinary tank is all pulses (or nearly): the calm rate holds
    const s = tank();
    const woke = settle(s, 60).filter(wakes);
    expect(woke.length).toBeLessThanOrEqual(2);
  });
});

describe("the battery saver setting", () => {
  it("is off by default, kept when set, and off without storage", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readBatterySaver(store)).toBe(false);
    writeBatterySaver(store, true);
    expect(readBatterySaver(store)).toBe(true);
    writeBatterySaver(store, false);
    expect(readBatterySaver(store)).toBe(false);
    const broken = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readBatterySaver(broken)).toBe(false);
    expect(() => writeBatterySaver(broken, true)).not.toThrow();
    expect(readBatterySaver(null)).toBe(false);
  });
});
