/**
 * The room the tank stands in, drawn beside it on wide screens. src/roomfit.ts decides when and imports this
 * module then, so phones never fetch it or its art. tools/gen.py draws the room (`# ---- room ----`) into
 * public/sprites/room.json: the room itself (wall, window, furniture), a strip that repeats past its edges, the sky
 * for each time of day, the lamp's lit shade, and each season's extras, all placed in room space (logical px at
 * the tank's scale: the tank covers x side..side+240, y 0..428, so its cabinet stands on the room's floor).
 *
 * A scene is three canvases behind the tank canvas, drawn when something changes (the light switch, the time of
 * day, the season, the window's size), never per frame:
 *   art    the sprites at art resolution, scaled up by CSS with image-rendering: pixelated
 *   shade  the dark, at half that resolution and smoothly scaled: night, let through round the window, the lamp
 *          and the tank
 *   glow   the light, screen-blended: the window's daylight or moonlight, the lamp's warm pool, the tank's glow
 * A change fades the new scene in over the old (as long as the tank's own day/night fade), at once with reduce motion.
 *
 * Weather (host.weather(), src/weather.ts): some evenings it rains, and in winter it may snow instead. A fourth canvas,
 * the window's glass only and at art resolution, sits between the art and the shade (so night darkens it too): rain
 * streaks falling outside, beads on the glass and the odd one running down; or snowflakes drifting down. It redraws
 * at WEATHER_FPS while the room shows and the tab is visible, never per frame; with reduce motion it is drawn once,
 * still. A winter season's "snow" sprites (snow drifted against the panes) show only while it snows.
 *
 * The room's lamp follows the tank's light (on while the tank is lit) and is a second light switch: clicking it
 * flips the tank's. Everything else lets the pointer through to the tank canvas. `?sky=dawn|day|dusk|night` forces
 * the window's time of day (screenshots, tests), as `?season=` forces the event.
 */
import type { RoomHost, RoomView } from "./roomfit";
import type { Weather } from "./weather";

// This chunk imports nothing at run time: a chunk that imported from the main bundle would name the main script's
// file, and wherever that resolves to another URL (a host that adds a query string, say) the whole tank would load
// twice. roomfit.ts hands it the art's URL instead.

export type SkyPhase = "dawn" | "day" | "dusk" | "night";
export const SKY_PHASES: readonly SkyPhase[] = ["dawn", "day", "dusk", "night"];

/** The window's time of day by the local clock (or `?sky=`): dawn 5:30-7:30, day to 18:00, dusk to 20:00. */
export function skyPhase(now: Date, search = ""): SkyPhase {
  const forced = new URLSearchParams(search).get("sky");
  if (forced && (SKY_PHASES as readonly string[]).includes(forced)) return forced as SkyPhase;
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 5.5 || h >= 20) return "night";
  if (h < 7.5) return "dawn";
  return h < 18 ? "day" : "dusk";
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface RoomLayout {
  side: number;
  w: number;
  h: number;
  tile: number;
  floor: number;
  window: Box;
  /** the glazing bars (3 px wide from these): the vertical one's x, the horizontal one's y */
  mullion?: number;
  transom?: number;
  lamp: { x: number; y: number };
  sill: { x: number; y: number };
  tank: Box;
}
interface SpriteData {
  x: number;
  y: number;
  png: string;
  /**
   * a season's sprite: its event id, and when it shows ("always"; "sky": in the window at dusk and night; "pane": in
   * the window at any time; "snow": in the window while it snows)
   */
  season?: string;
  when?: When;
}
type When = "always" | "sky" | "pane" | "snow";
interface Sprite {
  x: number;
  y: number;
  img: CanvasImageSource;
  season: string | undefined;
  when: When | undefined;
}

/** The weather layer's frame rate while it rains or snows (reduce motion: one still frame). */
export const WEATHER_FPS = 10;

