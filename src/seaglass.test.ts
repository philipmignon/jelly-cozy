import { describe, expect, it } from "vitest";
import { FIND_ITEMS, FIND_SETS, GLASS, SIFT_STEP } from "./finds";
import { DECOR_N, SG_CHIME, SG_GROTTO, CRAB, BUBBLER } from "./species";
import { CODE_VERSION_V5, decodeTank } from "./tankcode";
import { planRequests } from "./requests";
import { rng } from "./dirt";
import { eventWords } from "./a11y";
import {
  DECOR,
  K,
  buy,
  collection,
  createState,
  decorBaseY,
  decorOverlaps,
  exportTank,
  importTank,
  journalFrom,
  liftDecor,
  moveDecor,
  onSand,
  openShop,
  requests,
  sandAt,
  scrubAt,
  setReducedMotion,
  specProps,
  step,
  toSave,
  view,
  type Save,
  type SaveJelly,
  type SimEvent,
  type SimOptions,
  type State,
} from "./sim";

const NOON = new Date(2026, 9, 2, 12, 0).getTime();
const ON: SimOptions = { finds: true };
const run = (s: State, seconds: number) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * 60; i++) events.push(...step(s, 1 / 60));
  return events;
};
const adult = (): SaveJelly => ({ k: 0, g: 3, gp: 30, care: 0, fullness: 0.8, affection: 0.4, anchor: -1, spot: -1, name: "Mochi", born: NOON, content: 0, morph: 0 });
const tank = (extra: Partial<Save> = {}): Save => ({
  v: 12, foods: [true, false, false], themes: [true, false, false, false, false], theme: 0,
  slots: [adult(), null, null, null, null, null, null],
  dollars: 0, murk: 0, spots: [], night: false, lamp: null, owned: Array.from({ length: DECOR_N }, () => false), helpers: [false, false, false],
  decorX: DECOR.map((d) => d.x), pearlDay: "", lastSeen: NOON, tier: 0, cam: 0, journal: journalFrom([adult()], NOON), ...extra,
});
/** a stream that always says "yes, a find", then picks with `pick` */
const lucky = (pick = 0.5) => {
  let n = 0;
  return () => (n++ % 2 === 0 ? 0 : pick);
};
/** a dirty spot (it pays when scrubbed off) scrubbed clean at (x, y) */
function scrubSpot(s: State, x = 300, y = 500): SimEvent[] {
  const i = s.spots.indexOf(null);
  s.spots[i] = { x, y, dirt: 1, v: 0, peak: 1 };
  for (let k = 0; k < 30 && s.spots[i]; k++) scrubAt(s, x, y, 160);
  return run(s, 0.1);
}
/** the find index whose pick value lands on it (pickFind's walk over the weights, no request) */
const pickFor = (s: State, item: number) => {
  for (let r = 0; r < 1; r += 0.001) {
    const save = s.finds;
    s.findRand = lucky(r);
    const t = createState(toSave(s, NOON), () => 0.5, ON);
    t.findRand = lucky(r);
    const e = scrubSpot(t).find((x) => x.type === "found");
    s.finds = save;
    if (e?.find === item) return r;
  }
  return -1;
};

