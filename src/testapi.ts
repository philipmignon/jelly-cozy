/**
 * window.__jt: the test API the browser checks drive the tank with (tools/e2e/). Loaded only in test mode
 * (src/testmode.ts: ?test=1, ?seed=N or ?clock=virtual), as a chunk of its own: a player's browser never fetches
 * it and the service worker never caches it. Everything here goes through the sim's own functions; nothing in it
 * changes a game rule.
 *
 * Two clocks:
 *   real (default)   the tank runs as it does for a player (src/pace.ts draws the frames). Date.now() is the real
 *                    time plus an offset that setTime/passTime move (0 until they do).
 *   virtual          (?clock=virtual) no frame is drawn unless the test asks: advance(ms) steps the sim and Rive
 *                    together in fixed steps (STEP_MS, rendering the last one) and moves Date.now() with them.
 *                    The same calls from the same save and seed draw the same pixels every run.
 *                    Limits: HTML overlays (notes, the journal, CSS fades) and gesture timers (a long-press is
 *                    450 ms) still run on real time, so wait for those with idle() or a DOM condition; a sprite
 *                    group still arrives when its fetch does (ready() and idle() wait for it); `new Date()` with
 *                    no argument is still the real date (the room's window sky: pin it with ?sky=).
 */
import type { Rive } from "@rive-app/webgl2";
import { rng } from "./dirt";
import type { Pacer } from "./pace";
import type { SeasonId } from "./season";
import { clearVisit } from "./share";
import { eventGroup, type SpriteGroups } from "./spritegroups";
import { VIRTUAL_EPOCH, type TestQuery } from "./testmode";
import { VISITORS, arriveVisitor, camMoving, murkOf, shopY, toggleLamp, type State } from "./sim";

/** One virtual frame (a 60 Hz display's). */
export const STEP_MS = 1000 / 60;
/** The longest virtual step advance() takes (the real loop never steps the sim more than 0.1 s either). */
const MAX_STEP_MS = 100;
const TIPS_KEY = "jellytank:tips";

/** What main.ts hands the test API once the tank is up. */
export interface TestCtx {
  state: State;
  rive: Rive;
  saveKey: string;
  /** stop autosaving (a save written for the next load mustn't be overwritten by this page's pagehide) */
  suspendSaves(): void;
  groups: SpriteGroups;
  /** the sprite groups this tank shows now (its jellies, the season's) */
  tankGroups(): string[];
  /** re-read the wanted season (the calendar, ?season=, the decor setting, or setSeason's) */
  applySeason(): void;
  /** the first frame has been drawn (the loading screen is going) */
  loaded(): boolean;
  /** the first sprite groups have arrived or failed */
  groupsSettled(): boolean;
  /** a jelly is hidden waiting for its art, or fading in */
  fading(): boolean;
  /** artboard -> client */
  client(x: number, y: number): { x: number; y: number };
  /** world -> client */
  wclient(x: number, y: number): { x: number; y: number };
}

/** What main.ts asks of test mode before the tank exists. */
export interface TestHost {
  readonly virtual: boolean;
  readonly seed: number | null;
  /** the sim's random stream (seeded with ?seed=N) */
  readonly rand: () => number;
  /** setSeason's forced season: undefined = none forced (the calendar decides), null = no season */
  readonly season: SeasonId | null | undefined;
  /** the frame loop's clock, ms (performance.now(), or the virtual frame time) */
  frameNow(): number;
  /** a virtual frame's step, s, from Rive's Advance event */
  frameDt(e: { data?: unknown }): number;
  /** the frame driver: the real pacer, or (virtual) one that draws only when the test asks */
  pacer(rive: Rive, real: () => Pacer): Pacer;
  /** n frames drawn (virtual: stepped here and now) */
  frames(n: number): Promise<void>;
  /** install window.__jt */
  attach(ctx: TestCtx): void;
}

