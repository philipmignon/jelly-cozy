import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";

/**
 * dist/sw.js for the GitHub Pages build: src/sw.js with this build's file list filled in. Precached: the page,
 * the hashed bundle (JS, wasm, .riv), the manifest and icons. Sprite groups are cached as the tank fetches them
 * (keyed by their ?v= hash); the list here only tells an update which cached groups are still current.
 * The room (src/room.ts, its chunk and sprites/room.json) is only for wide screens: cached like a sprite group when
 * it is fetched, never precached, so a phone never downloads it. The test API's chunk (src/testapi.ts, loaded only
 * with ?test=1) is never precached: a player never downloads it.
 */
function serviceWorker() {
  return {
    name: "jellytank-sw",
    apply: "build" as const,
    generateBundle(this: { emitFile(f: { type: "asset"; fileName: string; source: string }): string }, _: unknown, bundle: Record<string, unknown>) {
      const contract = JSON.parse(readFileSync("src/contract.json", "utf8")) as {
        assetGroups?: Record<string, { file: string; v: string }>;
        room?: { file: string; v: string };
      };
      const icons = readdirSync("public/icons").filter((f) => f.endsWith(".png")).map((f) => `icons/${f}`);
      const wideOnly = (f: string) => /^assets\/room-[^/]*\.js$/.test(f);
      const testOnly = (f: string) => /^assets\/testapi-[^/]*\.js$/.test(f);
      const assets = Object.keys(bundle).filter((f) => f.startsWith("assets/") && !testOnly(f));
      const precache = ["./", ...assets.filter((f) => !wideOnly(f)).sort(), "manifest.webmanifest", ...icons];
      const groups = [...Object.values(contract.assetGroups ?? {}), ...(contract.room ? [contract.room] : [])];
      const versioned = [...groups.map((g) => `${g.file}?v=${g.v}`), ...assets.filter(wideOnly)].sort();
      const template = readFileSync("src/sw.js", "utf8");
      const h = createHash("sha256").update(JSON.stringify({ precache, versioned }));
      for (const f of ["src/sw.js", "index.html", "src/loader.html", "public/manifest.webmanifest", ...icons.map((i) => `public/${i}`)]) h.update(readFileSync(f));
      const config = { version: h.digest("hex").slice(0, 12), precache, versioned };
      const marker = "const CONFIG = __JELLYTANK_SW_CONFIG__;";
      if (template.split(marker).length !== 2) throw new Error(`src/sw.js needs exactly one "${marker}"`);
      this.emitFile({ type: "asset", fileName: "sw.js", source: template.replace(marker, `const CONFIG = ${JSON.stringify(config)};`) });
    },
  };
}

export default defineConfig({
  base: "./",
  // tools/e2e.mjs gives its dev server a cache of its own: worktrees share node_modules, and a server re-optimizing
  // deps in the shared node_modules/.vite reloads pages served by the others mid-test
  ...(process.env.JT_VITE_CACHE_DIR ? { cacheDir: process.env.JT_VITE_CACHE_DIR } : {}),
  build: { target: "es2022" },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  plugins: [
    {
      // the loading screen markup (src/loader.html) goes into index.html
      name: "jellytank-loader",
      transformIndexHtml: (html) => html.replace("<!--loader-->", readFileSync("src/loader.html", "utf8")),
    },
    serviceWorker(),
  ],
});