describe("v16 sea glass: finds turn up", () => {
  it("scrubbing a dirty spot off can turn up a find: it rises from the spot, its event, it's kept and saved", () => {
    const s = createState(tank(), () => 0.5, ON);
    s.findRand = lucky(0.01);
    const ev = scrubSpot(s, 300, 500);
    const found = ev.find((e) => e.type === "found")!;
    expect(found).toMatchObject({ source: "scrub", x: 300, y: 500, first: true });
    expect(found.amount).toBeUndefined();
    expect(collection(s).total).toBe(1);
    expect(toSave(s, NOON).finds!.n[found.find!]).toBe(1);
    expect(s.find).not.toBeNull();
  });

  it("no luck, no find; and the read-only tanks (demo, a friend's) never find anything", () => {
    const s = createState(tank(), () => 0.5, ON);
    s.findRand = () => 0.99;
    expect(scrubSpot(s).some((e) => e.type === "found")).toBe(false);
    const ro = createState(tank(), () => 0.5, {});
    ro.findRand = lucky();
    expect(scrubSpot(ro).some((e) => e.type === "found")).toBe(false);
    expect(toSave(ro, NOON).finds).toBeUndefined();
    expect(view(ro).sgJar).toBe(0);
    expect(view(s).sgJar).toBe(1);
  });

  it("one at a time: while a find flies to the jar nothing else turns up", () => {
    const s = createState(tank(), () => 0.5, ON);
    s.findRand = lucky(0.01);
    scrubSpot(s, 200, 400);
    expect(scrubSpot(s, 400, 400).some((e) => e.type === "found")).toBe(false);
    run(s, 3);
    expect(s.find).toBeNull();
    expect(scrubSpot(s, 400, 400).some((e) => e.type === "found")).toBe(true);
  });

  it("sifting: the sponge rubbed over the sand rolls once every SIFT_STEP px", () => {
    const s = createState(tank(), () => 0.5, ON);
    const x = 300;
    const y = sandAt(x) + 6;
    expect(onSand(s, x, y)).toBe(true);
    expect(onSand(s, x, 400)).toBe(false);
    let rolls = 0;
    s.findRand = () => (rolls++, 0.99);
    for (let i = 0; i < 20; i++) scrubAt(s, x + (i % 2 ? 10 : -10), y, 120);
    expect(rolls).toBe(Math.floor((20 * 120) / SIFT_STEP));
    s.findRand = lucky(0.01);
    for (let i = 0; i < 5; i++) scrubAt(s, x, y, 120);
    const f = run(s, 0.1).find((e) => e.type === "found")!;
    expect(f).toMatchObject({ source: "sift", x, y: sandAt(x) });
  });

  it("the hermit crab's dig, and a ride up the bubbler you can see, can turn one up too", () => {
    const owned = Array.from({ length: DECOR_N }, (_, d) => d === BUBBLER);
    const s = createState(tank({ helpers: [false, false, true], owned }), () => 0.5, ON);
    s.findRand = lucky(0.01);
    s.crab.digAt = 0;
    const ev = run(s, 4);
    expect(ev.find((e) => e.type === "found")?.source).toBe("dig");
    expect(CRAB).toBe(2);
    // no crab: the jellies ride the bubbler now and then (seen: it's on screen), and a ride stirs one up
    const r = createState(tank({ owned }), rng(7), ON);
    r.findRand = lucky(0.01);
    let ride: SimEvent | undefined;
    for (let i = 0; i < 80 && !ride; i++) ride = run(r, 30).find((e) => e.type === "found");
    expect(ride).toMatchObject({ source: "ride" });
  });

  it("a duplicate pays its few sand dollars, with a +N where it was found", () => {
    const s = createState(tank({ finds: { n: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0], sets: 0, day: "", today: 0, dry: 0 } }), () => 0.5, ON);
    const r = pickFor(s, 0);
    expect(r).toBeGreaterThanOrEqual(0);
    s.findRand = lucky(r);
    const ev = scrubSpot(s, 250, 450);
    const found = ev.find((e) => e.type === "found")!;
    expect(found).toMatchObject({ find: 0, first: false, amount: FIND_ITEMS[0]!.dup });
    const i = ev.indexOf(found);
    expect(ev[i + 1]).toMatchObject({ type: "earned", amount: FIND_ITEMS[0]!.dup, x: 250, y: 450 });
    expect(collection(s).items[0]!.n).toBe(4);
  });
});

