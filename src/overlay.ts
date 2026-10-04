/**
 * HTML on top of the canvas: the jelly card (name, species, stage, age, needs,
 * rehoming), name tags and "+N" pops, the first-run tips and the
 * "while you were away" note. Styled to sit inside the pixel tank: cream
 * panel, dark wood border, a pixel font.
 */
import { focusReturn } from "./a11y";

export interface JellyCardInfo {
  name: string;
  species: string;
  stage: string;
  ageDays: number;
  fullness: number;
  mood: number;
  /** v13: its personality as a short line ("Shy — hides by the rocks"); omitted = no line */
  trait?: string;
  /** v16: "Paired with Mochi" when it has a mate; omitted = no line */
  pair?: string;
  /** whether this jelly can be rehomed, what it pays, and why not */
  rehome: { allowed: boolean; reward: number; reason: string };
}

export interface CardHandlers {
  rename(name: string): void;
  rehome(): void;
  /** the card went away (closed, Escape, or after rehoming) */
  closed?(): void;
}

export interface Tip {
  text: string;
  /** where the arrow points, in client coordinates; null centres the bubble */
  target: () => { x: number; y: number } | null;
}

export interface Overlay {
  /** A name tag over a jelly; with a key (the slot), a new tag replaces that jelly's showing one instead of stacking. */
  nameTag(name: string, clientX: number, clientY: number, key?: string | number): void;
  /** a floating "+N" where sand dollars were earned */
  pop(text: string, clientX: number, clientY: number): void;
  openCard(slot: number, info: JellyCardInfo, on: CardHandlers): void;
  updateCard(info: JellyCardInfo | null): void;
  closeCard(): void;
  readonly cardSlot: number | null;
  /** shows tips one at a time; resolves when the last is dismissed */
  tips(list: Tip[]): Promise<void>;
  /** keeps an open tip's arrow on its target (call each frame or on resize) */
  placeTip(): void;
  awayNote(lines: string[]): Promise<void>;
  /** true while a tip or the away note is up (the tank ignores taps then) */
  readonly busy: boolean;
}

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;

