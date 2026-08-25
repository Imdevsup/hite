// Isolated production-build gate.
//
// Why this exists: on Windows with Defender real-time scanning (and/or a dev
// server + other agents sharing the default `.next`), `next build` reliably
// COMPILES but then dies in the manifest/page-data write phase with a moving
// `ENOENT ... _buildManifest.js.tmp.<rand>` / `pages-manifest.json`. Turbopack
// writes `<manifest>.tmp.<rand>` then renames; an AV scan or a concurrent
// process touching the shared `.next` makes the temp vanish before the rename.
//
// Building into a unique, throwaway distDir removes all contention so the gate
// reflects the code, not the filesystem. `next.config.ts` already honors
// `HITE_VERIFY_DIST` for `distDir`.
//
// Usage: `npm run build:verify`  (alias of the real build gate)

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const dist = `.next-verify-${process.pid}-${Date.now().toString(36)}`;
const distPath = join(process.cwd(), dist);

function cleanup() {
  try {
    rmSync(distPath, { recursive: true, force: true });
  } catch {
    // best-effort; a leftover throwaway dir is harmless and git-ignored
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, HITE_VERIFY_DIST: dist },
    // npx.cmd must run through the shell on Windows
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
