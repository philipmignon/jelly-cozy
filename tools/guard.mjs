// Merge guard: catches what a bad merge or a truncating script leaves behind, before it ships.
//   npm run guard                       every tracked file as it is on disk, against the base (below)
//   node tools/guard.mjs --staged       only what's staged, as staged, against HEAD (the pre-commit hook runs this)
//   node tools/guard.mjs --base v15     against another ref
//   npm run hooks                       install .git/hooks/pre-commit (opt-in; --force replaces another hook)
//
// Fails (exit 1) on:
//   1. conflict markers (<<<<<<< / ======= / >>>>>>> / |||||||) at the start of a line in a tracked text file
//      (in Markdown a lone ======= is a heading underline, so it only counts next to the others);
//   2. a source file (ts/js/mjs/py/css/html/md/json under src/ or tools/, root config, .github/workflows/*.yml)
//      that is empty or whitespace only, or lost more than 40% of its bytes since the base (files under 512 bytes
//      at the base aren't held to this). A deliberate cut is allowed by listing the path in tools/guard-allow.txt,
//      by a `Guard-Allow-Shrink: <path>` line in a commit message between the base and HEAD, or by
//      GUARD_ALLOW_SHRINK=<path>,<path>;
//   3. generated files out of step: src/contract.json must parse, and every sprite group it lists (and the room's)
//      must be in public/ with the hash and size gen.py wrote, with no unlisted public/sprites/*.json left over;
//      src/journal-art.json must parse and public/jellytank.riv must be a .riv.
//
// The base: --base or GUARD_BASE; with --staged, HEAD; on a GitHub pull request, the merge base with its target
// branch; on a push to main in CI, the commit before the push; otherwise the merge base with origin/main (so a
// main that moved on doesn't make this branch's files look shrunk). With no base to be had, the shrink check is
// skipped with a warning.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync, statSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { conflictMarkers, isBinary, inScope, sizeViolations, parseAllowlist, trailerPaths, generatedProblems } from "./guard-lib.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 << 20 });
const gitBuf = (...a) => execFileSync("git", a, { maxBuffer: 256 << 20 });
const tryGit = (...a) => {
  try {
    return git(...a).trim();
  } catch {
    return null;
  }
};

const root = git("rev-parse", "--show-toplevel").trim();
process.chdir(root);

if (flag("--install-hook")) installHook();
else process.exit(run());

function installHook() {
  // core.hooksPath, when set, is where git looks instead of .git/hooks (from a linked worktree: the main checkout's)
  const dir = tryGit("config", "--get", "core.hooksPath") || git("rev-parse", "--git-path", "hooks").trim();
  const path = resolve(dir, "pre-commit");
  const body = "#!/bin/sh\n# jellytank merge guard (npm run hooks): conflict markers, truncated files, stale generated files\nexec node tools/guard.mjs --staged\n";
  if (existsSync(path) && !readFileSync(path, "utf8").includes("tools/guard.mjs") && !flag("--force")) {
    console.error(`${path} exists and isn't the guard's; rerun with --force to replace it (npm run hooks -- --force)`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  console.log(`installed ${path}: every commit runs node tools/guard.mjs --staged (skip once with git commit --no-verify)`);
}

function resolveBase(staged) {
  const given = opt("--base") ?? process.env.GUARD_BASE;
  if (given) return tryGit("rev-parse", "--verify", `${given}^{commit}`) ? given : null;
  if (staged) return tryGit("rev-parse", "--verify", "HEAD") ? "HEAD" : null;
  if (process.env.GITHUB_BASE_REF) return tryGit("merge-base", `origin/${process.env.GITHUB_BASE_REF}`, "HEAD");
  if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_EVENT_PATH) {
    try {
      const before = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).before;
      if (before && !/^0+$/.test(before) && tryGit("rev-parse", "--verify", `${before}^{commit}`) && process.env.GITHUB_REF === "refs/heads/main") return before;
    } catch {
      /* fall through */
    }
  }
  if (tryGit("rev-parse", "--verify", "origin/main")) return tryGit("merge-base", "origin/main", "HEAD");
  return null;
}

function run() {
  const staged = flag("--staged");
  const problems = [];
  // the files to look at, and how to read each one
  const files = staged
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean)
    : git("ls-files", "-z").split("\0").filter(Boolean);
  const indexed = new Set(staged ? git("ls-files", "-z").split("\0").filter(Boolean) : files);
  const read = (p) => {
    if (staged) {
      if (!indexed.has(p)) return null;
      try {
        return gitBuf("show", `:${p}`);
      } catch {
        return null;
      }
    }
    return existsSync(p) && statSync(p).isFile() ? readFileSync(p) : null;
  };

  // 1. conflict markers
  for (const f of files) {
    const buf = read(f);
    if (!buf || isBinary(buf)) continue;
    for (const m of conflictMarkers(buf.toString("utf8"), f)) problems.push(`${f}:${m.line}: conflict marker ${m.marker}`);
  }

  // 2. empty or shrunken sources
  const base = resolveBase(staged);
  const scoped = files.filter(inScope);
  if (!base) {
    console.warn("guard: no base ref (origin/main missing? pass --base <ref>): skipping the shrink check, still checking for empty files");
  }
  const baseSizes = new Map();
  if (base) {
    for (const line of git("ls-tree", "-r", "-l", "-z", base).split("\0").filter(Boolean)) {
      const m = line.match(/^\d+ blob [0-9a-f]+\s+(\d+)\t(.*)$/);
      if (m) baseSizes.set(m[2], Number(m[1]));
    }
  }
  const allowed = new Set([
    ...(existsSync("tools/guard-allow.txt") ? parseAllowlist(readFileSync("tools/guard-allow.txt", "utf8")) : []),
    ...(process.env.GUARD_ALLOW_SHRINK ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ...(base ? trailerPaths(git("log", "--format=%B", `${base}..HEAD`)) : []),
  ]);
  const entries = scoped.map((path) => {
    const buf = read(path);
    return { path, base: base ? (baseSizes.get(path) ?? null) : null, now: buf ? buf.length : null, blank: buf ? buf.toString("utf8").trim() === "" : false };
  });
  for (const v of sizeViolations(entries, allowed)) {
    problems.push(`${v.path}: ${v.rule === "empty" ? "empty" : "shrank"} (${v.detail})${v.rule === "shrank" ? " - if that's meant, add it to tools/guard-allow.txt or a `Guard-Allow-Shrink: " + v.path + "` line in the commit message" : ""}`);
  }

  // 3. generated files (with --staged: only when the commit touches them, read as staged)
  const generated = (f) => f === "src/contract.json" || f === "src/journal-art.json" || f === "public/jellytank.riv" || f.startsWith("public/sprites/");
  const genChecked = !staged || files.some(generated);
  if (genChecked) {
    const sprites = [...(staged ? indexed : new Set(files))].filter((f) => /^public\/sprites\/[^/]+\.json$/.test(f));
    for (const p of generatedProblems(read, sprites)) problems.push(p);
  }

  const what = staged ? `${files.length} staged file(s)` : `${files.length} tracked files`;
  if (problems.length) {
    console.error(`guard: ${problems.length} problem(s) in ${what}${base ? ` (base ${base.slice(0, 12)})` : ""}:`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  console.log(`guard: ok, ${what}, ${scoped.length} sources sized${base ? ` against ${base.slice(0, 12)}` : ""}${genChecked ? ", generated files in step" : ""}`);
  return 0;
}
