/**
 * Winter: the frost morph (id 3) in the view, the journal and share codes; the penguin (visitor 7); and the room's
 * weather and the pet motifs that came with it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import contract from "./contract.json";
import { PENTATONIC, SPECIES_MOTIFS, dripDelayMs, motifFor, noteToMidi } from "./audio";
import { describeJelly } from "./a11y";
import { FROST_MORPH } from "./season";
import { MORPH_FROST, SPECIES_N } from "./species";
import { eventGroup, jellyGroups, morphGroup } from "./spritegroups";
import {
  DECOR,
  K,
  camX,
  createState,
  exportTank,
  importTank,
  journalFrom,
  rightGlass,
  setEvent,
  setReducedMotion,
  specProps,
  step,
  tap,
  view,
  viewSpan,
  type Save,
  type SaveJelly,
  type SimEvent,
  type Species,
  type Stage,
  type State,
} from "./sim";
import { PENGUIN, VISITORS, VISITOR_NAMES, VISITOR_NIGHT, VISITOR_SEASON, boxOf, planVisit, visitsDuring } from "./visitors";
import { visitLogRows } from "./visitlog";
import { RAIN_ODDS, SNOW_ODDS, dayRoll, eveningOf, weatherAt, weatherOverride } from "./weather";

const P = K.P;
const NOON = new Date(2027, 0, 12, 12).getTime();

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const jelly = (k: Species, g: Stage, extra: Partial<SaveJelly> = {}): SaveJelly => ({
  k, g, gp: [0, 4, 12, 30][g]!, care: 0, fullness: 1, affection: 1, anchor: -1, spot: -1, name: "Mochi", born: 0, content: 0, morph: 0, trait: 1, ...extra,
});
const tank = (slots: (SaveJelly | null)[], extra: Partial<Save> = {}): Save => ({
  v: 12, foods: [true, false, false], themes: [true, false, false, false], theme: 0,
  slots: Array.from({ length: 7 }, (_, i) => slots[i] ?? null),
  dollars: 10, murk: 0, spots: [], night: false, lamp: null, owned: DECOR.map(() => false), helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: NOON, tier: 0, cam: 0, journal: journalFrom(slots, 0), ...extra,
});
const stretch = (s: State) => {
  const v = viewSpan(s);
  return { x0: Math.max(v.x0, K.glassL), x1: Math.min(v.x1, rightGlass(s)), cam: camX(s) };
};
const run = (s: State, seconds: number, dt = 1 / 30) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds / dt; i++) events.push(...step(s, dt));
  return events;
};

describe("winter: the frost morph", () => {
  it("is morph 3, drawn from the winter art, and the view writes frost = 1 (pale overrides it)", () => {
    expect(MORPH_FROST).toBe(3);
    expect(FROST_MORPH).toBe(MORPH_FROST);
    expect(morphGroup(MORPH_FROST)).toBe(eventGroup("winter"));
    expect(jellyGroups({ k: 8, morph: 3 })).toEqual(["sp-lionsmane", "ev-winter"]);
    const s = createState(tank([jelly(0, 3, { morph: 3 }), jelly(0, 3, { morph: 2 }), jelly(0, 3)]), seeded());
    let v = view(s);
    expect([v.j0frost, v.j0ghost, v.j0healthy, v.j0pale]).toEqual([1, 0, 0, 0]);
    expect([v.j1frost, v.j1ghost]).toEqual([0, 1]);
    expect([v.j2frost, v.j2healthy]).toEqual([0, 1]);
    expect(v.j3frost).toBe(0);
    expect(new Set(Object.keys(v))).toEqual(new Set(specProps()));
    expect(K.props).toContain("j0frost");
    s.slots[0]!.fullness = 0;
    s.slots[0]!.affection = 0;
    v = view(s);
    expect([v.j0frost, v.j0pale]).toEqual([0, 1]);
  });

  it("has a palette group per species and stage in the winter pack, and none in a species pack", () => {
    const groups = (contract as unknown as { assetGroups: Record<string, { file: string }> }).assetGroups;
    const winter = JSON.parse(readFileSync(`public/${groups["ev-winter"]!.file}`, "utf8")) as { sprites: Record<string, string> };
    for (const sp of contract.species)
      for (const st of contract.stages) {
        const name = `wn_${sp[0]!.toUpperCase()}${sp.slice(1)}${st[0]!.toUpperCase()}${st.slice(1)}Frost0`;
        expect(winter.sprites[name], name).toBeDefined();
        expect(winter.sprites[`wn_${sp[0]!.toUpperCase()}${sp.slice(1)}${st[0]!.toUpperCase()}${st.slice(1)}FrostGlint0`]).toBeDefined();
      }
    for (const [g, info] of Object.entries(groups)) {
      if (g === "ev-winter") continue;
      const pack = readFileSync(`public/${info.file}`, "utf8");
      expect(pack.includes('"wn_'), g).toBe(false);
    }
  });

  it("a winter birth may come out frost; it reads as such and the journal keeps its bit", () => {
    expect(describeJelly({ name: "Mochi", k: 0, g: 3, fullness: 1, mood: 1, morph: 3 })).toContain("frost colour");
    const s = createState(tank([jelly(0, 3, { morph: 3 })]), seeded());
    expect(s.journal[0]!.morphSeen & 4).toBe(4);
  });

  it("share codes: a frost jelly goes out plain for now (codes up to v5 carry morphs 0-2), never throwing", () => {
    // TODO(integrator): with the v6 codes (morph ids >= 3) this becomes a round trip that keeps morph 3
    const s = createState(tank([jelly(0, 3, { morph: 3 }), jelly(1, 3, { morph: 2 }), jelly(2, 3, { morph: 1, spot: 0 })]), seeded());
    const code = exportTank(s);
    const back = importTank(code, NOON)!;
    expect(back.slots.slice(0, 3).map((j) => j?.morph)).toEqual([0, 2, 1]);
  });
});

describe("winter: the penguin", () => {
  it("is visitor 7, comes only in winter, by day as well as night, and is in the log", () => {
    expect(VISITORS[PENGUIN]).toBe("penguin");
    expect(VISITOR_NAMES[PENGUIN]).toBe("penguin");
    expect(VISITOR_SEASON[PENGUIN]).toBe("winter");
    expect(VISITOR_NIGHT[PENGUIN]).toBe(false);
    expect(visitsDuring(PENGUIN, "winter")).toBe(true);
    expect(visitsDuring(PENGUIN, "halloween")).toBe(false);
    expect(visitsDuring(PENGUIN, null)).toBe(false);
    const row = visitLogRows({}).find((r) => r.kind === "penguin")!;
    expect(row).toMatchObject({ n: 0, season: "winter", night: false });
    const vis = (contract as unknown as { visitors: Record<string, { x0: number; x1: number }> }).visitors.penguin;
    expect(vis && vis.x1 > vis.x0).toBe(true);
  });

  it("zips in, looks around, darts about inside the view at every tier and camera, then zips off", () => {
    for (const tier of [0, 1, 2]) {
      for (const cam of [0, -360, -720]) {
        const s = createState(tank([jelly(0, 3)], { tier, cam }), seeded(5 + tier - cam));
        setEvent(s, "winter");
        s.nextVisit = Infinity;
        const st = stretch(s);
        const v = planVisit(PENGUIN, st, tier, seeded(7 + tier))!;
        expect(v).not.toBe(null);
        s.visit = v;
        const frames = new Set<number>();
        let inView = 0;
        let settledOut = 0;
        while (s.visit) {
          step(s, 1 / 30);
          const w = s.visit as typeof v | null;
          if (!w) break;
          frames.add(w.f);
          const b = boxOf(w);
          const inside = w.x + b.x0 >= st.x0 - 1 && w.x + b.x1 <= st.x1 + 1;
          if (inside) inView++;
          // while it's fully there (arrived, not leaving) it stays inside the glass and the water
          if (w.age > 3 && w.age < w.leaveAt && (!inside || w.y + b.y0 < K.waterTop || w.y + b.y1 > K.waterBot)) settledOut++;
        }
        expect(settledOut, `tier ${tier} cam ${cam}`).toBe(0);
        expect(inView).toBeGreaterThan(30 * 20);
        expect([...frames].sort()).toEqual([0, 1, 2, 3]); // swims (glide, stroke) and stands (still, flap)
      }
    }
  });

  it("a tap greets it with sand dollars; it flaps happily and leaves soon after", () => {
    const s = createState(tank([jelly(0, 3)]), seeded(3));
    setEvent(s, "winter");
    s.nextVisit = Infinity;
    s.visit = planVisit(PENGUIN, stretch(s), 0, seeded(4))!;
    run(s, 6);
    const v = s.visit!;
    const before = s.dollars;
    expect(tap(s, v.x, v.y)).toBe("visitor");
    expect(s.dollars).toBeGreaterThan(before);
    const flaps = new Set<number>();
    for (let i = 0; i < 20; i++) {
      step(s, 1 / 30);
      if (s.visit) flaps.add(s.visit.f);
    }
    expect(flaps.has(3)).toBe(true);
    run(s, 6);
    expect(s.visit).toBe(null);
  });

  it("with reduce motion: slower dashes, and a greeting holds the flap instead of flapping", () => {
    const quick = createState(tank([jelly(0, 3)]), seeded(3));
    const calm = createState(tank([jelly(0, 3)]), seeded(3));
    setReducedMotion(calm, true);
    const speeds = [quick, calm].map((s) => {
      setEvent(s, "winter");
      s.nextVisit = Infinity;
      s.visit = planVisit(PENGUIN, stretch(s), 0, seeded(4))!;
      let top = 0;
      let x = s.visit.x;
      for (let i = 0; i < 60; i++) {
        step(s, 1 / 30);
        top = Math.max(top, Math.abs(s.visit!.x - x) * 30);
        x = s.visit!.x;
      }
      return top;
    });
    expect(speeds[1]!).toBeLessThan(speeds[0]! * 0.6);
    for (let i = 0; i < 30 * 20 && calm.visit!.f < 2; i++) step(calm, 1 / 30); // until it stops to look around
    const v = calm.visit!;
    expect(v.f).toBe(2);
    tap(calm, v.x, v.y);
    const fs = new Set<number>();
    for (let i = 0; i < 20; i++) {
      step(calm, 1 / 30);
      if (calm.visit && calm.visit.age < calm.visit.leaveAt) fs.add(calm.visit.f);
    }
    expect([...fs]).toEqual([3]);
  });

  it("comes along with the others in winter", () => {
    const s = createState(tank([jelly(0, 3, { fullness: 1 })]), seeded(11));
    setEvent(s, "winter");
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 60 * 6; i++) for (const e of step(s, 0.5)) if (e.type === "visitorArrived") seen.add(e.kind!);
    expect(seen.has("penguin")).toBe(true);
    expect(seen.has("bat")).toBe(false);
  });
});

describe("the room's weather", () => {
  const d = (m: number, day: number, h: number, mi = 0) => new Date(2026, m - 1, day, h, mi);

  it("only in the evening (18:00 to 5:30), and the small hours belong to the evening before", () => {
    expect(eveningOf(d(6, 15, 17, 59))).toBe(null);
    expect(eveningOf(d(6, 15, 18))).toBe("2026-06-15");
    expect(eveningOf(d(6, 15, 23, 59))).toBe("2026-06-15");
    expect(eveningOf(d(6, 16, 2))).toBe("2026-06-15");
    expect(eveningOf(d(6, 16, 5, 29))).toBe("2026-06-15");
    expect(eveningOf(d(6, 16, 5, 30))).toBe(null);
    expect(eveningOf(d(1, 1, 1))).toBe("2025-12-31"); // over the new year too
    expect(eveningOf(d(6, 15, 12), "?sky=dusk")).not.toBe(null);
    expect(eveningOf(d(6, 15, 21), "?sky=day")).toBe(null);
  });

  it("an evening either rains or it doesn't, all evening: about one in four; in winter about one in two snows", () => {
    let rain = 0;
    let snow = 0;
    const n = 730;
    for (let i = 0; i < n; i++) {
      const at = (h: number) => new Date(2026, 0, 1 + i, h);
      const w = weatherAt(at(19), null);
      expect(weatherAt(at(23), null)).toBe(w);
      expect(weatherAt(new Date(2026, 0, 2 + i, 3), null)).toBe(w);
      expect(weatherAt(at(12), null)).toBe(null);
      if (w === "rain") rain++;
      const ws = weatherAt(at(19), "winter");
      expect(ws === "rain").toBe(false);
      if (ws === "snow") snow++;
    }
    expect(rain / n).toBeGreaterThan(RAIN_ODDS - 0.06);
    expect(rain / n).toBeLessThan(RAIN_ODDS + 0.06);
    expect(snow / n).toBeGreaterThan(SNOW_ODDS - 0.08);
    expect(snow / n).toBeLessThan(SNOW_ODDS + 0.08);
    expect(dayRoll("2026-06-15")).toBe(dayRoll("2026-06-15"));
  });

  it("?weather= forces it", () => {
    expect(weatherOverride("")).toBeUndefined();
    expect(weatherOverride("?weather=rain")).toBe("rain");
    expect(weatherOverride("?weather=SNOW")).toBe("snow");
    expect(weatherOverride("?weather=none")).toBe(null);
    expect(weatherOverride("?weather=hail")).toBeUndefined();
    expect(weatherAt(d(6, 15, 12), null, "?weather=rain")).toBe("rain");
    expect(weatherAt(d(6, 15, 20), null, "?weather=none")).toBe(null);
  });

  it("room.json has winter's room extras (snowy roofs, pane frost, the snow drift, the globe) and the glazing bars", () => {
    const info = (contract as unknown as { room: { file: string } }).room;
    const data = JSON.parse(readFileSync(`public/${info.file}`, "utf8")) as {
      layout: { mullion?: number; transom?: number };
      sprites: Record<string, { season?: string; when?: string }>;
    };
    expect(data.sprites.wn_roofsnow).toMatchObject({ season: "winter", when: "pane" });
    expect(data.sprites.wn_pane_frost).toMatchObject({ season: "winter", when: "pane" });
    expect(data.sprites.wn_sill_snow).toMatchObject({ season: "winter", when: "snow" });
    expect(data.sprites.wn_globe).toMatchObject({ season: "winter", when: "always" });
    expect(typeof data.layout.mullion).toBe("number");
    expect(typeof data.layout.transom).toBe("number");
  });
});

describe("pet motifs", () => {
  it("every species has 2-4 notes, all in the music's key (the C major pentatonic), soft and short", () => {
    expect(SPECIES_MOTIFS).toHaveLength(SPECIES_N);
    for (const [k, m] of SPECIES_MOTIFS.entries()) {
      expect(m.notes.length, `species ${k}`).toBeGreaterThanOrEqual(2);
      expect(m.notes.length).toBeLessThanOrEqual(4);
      for (const n of m.notes) expect(PENTATONIC, `${k}: ${n}`).toContain(noteToMidi(n) % 12);
      const notes = motifFor(k);
      expect(notes[notes.length - 1]!.at).toBeLessThan(0.75); // done well inside the pet sound's slot
    }
    // each species sounds like itself
    expect(new Set(SPECIES_MOTIFS.map((m) => m.notes.join(" "))).size).toBe(SPECIES_N);
    expect(motifFor(undefined)).toEqual(motifFor(0));
    expect(motifFor(99)).toEqual(motifFor(0));
  });

  it("drips come every 0.7-2.5 s while it rains", () => {
    expect(dripDelayMs(0)).toBe(700);
    expect(dripDelayMs(1)).toBe(2500);
  });
});

// the penguin's frame box stays where the art is (P units)
it("the penguin's box is a few logical px around its middle", () => {
  const b = boxOf({ kind: PENGUIN, sx: 1, f: 0 });
  expect(b.x0).toBeLessThan(0);
  expect(b.x1).toBeGreaterThan(0);
  expect((b.x1 - b.x0) / P).toBeLessThan(45);
});
