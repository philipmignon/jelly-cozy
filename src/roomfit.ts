/**
 * When the room shows: on a wide screen the tank stands in the room it lives in (src/room.ts draws it). This part
 * is in the main bundle and tiny; it decides, and only then imports room.ts, which fetches the room's art. A phone
 * (portrait or landscape) and a tablet held upright never pass the test, so they never download either.
 */
import contract from "./contract.json";
import type { SeasonId } from "./season";
import type { Weather } from "./weather";

/** What the room needs from the tank. */
export interface RoomHost {
  /** the tank artboard's box on screen, client px (Fit.Contain inside the canvas) */
  box(): { x: number; y: number; w: number; h: number };
  /** the tank's light is on (its lamp: the light switch, or the clock's day) */
  lit(): boolean;
  /** the seasonal event showing in the tank (state.event), or null */
  season(): SeasonId | null;
  /** flip the tank's light switch (the room's lamp is a second one) */
  toggle(): void;
  /** the weather outside the window (src/weather.ts): rain, snow or none */
  weather(): Weather | null;
}

/** What room.ts hands back. */
export interface RoomView {
  /** lay out for the window's size and show (or hide) */
  show(on: boolean): void;
  /** called every frame: redraws only when the switch, the season or the weather changed */
  sync(): void;
  /** the room is on screen now */
  readonly shown: boolean;
}

export interface Room {
  sync(): void;
  /** the room is on screen (a wide window, its art in) */
  shown(): boolean;
}

/** Shorter side of the viewport (css px) below which it's a phone, whatever its orientation. */
export const ROOM_MIN_SHORT = 500;
/** Free space beside the tank (css px, each side) worth filling: at least this, and 30% of the tank's width. */
export const ROOM_MIN_SIDE = 160;

/**
 * Is there room for the room? `vw`/`vh` the viewport, `left`/`right` the free space beside the tank, `tankW` its
 * width (css px). e.g. 1440x900 yes, 1024x768 yes, 1024x1366 (tablet upright) no, 844x390 (phone on its side) no.
 */
export function roomWanted(vw: number, vh: number, left: number, right: number, tankW: number): boolean {
  return Math.min(vw, vh) >= ROOM_MIN_SHORT && Math.min(left, right) >= Math.max(ROOM_MIN_SIDE, tankW * 0.3);
}

/** Watch the window's size; load the room the first time it fits, show or hide it as the window changes. */
export function attachRoom(host: RoomHost): Room {
  const info = (contract as unknown as { room?: { file: string; v: string } }).room;
  if (!info) return { sync: () => {}, shown: () => false }; // a build without the room
  const url = new URL(`${info.file}?v=${info.v}`, document.baseURI).href;
  let view: RoomView | null = null;
  let loading = false;
  let queued = false;
  const wanted = () => {
    const b = host.box();
    return roomWanted(innerWidth, innerHeight, b.x, innerWidth - b.x - b.w, b.w);
  };
  const check = () => {
    queued = false;
    const want = wanted();
    if (view) return view.show(want);
    if (!want || loading) return;
    loading = true;
    import("./room")
      .then((m) => m.createRoom(host, url))
      .then((v) => {
        view = v;
        v.show(wanted());
      })
      .catch((err: unknown) => {
        console.warn("room:", err);
        setTimeout(() => (loading = false), 10_000); // offline, say: a later resize tries again
      });
  };
  addEventListener("resize", () => {
    if (!queued) requestAnimationFrame(check);
    queued = true;
  });
  check();
  return { sync: () => view?.sync(), shown: () => view?.shown ?? false };
}
