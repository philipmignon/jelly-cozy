/**
 * npm run e2e:update-refs: re-render the visual flows' scenes and write them over the reference screenshots
 * (tools/e2e/reference/<set>/), then list what changed. Both sets by default: `metal` on this Mac's GPU and
 * `swiftshader` in software GL.
 *
 *   npm run e2e:update-refs                          both sets
 *   npm run e2e:update-refs -- --gpu swiftshader     one (real | swiftshader)
 *   npm run e2e:update-refs -- --from <dir>          adopt another machine's renders: a CI run's shots/visual/
 *                                                    (the "shots" artifact), with its renderer.json
 *
 * Builds dist/ first when it's stale (as npm run e2e does). Look at what changed before committing: every scene
 * listed as changed is a picture you're approving.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, SHOTS } from "./lib.mjs";
import { REFERENCE, adopt, decode } from "./visual.mjs";

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

function summary(set, rows) {
  const changed = rows.filter((r) => r.update !== "unchanged");
  console.log(`\nreference/${set}: ${rows.length} scenes, ${changed.length} changed`);
  for (const r of changed) console.log(`  ${r.scene.padEnd(24)} ${r.update}`);
}

const from = opt("--from");
if (from) {
  // a CI run's renders: <scene>-actual.png and renderer.json (written by a run whose set was made elsewhere)
  const dir = resolve(from);
  const info = JSON.parse(readFileSync(join(dir, "renderer.json"), "utf8"));
  const set = opt("--set") ?? info.set;
  const files = readdirSync(dir).filter((f) => f.endsWith("-actual.png"));
  if (!files.length) throw new Error(`${dir}: no <scene>-actual.png renders`);
  const rows = files.map((f) => {
    const scene = f.replace(/-actual\.png$/, "");
    return { scene, update: adopt(join(REFERENCE, set), scene, decode(readFileSync(join(dir, f)))) };
  });
  writeFileSync(join(REFERENCE, set, "meta.json"), `${JSON.stringify({ ...info, set }, null, 1)}\n`);
  summary(set, rows);
  console.log(`(made on ${info.platform} Chrome ${info.chrome}; meta.json says so)`);
} else {
  const gpus = opt("--gpu") ? [opt("--gpu")] : ["real", "swiftshader"];
  let failed = false;
  for (const gpu of gpus) {
    const r = spawnSync(process.execPath, [join(ROOT, "tools/e2e.mjs"), "--update-refs"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, E2E_GPU: gpu } });
    const report = existsSync(join(SHOTS, "e2e-report.json")) ? JSON.parse(readFileSync(join(SHOTS, "e2e-report.json"), "utf8")) : null;
    if (r.status !== 0 || !report?.passed) {
      process.stdout.write(String(r.stdout));
      console.error(`\nupdate-refs (${gpu}): a visual flow failed before it could render every scene; nothing more to say than the output above`);
      failed = true;
      continue;
    }
    const rows = report.flows.flatMap((f) => f.attempts.at(-1).warnings.filter((w) => w.update).map((w) => ({ scene: w.reference.split("/")[1].replace(/\.png$/, ""), set: w.reference.split("/")[0], update: w.update })));
    summary(rows[0]?.set ?? gpu, rows);
  }
  process.exit(failed ? 1 : 0);
}
