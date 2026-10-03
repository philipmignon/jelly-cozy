/**
 * The jelly journal: an HTML book over the tank, one spread per species.
 * Portraits come from src/journal-art.json (written by tools/gen.py);
 * the facts live here.
 */
import { focusReturn } from "./a11y";
import { SPECIES_NAMES } from "./species";
import { FOOD_NAMES, MORPH_CLASSIC, MORPH_GHOST, favouriteFood, morphSeen, type Species } from "./sim";

export interface JournalPage {
  seen: boolean;
  raised: number;
  firstAdultAt: number | null;
  firstName: string | null;
  /** v12: a bitmask of the morph ids raised (morphSeen(page, id)) */
  morphSeen: number;
}

/** One real fact per species, plain and short. */
const FACTS = [
  "The four rings on its bell are its reproductive organs. A moon jelly polyp can keep budding off baby jellies for years.",
  "It has no tentacles around its bell. It catches plankton with eight frilly mouth arms instead.",
  "It rests bell-down on the sand and farms algae inside its own body, like a coral. It needs light to eat.",
  "Not a true jellyfish. Its rainbow flashes are light scattering off rows of beating hairs, not its own glow.",
  "It lives in the Mediterranean, and small fish often shelter among its arms.",
  "Its long tentacles can trail a few metres behind it. Gentle to watch, but its sting is real.",
  "Its green glow led to the discovery of green fluorescent protein, which won the 2008 Nobel Prize in Chemistry.",
  "It rests on the seabed by day and rises at night to hunt small fish.",
  "The largest known jellyfish. One found in 1870 had a bell over 2 metres wide and tentacles about 37 metres long.",
];
const MORPHS = [
  "Golden moon", "Midnight blubber", "Albino", "Gold comb", "Strawberry", "Pastel nettle",
  "Sapphire crystal", "Neon flower hat", "Blue lion's mane",
];
/** v12: the seasonal ghost morph's name per species ("Ghost moon"). */
const GHOSTS = [
  "Ghost moon", "Ghost blubber", "Ghost upside-down", "Ghost comb", "Ghost fried egg", "Ghost nettle",
  "Ghost crystal", "Ghost flower hat", "Ghost lion's mane",
];
/** v12: the morph rows, in order: id, label, names, portrait key suffix (ART[`${k}${suffix}`]). */
const MORPH_ROWS = [
  { id: MORPH_CLASSIC, label: "Rare colour", names: MORPHS, art: "m" },
  { id: MORPH_GHOST, label: "Ghost colour", names: GHOSTS, art: "g" },
] as const;

