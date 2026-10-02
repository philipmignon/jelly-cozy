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

  it("saves through the downloads capability, and a declined save is not an error", async () => {
    const calls: { filename: string; data: unknown }[] = [];
    let decline = false;
    const downloads = {
      save: async (req: { filename: string; data: unknown }) => {
        calls.push(req);
        if (decline) throw { code: "declined", message: "no" };
        return { status: "saved" };
      },
    };
    (globalThis as unknown as { window: unknown }).window = { claude: { use: async (n: string) => (n === "downloads" ? downloads : null) } };
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    expect(await savePng(png, "jelly-tank-2026-10-02.png")).toBe("saved");
    expect(calls[0]).toEqual({ filename: "jelly-tank-2026-10-02.png", data: png });
    decline = true;
    expect(await savePng(png, "jelly-tank-2026-10-02.png")).toBe("declined");
  });
});
