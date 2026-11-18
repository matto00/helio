## Why

The e2e CI leg 6 runs to the 25-minute job limit and is cancelled with zero failed tests (PRs #1163, #1165, #1169, and main run 44369179186 at 1519 s). Each cancellation costs a rerun and blocks a merge. Measured on recent main runs, the cause is a stale shard weight table, not a too-tight limit or a single slow spec. See design.md, Context.

## What Changes

- Regenerate `e2e/shard-weights.tsv` from the Playwright JSON reports of the five most recent main CI runs in which every e2e leg succeeded with no flaky or unexpected results, using the existing documented command (`node scripts/e2e-shard.mjs weights <runDir>...`). The table has not been regenerated since HEL-1667 (2026-10-21); 22 discovered specs currently have no row and fall back to the 49 s median, two of which really cost about 330-360 s each and both sit on leg 6.
- Update the e2e job's measured-wall comment in `.github/workflows/ci.yml` (comment only; no change to `timeout-minutes`, the matrix, or any step).
- Record the before measurement (recent main runs) and the after measurement (at least three CI runs of the PR) with per-leg job wall and test-step times and the headroom under the 1500 s limit.
- No change to `scripts/e2e-shard.mjs` logic, the leg count, or `timeout-minutes`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The existing `e2e-ci-sharding` requirements (weighted assignment from CI evidence; slowest leg at most 20 minutes without raising `timeout-minutes`) already describe the intended behavior; this change restores compliance with them by refreshing the data they depend on. `skip_specs: true`.

## Impact

- `e2e/shard-weights.tsv` (data), `.github/workflows/ci.yml` (one comment block in the `e2e` job).
- Which spec files run on which leg changes for every PR after merge. No test, product code, or migration changes.
- Not touched: `cd-backend.yml`, `cd-frontend.yml`, any release workflow, HEL-1743's and HEL-1732's files.
