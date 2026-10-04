/**
 * The journal's Collection page (v16): the sea glass and shells found (./finds.ts) laid out in a drawer, a slot
 * per kind ("???" and a dark shape until the first one turns up, then its picture and how many), and the two
 * sets with what each leaves in the tank. Classes are jt-col-*.
 *
 * Keyboard: the slots are buttons in one tab stop's worth of grid (the arrow keys move between them and don't
 * turn the book's page while focus is in the drawer); Enter or a tap says what a slot holds in the line under
 * the drawer (a polite live region). The page scrolls on short screens (the scroll area takes focus).
 */
import type { JournalExtraPage } from "./journal";
import { journalArt } from "./journalart";

/** What the page shows (sim.ts collection(s)). */
export interface CollectionData {
  items: { i: number; key: string; name: string; set: number; rare: number; n: number }[];
  sets: { set: number; title: string; hint: string; progress: number; n: number; done: boolean; item: number; reward: string }[];
  total: number;
}

// the portraits load on first need (./journalart.ts); the journal draws this page again once they're in
const ART = new Proxy({} as Record<string, string>, { get: (_, key) => journalArt()[key as string] });

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const COLS = 5;
const RARE = ["", "Rare", "Very rare"];
const CSS = `
.jt-col-page { display: grid; gap: 6px; }
.jt-col-page[hidden] { display: none; }
.jt-col-scroll { display: grid; gap: 8px; max-height: min(400px, 52vh); overflow-y: auto; padding: 2px; }
.jt-col-scroll:focus-visible, .jt-col-slot:focus-visible { outline: 2px solid #b5541b; outline-offset: 2px; }
.jt-col-intro { margin: 0; color: #45261a; }
.jt-col-drawer {
  display: grid; grid-template-columns: repeat(${COLS}, minmax(0, 1fr)); gap: 4px; padding: 6px;
  background: linear-gradient(#8e5632, #693c24); border: 2px solid #2b1712; border-radius: 6px;
  box-shadow: inset 0 2px 0 #b47945, 0 2px 0 #2b1712;
}
.jt-col-label { grid-column: 1 / -1; margin: 2px 0 0; font-size: 10px; text-transform: uppercase; color: #f1e2c4; }
.jt-col-slot {
  position: relative; display: grid; place-items: center; aspect-ratio: 1; min-height: 44px; padding: 0; cursor: pointer;
  font: 9px ${FONT}; color: #a78560; background: #2b1712; border: 2px solid #45261a; border-radius: 4px;
  box-shadow: inset 0 3px 0 rgba(0, 0, 0, 0.35);
}
.jt-col-slot img { image-rendering: pixelated; }
.jt-col-slot:not(.found) img { filter: brightness(0); opacity: 0.4; }
.jt-col-slot.found { background: radial-gradient(circle at 50% 40%, #f1e2c4, #d9bf94); border-color: #e09a28; }
.jt-col-slot b { position: absolute; right: 2px; bottom: 1px; font-weight: normal; font-size: 9px; color: #693c24; }
.jt-col-slot i { position: absolute; left: 2px; top: 1px; font-style: normal; font-size: 9px; color: #b5541b; }
.jt-col-slot:not(.found) b { color: #a78560; }
.jt-col-said { margin: 0; min-height: 1.45em; font-size: 11px; color: #693c24; text-transform: uppercase; }
.jt-col-sets { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
`;

/** A portrait scaled by a whole number so its pixels stay square. */
function fitImg(img: HTMLImageElement, maxW: number, maxH: number): void {
  img.onload = () => {
    const k = Math.max(1, Math.floor(Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)));
    img.style.width = `${img.naturalWidth * k}px`;
    img.style.height = `${img.naturalHeight * k}px`;
  };
}