describe("v16 sea glass: sets", () => {
  const glassBut = (missing: number): NonNullable<Save["finds"]> => ({ n: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0].map((c, i) => (i === missing ? 0 : c)), sets: 0, day: "", today: 0, dry: 9 });

  it("the last colour of sea glass completes the rainbow: the wind chime is in the tank, once, and the card unlocks", () => {
    const s = createState(tank({ finds: glassBut(4) }), () => 0.5, ON);
    const r = pickFor(s, 4);
    s.findRand = lucky(r);
    const ev = scrubSpot(s);
    expect(ev.filter((e) => e.type === "setDone")).toEqual([{ type: "setDone", set: GLASS }]);
    expect(s.owned[SG_CHIME]).toBe(true);
    expect(view(s)[`own${FIND_SETS[0]!.item}`]).toBe(1);
    expect(view(s)[`lock${FIND_SETS[0]!.item}`]).toBe(0);
    // reloading never awards it again, and the chime stays
    const t = createState(toSave(s, NOON + 1000), () => 0.5, ON);
    expect(run(t, 2).some((e) => e.type === "setDone")).toBe(false);
    expect(t.owned[SG_CHIME]).toBe(true);
    expect(toSave(t, NOON).finds!.sets).toBe(1);
  });

  it("an earned set's decoration comes back at load if a save lost it; one never earned isn't granted", () => {
    const owned = Array.from({ length: DECOR_N }, () => false);
    const s = createState(tank({ owned, finds: { n: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0], sets: 1, day: "", today: 0, dry: 0 } }), () => 0.5, ON);
    expect(s.owned[SG_CHIME]).toBe(true);
    expect(s.owned[SG_GROTTO]).toBe(false);
    // a forged bit for a set that isn't complete doesn't count
    const f = createState(tank({ finds: { n: [1, 0, 0, 0, 0, 1, 1, 1, 1, 0], sets: 3, day: "", today: 0, dry: 0 } }), () => 0.5, ON);
    expect(f.owned[SG_CHIME] || f.owned[SG_GROTTO]).toBe(false);
  });

  it("the shop: the set rewards' cards are locked, say which set, and once earned put away like any decoration", () => {
    const s = createState(tank(), () => 0.5, ON);
    openShop(s);
    s.dollars = 999;
    expect(buy(s, 36)).toBe("collection");
    expect(buy(s, 37)).toBe("collection");
    expect(s.dollars).toBe(999);
    expect(view(s).lock36).toBe(1);
    s.owned[SG_GROTTO] = true;
    expect(buy(s, 37)).toBe("putAway");
    expect(buy(s, 37)).toBe("placed");
    for (let i = 31; i <= 35; i++) expect(buy(s, i)).toBe("owned");
  });

  it("the wind chime hangs from the hood: moved, it stays at the same height, and it's in nobody's way on the sand", () => {
    const owned = Array.from({ length: DECOR_N }, (_, d) => d === SG_CHIME || d === 0);
    const s = createState(tank({ owned }), () => 0.5, ON);
    expect(DECOR[SG_CHIME]!.hang).toBe(true);
    const y = decorBaseY(s, SG_CHIME);
    expect(y).toBeLessThan(K.waterTop + 200);
    liftDecor(s, SG_CHIME);
    moveDecor(s, SG_CHIME, s.decorX[0]!);
    expect(decorBaseY(s, SG_CHIME)).toBe(y);
    expect(decorOverlaps(s)).toEqual([]);
  });

  it("a share code carries the chime and the grotto (13 decorations fit version 5)", () => {
    const owned = Array.from({ length: DECOR_N }, (_, d) => d === SG_CHIME || d === SG_GROTTO);
    const s = createState(tank({ owned }), () => 0.5, ON);
    const code = exportTank(s);
    expect(Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64")[0]! >> 4).toBe(CODE_VERSION_V5);
    expect(decodeTank(code)!.decor.length).toBe(DECOR_N);
    const back = importTank(code, NOON)!;
    expect(back.owned[SG_CHIME] && back.owned[SG_GROTTO]).toBe(true);
    expect(back.decorX[SG_GROTTO]).toBe(s.decorX[SG_GROTTO]);
    expect(back.finds).toBeUndefined(); // a friend's tank has no collection
  });
});