// the portraits are generated; until they exist the book shows a placeholder dot
const ART: Record<string, string> = (() => {
  const mods = import.meta.glob("./journal-art.json", { eager: true, import: "default" }) as Record<string, Record<string, string>>;
  return Object.values(mods)[0] ?? {};
})();

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-book {
  position: fixed; z-index: 7; left: 50%; top: 46%; transform: translate(-50%, -50%);
  width: min(340px, calc(100vw - 32px)); box-sizing: border-box;
  font: 12px/1.45 ${FONT}; color: #2b1712;
  background: #6e3f26; border: 3px solid #2b1712; border-radius: 12px; padding: 10px;
  box-shadow: 0 4px 0 #2b1712, 0 16px 40px rgba(0, 0, 0, 0.5);
}
.jt-book[hidden] { display: none; }
.jt-pages {
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 14px 14px 12px;
  background: #f1e2c4; border-radius: 6px; box-shadow: inset 0 0 0 3px #d9bf94, inset 0 -6px 0 #e3cfa6;
}
.jt-book-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.jt-book-head h2 { margin: 0; font: 15px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-book-x {
  flex: none; width: 30px; height: 30px; font: 13px ${FONT}; color: #fffaf0; cursor: pointer;
  background: #d04a46; border: 2px solid #5a1418; border-radius: 6px; box-shadow: 0 2px 0 #5a1418;
}
.jt-book-plate {
  display: grid; place-items: center; height: 170px; border-radius: 6px; overflow: hidden;
  background: linear-gradient(#5cc8e6, #1f8fc9 60%, #125fa6); box-shadow: inset 0 0 0 3px #45261a;
}
.jt-book-plate img { image-rendering: pixelated; max-width: 92%; }
.jt-book-plate.unknown img { opacity: 0.7; }
.jt-book-name { margin: 0; font: 16px/1.2 ${FONT}; text-transform: uppercase; }
.jt-book-fact { margin: 0; color: #45261a; }
.jt-book-stats { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; margin: 0; color: #693c24; text-transform: uppercase; font-size: 11px; }
.jt-book-stats dd { margin: 0; color: #2b1712; }
.jt-book-morphs { display: grid; gap: 4px; }
.jt-book-morphs[hidden] { display: none; }
.jt-book-morph { display: flex; align-items: center; gap: 8px; min-height: 24px; padding: 4px 8px; border: 2px dashed #d9bf94; border-radius: 6px; font-size: 11px; text-transform: uppercase; color: #8e5632; }
.jt-book-morph b { font-weight: normal; color: #8e5632; }
.jt-book-morph.found b { color: #8e5632; }
.jt-book-morph.ghost.found { border-color: #8f86c8; color: #3c3466; background: #ece8ff; }
.jt-book-morph img { image-rendering: pixelated; }
.jt-book-morph.found { border-style: solid; border-color: #e09a28; color: #6b3a12; background: #fff2c8; }
.jt-book-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.jt-book-nav button {
  min-width: 44px; height: 32px; font: 14px ${FONT}; color: #2b1712; cursor: pointer;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px; box-shadow: 0 2px 0 #693c24;
}
.jt-book-nav button:focus-visible, .jt-book-x:focus-visible { outline: 2px solid #b5541b; outline-offset: 2px; }
.jt-book-dots { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; }
.jt-book-dots i { width: 8px; height: 8px; border-radius: 2px; background: #d9bf94; }
.jt-book-dots i.seen { background: #a78560; }
.jt-book-dots i.here { background: #e09a28; }
.jt-book-count { color: #8e5632; font-size: 11px; text-align: center; }
`;

export interface Journal {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createJournal(pages: () => JournalPage[]): Journal {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const book = document.createElement("div");
  book.className = "jt-book";
  book.hidden = true;
  book.setAttribute("role", "dialog");
  book.setAttribute("aria-label", "Jelly journal");
  book.innerHTML = `<div class="jt-pages">
    <div class="jt-book-head"><h2>Jelly journal</h2><button class="jt-book-x" type="button" aria-label="Close">X</button></div>
    <div class="jt-book-plate"><img alt=""></div>
    <h3 class="jt-book-name"></h3>
    <p class="jt-book-fact"></p>
    <dl class="jt-book-stats"></dl>
    <div class="jt-book-morphs">${MORPH_ROWS.map((m) => `<div class="jt-book-morph${m.id === MORPH_GHOST ? " ghost" : ""}"><img alt=""><span><b>${m.label}:</b> <i></i></span></div>`).join("")}</div>
    <div class="jt-book-nav"><button type="button" class="prev" aria-label="Previous page">&lt;</button>
      <div><div class="jt-book-dots"></div><div class="jt-book-count"></div></div>
      <button type="button" class="next" aria-label="Next page">&gt;</button></div>
  </div>`;
  document.body.append(book);
  const $ = <T extends Element>(sel: string) => book.querySelector(sel) as T;
  let page = 0;
  // portraits are tiny (logical pixels): scale by a whole number so every pixel stays square
  const fit = (img: HTMLImageElement, maxW: number, maxH: number) => {
    img.onload = () => {
      const k = Math.max(1, Math.floor(Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)));
      img.style.width = `${img.naturalWidth * k}px`;
      img.style.height = `${img.naturalHeight * k}px`;
    };
  };
  fit($<HTMLImageElement>(".jt-book-plate img"), 260, 156);
  book.querySelectorAll<HTMLImageElement>(".jt-book-morph img").forEach((img) => fit(img, 60, 40));

  const render = () => {
    const all = pages();
    const p = all[page] ?? { seen: false, raised: 0, firstAdultAt: null, firstName: null, morphSeen: 0 };
    const known = p.seen;
    const plate = $<HTMLElement>(".jt-book-plate");
    plate.classList.toggle("unknown", !known);
    const img = $<HTMLImageElement>(".jt-book-plate img");
    img.src = (known ? ART[String(page)] : ART[`${page}s`] ?? ART[String(page)]) ?? "";
    img.alt = known ? SPECIES_NAMES[page] ?? "" : "Unknown jelly";
    $<HTMLElement>(".jt-book-name").textContent = known ? SPECIES_NAMES[page] ?? "" : "???";
    $<HTMLElement>(".jt-book-fact").textContent = known ? FACTS[page] ?? "" : "Raise this jelly to fill in its page.";
    const stats: [string, string][] = known
      ? [
          ["Raised", String(p.raised)],
          ["Favourite food", FOOD_NAMES[favouriteFood(page as Species)] ?? "Flakes"],
          ["First adult", p.firstAdultAt ? new Date(p.firstAdultAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Not yet"],
          ["First name", p.firstName ?? "Not yet"],
        ]
      : [];
    $<HTMLElement>(".jt-book-stats").replaceChildren(
      ...stats.flatMap(([k, v]) => [Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v })]),
    );
    // v12: one row per morph: its name and portrait once one has been raised, "???" until then
    $<HTMLElement>(".jt-book-morphs").hidden = !known;
    book.querySelectorAll<HTMLElement>(".jt-book-morph").forEach((row, i) => {
      const m = MORPH_ROWS[i]!;
      const found = morphSeen(p, m.id);
      const art = ART[`${page}${m.art}`];
      row.classList.toggle("found", found);
      const mimg = row.querySelector("img") as HTMLImageElement;
      mimg.hidden = !found || !art;
      mimg.src = found && art ? art : "";
      (row.querySelector("i") as HTMLElement).textContent = found ? m.names[page] ?? "" : "???";
    });
    $<HTMLElement>(".jt-book-dots").replaceChildren(
      ...all.map((q, i) => {
        const d = document.createElement("i");
        if (q.seen) d.className = "seen";
        if (i === page) d.className = "here";
        return d;
      }),
    );
    $<HTMLElement>(".jt-book-count").textContent = `${all.filter((q) => q.seen).length} of ${all.length} found`;
  };
  const turn = (d: number) => {
    const n = pages().length || SPECIES_NAMES.length;
    page = (page + d + n) % n;
    render();
  };
  $<HTMLButtonElement>(".prev").addEventListener("click", () => turn(-1));
  $<HTMLButtonElement>(".next").addEventListener("click", () => turn(1));
  const back = focusReturn(book);
  const close = () => {
    if (book.hidden) return;
    book.hidden = true;
    back.closed();
  };
  $<HTMLButtonElement>(".jt-book-x").addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (book.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") turn(-1);
    if (e.key === "ArrowRight") turn(1);
  });

  return {
    open() {
      render();
      if (book.hidden) back.opened();
      book.hidden = false;
      $<HTMLButtonElement>(".next").focus({ preventScroll: true });
    },
    close,
    get isOpen() {
      return !book.hidden;
    },
  };
}
