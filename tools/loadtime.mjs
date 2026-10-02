// Time to first frame of the published bundle over throttled connections.
//   node tools/loadtime.mjs            (serves pub/jellytank.html + dist/assets with gzip)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = 5196;
const page = readFileSync("pub/jellytank.html", "utf8");
const shell = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${page}</body></html>`;
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".bin": "application/octet-stream", ".html": "text/html" };
const cache = new Map();
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  let body, type;
  if (url === "/" || url === "/index.html") [body, type] = [Buffer.from(shell), "text/html"];
  else {
    const f = join("dist", url);
    if (!existsSync(f)) return res.writeHead(404).end();
    [body, type] = [readFileSync(f), types[extname(f)] ?? "application/octet-stream"];
  }
  if (!cache.has(url)) cache.set(url, gzipSync(body, { level: 6 }));
  res.writeHead(200, { "content-type": type, "content-encoding": "gzip", "cache-control": "no-store" });
  res.end(cache.get(url));
}).listen(PORT, "127.0.0.1");

const profiles = {
  "fast 4G (9 Mbps, 85 ms)": { download: (9e6 / 8) * 0.9, upload: 1e6, latency: 85 },
  "slow 4G (1.6 Mbps, 150 ms)": { download: (1.6e6 / 8) * 0.9, upload: 0.75e6 / 8, latency: 150 },
};
const browser = await puppeteer.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [name, net] of Object.entries(profiles)) {
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const cdp = await p.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: net.download, uploadThroughput: net.upload, latency: net.latency });
  const t0 = Date.now();
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.waitForFunction(() => document.getElementById("loading")?.classList.contains("done") || !document.getElementById("loading"), { timeout: 120000 });
  const firstFrame = Date.now() - t0;
  // the browser's own first paint: when the loading screen showed
  const loaderAt = await p.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? performance.getEntriesByName("first-paint")[0]?.startTime ?? -1);
  console.log(`${name}: loading screen ${(loaderAt / 1000).toFixed(1)} s, first frame ${(firstFrame / 1000).toFixed(1)} s`);
  await p.close();
}
await browser.close();
server.close();
