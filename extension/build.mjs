/**
 * ScrapperNinja extension build entry.
 *
 * Usage: PRODUCT=scrapperninja node build.mjs
 *
 * Steps: type-check, main Vite build (popup + service worker + manifest), then
 * the IIFE content-script pass (vite.content.config.ts).
 */

import { spawnSync } from "node:child_process";

const product = process.env.PRODUCT ?? "scrapperninja";

if (product !== "scrapperninja") {
  console.error(`PRODUCT must be scrapperninja (got "${product}")`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

run(npx, ["tsc", "--noEmit"]);
run(npx, ["vite", "build"]);
run(npx, ["vite", "build", "--config", "vite.content.config.ts"]);

console.log(`\nBuilt extension -> dist/${product}/`);
