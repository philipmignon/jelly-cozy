import { focusReturn } from "./a11y";

/**
 * Keepsake notes (v13): a small card over the tank when a journal milestone leaves something in it: the
 * keepsake's portrait (journal art "keep{m}", from tools/gen.py), the milestone's note and two buttons.
 * Several at once (an older save that already reached them, found on load) share one summary card.
 * HTML over the canvas like the away note; classes are jt-keep-*.
 */
export interface KeepNoteEntry {
  /** the milestone (index into MILESTONES) */
  m: number;
  /** its unlock note: "You've raised three kinds of jelly. A little lighthouse washed up for you." */
  note: string;
  /** the milestone's journal line and its keepsake, for the summary list */
  title: string;
  reward: string;
  /** v16: another portrait than keep{m} (journal-art key: the collection's rewards are sgr0, sgr1), the note's
   *  heading ("A keepsake!") and where "See journal" opens the book (passed to the `journal` callback) */
  art?: string;
  heading?: string;
  place?: string;
}

export interface KeepNote {
  /** shows one note (one entry) or the summary (several); resolves when it's closed */
  show(entries: KeepNoteEntry[]): Promise<void>;
  readonly isOpen: boolean;
}

const ART: Record<string, string> = (() => {
  const mods = import.meta.glob("./journal-art.json", { eager: true, import: "default" }) as Record<string, Record<string, string>>;
  return Object.values(mods)[0] ?? {};
})();

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-keep-note {
  position: fixed; z-index: 7; left: 50%; top: 44%; transform: translate(-50%, -50%);
  width: min(300px, calc(100vw - 48px)); box-sizing: border-box; display: grid; gap: 10px; padding: 14px 16px 16px;
  font: 12px/1.45 ${FONT}; color: #2b1712; text-align: center;
  background: #f1e2c4; border: 3px solid #45261a; border-radius: 10px;
  box-shadow: inset 0 0 0 3px #d9bf94, 0 4px 0 #2b1712, 0 12px 30px rgba(0, 0, 0, 0.45);
  animation: jt-keep-in 0.35s ease-out;
}
.jt-keep-note[hidden] { display: none; }
@keyframes jt-keep-in { from { opacity: 0; transform: translate(-50%, -44%) scale(0.92); } }
.jt-keep-note h2 { margin: 0; font: 16px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-keep-note p { margin: 0; color: #45261a; }
.jt-keep-plate {
  display: grid; place-items: center; height: 120px; border-radius: 6px; overflow: hidden;
  background: radial-gradient(circle at 50% 40%, #8fe0f0, #1f8fc9 55%, #125fa6); box-shadow: inset 0 0 0 3px #45261a;
}
.jt-keep-plate img, .jt-keep-sum img { image-rendering: pixelated; }
.jt-keep-sum { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; text-align: left; }
.jt-keep-sum li { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 8px;
  padding: 3px 6px 3px 3px; border: 2px solid #e09a28; border-radius: 6px; background: #fff2c8; font-size: 11px; }
.jt-keep-sum span.art { display: grid; place-items: center; width: 40px; height: 34px; border-radius: 4px;
  background: linear-gradient(#3ab4e0, #125fa6); box-shadow: inset 0 0 0 2px #45261a; }
.jt-keep-sum b { display: block; font-weight: normal; text-transform: uppercase; color: #8e5632; font-size: 10px; }
.jt-keep-btns { display: flex; justify-content: center; gap: 8px; }
.jt-keep-btns button {
  padding: 6px 12px; font: 12px ${FONT}; color: #2b1712; text-transform: uppercase; cursor: pointer;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px; box-shadow: 0 2px 0 #693c24;
}
.jt-keep-btns button.ok { background: #ffcf4a; border-color: #6b3a12; box-shadow: 0 2px 0 #6b3a12; }
.jt-keep-btns button:active { transform: translateY(2px); box-shadow: none; }
.jt-keep-btns button:focus-visible { outline: 2px solid #e09a28; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .jt-keep-note { animation: none; } }
:root[data-jt-reduce-motion] .jt-keep-note { animation: none; }
`;

/** A portrait scaled by a whole number (every art pixel stays square) to fit maxW x maxH. */
function portrait(key: string, maxW: number, maxH: number): HTMLImageElement {
  const img = new Image();
  img.alt = "";
  img.onload = () => {
    const k = Math.max(1, Math.floor(Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)));
    img.style.width = `${img.naturalWidth * k}px`;
    img.style.height = `${img.naturalHeight * k}px`;
  };
  img.src = ART[key] ?? "";
  return img;
}

/** `journal`: the "See journal" button (opens it on the Keepsakes page; v16: on the entry's `place` when it has one). */
export function createKeepNote(journal: (place?: string) => void): KeepNote {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const card = document.createElement("div");
  card.className = "jt-keep-note";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "jt-keep-note-title"); // its heading names it
  card.setAttribute("aria-live", "polite");
  document.body.append(card);
  const back = focusReturn(card);
  let closeNow: (() => void) | null = null;
  card.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !closeNow) return;
    e.preventDefault();
    e.stopPropagation();
    closeNow();
  });

  return {
    show(entries) {
      return new Promise((resolve) => {
        const one = entries.length === 1;
        card.replaceChildren();
        const h = document.createElement("h2");
        h.id = "jt-keep-note-title";
        h.textContent = one ? entries[0]!.heading ?? "A keepsake!" : "Keepsakes for you";
        card.append(h);
        if (one) {
          const plate = document.createElement("div");
          plate.className = "jt-keep-plate";
          plate.append(portrait(entries[0]!.art ?? `keep${entries[0]!.m}`, 240, 104));
          const p = document.createElement("p");
          p.textContent = entries[0]!.note;
          card.append(plate, p);
        } else {
          const p = document.createElement("p");
          p.textContent = "You reached these milestones before keepsakes existed, so they're in your tank now.";
          const ul = document.createElement("ul");
          ul.className = "jt-keep-sum";
          for (const e of entries) {
            const li = document.createElement("li");
            const art = document.createElement("span");
            art.className = "art";
            art.append(portrait(e.art ?? `keep${e.m}`, 36, 30));
            const text = document.createElement("span");
            const b = document.createElement("b");
            b.textContent = e.title;
            text.append(b, e.reward.charAt(0).toUpperCase() + e.reward.slice(1));
            li.append(art, text);
            ul.append(li);
          }
          card.append(p, ul);
        }
        const btns = document.createElement("div");
        btns.className = "jt-keep-btns";
        const see = Object.assign(document.createElement("button"), { type: "button", textContent: "See journal" });
        const ok = Object.assign(document.createElement("button"), { type: "button", className: "ok", textContent: "Lovely" });
        btns.append(see, ok);
        card.append(btns);
        back.opened();
        card.hidden = false;
        ok.focus({ preventScroll: true });
        const close = () => {
          closeNow = null;
          card.hidden = true;
          back.closed();
          resolve();
        };
        closeNow = close;
        ok.onclick = close;
        see.onclick = () => {
          close();
          journal(entries.length === 1 ? entries[0]!.place : undefined);
        };
      });
    },
    get isOpen() {
      return !card.hidden;
    },
  };
}
