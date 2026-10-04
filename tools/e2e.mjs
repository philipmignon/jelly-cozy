/**
 * The browser checks: every flow in tools/e2e/flows/ against the built game (dist/, served under /jelly-cozy/ as
 * GitHub Pages serves it, the service worker left out), in parallel, each in a fresh browser context with a known
 * save, driven through the test API (window.__jt, src/testapi.ts).
 *
 *   npm run e2e                  builds dist/ first if the sources are newer, then runs every flow
 *   npm run e2e -- shop keyboard only these flows (or E2E_FLOWS=shop,keyboard)
 *   npm run e2e:ci               what CI runs after `npm run build`: software GL, no build
 *
 * A flow that fails (a check, or an exception: that flow only) is retried once on a fresh browser: FLAKY if the
 * retry passes (exit 0, but loudly), FAIL if both fail (exit 1). The summary table goes to stdout and the whole
 * run to shots/e2e-report.json; screenshots to shots/e2e-*.png.
 *
 * Environment:
 *   E2E_PORT=5198          the static server's port (0: any free one)
 *   E2E_WORKERS=n          flows at once (default min(cpus/2, 4); one browser each)
 *   E2E_GPU=swiftshader    software GL (the default when CI is set); otherwise the machine's GPU
 *   E2E_BUILD=0|1          never / always build first (default: when dist/ is older than the sources; never in CI)
 *   E2E_FLOW_TIMEOUT=ms    one attempt's limit (default 150 s; 300 s with software GL)
 *   E2E_RETRIES=n          retries per failed flow (default 1)
 *   E2E_CHROME=path        the Chrome to drive (default: the installed Google Chrome)
 *   E2E_STATE=1            write each screenshot's state beside it (shots/e2e-*.json)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Flow, ROOT, SHOTS, launchBrowser, startServer } from "./e2e/lib.mjs";

const args = process.argv.slice(2);
const CI = args.includes("--ci") || !!process.env.CI;
const GPU = process.env.E2E_GPU ?? (CI ? "swiftshader" : "real");
const WORKERS = Math.max(1, Number(process.env.E2E_WORKERS ?? Math.min(Math.floor(cpus().length / 2), 4)));
const FLOW_TIMEOUT = Number(process.env.E2E_FLOW_TIMEOUT ?? (GPU === "swiftshader" ? 300_000 : 150_000));
const RETRIES = Number(process.env.E2E_RETRIES ?? 1);
const PORT = Number(process.env.E2E_PORT ?? 5198);
const only = [...args.filter((a) => !a.startsWith("--")), ...(process.env.E2E_FLOWS ?? "").split(",").filter(Boolean)];
const REPORT = join(SHOTS, "e2e-report.json");

/** dist/ is missing or older than what builds it */
function stale() {
  const built = join(ROOT, "dist/index.html");
  if (!existsSync(built)) return true;
  const t = statSync(built).mtimeMs;
  const newer = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) return readdirSync(p).some((f) => newer(join(p, f)));
    return st.mtimeMs > t;
  };
  return ["src", "public", "index.html", "vite.config.ts"].some((p) => existsSync(join(ROOT, p)) && newer(join(ROOT, p)));
}

async function loadFlows() {
  const dir = join(ROOT, "tools/e2e/flows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
  const flows = [];
  for (const f of files) {
    const m = await import(pathToFileURL(join(dir, f)).href);
    if (!m.flow?.name || typeof m.flow.run !== "function") throw new Error(`${f}: export const flow = { name, run(t) }`);
    flows.push(m.flow);
  }
  const unknown = only.filter((n) => !flows.some((f) => f.name === n));
  if (unknown.length) throw new Error(`no such flow: ${unknown.join(", ")} (have ${flows.map((f) => f.name).join(", ")})`);
  return only.length ? flows.filter((f) => only.includes(f.name)) : flows;
}

/** the last report's times: the longest flows start first, so the workers finish together */
function lastTimes() {
  try {
    const r = JSON.parse(readFileSync(REPORT, "utf8"));
    return new Map(r.flows.map((f) => [f.name, f.ms]));
  } catch {
    return new Map();
  }
}

/** a heartbeat: gaps of over 5 s between its 1 s ticks are times this process wasn't running */
const stalls = [];
let beat = Date.now();
setInterval(() => {
  const now = Date.now();
  if (now - beat > 5000) stalls.push({ at: now, ms: now - beat - 1000 });
  beat = now;
}, 1000).unref();

async function attempt(browser, origin, flow) {
  const t = new Flow(browser, origin, flow);
  const t0 = Date.now();
  const gone = () => t.diag.push({ browser: "disconnected (crashed or killed)" });
  browser.once("disconnected", gone);
  let error = null;
  let timer;
  try {
    await Promise.race([
      flow.run(t),
      new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`flow timed out after ${FLOW_TIMEOUT / 1000} s`)), FLOW_TIMEOUT))),
    ]);
  } catch (e) {
    error = e?.stack ?? String(e);
  } finally {
    clearTimeout(timer);
  }
  await t.close();
  browser.off("disconnected", gone);
  const ms = Date.now() - t0;
  // a laptop that sleeps mid-run (or a machine too loaded to run this process) stalls every timer: say so, rather
  // than leave a ten-minute "hang" unexplained
  const stalled = stalls.filter((x) => x.at >= t0 && x.at - x.ms <= t0 + ms).reduce((sum, x) => sum + x.ms, 0);
  if (stalled) t.diag.push({ runnerStalledMs: stalled, note: "this process didn't run for that long (the machine slept, or was overloaded)" });
  const failed = t.checks.filter((c) => !c.ok);
  return { ok: !error && failed.length === 0 && t.checks.length > 0, ms, error, checks: t.checks, diag: t.diag };
}

