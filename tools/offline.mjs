// The GitHub Pages build's service worker, end to end (needs `npm run build`). Serves dist/ under /jelly-cozy/
// the way Pages does (text gzipped, max-age=600), then:
//   1. first visit over fast 4G: time to first frame; the worker installs and caches what the tank used
//   2. repeat visit, HTTP cache off (a later day): time to first frame (the bundle comes from the worker's cache)
//   3. offline reload: the tank still runs, jellies drawn
//   4. a new build is deployed while the tank is open: the "Updated" chip shows; after reloading it doesn't,
//      only one cache is left, and the tank still works offline
//   OFFLINE_PORT=5213 [OFFLINE_NET=slow] node tools/offline.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.OFFLINE_PORT ?? process.env.LOAD_PORT ?? 5197);
const BASE = "/jelly-cozy/";
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json", ".riv": "application/octet-stream", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// build 2 = the same files under a new script name and a new worker version (what a deploy looks like to the browser)
let build = 1;
const js1 = readFileSync("dist/index.html", "utf8").match(/assets\/(index-[^"]+\.js)/)[1];
const js2 = js1.replace(/\.js$/, "-b2.js");
const served = (url) => {
  let f = url.slice(BASE.length) || "index.html";
  if (build === 2 && f === `assets/${js2}`) f = `assets/${js1}`;
  const path = join("dist", f);
  if (!existsSync(path)) return null;
  let body = readFileSync(path);
  if (build === 2 && (f === "index.html" || f === "sw.js")) body = Buffer.from(String(body).replaceAll(js1, js2).replace(/"version":"/, '"version":"b2-'));
  return body;
};
let hits = [];
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  hits.push(url);
  const u = url;
  if (!u.startsWith(BASE)) return res.writeHead(404).end();
  const body = served(u);
  if (!body) return res.writeHead(404).end();
  const type = types[extname(u)] ?? (u.endsWith("/") ? "text/html" : "application/octet-stream");
  const gz = !/octet-stream|image\//.test(type);
  res.writeHead(200, { "content-type": type, "cache-control": "max-age=600", ...(gz ? { "content-encoding": "gzip" } : {}) });
  res.end(gz ? gzipSync(body) : body);
}).listen(PORT, "127.0.0.1");

const SPECIES_KEYS = JSON.parse(readFileSync("src/contract.json", "utf8")).species;
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};
// OFFLINE_NET=slow: slow 4G (1.6 Mbps, 150 ms) instead of fast 4G (9 Mbps, 85 ms)
const fast4g = process.env.OFFLINE_NET === "slow"
  ? { offline: false, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: 0.75e6 / 8, latency: 150 }
  : { offline: false, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: 1e6, latency: 85 };

const browser = await puppeteer.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.createBrowserContext();
const errors = [];
/** a fresh tab in the shared profile, timing first frame from inside the page */
async function open(url, { net = fast4g, offline = false, noHttpCache = false } = {}) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const cdp = await p.createCDPSession();
  await cdp.send("Network.enable");
  if (net) await cdp.send("Network.emulateNetworkConditions", net);
  if (noHttpCache) await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (offline) await p.setOfflineMode(true);
  await p.evaluateOnNewDocument((keys) => {
    const lt = (window.__lt = { first: 0, all: 0 });
    const poll = setInterval(() => {
      const el = document.getElementById("loading");
      if (!lt.first && document.body && window.__tank && (!el || el.classList.contains("done"))) lt.first = performance.now();
      const g = window.__spriteGroups;
      if (lt.first && window.__tank && g && window.__tank.slots.every((j) => !j || g.isReady(`sp-${keys[j.k]}`))) {
        lt.all = performance.now();
        clearInterval(poll);
      }
    }, 10);
  }, SPECIES_KEYS);
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  const ok = await p.waitForFunction(() => window.__lt?.all > 0 && window.__tank.t > 0.5, { timeout: 60000 }).then(() => true, () => false);
  const lt = await p.evaluate(() => ({ ...window.__lt, error: document.body.dataset.error ?? null }));
  return { p, ok, lt };
}
const swState = (p) =>
  p.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const names = (await caches.keys()).filter((n) => n.startsWith("jellytank-"));
    const keys = names.length ? (await (await caches.open(names[0])).keys()).map((r) => r.url) : [];
    return { controlled: !!navigator.serviceWorker.controller, active: reg?.active?.state ?? null, scope: reg?.scope ?? null, names, keys };
  });
const s_ = (ms) => `${(ms / 1000).toFixed(2)} s`;
const app = `http://127.0.0.1:${PORT}${BASE}`;