export function createCollectionPage(data: () => CollectionData): JournalExtraPage {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const el = document.createElement("div");
  el.className = "jt-col-page";
  el.hidden = true;
  el.innerHTML = `<h3 class="jt-book-name">Collection</h3>
    <div class="jt-col-scroll" tabindex="0" aria-label="Collection">
      <p class="jt-col-intro">Scrub the glass, sift the sand with the sponge, watch the bubbler: now and then something turns up for the jar.</p>
      <div class="jt-col-drawer" role="group" aria-label="The drawer"></div>
      <p class="jt-col-said" role="status" aria-live="polite"></p>
      <ul class="jt-col-sets" aria-label="Sets"></ul>
    </div>`;
  const drawer = el.querySelector(".jt-col-drawer") as HTMLElement;
  const said = el.querySelector(".jt-col-said") as HTMLElement;
  const setList = el.querySelector(".jt-col-sets") as HTMLElement;
  let last: CollectionData | null = null;
  let focusAt = 0;

  const slotWords = (it: CollectionData["items"][number]) =>
    it.n > 0 ? `${it.name}${it.rare ? ` (${RARE[it.rare]!.toLowerCase()})` : ""}: found ${it.n === 1 ? "once" : `${it.n} times`}` : "Not found yet";
  const slots = () => [...drawer.querySelectorAll<HTMLButtonElement>(".jt-col-slot")];

  const render = (count: (text: string) => void) => {
    const d = data();
    last = d;
    const rows: HTMLElement[] = [];
    const labels = ["Sea glass", "Shells"];
    d.sets.forEach((st) => {
      const label = document.createElement("p");
      label.className = "jt-col-label";
      label.textContent = labels[st.set] ?? st.title;
      rows.push(label);
      for (const it of d.items.filter((x) => x.set === st.set)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `jt-col-slot${it.n > 0 ? " found" : ""}`;
        b.dataset.i = String(it.i);
        b.tabIndex = it.i === focusAt ? 0 : -1; // one tab stop: the arrows move inside
        const img = document.createElement("img");
        img.alt = "";
        fitImg(img, 40, 34);
        img.src = ART[`sg${it.i}`] ?? "";
        b.append(img);
        if (it.n > 0 && it.rare) b.append(Object.assign(document.createElement("i"), { textContent: "★".repeat(it.rare) }));
        b.append(Object.assign(document.createElement("b"), { textContent: it.n > 0 ? `x${it.n}` : "???" }));
        b.setAttribute("aria-label", it.n > 0 ? `${it.name}, ${it.n}` : "Unknown find");
        b.addEventListener("click", () => {
          focusAt = it.i;
          said.textContent = slotWords(it);
        });
        rows.push(b);
      }
    });
    drawer.replaceChildren(...rows);
    setList.replaceChildren(
      ...d.sets.map((st) => {
        const li = document.createElement("li");
        li.className = `jt-keep-row${st.done ? " done" : ""}`;
        li.innerHTML = `<span class="jt-keep-art"><img alt=""></span><span class="jt-keep-text"><b></b><i></i><span class="jt-keep-bar"><i></i></span></span><span class="jt-keep-count"></span>`;
        const img = li.querySelector("img") as HTMLImageElement;
        fitImg(img, 40, 36);
        img.src = ART[`sgr${st.set}`] ?? "";
        img.alt = st.reward;
        (li.querySelector("b") as HTMLElement).textContent = `${st.title}: ${st.hint.toLowerCase()}`;
        (li.querySelector(".jt-keep-text > i") as HTMLElement).textContent = st.done ? `Earned: ${st.reward}` : `Leaves ${st.reward}`;
        (li.querySelector(".jt-keep-bar > i") as HTMLElement).style.width = `${Math.round((100 * st.progress) / Math.max(1, st.n))}%`;
        (li.querySelector(".jt-keep-count") as HTMLElement).textContent = st.done ? "✓" : `${st.progress}/${st.n}`;
        return li;
      }),
    );
    said.textContent = "";
    const kinds = d.items.filter((it) => it.n > 0).length;
    count(`${kinds} of ${d.items.length} kinds found${d.total ? ` · ${d.total} finds` : ""}`);
  };

  // the arrow keys move between the slots (a 5-wide grid) without turning the book's page
  drawer.addEventListener("keydown", (e) => {
    const list = slots();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? COLS : e.key === "ArrowUp" ? -COLS : e.key === "Home" ? -at : e.key === "End" ? list.length - 1 - at : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const to = list[Math.max(0, Math.min(list.length - 1, at + step))]!;
    for (const b of list) b.tabIndex = b === to ? 0 : -1;
    focusAt = Number(to.dataset.i);
    to.focus();
    const it = last?.items[focusAt];
    if (it) said.textContent = slotWords(it);
  });

  return {
    el,
    render,
    hide() {
      said.textContent = "";
    },
  };
}