/** How each time of day lights the room: the dark's colour and strength, the window's light and how far it reaches. */
const SKY_LIGHT: Record<SkyPhase, { dark: number; tint: string; win: string; winGlow: number; winHole: number; lamp: number }> = {
  dawn: { dark: 0.36, tint: "44,30,84", win: "255,184,160", winGlow: 0.3, winHole: 0.55, lamp: 0.75 },
  day: { dark: 0.1, tint: "28,32,72", win: "255,246,222", winGlow: 0.24, winHole: 0.75, lamp: 0.3 },
  dusk: { dark: 0.42, tint: "50,24,74", win: "255,150,84", winGlow: 0.34, winHole: 0.55, lamp: 0.8 },
  night: { dark: 0.76, tint: "6,10,30", win: "150,176,255", winGlow: 0.14, winHole: 0.26, lamp: 1 },
};

const FADE_MS = 1200;
const SHADE_RES = 0.5; // shade and glow canvases: light px per art px

const CSS = `
.jt-room { position: fixed; inset: 0; display: none; opacity: 0; overflow: hidden; pointer-events: none; background: #15161f; transition: opacity 0.6s ease; }
.jt-room.jt-room-shown { display: block; }
.jt-room.jt-room-on { opacity: 1; }
.jt-room-scene { position: absolute; inset: 0; isolation: isolate; transition: opacity ${FADE_MS}ms ease; }
.jt-room-scene canvas { position: absolute; left: 0; top: 0; }
.jt-room-art { image-rendering: pixelated; }
.jt-room-glow { mix-blend-mode: screen; }
.jt-room-lamp { position: fixed; display: none; padding: 0; margin: 0; border: 0; background: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.jt-room-lamp.jt-room-shown { display: block; }
:root[data-jt-reduce-motion] .jt-room, :root[data-jt-reduce-motion] .jt-room-scene { transition: none; }
#tank { position: relative; }
`;

const reduceMotion = () => document.documentElement.hasAttribute("data-jt-reduce-motion");

async function decode(b64: string): Promise<CanvasImageSource> {
  const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" });
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

/** Fetch and decode the room's art (`url`: sprites/room.json?v=<hash>). */
async function loadRoom(url: string): Promise<{ layout: RoomLayout; sprites: Record<string, Sprite> }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`room: HTTP ${res.status}`);
  const data = (await res.json()) as { layout: RoomLayout; sprites: Record<string, SpriteData> };
  // decode in parallel, but fill the map in the file's order: drawing walks the map, so its order is the layering
  // (filled as each decode finished, the Halloween moon's face could land behind the sky)
  const entries = Object.entries(data.sprites);
  const imgs = await Promise.all(entries.map(([, s]) => decode(s.png)));
  const sprites: Record<string, Sprite> = {};
  entries.forEach(([name, s], i) => {
    sprites[name] = { x: s.x, y: s.y, img: imgs[i]!, season: s.season, when: s.when };
  });
  return { layout: data.layout, sprites };
}

