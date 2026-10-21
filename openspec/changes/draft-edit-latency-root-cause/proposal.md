## Why

`e2e/hel1631-draft-mode.spec.ts:177` (draft edit latency) failed on 3 of the last 4 main CI runs (see ticket.md for the
per-edit numbers). Nobody knows whether the slow edits are app work on the edit path or the CI runner being busy, so
neither a fix nor a measurement change can be justified yet. The flake also blocks HEL-1667 (e2e re-shard).

## What Changes

- The burst test records, for every edit, a breakdown of where the time went (renderer main-thread CPU vs wall clock,
  script, GC, style/layout), logged on every run and included in the failure message.
- During diagnosis the test also captures a Chrome trace of the burst on the CI runner, saved under `test-results/`.
- CI evidence is gathered on this branch's PR and classified: app work on the edit path, or runner contention.
- App work: the cost on the edit path is fixed and the unchanged budget passes. Contention: the measurement question goes
  to the owner with the evidence and a recommendation; nothing is relaxed without a ruling.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The budget (edit 1 < 100 ms, edits 2-10 < 50 ms) is unchanged. A ruled measurement change, if any, is re-planned.

## Revision after owner ruling (prod-build-measurement)

Evidence (evidence.md) selected dev-build-only cost; the owner ruled that opted-in latency assertions run against a
production build in CI with the budget unchanged. Added changes:

- An opt-in tag (`@prod-build`) and a Playwright project that runs tagged tests against `vite preview` of a production
  build; every other project/leg excludes them.
- A CI job that builds the frontend and runs only tagged tests; the dev-server shards stop running them.
- The burst test is tagged; D2 trace capture is removed (D1 breakdown kept).

## Non-goals

- Changing the latency budget or the statistic (max vs median).
- HEL-1632's sibling test `hel1632-live-output.spec.ts:259` (parked PR #1075).
- Test retries, or re-running CI until green.
- HEL-1685's broader draft-mode polish (warm-up, memoisation) unless the evidence shows it is this flake's cause.

## Impact

- `e2e/hel1631-draft-mode.spec.ts` (instrumentation, possibly a new `e2e/support/` helper).
- Frontend draft edit path (`frontend/src/features/pipelines/...`) only if the evidence shows app work.
