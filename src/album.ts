/**
 * The photo album (v14): every photo taken in photo mode is also kept in the game, the last ALBUM_MAX of them
 * (the oldest goes first), each with its date, the tank's theme and the names of the jellies in shot.
 *
 * Photos live in IndexedDB (database jellytank-album, store "photos"), downscaled to half size (WebP where the
 * browser can write it, else PNG) and kept as bytes plus a type, which every browser's IndexedDB stores. Never in
 * localStorage (far too small) and never in the save or its backup codes. Every storage call is wrapped: when
 * IndexedDB is missing or blocked (private windows, a sandboxed frame), openAlbum() gives null and the journal's
 * Album page says the album is unavailable. The demo and visits don't add to it (main.ts).
 *
 * createAlbum() takes any AlbumBackend, so the keeping-the-last-12 rules are tested without a browser.
 */
import { captionDate } from "./photo";
import { dayKey } from "./sim";

/** How many photos the album keeps. */
export const ALBUM_MAX = 12;
/** The downscale for a kept photo. */
export const ALBUM_SCALE = 0.5;

/** What a photo is kept with. */
export interface AlbumMeta {
  /** taken, epoch ms */
  at: number;
  /** the tank theme's name ("Reef") */
  theme: string;
  /** the jellies in shot (or in the tank, if none was in shot) */
  names: string[];
}

export interface AlbumEntry extends AlbumMeta {
  id: number;
  /** the image bytes and their type ("image/webp" or "image/png") */
  data: ArrayBuffer;
  type: string;
  w: number;
  h: number;
}

/** Where the entries are kept (IndexedDB in the page; a Map in the tests). Each call may reject. */
export interface AlbumBackend {
  /** store an entry, returning its new id */
  put(e: Omit<AlbumEntry, "id">): Promise<number>;
  all(): Promise<AlbumEntry[]>;
  remove(id: number): Promise<void>;
}

export interface Album {
  /** Keep a photo (dropping the oldest past ALBUM_MAX); null if it couldn't be stored. */
  add(meta: AlbumMeta, image: { data: ArrayBuffer; type: string; w: number; h: number }): Promise<AlbumEntry | null>;
  /** Newest first; empty if the store can't be read. */
  list(): Promise<AlbumEntry[]>;
  /** Delete one; false if it couldn't be. */
  remove(id: number): Promise<boolean>;
}

/** Newest first: by when it was taken, then by id (two photos in one millisecond keep their order). */
export const newestFirst = (a: Pick<AlbumEntry, "at" | "id">, b: Pick<AlbumEntry, "at" | "id">) => b.at - a.at || b.id - a.id;

/** The ids past the newest `max`: the ones to drop. */
export function overflow(entries: readonly Pick<AlbumEntry, "at" | "id">[], max = ALBUM_MAX): number[] {
  return [...entries].sort(newestFirst).slice(max).map((e) => e.id);
}

export function createAlbum(backend: AlbumBackend, max = ALBUM_MAX): Album {
  return {
    async add(meta, image) {
      try {
        const e: Omit<AlbumEntry, "id"> = { at: meta.at, theme: meta.theme, names: [...meta.names], ...image };
        const id = await backend.put(e);
        for (const old of overflow(await backend.all(), max)) await backend.remove(old);
        return { ...e, id };
      } catch {
        return null;
      }
    },
    async list() {
      try {
        return (await backend.all()).filter(validEntry).sort(newestFirst);
      } catch {
        return [];
      }
    },
    async remove(id) {
      try {
        await backend.remove(id);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** A stored record that is really a photo (anything else in the store is skipped). */
function validEntry(e: unknown): e is AlbumEntry {
  const o = e as Partial<AlbumEntry> | null;
  return !!o && typeof o.id === "number" && typeof o.at === "number" && o.data instanceof ArrayBuffer && typeof o.type === "string" && Array.isArray(o.names);
}

/** "Mochi", "Mochi and Bean", "Mochi, Bean and Pip"; "" for none. */
export function namesLine(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The caption under a photo: "3 OCT 2026 · Reef · Mochi and Bean". */
export const albumCaption = (e: AlbumMeta): string => [captionDate(e.at), e.theme, namesLine(e.names)].filter(Boolean).join(" · ");

/** The file name a kept photo saves as again. */
export const albumFilename = (e: Pick<AlbumEntry, "at" | "id" | "type">): string => `jelly-tank-${dayKey(e.at)}-${e.id}.${e.type === "image/webp" ? "webp" : "png"}`;

// ---------------------------------------------------------------- the browser's side

/** The photo at ALBUM_SCALE, as WebP if the browser writes it (else PNG); null if the canvas can't be read. */
export async function shrink(src: HTMLCanvasElement, scale = ALBUM_SCALE): Promise<{ data: ArrayBuffer; type: string; w: number; h: number } | null> {
  try {
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    const blob = (type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
    let b = await blob("image/webp", 0.86);
    if (!b || b.type !== "image/webp") b = await blob("image/png");
    if (!b) return null;
    return { data: await b.arrayBuffer(), type: b.type || "image/png", w, h };
  } catch {
    return null;
  }
}

const DB = "jellytank-album";
const STORE = "photos";

/** An IDBRequest as a promise. */
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** IndexedDB, or null when there is none or it won't open (in a few seconds). */
export async function idbBackend(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<AlbumBackend | null> {
  if (!factory) return null;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DB, 1);
      // generous: a busy page (first load, a slow GPU) can take seconds to get the success event dispatched
      const timer = setTimeout(() => reject(new Error("album: IndexedDB didn't open")), 10_000);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      };
      open.onsuccess = () => {
        clearTimeout(timer);
        // let go when another tab (or a test) deletes or upgrades the album, rather than leave it blocked
        open.result.onversionchange = () => open.result.close();
        resolve(open.result);
      };
      open.onerror = () => {
        clearTimeout(timer);
        reject(open.error);
      };
      // blocked: another tab still holds an older connection; it lets go on versionchange, so keep waiting (the
      // timer still bounds it)
      open.onblocked = () => {};
    });
    const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      put: async (e) => Number(await req(store("readwrite").add(e))),
      all: async () => (await req(store("readonly").getAll())) as AlbumEntry[],
      remove: async (id) => {
        await req(store("readwrite").delete(id));
      },
    };
  } catch {
    return null;
  }
}

let opened: Promise<Album | null> | null = null;
/** The page's album (opened once it works), or null when the browser won't keep one right now. A failed open
 *  isn't remembered: a slow first try (a busy page) mustn't leave the album unavailable until a reload. */
export function openAlbum(): Promise<Album | null> {
  const p = (opened ??= idbBackend().then((b) => (b ? createAlbum(b) : null), () => null));
  void p.then((a) => {
    if (!a && opened === p) opened = null;
  });
  return p;
}
