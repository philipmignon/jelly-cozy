// Builds the shareable pages from dist/: pub/jellytank.html (the main link) and
// pub/jellytank-sync.html (the synced copy, cloud saves on), and prints the files map.
//
// The .riv travels as base64 inside the page. (Measured 2026-10-02: moving it to its own
// script didn't paint sooner, since the page renders progressively, and first frame is
// bandwidth-bound either way, so the simpler single file stays.)
//
// The species' sprites are not in the .riv: each group is its own file (dist/sprites/<group>.json, see
// src/spritegroups.ts) fetched when the tank needs it, so they are published beside the page at the same
// relative paths. Republishing: pass the whole map; group paths are stable (the URL's ?v= busts caches).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const assets = readdirSync("dist/assets");
const js = assets.find((f) => f.startsWith("index-") && f.endsWith(".js"));
const wasm = assets.find((f) => f.endsWith(".wasm"));
const rivB64 = readFileSync("public/jellytank.riv").toString("base64");
const tankJs = `window.__JELLYTANK_RIV_B64=${JSON.stringify(rivB64)};\n`;
const loader = readFileSync("src/loader.html", "utf8");

const page = (title, extra = "") => `<title>${title}</title>
<meta name="theme-color" content="#15161f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen&display=swap" media="print" onload="this.media='all'">
<link rel="preload" href="assets/${wasm}" as="fetch" type="application/wasm" crossorigin>
<link rel="modulepreload" href="assets/${js}">
<style>
  /* One dark aquarium screen: the canvas fills the page inside a slim gutter. */
  :root { --bg: #15161f; --fg: #e8ecf6; color-scheme: dark }
  html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); overflow: hidden }
  body { padding-inline: 16px; box-sizing: border-box }
  canvas { display: block; width: 100%; height: 100%; touch-action: manipulation; outline: none }
</style>
${loader}
<canvas id="tank" aria-label="Jelly Tank: a pixel-art aquarium with jellyfish. Tap the water to call a jelly, use the food can and sponge on the shelf, flip the light switch, and shop."></canvas>
${extra}<script>${tankJs}</script>
<script type="module" src="assets/${js}"></script>
`;

mkdirSync("pub", { recursive: true });
const main = page("Jelly Tank");
writeFileSync("pub/jellytank.html", main);
writeFileSync("pub/jellytank-sync.html", page("Jelly Tank Sync", "<script>window.__JELLYTANK_SYNC = true;</script>\n"));
const groups = Object.values(JSON.parse(readFileSync("src/contract.json", "utf8")).assetGroups ?? {}).map((g) => g.file);
const files = { [`assets/${js}`]: `dist/assets/${js}`, [`assets/${wasm}`]: `dist/assets/${wasm}` };
for (const f of groups) files[f] = `dist/${f}`;
console.log(JSON.stringify(files));
console.log(`page ${Math.round(main.length / 1024)} KB, tank script ${Math.round(tankJs.length / 1024)} KB, ${groups.length} sprite groups`);
