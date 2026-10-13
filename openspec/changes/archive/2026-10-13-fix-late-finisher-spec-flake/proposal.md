## Why

`LateFinisherRunSpec`'s HEL-1518 D7 test ("answer 404 ... when its pipeline was deleted before the Output list was
read") failed twice in CI (#994, #1002) with `Right(RunResultResponse)` instead of `Left(NotFound)`, and passed on
rerun. A flaky gate trains people to rerun red CI, and the failure could also hide a real race in the D7 path.

## What Changes

- Probe-confirm the root cause by forcing the suspected interleaving deterministically (see design.md).
- If test-only: sequence the spec's hooks so the interleaving the test claims to exercise is the one that actually runs,
  for the D7 test and every sibling test in the spec exposed to the same race.
- If production: stop and escalate (product-relevant; scope change), do not patch silently.
- Record red-then-green and mutation evidence in the change directory.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Expected to be a test-only change (`skip_specs: true`); if the probe shows a production defect, planning is
revised and a spec delta added.

## Non-goals

- Retries, sleeps, `eventually`, or widened timeouts as a fix.
- Changing HEL-1518's D7 semantics ("first terminal write wins").
- Other flaky specs, and `node_snapshots` cleanup on delete (HEL-1541).

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala` (expected only file of code).
- Evidence file under `openspec/changes/fix-late-finisher-spec-flake/`.
- No API, schema, migration, or frontend change.
