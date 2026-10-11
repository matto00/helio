## Why

Main CI is red: `OutputHistoryRetentionInFlightSpec` (HEL-1477) is flaky. Its stub repository completes the hand-off
promise (`historyReached`) before incrementing the call counter, so the test thread can read `historyCalls == 0`.

## What Changes

- In the spec's `HeldRepos` stubs, increment the call counter first, then complete the `*Reached` promise, then build
  the part's future (`thinPass` and `purge` overrides).
- Evidence: a deterministic reproduction (a delay injected between signal and increment) red on unfixed ordering,
  green on fixed ordering.

## Capabilities

### New Capabilities

### Modified Capabilities

None: test-only change; `skip_specs: true`.

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryRetentionInFlightSpec.scala` only.
- No production code, schema, or API change.

## Non-goals

- Any change to `OutputHistoryRetentionService`. A real service race, if found, is filed separately.
- Restructuring the spec beyond the stub ordering.
