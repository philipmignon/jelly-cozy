import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_MS, attachGestures, coalesced, type GestureHandlers } from "./gestures";

// A canvas and window that only dispatch events; positions are artboard = client.
type Ptr = { pointerId: number; clientX: number; clientY: number; timeStamp: number; preventDefault(): void; getCoalescedEvents?: () => { clientX: number; clientY: number }[] };
const ptr = (x: number, y: number, extra: Partial<Ptr> = {}): Ptr => ({ pointerId: 1, clientX: x, clientY: y, timeStamp: 0, preventDefault() {}, ...extra });

function setup(over: Partial<GestureHandlers> = {}) {
  const canvas = new EventTarget();
  const calls: string[] = [];
  const h: GestureHandlers = {
    tap: (x, y) => calls.push(`tap ${x},${y}`),
    longPress: (x, y) => (calls.push(`long ${x},${y}`), false),
    drag: () => calls.push("drag"),
    drop: () => calls.push("drop"),
    pan: (dx) => calls.push(`pan ${dx}`),
    ...over,
  };
  attachGestures(canvas as unknown as HTMLCanvasElement, (x, y) => ({ x, y }), h);
  const fire = (target: EventTarget, type: string, e: Ptr) => {
    const ev = new Event(type);
    for (const [k, v] of Object.entries(e)) Object.defineProperty(ev, k, { value: v });
    return target.dispatchEvent(ev);
  };
  return { canvas, calls, down: (e: Ptr) => fire(canvas, "pointerdown", e), move: (e: Ptr) => fire(window as unknown as EventTarget, "pointermove", e), up: (e: Ptr) => fire(window as unknown as EventTarget, "pointerup", e) };
}

describe("gestures", () => {
  let frames: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => frames.push(fn));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => (frames[id - 1] = () => {}));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const frame = () => frames.splice(0).forEach((f) => f());

  it("holding still is a long-press, decided at the next frame", () => {
    const g = setup();
    g.down(ptr(10, 20));
    vi.advanceTimersByTime(LONG_MS + 1);
    expect(g.calls).toEqual([]);
    frame();
    expect(g.calls).toEqual(["long 10,20"]);
  });

  it("a slow frame: a swipe whose moves arrive after LONG_MS is still a swipe, not a long-press", () => {
    const g = setup();
    g.down(ptr(100, 100));
    vi.advanceTimersByTime(LONG_MS + 200); // the main thread was busy; the moves were waiting for the frame
    g.move(ptr(160, 102));
    frame();
    g.up(ptr(160, 102));
    expect(g.calls.some((c) => c.startsWith("long"))).toBe(false);
    expect(g.calls[0]).toBe("pan 60");
  });

  it("a slow frame: a lift that arrives after LONG_MS is still a tap", () => {
    const g = setup();
    g.down(ptr(5, 6));
    vi.advanceTimersByTime(LONG_MS + 200);
    g.up(ptr(5, 6));
    frame();
    expect(g.calls).toEqual(["tap 5,6"]);
  });

  it("a held tool follows every coalesced position", () => {
    const seen: string[] = [];
    const g = setup({ toolDown: () => true, toolMove: (x, y) => void seen.push(`${x},${y}`) });
    g.down(ptr(0, 0));
    g.move(ptr(30, 0, { getCoalescedEvents: () => [{ clientX: 10, clientY: 0 }, { clientX: 20, clientY: 5 }, { clientX: 30, clientY: 0 }] }));
    expect(seen).toEqual(["10,0", "20,5", "30,0"]);
  });
});

describe("coalesced", () => {
  it("falls back to the event itself", () => {
    expect(coalesced({ clientX: 1, clientY: 2 })).toEqual([{ clientX: 1, clientY: 2 }]);
    expect(coalesced({ clientX: 1, clientY: 2, getCoalescedEvents: () => [] })).toEqual([{ clientX: 1, clientY: 2, getCoalescedEvents: expect.any(Function) }]);
  });
});
