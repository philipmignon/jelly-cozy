/**
 * The jelly journal: an HTML book over the tank, one spread per species.
 * Portraits come from src/journal-art.json (written by tools/gen.py);
 * the facts live here. v13: after the species, a Keepsakes page: each milestone, how far along it is,
 * and the keepsake it leaves (art "keep{m}"). v14: then a Visitors page (the visitor log: every visitor kind,
 * times seen and first seen, "???" until met; art "v{kind}" and its silhouette "v{kind}s") and the photo Album
 * (./albumpage.ts, which draws its own page). v16: the Collection (sea glass and shells, ./collection.ts, its own
 * page too) comes straight after the Keepsakes.
 */
import { focusReturn } from "./a11y";
import { captionDate } from "./photo";
import type { VisitorRow } from "./visitlog";
import { SPECIES_NAMES } from "./species";
import { FOOD_NAMES, MORPH_CLASSIC, MORPH_DUSK, MORPH_GHOST, MORPH_PEARL, favouriteFood, morphSeen, type Species } from "./sim";
import { prefWords } from "./temperature";
import { colourHow } from "./pairs";
import { traitsIn } from "./traits";

export interface JournalPage {
  seen: boolean;
  raised: number;
  firstAdultAt: number | null;
  firstName: string | null;
  /** v12: a bitmask of the morph ids raised (morphSeen(page, id)) */
  morphSeen: number;
  /** v13: a bitmask of the personalities met (bit = trait) */
  traitSeen?: number;
}

