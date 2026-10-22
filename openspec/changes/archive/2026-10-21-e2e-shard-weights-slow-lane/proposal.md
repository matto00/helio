## Why

The four e2e CI legs on main now run 15-25 min against a 25-minute `timeout-minutes` (shard 2 reached 24m58s, run
39542663790; HEL-1681's PR #1082 had e2e (2) cancelled after 206/206 passed). Newer specs (hel1631, hel1656, hel1665,
hel1668-*, hel1681, hel1683, ...) have no row in `e2e/shard-weights.tsv`, so they default to the median weight and the
legs drift apart. Separately, the `HELIO_E2E_SLOW=1` 390/768 MAXIMAL phone sweeps (HEL-1582 owner ruling) run nowhere
in CI, so a regression in them would go unnoticed.

## What Changes

- Regenerate `e2e/shard-weights.tsv` with the documented `node scripts/e2e-shard.mjs weights <runDir>...` from main CI
  runs whose four `playwright-json-shard-*` reports are complete and clean (the script's own validator). No hand edits.
- Add `.github/workflows/e2e-slow.yml`: a weekly scheduled lane (owner ruling 2026-10-21: weekly, not nightly) plus
  `workflow_dispatch`, running only `e2e/hel1582-sweep-390.spec.ts` and `e2e/hel1582-sweep-768.spec.ts` with
  `HELIO_E2E_SLOW=1`, and failing if the gated tests were skipped instead of run.
- Report before/after e2e leg times measured from real CI runs.

## Capabilities

### New Capabilities
- `e2e-slow-lane`: a scheduled CI lane that runs the slow-gated e2e sweeps that PR CI skips.

### Modified Capabilities
<!-- none: weight regeneration uses the existing e2e-ci-sharding mechanism unchanged -->

## Impact

- `e2e/shard-weights.tsv` (regenerated), new `.github/workflows/e2e-slow.yml`, `e2e/README.md` (slow-lane note),
  comment/skip-reason text only in `e2e/support/hel1582Phone.ts` and `e2e/hel1582-sweep-{390,768}.spec.ts`, and a
  comment-only cross-reference in `ci.yml`.
- CI: one extra job per week (~15 runner-minutes, public repo), plus runs on PRs that edit the slow-lane workflow file.
- No application code, no schema, no behavioural `ci.yml` change.

## Non-goals

- Changing `timeout-minutes`, the number of legs, Playwright workers, or `scripts/e2e-shard.mjs` itself.
- Fixing `hel1631-draft-mode.spec.ts:177` (HEL-1691) or any other flaky spec.
- Running other suites (regression harness, full suite) under `HELIO_E2E_SLOW=1`.
