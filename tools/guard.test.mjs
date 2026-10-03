import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { conflictMarkers, isBinary, inScope, sizeViolations, parseAllowlist, trailerPaths, generatedProblems } from "./guard-lib.mjs";

// markers built at run time, so this file never trips the guard itself
const LT = "<".repeat(7);
const GT = ">".repeat(7);
const EQ = "=".repeat(7);
const BAR = "|".repeat(7);

describe("conflict markers", () => {
  it("finds a merge's three markers with their lines", () => {
    const text = ["a", `${LT} HEAD`, "ours", EQ, "theirs", `${GT} feature`, "b"].join("\n");
    expect(conflictMarkers(text, "src/x.ts")).toEqual([
      { line: 2, marker: LT },
      { line: 4, marker: EQ },
      { line: 6, marker: GT },
    ]);
  });
  it("finds diff3's base marker, bare markers and CRLF files", () => {
    expect(conflictMarkers(`${BAR} merged common ancestors\n`, "a.ts")).toHaveLength(1);
    expect(conflictMarkers(`${LT}\r\nx\r\n${GT}\r\n`, "a.ts")).toHaveLength(2);
  });
  it("ignores look-alikes: indented, longer runs, mid-line, git's own diff headers", () => {
    const text = [`  ${LT} HEAD`, `${LT}< x`, `x ${GT} y`, "========", `const s = "${LT}";`, "a <<= 2"].join("\n");
    expect(conflictMarkers(text, "src/x.ts")).toEqual([]);
  });
  it("a lone ======= is a marker in code but a heading underline in Markdown", () => {
    expect(conflictMarkers(`x\n${EQ}\n`, "src/a.ts")).toHaveLength(1);
    expect(conflictMarkers(`Title\n${EQ}\n`, "README.md")).toEqual([]);
    expect(conflictMarkers(`${LT} a\nTitle\n${EQ}\n${GT} b\n`, "README.md")).toHaveLength(3);
  });
  it("binary files are skipped by NUL", () => {
    expect(isBinary(Buffer.from([82, 73, 86, 69, 0, 1]))).toBe(true);
    expect(isBinary(Buffer.from("plain text"))).toBe(false);
  });
});

describe("empty and shrunken sources", () => {
  it("scope: src/, tools/, root config and workflows; not docs, art or the .riv", () => {
    for (const p of ["src/sim.ts", "src/contract.json", "tools/gen.py", "tools/e2e/flows.mjs", "package.json", "vite.config.ts", "index.html", "README.md", ".github/workflows/test.yml", "src/sw.js"]) expect(inScope(p), p).toBe(true);
    for (const p of ["docs/v2-spec.md", "public/sprites/sp-moon.json", "public/jellytank.riv", "rive/rive.yaml", "src/img.png", ".github/CODEOWNERS"]) expect(inScope(p), p).toBe(false);
  });
  const e = (path, base, now, blank = false) => ({ path, base, now, blank });
  it("fails a file that lost more than 40% (not 40% exactly), and an empty or blank one", () => {
    const v = sizeViolations([e("src/a.ts", 10_000, 5_999), e("src/b.ts", 10_000, 6_000), e("src/c.ts", 10_000, 0), e("src/d.ts", null, 3, true), e("src/e.ts", 10_000, 12_000)]);
    expect(v.map((x) => [x.path, x.rule])).toEqual([["src/a.ts", "shrank"], ["src/c.ts", "empty"], ["src/d.ts", "empty"]]);
    expect(v[0].detail).toBe("10000 -> 5999 bytes (-40%)");
  });
  it("lets through: new files, deleted files, small files, out-of-scope files, allowed paths (but never empties)", () => {
    const v = sizeViolations(
      [e("src/new.ts", null, 10), e("src/gone.ts", 9_000, null), e("src/tiny.ts", 400, 10), e("docs/v2-spec.md", 9_000, 10), e("src/cut.ts", 9_000, 100), e("src/blank.ts", 9_000, 0)],
      new Set(["src/cut.ts", "src/blank.ts"]),
    );
    expect(v.map((x) => x.path)).toEqual(["src/blank.ts"]);
  });
  it("reads the allowlist and Guard-Allow-Shrink lines", () => {
    expect(parseAllowlist("# why\nsrc/a.ts  # split into b.ts\n\n tools/x.mjs\n")).toEqual(["src/a.ts", "tools/x.mjs"]);
    const log = "Split the sim\n\nGuard-Allow-Shrink: src/sim.ts, src/dirt.ts\nguard-allow-shrink: tools/gen.py\nCo-Authored-By: x\n\nAnother\nNot-Guard: src/no.ts\n";
    expect(trailerPaths(log)).toEqual(["src/sim.ts", "src/dirt.ts", "tools/gen.py"]);
  });
});

