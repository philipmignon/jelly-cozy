// Time to first frame of the built game over throttled connections.
//   npm run build && node tools/loadtime.mjs   (serves dist/ as GitHub Pages does: gzip for text, the .riv,
//                                               PNGs and wasm... as they are; the service worker bypassed)
//   LOAD_PORT=5211                              (the port, default 5196)
// Two tanks: a NEW one (a moon polyp, empty storage) and a FULL one (Large tank, seven jellies of seven species),
// each with no seasonal event (?season=none) and on a first visit during Halloween (?season=halloween: the
// event's art, ev-halloween, comes on top of the jellies'; `every jelly drawn` then also waits for the decor).
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.LOAD_PORT ?? 5196);
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".bin": "application/octet-stream", ".html": "text/html", ".json": "application/json", ".riv": "application/octet-stream", ".png": "image/png", ".webmanifest": "application/manifest+json" };
// GitHub Pages compresses text types only; a .riv goes out as it is
const compressible = (type) => !/octet-stream|image\//.test(type);
const cache = new Map();
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  const f = join("dist", url === "/" ? "index.html" : url);
  if (!existsSync(f)) return res.writeHead(404).end();
  const [body, type] = [readFileSync(f), types[extname(f)] ?? "application/octet-stream"];
  const gz = compressible(type);
  if (!cache.has(url)) cache.set(url, gz ? gzipSync(body, { level: 6 }) : body);
  res.writeHead(200, { "content-type": type, ...(gz ? { "content-encoding": "gzip" } : {}), "cache-control": "no-store" });
  res.end(cache.get(url));
}).listen(PORT, "127.0.0.1");

const profiles = {
  "fast 4G (9 Mbps, 85 ms)": { download: (9e6 / 8) * 0.9, upload: 1e6, latency: 85 },
  "slow 4G (1.6 Mbps, 150 ms)": { download: (1.6e6 / 8) * 0.9, upload: 0.75e6 / 8, latency: 150 },
};
const SPECIES_KEYS = JSON.parse(readFileSync("src/contract.json", "utf8")).species;
const now = Date.now();
const FULL = JSON.stringify({
  v: 11, tier: 2, dollars: 500, lastSeen: now, night: false, lamp: null,
  slots: [[0, 3], [1, 3], [2, 2], [3, 3], [4, 3], [5, 2], [6, 3]].map(([k, g], i) => ({ k, g, name: `J${i}`, born: now - 864e5 })),
});
const tanks = {
  new: { save: null, season: "none" },
  "full (7 jellies, 7 species)": { save: FULL, season: "none" },
  "new, first Halloween visit": { save: null, season: "halloween" },
  "full, first Halloween visit": { save: FULL, season: "halloween" },
};
const browser = await puppeteer.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [tank, { save, season }] of Object.entries(tanks)) {
  for (const [name, net] of Object.entries(profiles)) {
    const p = await browser.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    const cdp = await p.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    // every load a first visit: in pages mode dist/index.html installs the service worker, which would
    // otherwise serve every later load from its cache (tools/offline.mjs times repeat visits)
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: net.download, uploadThroughput: net.upload, latency: net.latency });
    let bytes = 0;
    cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
    // timed inside the page (performance.now() from navigation), so a busy machine's slow polling doesn't count:
    // `first` = the loading screen lifts (first frame), `all` = every jelly's art is in (off-screen ones come later)
    // and, in Halloween, the event's decor is showing
    await p.evaluateOnNewDocument((s, keys, event) => {
      try {
        localStorage.clear();
        localStorage.setItem("jellytank:tips", "1");
        if (s) localStorage.setItem("jellytank:v5", s);
      } catch {}
      const lt = (window.__lt = { first: 0, all: 0, kb: 0 });
      const poll = setInterval(() => {
        const el = document.getElementById("loading");
        if (!lt.first && document.body && (!el || el.classList.contains("done"))) {
          lt.first = performance.now();
          lt.kb = Math.round(performance.getEntriesByType("resource").reduce((a, r) => a + r.transferSize, performance.getEntriesByType("navigation")[0]?.transferSize ?? 0) / 1024);
        }
        const g = window.__spriteGroups;
        const jellies = !g || window.__tank?.slots.every((j) => !j || g.isReady(`sp-${keys[j.k]}`));
        if (lt.first && window.__tank && jellies && (!event || window.__tank.event === event)) {
          lt.all = performance.now();
          clearInterval(poll);
        }
      }, 10);
    }, save, SPECIES_KEYS, season === "none" ? null : season);
    await p.goto(`http://127.0.0.1:${PORT}/?season=${season}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForFunction(() => window.__lt?.all > 0, { timeout: 120000 });
    const lt = await p.evaluate(() => window.__lt);
    // the browser's own first paint: when the loading screen showed
    const loaderAt = await p.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? performance.getEntriesByName("first-paint")[0]?.startTime ?? -1);
    const s_ = (ms) => `${(ms / 1000).toFixed(1)} s`;
    console.log(`${tank}, ${name}: loading screen ${s_(loaderAt)}, first frame ${s_(lt.first)} (${lt.kb} KB by then), every jelly${season === "none" ? "" : " and the decor"} drawn ${s_(lt.all)}; ${Math.round(bytes / 1024)} KB in all`);
    await p.close();
  }
}
await browser.close();
server.close();