describe("v16 sea glass: the request, the view", () => {
  it("'Find a piece of sea glass' is only planned where finds can turn up, and a glass find finishes it", () => {
    const t = { species: [0 as const], foods: [true, false, false], decor: [], pearl: false };
    const days = Array.from({ length: 120 }, (_, d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10));
    expect(days.some((d) => planRequests(d, t).items.some((r) => r.kind === "seaglass"))).toBe(false);
    const day = days.find((d) => planRequests(d, { ...t, seaglass: true }).items.some((r) => r.kind === "seaglass"))!;
    expect(day).toBeDefined();
    const [y, m, dd] = day.split("-").map(Number);
    const at = new Date(y!, m! - 1, dd!, 10).getTime();
    const s = createState(tank({ lastSeen: at }), () => 0.5, { finds: true, requests: true });
    run(s, 0.1);
    const i = requests(s)!.items.findIndex((r) => r.kind === "seaglass");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(requests(s)!.items[i]!.text).toBe("Find a piece of sea glass");
    s.findRand = lucky(0.01); // glass is most of the finds while the request is open
    const ev = scrubSpot(s);
    expect(FIND_ITEMS[ev.find((e) => e.type === "found")!.find!]!.set).toBe(GLASS);
    expect(ev.some((e) => e.type === "requestDone" && e.request === i)).toBe(true);
    // the read-only tank doesn't get it
    const ro = createState(tank({ lastSeen: at }), () => 0.5, { requests: true });
    run(ro, 0.1);
    expect(requests(ro)!.items.some((r) => r.kind === "seaglass")).toBe(false);
  });

  it("the find rises, flies to the jar and the jar bumps; reduce motion just shows it and fades", () => {
    const s = createState(tank(), () => 0.5, ON);
    s.findRand = lucky(0.01);
    const found = scrubSpot(s, 300, 600).find((e) => e.type === "found")!;
    const v0 = view(s);
    expect(v0[`sg${found.find}`]).toBe(1);
    expect(new Set(Object.keys(v0))).toEqual(new Set(specProps()));
    run(s, 0.8);
    const risen = view(s);
    expect(risen.sgY).toBeLessThan(600);
    expect(risen.sgO).toBe(1);
    run(s, 0.9);
    const flying = view(s);
    expect(flying.sgY).toBeLessThan(risen.sgY!);
    expect(flying.sgS).toBeLessThan(1);
    run(s, 0.45);
    expect(view(s).sgO).toBe(0);
    expect(view(s).sgJarS).toBeGreaterThan(1);
    run(s, 1);
    expect(s.find).toBeNull();
    expect(view(s).sgJarS).toBe(1);

    const r = createState(tank(), () => 0.5, ON);
    setReducedMotion(r, true);
    r.findRand = lucky(0.01);
    scrubSpot(r, 300, 600);
    run(r, 0.5);
    const a = view(r);
    run(r, 0.5);
    const b = view(r);
    expect([a.sgX, a.sgY, a.sgS]).toEqual([b.sgX, b.sgY, 1]);
    run(r, 0.7);
    expect(r.find).toBeNull();
  });
});

describe("v16 sea glass: said out loud", () => {
  it("a find and a finished set are announced", () => {
    const none = () => null;
    expect(eventWords({ type: "found", find: 4, first: true }, none)).toEqual({ text: "You found a piece of red sea glass! New in your collection.", low: false });
    expect(eventWords({ type: "found", find: 5, first: false, amount: 2 }, none)?.text).toBe("You found another cowrie shell: +2 sand dollars.");
    expect(eventWords({ type: "setDone", set: 0 }, none)?.text).toBe("Sea glass rainbow complete! A sea-glass wind chime is in your tank.");
  });
});
