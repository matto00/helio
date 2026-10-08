## Standing Constraints

- [C1] Minimal diff in PipelineRunService.scala: no refactor, rename or method extraction beyond what D1/D2 need (HEL-1371 splits the file next).
- [C2] Every new test case is shown red against unmodified b14e622ee code before the fix; keep the red run's log.
- [C3] Test/probe runs use at most 3-4 parallel workers under `nice -n 19`; long Bash calls use `timeout: 600000`.

## 1. Backend

- [x] 1.1 Move the `queued` publish in `executeRun` into `preExec.flatMap`'s `Right(())` branch, just before `running` (design D1)
- [x] 1.2 Update the comment(s) near the moved publish to say `queued` means admitted by the HEL-505 guard (HEL-1370)
- [x] 1.3 In `onRunSuccess`, recover a failed/throwing `applyPendingWriteBacks` Future: log raw cause, run `onWriteBackFailure` with generic `Step (upsertsource): write-back failed`, then ALWAYS re-fail with the original exception via `transformWith` (design D2)
- [x] 1.4 Spec delta for `pipeline-run-execution` (queued on admission; write-back exception leaves row failed) is kept in sync with the code
- [x] 1.5 Ensure the recovery wraps only the write-back call, never the downstream `onWriteBackFailure`/`onUnblockedRunSuccess` chain

## 2. Tests

- [x] 2.1 Extend the spec harness with an optional `PipelineRunGuardRepository` + `PipelineRunGuardConfig`
- [x] 2.2 Rate-limit 429 case with `rateLimitPerWindow = 0`, no priming run: no event from the rejected submit; subscriber still open (red first)
- [x] 2.3 Concurrency-cap 429 case: only run A's events reach the subscriber; A's terminal still arrives (red first)
- [x] 2.4 Write-back exception case: exactly one `failed` after durable failed status, `errorLog` names upsertsource, submit completes failed (red first)
- [x] 2.5 Run `PipelineRunServiceTerminalOrderingSpec`, `PipelineRunRoutesSpec`, `PipelineRunGuardIntegrationSpec` and the write-back specs green
