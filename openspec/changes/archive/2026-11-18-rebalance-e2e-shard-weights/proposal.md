## Why

The e2e CI leg 6 runs to the 25-minute job limit and is cancelled with zero failed tests (PRs #1163, #1165, #1169, and main run 44369179186 at 1519 s). Each cancellation costs a rerun and blocks a merge. Measured on recent main runs, the cause is a stale shard weight table, not a too-tight limit or a single slow spec. See design.md, Context.

## What Changes

- Regenerate `e2e/shard-weights.tsv` from the Playwright JSON reports of the five most recent main CI runs in which every e2e leg succeeded with no flaky or unexpected results, using the existing documented command (`node scripts/e2e-shard.mjs weights <runDir>...`). The table has not been regenerated since HEL-1667 (2026-10-21); 22 discovered specs currently have no row and fall back to the 49 s median, two of which really cost about 330-360 s each and both sit on leg 6.
- Update the e2e job's measured-wall comment in `.github/workflows/ci.yml`. (In the original change this was comment-only; the fold-in below also changes the matrix. `timeout-minutes` is never changed.)
- Record the before measurement (recent main runs) and the after measurement (at least three CI runs of the PR) with per-leg job wall and test-step times and the headroom under the 1500 s limit.
- **Fold-in (owner ruling, after measuring the 6-leg PR runs):** the `e2e` matrix goes from 6 to 7 legs (`shard: [1..7]`, `max-parallel: 7`), `DEFAULT_E2E_LEGS` in `scripts/e2e-shard.mjs` goes to 7 (the selftest asserts it equals the matrix length), and the comments and docs that state the leg count (ci.yml e2e job, `playwright.config.ts` workers comment, `e2e/README.md`) and `MISTAKES.md`'s leg-cap statement are updated. CI concurrency becomes backend 4 + e2e 7 = 11 parallel jobs.
- No change to `scripts/e2e-shard.mjs` partition logic or to `timeout-minutes`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The existing `e2e-ci-sharding` requirements (weighted assignment from CI evidence; slowest leg at most 20 minutes without raising `timeout-minutes`) already describe the intended behavior; this change restores compliance with them by refreshing the data they depend on. `skip_specs: true`.

## Impact

- `e2e/shard-weights.tsv` (data), `.github/workflows/ci.yml` (e2e matrix and comments), `scripts/e2e-shard.mjs` (`DEFAULT_E2E_LEGS` constant and its comment), `scripts/e2e-shard.selftest.mjs` (its default-path fixtures hardcode 6 and are derived from the constant instead), `MISTAKES.md` (the leg-cap statement), `playwright.config.ts` and `e2e/README.md` (comments/docs).
- Which spec files run on which leg changes for every PR after merge. No test, product code, or migration changes.
- Not touched: `cd-backend.yml`, `cd-frontend.yml`, any release workflow, HEL-1743's and HEL-1732's files.
