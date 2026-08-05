/**
 * Vite build for the ScrapperNinja MV3 extension.
 *
 * PRODUCT must be `scrapperninja` (defaults in build.mjs). Output:
 * `extension/dist/scrapperninja/`.
 *
 * Popup + service worker live under `products/scrapperninja/`. Shared code
 * (API client, types, popup CSS) lives in `extension/shared/`.
 *
 * MV3 content scripts cannot be ES modules — ScrapperNinja's content script is
 * built by a second pass (`vite.content.config.ts`).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const PRODUCT = "scrapperninja" as const;
const PRODUCT_DIR = resolve(__dirname, "products", PRODUCT);

const API_ORIGIN = process.env.VITE_API_ORIGIN ?? "http://localhost:3000";

const ICON_SIZES = [16, 32, 48, 128] as const;

function emitManifest(): Plugin {
  return {
    name: "emit-manifest",
    generateBundle() {
      const template = readFileSync(
        resolve(PRODUCT_DIR, "manifest.template.json"),
        "utf8",
      );
      const manifest = JSON.parse(
        template.replaceAll("__API_ORIGIN__", API_ORIGIN),
      ) as Record<string, unknown> & {
        action?: Record<string, unknown>;
      };

      const iconDirs = [
        resolve(PRODUCT_DIR, "icons"),
        resolve(__dirname, "icons"),
      ];
      const icons: Record<string, string> = {};
      for (const size of ICON_SIZES) {
        const source = iconDirs
          .map((dir) => resolve(dir, `icon-${size}.png`))
          .find((path) => existsSync(path));
        if (!source) continue;
        const fileName = `icons/icon-${size}.png`;
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(source),
        });
        icons[String(size)] = fileName;
      }
      if (Object.keys(icons).length > 0) {
        manifest.icons = icons;
        if (manifest.action) manifest.action.default_icon = icons;
      }

      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}

export default defineConfig({
  base: "./",
  root: PRODUCT_DIR,
  plugins: [react(), tailwindcss(), emitManifest()],
  define: {
    __API_ORIGIN__: JSON.stringify(API_ORIGIN),
  },
  build: {
    outDir: resolve(__dirname, "dist", PRODUCT),
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(PRODUCT_DIR, "popup.html"),
        background: resolve(PRODUCT_DIR, "src/background.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
      },
    },
  },
});
