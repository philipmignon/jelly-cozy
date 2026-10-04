/**
 * Property tests for daily requests and keepsakes (fast-check): under any stream of deeds, days and time away,
 * progress never passes its target, a request pays once, a milestone is granted once.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { advance, planRequests, rewardOf, REQUEST_KINDS, type Deed, type DailyRequests } from "./requests";
import { MILESTONES, countDay, isEarned, keepOf, newlyReached, progressOf, type KeepFacts } from "./keepsakes";
import {
  catchUp,
  createState,
  dayKey,
  keepsakes,
  keepsakesAtLoad,
  loadGame,
  pearlCentre,
  petJelly,
  requests,
  scrubAt,
  sprinkle,
  spots,
  step,
  tap,
  visitorInfo,
  DECOR,
  type SimEvent,
  type State,
} from "./sim";
import { FOOD_KINDS, MAX_DOLLARS, SPECIES_N, type FoodKind, type Species } from "./species";

// one fixed seed, so CI never flakes; FC_SEED=<n> replays another, FC_SEED=random explores
if (process.env.FC_SEED !== "random") fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 20261003) });
/** FC_SCALE=10 runs every property ten times as long */
const runs = (n: number) => Math.round(n * Number(process.env.FC_SCALE ?? 1));

const NOW = new Date(2026, 9, 3, 9, 0).getTime();

// ---------------------------------------------------------------- requests (pure)

const deedArb: fc.Arbitrary<Deed> = fc.oneof(
  fc.record({ kind: fc.constant("ate" as const), k: fc.integer({ min: 0, max: SPECIES_N - 1 }).map((k) => k as Species), food: fc.integer({ min: 0, max: FOOD_KINDS - 1 }).map((f) => f as FoodKind) }),
  fc.record({ kind: fc.constant("sprinkle" as const), decor: fc.integer({ min: 0, max: 10 }), n: fc.integer({ min: 1, max: 3 }) }),
  fc.constantFrom<Deed>({ kind: "scrub" }, { kind: "pet" }, { kind: "pearl" }, { kind: "visitor" }, { kind: "ride" }, { kind: "night" }),
);
const tankArb = fc.record({
  species: fc.array(fc.integer({ min: 0, max: SPECIES_N - 1 }).map((k) => k as Species), { maxLength: 7 }),
  foods: fc.tuple(fc.constant(true), fc.boolean(), fc.boolean()),
  decor: fc.array(fc.boolean(), { minLength: 11, maxLength: 11 }),
  pearl: fc.boolean(),
  bubbler: fc.boolean(),
  night: fc.boolean(),
});
const dayArb = fc.integer({ min: 0, max: 3000 }).map((d) => dayKey(new Date(2024, 0, 1 + d, 12).getTime()));

describe("daily requests under any stream of deeds", () => {
  it("progress stays within 0..n, done exactly when it gets there, each request pays once, finished ones never move", () => {
    fc.assert(
      fc.property(dayArb, tankArb, fc.array(deedArb, { maxLength: 80 }), (day, tank, deeds) => {
        const plan: DailyRequests = planRequests(day, tank);
        const paid = new Set<number>();
        let total = 0;
        for (const d of deeds) {
          const before = plan.items.map((r) => ({ ...r }));
          for (const i of advance(plan, d)) {
            expect(paid.has(i)).toBe(false);
            paid.add(i);
            total += rewardOf(plan.items[i]!);
          }
          plan.items.forEach((r, i) => {
            expect(r.progress).toBeGreaterThanOrEqual(before[i]!.progress);
            expect(r.progress).toBeLessThanOrEqual(r.n);
            expect(r.done).toBe(r.progress >= r.n);
            if (before[i]!.done) expect(r).toEqual(before[i]);
          });
        }
        expect(paid).toEqual(new Set(plan.items.flatMap((r, i) => (r.done ? [i] : []))));
        expect(total).toBe(plan.items.filter((r) => r.done).reduce((a, r) => a + rewardOf(r), 0));
        for (const r of plan.items) expect(REQUEST_KINDS).toContain(r.kind);
      }),
      { numRuns: runs(300) },
    );
  });
});

// ---------------------------------------------------------------- keepsakes (pure)

// (never NaN: keepFacts sums integers that keepOf and journalOf already made finite)
const count = fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constantFrom(-1, 1e9, Infinity, -Infinity, 0.5));
const factsArb: fc.Arbitrary<KeepFacts> = fc.record({ adults: count, kinds: count, morphs: count, days: count, requests: count });

