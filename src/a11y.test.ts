import { describe, expect, it } from "vitest";
import { TRAIT_PHRASES } from "./traits";
import {
  REDUCE_MOTION_KEY,
  createAnnouncer,
  describeJelly,
  eventWords,
  focusOrder,
  isTyping,
  jellyKind,
  keyAction,
  nearestInDirection,
  readReducedMotion,
  stepFocus,
  writeReducedMotion,
  type KeyLike,
  type Target,
} from "./a11y";
import {
  K,
  camMoving,
  camTo,
  closeShop,
  createState,
  demoSave,
  flingCam,
  focusJelly,
  openShop,
  petJelly,
  setReducedMotion,
  shopY,
  step,
  tap,
  unfocus,
  view,
} from "./sim";

const canvas = { onCanvas: true, shopOpen: false };
const away = { onCanvas: false, shopOpen: false };
const shop = { onCanvas: true, shopOpen: true };
const k = (key: string, more: Partial<KeyLike> = {}): KeyLike => ({ key, ...more });

describe("key map", () => {
  it("letters work from anywhere; Tab, arrows, Enter and Space only on the tank", () => {
    expect(keyAction(k("f"), away)).toEqual({ kind: "feed" });
    expect(keyAction(k("F"), canvas)).toEqual({ kind: "feed" });
    expect(keyAction(k("s"), away)).toEqual({ kind: "scrub" });
    expect(keyAction(k("l"), away)).toEqual({ kind: "lamp" });
    expect(keyAction(k("b"), away)).toEqual({ kind: "shop" });
    expect(keyAction(k("j"), away)).toEqual({ kind: "journal" });
    expect(keyAction(k("n"), canvas)).toEqual({ kind: "card" });
    expect(keyAction(k("["), away)).toEqual({ kind: "pan", dir: -1 });
    expect(keyAction(k("]"), away)).toEqual({ kind: "pan", dir: 1 });
    expect(keyAction(k("1"), away)).toEqual({ kind: "hold", n: 0 });
    expect(keyAction(k("4"), away)).toEqual({ kind: "hold", n: 3 });
    expect(keyAction(k("5"), away)).toBeNull();
    expect(keyAction(k("Escape"), away)).toEqual({ kind: "escape" });

    expect(keyAction(k("Tab"), canvas)).toEqual({ kind: "next" });
    expect(keyAction(k("Tab", { shiftKey: true }), canvas)).toEqual({ kind: "prev" });
    expect(keyAction(k("ArrowLeft"), canvas)).toEqual({ kind: "move", dx: -1, dy: 0 });
    expect(keyAction(k("ArrowDown"), canvas)).toEqual({ kind: "move", dx: 0, dy: 1 });
    expect(keyAction(k("Enter"), canvas)).toEqual({ kind: "activate" });
    expect(keyAction(k(" "), canvas)).toEqual({ kind: "activate" });
    expect(keyAction(k("Enter", { shiftKey: true }), canvas)).toEqual({ kind: "card" });
    // off the tank they're the focused control's
    for (const key of ["Tab", "ArrowLeft", "Enter", " "]) expect(keyAction(k(key), away)).toBeNull();
  });

  it("leaves M (mute) to the menu and anything with Ctrl, Cmd or Alt to the browser", () => {
    expect(keyAction(k("m"), canvas)).toBeNull();
    expect(keyAction(k("M"), away)).toBeNull();
    expect(keyAction(k("f", { ctrlKey: true }), canvas)).toBeNull();
    expect(keyAction(k("j", { metaKey: true }), canvas)).toBeNull();
    expect(keyAction(k("Tab", { altKey: true }), canvas)).toBeNull();
  });

  it("with the shop open: arrows, Tab and Enter walk and buy the cards; B and Escape close it", () => {
    expect(keyAction(k("ArrowRight"), shop)).toEqual({ kind: "shopMove", dx: 1, dy: 0 });
    expect(keyAction(k("ArrowUp"), shop)).toEqual({ kind: "shopMove", dx: 0, dy: -1 });
    expect(keyAction(k("Tab"), shop)).toEqual({ kind: "shopStep", d: 1 });
    expect(keyAction(k("Tab", { shiftKey: true }), shop)).toEqual({ kind: "shopStep", d: -1 });
    expect(keyAction(k("PageDown"), shop)).toEqual({ kind: "shopTab", d: 1 });
    expect(keyAction(k("Enter"), shop)).toEqual({ kind: "buy" });
    expect(keyAction(k(" "), shop)).toEqual({ kind: "buy" });
    expect(keyAction(k("Escape"), shop)).toEqual({ kind: "shop" });
    expect(keyAction(k("b"), { onCanvas: false, shopOpen: true })).toEqual({ kind: "shop" });
    // the tank's own letters wait while it's up
    for (const key of ["f", "s", "l", "j", "[", "1"]) expect(keyAction(k(key), shop)).toBeNull();
    expect(keyAction(k("Enter"), { onCanvas: false, shopOpen: true })).toBeNull();
  });

  it("never takes keys from a text field", () => {
    expect(isTyping({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: "textarea" } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: "CANVAS" } as unknown as EventTarget)).toBe(false);
    expect(isTyping({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("focus order", () => {
  const order = focusOrder({
    jellies: [
      { slot: 2, x: 900 },
      { slot: 0, x: 360 },
      { slot: 5, x: 120 },
    ],
    pearl: true,
    visitor: true,
    buttons: [
      { name: "shop", x: 558 },
      { name: "lamp", x: 12 },
      { name: "feed", x: 102 },
      { name: "clean", x: 414 },
    ],
  });

  it("walks the jellies left to right, then the pearl, a visitor and the shelf left to right", () => {
    expect(order).toEqual([
      { kind: "jelly", slot: 5 },
      { kind: "jelly", slot: 0 },
      { kind: "jelly", slot: 2 },
      { kind: "pearl" },
      { kind: "visitor" },
      { kind: "button", name: "lamp" },
      { kind: "button", name: "feed" },
      { kind: "button", name: "clean" },
      { kind: "button", name: "shop" },
    ]);
    expect(focusOrder({ jellies: [], pearl: false, visitor: false, buttons: [] })).toEqual([]);
  });

  it("Tab steps on and off the ends (the page's next control takes over); a lost target starts over", () => {
    expect(stepFocus(order, null, 1)).toEqual({ kind: "jelly", slot: 5 });
    expect(stepFocus(order, null, -1)).toEqual({ kind: "button", name: "shop" });
    expect(stepFocus(order, { kind: "jelly", slot: 0 }, 1)).toEqual({ kind: "jelly", slot: 2 });
    expect(stepFocus(order, { kind: "jelly", slot: 2 }, 1)).toEqual({ kind: "pearl" });
    expect(stepFocus(order, { kind: "pearl" }, -1)).toEqual({ kind: "jelly", slot: 2 });
    expect(stepFocus(order, { kind: "button", name: "shop" }, 1)).toBeNull();
    expect(stepFocus(order, { kind: "jelly", slot: 5 }, -1)).toBeNull();
    expect(stepFocus(order, { kind: "jelly", slot: 6 } as Target, 1)).toEqual({ kind: "jelly", slot: 5 });
    expect(stepFocus([], null, 1)).toBeNull();
  });

  it("arrows go to the nearest thing that way, favouring what's in line", () => {
    const pts = [
      { x: 100, y: 500 }, // 0: here
      { x: 300, y: 520 }, // 1: right, in line
      { x: 220, y: 900 }, // 2: right but far below
      { x: 100, y: 200 }, // 3: straight up
      { x: -50, y: 480 }, // 4: left
    ];
    expect(nearestInDirection(pts[0]!, pts, 1, 0, 0)).toBe(1);
    expect(nearestInDirection(pts[0]!, pts, 0, -1, 0)).toBe(3);
    expect(nearestInDirection(pts[0]!, pts, -1, 0, 0)).toBe(4);
    expect(nearestInDirection(pts[0]!, pts, 0, 1, 0)).toBe(2);
    expect(nearestInDirection(pts[4]!, pts, -1, 0, 4)).toBe(-1);
    // a point that isn't on screen (NaN) is never picked
    expect(nearestInDirection({ x: 0, y: 0 }, [{ x: NaN, y: NaN }], 1, 0)).toBe(-1);
  });
});

describe("words", () => {
  it("describes a jelly from what jellyInfo gives, with a personality when it has one", () => {
    expect(describeJelly({ name: "Muffin", k: 0, g: 2, fullness: 0.9, mood: 0.8, morph: 0 })).toBe("Muffin, juvenile moon jelly, full, happy");
    expect(describeJelly({ name: "Bloop", k: 0, g: 0, fullness: 0.1, mood: 0.2, morph: 1 })).toBe("Bloop, moon jelly polyp, rare colour, very hungry, glum");
    expect(describeJelly({ name: "Pip", k: 3, g: 3, fullness: 0.5, mood: 0.5, trait: "Shy" })).toBe("Pip, adult comb jelly, fed, content, shy");
    expect(describeJelly({ name: "Pip", k: 8, g: 1, fullness: 0.3, mood: 0.5, personality: "greedy" })).toBe("Pip, baby lion's mane, hungry, content, greedy");
    expect(jellyKind(1, 3)).toBe("adult blue blubber");
  });

  it("says the moments worth hearing, and marks meals as low", () => {
    const jelly = (slot: number) => (slot === 1 ? { name: "Muffin", k: 0, g: 2 } : slot === 2 ? { name: "Egg", k: 4, g: 3 } : null);
    expect(eventWords({ type: "ate", slot: 1 }, jelly)).toEqual({ text: "Muffin ate.", low: true });
    expect(eventWords({ type: "grew", slot: 1, stage: 2 }, jelly)).toEqual({ text: "Muffin grew into a juvenile moon jelly.", low: false });
    expect(eventWords({ type: "grew", slot: 2, stage: 3 }, jelly)?.text).toBe("Egg grew into an adult fried egg jelly.");
    expect(eventWords({ type: "pearlReady" }, jelly)?.text).toBe("The pearl is ready.");
    expect(eventWords({ type: "visitorArrived", kind: "turtle" }, jelly)?.text).toBe("A turtle is visiting.");
    expect(eventWords({ type: "requestDone", request: 0, amount: 5 } as never, jelly)?.text).toBe("Request done: +5 sand dollars.");
    expect(eventWords({ type: "themed", theme: 1 }, jelly, (n) => ["Reef", "Kelp Forest"][n] ?? "")?.text).toBe("Kelp Forest theme on.");
    for (const type of ["pulse", "earned", "cleaned", "adult", "rehomed"]) expect(eventWords({ type, slot: 1 }, jelly)).toBeNull();
    expect(eventWords({ type: "ate", slot: 9 }, jelly)).toBeNull();
  });

  it("v13: keepsake unlocks, rides you could see, and a jelly's personality as its card says it", () => {
    const jelly = (slot: number) => (slot === 1 ? { name: "Muffin", k: 0, g: 3 } : null);
    expect(eventWords({ type: "keepsake", keepsake: 1 }, jelly)).toEqual({ text: "A little lighthouse washed up for you.", low: false });
    expect(eventWords({ type: "keepsake", keepsake: 0 }, jelly)?.text).toBe("A message in a bottle drifted down for you.");
    expect(eventWords({ type: "keepsake", keepsake: 99 }, jelly)).toBeNull();
    expect(eventWords({ type: "rode", slot: 1, seen: true }, jelly)).toEqual({ text: "Muffin rode the bubbler.", low: true });
    expect(eventWords({ type: "rode", slot: 1, seen: false }, jelly)).toBeNull();
    expect(eventWords({ type: "rode", slot: 1 }, jelly)).toBeNull();
    expect(describeJelly({ name: "Muffin", k: 0, g: 3, fullness: 0.9, mood: 0.8, trait: TRAIT_PHRASES[0] })).toBe("Muffin, adult moon jelly, full, happy, shy — hides by the rocks");
  });
});

describe("the announcer", () => {
  const make = (o: { gapMs?: number; lowGapMs?: number } = {}) => {
    let now = 0;
    const said: string[] = [];
    const a = createAnnouncer({ now: () => now, write: (t) => said.push(t), ...o });
    return { a, said, at: (t: number) => (now = t) };
  };

  it("speaks straight away, then no more often than the gap, batching what waited", () => {
    const { a, said, at } = make({ gapMs: 2000 });
    a.say("The pearl is ready.");
    expect(said).toEqual(["The pearl is ready."]);
    at(500);
    a.say("A turtle is visiting.");
    a.say("A turtle is visiting.");
    a.say("Request done: +5 sand dollars.");
    a.flush();
    expect(said.length).toBe(1);
    at(2100);
    a.flush();
    expect(said[1]).toBe("A turtle is visiting. Request done: +5 sand dollars.");
    at(9000);
    a.flush();
    expect(said.length).toBe(2);
  });

  it("drops low lines (meals) unless it's been quiet, and caps a burst", () => {
    const { a, said, at } = make({ gapMs: 1000, lowGapMs: 10_000 });
    a.say("Muffin ate.", true);
    expect(said).toEqual(["Muffin ate."]);
    at(1500);
    a.say("Bloop ate.", true); // a meal 1.5 s after the last: dropped
    a.flush();
    expect(said.length).toBe(1);
    at(12_000);
    a.say("Bloop ate.", true);
    expect(said.at(-1)).toBe("Bloop ate.");
    at(12_100);
    for (const t of ["One.", "Two.", "Three.", "Four.", "Five."]) a.say(t);
    a.say("Pip ate.", true); // something is waiting: no meal
    at(13_200);
    a.flush();
    expect(said.at(-1)).toBe("One. Two. Three.");
  });
});

describe("reduce motion setting", () => {
  const store = (v: string | null, throws = false) => ({
    getItem: (key: string) => {
      if (throws) throw new Error("denied");
      return key === REDUCE_MOTION_KEY ? v : null;
    },
  });
  it("is the saved choice, else the OS's", () => {
    expect(readReducedMotion(store("1"), false)).toBe(true);
    expect(readReducedMotion(store("0"), true)).toBe(false);
    expect(readReducedMotion(store(null), true)).toBe(true);
    expect(readReducedMotion(store(null), false)).toBe(false);
    expect(readReducedMotion(store("1", true), false)).toBe(false);
    expect(readReducedMotion(null, true)).toBe(true);
    const saved = new Map<string, string>();
    writeReducedMotion({ setItem: (key, v) => void saved.set(key, v) }, true);
    expect(saved.get(REDUCE_MOTION_KEY)).toBe("1");
    expect(() =>
      writeReducedMotion(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        false,
      ),
    ).not.toThrow();
  });
});

describe("the sim with reduce motion", () => {
  const NOW = Date.UTC(2026, 9, 2, 12);
  const wide = () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return createState({ ...demoSave(NOW), tier: 2 }, rand);
  };
  const run = (s: ReturnType<typeof wide>, sec: number) => {
    for (let t = 0; t < sec; t += 1 / 60) step(s, 1 / 60);
  };

  it("jumps the camera instead of easing or flinging", () => {
    const s = wide();
    setReducedMotion(s, true);
    expect(s.reducedMotion).toBe(true);
    camTo(s, 1000);
    expect(camMoving(s)).toBe(false);
    expect(s.cam.x).toBe(360 - 1000);
    flingCam(s, -3000);
    expect(camMoving(s)).toBe(false);
    // switching it on mid-ease lands the move
    const t = wide();
    camTo(t, 1000);
    expect(camMoving(t)).toBe(true);
    setReducedMotion(t, true);
    expect(camMoving(t)).toBe(false);
    expect(t.cam.x).toBe(360 - 1000);
  });

  it("snaps the shop and the card's close-up", () => {
    const s = wide();
    setReducedMotion(s, true);
    openShop(s);
    expect(shopY(s)).toBe(0);
    closeShop(s);
    expect(shopY(s)).toBeGreaterThan(1000);
    focusJelly(s, 0);
    step(s, 1 / 60);
    expect(s.focus.e).toBe(1);
    unfocus(s);
    step(s, 1 / 60);
    expect(s.focus.e).toBe(0);
  });

  it("pulses gentler: no swell, peak squeeze or overshoot frame, and a petted jelly doesn't shimmy", () => {
    const s = wide();
    setReducedMotion(s, true);
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      step(s, 1 / 60);
      const v = view(s);
      for (let f = 0; f < 8; f++) if (v[`j0bf${f}`] === 1) seen.add(f);
    }
    expect([...seen].some((f) => f === 1 || f === 4 || f === 6)).toBe(false);
    expect(seen.size).toBeGreaterThan(1);
    const x0 = view(s).j0x;
    expect(petJelly(s, 0)).toBe(true);
    for (let i = 0; i < 6; i++) {
      step(s, 1 / 60);
      expect(Math.abs((view(s).j0x ?? 0) - (x0 ?? 0))).toBeLessThan(6);
    }
  });

  it("is off by default; petJelly is tap's pet", () => {
    const s = wide();
    expect(s.reducedMotion).toBe(false);
    camTo(s, 1000);
    expect(camMoving(s)).toBe(true);
    expect(petJelly(s, 6)).toBe(false);
    const j = s.slots[0]!;
    const a0 = j.affection;
    expect(petJelly(s, 0)).toBe(true);
    expect(j.affection).toBeGreaterThan(a0);
    run(s, 0.1);
    // and a tap on the body still pets
    const a1 = j.affection;
    const c = { x: j.x, y: j.y - 30 };
    expect(tap(s, c.x, c.y)).toBe("pet");
    expect(j.affection).toBeGreaterThan(a1);
    expect(K.W).toBe(720);
  });
});
