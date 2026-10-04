/**
 * What every e2e flow (tools/e2e/flows/*.mjs) builds on: the static server for dist/, the browser, and the flow
 * context `t` (a fresh browser context, a known save, the test API, checks and screenshots).
 *
 * A flow drives the tank through window.__jt (src/testapi.ts). By default the page runs on the virtual clock
 * (?clock=virtual): nothing moves unless the flow calls t.advance(ms) / t.idle(), so a click on a Rive button is
 * followed by t.advance(...) for Rive to fire its trigger, and the same steps draw the same pixels every run.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const K = JSON.parse(readFileSync(join(ROOT, "src/contract.json"), "utf8"));
export const BASE = "/jelly-cozy/";
export const SHOTS = join(ROOT, "shots");
mkdirSync(SHOTS, { recursive: true });

/** The phone-ish viewport most flows use (as the old single-script e2e did). */
export const VIEW = { width: 480, height: 856 };
/** The virtual clock's start for every flow: a June noon, local time (no season, daytime). */
export const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
export const DAY = 86_400_000;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** "YYYY-MM-DD" in local time, as the sim's dayKey */
export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- saves

/** A jelly as saved: species k, stage g (0 polyp .. 3 adult). */
export const jelly = (k, g, extra = {}) => ({
  k, g, gp: [0, 4, 12, 30][g], care: 0, fullness: 0.8, affection: 0.5, anchor: -1, spot: -1,
  name: ["Mochi", "Tofu", "Bloop", "Pip", "Nori", "Suki", "Momo"][k % 7], born: NOW - 2 * DAY, content: 0, morph: 0, ...extra,
});
export const entry = (raised, extra = {}) => ({ seen: true, raised, firstAdultAt: raised ? NOW - DAY : null, firstName: raised ? "Mochi" : null, morphSeen: 0, ...extra });
export const blank = () => ({ seen: false, raised: 0, firstAdultAt: null, firstName: null, morphSeen: 0 });
/**
 * A known save at NOW (v11 fields; the game migrates it). `slots` is padded to 7. Its keepsakes are in step with
 * it (`keep`): an adult in the tank means the first milestone is already earned (the bottle is in the tank), so no
 * keepsake note comes up over the flow at load. Pass `keep` to test the notes.
 */
export function save(over = {}) {
  const slots = [...(over.slots ?? [jelly(0, 3)])];
  while (slots.length < 7) slots.push(null);
  const adult = slots.some((j) => j && j.g === 3);
  return {
    v: 11, dollars: 0, murk: 0, spots: [], night: false, lamp: null, helpers: [false, false, false], pearlDay: "", lastSeen: NOW, tier: 0, cam: 0,
    foods: [true, false, false], themes: [true, false, false, false, false], theme: 0,
    owned: [false, false, false, false, false, false, false, false, false, false, false],
    keep: { earned: adult ? 1 : 0, days: 1, lastDay: dayKey(NOW), requests: 0 },
    ...over,
    slots,
  };
}

// ---------------------------------------------------------------- the server: dist/ as GitHub Pages serves it

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json", ".riv": "application/octet-stream", ".png": "image/png", ".webmanifest": "application/manifest+json", ".css": "text/css" };

/**
 * dist/ under /jelly-cozy/ (like Pages). The service worker is left out: index.html loses its
 * <meta name="jellytank-sw"> opt-in, so the tank never registers one (tools/offline.mjs tests the worker).
 */