describe("generated files", () => {
  const sha10 = (b) => createHash("sha1").update(b).digest("hex").slice(0, 10);
  const riv = Buffer.concat([Buffer.from("RIVE"), Buffer.alloc(2000, 1)]);
  const moon = Buffer.from('{"group":"sp-moon","sprites":{}}');
  const room = Buffer.from('{"layout":{},"sprites":{}}');
  const contract = (over = {}) =>
    JSON.stringify({ assetGroups: { "sp-moon": { file: "sprites/sp-moon.json", v: sha10(moon), bytes: moon.length } }, room: { file: "sprites/room.json", v: sha10(room), bytes: room.length }, ...over });
  const fs = (files) => (p) => (p in files ? Buffer.from(files[p]) : null);
  const good = { "src/contract.json": contract(), "public/sprites/sp-moon.json": moon, "public/sprites/room.json": room, "public/jellytank.riv": riv, "src/journal-art.json": "{}" };
  const sprites = ["public/sprites/sp-moon.json", "public/sprites/room.json"];
  it("passes when the contract, the groups and the .riv agree", () => {
    expect(generatedProblems(fs(good), sprites)).toEqual([]);
  });
  it("a missing or broken contract", () => {
    const { ["src/contract.json"]: _, ...noContract } = good;
    expect(generatedProblems(fs(noContract), sprites)).toEqual(["src/contract.json is missing"]);
    expect(generatedProblems(fs({ ...good, "src/contract.json": '{"assetGroups": {' }), sprites)[0]).toMatch(/doesn't parse/);
    expect(generatedProblems(fs({ ...good, "src/contract.json": "{}" }), sprites)).toEqual(["src/contract.json has no assetGroups"]);
  });
  it("a group regenerated without its contract (or the other way round), missing, resized or left over", () => {
    expect(generatedProblems(fs({ ...good, "public/sprites/sp-moon.json": '{"group":"sp-moon","sprites":{"x":1}}' }), sprites)[0]).toMatch(/sp-moon.json is out of date/);
    const { ["public/sprites/room.json"]: _, ...noRoom } = good;
    expect(generatedProblems(fs(noRoom), ["public/sprites/sp-moon.json"])).toEqual(["public/sprites/room.json (contract group room) is missing"]);
    const resized = contract({ room: { file: "sprites/room.json", v: sha10(room), bytes: 1 } });
    expect(generatedProblems(fs({ ...good, "src/contract.json": resized }), sprites)[0]).toMatch(/room.json is \d+ bytes, the contract says 1/);
    expect(generatedProblems(fs({ ...good, "public/sprites/sp-old.json": "{}" }), [...sprites, "public/sprites/sp-old.json"])).toEqual([
      "public/sprites/sp-old.json isn't in src/contract.json (left over from an older gen.py run?)",
    ]);
  });
  it("a broken journal art file or .riv", () => {
    expect(generatedProblems(fs({ ...good, "src/journal-art.json": "{" }), sprites)[0]).toMatch(/journal-art.json doesn't parse/);
    expect(generatedProblems(fs({ ...good, "public/jellytank.riv": "" }), sprites)).toEqual(["public/jellytank.riv is missing, tiny or not a .riv"]);
  });
});

describe("guard.mjs in a scratch repo", () => {
  const guard = fileURLToPath(new URL("./guard.mjs", import.meta.url));
  const lib = fileURLToPath(new URL("./guard-lib.mjs", import.meta.url));
  const repo = mkdtempSync(join(tmpdir(), "jt-guard-"));
  const sh = (cmd, ...a) => execFileSync(cmd, a, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GUARD_BASE: "", GITHUB_BASE_REF: "", GITHUB_EVENT_NAME: "" } });
  const runGuard = (...a) => {
    try {
      return { code: 0, out: sh("node", "tools/guard.mjs", ...a) };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };
  const write = (p, s) => {
    mkdirSync(join(repo, p, ".."), { recursive: true });
    writeFileSync(join(repo, p), s);
  };
  const sha10 = (b) => createHash("sha1").update(b).digest("hex").slice(0, 10);
  const big = (n) => "export const x = 1;\n".repeat(n);

  sh("git", "init", "-q", "-b", "main");
  write("tools/guard.mjs", readFileSync(guard));
  write("tools/guard-lib.mjs", readFileSync(lib));
  const moon = '{"group":"sp-moon","sprites":{}}';
  write("public/sprites/sp-moon.json", moon);
  write("src/contract.json", JSON.stringify({ assetGroups: { "sp-moon": { file: "sprites/sp-moon.json", v: sha10(Buffer.from(moon)), bytes: moon.length } } }));
  write("public/jellytank.riv", Buffer.concat([Buffer.from("RIVE"), Buffer.alloc(2000, 0)]));
  write("src/sim.ts", big(100));
  sh("git", "add", "-A");
  sh("git", "commit", "-qm", "base");
  sh("git", "branch", "base");

  it("passes a clean tree", () => {
    const r = runGuard("--base", "base");
    expect(r.code, r.out).toBe(0);
  });
  it("fails a truncated file until a commit trailer allows it; fails a conflict marker", () => {
    write("src/sim.ts", big(10));
    let r = runGuard("--base", "base");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/src\/sim.ts: shrank \(2000 -> 200 bytes/);
    sh("git", "commit", "-qam", "cut the sim\n\nGuard-Allow-Shrink: src/sim.ts");
    expect(runGuard("--base", "base").code).toBe(0);
    write("src/sim.ts", `${big(10)}${LT} HEAD\n`);
    r = runGuard("--base", "base");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/src\/sim.ts:11: conflict marker/);
    sh("git", "checkout", "-q", "src/sim.ts");
  });
  it("--staged reads the index, not the working tree, and checks generated files only when staged", () => {
    write("src/other.ts", big(100));
    sh("git", "add", "src/other.ts");
    write("src/other.ts", "");
    expect(runGuard("--staged").code).toBe(0);
    sh("git", "add", "src/other.ts");
    const r = runGuard("--staged");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/src\/other.ts: empty/);
    sh("git", "reset", "-q", "src/other.ts");
    write("public/sprites/sp-moon.json", '{"changed":1}');
    sh("git", "add", "public/sprites/sp-moon.json");
    expect(runGuard("--staged").out).toMatch(/sp-moon.json is out of date/);
    sh("git", "reset", "-q", "--hard");
  });
  it("installs the pre-commit hook, refuses to clobber another one without --force", () => {
    const hook = join(repo, ".git/hooks/pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho mine\n");
    expect(runGuard("--install-hook").code).toBe(1);
    expect(runGuard("--install-hook", "--force").code).toBe(0);
    expect(readFileSync(hook, "utf8")).toContain("node tools/guard.mjs --staged");
    expect(statSync(hook).mode & 0o111).not.toBe(0);
    // the hook stops a commit with a marker in it
    write("src/bad.ts", `${LT} HEAD\n`);
    sh("git", "add", "src/bad.ts");
    expect(() => sh("git", "commit", "-qm", "bad")).toThrow();
    expect(existsSync(hook)).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });
});
