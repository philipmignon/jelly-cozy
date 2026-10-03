import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { swUrl } from "./offline";

const doc = (meta: string | null) => ({ querySelector: () => (meta === null ? null : { content: meta }) }) as unknown as Pick<Document, "querySelector">;

describe("service worker opt-in", () => {
  it("runs only in a production build of a page that asks for it", () => {
    expect(swUrl(doc("sw.js"), true)).toBe("sw.js");
    expect(swUrl(doc("sw.js"), false)).toBeNull(); // the dev server
    expect(swUrl(doc(null), true)).toBeNull(); // a page without the meta
  });

  it("index.html asks for it", () => {
    expect(readFileSync("index.html", "utf8")).toContain('<meta name="jellytank-sw" content="sw.js" />');
  });
});
