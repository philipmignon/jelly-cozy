import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { swUrl } from "./offline";

const doc = (meta: string | null) => ({ querySelector: () => (meta === null ? null : { content: meta }) }) as unknown as Pick<Document, "querySelector">;

describe("service worker opt-in", () => {
  it("runs only in a production build of a page that asks for it", () => {
    expect(swUrl(doc("sw.js"), {}, true)).toBe("sw.js");
    expect(swUrl(doc("sw.js"), {}, false)).toBeNull(); // the dev server
    expect(swUrl(doc(null), {}, true)).toBeNull(); // tools/page.mjs pages carry no meta
    expect(swUrl(doc("sw.js"), { __JELLYTANK_RIV_B64: "AAAA" }, true)).toBeNull(); // the .riv inlined: a claude.ai page
  });

  it("index.html asks for it and tools/page.mjs doesn't", () => {
    expect(readFileSync("index.html", "utf8")).toContain('<meta name="jellytank-sw" content="sw.js" />');
    expect(readFileSync("tools/page.mjs", "utf8")).not.toContain("jellytank-sw");
  });
});