export async function createRoom(host: RoomHost, url: string): Promise<RoomView> {
  const { layout: L, sprites } = await loadRoom(url);
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement("div");
  root.className = "jt-room";
  root.setAttribute("aria-hidden", "true");
  const tank = document.getElementById("tank");
  if (tank) tank.before(root); // behind the tank canvas (which is positioned now, so it paints over the room)
  else document.body.prepend(root);
  // the lamp: a second light switch (the tank's own switch is the keyboard's and the screen reader's)
  const lampBtn = document.createElement("button");
  lampBtn.type = "button";
  lampBtn.className = "jt-room-lamp";
  lampBtn.tabIndex = -1;
  lampBtn.setAttribute("aria-hidden", "true");
  lampBtn.title = "Light switch";
  lampBtn.addEventListener("click", () => host.toggle());
  (tank ?? root).after(lampBtn); // under every overlay (they all sit higher)

  let shown = false;
  let drawn: { phase: SkyPhase | null; lit: boolean; season: string | null; weather: Weather | null } = { phase: null, lit: false, season: null, weather: null };
  let phase = skyPhase(new Date(), location.search);
  let scenes: HTMLElement[] = [];

  /** the room in client px: css px per art px, and where the room's x = 0 falls */
  const place = () => {
    const b = host.box();
    const a = b.h / L.h;
    return { a, left: b.x - L.side * a, top: b.y };
  };

  const state = (): { phase: SkyPhase; lit: boolean; season: string | null; weather: Weather | null } => ({
    phase,
    lit: host.lit(),
    season: host.season(),
    weather: host.weather(),
  });

  const render = (fade: boolean) => {
    const s = state();
    drawn = s;
    root.dataset.sky = s.phase;
    root.dataset.lamp = s.lit ? "on" : "off";
    root.dataset.season = s.season ?? "none";
    root.dataset.weather = s.weather ?? "none";
    const { a, left, top } = place();
    // the art covers the whole width: room space from rx0 (<= 0) on, repeating the tile past the painted room
    const rx0 = Math.min(0, -Math.ceil(left / a) - 1);
    const rx1 = Math.max(L.w, Math.ceil((innerWidth - left) / a) + 1);
    const W = rx1 - rx0;
    const scene = document.createElement("div");
    scene.className = "jt-room-scene";
    const canvas = (cls: string, k: number) => {
      const c = document.createElement("canvas");
      c.className = cls;
      c.width = Math.ceil(W * k);
      c.height = Math.ceil(L.h * k);
      Object.assign(c.style, { left: `${left + rx0 * a}px`, top: `${top}px`, width: `${(c.width / k) * a}px`, height: `${(c.height / k) * a}px` });
      scene.append(c);
      const ctx = c.getContext("2d")!;
      ctx.setTransform(k, 0, 0, k, -rx0 * k, 0); // draw in room space
      return ctx;
    };
    drawArt(canvas("jt-room-art", 1), rx0, rx1, s);
    weatherCanvas = s.weather ? windowCanvas(scene, a, left, top) : null;
    drawWeather();
    drawShade(canvas("jt-room-shade", SHADE_RES), rx0, rx1, s);
    drawGlow(canvas("jt-room-glow", SHADE_RES), rx0, rx1, s);
    root.append(scene);
    if (fade && scenes.length && !reduceMotion()) {
      scene.style.opacity = "0";
      void scene.offsetWidth;
      scene.style.opacity = "1";
      const old = scenes;
      setTimeout(() => old.forEach((el) => el.remove()), FADE_MS + 100);
    } else {
      scenes.forEach((el) => el.remove());
    }
    scenes = [scene];
    // the lamp's click target: its shade and pole
    Object.assign(lampBtn.style, {
      left: `${left + (L.lamp.x - 26) * a}px`,
      top: `${top + (L.lamp.y - 42) * a}px`,
      width: `${52 * a}px`,
      height: `${(L.floor + 14 - L.lamp.y + 42) * a}px`,
    });
  };

  const sprite = (ctx: CanvasRenderingContext2D, name: string) => {
    const s = sprites[name];
    if (s) ctx.drawImage(s.img, s.x, s.y);
  };

  function drawArt(ctx: CanvasRenderingContext2D, rx0: number, rx1: number, s: ReturnType<typeof state>) {
    ctx.imageSmoothingEnabled = false;
    const tile = sprites.tile;
    if (tile) {
      for (let x = -L.tile; x + L.tile > rx0; x -= L.tile) ctx.drawImage(tile.img, x, 0);
      for (let x = L.w; x < rx1; x += L.tile) ctx.drawImage(tile.img, x, 0);
    }
    const season = Object.values(sprites).filter((sp) => sp.season && sp.season === s.season);
    const dark = s.phase === "dusk" || s.phase === "night";
    // the sky, then what is in it, inside the glass only
    const w = L.window;
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
    ctx.clip();
    sprite(ctx, `sky_${s.phase}`);
    const skyThings = dark ? season.filter((sp) => sp.when === "sky") : [];
    if (s.phase === "night" && !skyThings.length) sprite(ctx, "moon");
    for (const sp of skyThings) ctx.drawImage(sp.img, sp.x, sp.y);
    // the season in the window at any time of day (winter's snowy roofs, frost in the panes), and while it snows
    for (const sp of season) if (sp.when === "pane" || (sp.when === "snow" && s.weather === "snow")) ctx.drawImage(sp.img, sp.x, sp.y);
    ctx.restore();
    sprite(ctx, "room");
    if (s.lit) sprite(ctx, "lamp_on");
    for (const sp of season) if (sp.when === "always") ctx.drawImage(sp.img, sp.x, sp.y);
  }

  const radial = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number, sy = 1) => {
    if (a <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.45, `rgba(${rgb},${a * 0.45})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
    ctx.restore();
  };
  /** a band of light (or dark) leaning out from the tank's sides, `reach` px wide */
  const sides = (ctx: CanvasRenderingContext2D, rgb: string, a: number, reach: number, y1 = L.h) => {
    if (a <= 0) return;
    for (const [x, dir] of [[L.tank.x0, -1], [L.tank.x1, 1]] as const) {
      const g = ctx.createLinearGradient(x, 0, x + dir * reach, 0);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x, x + dir * reach), 0, reach, y1);
    }
  };

  function drawShade(ctx: CanvasRenderingContext2D, rx0: number, rx1: number, s: ReturnType<typeof state>) {
    const k = SKY_LIGHT[s.phase];
    const full = (style: string | CanvasGradient) => {
      ctx.fillStyle = style;
      ctx.fillRect(rx0, 0, rx1 - rx0, L.h);
    };
    full(`rgba(${k.tint},${k.dark + (s.lit ? -0.04 : 0.06)})`); // a lit tank lights the room a little, a dark one not
    // further from the tank, a little darker: the eye stays on the tank
    for (const [x, dir] of [[L.tank.x0, -1], [L.tank.x1, 1]] as const) {
      const g = ctx.createLinearGradient(x, 0, x + dir * 520, 0);
      g.addColorStop(0, `rgba(${k.tint},0)`);
      g.addColorStop(1, `rgba(${k.tint},0.3)`);
      ctx.fillStyle = g;
      ctx.fillRect(dir < 0 ? rx0 : x, 0, dir < 0 ? x - rx0 : rx1 - x, L.h);
    }
    const top = ctx.createLinearGradient(0, 0, 0, 130);
    top.addColorStop(0, `rgba(${k.tint},0.22)`);
    top.addColorStop(1, `rgba(${k.tint},0)`);
    full(top);
    // by day the tank, a little in front of the wall, throws a soft shadow to the right (the window is left)
    if (s.phase !== "night") {
      const g = ctx.createLinearGradient(L.tank.x1, 0, L.tank.x1 + 40, 0);
      g.addColorStop(0, "rgba(20,12,24,0.3)");
      g.addColorStop(1, "rgba(20,12,24,0)");
      ctx.fillStyle = g;
      ctx.fillRect(L.tank.x1, 0, 40, L.floor);
    }
    // light lets the dark through: the window, the lamp, the tank, a lit pumpkin
    ctx.globalCompositeOperation = "destination-out";
    const w = L.window;
    radial(ctx, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 220, "0,0,0", k.winHole, 1.1);
    if (s.lit) {
      radial(ctx, L.lamp.x, L.lamp.y, 210, "0,0,0", 0.85 * k.lamp);
      radial(ctx, L.lamp.x, L.floor + 18, 110, "0,0,0", 0.5 * k.lamp, 0.25);
    }
    sides(ctx, "0,0,0", s.lit ? (s.phase === "night" ? 0.55 : 0.3) : 0.16, 110);
    if (s.season === "halloween" && (s.phase === "dusk" || s.phase === "night") && sprites.hw_pumpkin) radial(ctx, L.sill.x, L.sill.y, 40, "0,0,0", 0.5);
    ctx.globalCompositeOperation = "source-over";
  }

  function drawGlow(ctx: CanvasRenderingContext2D, _rx0: number, _rx1: number, s: ReturnType<typeof state>) {
    const k = SKY_LIGHT[s.phase];
    const w = L.window;
    const wx = (w.x0 + w.x1) / 2;
    // the window: its glow, a patch of light on the floor in front of it, a few soft shafts leaning down-right
    // (rain greys the light a little)
    const winGlow = k.winGlow * (s.weather === "rain" ? 0.7 : 1);
    radial(ctx, wx, (w.y0 + w.y1) / 2, 150, k.win, winGlow, 1.2);
    radial(ctx, wx + 30, L.floor + 22, 110, k.win, winGlow * 0.9, 0.16);
    ctx.save();
    ctx.globalAlpha = s.phase === "night" ? 0.35 : 1;
    for (const [dx, wd, a] of [[6, 26, 0.1], [44, 18, 0.08], [70, 22, 0.07]] as const) {
      const g = ctx.createLinearGradient(0, w.y0, 0, L.floor + 30);
      g.addColorStop(0, `rgba(${k.win},${a})`);
      g.addColorStop(1, `rgba(${k.win},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w.x0 + dx, w.y0 + 10);
      ctx.lineTo(w.x0 + dx + wd, w.y0 + 10);
      ctx.lineTo(w.x0 + dx + wd + 70, L.floor + 30);
      ctx.lineTo(w.x0 + dx + 70, L.floor + 30);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // the lamp: a warm pool round the shade, light thrown down to the floor and a little up the wall
    if (s.lit) {
      const a = k.lamp;
      radial(ctx, L.lamp.x, L.lamp.y - 10, 170, "255,170,80", 0.42 * a);
      radial(ctx, L.lamp.x, L.lamp.y - 16, 46, "255,214,150", 0.5 * a, 1.1);
      radial(ctx, L.lamp.x, L.floor + 18, 100, "255,190,120", 0.4 * a, 0.2);
      for (const [y0, y1, dir] of [[L.lamp.y, L.floor + 30, 1], [L.lamp.y - 40, L.lamp.y - 140, -1]] as const) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, `rgba(255,196,120,${(dir > 0 ? 0.22 : 0.14) * a})`);
        g.addColorStop(1, "rgba(255,196,120,0)");
        ctx.fillStyle = g;
        const n = dir > 0 ? 24 : 15;
        const spread = dir > 0 ? 80 : 60;
        ctx.beginPath();
        ctx.moveTo(L.lamp.x - n, y0);
        ctx.lineTo(L.lamp.x + n, y0);
        ctx.lineTo(L.lamp.x + spread, y1);
        ctx.lineTo(L.lamp.x - spread, y1);
        ctx.closePath();
        ctx.fill();
      }
    }
    // the tank's own light on the wall beside it: bright and cool while it's lit, a faint blue when it's dark
    sides(ctx, s.lit ? "90,190,255" : "70,110,220", s.lit ? (s.phase === "night" ? 0.3 : 0.14) : 0.12, s.lit ? 80 : 50, L.floor + 36);
    if (s.season === "halloween" && (s.phase === "dusk" || s.phase === "night") && sprites.hw_pumpkin) radial(ctx, L.sill.x, L.sill.y, 26, "255,140,40", 0.5);
  }

  // ---------------------------------------------------------------- the weather on the window

  let weatherCanvas: CanvasRenderingContext2D | null = null;
  let weatherTimer: ReturnType<typeof setInterval> | null = null;
  let wt = 0; // the weather's own clock, s
  /** A canvas over the window's glass, one px per art px (pixelated), drawn in window space. */
  const windowCanvas = (scene: HTMLElement, a: number, left: number, top: number): CanvasRenderingContext2D => {
    const w = L.window;
    const c = document.createElement("canvas");
    c.className = "jt-room-art jt-room-weather";
    c.width = w.x1 - w.x0;
    c.height = w.y1 - w.y0;
    Object.assign(c.style, { left: `${left + w.x0 * a}px`, top: `${top + w.y0 * a}px`, width: `${c.width * a}px`, height: `${c.height * a}px` });
    scene.insertBefore(c, scene.children[1] ?? null); // over the art, under the shade
    return c.getContext("2d")!;
  };
  /** A small steady pseudo-random 0..1 for particle i, salt k. */
  const rnd = (i: number, k: number) => {
    const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  /** The glazing bars, in window space: weather outside stays behind them. */
  const bars = () => {
    const w = L.window;
    const mx = L.mullion ?? Math.round((w.x0 + w.x1) / 2) - 1;
    const ty = L.transom ?? Math.round((w.y0 + w.y1) / 2) - 2;
    return { mx: mx - w.x0, ty: ty - w.y0 };
  };

  function drawWeather() {
    const ctx = weatherCanvas;
    if (!ctx) return;
    const weather = drawn.weather;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const t = reduceMotion() ? 7.3 : wt; // reduce motion: one still frame
    if (weather === "snow") {
      for (let i = 0; i < 46; i++) {
        const speed = 7 + rnd(i, 1) * 9;
        const y = (rnd(i, 2) * (H + 8) + t * speed) % (H + 8) - 4;
        const x = (rnd(i, 3) * W + Math.sin(t * (0.5 + rnd(i, 4)) + i) * 3 + W) % W;
        const big = rnd(i, 5) > 0.7;
        ctx.fillStyle = `rgba(255,255,255,${big ? 0.9 : 0.7})`;
        ctx.fillRect(Math.floor(x), Math.floor(y), big ? 2 : 1, big ? 2 : 1);
      }
    } else if (weather === "rain") {
      // streaks falling outside, leaning a little with the wind
      ctx.fillStyle = "rgba(196,214,240,0.32)";
      for (let i = 0; i < 34; i++) {
        const speed = 150 + rnd(i, 1) * 70;
        const len = 4 + Math.floor(rnd(i, 2) * 4);
        const y = ((rnd(i, 3) * (H + 20) + t * speed) % (H + 20)) - 10;
        const x0 = rnd(i, 4) * (W + 20) - 10 + y * 0.18;
        for (let j = 0; j < len; j++) ctx.fillRect(Math.floor(x0 + j * 0.18), Math.floor(y + j), 1, 1);
      }
    }
    // keep what's outside behind the glazing bars
    const { mx, ty } = bars();
    ctx.clearRect(mx, 0, 3, H);
    ctx.clearRect(0, ty, W, 3);
    if (weather !== "rain") return;
    // beads on the glass (in front of the bars' edges is fine: they're on the pane), and a few running down
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rnd(i, 6) * W);
      const y = Math.floor(rnd(i, 7) * H);
      ctx.fillStyle = "rgba(226,238,255,0.55)";
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = "rgba(40,50,80,0.35)";
      ctx.fillRect(x, y + 1, 1, 1);
    }
    for (let i = 0; i < 4; i++) {
      const period = 5 + rnd(i, 8) * 4;
      const p = ((t + rnd(i, 9) * period) % period) / period; // 0..1 down the pane, then a new one
      const x = Math.floor(rnd(i, 10) * (W - 4)) + 2;
      const y = Math.floor(p * p * H);
      for (let j = 1; j < 10 && y - j >= 0; j++) {
        ctx.fillStyle = `rgba(210,226,250,${0.28 * (1 - j / 10)})`;
        ctx.fillRect(x + (j % 5 === 0 ? 1 : 0), y - j, 1, 1);
      }
      ctx.fillStyle = "rgba(236,244,255,0.75)";
      ctx.fillRect(x, y, 2, 2);
    }
  }

  /** Run the weather's frames while it rains or snows on a shown room in a visible tab (not with reduce motion). */
  const pumpWeather = () => {
    const want = shown && !!weatherCanvas && !reduceMotion() && !document.hidden;
    if (want && !weatherTimer) {
      let last = performance.now();
      weatherTimer = setInterval(() => {
        const now = performance.now();
        wt += Math.min(0.5, (now - last) / 1000);
        last = now;
        drawWeather();
      }, 1000 / WEATHER_FPS);
    } else if (!want && weatherTimer) {
      clearInterval(weatherTimer);
      weatherTimer = null;
      drawWeather(); // reduce motion turned on mid-shower: the still frame
    }
  };

  /** every frame: a few reads and a compare; a redraw only when the switch, the season or the weather changed */
  const update = () => {
    if (shown && (host.lit() !== drawn.lit || host.season() !== drawn.season || phase !== drawn.phase || host.weather() !== drawn.weather)) render(true);
    pumpWeather();
  };
  // the window's time of day moves on by itself: check once a minute (and on coming back to the tab)
  setInterval(() => {
    phase = skyPhase(new Date(), location.search);
    update();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    pumpWeather();
    if (document.hidden) return;
    phase = skyPhase(new Date(), location.search);
    update();
  });

  return {
    show(on) {
      if (on) {
        render(false);
        if (!shown) {
          root.classList.add("jt-room-shown");
          lampBtn.classList.add("jt-room-shown");
          void root.offsetWidth;
          root.classList.add("jt-room-on");
        }
      } else if (shown) {
        root.classList.remove("jt-room-shown", "jt-room-on");
        lampBtn.classList.remove("jt-room-shown");
        scenes.forEach((el) => el.remove());
        scenes = [];
        weatherCanvas = null;
        drawn = { phase: null, lit: false, season: null, weather: null };
      }
      shown = on;
      pumpWeather();
    },
    sync: update,
    get shown() {
      return shown;
    },
  };
}
