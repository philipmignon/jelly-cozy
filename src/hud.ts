/**
 * The settings button in the hood strip (top right of the tank) and the menu it opens:
 * jelly journal, share your tank, take a photo, saves, music, sound and seasonal decor. HTML over the canvas, placed in
 * artboard coordinates.
 */
import type { TankAudio } from "./audio";

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-gear {
  position: fixed; z-index: 8; padding: 0; cursor: pointer; display: grid; place-items: center; overflow: visible;
  background: #23253a; border: 2px solid #6c7194; border-radius: 6px; box-shadow: 0 2px 0 #15161f;
}
.jt-gear:focus-visible { outline: 2px solid #ffcf4a; outline-offset: 2px; }
/* the top bar is thin on phones: an invisible margin makes the tap target at least 48 px */
.jt-gear::after { content: ""; position: absolute; inset: -8px; }
.jt-rotate {
  position: fixed; inset: 0; z-index: 20; display: none; place-content: center; justify-items: center; gap: 14px;
  background: #15161f; color: #f1e2c4; font: 14px/1.4 ${FONT}; text-align: center; padding: 24px;
}
.jt-rotate .phone { width: 34px; height: 56px; border: 4px solid #6c7194; border-radius: 6px; position: relative; animation: jt-tilt 2.4s ease-in-out infinite; }
.jt-rotate .phone::after { content: ""; position: absolute; left: 50%; bottom: 3px; width: 8px; height: 3px; margin-left: -4px; background: #6c7194; }
@keyframes jt-tilt { 0%, 30% { transform: rotate(-90deg); } 60%, 100% { transform: rotate(0deg); } }
@media (orientation: landscape) and (max-height: 500px) and (pointer: coarse) { .jt-rotate { display: grid; } }
@media (prefers-reduced-motion: reduce) { .jt-rotate .phone { animation: none; } }
.jt-gear:active { transform: translateY(1px); box-shadow: none; }
.jt-gear[aria-expanded="true"] { background: #34374f; border-color: #ffcf4a; }
.jt-gear svg { width: 70%; height: 70%; shape-rendering: crispEdges; }
.jt-menu {
  position: fixed; z-index: 8; min-width: 210px; box-sizing: border-box; margin: 0; padding: 6px;
  display: grid; gap: 4px; list-style: none;
  font: 12px/1.2 ${FONT}; color: #2b1712;
  background: #f1e2c4; border: 3px solid #45261a; border-radius: 10px;
  box-shadow: inset 0 0 0 2px #d9bf94, 0 4px 0 #2b1712, 0 12px 30px rgba(0, 0, 0, 0.45);
}
.jt-menu[hidden] { display: none; }
.jt-menu button {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer;
  font: inherit; text-transform: uppercase; text-align: left; color: inherit;
  background: transparent; border: 2px solid transparent; border-radius: 6px;
}
.jt-menu button:hover { background: #fffaf0; border-color: #d9bf94; }
.jt-menu button:focus-visible { outline: none; background: #fffaf0; border-color: #e09a28; }
.jt-menu svg { width: 22px; height: 22px; flex: none; shape-rendering: crispEdges; }
.jt-menu .label { flex: 1; }
.jt-menu .state { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #d9bf94; color: #693c24; }
.jt-menu [aria-checked="true"] .state { background: #3fae5c; color: #fffaf0; }
.jt-menu .jt-menu-status { padding: 6px 10px 2px; border-top: 2px dashed #d9bf94; font-size: 10px; color: #8e5632; text-transform: uppercase; }
`;

const ink = (rects: string, fill: string) =>
  rects.split(";").filter(Boolean).map((r) => {
    const [x, y, w, h] = r.split(",").map(Number);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  }).join("");

// 12x12 pixel icons, drawn with rects so they stay crisp
const svg = (body: string, bg = "") => `<svg viewBox="0 0 12 12" aria-hidden="true">${bg}${body}</svg>`;
const ICONS = {
  gear: svg(ink("5,0,2,2;5,10,2,2;0,5,2,2;10,5,2,2;2,2,2,2;8,2,2,2;2,8,2,2;8,8,2,2;3,3,6,6", "#f1e2c4") + ink("5,5,2,2", "#23253a")),
  journal: svg(ink("1,2,4,8;7,2,4,8", "#fffaf0") + ink("5,3,2,8", "#a78560") + ink("2,4,2,1;2,6,2,1;8,4,2,1;8,6,2,1", "#8e5632") + ink("9,1,1,4", "#ff6fa8"), ink("0,1,12,10", "#45261a")),
  save: svg(ink("1,1,10,10", "#693c24") + ink("3,1,6,4", "#f1e2c4") + ink("3,7,6,3", "#d9bf94") + ink("7,2,1,2", "#693c24")),
  share: svg(ink("2,5,2,2;8,2,2,2;8,8,2,2", "#e09a28") + ink("4,5,1,1;5,4,1,1;6,3,1,1;7,3,1,1;4,6,1,1;5,7,1,1;6,8,1,1;7,8,1,1", "#693c24")),
  photo: svg(ink("0,3,12,8;3,2,4,1", "#693c24") + ink("4,4,4,6;3,5,6,4", "#f1e2c4") + ink("5,6,2,2", "#23253a") + ink("9,4,2,1", "#e09a28")),
  music: svg(ink("4,1,6,1;4,2,1,6;9,2,1,6;2,7,3,3;7,7,3,3", "#693c24")),
  sound: svg(ink("1,4,2,4;3,3,1,6;4,2,1,8;5,1,1,10", "#693c24") + ink("7,5,1,2;8,3,1,1;8,8,1,1;9,4,1,4;10,2,1,1;10,9,1,1;11,3,1,6", "#e09a28")),
  // seasonal decor: a little carved pumpkin
  season: svg(
    ink("5,0,2,3", "#5e5c22") + ink("2,3,8,1;1,4,10,6;2,10,8,1", "#e2701a") + ink("1,5,1,4;4,4,1,6;7,4,1,6", "#b8480c")
      + ink("3,5,2,2;7,5,2,2;3,8,6,1;4,9,4,1", "#ffe88a"),
  ),
};

type AudioWithMusic = TankAudio & { music?: boolean; setMusic?(on: boolean): void };

export interface SettingsHandlers {
  journal(): void;
  share(): void;
  backup(): void;
  restore(): void;
  photo(): void;
  /** the "Seasonal decor" setting (Halloween pumpkins, the bat...): omitted = no toggle in the menu */
  seasonDecor?: { get(): boolean; set(on: boolean): void };
}

export interface Settings {
  readonly isOpen: boolean;
  close(): void;
  /** A status line at the foot of the menu (the synced copy's cloud save); null hides it. */
  setStatus(text: string | null): void;
}

/** Artboard rect of the gear: the hood's right end (the hood is y 0..42). */
const AT = { x: 660, y: 4, w: 44, h: 30 };

export function createSettings(
  audio: AudioWithMusic,
  canvas: HTMLCanvasElement,
  artToClient: (x: number, y: number) => { x: number; y: number },
  on: SettingsHandlers,
): Settings {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "jt-gear";
  gear.innerHTML = ICONS.gear;
  gear.setAttribute("aria-label", "Settings");
  gear.setAttribute("aria-haspopup", "menu");
  gear.setAttribute("aria-expanded", "false");
  gear.title = "Settings";

  const menu = document.createElement("ul");
  menu.className = "jt-menu";
  menu.id = "jt-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  gear.setAttribute("aria-controls", menu.id);

  const item = (cls: string, icon: string, label: string, toggle: boolean, act: () => void) => {
    const li = document.createElement("li");
    li.setAttribute("role", "none");
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.setAttribute("role", toggle ? "menuitemcheckbox" : "menuitem");
    b.innerHTML = `${icon}<span class="label">${label}</span>${toggle ? '<span class="state"></span>' : ""}`;
    b.addEventListener("click", () => {
      audio.unlock();
      act();
      sync();
    });
    li.append(b);
    menu.append(li);
    return b;
  };
  const close = () => {
    menu.hidden = true;
    gear.setAttribute("aria-expanded", "false");
  };
  item("jt-menu-journal", ICONS.journal, "Jelly journal", false, () => {
    close();
    on.journal();
  });
  item("jt-menu-share", ICONS.share, "Share your tank", false, () => {
    close();
    on.share();
  });
  item("jt-menu-photo", ICONS.photo, "Take a photo", false, () => {
    close();
    on.photo();
  });
  item("jt-menu-backup", ICONS.save, "Back up save", false, () => {
    close();
    on.backup();
  });
  item("jt-menu-restore", ICONS.save, "Restore save", false, () => {
    close();
    on.restore();
  });
  const music = item("jt-menu-music", ICONS.music, "Music", true, () => audio.setMusic?.(!audio.music));
  if (typeof audio.setMusic !== "function") (music.parentElement as HTMLElement).hidden = true;
  const sound = item("jt-menu-sound", ICONS.sound, "Sound", true, () => audio.setMuted(!audio.muted));
  const decor = on.seasonDecor;
  const season = item("jt-menu-season", ICONS.season, "Seasonal decor", true, () => decor?.set(!decor.get()));
  if (!decor) (season.parentElement as HTMLElement).hidden = true;
  const status = document.createElement("li");
  status.className = "jt-menu-status";
  status.setAttribute("role", "none");
  status.hidden = true;
  menu.append(status);

  function sync() {
    music.setAttribute("aria-checked", String(!!audio.music));
    (music.querySelector(".state") as HTMLElement).textContent = audio.music ? "On" : "Off";
    sound.setAttribute("aria-checked", String(!audio.muted));
    (sound.querySelector(".state") as HTMLElement).textContent = audio.muted ? "Off" : "On";
    const decorOn = decor?.get() ?? false;
    season.setAttribute("aria-checked", String(decorOn));
    (season.querySelector(".state") as HTMLElement).textContent = decorOn ? "On" : "Off";
  }
  sync();

  gear.addEventListener("click", () => {
    audio.unlock();
    if (menu.hidden) {
      sync();
      menu.hidden = false;
      gear.setAttribute("aria-expanded", "true");
      place();
      (menu.querySelector("button") as HTMLButtonElement).focus({ preventScroll: true });
    } else {
      close();
    }
  });
  // a press anywhere else puts the menu away (capture, so it runs before the tank sees the press)
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== gear && !gear.contains(e.target as Node)) close();
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      close();
      gear.focus({ preventScroll: true });
    }
    if ((e.key === "m" || e.key === "M") && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      audio.setMuted(!audio.muted);
      sync();
    }
  });
  // the game is portrait: a phone held sideways gets asked to turn upright (CSS shows it only then)
  const rotate = document.createElement("div");
  rotate.className = "jt-rotate";
  rotate.setAttribute("role", "status");
  rotate.innerHTML = `<div class="phone" aria-hidden="true"></div><div>Turn your phone upright<br>to see the tank</div>`;
  document.body.append(gear, menu, rotate);

  function place() {
    const a = artToClient(AT.x, AT.y);
    const c = artToClient(AT.x + AT.w, AT.y + AT.h);
    // never smaller than 36 px to look at (it may overhang the thin top bar on phones), right-aligned to the art
    const w = Math.max(36, c.x - a.x);
    const h = Math.max(36, c.y - a.y);
    const top = Math.max(4, (a.y + c.y) / 2 - h / 2);
    Object.assign(gear.style, { left: `${c.x - w}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    // the menu hangs below the gear, right-aligned to it, and never off the screen's left edge
    const mw = menu.offsetWidth || 210;
    Object.assign(menu.style, { left: `${Math.max(8, c.x - mw)}px`, top: `${top + h + 8}px` });
  }
  new ResizeObserver(place).observe(canvas);
  window.addEventListener("resize", place);
  place();

  return {
    get isOpen() {
      return !menu.hidden;
    },
    close,
    setStatus(text) {
      status.hidden = text === null;
      status.textContent = text ?? "";
    },
  };
}
