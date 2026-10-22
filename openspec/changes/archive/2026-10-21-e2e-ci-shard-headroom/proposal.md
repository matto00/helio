## Why

After HEL-1667's reweighting, e2e legs still run 21.5-25.0 min against a 25-minute `timeout-minutes` (last 5 green
main runs: slowest 1415/1449/1292/1394/1498 s). The 4-leg weighted plan is already balanced to 1 s, so the spread is
runner speed, not planning: neither reweighting nor splitting specs can add headroom at 4 legs. Timeout cancellations
already cost reruns on #1082 and #1084.

## What Changes

- The `e2e` matrix goes from 4 to 6 legs (owner ruling on HEL-1698, 2026-10-22, superseding the earlier ~8-leg
  backend+e2e cap: backend 4 + e2e 6 = 10 parallel jobs). No spec is split or moved; per-file weights are unchanged
  (they are leg-count independent) and the partition stays `scripts/e2e-shard.mjs`'s runtime LPT plan.
- A shared local composite action (`.github/actions/e2e-setup`) holds the e2e setup steps (JDK, sbt, sbt cache
  restore, backend start, Node, `npm ci` x2, Playwright browsers, backend health, optional Vite). `ci.yml`'s `e2e` and
  `e2e-prod-build` jobs and `e2e-slow.yml` use it.
- A committed selftest for `scripts/check-e2e-slow-results.mjs`, wired into CI's `frontend` job.
- Stale comments fixed: ci.yml "Slowest leg measures ~7 min" and the "at most 4 legs" notes in ci.yml,
  `playwright.config.ts` and `e2e/README.md`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `e2e-ci-sharding`: adds a leg-duration headroom requirement (slowest leg at or under 20 min).

## Impact

CI only: `.github/workflows/ci.yml`, `.github/workflows/e2e-slow.yml`, new `.github/actions/e2e-setup/action.yml`,
new `scripts/check-e2e-slow-results.selftest.mjs`, `scripts/e2e-shard.mjs` (+ selftest),
`scripts/check-ci-sbt-no-pattern-kill.mjs` (`SCANNED`), `package.json`, comments in `playwright.config.ts` and
`e2e/README.md`. Two more concurrent jobs per CI run. No product code, no test assertion changes.

## Non-goals

- Raising `timeout-minutes` (stays 25).
- Splitting specs, cutting per-test login setup, or changing any test's coverage.
- Regenerating `e2e/shard-weights.tsv` (only via `scripts/e2e-shard.mjs weights` if ever needed).
- The 5-run post-merge main measurement for the AC (driver-owned after merge).
