/**
 * The game's clock rules in several time zones, across midnight and daylight-saving changes: night 19:00-07:00,
 * Halloween from 1 Oct to 2 Nov, the daily requests, the pearl and keepsake days turning over at local midnight
 * (once), and time away measured in real time when a DST change falls inside it.
 *
 * Each zone runs with process.env.TZ set for its tests (Node applies a TZ change at once; vitest runs each test file
 * in a process of its own, so no other file sees it). Dates are built inside the tests, after the zone is set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seasonAt, seasonalMorph, activeSeason, GHOST_MORPH } from "./season";
import { catchUp, createState, dayKey, isNightByClock, loadGame, nextLightChange, pearlCentre, requests, step, tap, type SimEvent, type State } from "./sim";

const SYSTEM_TZ = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Run `fn`'s tests with the local zone set to `zone`. */
function inZone(zone: string, fn: () => void): void {
  describe(zone, () => {
    beforeAll(() => {
      process.env.TZ = zone;
    });
    afterAll(() => {
      process.env.TZ = SYSTEM_TZ;
    });
    it("the zone is in effect", () => {
      // (ICU may answer with an older name for the same zone)
      expect([zone, { "Asia/Kolkata": "Asia/Calcutta" }[zone]]).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });
    fn();
  });
}

/** Local wall-clock time (month 1-12). */
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const hm = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};

/** A one-jelly tank saved at `t` (and loaded at `t`: no time away), with the clam in and today's pearl collected. */
function tankAt(t: number, extra: Record<string, unknown> = {}, opts = { requests: true, keepsakes: true }): State {
  const raw = { v: 12, slots: [{ k: 0, g: 3, name: "Mochi", fullness: 0.9, affection: 0.8 }], owned: [false, false, false, true], pearlDay: dayKey(t), lastSeen: t, murk: 0, spots: [], ...extra };
  return createState(loadGame(JSON.stringify(raw), t).save, () => 0.5, opts);
}
/** Step the tank `seconds` of sim time in 1 s frames, watching the day's requests: each plan seen, in order. */
function run(s: State, seconds: number, dt = 1): { events: SimEvent[]; plans: string[] } {
  const events: SimEvent[] = [];
  const plans: string[] = [];
  let last = s.requests;
  for (let i = 0; i < seconds / dt; i++) {
    events.push(...step(s, dt));
    requests(s);
    if (s.requests !== last) {
      plans.push(s.requests!.day);
      last = s.requests;
    }
  }
  return { events, plans };
}

// the DST changes in 2026 each zone has: [y, m, d] of the day the clocks change, and that day's length in hours
const DST: Record<string, [number, number, number, number][]> = {
  UTC: [],
  "America/Los_Angeles": [[2026, 3, 8, 23], [2026, 11, 1, 25]],
  "Europe/London": [[2026, 3, 29, 23], [2026, 10, 25, 25]],
  // the southern hemisphere: summer time ends in April, starts in October (the day after today's date in this file)
  "Australia/Sydney": [[2026, 4, 5, 25], [2026, 10, 4, 23]],
  // Chile changes at midnight: 24:00 -> 23:00 on 4 April (the last hour of the 4th twice), 00:00 -> 01:00 on 6 Sept
  "America/Santiago": [[2026, 4, 4, 25], [2026, 9, 6, 23]],
  "Asia/Kolkata": [],
  "Pacific/Chatham": [[2026, 4, 5, 25], [2026, 9, 27, 23]],
};

