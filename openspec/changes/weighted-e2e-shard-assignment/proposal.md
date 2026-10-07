## Why

e2e shard 4's leg median (405 s over the last 25 green runs) sits just under the 420 s target and breaches it on
ordinary runs. Playwright 1.55's `--shard` splits by test count over alphabetically ordered files, so the slow
contrast guard (18 tests at ~15 s each) lands wholly on shard 4, which carries ~405 s of summed test time against
~277 s on shard 3.

## What Changes

- e2e shard assignment becomes weighted: a checked-in per-spec-file weight table, generated from CI Playwright JSON
  artifacts, drives a deterministic longest-processing-time-first partition of the spec files Playwright itself
  discovers (glob plus `testIgnore`, unchanged), mirroring the backend's `TestShards.scala` (HEL-1287).
- Every shard leg verifies that the partition is exact (each discovered spec in exactly one shard) and that the
  selection Playwright actually runs equals its assignment, failing loudly otherwise; an empty shard never falls
  back to running the whole suite.
- A selftest covers the partition logic and is wired the way the repo's other script selftests are.
- A before/after profile from >= 5 sequential CI runs on this change's PR.

## Capabilities

### New Capabilities

- `e2e-ci-sharding`: how the e2e Playwright suite is split across CI legs — exact-once partition of the discovered
  specs, weighting from CI evidence, loud failure on partition defects, and CI-measured balance.

### Modified Capabilities

(none)

## Non-goals

- The `Install Playwright browsers` (`--with-deps`, apt) duration spikes that cause the largest leg-max outliers on
  every shard — a separate cause, candidate follow-up.
- Changing the leg count (capped at 4, MISTAKES.md), Playwright `workers`, or speeding up individual specs.
- Changing a bare local `npm run e2e`.

## Impact

`.github/workflows/ci.yml` (`e2e` job's run step), a new script plus selftest under `scripts/`, a weight table, and
the selftest wiring (`package.json`, `.husky/pre-commit` / CI parity as the repo requires). No product code.
