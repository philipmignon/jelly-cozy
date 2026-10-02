import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  plugins: [
    {
      // the loading screen markup is shared with tools/page.mjs
      name: "jellytank-loader",
      transformIndexHtml: (html) => html.replace("<!--loader-->", readFileSync("src/loader.html", "utf8")),
    },
  ],
});
