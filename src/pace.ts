/**
 * Frame pacing, for the battery. The host draws Rive's frames from its own requestAnimationFrame loop
 * (Rive's own loop is kept stopped): every display frame while something is happening, and CALM_FPS
 * once the tank has been quiet for a while (no input, no food in the water, the camera still, no visitor,
 * nothing sliding). Rive's animations and the sim both advance by the real time between drawn frames,
 * so a slower rate never slows anything down; it only shows fewer in-between frames. Any input, or a
 * sim event worth watching, brings the full rate back on the next display frame.
 *
 * Reduce motion (State.reducedMotion) is read as a hint: the tank goes calm sooner. The "Battery saver"
 * setting keeps the calm rate all the time. A hidden tab draws nothing (stop(), and rAF stops anyway).
 */
import { camMoving, shopY, type SimEvent, type State } from "./sim";

export const CALM_FPS = 30;
/** quiet seconds before the calm rate (and with reduce motion on) */
export const QUIET_S = 5;
export const QUIET_REDUCED_S = 1.5;
/** display frames arrive a little early or late: a frame this close to due is drawn */
const SLACK_MS = 4;

/** Something on screen moves quickly or is being watched: keep the full rate. */
export function lively(s: State): boolean {
  return (
    camMoving(s) ||
    s.food.some((f) => f.state !== "off") || // flakes falling, resting or being eaten: the jellies hurry
    s.visit !== null ||
    Math.abs(shopY(s) - s.shop.to) > 0.5 || // the shop sliding
    (s.focus.e > 0 && s.focus.e < 1) || // the card's close-up easing in or out
    s.wall !== null || // the tank widening after an upgrade
    s.wipe !== null ||
    s.lifted >= 0 // a decoration being moved
  );
}

/** Sim events that something worth watching happened (everything but the bells' steady pulses). */
export const wakes = (e: SimEvent): boolean => e.type !== "pulse";

/** The two Rive calls the pacer needs (public API of the Rive web runtime). */
export interface RiveFrames {
  /** draws one frame now (advancing by the time since the last), then schedules Rive's own next frame */
  drawFrame(): void;
  /** cancels Rive's own next frame */
  stopRendering(): void;
}

export interface Pacer {
  /** (re)start the loop: after load, and when the tab comes back */
  start(): void;
  /** the tab is hidden: no frames at all */
  stop(): void;
  /** input, or something worth watching: full rate from the next display frame, for QUIET_S */
  wake(): void;
  /** once per drawn frame (the Advance handler): stays awake while the tank is lively */
  frame(s: State): void;
  /** the "Battery saver" setting: the calm rate always */
  saver: boolean;
  /** drawing at the calm rate right now */
  readonly calm: boolean;
  /** frames drawn so far (for tools/battery.mjs and the e2e) */
  readonly drawn: number;
}

export interface PacerEnv {
  raf(cb: (t: number) => void): number;
  caf(id: number): void;
  now(): number;
  /** reduce motion is on */
  reduced(): boolean;
}

export function createPacer(rive: RiveFrames, env: PacerEnv): Pacer {
  let id: number | null = null;
  let lastDraw = -Infinity;
  let activeAt = env.now();
  let drawn = 0;
  const pacer: Pacer = {
    saver: false,
    get calm() {
      return pacer.saver || env.now() - activeAt >= (env.reduced() ? QUIET_REDUCED_S : QUIET_S) * 1000;
    },
    get drawn() {
      return drawn;
    },
    start() {
      if (id === null) id = env.raf(tick);
    },
    stop() {
      if (id !== null) env.caf(id);
      id = null;
      rive.stopRendering();
    },
    wake() {
      activeAt = env.now();
    },
    frame(s) {
      if (lively(s)) activeAt = env.now();
    },
  };
  function tick(t: number) {
    id = env.raf(tick);
    // Rive's own loop stays off: a canvas resize or the photo restarts it, and it must not run alongside
    rive.stopRendering();
    if (pacer.calm && t - lastDraw < 1000 / CALM_FPS - SLACK_MS) return;
    lastDraw = t;
    drawn++;
    rive.drawFrame(); // advances by the real time since the last drawn frame
    rive.stopRendering(); // ...and drawFrame scheduled Rive's next frame: this loop decides when that is
  }
  return pacer;
}

/** The "Battery saver" setting, kept per browser (off unless the player turned it on). */
const SAVER_KEY = "jellytank:battery";
export function readBatterySaver(store: Pick<Storage, "getItem"> | null): boolean {
  try {
    return store?.getItem(SAVER_KEY) === "1";
  } catch {
    return false; // no storage: off
  }
}
export function writeBatterySaver(store: Pick<Storage, "setItem"> | null, on: boolean): void {
  try {
    store?.setItem(SAVER_KEY, on ? "1" : "0");
  } catch {
    /* no storage: it lasts this visit */
  }
}
