// What a tank costs to keep open: CPU time per second and frames drawn per second, for an idle tank,
// a busy one (food can held, pointer moving, flakes falling) and a hidden tab, at full speed and with
// 4x CPU throttling (a slow phone).
//   npm run build && node tools/battery.mjs    (serves dist/ as GitHub Pages does; the service worker bypassed)
//   BATTERY_PORT=5199          the port (default 5199)
//   BATTERY_SECONDS=10         the length of each measured window
//   BATTERY_RUNS=2             runs per scenario (the median is printed)
//   BATTERY_SCENARIOS=idle,busy,hidden,saver
//   BATTERY_GL=swiftshader     software GL, where headless Chrome gets no GPU (it is slow, ~13 fps here, and
//                              burns several cores: useless for battery numbers, fine for "does it run")
//
// cpu = every process of this Chrome (renderer + GPU + browser, so the GL work counts too), from `ps`;
// main = the page's main-thread task time (CDP Performance.getMetrics TaskDuration); fps = frames the sim
// stepped (one per drawn Rive frame). Other Chromes on the machine don't count, but they do compete for
// cores: compare numbers from back-to-back runs, not across days. With 4x throttling, read `main`: Chrome's
// throttling itself costs CPU in another process (a hidden tab shows ~300 ms/s of `cpu` that isn't the tank).
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.BATTERY_PORT ?? 5199);
const SECONDS = Number(process.env.BATTERY_SECONDS ?? 10);
const RUNS = Number(process.env.BATTERY_RUNS ?? 2);
const GL = process.env.BATTERY_GL === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [];
const K = JSON.parse(readFileSync("src/contract.json", "utf8"));

const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  const f = join("dist", url === "/" ? "index.html" : url);
  if (!existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
}).listen(PORT, "127.0.0.1");

const VIEW = { width: 390, height: 844, deviceScaleFactor: 2 };
const S = Math.min(VIEW.width / K.W, VIEW.height / K.H);
const OX = (VIEW.width - K.W * S) / 2;
const OY = (VIEW.height - K.H * S) / 2;
const toClient = (x, y) => [OX + x * S, OY + y * S];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a settled tank: seven jellies of seven species, a few days old, the tips already read
const now = Date.now();
const SAVE = JSON.stringify({
  v: 11, tier: 2, dollars: 500, lastSeen: now, night: false, lamp: null,
  slots: [[0, 3], [1, 3], [2, 2], [3, 3], [4, 3], [5, 2], [6, 3]].map(([k, g], i) => ({ k, g, name: `J${i}`, born: now - 3 * 864e5, fullness: 0.9 })),
});

