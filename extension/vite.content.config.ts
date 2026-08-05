/**
 * Second build pass for ScrapperNinja's content script ONLY.
 *
 * MV3 content scripts cannot be ES modules, but the main build (vite.config.ts)
 * emits the popup and service worker as rollup format "es" and rollup cannot
 * mix output formats in a single build. So the content script is compiled
 * separately here as an IIFE and dropped into the SAME dist/scrapperninja/
 * folder with emptyOutDir FALSE, so it does not wipe the main build's output.
 */

import { resolve } from "node:path";

import { defineConfig } from "vite";

const API_ORIGIN = process.env.VITE_API_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  define: {
    __API_ORIGIN__: JSON.stringify(API_ORIGIN),
  },
  build: {
    outDir: resolve(__dirname, "dist", "scrapperninja"),
    // Must NOT empty the dir — the main build's popup/background/manifest are
    // already there.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(
        __dirname,
        "products",
        "scrapperninja",
        "src/content.ts",
      ),
      output: {
        format: "iife",
        entryFileNames: "content.js",
        // A single self-contained file — no code-split chunks for a content
        // script.
        inlineDynamicImports: true,
      },
    },
  },
});
