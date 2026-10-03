// Performance budgets: measures the built game and compares it with tools/budgets.json; exits 1 on a regression.
//   npm run budget             build, then bytes + load time + battery (local only: a CI runner is too noisy for time)
//   npm run budget:bytes       build, then only the bytes in dist/ (deterministic: CI runs this)
//   node tools/budget.mjs [--bytes | --perf] [--seed]
//     --seed                   write what was measured into tools/budgets.json as the new budgets (keeps tolerances);
//                              do it on a quiet machine and say so in the commit
//   BUDGET_RUNS=3              load-time runs (the median counts) and battery runs per scenario
//   BUDGET_PORT=5271           load time uses this port, battery the next one
//
// Load time = tools/loadtime.mjs for a new tank (LOAD_TANKS=new): first frame over fast and slow 4G and the KB fetched
// by then. Battery = tools/battery.mjs, idle and hidden at 1x CPU: main-thread ms per second and frames per second
// (an idle tank draws 30, a hidden one nothing). Both need Google Chrome and a real GPU for battery numbers.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { byteMetrics, compare, table, failed, median } from "./budget-lib.mjs";

const args = process.argv.slice(2);
const seed = args.includes("--seed");
const doBytes = !args.includes("--perf");
const doPerf = !args.includes("--bytes");
const RUNS = Number(process.env.BUDGET_RUNS ?? 3);
const PORT = Number(process.env.BUDGET_PORT ?? 5271);
const FILE = new URL("./budgets.json", import.meta.url);
const budgets = JSON.parse(readFileSync(FILE, "utf8"));

if (!existsSync("dist/index.html")) {
  console.error("budget: no dist/ (run npm run build first, or use npm run budget / npm run budget:bytes)");
  process.exit(2);
}

const measured = {};
const load = () => loadavg().map((x) => x.toFixed(1)).join(" ");
if (doBytes) Object.assign(measured, byteMetrics("dist"));

if (doPerf) {
  const tmp = mkdtempSync(join(tmpdir(), "jt-budget-"));
  console.log(`load average before: ${load()} (${cpus().length} cores)`);
  const loads = [];
  for (let r = 0; r < RUNS; r++) {
    const out = join(tmp, `load-${r}.json`);
    execFileSync("node", ["tools/loadtime.mjs"], { stdio: "inherit", env: { ...process.env, LOAD_PORT: String(PORT), LOAD_TANKS: "new", LOAD_JSON: out } });
    loads.push(...JSON.parse(readFileSync(out, "utf8")));
  }
  for (const net of ["fast4g", "slow4g"]) {
    const rows = loads.filter((x) => x.tank === "new" && x.net === net);
    measured[`load.new.${net}.firstFrame`] = median(rows.map((x) => x.firstFrameMs));
    measured[`load.new.${net}.kbBeforeFirstFrame`] = median(rows.map((x) => x.kbAtFirstFrame));
  }
  const bout = join(tmp, "battery.json");
  execFileSync("node", ["tools/battery.mjs"], {
    stdio: "inherit",
    env: { ...process.env, BATTERY_PORT: String(PORT + 1), BATTERY_SCENARIOS: "idle,hidden", BATTERY_RATES: "1", BATTERY_RUNS: String(RUNS), BATTERY_JSON: bout },
  });
  for (const x of JSON.parse(readFileSync(bout, "utf8"))) {
    measured[`battery.${x.scenario}.main`] = x.main;
    measured[`battery.${x.scenario}.fps`] = x.fps;
    if (x.scenario === "hidden" && !x.hidden) measured["battery.hidden.fps"] = NaN; // the tab never went hidden: no number
  }
  console.log(`load average after: ${load()}`);
}

const sections = [...(doBytes ? ["bytes"] : []), ...(doPerf ? ["perf"] : [])];
if (seed) {
  for (const sec of sections) {
    for (const [metric, b] of Object.entries(budgets[sec])) {
      const v = measured[metric];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      // a target (30 fps) and an absolute max (a hidden tab) are rules, not measurements: they stay
      if (b.budget !== undefined) b.budget = b.unit === "B" ? v : Math.round(v * 10) / 10;
    }
    budgets.seeded[sec] = { date: new Date().toISOString().slice(0, 10), runs: sec === "perf" ? RUNS : 1, load: sec === "perf" ? load() : undefined, cpu: sec === "perf" ? `${cpus()[0]?.model} x${cpus().length}` : undefined };
  }
  writeFileSync(FILE, `${JSON.stringify(budgets, null, 2)}\n`);
  console.log(`seeded tools/budgets.json (${sections.join(", ")})`);
}

let bad = 0;
for (const sec of sections) {
  const rows = compare(budgets[sec], measured);
  console.log(`\n${sec === "bytes" ? "Bytes over the wire (dist/, gzip where Pages gzips)" : "Load time and battery (this machine)"}:`);
  console.log(table(rows));
  bad += failed(rows).length;
}
if (bad) {
  console.log(`\nbudget: ${bad} regression(s). If the change is worth it, raise the budget in tools/budgets.json (or rerun with --seed) and say why in the commit.`);
  process.exit(1);
}
console.log("\nbudget: all within budget");
