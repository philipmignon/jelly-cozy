/**
 * Test mode (src/testmode.ts) and the sim hooks the test API stands on: ?seed=N seeds every stream the sim draws
 * from, and arriveVisitor brings a chosen visitor in.
 */
import { describe, expect, it } from "vitest";
import { VIRTUAL_EPOCH, testQuery } from "./testmode";
import { rng } from "./dirt";
import { arriveVisitor, createState, defaultSave, step, toggleLamp, visitorInfo } from "./sim";
import { VISITORS } from "./visitors";

const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();

describe("testQuery", () => {
  it("is null in normal play", () => {
    expect(testQuery("")).toBeNull();
    expect(testQuery("?fast=1&season=halloween")).toBeNull();
    expect(testQuery("?test=0")).toBeNull();
    expect(testQuery("?seed=")).toBeNull();
    expect(testQuery("?seed=abc")).toBeNull();
  });
  it("reads test=1, a seed, the virtual clock and its start", () => {
    expect(testQuery("?test=1")).toEqual({ seed: null, virtual: false, now: null });
    expect(testQuery("?seed=42")).toEqual({ seed: 42, virtual: false, now: null });
    expect(testQuery("?clock=virtual&now=1700000000000")).toEqual({ seed: null, virtual: true, now: 1700000000000 });
    expect(testQuery("?test=1&now=2026-06-15T12:00:00Z")?.now).toBe(Date.parse("2026-06-15T12:00:00Z"));
    expect(testQuery("?test=1&now=never")?.now).toBeNull();
  });
  it("starts the virtual clock on a June noon", () => {
    const d = new Date(VIRTUAL_EPOCH);
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([5, 15, 12]);
  });
});

describe("a seeded tank", () => {
  /** a seeded tank loaded at `lastSeen`: when its first visitor and spot are due, and its streams' first draws */
  const run = (seed: number, lastSeen: number) => {
    const s = createState({ ...defaultSave(NOON), lastSeen }, rng(seed), { seed });
    return { first: { nextVisit: s.nextVisit, nextSpot: s.nextSpot, trait: s.traitRand(), dirt: s.dirtRand(), rand: s.rand() } };
  };
  it("plays out the same whenever it is loaded", () => {
    const a = run(7, NOON);
    const b = run(7, NOON + 3_456_789); // a different load time: the clock no longer seeds the dirt or the traits
    expect(b.first).toEqual(a.first);
  });
  it("and differently for another seed", () => {
    expect(run(8, NOON).first).not.toEqual(run(7, NOON).first);
  });
  it("leaves unseeded tanks as they were (the clock seeds the dirt)", () => {
    const s1 = createState({ ...defaultSave(NOON) }, rng(1));
    const s2 = createState({ ...defaultSave(NOON) }, rng(1));
    expect(s1.nextSpot).toBe(s2.nextSpot);
    const s3 = createState({ ...defaultSave(NOON), lastSeen: NOON + 5000 }, rng(1));
    expect(s3.nextSpot).not.toBe(s1.nextSpot);
  });
});

describe("arriveVisitor", () => {
  it("brings the chosen visitor in, noted in the log, its arrival queued for the next step", () => {
    const s = createState(defaultSave(NOON), rng(3));
    expect(arriveVisitor(s, VISITORS.indexOf("turtle"))).toBe(true);
    expect(visitorInfo(s)?.kind).toBe("turtle");
    expect(s.visitorsSeen.turtle?.n).toBe(1);
    const events = step(s, 1 / 30);
    expect(events.some((e) => e.type === "visitorArrived" && e.kind === "turtle")).toBe(true);
  });
  it("refuses a kind that doesn't exist", () => {
    const s = createState(defaultSave(NOON), rng(3));
    expect(arriveVisitor(s, -1)).toBe(false);
    expect(arriveVisitor(s, VISITORS.length)).toBe(false);
    expect(s.visit).toBeNull();
  });
  it("lets a night visitor come at night, and the light sends it away", () => {
    const s = createState(defaultSave(NOON), rng(3));
    toggleLamp(s); // night by the switch
    step(s, 1 / 30);
    expect(arriveVisitor(s, VISITORS.indexOf("octopus"))).toBe(true);
    toggleLamp(s);
    let left = false;
    for (let i = 0; i < 30 * 60 && !left; i++) left = step(s, 1 / 30).some((e) => e.type === "visitorLeft");
    expect(left).toBe(true);
  });
});
