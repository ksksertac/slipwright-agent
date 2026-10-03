// The relay's crypto tests again, in Electron's own Node rather than the system's. The two
// are not the same library: Electron's is built on BoringSSL, which had no
// chacha20-poly1305, and the box passed every test under Node while the app could not pair
// through the relay at all. What the app runs is what this runs.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const electron = createRequire(import.meta.url)("electron");
const run = spawnSync(
  electron,
  ["node_modules/vitest/vitest.mjs", "run", "test/crypto.test.ts", "test/relay.test.ts"],
  { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
);
process.exit(run.status ?? 1);
