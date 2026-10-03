/**
 * The journal's Album page (v14): a grid of the kept photos (./album.ts), newest first. Tap one to see it larger
 * with its caption, save it again (the same downloads capability / <a download> path as photo mode) or delete
 * it (the button asks twice, like rehoming). The viewer is a dialog over the book: Escape closes it, the arrow
 * keys step through the photos, focus goes back to the thumbnail it came from (focusReturn).
 */
import { focusReturn } from "./a11y";
import { ALBUM_MAX, albumCaption, albumFilename, type Album, type AlbumEntry } from "./album";
import type { JournalExtraPage } from "./journal";
import type { SaveResult } from "./photo";

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-album-page { display: grid; gap: 6px; }
.jt-album-page[hidden] { display: none; }
.jt-album-note { margin: 0; color: #45261a; }
.jt-album-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.jt-album-thumb {
  display: grid; gap: 2px; width: 100%; padding: 3px; cursor: pointer; font: 9px/1.2 ${FONT}; color: #693c24;
  background: #fffaf0; border: 2px solid #d9bf94; border-radius: 6px; box-shadow: 0 2px 0 #d9bf94;
}
.jt-album-thumb img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 3px; background: #125fa6; }
.jt-album-thumb:focus-visible, .jt-album-view button:focus-visible { outline: 2px solid #b5541b; outline-offset: 2px; }
.jt-album-view {
  position: fixed; z-index: 8; inset: 0; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
  background: rgba(8, 12, 30, 0.55);
}
.jt-album-view[hidden] { display: none; }
.jt-album-frame {
  display: grid; gap: 8px; width: min(340px, 100%); box-sizing: border-box; padding: 12px;
  font: 12px/1.45 ${FONT}; color: #2b1712; background: #f1e2c4; border: 3px solid #2b1712; border-radius: 12px;
  box-shadow: 0 4px 0 #2b1712, 0 16px 40px rgba(0, 0, 0, 0.5);
}
.jt-album-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.jt-album-head h2 { margin: 0; font: 15px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-album-x {
  flex: none; width: 30px; height: 30px; font: 13px ${FONT}; color: #fffaf0; cursor: pointer;
  background: #d04a46; border: 2px solid #5a1418; border-radius: 6px; box-shadow: 0 2px 0 #5a1418;
}
.jt-album-big { display: block; width: 100%; max-height: 52vh; object-fit: contain; border-radius: 6px; background: #125fa6; box-shadow: inset 0 0 0 3px #45261a; }
.jt-album-cap { margin: 0; text-transform: uppercase; font-size: 11px; color: #45261a; }
.jt-album-acts { display: flex; flex-wrap: wrap; gap: 8px; }
.jt-album-acts button {
  padding: 6px 12px; font: 12px ${FONT}; color: #2b1712; text-transform: uppercase; cursor: pointer;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px; box-shadow: 0 2px 0 #693c24;
}
.jt-album-acts button.warn { background: #ffd6c8; border-color: #a0262a; box-shadow: 0 2px 0 #a0262a; }
.jt-album-status { margin: 0; min-height: 1.45em; font-size: 11px; color: #8e5632; }
`;

export interface AlbumPage extends JournalExtraPage {
  /** the photo viewer is open */
  readonly viewing: boolean;
  closeViewer(): void;
}

/**
 * `album` opens the store (null: unavailable); `save` offers a photo's file again (photo.ts savePng).
 */
export function createAlbumPage(album: () => Promise<Album | null>, save: (blob: Blob, filename: string) => Promise<SaveResult>): AlbumPage {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const el = document.createElement("div");
  el.className = "jt-album-page";
  el.hidden = true;
  el.innerHTML = `<h3 class="jt-book-name">Album</h3><p class="jt-album-note"></p><ul class="jt-album-grid" aria-label="Photos"></ul>`;
  const note = el.querySelector(".jt-album-note") as HTMLElement;
  const grid = el.querySelector(".jt-album-grid") as HTMLElement;

  const view = document.createElement("div");
  view.className = "jt-album-view";
  view.hidden = true;
  view.setAttribute("role", "dialog");
  view.setAttribute("aria-modal", "true");
  view.setAttribute("aria-label", "Photo");
  view.innerHTML = `<div class="jt-album-frame">
    <div class="jt-album-head"><h2>Photo</h2><button class="jt-album-x" type="button" aria-label="Close">X</button></div>
    <img class="jt-album-big" alt="">
    <p class="jt-album-cap"></p>
    <div class="jt-album-acts"><button class="jt-album-save" type="button">Save again</button><button class="jt-album-del" type="button">Delete</button></div>
    <p class="jt-album-status" role="status" aria-live="polite"></p>
  </div>`;
  document.body.append(view);
  const $ = <T extends Element>(sel: string) => view.querySelector(sel) as T;
  const big = $<HTMLImageElement>(".jt-album-big");
  const cap = $<HTMLElement>(".jt-album-cap");
  const status = $<HTMLElement>(".jt-album-status");
  const delBtn = $<HTMLButtonElement>(".jt-album-del");
  const saveBtn = $<HTMLButtonElement>(".jt-album-save");

  /** what the page shows now (newest first), and an object URL per photo (revoked when they go) */
  let entries: AlbumEntry[] = [];
  const urls = new Map<number, string>();
  const urlOf = (e: AlbumEntry) => {
    let u = urls.get(e.id);
    if (!u) {
      u = URL.createObjectURL(new Blob([e.data], { type: e.type }));
      urls.set(e.id, u);
    }
    return u;
  };
  const dropUrls = (keep: Set<number> = new Set()) => {
    for (const [id, u] of urls) {
      if (keep.has(id)) continue;
      URL.revokeObjectURL(u);
      urls.delete(id);
    }
  };
  let store: Album | null = null;
  let gen = 0; // a newer render wins over a slower older one
  let count: (text: string) => void = () => {};

  const fill = async () => {
    const mine = ++gen;
    const a = await album();
    if (mine !== gen) return;
    store = a;
    if (!a) {
      entries = [];
      grid.replaceChildren();
      note.textContent = "The album is unavailable here: this browser isn't keeping photos for the game.";
      count("Album unavailable");
      return;
    }
    const list = await a.list();
    if (mine !== gen) return;
    entries = list;
    dropUrls(new Set(list.map((e) => e.id)));
    note.textContent = list.length
      ? `Your last ${ALBUM_MAX} photos stay here. Tap one to look closer.`
      : "No photos yet. Take one with Photo in the settings menu and it's kept here too.";
    grid.replaceChildren(
      ...list.map((e) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "jt-album-thumb";
        b.dataset.id = String(e.id);
        b.setAttribute("aria-label", `Photo: ${albumCaption(e)}`);
        const img = document.createElement("img");
        img.alt = "";
        img.src = urlOf(e);
        const date = document.createElement("span");
        date.className = "jt-album-date";
        date.textContent = albumCaption({ ...e, theme: "", names: [] });
        b.append(img, date);
        b.addEventListener("click", () => openViewer(e.id));
        li.append(b);
        return li;
      }),
    );
    count(`${list.length} of ${ALBUM_MAX} photos`);
  };

  // ---------------------------------------------------------------- the viewer

  const back = focusReturn(view);
  let showing: AlbumEntry | null = null;
  let armed = false;
  const disarm = () => {
    armed = false;
    delBtn.classList.remove("warn");
    delBtn.textContent = "Delete";
  };
  const show = (e: AlbumEntry) => {
    showing = e;
    disarm();
    status.textContent = "";
    big.src = urlOf(e);
    big.alt = `Photo of the tank, ${albumCaption(e)}`;
    cap.textContent = albumCaption(e);
  };
  const openViewer = (id: number) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    if (view.hidden) back.opened();
    view.hidden = false;
    show(e);
    saveBtn.focus({ preventScroll: true });
  };
  const closeViewer = () => {
    if (view.hidden) return;
    view.hidden = true;
    showing = null;
    disarm();
    back.closed();
  };
  const stepPhoto = (d: number) => {
    if (!showing || entries.length < 2) return;
    const i = entries.findIndex((x) => x.id === showing!.id);
    show(entries[(i + d + entries.length) % entries.length]!);
  };
  $<HTMLButtonElement>(".jt-album-x").addEventListener("click", closeViewer);
  view.addEventListener("click", (ev) => {
    if (ev.target === view) closeViewer(); // a tap outside the photo's frame
  });
  saveBtn.addEventListener("click", async () => {
    const e = showing;
    if (!e) return;
    const r = await save(new Blob([e.data], { type: e.type }), albumFilename(e));
    if (showing === e) status.textContent = r === "saved" ? "Saved." : r === "declined" ? "" : "The photo couldn't be saved here.";
  });
  delBtn.addEventListener("click", async () => {
    const e = showing;
    if (!e || !store) return;
    if (!armed) {
      // the frame can't show confirm(), so the button asks twice
      armed = true;
      delBtn.classList.add("warn");
      delBtn.textContent = "Tap again to delete";
      status.textContent = "It's gone for good once deleted.";
      return;
    }
    disarm();
    const ok = await store.remove(e.id);
    if (!ok) {
      status.textContent = "The photo couldn't be deleted.";
      return;
    }
    view.hidden = true;
    showing = null;
    back.closed();
    await fill();
    // the thumbnail it came from is gone: focus the next one, or the page's arrows
    const next = grid.querySelector<HTMLButtonElement>(".jt-album-thumb");
    (next ?? (el.closest(".jt-book")?.querySelector<HTMLButtonElement>(".next") ?? null))?.focus({ preventScroll: true });
  });
  // keys reach the viewer before the book (capture): Escape closes the photo, not the journal; arrows step photos
  window.addEventListener(
    "keydown",
    (ev) => {
      if (view.hidden) return;
      if (ev.key === "Escape") closeViewer();
      else if (ev.key === "ArrowLeft") stepPhoto(-1);
      else if (ev.key === "ArrowRight") stepPhoto(1);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    },
    true,
  );

  return {
    el,
    render(c) {
      count = c;
      void fill();
    },
    hide() {
      gen++;
      closeViewer();
    },
    get viewing() {
      return !view.hidden;
    },
    closeViewer,
  };
}