for (const zone of Object.keys(DST)) {
  inZone(zone, () => {
    const days = () => [[2026, 6, 15], ...DST[zone]!.map(([y, m, d]) => [y, m, d])] as [number, number, number][];

    it("night by the clock: 18:59 day, 19:00 night, 06:59 night, 07:00 day, on ordinary and DST-change days", () => {
      for (const [y, m, d] of days()) {
        expect(isNightByClock(at(y, m, d, 18, 59)), `${y}-${m}-${d} 18:59`).toBe(false);
        expect(isNightByClock(at(y, m, d, 19, 0)), `${y}-${m}-${d} 19:00`).toBe(true);
        expect(isNightByClock(at(y, m, d, 6, 59)), `${y}-${m}-${d} 06:59`).toBe(true);
        expect(isNightByClock(at(y, m, d, 7, 0)), `${y}-${m}-${d} 07:00`).toBe(false);
        expect(isNightByClock(at(y, m, d, 18, 59, 59) + 999)).toBe(false);
      }
    });

    it("the next change of light is the next local 07:00 or 19:00, where the light really flips, across DST", () => {
      for (const [y, m, d] of days()) {
        // every 10 minutes from the day before to the day after
        for (let t = at(y, m, d - 1); t < at(y, m, d + 2); t += 10 * MIN) {
          const next = nextLightChange(t);
          expect(next).toBeGreaterThan(t);
          expect([7 * 60, 19 * 60]).toContain(hm(next));
          expect(new Date(next).getSeconds() + new Date(next).getMilliseconds()).toBe(0);
          expect(isNightByClock(next - 1)).toBe(isNightByClock(t));
          expect(isNightByClock(next)).not.toBe(isNightByClock(t));
          expect(next - t).toBeLessThanOrEqual(13 * HOUR);
        }
      }
    });

    it("a DST-change day is as long as the clocks say, and every moment of it has that day's key", () => {
      for (const [y, m, d, hours] of DST[zone]!) {
        const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        let minutes = 0;
        for (let t = at(y, m, d) - 2 * HOUR; t < at(y, m, d) + 28 * HOUR; t += MIN) if (dayKey(t) === key) minutes++;
        expect(minutes).toBe(hours * 60);
        // and day keys only ever go forward through it
        let last = "";
        for (let t = at(y, m, d) - 2 * HOUR; t < at(y, m, d) + 28 * HOUR; t += MIN) {
          expect(dayKey(t) >= last).toBe(true);
          last = dayKey(t);
        }
      }
    });

    it("Halloween: off at Sep 30 23:59, on from Oct 1 00:00 to Nov 2 23:59, off at Nov 3 00:00 (local)", () => {
      for (const y of [2026, 2027]) {
        expect(seasonAt(at(y, 9, 30, 23, 59, 59) + 999)).toBeNull();
        expect(seasonAt(at(y, 10, 1))?.id).toBe("halloween");
        expect(seasonAt(new Date(y, 9, 1))?.id).toBe("halloween");
        expect(seasonAt(at(y, 11, 2, 23, 59, 59) + 999)?.id).toBe("halloween");
        expect(seasonAt(at(y, 11, 3))).toBeNull();
        expect(seasonalMorph(at(y, 10, 1))).toBe(GHOST_MORPH);
        expect(seasonalMorph(at(y, 9, 30, 23, 59))).toBeNull();
        // the setting and the URL still win at the edges
        expect(activeSeason(at(y, 10, 1), "", false)).toBeNull();
        expect(activeSeason(at(y, 9, 30, 12), "?season=halloween")?.id).toBe("halloween");
      }
      // Nov 1 is the US clocks' change day: still in season the whole of it
      for (let t = at(2026, 11, 1); t < at(2026, 11, 3); t += 15 * MIN) expect(seasonAt(t)?.id).toBe("halloween");
    });

    it("the daily requests turn over once at local midnight, and the pearl comes back once, also on DST nights", () => {
      for (const [y, m, d] of days()) {
        // 30 s before the local midnight that ends the day before day d (Chile's skipped midnight included)
        const midnight = at(y, m, d);
        const s = tankAt(midnight - 30_000);
        const before = requests(s)!.day;
        expect(before).toBe(dayKey(midnight - 30_000));
        const { events, plans } = run(s, 120);
        expect(plans).toEqual([dayKey(midnight)]);
        expect(events.filter((e) => e.type === "pearlReady")).toHaveLength(1);
        // collect it: no second pearl for the rest of that day (through a repeated hour too)
        const p = pearlCentre(s);
        expect(tap(s, p.x, p.y)).toBe("pearl");
        const rest = run(s, 25 * 3600 - 300, 30);
        expect(rest.events.filter((e) => e.type === "pearlReady")).toHaveLength(rest.plans.length);
        expect(rest.plans.length).toBeLessThanOrEqual(2);
        expect(new Set(rest.plans).size).toBe(rest.plans.length);
      }
    });

    it("keepsake days count across midnight once", () => {
      for (const [y, m, d] of days()) {
        const midnight = at(y, m, d);
        const s = tankAt(midnight - 30_000, { keep: { earned: 0, days: 2, lastDay: "2020-01-01", requests: 0 } });
        expect(s.keep!.days).toBe(3); // today, counted at load
        run(s, 120);
        expect(s.keep!.days).toBe(4);
        expect(s.keep!.lastDay).toBe(dayKey(midnight));
        run(s, 600, 10);
        expect(s.keep!.days).toBe(4);
      }
    });

    it("time away across midnight and DST changes counts in real time, and the new day starts once", () => {
      for (const [y, m, d] of days()) {
        // hidden at 23:30 the day before, back at 03:30 on day d: 4 h of wall clock, 3 to 5 real hours
        const from = at(y, m, d - 1, 23, 30);
        const to = at(y, m, d, 3, 30);
        const s = tankAt(from);
        s.clock = from;
        const away = catchUp(s, from, to)!;
        expect(away.seconds).toBe((to - from) / 1000);
        expect(Math.abs(away.seconds - 4 * 3600)).toBeLessThanOrEqual(3600);
        expect(away.lines).toContain("A pearl is waiting in the clam.");
        expect(s.clock).toBe(to);
        const { plans, events } = run(s, 5);
        expect(plans).toEqual([dayKey(to)]);
        expect(events.filter((e) => e.type === "pearlReady")).toHaveLength(1);
        expect(s.keep!.lastDay).toBe(dayKey(to));
        // the same absence through a reload says the same
        const reloaded = loadGame(JSON.stringify({ v: 12, slots: [{ k: 0, g: 3, name: "Mochi", fullness: 0.9, affection: 0.8 }], owned: [false, false, false, true], pearlDay: dayKey(from), lastSeen: from, murk: 0, spots: [] }), to);
        expect(reloaded.away!.seconds).toBe(away.seconds);
      }
    });
  });
}

describe("the zone is put back", () => {
  it("after the zones above, the system zone again", () => {
    expect(process.env.TZ).toBe(SYSTEM_TZ);
  });
});
