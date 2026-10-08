## Why

`DatasetWriteAutoRunEndToEndSpec`'s owner-attribution case flaked in CI (`2 was not equal to 1`). The pipeline-run rate limit buckets windows at epoch multiples of `rateWindowSeconds` (60s here), using `Instant.now()` inside `PipelineRunService` with no way for a test to control it. The case exhausts the owner's limit-1 budget with a direct submit, then the first scheduler `tick()` fires the auto-run, whose guard check happens exactly once (the debounce claim is released even on rejection, so later ticks in the 5s poll do nothing). If an epoch-minute boundary falls between the owner submit's guard check and that first tick's guard check, the owner's budget refreshes and the auto-run is legitimately admitted. That span is usually well under a second locally but longer under CI contention (the failing run spanned 22:55:58-22:56:00), so the hazard is rare and load-dependent; no per-run rate is claimed. The test cannot control the window, so it is a test-controllability defect, not a product defect.

## What Changes

- Add a `guardClock: Clock = SystemClock` constructor parameter to `PipelineRunService`, used only to supply `now` to `PipelineRunGuardRepository.incrementRateIfUnderLimit` (which already accepts `now`). Production behaviour is unchanged (`SystemClock` = `Instant.now()`). This is the core seam HEL-1196 proposes, and it is the narrowest deterministic fix for this flake.
- The owner-attribution case pins `guardClock` to a fixed instant so both the owner's direct submit and the scheduler-fired auto-run fall in the same rate window regardless of wall time. Assertion and mutation-sensitivity unchanged.
- Record the decision that fixed, epoch-aligned windows are intended product behaviour (HEL-505 design Decision 2) as a spec scenario. No product behaviour change.
- MISTAKES.md: record the sbt cross-worktree server-attach hazard and a verified safe invocation.
- Out of scope (stays with HEL-1196): converting `PipelineRunGuardIntegrationSpec`'s widened-window tests and `AutoRunGuardBurstProofSpec` to the new seam; threading the clock through any other `Instant.now()` in `PipelineRunService`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-run-guard`: adds a scenario stating that rate windows are fixed and aligned to epoch multiples of the window duration (documents the existing, intended behaviour; no requirement weakened).

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` (one defaulted constructor param, one call-site argument).
- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunEndToEndSpec.scala` (owner-attribution case).
- `MISTAKES.md`.
- No API, schema, migration, or frontend change. All existing constructor call sites compile unchanged (defaulted param).
