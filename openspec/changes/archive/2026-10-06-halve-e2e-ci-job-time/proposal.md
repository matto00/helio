## Why

The CI `e2e` job now takes ~15–19 min wall-clock on `main` (Playwright suite 12–16 m, 145–149 tests on 2 workers),
gating every PR. The owner wants it at ≤ 7 min median without losing real coverage.

## What Changes

- Commit a CI-sourced profile (per-step job timings, per-spec/per-test durations, fixed-wait inventory, setup cost)
  for before and after, as `profile.md` in this change.
- Remove redundant/unnecessary Playwright specs or tests, each with the named test that still covers it.
- Split the two single-test multi-minute guards (`state-surface-contrast-guard`, `focus-presence-guard`) into
  independently schedulable tests without reducing their measured population.
- Replace fixed `waitForTimeout` waits in the slowest specs with web-first assertions where behaviour-equivalent.
- Shard the `e2e` job across a matrix of runners (`npx playwright test --shard=i/N`, still the config's glob and
  `testIgnore`), and shorten each shard's non-test critical path (overlap backend boot, cache browsers).

## Capabilities

### New Capabilities

None — CI/test tooling only.

### Modified Capabilities

None. `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- Fixing the `hel1260-orphan-owner-repair` flake (tracked separately by the driver); it is not deleted or quarantined.
- Removing quarantined specs tied to open tickets (they cost no CI time; removal needs an owner ruling).
- Any change to the `backend` job or `ci-complete` beyond what the `e2e` matrix needs (HEL-1287 owns backend).
- Product code changes.

## Impact

`.github/workflows/ci.yml` (`e2e` job only), `playwright.config.ts`, `e2e/**`, `e2e/README.md`, this change's
`profile.md`. More runner-minutes per CI run (N shards), less wall-clock.
