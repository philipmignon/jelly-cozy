/** v14: the photo album's keeping rules, without a browser (a Map stands in for IndexedDB). */
import { describe, expect, it } from "vitest";
import { ALBUM_MAX, albumCaption, albumFilename, createAlbum, namesLine, overflow, type AlbumBackend, type AlbumEntry } from "./album";

function mapBackend(fail: Partial<Record<"put" | "all" | "remove", boolean>> = {}): AlbumBackend & { rows: Map<number, AlbumEntry> } {
  const rows = new Map<number, AlbumEntry>();
  let next = 1;
  const no = () => Promise.reject(new Error("blocked"));
  return {
    rows,
    put: (e) => (fail.put ? no() : Promise.resolve(rows.set(next, { ...e, id: next }) && next++)),
    all: () => (fail.all ? no() : Promise.resolve([...rows.values()])),
    remove: (id) => (fail.remove ? no() : Promise.resolve(void rows.delete(id))),
  };
}
const img = () => ({ data: new ArrayBuffer(8), type: "image/webp", w: 360, h: 470 });
const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();

describe("v14: the photo album", () => {
  it("keeps the last 12, newest first, dropping the oldest", async () => {
    const b = mapBackend();
    const album = createAlbum(b);
    for (let d = 1; d <= ALBUM_MAX + 3; d++) expect(await album.add({ at: at(d), theme: "Reef", names: ["Mochi"] }, img())).not.toBe(null);
    const list = await album.list();
    expect(list.length).toBe(ALBUM_MAX);
    expect(list[0]!.at).toBe(at(ALBUM_MAX + 3));
    expect(list[list.length - 1]!.at).toBe(at(4)); // days 1-3 dropped
    expect(b.rows.size).toBe(ALBUM_MAX);
  });

  it("deletes one; a store that throws gives null / [] / false instead of failing", async () => {
    const album = createAlbum(mapBackend());
    const e = (await album.add({ at: at(3), theme: "Arctic", names: [] }, img()))!;
    expect(await album.remove(e.id)).toBe(true);
    expect(await album.list()).toEqual([]);
    const broken = createAlbum(mapBackend({ put: true, all: true, remove: true }));
    expect(await broken.add({ at: at(3), theme: "Reef", names: [] }, img())).toBe(null);
    expect(await broken.list()).toEqual([]);
    expect(await broken.remove(1)).toBe(false);
  });

  it("orders photos taken in the same millisecond by id; overflow lists the ones past the limit", () => {
    const es = [{ id: 1, at: 5 }, { id: 2, at: 5 }, { id: 3, at: 9 }, { id: 4, at: 1 }];
    expect(overflow(es, 2)).toEqual([1, 4]);
    expect(overflow(es, 12)).toEqual([]);
  });

  it("captions: the date, the theme and who was in shot; a file name for saving again", () => {
    expect(namesLine([])).toBe("");
    expect(namesLine(["Mochi"])).toBe("Mochi");
    expect(namesLine(["Mochi", "Bean", "Pip"])).toBe("Mochi, Bean and Pip");
    expect(albumCaption({ at: at(3), theme: "Kelp Forest", names: ["Mochi", "Bean"] })).toBe("3 OCT 2026 · Kelp Forest · Mochi and Bean");
    expect(albumCaption({ at: at(3), theme: "Reef", names: [] })).toBe("3 OCT 2026 · Reef");
    expect(albumFilename({ at: at(3), id: 7, type: "image/webp" })).toBe("jelly-tank-2026-10-03-7.webp");
    expect(albumFilename({ at: at(3), id: 7, type: "image/png" })).toBe("jelly-tank-2026-10-03-7.png");
  });
});
