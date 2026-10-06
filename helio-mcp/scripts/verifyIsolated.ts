/**
 * `npm run verify:isolated` (HEL-1297): runs the verify harness against a backend on its own throwaway
 * database, so no other worktree backend's retention purge can thin the 30-point history read.
 * Needs `npm run build` (helio-mcp/dist) and `cd backend && sbt assembly` first. See README "Isolated verify run".
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runIsolated } from "./isolatedRun.js";

const mcpRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

runIsolated({ repoRoot: resolve(mcpRoot, ".."), mcpRoot })
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`isolated verify failed: ${(err as Error).stack ?? err}\n`);
    process.exit(1);
  });
