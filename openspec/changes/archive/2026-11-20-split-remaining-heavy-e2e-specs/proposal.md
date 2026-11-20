## Why

HEL-1778 split three heavy e2e specs, but on its 5 counting PR attempts the slowest leg still reached 1289 s and
1233 s, over the 1200 s target (limit 1500 s, `timeout-minutes: 25`). Two causes remain (HEL-1789): six heavy or
near-miss spec files outside HEL-1778's scope that are large and swing between runs (hel1582-sweep-375,
state-surface-contrast-guard, hel1582-mobile-pipeline, hel1684-draft-structural, hel1573-motion-primitives,
hel1575-dashboard-tabs at about 740 s in one file), and a leg-wide slowdown where every file on one leg runs about
1.2-1.4x slow together, whose cause has never been examined. Separately, six HEL-1774 spec files (49-116 s each) have
no weight row and are placed at the 50 s default.

## What Changes

- Name the variance cause of each of the six specs from CI Playwright reports (per-test spread, share of run, leg
  co-movement), before any split.
- Split each of the six into parts of at most about 200 s median, along existing describe/loop boundaries, keeping
  every test's title path, project, body and assertions; shared code moves once into `e2e/support/`. Cut cost only for
  a named setup-only waste that touches no assertion.
- Investigate the leg-wide slowdown from what CI already records (job logs' runner and image lines, step timings,
  per-test co-movement), and state what the artifacts can and cannot show. Add a per-leg runner record to the `e2e`
  job (CPU model, vCPU count, memory, and a 1 Hz load/steal sample via the existing `scripts/ci-load-sampler.cjs`),
  uploaded as an artifact, so the measurement runs of this change, and every later run, can attribute a slow leg.
- Regenerate `e2e/shard-weights.tsv` with `node scripts/e2e-shard.mjs weights --list` from the most recent counting
  7-leg main runs (giving the HEL-1774 files and the split parts real rows).
- Measure the slowest and mean leg on at least 5 counting CI runs of the PR (empty-commit pushes, never whole-run
  reruns), with the runner record per leg.
- No change to `timeout-minutes`, the leg count, the partition algorithm, product code, or migrations.

## Capabilities

### New Capabilities

### Modified Capabilities

- `e2e-ci-sharding`: adds a requirement that each e2e CI leg records the runner it ran on and its load over the run,
  as an artifact separate from the test report.

## Impact

- `e2e/`: six spec files replaced by their parts; new or extended `e2e/support/` modules; `e2e/shard-weights.tsv`.
- `.github/workflows/ci.yml` (`e2e` job only): runner record + load sampler steps and one artifact upload.
- `scripts/ci-load-sampler.cjs` reused unchanged (or, if a runner-identity line is added to it, its selftest extended).
- No product code, schema, migration, CD or release workflow change.
