import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GROUPS, createSpriteGroups, eventGroup, fromBase64, groupUrl, groupsFor, jellyGroups, morphGroup, speciesGroup, type ImageAssetLike } from "./spritegroups";
import { SEASONS, activeSeason } from "./season";
import { MORPH_KNOWN, SPECIES_NAMES } from "./species";

const day = (m: number, d: number) => new Date(2026, m - 1, d, 12);

describe("seasons", () => {
  const ev = (now: Date, search = "", decor = true) => activeSeason(now, search, decor)?.id ?? null;
  it("the season showing brings its event group (season.ts decides: calendar, ?season=, the decor setting)", () => {
    expect(groupsFor([], ev(day(9, 30)))).toEqual([]);
    expect(groupsFor([], ev(day(10, 1)))).toEqual(["ev-halloween"]);
    expect(groupsFor([], ev(day(11, 2)))).toEqual(["ev-halloween"]);
    expect(groupsFor([], ev(day(11, 3)))).toEqual([]);
    expect(groupsFor([], ev(day(6, 1), "?season=halloween"))).toEqual(["ev-halloween"]);
    expect(groupsFor([], ev(day(10, 20), "?fast=1&season=none"))).toEqual([]);
    expect(groupsFor([], ev(day(10, 20), "", false))).toEqual([]); // decor off
  });
  it("every season's art ships as a group", () => {
    for (const s of SEASONS) expect(GROUPS[eventGroup(s.id)], s.id).toBeDefined();
  });
});

describe("morphs", () => {
  it("a ghost (morph 2) needs the Halloween art; plain and classic only their species'", () => {
    expect(morphGroup(0)).toBeNull();
    expect(morphGroup(1)).toBeNull();
    expect(morphGroup(2)).toBe("ev-halloween");
    expect(jellyGroups({ k: 1, morph: 2 })).toEqual(["sp-blubber", "ev-halloween"]);
    expect(jellyGroups({ k: 1, morph: 1 })).toEqual(["sp-blubber"]);
  });
  it("v16: every morph id past classic has a group in this build: ghost, frost, dusk, pearl", () => {
    const want: Record<number, string> = { 2: "ev-halloween", 3: "ev-winter", 4: "mo-dusk", 5: "mo-pearl" };
    for (const id of MORPH_KNOWN) {
      if (id < 2) continue;
      expect(morphGroup(id), `morph ${id}`).toBe(want[id]);
      expect(GROUPS[morphGroup(id)!], `morph ${id}`).toBeDefined();
      expect(jellyGroups({ k: 6, morph: id })).toEqual(["sp-crystal", want[id]]);
    }
    expect(Object.keys(want).map(Number)).toEqual(MORPH_KNOWN.filter((id) => id >= 2));
  });
  it("a ghost jelly brings its art after the season, or with decor off, without the season", () => {
    const tank = [{ k: 0, morph: 0 }, { k: 3, morph: 2 }];
    expect(groupsFor(tank, activeSeason(day(11, 20))?.id ?? null)).toEqual(["sp-moon", "sp-comb", "ev-halloween"]);
    expect(groupsFor(tank, activeSeason(day(10, 20), "", false)?.id ?? null)).toEqual(["sp-moon", "sp-comb", "ev-halloween"]);
    expect(groupsFor(tank, activeSeason(day(10, 20), "?season=none")?.id ?? null)).toEqual(["sp-moon", "sp-comb", "ev-halloween"]);
    expect(groupsFor([{ k: 0, morph: 1 }], null)).toEqual(["sp-moon"]);
  });
  it("the ghost palettes really are in the Halloween pack, and no species pack holds them", () => {
    const hw = JSON.parse(readFileSync(new URL("../public/sprites/ev-halloween.json", import.meta.url), "utf8")) as { sprites: Record<string, string> };
    const ghosts = Object.keys(hw.sprites).filter((n) => /^hw_[A-Z][a-z]+[A-Z][a-z]+Ghost\d$/.test(n));
    expect(ghosts.length).toBeGreaterThanOrEqual(SPECIES_NAMES.length * 4 * 4); // every species, stage and frame
    expect(ghosts).toContain("hw_MoonAdultGhost0");
    expect(GROUPS["sp-moon"]!.sprites).toBeGreaterThan(50);
  });
});

