import { describe, expect, it } from "vitest";
import {
  GHOST_MORPH, SEASONS, SEASON_DECOR_KEY, activeSeason, inSeason, readSeasonDecor, seasonAt, seasonOverride, seasonalMorph,
  writeSeasonDecor, type Season,
} from "./season";
import { MORPH_GHOST } from "./species";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe("seasons", () => {
  it("Halloween runs from Oct 1 to Nov 2 inclusive, by the local calendar", () => {
    expect(seasonAt(at(2026, 9, 30, 23))).toBe(null);
    expect(seasonAt(new Date(2026, 9, 1, 0, 0, 0))?.id).toBe("halloween");
    expect(seasonAt(at(2026, 10, 31))?.id).toBe("halloween");
    expect(seasonAt(new Date(2026, 10, 2, 23, 59, 59))?.id).toBe("halloween");
    expect(seasonAt(new Date(2026, 10, 3, 0, 0, 0))).toBe(null);
    expect(seasonAt(at(2027, 3, 14))).toBe(null);
    expect(seasonAt(Number.NaN)).toBe(null);
  });

  it("a season can wrap over the new year (for winter later)", () => {
    const winter = { from: [12, 15], to: [1, 6] } as unknown as Season;
    expect(inSeason(winter, new Date(2026, 11, 14))).toBe(false);
    expect(inSeason(winter, new Date(2026, 11, 15))).toBe(true);
    expect(inSeason(winter, new Date(2027, 0, 1))).toBe(true);
    expect(inSeason(winter, new Date(2027, 0, 6))).toBe(true);
    expect(inSeason(winter, new Date(2027, 0, 7))).toBe(false);
  });

  it("every season has a prop and a sprite prefix", () => {
    for (const s of SEASONS) {
      expect(s.prop).toMatch(/^ev[A-Z]/);
      expect(s.sprites).toMatch(/_$/);
    }
  });

  it("?season= forces it on or off", () => {
    expect(seasonOverride("")).toBeUndefined();
    expect(seasonOverride("?fast=1")).toBeUndefined();
    expect(seasonOverride("?season=halloween")?.id).toBe("halloween");
    expect(seasonOverride("?season=HALLOWEEN&fast=1")?.id).toBe("halloween");
    expect(seasonOverride("?season=none")).toBe(null);
    expect(seasonOverride("?season=bogus")).toBeUndefined();
  });

  it("activeSeason: the override, else the calendar, unless decor is off", () => {
    const july = at(2026, 7, 4);
    const oct = at(2026, 10, 15);
    expect(activeSeason(july)).toBe(null);
    expect(activeSeason(oct)?.id).toBe("halloween");
    expect(activeSeason(oct, "", false)).toBe(null);
    expect(activeSeason(july, "?season=halloween")?.id).toBe("halloween");
    expect(activeSeason(july, "?season=halloween", false)?.id).toBe("halloween");
    expect(activeSeason(oct, "?season=none")).toBe(null);
  });

  it("seasonalMorph: the ghost (2) during Halloween, else null", () => {
    expect(GHOST_MORPH).toBe(2);
    expect(GHOST_MORPH).toBe(MORPH_GHOST); // season.ts and the sim's morph ids agree
    expect(seasonalMorph(at(2026, 10, 20))).toBe(2);
    expect(seasonalMorph(new Date(2026, 10, 2))).toBe(2);
    expect(seasonalMorph(at(2026, 12, 20))).toBe(null);
    expect(seasonalMorph(at(2026, 6, 1), "?season=halloween")).toBe(2);
    expect(seasonalMorph(at(2026, 10, 20), "?season=none")).toBe(null);
  });

  it("the decor setting defaults on and survives broken storage", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readSeasonDecor(store)).toBe(true);
    writeSeasonDecor(store, false);
    expect(mem.get(SEASON_DECOR_KEY)).toBe("0");
    expect(readSeasonDecor(store)).toBe(false);
    writeSeasonDecor(store, true);
    expect(readSeasonDecor(store)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readSeasonDecor(broken)).toBe(true);
    expect(() => writeSeasonDecor(broken, false)).not.toThrow();
    expect(readSeasonDecor(null)).toBe(true);
  });
});