/** v13: one milestone on the Keepsakes page (sim's keepsakes(s)). */
export interface KeepsakeRow {
  m: number;
  title: string;
  progress: number;
  n: number;
  earned: boolean;
  /** "a little lighthouse" */
  reward: string;
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
/** v16: the colours only a pair's baby can have, per species. */
const DUSKS = [
  "Dusk moon", "Dusk blubber", "Dusk upside-down", "Dusk comb", "Dusk fried egg", "Dusk nettle",
  "Dusk crystal", "Dusk flower hat", "Dusk lion's mane",
];
const PEARLS = [
  "Pearl moon", "Pearl blubber", "Pearl upside-down", "Pearl comb", "Pearl fried egg", "Pearl nettle",
  "Pearl crystal", "Pearl flower hat", "Pearl lion's mane",
];
/**
 * v12: the morph rows, in order: id, label, names, portrait key suffix (ART[`${k}${suffix}`]), the row's class.
 * v16: the Colours section: classic, ghost, and a pair's dusk and pearl; once raised, how each comes about (colourHow).
 */
const MORPH_ROWS = [
  { id: MORPH_CLASSIC, label: "Rare", names: MORPHS, art: "m", cls: "" },
  { id: MORPH_GHOST, label: "Ghost", names: GHOSTS, art: "g", cls: "ghost" },
  { id: MORPH_DUSK, label: "Dusk", names: DUSKS, art: "d", cls: "dusk" },
  { id: MORPH_PEARL, label: "Pearl", names: PEARLS, art: "p", cls: "pearl" },
] as const;
/** v16: what an unfound pair colour's row says (how is a secret until one is raised) */
const PAIR_HINT = "Only a pair's baby";

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
.jt-book-morphs h4 { margin: 0; font: 11px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-book-morph > span { display: grid; gap: 1px; min-width: 0; }
.jt-book-swatch { flex: none; display: flex; justify-content: center; align-items: flex-start; width: 64px; height: 34px; overflow: hidden; }
.jt-book-swatch:empty, .jt-book-swatch:has(img[hidden]) { width: 0; }
.jt-book-morph em { font-style: normal; font-size: 10px; text-transform: none; color: #8e5632; }
.jt-book-morph em:empty { display: none; }
.jt-book-morphs[hidden] { display: none; }
.jt-book-morph { display: flex; align-items: center; gap: 8px; min-height: 24px; padding: 4px 8px; border: 2px dashed #d9bf94; border-radius: 6px; font-size: 11px; text-transform: uppercase; color: #8e5632; }
.jt-book-morph b { font-weight: normal; color: #8e5632; }
.jt-book-morph.found b { color: #8e5632; }
.jt-book-morph.ghost.found { border-color: #8f86c8; color: #3c3466; background: #ece8ff; }
.jt-book-morph.dusk.found { border-color: #a65aa0; color: #4e1f52; background: #f6e2f2; }
.jt-book-morph.pearl.found { border-color: #a48ca4; color: #4e3a4c; background: #e8e0ea; }
.jt-book-morph img { image-rendering: pixelated; }
.jt-book-morph.found { border-style: solid; border-color: #e09a28; color: #6b3a12; background: #fff2c8; }
.jt-book-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.jt-book-nav button {
  min-width: 44px; height: 32px; font: 14px ${FONT}; color: #2b1712; cursor: pointer;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px; box-shadow: 0 2px 0 #693c24;
}
.jt-book-nav button:focus-visible, .jt-book-x:focus-visible, .jt-vlog-list:focus-visible { outline: 2px solid #b5541b; outline-offset: 2px; }
.jt-book-dots { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; }
.jt-book-dots i { width: 8px; height: 8px; border-radius: 2px; background: #d9bf94; }
.jt-book-dots i.seen { background: #a78560; }
.jt-book-dots i.here { background: #e09a28; }
.jt-book-count { color: #8e5632; font-size: 11px; text-align: center; }
.jt-book-dots i.jt-keep-dot { border-radius: 50%; background: #e3cfa6; box-shadow: inset 0 0 0 2px #e09a28; }
.jt-book-dots i.jt-keep-dot.here { background: #e09a28; }
.jt-keep-page { display: grid; gap: 6px; }
.jt-pages > [hidden] { display: none; } /* v13: the keepsakes page hides the species parts, whatever their display */
.jt-keep-intro { margin: 0; color: #45261a; }
.jt-keep-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.jt-keep-row {
  display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 8px;
  padding: 4px 8px 4px 4px; border: 2px dashed #d9bf94; border-radius: 6px;
}
.jt-keep-row.done { border-style: solid; border-color: #e09a28; background: #fff2c8; }
.jt-keep-art {
  display: grid; place-items: center; width: 44px; height: 40px; border-radius: 4px;
  background: linear-gradient(#3ab4e0, #125fa6); box-shadow: inset 0 0 0 2px #45261a;
}
.jt-keep-art img { image-rendering: pixelated; filter: grayscale(1) brightness(0.55); opacity: 0.7; }
.jt-keep-row.done .jt-keep-art img { filter: none; opacity: 1; }
.jt-keep-text { display: grid; gap: 3px; min-width: 0; font-size: 11px; text-transform: uppercase; }
.jt-keep-text b { font-weight: normal; color: #2b1712; }
.jt-keep-text i { font-style: normal; color: #8e5632; font-size: 10px; }
.jt-keep-bar { height: 6px; background: #e3cfa6; border-radius: 3px; overflow: hidden; }
.jt-keep-bar > i { display: block; height: 100%; background: #e09a28; }
.jt-keep-count { color: #693c24; font-size: 11px; min-width: 28px; text-align: right; }
.jt-keep-row.done .jt-keep-count { color: #2a8a4a; }
/* v14: the visitor log */
.jt-vlog-page { display: grid; gap: 6px; }
.jt-vlog-intro { margin: 0; color: #45261a; }
.jt-vlog-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: min(330px, 46vh); overflow-y: auto; }
.jt-vlog-row {
  display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 8px;
  padding: 4px 8px 4px 4px; border: 2px dashed #d9bf94; border-radius: 6px;
}
.jt-vlog-row.met { border-style: solid; border-color: #e09a28; background: #fff2c8; }
.jt-vlog-row.night.met { border-color: #6f68b8; background: #e8e6ff; }
.jt-vlog-art {
  display: grid; place-items: center; width: 52px; height: 40px; border-radius: 4px; overflow: hidden;
  background: linear-gradient(#3ab4e0, #125fa6); box-shadow: inset 0 0 0 2px #45261a;
}
.jt-vlog-row.night .jt-vlog-art { background: linear-gradient(#2a3f8a, #0e1638); }
.jt-vlog-art img { image-rendering: pixelated; }
.jt-vlog-row:not(.met) .jt-vlog-art img { opacity: 0.75; }
.jt-vlog-text { display: grid; gap: 2px; min-width: 0; font-size: 11px; text-transform: uppercase; }
.jt-vlog-text b { font-weight: normal; color: #2b1712; }
.jt-vlog-text i { font-style: normal; color: #8e5632; font-size: 10px; }
.jt-book-dots i.jt-vlog-dot { border-radius: 50%; background: #e3cfa6; box-shadow: inset 0 0 0 2px #6f68b8; }
.jt-book-dots i.jt-vlog-dot.here { background: #6f68b8; }
.jt-book-dots i.jt-col-dot { border-radius: 50%; background: #e3cfa6; box-shadow: inset 0 0 0 2px #34a08a; }
.jt-book-dots i.jt-col-dot.here { background: #34a08a; }
`;

export type JournalPlace = "keepsakes" | "collection" | "visitors" | "album";

export interface Journal {
  /** opens where it was left; v13: "keepsakes" opens on the Keepsakes page; v14: "visitors", "album" on theirs; v16: "collection" */
  open(at?: JournalPlace): void;
  close(): void;
  readonly isOpen: boolean;
}

/** v14: a page drawn by someone else (the Album), after the journal's own. */
export interface JournalExtraPage {
  /** its markup, placed in the book's pages */
  el: HTMLElement;
  /** fill it in (it's being shown); `count` sets the line under the dots (now or later) */
  render(count: (text: string) => void): void;
  /** it was turned away from (or the book closed) */
  hide?(): void;
}

/** v14: the pages after the species and the keepsakes. */
export interface JournalExtras {
  visitors?: () => VisitorRow[];
  album?: JournalExtraPage;
  /** v16: the Collection drawer (./collection.ts), right after the Keepsakes */
  collection?: JournalExtraPage;
}

/** "3 OCT 2026" for the visitor log. */
const seenDate = (ms: number) => captionDate(ms);

/** `keepsakes` (v13), when given, adds the Keepsakes page after the species; v14: `extras` the Visitors and Album pages. */
export function createJournal(pages: () => JournalPage[], keepsakes?: () => KeepsakeRow[], extras: JournalExtras = {}): Journal {
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
    <div class="jt-book-morphs"><h4>Colours</h4>${MORPH_ROWS.map((m) => `<div class="jt-book-morph${m.cls ? ` ${m.cls}` : ""}" data-morph="${m.id}"><span class="jt-book-swatch"><img alt=""></span><span><span><b>${m.label}:</b> <i></i></span><em></em></span></div>`).join("")}</div>
    <div class="jt-keep-page" hidden><h3 class="jt-book-name">Keepsakes</h3>
      <p class="jt-keep-intro">Reach a milestone and a keepsake turns up in your tank.</p><ul class="jt-keep-list"></ul></div>
    <div class="jt-vlog-page" hidden><h3 class="jt-book-name">Visitors</h3>
      <p class="jt-vlog-intro">Everyone who has dropped by your tank. Some only come out at night.</p><ul class="jt-vlog-list" tabindex="0" aria-label="Visitors"></ul></div>
    <div class="jt-book-nav"><button type="button" class="prev" aria-label="Previous page">&lt;</button>
      <div><div class="jt-book-dots"></div><div class="jt-book-count"></div></div>
      <button type="button" class="next" aria-label="Next page">&gt;</button></div>
  </div>`;
  document.body.append(book);
  const $ = <T extends Element>(sel: string) => book.querySelector(sel) as T;
  if (extras.album) $<HTMLElement>(".jt-book-nav").before(extras.album.el);
  if (extras.collection) $<HTMLElement>(".jt-book-nav").before(extras.collection.el);
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

  /** v14: the pages after the species, in order: the keepsakes, the visitor log, the album (those given) */
  const after: JournalPlace[] = [
    ...(keepsakes ? ["keepsakes" as const] : []),
    ...(extras.collection ? ["collection" as const] : []),
    ...(extras.visitors ? ["visitors" as const] : []),
    ...(extras.album ? ["album" as const] : []),
  ];
  const speciesCount = () => pages().length || SPECIES_NAMES.length;
  /** the species' pages, then the keepsakes page (if any), the visitor log and the album */
  const pageCount = () => speciesCount() + after.length;
  const keepPage = book.querySelector(".jt-keep-page") as HTMLElement;
  const vlogPage = book.querySelector(".jt-vlog-page") as HTMLElement;
  /** which of the pages after the species is showing, if any */
  const placeOf = (p: number): JournalPlace | null => after[p - speciesCount()] ?? null;
  const species = [".jt-book-plate", ".jt-book-name", ".jt-book-fact", ".jt-book-stats"].map((sel) => $<HTMLElement>(sel));
  /** v13: the keepsakes page: one row per milestone, its reward's portrait, a bar and n/total */
  const renderKeepsakes = (rows: KeepsakeRow[]) => {
    $<HTMLElement>(".jt-keep-list").replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.className = `jt-keep-row${r.earned ? " done" : ""}`;
        li.innerHTML = `<span class="jt-keep-art"><img alt=""></span><span class="jt-keep-text"><b></b><i></i><span class="jt-keep-bar"><i></i></span></span><span class="jt-keep-count"></span>`;
        const img = li.querySelector("img") as HTMLImageElement;
        fit(img, 40, 36);
        img.src = ART[`keep${r.m}`] ?? "";
        img.alt = r.reward;
        (li.querySelector("b") as HTMLElement).textContent = r.title;
        (li.querySelector(".jt-keep-text > i") as HTMLElement).textContent = r.earned ? `Earned: ${r.reward}` : `Leaves ${r.reward}`;
        (li.querySelector(".jt-keep-bar > i") as HTMLElement).style.width = `${Math.round((100 * r.progress) / Math.max(1, r.n))}%`;
        (li.querySelector(".jt-keep-count") as HTMLElement).textContent = r.earned ? "✓" : `${r.progress}/${r.n}`;
        return li;
      }),
    );
  };

  /** v14: the visitor log: one row per visitor kind, its portrait (a silhouette until met), times and first seen */
  const renderVisitors = (rows: VisitorRow[]) => {
    $<HTMLElement>(".jt-vlog-list").replaceChildren(
      ...rows.map((r) => {
        const met = r.n > 0;
        const li = document.createElement("li");
        li.className = `jt-vlog-row${met ? " met" : ""}${r.night ? " night" : ""}`;
        li.innerHTML = `<span class="jt-vlog-art"><img alt=""></span><span class="jt-vlog-text"><b></b><i class="jt-vlog-seen"></i><i class="jt-vlog-when"></i></span>`;
        const img = li.querySelector("img") as HTMLImageElement;
        fit(img, 48, 36);
        img.src = (met ? ART[`v${r.kind}`] : ART[`v${r.kind}s`] ?? ART[`v${r.kind}`]) ?? "";
        img.alt = met ? r.name : "Unknown visitor";
        (li.querySelector("b") as HTMLElement).textContent = met ? r.name : "???";
        (li.querySelector(".jt-vlog-seen") as HTMLElement).textContent = met ? `Seen ${r.n === 1 ? "once" : `${r.n} times`}` : "Not met yet";
        (li.querySelector(".jt-vlog-when") as HTMLElement).textContent = met && r.first !== null
          ? `First seen ${seenDate(r.first)}`
          : r.night ? "Comes out at night" : r.season === "halloween" ? "Comes at Halloween" : "Drops by any time";
        li.dataset.kind = r.kind;
        return li;
      }),
    );
  };

  const render = () => {
    const all = pages();
    const place = placeOf(page);
    const onKeep = place === "keepsakes";
    keepPage.hidden = !onKeep;
    vlogPage.hidden = place !== "visitors";
    if (extras.album) {
      extras.album.el.hidden = place !== "album";
      if (place !== "album") extras.album.hide?.();
    }
    if (extras.collection) {
      extras.collection.el.hidden = place !== "collection";
      if (place !== "collection") extras.collection.hide?.();
    }
    for (const el of species) el.hidden = place !== null;
    $<HTMLElement>(".jt-book-morphs").hidden ||= place !== null;
    if (place === "visitors") {
      const rows = extras.visitors!();
      renderVisitors(rows);
      renderDots(all);
      $<HTMLElement>(".jt-book-count").textContent = `${rows.filter((r) => r.n > 0).length} of ${rows.length} visitors met`;
      return;
    }
    if (place === "collection") {
      renderDots(all);
      const count = $<HTMLElement>(".jt-book-count");
      count.textContent = "";
      extras.collection!.render((text) => {
        if (placeOf(page) === "collection") count.textContent = text; // (said at once: the book may be opening)
      });
      return;
    }
    if (place === "album") {
      renderDots(all);
      const count = $<HTMLElement>(".jt-book-count");
      count.textContent = "";
      extras.album!.render((text) => {
        if (placeOf(page) === "album" && !book.hidden) count.textContent = text;
      });
      return;
    }
    if (onKeep) {
      const rows = keepsakes!();
      renderKeepsakes(rows);
      $<HTMLElement>(".jt-book-morphs").hidden = true;
      renderDots(all);
      $<HTMLElement>(".jt-book-count").textContent = `${rows.filter((r) => r.earned).length} of ${rows.length} keepsakes`;
      return;
    }
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
          ["Likes", prefWords(page as Species)], // ---- temperature ----
          ["First adult", p.firstAdultAt ? new Date(p.firstAdultAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Not yet"],
          ["First name", p.firstName ?? "Not yet"],
          ["Personalities", traitsIn(p.traitSeen ?? 0).join(", ") || "Not met yet"],
        ]
      : [];
    $<HTMLElement>(".jt-book-stats").replaceChildren(
      ...stats.flatMap(([k, v]) => [Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v })]),
    );
    // v12: one row per morph: its name and portrait once one has been raised, "???" until then. v16: the Colours
    // section adds a pair's dusk and pearl, and once a colour is raised, how it comes about
    $<HTMLElement>(".jt-book-morphs").hidden = !known;
    book.querySelectorAll<HTMLElement>(".jt-book-morph").forEach((row, i) => {
      const m = MORPH_ROWS[i]!;
      const found = morphSeen(p, m.id);
      const art = ART[`${page}${m.art}`];
      row.classList.toggle("found", found);
      const mimg = row.querySelector("img") as HTMLImageElement;
      mimg.hidden = !found || !art;
      mimg.src = found && art ? art : "";
      mimg.alt = found ? m.names[page] ?? "" : "";
      (row.querySelector("i") as HTMLElement).textContent = found ? m.names[page] ?? "" : "???";
      (row.querySelector("em") as HTMLElement).textContent = found ? colourHow(m.id) : m.id === MORPH_DUSK || m.id === MORPH_PEARL ? PAIR_HINT : "";
    });
    renderDots(all);
    $<HTMLElement>(".jt-book-count").textContent = `${all.filter((q) => q.seen).length} of ${all.length} found`;
  };
  const renderDots = (all: JournalPage[]) => {
    const dots = all.map((q, i) => {
      const d = document.createElement("i");
      if (q.seen) d.className = "seen";
      if (i === page) d.className = "here";
      return d;
    });
    after.forEach((place, i) => {
      const d = document.createElement("i");
      d.className = `${place === "keepsakes" ? "jt-keep-dot" : place === "collection" ? "jt-col-dot" : "jt-vlog-dot"}${page === all.length + i ? " here" : ""}`;
      dots.push(d);
    });
    $<HTMLElement>(".jt-book-dots").replaceChildren(...dots);
  };
  const turn = (d: number) => {
    const n = pageCount();
    page = (page + d + n) % n;
    render();
  };
  $<HTMLButtonElement>(".prev").addEventListener("click", () => turn(-1));
  $<HTMLButtonElement>(".next").addEventListener("click", () => turn(1));
  const back = focusReturn(book);
  const close = () => {
    if (book.hidden) return;
    book.hidden = true;
    extras.album?.hide?.();
    extras.collection?.hide?.();
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
    open(at?: JournalPlace) {
      if (at && after.includes(at)) page = speciesCount() + after.indexOf(at);
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
