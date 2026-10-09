// HEL-1442: local-only jest resource caps, shared by the root and frontend jest configs.
//
// 2026-10-09: two concurrent husky pre-commit `npm test` runs each spawned jest's default of
// (cores - 1) = 11 workers (13 node processes, ~12 GB each) and, with a third lane, OOM-killed the box.
// CI's 4-vCPU runner gets jest's default of 3 workers, so 3 is the hard cap here: caps apply only
// when `CI` is unset (any non-empty value counts as CI, as in playwright.config.ts and build.sbt: `CI=false` is NOT
// capped) and the returned object is EMPTY under CI, so `jest --showConfig` is unchanged
// there (the keys are omitted, not set to CI's value).
//
// Overrides (one-off, env only; `--maxWorkers=N` on the CLI still wins over the config):
//   HELIO_JEST_MAX_WORKERS=<positive integer>   worker count for this run
// An invalid override throws: it is never ignored and never silently uncapped.
const path = require("path");

const LOCAL_MAX_WORKERS = 3;
// A worker whose RSS is above this after finishing a test file is recycled (a fresh worker re-reads the on-disk
// transform cache). Healthy capped frontend workers peak at 1.6-1.8 GB RSS, so this deliberately recycles some healthy
// workers too: it keeps per-worker growth bounded at a cost already inside the measured +8-11 s wall-clock.
const LOCAL_WORKER_IDLE_MEMORY_LIMIT = "1.5GB";

function resolveMaxWorkers(env) {
  const raw = env.HELIO_JEST_MAX_WORKERS;
  if (raw === undefined || raw === "") return LOCAL_MAX_WORKERS;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`HELIO_JEST_MAX_WORKERS must be a positive integer (e.g. 2), got "${raw}"`);
  }
  return Number(raw);
}

/**
 * @param {string} rootDir the jest config's directory (its `rootDir`)
 * @returns {object} config keys to spread into the jest config; `{}` when `CI` is set
 */
function localJestCaps(rootDir, env = process.env) {
  if (env.CI) return {};
  return {
    maxWorkers: resolveMaxWorkers(env),
    workerIdleMemoryLimit: LOCAL_WORKER_IDLE_MEMORY_LIMIT,
    // jest's default cache lives in os.tmpdir() (tmpfs on the dev box = RAM), one transform/haste-map set per
    // checkout, never cleaned: 5.7 GB across 863 entries at HEL-1442. On disk inside the checkout it is
    // removed with the worktree. Gitignored (`.jest-cache/`).
    cacheDirectory: path.join(rootDir, ".jest-cache"),
  };
}

module.exports = { localJestCaps, LOCAL_MAX_WORKERS };
