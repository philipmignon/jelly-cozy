// The budget check's pure parts: what dist/ weighs, and measured numbers against tools/budgets.json.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// GitHub Pages gzips text, JSON and wasm, and sends PNGs and the .riv (octet-stream) as they are (tools/loadtime.mjs)
const wire = (path, buf) => (/\.(riv|png)$/.test(path) ? buf.length : gzipSync(buf, { level: 6 }).length);

/**
 * Bytes over the wire for the built game (dist/), by what they are. `critical.new` is what a new tank (one moon
 * polyp) fetches before its first frame: the page, the main bundle, the Rive runtime, the .riv and the moon's sprites.
 */
export function byteMetrics(dist = "dist") {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p.slice(dist.length + 1).split("\\").join("/"));
    }
  };
  walk(dist);
  const size = Object.fromEntries(files.map((f) => [f, wire(f, readFileSync(join(dist, f)))]));
  const one = (re, what) => {
    const hits = files.filter((f) => re.test(f));
    if (hits.length !== 1) throw new Error(`dist/: expected one ${what} (${re}), found ${hits.length}: ${hits.join(" ")}`);
    return size[hits[0]];
  };
  const sum = (re) => files.filter((f) => re.test(f)).reduce((a, f) => a + size[f], 0);
  const groups = files.filter((f) => /^sprites\/(sp|ev)-[^/]+\.json$/.test(f));
  const m = {
    "bytes.html": one(/^index\.html$/, "page"),
    "bytes.js.main": one(/^assets\/index-[^/]+\.js$/, "main bundle"),
    "bytes.js.room": one(/^assets\/room-[^/]+\.js$/, "room chunk"),
    "bytes.wasm": one(/^assets\/[^/]+\.wasm$/, "Rive runtime"),
    "bytes.riv": one(/^assets\/jellytank-[^/]+\.riv$/, "hashed .riv"),
    "bytes.sprites.moon": one(/^sprites\/sp-moon\.json$/, "moon sprites"),
    "bytes.sprites.largest": Math.max(...groups.map((f) => size[f])),
    "bytes.sprites.all": sum(/^sprites\/[^/]+\.json$/),
    "bytes.sw": one(/^sw\.js$/, "service worker"),
    "bytes.total": sum(/./),
  };
  m["bytes.critical.new"] = m["bytes.html"] + m["bytes.js.main"] + m["bytes.wasm"] + m["bytes.riv"] + m["bytes.sprites.moon"];
  return m;
}

/**
 * Each budget against its measurement. A budget is one of
 *   { budget, tol }   at most budget * (1 + tol)          (bytes, milliseconds, CPU time)
 *   { target, tol }   within target * (1 +- tol)          (the idle tank's 30 fps: more is a battery regression)
 *   { max }           at most max, no tolerance           (a hidden tab: nothing)
 * Rows: { metric, want, limit, got, delta, status: ok | over | under | missing | better }.
 * `better` is a pass that came in under budget * (1 - tol): time to lower the budget (--seed).
 */
export function compare(budgets, measured) {
  return Object.entries(budgets).map(([metric, b]) => {
    const got = measured[metric];
    const row = { metric, unit: b.unit ?? "", want: b.budget ?? b.target ?? b.max, got, limit: "", delta: null, status: "ok" };
    if (typeof got !== "number" || !Number.isFinite(got)) return { ...row, status: "missing" };
    if (b.max !== undefined) return { ...row, limit: `<= ${b.max}`, status: got <= b.max ? "ok" : "over" };
    const tol = b.tol ?? 0.15;
    const base = b.budget ?? b.target;
    const delta = base ? got / base - 1 : 0;
    if (b.target !== undefined) {
      const lo = b.target * (1 - tol);
      const hi = b.target * (1 + tol);
      return { ...row, limit: `${round(lo)}..${round(hi)}`, delta, status: got > hi ? "over" : got < lo ? "under" : "ok" };
    }
    const hi = b.budget * (1 + tol);
    return { ...row, limit: `<= ${round(hi)}`, delta, status: got > hi ? "over" : got < b.budget * (1 - tol) ? "better" : "ok" };
  });
}

const round = (x) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10);

/** The rows as an aligned text table. */
export function table(rows) {
  const fmt = (x, unit) => (typeof x === "number" ? `${unit === "B" ? Math.round(x).toLocaleString("en-US") : round(x)}${unit && unit !== "B" ? ` ${unit}` : ""}` : "-");
  const lines = [["metric", "budget", "limit", "measured", "delta", "status"]];
  for (const r of rows) {
    const status = { ok: "ok", better: "ok (under: lower the budget?)", over: "OVER", under: "UNDER", missing: "MISSING" }[r.status];
    lines.push([r.metric, fmt(r.want, r.unit), r.unit === "B" && r.limit.startsWith("<=") ? `<= ${Math.round(Number(r.limit.slice(3))).toLocaleString("en-US")}` : r.limit, fmt(r.got, r.unit), r.delta === null ? "" : `${r.delta >= 0 ? "+" : ""}${(r.delta * 100).toFixed(1)}%`, status]);
  }
  const w = lines[0].map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  return lines.map((l) => l.map((c, i) => (i === 0 || i === 5 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ").trimEnd()).join("\n");
}

export const failed = (rows) => rows.filter((r) => r.status === "over" || r.status === "under" || r.status === "missing");

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? NaN : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