describe("keepsakes under any facts", () => {
  it("progress is always 0..n, and a milestone is granted once, however the facts come and go", () => {
    fc.assert(
      fc.property(fc.array(factsArb, { minLength: 1, maxLength: 30 }), fc.integer({ min: 0, max: 63 }), (facts, earned0) => {
        const keep = keepOf({ earned: earned0, days: 0, lastDay: "", requests: 0 })!;
        const granted = new Set<number>();
        for (const f of facts) {
          MILESTONES.forEach((ms, m) => {
            const p = progressOf(m, f);
            expect(Number.isInteger(p)).toBe(true);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(ms.n);
          });
          for (const m of newlyReached(keep, f)) {
            expect(isEarned(keep, m)).toBe(false);
            expect(granted.has(m)).toBe(false);
            granted.add(m);
            keep.earned |= 1 << m;
          }
        }
        for (const m of granted) expect(earned0 & (1 << m)).toBe(0);
      }),
      { numRuns: runs(300) },
    );
  });

  it("days played count each distinct day once, only going forward, whatever order the clock shows them in", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(dayArb, fc.constantFrom("", "2026-13-99x", "garbage")), { maxLength: 40 }), (days) => {
        const keep = keepOf({})!;
        let last = "";
        let n = 0;
        for (const d of days) {
          const counted = countDay(keep, d);
          const should = /^\d{4}-\d{2}-\d{2}$/.test(d) && d > last;
          expect(counted).toBe(should);
          if (should) {
            last = d;
            n++;
          }
          expect(keep.days).toBe(n);
          expect(keep.lastDay).toBe(last);
        }
        expect(keep.days).toBeLessThanOrEqual(new Set(days).size);
      }),
      { numRuns: runs(300) },
    );
  });
});

// ---------------------------------------------------------------- in the tank

type Act =
  | { t: "step"; dt: number; n: number }
  | { t: "pet"; times: number }
  | { t: "pearl" }
  | { t: "sprinkle"; decor: number; kind: FoodKind; times: number }
  | { t: "scrub" }
  | { t: "visitor" }
  | { t: "away"; ms: number };
const actArb: fc.Arbitrary<Act> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ t: fc.constant("step" as const), dt: fc.constantFrom(1 / 60, 1 / 30, 0.1), n: fc.integer({ min: 1, max: 120 }) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("pet" as const), times: fc.integer({ min: 1, max: 4 }) }) },
  { weight: 1, arbitrary: fc.constant({ t: "pearl" as const }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("sprinkle" as const), decor: fc.integer({ min: 0, max: 10 }), kind: fc.integer({ min: 0, max: 2 }).map((k) => k as FoodKind), times: fc.integer({ min: 1, max: 10 }) }) },
  { weight: 1, arbitrary: fc.constant({ t: "scrub" as const }) },
  { weight: 1, arbitrary: fc.constant({ t: "visitor" as const }) },
  // time away (a hidden tab or a night's sleep): a minute up to two days
  { weight: 1, arbitrary: fc.record({ t: fc.constant("away" as const), ms: fc.integer({ min: 60_000, max: 2 * 864e5 }) }) },
);
const saveArb = fc.record({
  tier: fc.integer({ min: 0, max: 2 }),
  slots: fc.array(fc.option(fc.record({ k: fc.integer({ min: 0, max: 8 }), g: fc.integer({ min: 1, max: 3 }), name: fc.constantFrom("Mochi", "Bloop", "Puff", "Boba") }), { nil: null }), { minLength: 1, maxLength: 7 }),
  owned: fc.array(fc.boolean(), { minLength: 11, maxLength: 11 }).map((o) => o.map((x, n) => x || n === 3)),
  foods: fc.constant([true, true, true]),
  dollars: fc.integer({ min: 0, max: MAX_DOLLARS }),
  journal: fc.array(fc.record({ raised: fc.integer({ min: 0, max: 3 }), seen: fc.constant(true) }), { minLength: 9, maxLength: 9 }),
  keep: fc.option(fc.record({ earned: fc.integer({ min: 0, max: 63 }), days: fc.integer({ min: 0, max: 8 }), lastDay: fc.constant("2026-10-02"), requests: fc.integer({ min: 0, max: 11 }) }), { nil: undefined }),
  lastSeen: fc.integer({ min: NOW - 864e5, max: NOW + 864e5 }),
});

