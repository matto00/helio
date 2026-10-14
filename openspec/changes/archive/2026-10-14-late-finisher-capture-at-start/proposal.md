## Why

`LateFinisherSpecBase` (HEL-1564 moved the seams there from `LateFinisherRunSpec`) resets per-test seam state in
`afterEach`, but some seams read that state only when an asynchronous call completes. A call that outlives its test
then completes or drives the NEXT test's state. Since HEL-1564 a PASSING test cannot leave a seam call in flight
(`PipelineRunDeletedRecovery.recover` settles siblings and `updateRun` before answering), so this is failure isolation
plus a latent hazard: a test that fails or times out (60 s `Await`/`awaitDb`) leaves its chain running into the next
test, and `LateFinisherDeleteAfterWonSpec` gates its deletes on `terminalWritten`/`foldDone`, so one red test can
release the next test's forced ordering early and turn one failure into a confusing cascade.

## What Changes

- Re-derive the hazard on the current tree and record which seams share it (premise evidence already lists
  `GatedRunRepo.terminalWritten`, `HookSnapshotRepo` `foldDone`/`afterNodeWrite`/`nodeWrites`, `HookBackend.afterEngine`).
- Capture per-test seam state at call start in every affected seam (test code only).
- Add a forced-ordering regression spec over the seams: red on the current base, green with the fix; mutation-checked.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (`skip_specs: true`); no spec-level behavior changes.

## Non-goals

- Production code changes in `PipelineRunService`/`PipelineRunSucceededWrites` (if the probe shows a production
  defect, stop and escalate instead).
- Sleeps, retries, `eventually`, or widened timeouts.
- Changing what any existing late-finisher test asserts.

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherSpecBase.scala`.
- One new test file under the same package (seam-isolation regression spec).
- Evidence file in this change directory. No API, schema, migration, or frontend change.
