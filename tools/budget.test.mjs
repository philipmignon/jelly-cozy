import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byteMetrics, compare, failed, median, table } from "./budget-lib.mjs";

describe("budget comparisons", () => {
  const budgets = {
    js: { budget: 1000, tol: 0.1, unit: "B" },
    fps: { target: 30, tol: 0.15, unit: "fps" },
    hidden: { max: 0.5, unit: "fps" },
    gone: { budget: 5, tol: 0.1 },
  };
  it("a budget allows its tolerance, not a byte more; a target both ways; a max exactly", () => {
    const rows = compare(budgets, { js: 1100, fps: 34.5, hidden: 0.5 });
    expect(rows.map((r) => r.status)).toEqual(["ok", "ok", "ok", "missing"]);
    const bad = compare(budgets, { js: 1101, fps: 25.4, hidden: 0.6, gone: 1 });
    expect(bad.map((r) => r.status)).toEqual(["over", "under", "over", "better"]);
    expect(failed(bad).map((r) => r.metric)).toEqual(["js", "fps", "hidden"]);
    expect(compare({ fps: budgets.fps }, { fps: 35 })[0].status).toBe("over");
  });
  it("NaN counts as missing (a hidden tab that never hid has no number)", () => {
    expect(compare({ hidden: budgets.hidden }, { hidden: NaN })[0].status).toBe("missing");
  });
  it("prints one aligned row per budget, with the delta", () => {
    const t = table(compare(budgets, { js: 1234, fps: 30, hidden: 0 }));
    const lines = t.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toMatch(/^js\s+1,000\s+<= 1,100\s+1,234\s+\+23\.4%\s+OVER$/);
    expect(lines[4]).toMatch(/^gone .* MISSING$/);
  });
  it("median of odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

describe("dist/ byte metrics", () => {
  it("gzips what Pages gzips, counts the .riv as it is, and adds up the new tank's first load", () => {
    const dist = mkdtempSync(join(tmpdir(), "jt-dist-"));
    const put = (p, s) => {
      mkdirSync(join(dist, p, ".."), { recursive: true });
      writeFileSync(join(dist, p), s);
    };
    put("index.html", "<!doctype html>".repeat(50));
    put("sw.js", "self.x=1;".repeat(50));
    put("assets/index-abc.js", "console.log(1);".repeat(500));
    put("assets/room-abc.js", "x");
    put("assets/rive-abc.wasm", Buffer.alloc(5000, 7));
    put("assets/jellytank-abc.riv", Buffer.alloc(3000, 1));
    put("sprites/sp-moon.json", '{"a":1}'.repeat(100));
    put("sprites/sp-comb.json", '{"b":2}'.repeat(300));
    put("sprites/room.json", "{}");
    put("icons/a.png", Buffer.alloc(100, 3));
    const m = byteMetrics(dist);
    expect(m["bytes.riv"]).toBe(3000);
    expect(m["bytes.js.main"]).toBeLessThan(500);
    expect(m["bytes.critical.new"]).toBe(m["bytes.html"] + m["bytes.js.main"] + m["bytes.wasm"] + m["bytes.riv"] + m["bytes.sprites.moon"]);
    expect(m["bytes.sprites.largest"]).toBeGreaterThan(m["bytes.sprites.moon"]); // the comb group, not room.json
    expect(m["bytes.total"]).toBeGreaterThan(m["bytes.critical.new"]);
    put("assets/index-def.js", "y");
    expect(() => byteMetrics(dist)).toThrow(/expected one main bundle/);
    rmSync(dist, { recursive: true, force: true });
  });
  it("tools/budgets.json has a budget for every metric byteMetrics reports", () => {
    const b = JSON.parse(readFileSync(new URL("./budgets.json", import.meta.url), "utf8"));
    const names = ["bytes.html", "bytes.js.main", "bytes.js.room", "bytes.wasm", "bytes.riv", "bytes.sprites.moon", "bytes.sprites.largest", "bytes.sprites.all", "bytes.sw", "bytes.total", "bytes.critical.new"];
    expect(Object.keys(b.bytes).sort()).toEqual(names.sort());
    for (const v of Object.values(b.bytes)) expect(v.budget).toBeGreaterThan(0);
  });
});
