/**
 * ---- nursery ---- The nursery's HTML strip, under the open bowl: its little ones as buttons (Tab walks them, Enter
 * opens one's card, P pets it), Feed, and Close. It is a dialog like the others: focus comes back where it was when
 * it closes (focusReturn), and while it's open the tank's own keys wait (keyboard.ts busy()). The bowl itself is
 * drawn in the canvas (tools/gen.py's nursery block); this follows it.
 */
import { focusReturn } from "./a11y";

export interface NurseryRow {
  /** the nursery slot */
  n: number;
  name: string;
  /** "moon jelly polyp, fed, happy" */
  words: string;
  /** grown enough for the tank, waiting for room */
  ready: boolean;
  hungry: boolean;
}

export interface NurseryPanelHost {
  /** the open bowl's box on the page (client px): the strip goes under it */
  bowl(): { x: number; y: number; w: number; h: number };
  /** the player closed it (X, Escape) */
  close(): void;
  card(n: number): void;
  pet(n: number): void;
  feed(): void;
  /** a row has focus (n) or none does (null): the host rings that jelly in the bowl */
  focused(n: number | null): void;
  /** Escape was pressed while it's open: the host puts down what's in hand, or closes it; false: not its to take
   *  (a card or another dialog is over it) */
  escape(): boolean;
}

