## Why

The e2e CI job's slowest leg still runs 1237-1334 s whenever a leg lands on an older Azure host CPU (AMD EPYC 7763,
Intel Xeon Platinum 8370C, about 1.4x slower on every file), over the 1200 s target and close to the 1500 s
`timeout-minutes`. Spec splitting cannot fix a whole-leg CPU factor; the owner ruled (2026-11-20) to add an 8th leg,
which cuts each leg's test load to about 7/8, rather than raise the timeout or pay for a larger runner class.

## What Changes

- The `e2e` job matrix in `.github/workflows/ci.yml` runs 8 legs (`shard: [1..8]`, `max-parallel: 8`) instead of 7.
  `timeout-minutes` stays 25; `runs-on` stays `ubuntu-24.04`.
- `scripts/e2e-shard.mjs` `DEFAULT_E2E_LEGS` becomes 8 (the existing selftest keeps it equal to the matrix length and
  `max-parallel`).
- `e2e/shard-weights.tsv` is regenerated with `node scripts/e2e-shard.mjs weights --legs 7 --list ...` from counting
  7-leg main runs that include `hel1735-feature-hover` and `hel1791-compact-counter-stack-height` (no hand edits).
- Docs and comments that state the leg count (ci.yml comments, `playwright.config.ts` comment, `e2e/README.md`, `MISTAKES.md`, and the stale "(6 by default)" ci.yml comment) say 8
  and cite the HEL-1793 owner ruling.
- Measurement evidence: a before table (recent 7-leg main runs, slowest/mean leg, CPU per leg) and an after table from
  at least 5 counting 8-leg PR runs, each leg with its CPU model from the `e2e-runner-shard-<n>` record.

## Capabilities

### New Capabilities

### Modified Capabilities
- `e2e-ci-sharding`: the "e2e CI legs keep headroom under the job timeout" requirement gains the per-leg CPU-model
  reporting the runner record now makes possible, the 1200 s target expressed on counting runs of the change itself,
  and the rule that a leg over target on a known slow host CPU is reported with that cause rather than hidden.

## Impact

- CI only: `.github/workflows/ci.yml`, `scripts/e2e-shard.mjs`, `e2e/shard-weights.tsv`, `e2e/README.md`,
  `playwright.config.ts` (comment only), `MISTAKES.md` (leg-count sentence). No app code, no migration, no API change.
- One more runner per CI run (backend 4 + e2e 8 = 12 parallel jobs from the account-wide concurrent-job pool).
