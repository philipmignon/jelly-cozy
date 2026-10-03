import { afterEach, describe, expect, it } from "vitest";
import { captionDate, photoFilename, savePng } from "./photo";

describe("photo mode", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("names the file and dates the caption by the local day", () => {
    const t = new Date(2026, 9, 2, 23, 30).getTime();
    expect(photoFilename(t)).toBe("jelly-tank-2026-10-02.png");
    expect(captionDate(t)).toBe("2 OCT 2026");
  });

  it("saves with a plain download link (and says so when there's no page to click it in)", async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const g = globalThis as unknown as { document?: unknown };
    const had = g.document;
    const clicked: { href: string; download: string }[] = [];
    g.document = {
      createElement: () => {
        const a = { href: "", download: "", rel: "", click: () => clicked.push({ href: a.href, download: a.download }), remove: () => {} };
        return a;
      },
      body: { append: () => {} },
    };
    try {
      expect(await savePng(png, "jelly-tank-2026-10-02.png")).toBe("saved");
      expect(clicked).toEqual([{ href: expect.stringMatching(/^blob:/), download: "jelly-tank-2026-10-02.png" }]);
    } finally {
      g.document = had;
    }
    if (had === undefined) expect(await savePng(png, "x.png")).toBe("failed");
  });
});
