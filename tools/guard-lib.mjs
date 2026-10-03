// The merge guard's rules, pure (no git, no file system): tools/guard.mjs feeds them, tools/guard.test.mjs tests them.
import { createHash } from "node:crypto";

// ---------------------------------------------------------------- conflict markers

// A merge leaves `<<<<<<< ours`, `=======`, `>>>>>>> theirs` (and `||||||| base` with diff3) at the start of a line.
const OPEN = /^<{7}(?: |$)/;
const CLOSE = /^>{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const MID = /^={7}$/;
// a Markdown heading can be underlined with exactly seven `=`: there a lone `=======` only counts next to the others
const PROSE = /\.(md|markdown|rst|txt)$/i;

/** Conflict markers left in a text file: [{ line (1-based), marker }]. */
export function conflictMarkers(text, path = "") {
  const out = [];
  const lines = text.split("\n");
  let strong = false;
  lines.forEach((raw, i) => {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (OPEN.test(l) || CLOSE.test(l) || BASE.test(l)) {
      out.push({ line: i + 1, marker: l.slice(0, 7) });
      strong = true;
    } else if (MID.test(l)) out.push({ line: i + 1, marker: "=======" });
  });
  return PROSE.test(path) && !strong ? [] : out;
}

/** Binary, by git's rule of thumb: a NUL byte in the first 8000 bytes. */
export const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

// ---------------------------------------------------------------- empty or shrunken source files

const SOURCE_EXT = /\.(ts|js|mjs|cjs|py|css|html|md|json)$/;

/** The files the shrink and empty checks watch: sources under src/ and tools/, root config, and the workflows. */
export function inScope(path) {
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return true;
  if (!SOURCE_EXT.test(path)) return false;
  return path.startsWith("src/") || path.startsWith("tools/") || !path.includes("/");
}

/** Files smaller than this at the base aren't held to the shrink rule (a 300-byte file losing a line is not a truncation). */
export const SHRINK_MIN_BASE = 512;
/** A file that lost more than this share of its bytes since the base fails, unless it's allowed. */
export const SHRINK_MAX = 0.4;

/**
 * entries: [{ path, base: bytes at the base ref or null (new file), now: bytes now or null (deleted), blank: whitespace only }]
 * allowed: a Set of paths that may shrink (allowlist file, commit trailers, GUARD_ALLOW_SHRINK).
 * Deleted files pass (a deletion is deliberate and shows in the diff); empty ones fail even when allowed.
 */
export function sizeViolations(entries, allowed = new Set(), { maxShrink = SHRINK_MAX, minBase = SHRINK_MIN_BASE } = {}) {
  const out = [];
  for (const e of entries) {
    if (!inScope(e.path) || e.now === null) continue;
    if (e.now === 0 || e.blank) {
      out.push({ path: e.path, rule: "empty", detail: e.base ? `was ${e.base} bytes` : "new empty file" });
      continue;
    }
    if (e.base === null || e.base < minBase || allowed.has(e.path)) continue;
    const lost = 1 - e.now / e.base;
    if (lost > maxShrink) out.push({ path: e.path, rule: "shrank", detail: `${e.base} -> ${e.now} bytes (-${Math.round(lost * 100)}%)` });
  }
  return out;
}

/** Paths in an allowlist file: one per line, `#` comments and blank lines ignored. */
export const parseAllowlist = (text) =>
  text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);

/** Paths named by `Guard-Allow-Shrink: <path>[, <path>...]` lines in commit messages. */
export const trailerPaths = (messages) =>
  messages.split("\n").flatMap((line) => {
    const m = line.match(/^\s*Guard-Allow-Shrink:\s*(.*)$/i);
    return m ? m[1].split(/[,\s]+/).filter(Boolean) : [];
  });

// ---------------------------------------------------------------- generated files

const sha10 = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 10);

/**
 * The generated files agree with each other: src/contract.json parses; every sprite group it lists (and the room's)
 * is in public/ with the hash and size gen.py wrote; no public/sprites/*.json is left that it doesn't list;
 * src/journal-art.json parses; public/jellytank.riv is a .riv.
 * read(path) -> Buffer | null; spriteFiles: the public/sprites/*.json paths that exist (or are tracked/staged).
 */
export function generatedProblems(read, spriteFiles = []) {
  const out = [];
  const raw = read("src/contract.json");
  if (!raw) return ["src/contract.json is missing"];
  let contract;
  try {
    contract = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    return [`src/contract.json doesn't parse: ${e.message}`];
  }
  if (!contract || typeof contract !== "object" || !contract.assetGroups || typeof contract.assetGroups !== "object") {
    return ["src/contract.json has no assetGroups"];
  }
  const groups = [...Object.entries(contract.assetGroups), ...(contract.room ? [["room", contract.room]] : [])];
  const listed = new Set();
  for (const [name, g] of groups) {
    if (!g || typeof g.file !== "string" || typeof g.v !== "string") {
      out.push(`contract group ${name} has no file/v`);
      continue;
    }
    const path = `public/${g.file}`;
    listed.add(path);
    const buf = read(path);
    if (!buf) {
      out.push(`${path} (contract group ${name}) is missing`);
      continue;
    }
    const v = sha10(buf);
    if (v !== g.v) out.push(`${path} is out of date: hash ${v}, the contract says ${g.v} (rerun npm run riv:build and commit both)`);
    else if (typeof g.bytes === "number" && g.bytes !== buf.length) out.push(`${path} is ${buf.length} bytes, the contract says ${g.bytes}`);
  }
  for (const f of spriteFiles) if (!listed.has(f)) out.push(`${f} isn't in src/contract.json (left over from an older gen.py run?)`);
  const art = read("src/journal-art.json");
  if (art) {
    try {
      JSON.parse(art.toString("utf8"));
    } catch (e) {
      out.push(`src/journal-art.json doesn't parse: ${e.message}`);
    }
  }
  const riv = read("public/jellytank.riv");
  if (!riv || riv.length < 1024 || riv.subarray(0, 4).toString("latin1") !== "RIVE") out.push("public/jellytank.riv is missing, tiny or not a .riv");
  return out;
}
