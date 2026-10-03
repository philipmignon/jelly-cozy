// Screenshots of the built page at common device sizes (pub/jellytank.html + dist/assets).
//   node tools/phones.mjs  -> shots/phone-<name>-{tank,menu,card}.png
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.PHONES_PORT ?? 5195);
const page = readFileSync("pub/jellytank.html", "utf8");
const shell = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}</style></head><body>${page}</body></html>`;
const types = { ".js": "text/javascript", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(shell);
  const f = join("dist", url);
  if (!existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
}).listen(PORT, "127.0.0.1");

const devices = {
  "se-375x667": { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "iphone-390x844": { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  "android-360x640": { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  "big-430x932": { width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  "landscape-844x390": { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  "tablet-820x1180": { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
mkdirSync("shots", { recursive: true });
const browser = await puppeteer.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const report = [];
for (const [name, vp] of Object.entries(devices)) {
  const p = await browser.newPage();
  await p.setViewport(vp);
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.evaluate(() => localStorage.setItem("jellytank:tips", "1"));
  await p.reload();
  await p.waitForFunction(() => window.__tank && window.__tank.t > 1, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  await p.screenshot({ path: `shots/phone-${name}-tank.png` });
  // measure the gear and the canvas fit
  const m = await p.evaluate(() => {
    const g = document.querySelector(".jt-gear")?.getBoundingClientRect();
    const c = document.getElementById("tank").getBoundingClientRect();
    const s = Math.min(c.width / 720, c.height / 1284);
    return { gear: g ? [Math.round(g.width), Math.round(g.height)] : null, scale: +s.toFixed(3), bars: [Math.round((c.width - 720 * s) / 2), Math.round((c.height - 1284 * s) / 2)], hScroll: document.documentElement.scrollWidth > innerWidth };
  });
  // the smallest Rive tap target on screen: the shelf items/buttons are ~48-52 art px wide at P=3
  report.push(`${name}: artboard scale ${m.scale} (a 52 px button is ${Math.round(52 * 3 * m.scale)} px), gear ${m.gear?.join("x")} px, side/top bars ${m.bars.join("/")} px, horizontal scroll ${m.hScroll}`);
  await p.tap(".jt-gear");
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: `shots/phone-${name}-menu.png` });
  // the smallest HTML control showing (its box, before any invisible hit margin): WCAG 2.2 asks for 24 px
  const small = await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => ({ c: b.className || b.textContent.trim(), r: b.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0 && b.r.height > 0)
      .map((b) => ({ c: b.c, s: Math.round(Math.min(b.r.width, b.r.height)) }))
      .sort((a, b) => a.s - b.s)[0],
  );
  report.push(`  smallest button with the menu open: ${small ? `${small.c} ${small.s} px${small.s < 24 ? " (UNDER 24)" : ""}` : "none"}`);
  await p.close();
}
console.log(report.join("\n"));
await browser.close();
server.close();