async function main() {
  const build = process.env.E2E_BUILD ?? (CI ? "0" : "auto");
  if (build === "1" || (build === "auto" && stale())) {
    console.log("e2e: building dist/ (vite build)...");
    const r = spawnSync("npx", ["vite", "build", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const flows = await loadFlows();
  const times = lastTimes();
  const queue = [...flows].sort((a, b) => (times.get(b.name) ?? 30_000) - (times.get(a.name) ?? 30_000));
  const server = await startServer(PORT);
  const workers = Math.min(WORKERS, queue.length);
  console.log(`e2e: ${flows.length} flows, ${workers} at once, ${GPU} GL, ${server.origin}/jelly-cozy/`);
  const t0 = Date.now();
  const results = [];

  const worker = async () => {
    let browser = null;
    const fresh = async () => {
      if (browser) await browser.close().catch(() => {});
      browser = await launchBrowser({ gpu: GPU, ci: CI });
    };
    for (let flow = queue.shift(); flow; flow = queue.shift()) {
      const attempts = [];
      for (let i = 0; i <= RETRIES; i++) {
        if (!browser || i > 0) await fresh(); // a retry gets a new browser: whatever went wrong stays with the old one
        const a = await attempt(browser, server.origin, flow);
        attempts.push(a);
        if (a.ok) break;
      }
      const last = attempts[attempts.length - 1];
      const result = last.ok ? (attempts.length > 1 ? "FLAKY" : "PASS") : "FAIL";
      const r = { name: flow.name, result, checks: last.checks.length, failed: last.checks.filter((c) => !c.ok).length, ms: attempts.reduce((s, a) => s + a.ms, 0), attempts };
      results.push(r);
      // this flow's lines together, as it finishes
      const lines = [`\n── ${flow.name}: ${result} (${(r.ms / 1000).toFixed(1)} s)`];
      attempts.forEach((a, n) => {
        if (attempts.length > 1) lines.push(`  attempt ${n + 1}: ${a.ok ? "passed" : "failed"} in ${(a.ms / 1000).toFixed(1)} s`);
        for (const c of a.checks) if (!a.ok || n === attempts.length - 1) lines.push(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.extra ? `  (${c.extra})` : ""}`);
        if (a.error) lines.push(`  ERROR ${a.error.split("\n").slice(0, 4).join("\n        ")}`);
        for (const d of a.diag) lines.push(`  DIAG ${JSON.stringify(d)}`);
      });
      console.log(lines.join("\n"));
    }
    if (browser) await browser.close().catch(() => {});
  };
  await Promise.all(Array.from({ length: workers }, worker));
  await server.close();
  const wall = Date.now() - t0;

  results.sort((a, b) => flows.findIndex((f) => f.name === a.name) - flows.findIndex((f) => f.name === b.name));
  const w = Math.max(...results.map((r) => r.name.length), 4);
  const row = (a, b, c, d) => `${a.padEnd(w)}  ${b.padStart(7)}  ${c.padStart(7)}  ${d}`;
  console.log(`\n${row("flow", "checks", "time", "result")}\n${"-".repeat(w + 28)}`);
  for (const r of results) console.log(row(r.name, `${r.checks - r.failed}/${r.checks}`, `${(r.ms / 1000).toFixed(1)}s`, r.result));
  const total = results.reduce((s, r) => s + r.checks, 0);
  const passed = results.reduce((s, r) => s + r.checks - r.failed, 0);
  console.log(`${"-".repeat(w + 28)}\n${row("all", `${passed}/${total}`, `${(wall / 1000).toFixed(1)}s`, "")}`);
  const flaky = results.filter((r) => r.result === "FLAKY");
  const failed = results.filter((r) => r.result === "FAIL");
  writeFileSync(REPORT, `${JSON.stringify({ at: new Date().toISOString(), gpu: GPU, workers, ms: wall, passed: failed.length === 0, flaky: flaky.map((r) => r.name), failed: failed.map((r) => r.name), stalls, flows: results }, null, 1)}\n`);
  if (flaky.length) console.log(`\n!!! FLAKY: ${flaky.map((r) => r.name).join(", ")} failed once and passed on retry. See shots/e2e-report.json. !!!`);
  console.log(failed.length ? `\n${failed.length} flow(s) failed: ${failed.map((r) => r.name).join(", ")}` : "\nall flows passed");
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