describe("groups", () => {
  it("every species has a group in this build, named after gen.py's species key", () => {
    expect(speciesGroup(0)).toBe("sp-moon");
    for (let k = 0; k < SPECIES_NAMES.length; k++) {
      const g = GROUPS[speciesGroup(k)];
      expect(g, speciesGroup(k)).toBeDefined();
      expect(g!.sprites).toBeGreaterThan(50);
    }
  });
  it("a tank needs one group per species in it, plus the season's", () => {
    expect(groupsFor([{ k: 0 }, { k: 0 }, { k: 3 }], null)).toEqual(["sp-moon", "sp-comb"]);
    expect(groupsFor([{ k: 1 }], "halloween")).toEqual(["sp-blubber", "ev-halloween"]);
  });
  it("group files sit beside the page and carry their hash", () => {
    const g = GROUPS["sp-moon"]!;
    expect(groupUrl(g, "https://x.github.io/jelly-cozy/")).toBe(`https://x.github.io/jelly-cozy/sprites/sp-moon.json?v=${g.v}`);
    expect(groupUrl(g, "https://x.github.io/jelly-cozy/index.html?demo=1")).toBe(`https://x.github.io/jelly-cozy/sprites/sp-moon.json?v=${g.v}`);
  });
  it("the committed group file holds PNGs", () => {
    const pack = JSON.parse(readFileSync(new URL("../public/sprites/sp-moon.json", import.meta.url), "utf8")) as { sprites: Record<string, string> };
    const names = Object.keys(pack.sprites);
    expect(names.length).toBe(GROUPS["sp-moon"]!.sprites);
    expect(names).toContain("BellHealthy0");
    expect(Array.from(fromBase64(pack.sprites[names[0]!]!).slice(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  });
});

describe("the loader", () => {
  const png = btoa("\x89PNG-fake");
  const setup = (files: Record<string, unknown> = {}, fail = new Set<string>()) => {
    const set: string[] = [];
    const unrefs: number[] = [];
    const fetched: string[] = [];
    let loaded!: () => void;
    const g = createSpriteGroups({
      base: "https://h/",
      fileLoaded: new Promise<void>((r) => (loaded = r)),
      idle: (fn) => fn(),
      decode: async (bytes) => ({ unref: () => unrefs.push(bytes.length) }),
      fetch: async (url) => {
        fetched.push(url);
        const name = /sprites\/(.+)\.json/.exec(url)![1]!;
        if (fail.has(name)) return { ok: false, status: 404, json: async () => null };
        return { ok: true, status: 200, json: async () => files[name] ?? { sprites: {} } };
      },
    });
    const asset = (name: string): ImageAssetLike => ({ name, isImage: true, setRenderImage: () => set.push(name) });
    return { g, set, unrefs, fetched, asset, loaded: () => loaded() };
  };

  it("claims only the referenced (byte-less) images", () => {
    const { g, asset } = setup();
    expect(g.assetLoader(asset("BellHealthy0"), new Uint8Array(0))).toBe(true);
    expect(g.assetLoader(asset("Sand"), new Uint8Array(10))).toBe(false);
    expect(g.assetLoader({ name: "font", isImage: false, setRenderImage: () => {} }, new Uint8Array(0))).toBe(false);
  });

  it("sets each sprite of a group on its asset once the file and the .riv are both in", async () => {
    const { g, set, unrefs, asset, loaded } = setup({ "sp-moon": { sprites: { BellHealthy0: png, Tent0: png, Stale: png } } });
    g.assetLoader(asset("BellHealthy0"), new Uint8Array(0));
    g.assetLoader(asset("Tent0"), new Uint8Array(0));
    const p = g.ensureGroups(["sp-moon"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(set).toEqual([]); // the .riv hasn't finished loading
    expect(g.isReady("sp-moon")).toBe(false);
    loaded();
    await p;
    expect(set.sort()).toEqual(["BellHealthy0", "Tent0"]); // "Stale" has no asset in this .riv
    expect(unrefs.length).toBe(2);
    expect(g.isReady("sp-moon")).toBe(true);
  });

  it("fetches a group once, however often it is asked for", async () => {
    const { g, fetched, loaded } = setup();
    loaded();
    await Promise.all([g.ensureGroups(["sp-moon"]), g.ensureGroups(["sp-moon", "sp-comb"])]);
    g.want(["sp-moon", "sp-comb"]);
    expect(fetched.length).toBe(2);
  });

  it("a prefetch downloads without decoding, and the install later reuses the download", async () => {
    const { g, set, fetched, asset, loaded } = setup({ "sp-comb": { sprites: { CombAdultHealthy0: png } } });
    g.assetLoader(asset("CombAdultHealthy0"), new Uint8Array(0));
    loaded();
    g.prefetch(["sp-comb", "sp-moon"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(fetched.length).toBe(2);
    expect(set).toEqual([]);
    expect(g.isReady("sp-comb")).toBe(false);
    await g.ensureGroups(["sp-comb"]);
    expect(set).toEqual(["CombAdultHealthy0"]);
    expect(fetched.length).toBe(2);
  });

  it("a group the build doesn't ship counts as ready", async () => {
    const { g, fetched, loaded } = setup();
    loaded();
    await g.ensureGroups(["ev-nothing"]);
    expect(g.isReady("ev-nothing")).toBe(true);
    expect(fetched).toEqual([]);
  });

  it("a failed fetch rejects, and a later ask retries", async () => {
    const fail = new Set(["sp-comb"]);
    const { g, fetched, loaded } = setup({}, fail);
    loaded();
    await expect(g.ensureGroups(["sp-comb"])).rejects.toThrow(/404/);
    expect(g.isReady("sp-comb")).toBe(false);
    g.want(["sp-comb"]); // too soon after the failure: no request
    expect(fetched.length).toBe(1);
    fail.clear();
    await g.ensureGroups(["sp-comb"]);
    expect(g.isReady("sp-comb")).toBe(true);
    expect(fetched.length).toBe(2);
  });
});
