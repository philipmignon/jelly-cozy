/**
 * Reference screenshots: the visual flows (flows/visual-*.mjs) render key scenes on the virtual clock and compare
 * each with a committed PNG in tools/e2e/reference/<set>/, pixel by pixel (pixelmatch).
 *
 * Sets: GL output differs by GPU, so there is one set per GPU mode: `metal` (the real GPU on a Mac) and
 * `swiftshader` (software GL: CI, and E2E_GPU=swiftshader anywhere). A set's meta.json says where it was made
 * (platform, Chrome).
 *
 *   native   this run's platform and Chrome major are the set's: a scene must match to `pct` (default 0) of its
 *            pixels. Renders on the virtual clock are byte-identical run to run, so 0 holds.
 *   foreign  another platform or Chrome major (CI's Linux against a set made on a Mac, or a Chrome update): the
 *            HTML text is left out of the comparison (each OS rasterizes the font its own way; the canvas, drawn by
 *            Rive's wasm, doesn't depend on it) and the rest must match to `foreign` (default 0.05%). Every render
 *            is written to shots/visual/ with renderer.json, so `npm run e2e:update-refs -- --from <that dir>`
 *            can make them the set (native again, on that platform).
 *
 * A mismatch writes shots/visual/<scene>-actual.png, -expected.png and -diff.png (red: pixels that differ; blue:
 * what a foreign run left out) and fails its check with the share of pixels that differ. E2E_VISUAL=warn reports a
 * mismatch as a warning instead (a stopgap for when a Chrome update moves pixels and a deploy can't wait).
 * E2E_UPDATE_REFS=1 (`npm run e2e:update-refs`) writes the renders over the references and says what changed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { ROOT, SHOTS } from "./lib.mjs";

export const REFERENCE = join(ROOT, "tools/e2e/reference");
export const OUT = join(SHOTS, "visual");
const UPDATE = () => process.env.E2E_UPDATE_REFS === "1";
const WARN_ONLY = () => process.env.E2E_VISUAL === "warn";

/**
 * Per-pixel colour distance pixelmatch ignores (0..1, its YIQ metric): 0.05 lets a grey move by up to ~13 levels
 * (GPU rounding in the smooth gradients), and still sees the pixel art's palette steps.
 */
const THRESHOLD = 0.05;
/** default tolerances, % of the pixels */
const PCT = 0;
const FOREIGN = 0.05;
/** px of margin around each HTML text box a foreign run leaves out */
const PAD = 2;

/** the reference set for the runner's GPU mode */
export function refSet(gpu) {
  if (process.env.E2E_REF_SET) return process.env.E2E_REF_SET; // (to try one set against another renderer)
  if (gpu === "swiftshader") return "swiftshader";
  return process.platform === "darwin" ? "metal" : `gpu-${process.platform}`;
}

export const decode = (buf) => PNG.sync.read(buf);
/**
 * A reference as small as pngjs gets it (the screenshot's own encoding favours speed): the smallest of three
 * encodings (adaptive filters with default or "filtered" deflate; no filter, which suits the flat panels). About
 * 30% under Chrome's bytes.
 */
export const encode = (png) =>
  [
    { filterType: -1, deflateStrategy: 0 },
    { filterType: -1, deflateStrategy: 1 },
    { filterType: 0, deflateStrategy: 0 },
  ]
    .map((o) => PNG.sync.write(png, { deflateLevel: 9, ...o }))
    .reduce((a, b) => (b.length < a.length ? b : a));

export function readMeta(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

/** where this run renders: the platform and Chrome it compares with a set's meta.json */
export async function renderer(browser) {
  const version = await browser.version(); // "HeadlessChrome/154.0.8037.57"
  return { platform: process.platform, arch: process.arch, chrome: version.replace(/^\D*\//, "") };
}

const major = (v) => String(v ?? "").split(".")[0];

/**
 * The page's visible HTML text, as boxes in CSS px: text nodes, and the text inside form fields. A foreign run
 * leaves these out. (Run in the page.)
 */
export function textBoxes() {
  const out = [];
  const add = (b) => b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth && out.push([b.left, b.top, b.right, b.bottom]);
  // drawn at all: not hidden, transparent or clipped away (the screen-reader-only live regions are 1 px, clipped)
  const drawn = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.clipPath !== "none" || cs.clip !== "auto") return false;
    }
    return true;
  };
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || !drawn(n.parentElement)) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const b of r.getClientRects()) add(b);
  }
  for (const el of document.querySelectorAll("input, textarea, select")) if (drawn(el)) add(el.getBoundingClientRect());
  return out;
}

/**
 * The visual check for one scene: `png` (a t.shot() buffer) against reference/<set>/<scene>.png.
 * `tol`: { pct, foreign }, % of the pixels allowed to differ. `text`: textBoxes() at the screenshot (dpr 1).
 */