/** CPU seconds used so far by `root` and every process under it (macOS/Linux `ps`). */
function treeCpu(root) {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,time="], { encoding: "utf8" })
    .trim().split("\n").map((l) => l.trim().split(/\s+/));
  const kids = new Map();
  for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  const secs = (t) => t.split(/[-:]/).reverse().reduce((a, v, i) => a + Number(v) * [1, 60, 3600, 86400][i], 0);
  const time = new Map(rows.map(([pid, , t]) => [pid, secs(t)]));
  let total = 0;
  const walk = (pid) => {
    total += time.get(pid) ?? 0;
    for (const k of kids.get(pid) ?? []) walk(k);
  };
  walk(String(root));
  return total;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function measure(browser, { scenario, cpuRate, saver = false }) {
  const p = await browser.newPage();
  await p.setViewport(VIEW);
  const cdp = await p.createCDPSession();
  await cdp.send("Performance.enable");
  // a fresh profile each time, as tools/loadtime.mjs: the worker's installing (caching every file) isn't the tank
  await cdp.send("Network.enable");
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  await p.evaluateOnNewDocument((save, saver) => {
    try {
      localStorage.clear();
      localStorage.setItem("jellytank:tips", "1");
      localStorage.setItem("jellytank:v5", save);
      if (saver) localStorage.setItem("jellytank:battery", "1");
    } catch {}
  }, SAVE, saver);
  await p.goto(`http://127.0.0.1:${PORT}/?season=none`);
  await p.waitForFunction(() => window.__tank && document.getElementById("loading") === null, { timeout: 60000 });
  // put away any note that came up over the tank (milestones this save already reached)
  await p.evaluate(() => document.querySelectorAll(".jt-keep-note button, .jt-away button").forEach((b) => b.click()));
  if (cpuRate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  let other = null;
  if (scenario === "busy") {
    await p.mouse.click(...toClient(...centre("feed")));
  } else if (scenario === "hidden") {
    other = await browser.newPage();
    await other.bringToFront();
    await p.waitForFunction(() => document.hidden, { timeout: 5000 }).catch(() => {});
  }
  // let the tank settle (the idle tank drops to its calm rate after a few quiet seconds)
  await sleep(scenario === "busy" ? 1000 : 9000);
  const hidden = await p.evaluate(() => document.hidden);
  // frames: one per sim step (the sim steps once per drawn frame), counted as `t` is written
  await p.evaluate(() => {
    const s = window.__tank;
    const c = (window.__frameCount = { n: 0 });
    let t = s.t;
    Object.defineProperty(s, "t", { configurable: true, get: () => t, set: (v) => ((t = v), c.n++) });
  });
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const pid = browser.process().pid;
  const m0 = await metric();
  const c0 = treeCpu(pid);
  const t0 = Date.now();
  if (scenario === "busy") {
    // hold the food can and wander through the water, sprinkling now and then
    const end = t0 + SECONDS * 1000;
    let i = 0;
    while (Date.now() < end) {
      const x = K.W * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(i / 8)));
      const y = K.waterTop + 120 + 60 * Math.sin(i / 5);
      const [cx, cy] = toClient(x, y);
      if (i % 6 === 0) await p.mouse.click(cx, cy);
      else await p.mouse.move(cx, cy);
      i++;
      await sleep(100);
    }
  } else {
    await sleep(SECONDS * 1000);
  }
  const secs = (Date.now() - t0) / 1000;
  const c1 = treeCpu(pid);
  const m1 = await metric();
  const fc = await p.evaluate(() => window.__frameCount);
  await other?.close();
  await p.close();
  return {
    hidden,
    fps: fc.n / secs,
    cpu: ((c1 - c0) / secs) * 1000,
    main: ((m1.TaskDuration - m0.TaskDuration) / secs) * 1000,
    script: ((m1.ScriptDuration - m0.ScriptDuration) / secs) * 1000,
  };
}

function centre(name) {
  const b = K.buttons.find((x) => x.name === name);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

const browser = await puppeteer.launch({ channel: "chrome", headless: true, args: GL });
const scenarios = (process.env.BATTERY_SCENARIOS ?? "idle,busy,hidden,saver").split(",");
console.log(`${SECONDS} s windows, median of ${RUNS}; cpu = all of Chrome's processes, main = the page's main thread (ms of CPU per second)`);
for (const cpuRate of [1, 4]) {
  for (const sc of scenarios) {
    const saver = sc === "saver";
    const runs = [];
    for (let r = 0; r < RUNS; r++) runs.push(await measure(browser, { scenario: saver ? "idle" : sc, cpuRate, saver }));
    const f = (k, d = 0) => median(runs.map((x) => x[k])).toFixed(d);
    const label = saver ? "idle, battery saver on" : sc;
    console.log(`${cpuRate}x CPU, ${label.padEnd(22)} ${f("fps").padStart(3)} fps   cpu ${f("cpu").padStart(4)} ms/s   main ${f("main").padStart(4)} ms/s   script ${f("script").padStart(4)} ms/s${runs.some((x) => sc === "hidden" && !x.hidden) ? "   (page was NOT hidden)" : ""}`);
  }
}
await browser.close();
server.close();
