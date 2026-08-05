/**
 * vitest.config.ts — unit-test runner for the pure-logic modules.
 *
 * Only the PURE, DB-free layers are covered here (the lead query builder, CSV
 * serializer, and column catalog), so no Vite React plugin or jsdom is needed —
 * plain vite-node in a Node environment. The `@/` alias mirrors the single
 * `tsconfig.json` path (`"@/*": ["./*"]`) so test imports match app imports.
 *
 * The extension has its own package.json / build, so only its PURE modules are
 * covered here (the capture parsers in `scrapers/text.ts`) — they import no
 * chrome/DOM API, and they are the only place extension harvesting is verified
 * at all, since DOM capture itself is not exercised in CI.
 */

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "extension/dist/**", ".next/**"],
  },
});
