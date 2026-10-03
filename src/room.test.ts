import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import contract from "./contract.json";
import { SKY_PHASES, skyPhase, type RoomLayout } from "./room";
import { roomWanted } from "./roomfit";
import { SEASONS } from "./season";

/** The free space beside a Fit.Contain tank (720x1284) in a viewport, as roomfit.ts measures it. */
function wanted(vw: number, vh: number): boolean {
  const s = Math.min(vw / 720, vh / 1284);
  const w = 720 * s;
  const side = (vw - w) / 2;
  return roomWanted(vw, vh, side, side, w);
}

describe("when the room shows", () => {
  it("laptops, desktops and tablets on their side: yes", () => {
    for (const [w, h] of <[number, number][]>[[1440, 900], [1280, 800], [1920, 1080], [2560, 1440], [3440, 1440], [1366, 768], [1024, 768], [1180, 820]]) {
      expect(wanted(w, h), `${w}x${h}`).toBe(true);
    }
  });
  it("phones either way up, and tablets held upright: no", () => {
    for (const [w, h] of <[number, number][]>[[390, 844], [375, 667], [430, 932], [844, 390], [932, 430], [820, 1180], [1024, 1366], [768, 1024]]) {
      expect(wanted(w, h), `${w}x${h}`).toBe(false);
    }
  });
  it("a desktop window narrowed until the sides are slim: no", () => {
    expect(wanted(800, 900)).toBe(false);
    expect(wanted(1000, 900)).toBe(true);
  });
});

describe("the window's sky", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m);
  it("follows the local clock: night, dawn, day, dusk", () => {
    expect(skyPhase(at(2))).toBe("night");
    expect(skyPhase(at(5, 29))).toBe("night");
    expect(skyPhase(at(5, 30))).toBe("dawn");
    expect(skyPhase(at(7, 29))).toBe("dawn");
    expect(skyPhase(at(7, 30))).toBe("day");
    expect(skyPhase(at(17, 59))).toBe("day");
    expect(skyPhase(at(18))).toBe("dusk");
    expect(skyPhase(at(19, 59))).toBe("dusk");
    expect(skyPhase(at(20))).toBe("night");
  });
  it("?sky= forces it (and nonsense doesn't)", () => {
    expect(skyPhase(at(12), "?sky=night")).toBe("night");
    expect(skyPhase(at(2), "?season=halloween&sky=dusk")).toBe("dusk");
    expect(skyPhase(at(12), "?sky=noon")).toBe("day");
  });
});

describe("room.json (tools/gen.py's room block)", () => {
  const info = (contract as unknown as { room?: { file: string; v: string; bytes: number } }).room!;
  const data = JSON.parse(readFileSync(`public/${info.file}`, "utf8")) as {
    layout: RoomLayout;
    sprites: Record<string, { x: number; y: number; png: string; season?: string; when?: string }>;
  };
  it("is listed in the contract with its size", () => {
    expect(info.file).toBe("sprites/room.json");
    expect(info.bytes).toBe(readFileSync(`public/${info.file}`).length);
    expect(info.bytes).toBeLessThan(120_000);
  });
  it("lines up with the tank: same height, the tank's place in the middle", () => {
    const L = data.layout;
    expect(L.h).toBe(contract.LH);
    expect(L.tank.x1 - L.tank.x0).toBe(contract.LW);
    expect(L.w).toBe(L.side * 2 + contract.LW);
    expect(L.w % L.tile).toBe(0); // the tile repeats seamlessly past both edges
    expect(L.floor).toBeGreaterThan(contract.cabTop / contract.P); // the cabinet stands on the floor, in front of the wall
  });
  it("has a sky for every time of day, the lit lamp, the tile, and art for every season's room extras", () => {
    for (const p of SKY_PHASES) expect(data.sprites[`sky_${p}`], p).toBeDefined();
    for (const n of ["room", "tile", "lamp_on", "moon"]) expect(data.sprites[n], n).toBeDefined();
    const seasons = new Set(Object.values(data.sprites).flatMap((s) => (s.season ? [s.season] : [])));
    for (const s of seasons) expect(SEASONS.some((x) => x.id === s), s).toBe(true);
    expect(seasons.has("halloween")).toBe(true);
  });
});