function act(s: State, a: Act, out: SimEvent[]): void {
  switch (a.t) {
    case "step":
      for (let i = 0; i < a.n; i++) out.push(...step(s, a.dt));
      return;
    case "pet":
      for (let i = 0; i < a.times; i++) s.slots.forEach((j, slot) => j && petJelly(s, slot));
      return;
    case "pearl": {
      const p = pearlCentre(s);
      tap(s, p.x, p.y);
      return;
    }
    case "sprinkle":
      // a pinch at a time by a decoration, the way a player sprinkles, with the jellies eating in between
      for (let i = 0; i < a.times; i++) {
        sprinkle(s, s.decorX[a.decor] ?? DECOR[a.decor]!.x, 600, a.kind);
        out.push(...step(s, 0.35));
      }
      return;
    case "scrub":
      for (const sp of spots(s)) for (let i = 0; i < 12; i++) scrubAt(s, sp.x, sp.y, 160);
      return;
    case "visitor": {
      const v = visitorInfo(s);
      if (v) tap(s, v.x, v.y);
      return;
    }
    case "away":
      catchUp(s, s.clock, s.clock + a.ms);
      return;
  }
}

describe("requests and keepsakes in a running tank", () => {
  /** per run: requests paid, days seen, milestones granted */
  const coverage: number[][] = [];
  it("over days of random play and time away: progress within targets, each request and milestone paid once", () => {
    fc.assert(
      fc.property(saveArb, fc.array(actArb, { minLength: 20, maxLength: 80 }), (raw, acts) => {
        const now = raw.lastSeen;
        const s = createState(loadGame(JSON.stringify({ v: 12, ...raw }), now).save, () => 0.4, { requests: true, keepsakes: true });
        const atLoad = new Set(keepsakesAtLoad(s));
        const earnedAtLoad = s.keep!.earned;
        // every day's requests as last seen (a day's set is final once the clock moves on)
        const days = new Map<string, DailyRequests>();
        const look = () => {
          const r = requests(s);
          if (!r) return;
          days.set(r.day, { day: r.day, items: r.items.map(({ text: _t, reward: _r, ...q }) => q) });
          for (const q of r.items) {
            expect(q.progress).toBeGreaterThanOrEqual(0);
            expect(q.progress).toBeLessThanOrEqual(q.n);
            expect(q.done).toBe(q.progress >= q.n);
          }
          for (const k of keepsakes(s)) expect(k.progress).toBeLessThanOrEqual(k.n);
          expect(s.dollars).toBeLessThanOrEqual(MAX_DOLLARS);
        };
        const events: SimEvent[] = [];
        look();
        for (const a of acts) {
          act(s, a, events);
          look();
        }
        events.push(...step(s, 1 / 60)); // whatever is still queued
        look();
        // requests: one "requestDone" per request finished, on whatever day
        const done = [...days.values()].flatMap((d) => d.items.filter((q) => q.done));
        const paidEvents = events.filter((e) => e.type === "requestDone");
        expect(paidEvents.length).toBe(done.length);
        expect(paidEvents.reduce((a, e) => a + (e.amount ?? 0), 0)).toBe(done.reduce((a, q) => a + rewardOf(q), 0));
        // keepsakes: each milestone once, never one granted at load or earned before
        const granted = events.filter((e) => e.type === "keepsake").map((e) => e.keepsake!);
        expect(new Set(granted).size).toBe(granted.length);
        for (const m of granted) {
          expect(atLoad.has(m)).toBe(false);
          expect(earnedAtLoad & (1 << m)).toBe(0);
        }
        coverage.push([paidEvents.length, days.size, granted.length]);
        expect(s.keep!.earned).toBe(earnedAtLoad | granted.reduce((a, m) => a | (1 << m), 0));
      }),
      { numRuns: runs(60) },
    );
    // the streams reach what they are meant to test: requests paid, days turning over, milestones granted
    const reached = (i: number, over: number) => coverage.filter((x) => x[i]! > over).length;
    expect(reached(0, 0)).toBeGreaterThan(coverage.length / 4);
    expect(reached(1, 1)).toBeGreaterThan(coverage.length / 2);
    expect(reached(2, 0)).toBeGreaterThan(0);
  });
});
