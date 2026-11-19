## Why

At 7 legs the slowest e2e leg still crossed 1200 s on 3 of 5 counting attempts (HEL-1772 PR #1172), with 1441 s leaving only 59 s under the 1500 s job limit. The cause is a few heavy spec files whose cost swings 30-60 % between runs, each landing whole on one leg (a file is never split across legs), plus stale or missing weight rows for specs added since the last regeneration.

## What Changes

- Name, from CI Playwright reports of 7-leg main runs, why each of `hel1665-home-phone-stability`, `hel1733-draft-outputs-shapes` and `hel1583-glass-nav` varies between runs (spec-specific cost versus a run-wide slowdown, per-test spread, serial-in-one-worker scheduling).
- Split each of those three spec files into smaller files that the weighted partition can place on different legs, keeping every test, its title path and every assertion unchanged (before/after test list proven equal). Shared helpers move into an `e2e/` helper module. Where the named cause is spec-specific waste, cut it as well.
- Teach `scripts/e2e-shard.mjs weights` to attribute a CI report's test results to the file that now contains each test (by title path, from the current Playwright test list), so split files get weights measured in CI instead of the median default. Covered by the selftest, red first.
- Regenerate `e2e/shard-weights.tsv` from counting 7-leg main runs (which fixes the stale `hel1608-spine-count-overlap` row and adds the specs merged since HEL-1772).
- Measure the slowest and mean leg on at least 5 counting CI attempts of the PR head, with headroom under 1500 s, reported in the PR.
- No change to `timeout-minutes`, the leg count, the partition algorithm, CD or release workflows.

## Capabilities

### New Capabilities

### Modified Capabilities
- `e2e-ci-sharding`: the weight-table requirement gains re-attribution of results to the file that currently contains each test, so a split or moved spec is weighted from CI evidence rather than defaulted.

## Impact

- `e2e/hel1665-home-phone-stability*.spec.ts`, `e2e/hel1733-draft-outputs-shapes*.spec.ts`, `e2e/hel1583-glass-nav*.spec.ts` (split), new shared helper module(s) under `e2e/`.
- `e2e/shard-weights.tsv` (regenerated), `scripts/e2e-shard.mjs`, `scripts/e2e-shard.selftest.mjs` (gate chain: run by `.husky/pre-commit`), `e2e/README.md`.
- `frontend/src/features/home/ui/HomePage.css.test.ts` comment that names the hel1665 spec file.
- CI cost: none added (same legs); measurement reruns of the PR are labelled as such.
