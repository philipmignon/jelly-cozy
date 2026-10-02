/**
 * The daily requests note (v12): a little paper note pinned in the hood strip, left of the settings
 * gear. Tapping it opens a short list of today's requests with their progress (2/3), a check when
 * done and what each pays. HTML over the canvas, placed in artboard coordinates like the gear.
 */

export interface RequestNoteItem {
  text: string;
  progress: number;
  n: number;
  done: boolean;
  reward: number;
}

export interface RequestNote {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Today's requests (re-rendered only when something changed); null or empty hides the note. */
  update(items: RequestNoteItem[] | null): void;
  /** Request i was just finished: the note bobs and a small "Request done!" bubble shows under it. */
  celebrate(i: number): void;
  /** Where to float a "+N" for a finished request (client coordinates, just under the note). */
  anchor(): { x: number; y: number };
}

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-req-btn {
  position: fixed; z-index: 8; padding: 0; cursor: pointer; display: grid; place-items: center; overflow: visible;
  background: #23253a; border: 2px solid #6c7194; border-radius: 6px; box-shadow: 0 2px 0 #15161f;
}
.jt-req-btn[hidden] { display: none; }
.jt-req-btn::after { content: ""; position: absolute; inset: -8px; }
.jt-req-btn:focus-visible { outline: 2px solid #ffcf4a; outline-offset: 2px; }
.jt-req-btn:active { transform: translateY(1px); box-shadow: none; }
.jt-req-btn[aria-expanded="true"] { background: #34374f; border-color: #ffcf4a; }
.jt-req-btn svg { width: 70%; height: 70%; shape-rendering: crispEdges; }
.jt-req-badge {
  position: absolute; right: -6px; top: -6px; min-width: 16px; height: 16px; box-sizing: border-box; padding: 0 3px;
  display: grid; place-items: center; font: 10px/1 ${FONT}; color: #fffaf0;
  background: #d04a46; border: 2px solid #5a1418; border-radius: 4px;
}
.jt-req-badge.all { background: #3fae5c; border-color: #1d5a2c; }
.jt-req-badge[hidden] { display: none; }
.jt-req-btn.bob { animation: jt-req-bob 0.9s ease-out; }
@keyframes jt-req-bob { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(-8deg) scale(1.12); } 45% { transform: rotate(6deg); } 70% { transform: rotate(-3deg); } }
.jt-req-panel {
  position: fixed; z-index: 8; width: min(280px, calc(100vw - 24px)); box-sizing: border-box; margin: 0; padding: 14px 12px 10px;
  display: grid; gap: 8px; font: 12px/1.35 ${FONT}; color: #2b1712;
  background: #fff6dc; border: 3px solid #45261a; border-radius: 4px 4px 10px 10px;
  box-shadow: inset 0 0 0 2px #f1e2c4, inset 0 -5px 0 #f1e2c4, 0 4px 0 #2b1712, 0 12px 30px rgba(0, 0, 0, 0.45);
  transform: rotate(-1deg);
}
.jt-req-panel[hidden] { display: none; }
.jt-req-panel::before {
  content: ""; position: absolute; left: 50%; top: -8px; width: 12px; height: 12px; margin-left: -6px;
  background: #d04a46; border: 2px solid #5a1418; border-radius: 50%; box-shadow: 0 2px 0 rgba(0, 0, 0, 0.3);
}
.jt-req-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.jt-req-head h2 { margin: 0; font: 13px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-req-x {
  flex: none; width: 28px; height: 28px; font: 12px ${FONT}; color: #fffaf0; cursor: pointer;
  background: #d04a46; border: 2px solid #5a1418; border-radius: 6px; box-shadow: 0 2px 0 #5a1418;
}
.jt-req-x:focus-visible { outline: 2px solid #e09a28; outline-offset: 2px; }
.jt-req-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.jt-req-item {
  display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px;
  padding: 6px 8px; border-bottom: 2px dashed #e3cfa6;
}
.jt-req-item:last-child { border-bottom: none; }
.jt-req-box { width: 14px; height: 14px; box-sizing: border-box; border: 2px solid #8e5632; border-radius: 2px; background: #fffaf0; position: relative; }
.jt-req-item.done .jt-req-box { background: #3fae5c; border-color: #1d5a2c; }
.jt-req-item.done .jt-req-box::after {
  content: ""; position: absolute; left: 3px; top: -1px; width: 4px; height: 7px;
  border: solid #fffaf0; border-width: 0 2px 2px 0; transform: rotate(40deg);
}
.jt-req-text { text-transform: uppercase; font-size: 11px; }
.jt-req-item.done .jt-req-text { color: #a78560; text-decoration: line-through; text-decoration-thickness: 2px; }
.jt-req-side { display: grid; justify-items: end; gap: 2px; font-size: 10px; }
.jt-req-count { color: #693c24; }
.jt-req-pay { color: #8e5632; white-space: nowrap; }
.jt-req-item.done .jt-req-pay { color: #3fae5c; }
.jt-req-foot { color: #8e5632; font-size: 10px; text-align: center; text-transform: uppercase; }
.jt-req-done {
  position: fixed; z-index: 9; pointer-events: none; transform: translate(-50%, 0);
  font: 11px/1 ${FONT}; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;
  color: #fffaf0; background: #3fae5c; border: 2px solid #1d5a2c; border-radius: 6px; padding: 5px 8px 6px;
  box-shadow: 0 2px 0 #1d5a2c; animation: jt-req-done 2.4s ease-out forwards;
}
@keyframes jt-req-done {
  0% { opacity: 0; transform: translate(-50%, -6px) scale(0.8); }
  10% { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
  18% { transform: translate(-50%, 0) scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, 4px); }
}
@media (prefers-reduced-motion: reduce) { .jt-req-btn.bob { animation: none; } .jt-req-done { animation-duration: 2.4s; animation-name: none; } }
`;

const ink = (rects: string, fill: string) =>
  rects.split(";").filter(Boolean).map((r) => {
    const [x, y, w, h] = r.split(",").map(Number);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  }).join("");
// 12x12: a paper note with a red pin and three lines of writing
const NOTE_ICON = `<svg viewBox="0 0 12 12" aria-hidden="true">${ink("2,1,8,10", "#45261a")}${ink("3,2,6,8", "#fff6dc")}${ink("4,4,4,1;4,6,4,1;4,8,3,1", "#a78560")}${ink("5,0,2,2", "#d04a46")}</svg>`;

/** Artboard rect the note sits in: the hood (y 0..42), just left of the gear (x 660..704). */
const GEAR = { x: 660, y: 4, w: 44, h: 30 };
const GAP = 8;

export function createRequestNote(
  canvas: HTMLCanvasElement,
  artToClient: (x: number, y: number) => { x: number; y: number },
  on: { opened?(): void } = {},
): RequestNote {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jt-req-btn";
  btn.innerHTML = `${NOTE_ICON}<span class="jt-req-badge" hidden></span>`;
  btn.setAttribute("aria-label", "Today's requests");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.title = "Today's requests";
  btn.hidden = true;

  const panel = document.createElement("div");
  panel.className = "jt-req-panel";
  panel.id = "jt-req-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Today's requests");
  panel.innerHTML = `<div class="jt-req-head"><h2>Today's requests</h2><button class="jt-req-x" type="button" aria-label="Close">X</button></div>
    <ul class="jt-req-list"></ul><div class="jt-req-foot"></div>`;
  btn.setAttribute("aria-controls", panel.id);
  document.body.append(btn, panel);
  const badge = btn.querySelector(".jt-req-badge") as HTMLElement;
  const list = panel.querySelector(".jt-req-list") as HTMLUListElement;
  const foot = panel.querySelector(".jt-req-foot") as HTMLElement;

  let sig = "";
  let items: RequestNoteItem[] = [];

  const close = () => {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    if (btn.hidden) return;
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    place();
    on.opened?.();
    (panel.querySelector(".jt-req-x") as HTMLButtonElement).focus({ preventScroll: true });
  };
  btn.addEventListener("click", () => (panel.hidden ? open() : close()));
  (panel.querySelector(".jt-req-x") as HTMLButtonElement).addEventListener("click", () => {
    close();
    btn.focus({ preventScroll: true });
  });
  // a press anywhere else puts it away. Bubbling, so the canvas sees it still open on that press first
  // (main.ts: the press that closes it doesn't also pet, pour or pan)
  window.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (!panel.hidden && !panel.contains(t) && !btn.contains(t)) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      close();
      btn.focus({ preventScroll: true });
    }
  });

  const render = () => {
    list.replaceChildren(
      ...items.map((it) => {
        const li = document.createElement("li");
        li.className = `jt-req-item${it.done ? " done" : ""}`;
        li.innerHTML = `<i class="jt-req-box" aria-hidden="true"></i><span class="jt-req-text"></span>
          <span class="jt-req-side"><span class="jt-req-count"></span><span class="jt-req-pay"></span></span>`;
        (li.querySelector(".jt-req-text") as HTMLElement).textContent = it.text;
        (li.querySelector(".jt-req-count") as HTMLElement).textContent = it.n > 1 ? `${it.progress}/${it.n}` : it.done ? "1/1" : "0/1";
        (li.querySelector(".jt-req-pay") as HTMLElement).textContent = it.done ? "Paid" : `+${it.reward}`;
        li.setAttribute("aria-label", `${it.text}, ${it.done ? "done" : `${it.progress} of ${it.n}`}, pays ${it.reward} sand dollars`);
        return li;
      }),
    );
    const left = items.filter((it) => !it.done).length;
    foot.textContent = left ? "New requests every day" : "All done! More tomorrow";
    badge.hidden = items.length === 0;
    badge.classList.toggle("all", left === 0);
    badge.textContent = left ? String(left) : "✓";
  };

  function place() {
    const a = artToClient(GEAR.x, GEAR.y);
    const c = artToClient(GEAR.x + GEAR.w, GEAR.y + GEAR.h);
    // the same size as the gear (it sizes itself the same way), just left of it
    const w = Math.max(36, c.x - a.x);
    const h = Math.max(36, c.y - a.y);
    const top = Math.max(4, (a.y + c.y) / 2 - h / 2);
    const right = c.x - w - GAP;
    Object.assign(btn.style, { left: `${right - w}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    // the paper hangs below the note, centred on it, kept on screen
    const pw = panel.offsetWidth || 280;
    const left = Math.min(Math.max(12, right - w / 2 - pw / 2), innerWidth - pw - 12);
    Object.assign(panel.style, { left: `${left}px`, top: `${top + h + 14}px` });
  }
  new ResizeObserver(place).observe(canvas);
  window.addEventListener("resize", place);

  const anchor = () => {
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom + 24 };
  };

  return {
    get isOpen() {
      return !panel.hidden;
    },
    open,
    close,
    update(next) {
      const s = JSON.stringify(next ?? []);
      if (s === sig) return;
      sig = s;
      items = next ?? [];
      btn.hidden = items.length === 0;
      if (btn.hidden) close();
      render();
      place();
    },
    celebrate(i) {
      const it = items[i];
      btn.classList.remove("bob");
      void btn.offsetWidth; // restart the animation
      btn.classList.add("bob");
      const at = anchor();
      const tag = document.createElement("div");
      tag.className = "jt-req-done";
      tag.setAttribute("role", "status");
      tag.textContent = it ? "Request done!" : "Done!";
      tag.style.left = `${Math.min(Math.max(at.x, 80), innerWidth - 80)}px`;
      tag.style.top = `${at.y + 18}px`;
      document.body.append(tag);
      setTimeout(() => tag.remove(), 2500);
    },
    anchor,
  };
}