export interface NurseryPanel {
  readonly isOpen: boolean;
  show(): void;
  hide(): void;
  update(rows: NurseryRow[], cap: number): void;
  place(): void;
}

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-nur { z-index: 5; width: min(340px, calc(100vw - 24px)); gap: 8px; padding: 10px 12px 12px; }
.jt-nur-head { display: flex; align-items: center; gap: 8px; }
.jt-nur-head h2 { flex: 1; margin: 0; font: 14px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-nur-count { color: #8e5632; font-size: 11px; }
.jt-nur-list { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
.jt-nur-jelly {
  width: 100%; min-height: 34px; display: grid; gap: 1px; padding: 4px 8px; text-align: left; color: #2b1712;
  background: #fffaf0; border: 2px solid #d9bf94; border-radius: 6px;
}
.jt-nur-jelly .nm { font-size: 12px; text-transform: none; }
.jt-nur-jelly .st { font-size: 10px; color: #8e5632; text-transform: uppercase; }
.jt-nur-jelly.ready { border-color: #2a8a4a; box-shadow: inset 0 0 0 1px #7ee08a; }
.jt-nur-jelly.ready .st { color: #1e6a38; }
.jt-nur-jelly.hungry .st { color: #b5541b; }
.jt-nur-empty { color: #8e5632; font-size: 11px; grid-column: 1 / -1; }
.jt-nur-keys { color: #8e5632; font-size: 10px; }
@media (pointer: coarse) { .jt-nur-keys { display: none; } }
`;

export function createNurseryPanel(host: NurseryPanelHost): NurseryPanel {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const panel = document.createElement("div");
  panel.className = "jt-panel jt-nur";
  panel.id = "jt-nursery";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Nursery");
  panel.innerHTML = `<div class="jt-nur-head"><h2>Nursery <span class="jt-nur-count"></span></h2>
      <button class="jt-btn jt-nur-feed" type="button">Feed</button>
      <button class="jt-close jt-nur-x" type="button" aria-label="Close the nursery">X</button></div>
    <ul class="jt-nur-list" aria-label="Little ones"></ul>
    <div class="jt-nur-keys" id="jt-nur-keys">Enter: its card · P: pet · F: feed · Esc: close</div>`;
  document.body.append(panel);
  const list = panel.querySelector(".jt-nur-list") as HTMLUListElement;
  const count = panel.querySelector(".jt-nur-count") as HTMLElement;
  const feedBtn = panel.querySelector(".jt-nur-feed") as HTMLButtonElement;
  const closeBtn = panel.querySelector(".jt-nur-x") as HTMLButtonElement;
  const back = focusReturn(panel);
  let sig = "";

  feedBtn.addEventListener("click", () => host.feed());
  closeBtn.addEventListener("click", () => host.close());
  const rowOf = (el: EventTarget | null): number | null => {
    const b = (el as HTMLElement | null)?.closest?.(".jt-nur-jelly") as HTMLElement | null;
    return b ? Number(b.dataset.n) : null;
  };
  list.addEventListener("click", (e) => {
    const n = rowOf(e.target);
    if (n !== null) host.card(n);
  });
  // the ring in the bowl follows keyboard focus only (a tap that opened the bowl also lands focus on the first row)
  const keyFocus = (el: EventTarget | null) => {
    try {
      return (el as HTMLElement).matches(":focus-visible");
    } catch {
      return true;
    }
  };
  panel.addEventListener("focusin", (e) => host.focused(keyFocus(e.target) ? rowOf(e.target) : null));
  panel.addEventListener("focusout", (e) => {
    if (!panel.contains(e.relatedTarget as Node | null)) host.focused(null);
  });
  panel.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const n = rowOf(e.target);
    if (k === "p" && n !== null) host.pet(n);
    else if (k === "f") host.feed();
    else if (k === "n" && n !== null) host.card(n);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden && host.escape()) e.preventDefault();
  });

  const place = () => {
    if (panel.hidden) return;
    const b = host.bowl();
    const w = panel.offsetWidth || 340;
    const h = panel.offsetHeight || 120;
    const left = Math.min(Math.max(12, b.x + b.w / 2 - w / 2), innerWidth - w - 12);
    const top = Math.min(b.y + b.h + 8, innerHeight - h - 8);
    Object.assign(panel.style, { left: `${left}px`, top: `${Math.max(8, top)}px` });
  };
  new ResizeObserver(place).observe(panel);
  window.addEventListener("resize", place);

  return {
    get isOpen() {
      return !panel.hidden;
    },
    show() {
      if (!panel.hidden) return;
      back.opened();
      panel.hidden = false;
      place();
      const first = list.querySelector("button") ?? feedBtn;
      first.focus({ preventScroll: true });
    },
    hide() {
      if (panel.hidden) return;
      panel.hidden = true;
      host.focused(null);
      back.closed();
    },
    update(rows, cap) {
      const s = JSON.stringify([rows, cap]);
      if (s === sig) return;
      sig = s;
      count.textContent = `${rows.length} / ${cap}`;
      const had = rowOf(document.activeElement);
      list.replaceChildren(
        ...(rows.length
          ? rows.map((r) => {
              const li = document.createElement("li");
              const b = document.createElement("button");
              b.type = "button";
              b.className = `jt-nur-jelly${r.ready ? " ready" : ""}${r.hungry ? " hungry" : ""}`;
              b.dataset.n = String(r.n);
              b.innerHTML = `<span class="nm"></span><span class="st"></span>`;
              (b.querySelector(".nm") as HTMLElement).textContent = r.name;
              (b.querySelector(".st") as HTMLElement).textContent = r.ready ? "Ready to move" : r.hungry ? "Hungry" : r.words.split(", ")[0] ?? "";
              b.setAttribute("aria-label", `${r.name}, ${r.words}${r.ready ? ", ready to move to the tank" : ""}`);
              b.setAttribute("aria-describedby", "jt-nur-keys");
              li.append(b);
              return li;
            })
          : [Object.assign(document.createElement("li"), { className: "jt-nur-empty", textContent: "Empty. Babies born while the tank is full come here, or move a polyp in from its card." })]),
      );
      // keep the focus on the same little one (or the list) when a row changes under it
      if (had !== null && !panel.hidden) ((list.querySelector(`[data-n="${had}"]`) as HTMLElement | null) ?? list.querySelector("button") ?? feedBtn).focus({ preventScroll: true });
      place();
    },
    place,
  };
}
