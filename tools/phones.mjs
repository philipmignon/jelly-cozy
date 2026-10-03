// Screenshots of the built game (dist/, as GitHub Pages serves it) at common device sizes.
//   npm run build && node tools/phones.mjs  -> shots/phone-<name>-{tank,menu}.png
// Also checks that none of them shows or downloads the wide-screen room (src/roomfit.ts), and that the settings
// menu fits on screen (scrolling when it's taller, every item reachable): exits 1 if not.
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.PHONES_PORT ?? 5195);
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  const f = join("dist", url === "/" ? "index.html" : url);
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
// the room's chunk and art (src/room.ts -> assets/room-*.js, sprites/room.json)
const isRoom = (url) => /\/assets\/room-[^/]*\.js|\/sprites\/room\.json/.test(url);
let roomFetched = 0;
let menuBad = 0;
for (const [name, vp] of Object.entries(devices)) {
  const p = await browser.newPage();
  const roomUrls = [];
  p.on("request", (r) => isRoom(r.url()) && roomUrls.push(r.url()));
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
  const roomShown = await p.evaluate(() => !!document.querySelector(".jt-room"));
  report.push(`  room: ${roomShown || roomUrls.length ? `SHOWN/FETCHED ${roomUrls.join(" ")}` : "none (nothing fetched)"}`);
  roomFetched += roomUrls.length + (roomShown ? 1 : 0);
  await p.tap(".jt-gear");
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: `shots/phone-${name}-menu.png` });
  // v15: the menu (ten items) stays on screen; on a short one it scrolls, and End brings the last item into view
  const menu = await p.evaluate(() => {
    const m = document.querySelector(".jt-menu");
    if (!m || m.hidden) return null;
    const r = m.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), vh: innerHeight, scrolls: m.scrollHeight > m.clientHeight + 1, items: m.querySelectorAll("li:not([hidden]) button").length };
  });
  if (menu) {
    await p.keyboard.press("End");
    await new Promise((r) => setTimeout(r, 200));
    const last = await p.evaluate(() => {
      const items = [...document.querySelectorAll(".jt-menu li:not([hidden]) button")];
      const b = items[items.length - 1];
      const r = b.getBoundingClientRect();
      const m = document.querySelector(".jt-menu").getBoundingClientRect();
      return { focused: document.activeElement === b, inView: r.top >= m.top - 1 && r.bottom <= m.bottom + 1 && r.bottom <= innerHeight };
    });
    const ok = menu.bottom <= menu.vh && last.focused && last.inView;
    report.push(`  menu: ${menu.items} items, bottom ${menu.bottom}/${menu.vh} px, ${menu.scrolls ? "scrolls" : "fits"}; End -> last item ${last.focused && last.inView ? "focused and in view" : "NOT REACHABLE"}`);
    if (!ok) menuBad++;
    if (menu.scrolls) await p.screenshot({ path: `shots/phone-${name}-menu-end.png` });
  } else {
    report.push("  menu: not open (the turn-upright screen covers the tank)");
  }
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
if (roomFetched) {
  console.log("FAIL: a phone-sized screen fetched or showed the room");
  process.exitCode = 1;
}
if (menuBad) {
  console.log("FAIL: the settings menu ran off a screen or its last item couldn't be reached");
  process.exitCode = 1;
}
