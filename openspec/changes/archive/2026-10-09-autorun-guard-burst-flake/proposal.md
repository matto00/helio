## Why

`AutoRunGuardBurstProofSpec` failed once in CI ("4 was not equal to 3") and passed on re-run. A flaky guard-proof
test erodes trust in the one test that proves the pipeline-run rate guard bounds an auto-run burst.

## What Changes

- Probe-confirm the root cause of the extra admitted run (hypothesis: the spec drives the scheduler with a
  `FakeClock` but builds `PipelineRunService` without `guardClock`, so the guard buckets admissions by REAL wall
  clock into 300s windows; a wall-clock window boundary crossed mid-test admits a 4th run).
- Make the spec's guard time deterministic via the existing `guardClock` seam (HEL-1374), if the probe confirms it;
  otherwise fix whatever the probe shows (including a production race, if real).
- Red/green evidence and a 30x loop under `nice -n 19` with <=4 workers.

## Capabilities

### New Capabilities

### Modified Capabilities

None. Test-only change; no spec-level behavior changes (`skip_specs: true`).

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/AutoRunGuardBurstProofSpec.scala` (expected only file).
- No production code change unless the probe shows a real production race.

## Non-goals

- Retries, timeouts, or widening the rate window as a "fix".
- Fixing other guard specs with a similar shape (enumerated and reported as follow-ups instead).
- HEL-1468's sbt exit-code guard.