/** poll `ok` on real time until it holds (or throw after `timeout` ms, naming `what`) */
async function until(ok: () => boolean, what: string, timeout = 15_000): Promise<void> {
  const t0 = performance.now();
  while (!ok()) {
    if (performance.now() - t0 > timeout) throw new Error(`__jt: timed out waiting for ${what}`);
    await new Promise<void>((r) => (typeof requestAnimationFrame === "function" && !document.hidden ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));
  }
}
/** a CSS transition or a finite CSS animation is running (an overlay sliding or fading) */
const htmlMoving = () =>
  document.getAnimations().some((a) => {
    if (a.playState !== "running") return false;
    const end = a.effect?.getComputedTiming().endTime;
    return typeof end === "number" && Number.isFinite(end);
  });

/** JSON-safe copy of the live state (functions dropped, ±Infinity as strings). */
function snapshot(s: State): Record<string, unknown> {
  return JSON.parse(JSON.stringify(s, (_k, v: unknown) => (typeof v === "function" ? undefined : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : v)));
}

export function createTestHost(q: TestQuery): TestHost {
  const virtual = q.virtual;
  // the page clock: Date.now() for everything that reads it (the sim's start, saves, the album's dates...)
  const realNow = Date.now.bind(Date);
  let offset = q.now !== null ? q.now - realNow() : 0;
  let vnow = q.now ?? VIRTUAL_EPOCH;
  Date.now = virtual ? () => vnow : () => realNow() + offset;
  if (virtual) {
    // `new Date()` reads the virtual clock too (the room's window sky, "today" anywhere)
    const RealDate = Date;
    const VirtualDate = class extends RealDate {
      constructor(...a: ConstructorParameters<DateConstructor> | []) {
        if (a.length === 0) super(RealDate.now());
        else super(...(a as ConstructorParameters<DateConstructor>));
      }
    };
    (window as unknown as { Date: unknown }).Date = VirtualDate;
  }
  const setPageClock = (ms: number) => {
    if (virtual) vnow = ms;
    else offset = ms - realNow();
  };

  let season: SeasonId | null | undefined;
  // virtual frames: Rive's own timeline (ms) and the frames drawn
  let vt = 1000;
  let drawn = 0;
  let rive: (Rive & Record<string, unknown>) | null = null;
  const riveAny = () => rive as unknown as { draw(t: number): void; advanceAndReportChanges(dt: number): void; lastRenderTime: number; _needsRedraw: boolean; stopRendering(): void };
  /** draw the frame at the current virtual time, `ms` after the last */
  const render = (ms: number) => {
    const r = riveAny();
    r._needsRedraw = true; // the frames stepped without drawing may have changed what this one shows
    r.lastRenderTime = vt - ms;
    r.draw(vt);
    r.stopRendering();
  };
  /** one virtual frame: the clocks move, the sim steps (Rive's Advance event), and Rive draws it if `draw` */
  const tick = (ms: number, draw: boolean) => {
    vt += ms;
    vnow += ms;
    drawn++;
    if (draw) render(ms);
    else riveAny().advanceAndReportChanges(ms / 1000);
  };
  const stepFor = (ms: number, stepMs: number) => {
    const n = Math.max(1, Math.round(ms / stepMs));
    for (let i = 0; i < n; i++) tick(stepMs, i === n - 1);
  };

  const seedOf = q.seed;
  const host: TestHost = {
    virtual,
    seed: seedOf,
    rand: seedOf !== null ? rng(seedOf) : Math.random,
    get season() {
      return season;
    },
    frameNow: () => (virtual ? vt : performance.now()),
    frameDt: (e) => (typeof e.data === "number" && Number.isFinite(e.data) ? Math.max(0, e.data) : 0),
    pacer(r, real) {
      if (!virtual) return real();
      rive = r as Rive & Record<string, unknown>;
      const ra = r as unknown as Record<string, unknown>;
      // Rive's own loop never runs: nothing schedules it, and a redraw it asks for (a resize, the photo) is drawn
      // at the current virtual time, no time passing
      ra.scheduleRendering = () => {};
      ra.drawFrame = () => render(0);
      r.stopRendering();
      return {
        start() {},
        stop() {},
        wake() {},
        frame() {},
        saver: false,
        get calm() {
          return false;
        },
        get drawn() {
          return drawn;
        },
      };
    },
    async frames(n) {
      if (virtual) {
        for (let i = 0; i < n; i++) tick(STEP_MS, i === n - 1);
        return;
      }
      const p = (window as unknown as { __pace?: Pacer }).__pace;
      const want = (p?.drawn ?? 0) + n;
      await until(() => (p?.drawn ?? want) >= want, `${n} frames`);
    },
    attach(c) {
      (window as unknown as { __jt: unknown }).__jt = api(c);
    },
  };

  /** the slides, eases and fades the sim runs are all at rest (hints: unchanged since the last look) */
  let hintsWas = "";
  const simSettled = (s: State) => {
    const hints = `${s.hints.l},${s.hints.r}`;
    const still = hints === hintsWas;
    hintsWas = hints;
    return (
      Math.abs(shopY(s) - s.shop.to) < 0.5 &&
      (s.drawer.e === 0 || s.drawer.e === 1) &&
      s.focus.e === (s.focus.on ? 1 : 0) &&
      (s.nursery === null || s.nursery.e === (s.nursery.open ? 1 : 0)) && // ---- nursery ---- the bowl's zoom

      !camMoving(s) &&
      s.wall === null &&
      s.wipe === null &&
      Math.abs(s.night - (s.nightTarget ? 1 : 0)) < 1e-6 &&
      still
    );
  };

  function api(c: TestCtx) {
    const s = c.state;
    const added = new Map<number, object>();
    const artIn = async () => {
      await c.groups.ensureGroups(c.tankGroups()).catch(() => undefined);
    };
    const jt = {
      version: 1,
      virtual,
      seedAtLoad: seedOf,
      STEP_MS,
      /** Resolves once the tank's first frame is drawn, its jellies' art is in (none hidden or fading), the loading
       *  screen is gone and the fonts are loaded. Virtual clock: draws that first frame itself. */
      async ready(): Promise<void> {
        await until(() => c.groupsSettled(), "the first sprite groups", 30_000);
        await artIn();
        await document.fonts?.ready;
        if (virtual) {
          if (!c.loaded()) tick(STEP_MS, true);
        }
        await until(() => c.loaded(), "the first frame", 30_000);
        if (!virtual) await until(() => !c.fading(), "the jellies' art", 15_000);
        await until(() => !document.getElementById("loading"), "the loading screen to go");
      },
      /** Resolves when nothing is mid-way: the shop, the drawer, the close-up, the nursery bowl, the camera, the wall, the night fade,
       *  the pan hints, a jelly fading in, and the HTML overlays' CSS transitions. Virtual: steps frames until then. */
      async idle(timeout = 20_000): Promise<void> {
        if (c.fading()) await artIn();
        if (virtual) {
          let n = 0;
          hintsWas = "";
          while (!(simSettled(s) && !c.fading())) {
            if (++n > timeout / STEP_MS) throw new Error("__jt.idle: the tank never settled");
            if (c.fading() && c.tankGroups().some((g) => !c.groups.isReady(g))) await artIn();
            tick(STEP_MS, false);
          }
          if (n > 0) render(0);
        } else {
          hintsWas = "";
          await until(() => simSettled(s) && !c.fading(), "the tank to settle", timeout);
        }
        await until(() => !htmlMoving(), "the overlays' transitions", timeout);
      },
      /** Let `ms` of sim time pass. Virtual: fixed steps of `stepMs` (at most 100), the last one drawn. Real: waits
       *  until the sim has stepped that far. */
      async advance(ms: number, stepMs = STEP_MS): Promise<void> {
        if (virtual) return stepFor(Math.max(0, ms), Math.min(MAX_STEP_MS, Math.max(1, stepMs)));
        const t0 = s.t;
        await until(() => s.t >= t0 + ms / 1000 - 1e-9, `${ms} ms of sim time`, Math.max(15_000, ms * 20));
      },
      /** n frames (virtual: n steps of STEP_MS) */
      frames: (n: number) => host.frames(n),
      /** Jump the clock to epoch ms: the page's Date.now() (page) and the sim's clock (sim), no time away counted. */
      setTime(ms: number, which: { page?: boolean; sim?: boolean } = {}): void {
        if (which.page !== false) setPageClock(ms);
        if (which.sim !== false) s.clock = ms;
      },
      /** Time passes outside the tank (the page clock only): what a hidden tab or a reload then catches up on. */
      passTime(ms: number): void {
        setPageClock(Date.now() + ms);
      },
      /** Reseed the sim's random streams from now on (?seed=N seeds them from the start). */
      seed(n: number): void {
        s.rand = rng(n);
        s.dirtRand = rng(n + 11);
        s.traitRand = rng(n + 23);
      },
      /** Put the jelly in `slot` at world (x, y), at rest there. False if the slot is empty. */
      place(slot: number, x: number, y: number): boolean {
        const j = s.slots[slot];
        if (!j) return false;
        j.x = x;
        j.y = y;
        j.vx = 0;
        j.vy = 0;
        if (j.mode !== "fixed") {
          j.target = { x, y };
          j.targetKind = "wander";
          j.targetUntil = s.t + 30;
        }
        return true;
      },
      /** A visitor ("turtle", "octopus"... or its index) comes in now; false if its path doesn't fit the view. */
      spawnVisitor(kind: string | number): boolean {
        const k = typeof kind === "number" ? kind : (VISITORS as readonly string[]).indexOf(kind);
        return arriveVisitor(s, k);
      },
      /** Night or day showing, as the light switch sets it (an override until the next 07:00 or 19:00). */
      setNight(on: boolean): void {
        if (s.nightTarget !== on) toggleLamp(s);
      },
      /** Force a season ("halloween"), none (null), or the calendar again (undefined); resolves when its art is in. */
      async setSeason(id: SeasonId | null | undefined): Promise<void> {
        season = id;
        if (id) await c.groups.ensureGroups([eventGroup(id)]);
        c.applySeason();
      },
      /** A dirty spot on the glass at world (x, y), in the first free slot; returns the slot (-1: the glass is full). */
      addSpot(x: number, y: number, dirt = 1): number {
        const i = s.spots.indexOf(null);
        if (i < 0) return -1;
        const sp = { x, y, dirt, v: 0, peak: dirt };
        s.spots[i] = sp;
        added.set(i, sp);
        s.murk = murkOf(s.spots);
        return i;
      },
      /** The dirt left on the spot addSpot put in slot i: 0 once it's gone (even if a new spot took the slot). */
      spotDirt(i: number): number {
        const sp = s.spots[i];
        return sp && sp === added.get(i) ? sp.dirt : 0;
      },
      /** Write this save (a Save object or its JSON) as the player's, and reload into it. */
      loadSave(save: unknown, opts: { tipsSeen?: boolean } = {}): void {
        c.suspendSaves();
        localStorage.setItem(c.saveKey, typeof save === "string" ? save : JSON.stringify(save));
        if (opts.tipsSeen !== false) localStorage.setItem(TIPS_KEY, "1");
        else localStorage.removeItem(TIPS_KEY);
        clearVisit();
        location.reload();
      },
      /** A read-only, JSON-safe snapshot of the whole state. */
      state(): Record<string, unknown> {
        return snapshot(s);
      },
      /** Where a world (or, with space "art", an artboard) point is on the page, in CSS px. */
      toClient(x: number, y: number, space: "world" | "art" = "world"): { x: number; y: number } {
        return space === "art" ? c.client(x, y) : c.wclient(x, y);
      },
      get drawn() {
        return virtual ? drawn : ((window as unknown as { __pace?: Pacer }).__pace?.drawn ?? 0);
      },
    };
    return jt;
  }

  return host;
}