const CSS = `
.jt-tag {
  position: fixed; z-index: 5; pointer-events: none;
  transform: translate(-50%, -100%);
  font: 12px/1 ${FONT}; letter-spacing: 0.04em;
  color: #2b1712; background: #f1e2c4; border: 2px solid #45261a; border-radius: 6px;
  padding: 4px 8px 5px; box-shadow: 0 2px 0 #2b1712;
  animation: jt-tag 1.6s ease-out forwards;
}
@keyframes jt-tag {
  0% { opacity: 0; transform: translate(-50%, -80%); }
  12% { opacity: 1; transform: translate(-50%, -100%); }
  75% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -120%); }
}
.jt-panel {
  position: fixed; z-index: 6; box-sizing: border-box;
  font: 12px/1.45 ${FONT}; color: #2b1712;
  background: #f1e2c4; border: 3px solid #45261a; border-radius: 10px;
  box-shadow: inset 0 0 0 3px #d9bf94, 0 4px 0 #2b1712, 0 12px 30px rgba(0, 0, 0, 0.45);
  padding: 14px 16px 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px;
}
.jt-panel[hidden] { display: none; }
.jt-card, .jt-away { left: 50%; top: 42%; transform: translate(-50%, -50%); width: min(300px, calc(100vw - 48px)); }
.jt-card { top: 66%; }
.jt-head { display: flex; align-items: center; gap: 8px; }
.jt-name {
  flex: 1; min-width: 0; width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; color: #2b1712;
  background: #fffaf0; border: 2px solid #a78560; border-radius: 6px; padding: 5px 8px;
}
.jt-panel button { font: inherit; cursor: pointer; }
.jt-panel button:focus-visible, .jt-name:focus-visible { outline: 2px solid #b5541b; outline-offset: 2px; }
.jt-close {
  flex: none; width: 32px; height: 32px; font-size: 14px !important; color: #fffaf0;
  background: #d04a46; border: 2px solid #5a1418; border-radius: 6px; box-shadow: 0 2px 0 #5a1418;
}
.jt-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; color: #693c24; text-transform: uppercase; }
.jt-trait { margin-top: -4px; color: #8e5632; }
.jt-trait[hidden] { display: none; }
.jt-pair { margin-top: -6px; color: #b4466e; }
.jt-pair[hidden] { display: none; }
.jt-row { display: grid; grid-template-columns: 82px minmax(0, 1fr); align-items: center; gap: 8px; text-transform: uppercase; }
.jt-bar { height: 10px; background: #2b1a12; border-radius: 3px; overflow: hidden; }
.jt-bar > i { display: block; height: 100%; width: 50%; box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.35); }
.jt-food > i { background: #ff9f43; }
.jt-mood > i { background: #ff6fa8; }
.jt-hint { color: #8e5632; font-size: 10px; }
.jt-btn {
  justify-self: start; padding: 6px 12px; color: #2b1712; text-transform: uppercase;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px; box-shadow: 0 2px 0 #693c24;
}
.jt-btn:active { transform: translateY(2px); box-shadow: none; }
.jt-btn[disabled] { opacity: 0.55; cursor: default; transform: none; box-shadow: 0 2px 0 #693c24; }
.jt-btn.warn { background: #ffd6c8; border-color: #a0262a; box-shadow: 0 2px 0 #a0262a; }
.jt-rehome-row { display: grid; gap: 4px; border-top: 2px dashed #d9bf94; padding-top: 10px; }
.jt-tip { width: min(260px, calc(100vw - 40px)); gap: 8px; }
.jt-tip::after {
  content: ""; position: absolute; left: var(--ax, 50%); width: 14px; height: 14px; margin-left: -9px;
  background: #f1e2c4; border: 3px solid #45261a; transform: rotate(45deg);
}
.jt-tip.down::after { bottom: -10px; border-top: none; border-left: none; }
.jt-tip.up::after { top: -10px; border-bottom: none; border-right: none; }
.jt-tip.free::after { display: none; }
.jt-tip-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #8e5632; font-size: 10px; }
.jt-away h2 { margin: 0; font: 16px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-away ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.jt-pop {
  position: fixed; z-index: 5; pointer-events: none; transform: translate(-50%, -50%);
  font: 16px/1 ${FONT}; color: #ffcf4a;
  text-shadow: 2px 0 #6b3a12, -2px 0 #6b3a12, 0 2px #6b3a12, 0 -2px #6b3a12, 2px 2px #6b3a12;
  animation: jt-pop 1.2s ease-out forwards;
}
@keyframes jt-pop {
  0% { opacity: 0; transform: translate(-50%, -30%) scale(0.6); }
  15% { opacity: 1; transform: translate(-50%, -60%) scale(1.15); }
  30% { transform: translate(-50%, -70%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -190%); }
}
@media (prefers-reduced-motion: reduce) { .jt-tag, .jt-pop { animation-duration: 0.01s; opacity: 0; } }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

export function createOverlay(): Overlay {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  // ---------------------------------------------------------------- jelly card

  const card = el("div", "jt-panel jt-card", `
    <div class="jt-head">
      <input class="jt-name" id="jt-name" maxlength="12" autocomplete="off" spellcheck="false" aria-label="Name">
      <button class="jt-close" type="button" aria-label="Close">X</button>
    </div>
    <div class="jt-meta"><span class="jt-species"></span><span class="jt-stage"></span><span class="jt-age"></span></div>
    <div class="jt-trait" hidden></div>
    <div class="jt-pair" hidden></div>
    <div class="jt-row"><span>Fullness</span><div class="jt-bar jt-food"><i></i></div></div>
    <div class="jt-row"><span>Happy</span><div class="jt-bar jt-mood"><i></i></div></div>
    <div class="jt-hint">Tap the name to rename</div>
    <div class="jt-rehome-row">
      <button class="jt-btn jt-rehome" type="button" id="jt-rehome">Rehome</button>
      <div class="jt-hint jt-rehome-why"></div>
    </div>`);
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Jelly card");
  document.body.append(card);

  const $ = <T extends Element>(sel: string) => card.querySelector(sel) as T;
  const input = $<HTMLInputElement>(".jt-name");
  const rehomeBtn = $<HTMLButtonElement>(".jt-rehome");
  const rehomeWhy = $<HTMLElement>(".jt-rehome-why");
  const closeBtn = $<HTMLButtonElement>(".jt-close");
  const cardFocus = focusReturn(card);
  let slot: number | null = null;
  let handlers: CardHandlers | null = null;
  let armed = false;
  let last: JellyCardInfo | null = null;

  const commit = () => {
    const v = input.value.trim();
    if (v && handlers) handlers.rename(v);
  };
  const hide = () => {
    if (card.hidden) return;
    commit();
    const h = handlers;
    card.hidden = true;
    slot = null;
    handlers = null;
    armed = false;
    cardFocus.closed();
    h?.closed?.();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") hide();
    e.stopPropagation(); // typing "m" in the name must not mute the sound
  });
  input.addEventListener("change", commit);
  closeBtn.addEventListener("click", hide);
  rehomeBtn.addEventListener("click", () => {
    if (!handlers || !last?.rehome.allowed) return;
    if (!armed) {
      // the frame can't show confirm(), so the button asks twice
      armed = true;
      fillRehome(last);
      return;
    }
    const h = handlers;
    commit();
    handlers = null;
    card.hidden = true;
    slot = null;
    armed = false;
    cardFocus.closed();
    h.rehome();
    h.closed?.();
  });

  const fillRehome = (info: JellyCardInfo) => {
    const r = info.rehome;
    rehomeBtn.disabled = !r.allowed;
    rehomeBtn.classList.toggle("warn", armed && r.allowed);
    rehomeBtn.textContent = armed && r.allowed ? `Tap again to say goodbye` : `Rehome (+${r.reward})`;
    rehomeWhy.textContent = r.allowed
      ? armed
        ? `${info.name} moves to the big ocean. You can't undo this.`
        : "Frees a spot in the tank."
      : r.reason;
  };
  const fill = (info: JellyCardInfo) => {
    last = info;
    $<HTMLElement>(".jt-species").textContent = info.species;
    $<HTMLElement>(".jt-stage").textContent = info.stage;
    const trait = $<HTMLElement>(".jt-trait");
    trait.textContent = info.trait ?? "";
    trait.hidden = !info.trait;
    const pair = $<HTMLElement>(".jt-pair");
    pair.textContent = info.pair ?? "";
    pair.hidden = !info.pair;
    const d = Math.floor(info.ageDays);
    $<HTMLElement>(".jt-age").textContent = d < 1 ? "Born today" : `${d} day${d === 1 ? "" : "s"} old`;
    $<HTMLElement>(".jt-food > i").style.width = `${Math.round(info.fullness * 100)}%`;
    $<HTMLElement>(".jt-mood > i").style.width = `${Math.round(info.mood * 100)}%`;
    fillRehome(info);
  };

  // ---------------------------------------------------------------- floaters

  const el_ = el;
  const tags = new Map<string | number, { el: HTMLElement; timer: ReturnType<typeof setTimeout> }>();
  const floater = (cls: string, text: string, x: number, y: number, ms: number) => {
    const f = el("div", cls);
    f.textContent = text;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    document.body.append(f);
    setTimeout(() => f.remove(), ms);
  };

  // ---------------------------------------------------------------- tips

  const tip = el("div", "jt-panel jt-tip", `<div class="jt-tip-text"></div>
    <div class="jt-tip-foot"><span class="jt-tip-count"></span><button class="jt-btn" type="button" id="jt-tip-next">Next</button></div>`);
  tip.hidden = true;
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-label", "Tip");
  tip.setAttribute("aria-live", "polite");
  const tipFocus = focusReturn(tip);
  let endTips: (() => void) | null = null;
  document.body.append(tip);
  const tipText = tip.querySelector(".jt-tip-text") as HTMLElement;
  const tipCount = tip.querySelector(".jt-tip-count") as HTMLElement;
  const tipNext = tip.querySelector("#jt-tip-next") as HTMLButtonElement;
  let tipTarget: Tip["target"] | null = null;

  const placeTip = () => {
    if (tip.hidden || !tipTarget) return;
    const t = tipTarget();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.classList.remove("up", "down", "free");
    if (!t) {
      tip.classList.add("free");
      tip.style.left = `${(innerWidth - w) / 2}px`;
      tip.style.top = `${innerHeight * 0.35}px`;
      return;
    }
    const left = Math.min(Math.max(12, t.x - w / 2), innerWidth - w - 12);
    const above = t.y - h - 18 > 8;
    tip.classList.add(above ? "down" : "up");
    tip.style.left = `${left}px`;
    tip.style.top = `${above ? t.y - h - 18 : t.y + 18}px`;
    tip.style.setProperty("--ax", `${Math.min(Math.max(16, t.x - left), w - 16)}px`);
  };

  // ---------------------------------------------------------------- away note

  const away = el("div", "jt-panel jt-away", `<h2>While you were away</h2><ul></ul>
    <button class="jt-btn" type="button" id="jt-away-ok">Back to the tank</button>`);
  away.hidden = true;
  away.setAttribute("role", "dialog");
  away.setAttribute("aria-label", "While you were away");
  document.body.append(away);
  const awayFocus = focusReturn(away);
  const awayOk = away.querySelector("#jt-away-ok") as HTMLButtonElement;

  // Escape closes the card, puts the away note away, or skips the rest of the tips
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!card.hidden) hide();
    else if (!away.hidden) awayOk.click();
    else if (!tip.hidden) endTips?.();
  });

  return {
    pop(text, clientX, clientY) {
      floater("jt-pop", text, clientX, clientY, 1300);
    },
    nameTag(name, clientX, clientY, key) {
      if (key === undefined) {
        floater("jt-tag", name, clientX, clientY, 1700);
        return;
      }
      const old = tags.get(key);
      if (old) {
        clearTimeout(old.timer);
        old.el.remove();
      }
      const el = el_("div", "jt-tag");
      el.textContent = name;
      el.style.left = `${clientX}px`;
      el.style.top = `${clientY}px`;
      document.body.append(el);
      const timer = setTimeout(() => {
        el.remove();
        tags.delete(key);
      }, 1700);
      tags.set(key, { el, timer });
    },
    openCard(s, info, on) {
      if (card.hidden) cardFocus.opened();
      slot = s;
      handlers = on;
      armed = false;
      input.value = info.name;
      fill(info);
      card.setAttribute("aria-label", `${info.name}'s card`);
      card.hidden = false;
      closeBtn.focus({ preventScroll: true });
    },
    updateCard(info) {
      if (card.hidden) return;
      if (!info) {
        hide();
        return;
      }
      fill(info);
    },
    closeCard: hide,
    get cardSlot() {
      return slot;
    },
    tips(list) {
      return new Promise((resolve) => {
        let i = 0;
        tipFocus.opened();
        const show = () => {
          const t = list[i];
          if (!t) {
            tip.hidden = true;
            tipTarget = null;
            endTips = null;
            tipFocus.closed();
            resolve();
            return;
          }
          tipText.textContent = t.text;
          tipCount.textContent = `${i + 1} / ${list.length}`;
          tipNext.textContent = i === list.length - 1 ? "Got it" : "Next";
          tipTarget = t.target;
          tip.hidden = false;
          placeTip();
          tipNext.focus({ preventScroll: true });
        };
        tipNext.onclick = () => {
          i++;
          show();
        };
        endTips = () => {
          i = list.length;
          show();
        };
        show();
      });
    },
    placeTip,
    awayNote(lines) {
      return new Promise((resolve) => {
        const ul = away.querySelector("ul") as HTMLUListElement;
        ul.replaceChildren(...lines.map((l) => Object.assign(document.createElement("li"), { textContent: l })));
        if (away.hidden) awayFocus.opened();
        away.hidden = false;
        awayOk.focus({ preventScroll: true });
        awayOk.onclick = () => {
          away.hidden = true;
          awayFocus.closed();
          resolve();
        };
      });
    },
    get busy() {
      return !tip.hidden || !away.hidden;
    },
  };
}