export async function compare(t, scene, png, tol = {}, text = []) {
  const set = refSet(t.gpu);
  const dir = join(REFERENCE, set);
  const ref = join(dir, `${scene}.png`);
  const here = await renderer(t.browser);
  const meta = readMeta(dir);
  const actual = decode(png);
  const name = `visual: ${scene} matches reference/${set}`;
  for (const f of ["actual", "expected", "diff"]) rmSync(join(OUT, `${scene}-${f}.png`), { force: true });

  if (UPDATE()) {
    const what = adopt(dir, scene, actual);
    // where the set was made (the same for every scene of a run, so the two visual flows writing it agree)
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify({ set, ...here }, null, 1)}\n`);
    t.warn({ reference: `${set}/${scene}.png`, update: what });
    return t.check(name, true);
  }

  mkdirSync(OUT, { recursive: true });
  if (!existsSync(ref)) {
    writeFileSync(join(OUT, `${scene}-actual.png`), png);
    return t.check(name, false, `no reference yet: run npm run e2e:update-refs${t.gpu === "swiftshader" ? " -- --gpu swiftshader" : ""}; this render is shots/visual/${scene}-actual.png`);
  }
  // (E2E_VISUAL_FOREIGN=1: check as a run on another platform would, to see what CI's Linux checks)
  const foreign = process.env.E2E_VISUAL_FOREIGN === "1" || !meta || meta.platform !== here.platform || major(meta.chrome) !== major(here.chrome);
  const limit = foreign ? (tol.foreign ?? FOREIGN) : (tol.pct ?? PCT);
  const expected = decode(readFileSync(ref));
  const left = foreign ? mask(expected, actual, text) : { hit: null, pct: 0 };
  const d = diff(expected, actual, true);
  tint(d.out, left.hit);
  const ok = d.sized && d.pct <= limit;
  if (foreign) {
    // every render, for adopting as the set on this platform (update-refs --from)
    writeFileSync(join(OUT, `${scene}-actual.png`), png);
    writeFileSync(join(OUT, "renderer.json"), `${JSON.stringify({ set, ...here }, null, 1)}\n`);
  } else rmSync(join(OUT, "renderer.json"), { force: true }); // (an older foreign run's: these renders aren't for adopting)
  if (!ok || d.n > 0) {
    // a difference within the tolerance still gets its pictures (and a warning)
    writeFileSync(join(OUT, `${scene}-actual.png`), png);
    writeFileSync(join(OUT, `${scene}-expected.png`), readFileSync(ref));
    if (d.out) writeFileSync(join(OUT, `${scene}-diff.png`), PNG.sync.write(d.out));
  }
  const how = foreign
    ? ` (foreign: the set is from ${meta?.platform ?? "?"} Chrome ${meta?.chrome ?? "?"}, this is ${here.platform} Chrome ${here.chrome}: HTML text left out (${left.pct.toFixed(1)}% of the screen), ${limit}% allowed)`
    : "";
  const what = d.sized ? `${d.pct.toFixed(3)}% of pixels differ (${d.n} px; ${limit}% allowed): shots/visual/${scene}-diff.png` : `size ${d.size}`;
  if (ok && d.n > 0) t.warn({ scene, differs: `${d.pct.toFixed(3)}% (${d.n} px), within ${limit}%`, diff: `shots/visual/${scene}-diff.png` });
  if (!ok && WARN_ONLY()) {
    t.warn({ scene, mismatch: what, note: "E2E_VISUAL=warn: not failed" });
    return t.check(name + how, true);
  }
  return t.check(name + how, ok, `${what}${foreign ? ". If it's only rendering noise from this renderer, adopt its renders: npm run e2e:update-refs -- --from shots/visual" : ""}`);
}

/**
 * Write `actual` as reference `dir/scene.png` unless it's the same picture; what changed ("new", "unchanged",
 * "1.234% of pixels changed", "resized ...").
 */
export function adopt(dir, scene, actual) {
  const ref = join(dir, `${scene}.png`);
  mkdirSync(dir, { recursive: true });
  let what = "new";
  if (existsSync(ref)) {
    const old = decode(readFileSync(ref));
    const d = diff(old, actual);
    what = !d.sized ? `resized ${d.size}` : Buffer.compare(old.data, actual.data) === 0 ? "unchanged" : `${d.pct.toFixed(3)}% of pixels changed`;
  }
  if (what !== "unchanged") writeFileSync(ref, encode(actual));
  return what;
}

/**
 * Copy the expected pixels over the actual ones in each text box (padded), so they can't differ. Returns the
 * pixels left out (a 0/1 map) and their share in %.
 */
function mask(expected, actual, boxes) {
  if (expected.width !== actual.width || expected.height !== actual.height) return { hit: null, pct: 0 };
  const { width: w, height: h } = actual;
  const hit = new Uint8Array(w * h);
  for (const [l, tp, r, b] of boxes) {
    const x0 = Math.max(0, Math.floor(l) - PAD), x1 = Math.min(w, Math.ceil(r) + PAD);
    const y0 = Math.max(0, Math.floor(tp) - PAD), y1 = Math.min(h, Math.ceil(b) + PAD);
    for (let y = y0; y < y1; y++) hit.fill(1, y * w + x0, y * w + x1);
  }
  let n = 0;
  for (let i = 0; i < hit.length; i++) {
    if (!hit[i]) continue;
    n++;
    expected.data.copy(actual.data, i * 4, i * 4, i * 4 + 4);
  }
  return { hit, pct: (100 * n) / (w * h) };
}

/** the left-out pixels, blue in the diff picture */
function tint(out, hit) {
  if (!out || !hit) return;
  for (let i = 0; i < hit.length; i++) if (hit[i]) out.data.set([60, 110, 255, 255], i * 4);
}

/** pixelmatch, with the share of pixels that differ and (if `image`) the diff picture */
export function diff(a, b, image = false) {
  if (a.width !== b.width || a.height !== b.height) return { sized: false, size: `${a.width}x${a.height} -> ${b.width}x${b.height}`, n: Infinity, pct: Infinity };
  const out = image ? new PNG({ width: a.width, height: a.height }) : null;
  const n = pixelmatch(a.data, b.data, out?.data ?? null, a.width, a.height, { threshold: THRESHOLD, includeAA: true, alpha: 0.25, diffColor: [255, 0, 0] });
  return { sized: true, n, pct: (100 * n) / (a.width * a.height), out };
}