try {
  // 1. first visit
  await ctx.newPage().then((p) => p.goto(`${app}manifest.webmanifest`).then(() => p.evaluate(() => localStorage.setItem("jellytank:tips", "1"))).then(() => p.close()));
  hits = [];
  const v1 = await open(`${app}?season=none`);
  check("first visit: the tank runs", v1.ok && !v1.lt.error, JSON.stringify(v1.lt));
  const cached = await v1.p
    .waitForFunction(
      async () => {
        const names = (await caches.keys()).filter((n) => n.startsWith("jellytank-"));
        if (!names.length || !navigator.serviceWorker.controller) return false;
        const keys = (await (await caches.open(names[0])).keys()).map((r) => r.url);
        return keys.some((u) => u.includes("sprites/sp-moon.json?v=")) && keys.some((u) => u.endsWith(".wasm"));
      },
      { timeout: 60000, polling: 250 },
    )
    .then(() => true, () => false);
  const st1 = await swState(v1.p);
  check("the worker controls the page and cached the bundle and the moon's sprites", cached && st1.controlled && st1.scope === app, `${st1.active} ${st1.names} ${st1.keys.length} entries`);
  console.log(`     cached: ${st1.keys.map((u) => u.replace(app, "")).join(", ")}`);
  const firstBytes = hits.length;
  // Add to Home Screen: Chrome's own installability verdict and the manifest as it parsed it
  const cdp1 = await v1.p.createCDPSession();
  const inst = await cdp1.send("Page.getInstallabilityErrors");
  const man = await cdp1.send("Page.getAppManifest");
  const parsed = man.data ? JSON.parse(man.data) : {};
  const instErrors = inst.installabilityErrors.filter((e) => e.errorId !== "in-incognito"); // this test's throwaway profile
  check("installable (no installability errors, manifest parses cleanly)", instErrors.length === 0 && man.errors.length === 0, JSON.stringify({ errors: instErrors, manifest: man.errors }));
  console.log(`     manifest: ${man.url.replace(app, "")} start_url ${new URL(parsed.start_url, man.url).pathname}, scope ${new URL(parsed.scope, man.url).pathname}, ${parsed.display}, icons ${parsed.icons.map((i) => i.purpose).join("/")}`);
  console.log("     fonts fetched:", await v1.p.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("font")).join(" ")));
  await v1.p.close();

  // 2. repeat visit, a day later: Pages' max-age (10 min) has run out, so no help from the HTTP cache
  hits = [];
  const v2 = await open(`${app}?season=none`, { noHttpCache: true });
  check("repeat visit: the tank runs", v2.ok && !v2.lt.error);
  console.log(`     first frame: first visit ${s_(v1.lt.first)}, repeat visit ${s_(v2.lt.first)} (${process.env.OFFLINE_NET === "slow" ? "slow" : "fast"} 4G); requests to the server: ${firstBytes} then ${hits.length} (${hits.join(" ")})`);
  await v2.p.close();

  // 3. offline
  const v3 = await open(`${app}?season=none`, { offline: true });
  // (`all` is set once every jelly's sprite group is in, which here can only come from the cache)
  check("offline reload: the tank runs with its jellies drawn", v3.ok && !v3.lt.error, `${JSON.stringify(v3.lt)}`);
  await v3.p.screenshot({ path: "shots/offline-reload.png" });
  console.log(`     offline first frame ${s_(v3.lt.first)}`);
  await v3.p.setOfflineMode(false);

  // 4. a new build while the tank is open
  build = 2;
  await v3.p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  const bar = await v3.p.waitForSelector(".jt-upd", { timeout: 30000 }).then(() => true, () => false);
  await v3.p.screenshot({ path: "shots/offline-updated-bar.png" });
  if (!bar) console.log("     ", JSON.stringify(await swState(v3.p)), await v3.p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return JSON.stringify({ w: r.waiting?.state, i: r.installing?.state, a: r.active?.scriptURL, me: [...document.scripts].map((s) => s.src).join() }); }).catch((e) => String(e)));
  check("a new build: the open tank offers a reload", bar);
  const saved = await v3.p.evaluate(() => window.__tank.dollars);
  await Promise.all([v3.p.waitForNavigation({ waitUntil: "domcontentloaded" }), v3.p.click(".jt-upd .go")]);
  await v3.p.waitForFunction(() => window.__tank && window.__tank.t > 1, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const st4 = await swState(v3.p);
  const after = await v3.p.evaluate(() => ({ js: [...document.scripts].map((s) => s.src).join(" "), bar: !!document.querySelector(".jt-upd"), dollars: window.__tank.dollars }));
  check("after the reload: the new build, no bar, the save kept, one cache", after.js.includes(js2) && !after.bar && after.dollars >= saved && st4.names.length === 1 && st4.names[0].includes("b2-"), `${JSON.stringify(after)} ${st4.names}`);
  check("the update kept the cached sprite groups", st4.keys.some((u) => u.includes("sprites/sp-moon.json?v=")));
  await v3.p.close();
  const v5 = await open(`${app}?season=none`, { offline: true });
  check("offline after the update: the tank runs", v5.ok && !v5.lt.error && (await v5.p.evaluate(() => [...document.scripts].some((s) => s.src.includes("-b2.js")))));
  await v5.p.close();

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