export function startServer(port) {
  const dist = join(ROOT, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is missing: run `npm run build` first");
  const cache = new Map();
  const body = (f) => {
    if (cache.has(f)) return cache.get(f);
    const path = join(dist, f);
    if (!path.startsWith(dist) || !existsSync(path) || !statSync(path).isFile()) return null;
    let b = readFileSync(path);
    if (f === "index.html") b = Buffer.from(String(b).replace(/<meta name="jellytank-sw"[^>]*>/, ""));
    cache.set(f, b);
    return b;
  };
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (!url.startsWith(BASE)) return res.writeHead(404).end();
    const f = url.slice(BASE.length) || "index.html";
    const b = body(f);
    if (!b) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(b);
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}

// ---------------------------------------------------------------- the browser

/**
 * GPU: "real" (the machine's; headless Chrome on macOS has Metal) or "swiftshader" (software GL, for CI runners).
 * The installed Google Chrome, or E2E_CHROME=<path>. `ci` on Linux: no sandbox (GitHub's Ubuntu runners refuse
 * Chrome's user-namespace sandbox).
 */
export async function launchBrowser({ gpu = "real", protocolTimeout = 45_000, ci = false } = {}) {
  const gl = gpu === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [];
  const sandbox = ci && process.platform === "linux" ? ["--no-sandbox"] : [];
  return puppeteer.launch({
    ...(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : { channel: "chrome" }),
    headless: true,
    protocolTimeout,
    args: [...gl, ...sandbox, "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check"],
  });
}

const withTimeout = (p, ms, what) => {
  let id;
  return Promise.race([p, new Promise((_, rej) => (id = setTimeout(() => rej(new Error(`${what} took over ${ms} ms`)), ms)))]).finally(() => clearTimeout(id));
};

// ---------------------------------------------------------------- the flow context

/**
 * One attempt at one flow. `t.open()` gives it a fresh browser context; checks, screenshots and diagnostics
 * collect here for the runner's report.
 */
export class Flow {
  constructor(browser, origin, { name }) {
    this.browser = browser;
    this.origin = origin;
    this.name = name;
    this.checks = [];
    this.diag = [];
    this.errors = [];
    this.contexts = [];
    this.page = null;
    this.view = VIEW;
    this.virtual = true;
  }

  /** a check: recorded, never thrown (a flow carries on to its later checks) */
  check(name, ok, extra = "") {
    this.checks.push({ name, ok: !!ok, extra: ok ? "" : String(extra ?? "") });
    return !!ok;
  }

  /** the app's URL for these query parameters (test mode always; the virtual clock and seed unless turned off) */
  url(query = {}, { virtual = true, seed = 1 } = {}) {
    const q = new URLSearchParams({ test: "1", ...(seed !== null ? { seed: String(seed) } : {}), ...(virtual ? { clock: "virtual", now: String(NOW) } : {}), ...query });
    return `${this.origin}${BASE}?${q}`;
  }

  /**
   * A fresh browser context and page on the tank. `save`: the player's save (null: a new game); `tips`: whether
   * the first-run tips are still to come; `virtual`: the virtual clock (default) or the real one; `query`: more
   * URL parameters (fast, season, sky...).
   */
  async open({ save = null, tips = false, virtual = true, seed = 1, query = {}, view = VIEW, dpr = 1, storage = {} } = {}) {
    const ctx = await this.browser.createBrowserContext();
    this.contexts.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);
    page.on("pageerror", (e) => this.errors.push(String(e)));
    page.on("error", (e) => this.diag.push({ page: "renderer crashed", error: String(e?.message ?? e) }));
    await page.setViewport({ ...view, deviceScaleFactor: dpr });
    this.page = page;
    this.ctx = ctx;
    this.view = view;
    this.virtual = virtual;
    this.query = query;
    this.seed = seed;
    // the save goes in before the tank first loads (a cheap same-origin file to write localStorage from)
    await page.goto(`${this.origin}${BASE}manifest.webmanifest`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      (json, tipsSeen, extra) => {
        localStorage.clear();
        if (json) localStorage.setItem("jellytank:v5", json);
        if (tipsSeen) localStorage.setItem("jellytank:tips", "1");
        for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      },
      save ? JSON.stringify(save) : null,
      !tips,
      storage,
    );
    await page.goto(this.url(query, { virtual, seed }), { waitUntil: "domcontentloaded" });
    await this.ready();
    return page;
  }

  /** __jt is up and the tank is ready (first frame, its art, no loading screen) */
  async ready(page = this.page) {
    await page.waitForFunction(() => !!window.__jt, { polling: 50, timeout: 30_000 });
    await page.evaluate(() => window.__jt.ready());
  }

  /** reload (same URL) and wait for the tank */
  async reload() {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.ready();
  }

  /** run `fn` in the page and wait for the navigation it causes, then for the tank */
  async navigating(fn) {
    await Promise.all([this.page.waitForNavigation({ waitUntil: "domcontentloaded" }), fn()]);
    await this.ready();
  }

  /** __jt.loadSave + the reload it causes */
  async loadSave(s, opts = {}) {
    await this.navigating(() => this.page.evaluate((j, o) => window.__jt.loadSave(j, o), JSON.stringify(s), opts));
  }

  eval(fn, ...args) {
    return this.page.evaluate(fn, ...args);
  }
  /** the read-only snapshot of the state */
  st() {
    return this.page.evaluate(() => window.__jt.state());
  }
  /** let `ms` of sim time pass (virtual: fixed steps; real: wait for it) */
  advance(ms) {
    return this.page.evaluate((m) => window.__jt.advance(m), ms);
  }
  /** nothing mid-slide, mid-ease or mid-fade (virtual: stepped there) */
  idle() {
    return this.page.evaluate(() => window.__jt.idle());
  }

  /**
   * Wait for a condition in the page: true, or false after `timeout` ms (never throws). `pump`: on the virtual
   * clock, step frames while waiting (for what needs frames as well as time, e.g. the room syncing to the lamp).
   */
  async until(fn, arg = null, { timeout = 8000, pump = false } = {}) {
    if (pump && this.virtual) {
      const t0 = Date.now();
      for (;;) {
        if (await this.page.evaluate(fn, arg)) return true;
        if (Date.now() - t0 > timeout) return false;
        await this.advance(1000 / 30);
      }
    }
    return this.page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  }

  // ---- where things are

  /** Fit.Contain: the artboard's scale and offset in this viewport */
  get fit() {
    const s = Math.min(this.view.width / K.W, this.view.height / K.H);
    return { s, ox: (this.view.width - K.W * s) / 2, oy: (this.view.height - K.H * s) / 2 };
  }
  /** artboard point -> page point */
  art(ax, ay) {
    const { s, ox, oy } = this.fit;
    return [ox + ax * s, oy + ay * s];
  }
  /** world point -> page point (the camera, the close-up), from the page */
  async world(wx, wy) {
    const p = await this.page.evaluate((x, y) => window.__jt.toClient(x, y), wx, wy);
    return [p.x, p.y];
  }
  button(name) {
    const b = K.buttons.find((x) => x.name === name);
    if (!b) throw new Error(`no button ${name} in the contract`);
    return [b.x + b.w / 2, b.y + b.h / 2];
  }
  card(i) {
    const c = K.shopCards[i];
    return [c.x + c.w / 2, c.y + c.h / 2];
  }
  tab(i) {
    const c = K.shopTabs[i];
    return [c.x + c.w / 2, c.y + c.h / 2];
  }

  // ---- input

  /** click an artboard point, then let Rive take it: it fires a button's trigger as it advances (a few frames) */
  async click(ax, ay, ms = 100) {
    const [x, y] = this.art(ax, ay);
    await this.page.mouse.click(x, y);
    await this.advance(ms);
  }
  async press(name, ms = 100) {
    return this.click(...this.button(name), ms);
  }
  /** a tap in the water at a world point (taps are the host's: they act at once) */
  async tapWorld(wx, wy) {
    const [x, y] = await this.world(wx, wy);
    await this.page.mouse.click(x, y);
  }
  /** the shop: opened by its button and slid all the way up */
  async openShop() {
    await this.press("shop");
    await this.idle();
  }
  /** switch the shop's tab and let Rive lay its cards out (and hit-test them) */
  async showTab(i) {
    await this.click(...this.tab(i));
    const ok = await this.until((n) => window.__tank.tab === n, i, { pump: true });
    await this.advance(100);
    return ok;
  }
  async closeShop() {
    await this.click(K.shopClose.x + K.shopClose.w / 2, K.shopClose.y + K.shopClose.h / 2);
    await this.idle();
  }
  /** press a key, then a couple of frames for the tank to take it */
  async key(k, ms = 50) {
    await this.page.keyboard.press(k);
    await this.advance(ms);
  }

  // ---- screenshots

  /**
   * shots/e2e-<name>.png. A screenshot that hangs (software GL under load did, for minutes) fails the flow fast,
   * and the report says whether the page's JS still answered.
   */
  async shot(name, page = this.page) {
    const path = join(SHOTS, `e2e-${name}.png`);
    const t0 = Date.now();
    try {
      await withTimeout(page.screenshot({ path, optimizeForSpeed: true }), 30_000, `screenshot ${name}`);
      // E2E_STATE=1: the state beside it (to see what differs when two runs' pixels do)
      if (process.env.E2E_STATE === "1") writeFileSync(path.replace(/\.png$/, ".json"), JSON.stringify(await page.evaluate(() => window.__jt?.state() ?? null), null, 1));
    } catch (e) {
      const jsAlive = await withTimeout(page.evaluate(() => 1), 3000, "a JS ping").then(() => true, () => false);
      this.diag.push({ shot: name, ms: Date.now() - t0, jsAlive, error: String(e?.message ?? e) });
      throw new Error(`screenshot ${name} failed after ${Date.now() - t0} ms (page JS ${jsAlive ? "still answers" : "doesn't answer"}): ${e?.message ?? e}`);
    }
  }

  /** the flow's last check: nothing threw in any page it opened */
  noErrors() {
    this.check(`${this.name}: no page errors`, this.errors.length === 0, this.errors.join(" | "));
  }

  async close() {
    for (const c of this.contexts) await withTimeout(c.close(), 10_000, "closing a context").catch(() => {});
    this.contexts = [];
  }
}
