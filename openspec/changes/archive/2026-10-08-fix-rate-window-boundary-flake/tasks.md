## Standing Constraints

- [C1] Never widen a rate/timing window or retry-until-green to make a test pass; the assertion `runCount(pid) shouldBe 1` and limit 1 / window 60 stay unchanged.
- [C2] Measured red before the fix: if D1's boundary-positioned probe does not reproduce `2 was not equal to 1`, stop and escalate.
- [C3] sbt only via `sbt testOnly`/`testFull` (never bare `sbt test`), run from this worktree's `backend/`, confirming the loaded project path in the output; sequential repeat runs, `nice -n 19`.
- [C4] Probes and mutations are temporary and never committed; transcripts go in `openspec/changes/fix-rate-window-boundary-flake/evidence/`.

## 1. Reproduce (measured red)

- [x] 1.1 Temporary probe in the owner-attribution case, placed AFTER the owner's direct submit and BEFORE `triggerAutoRun` (design D1): sleep until the next epoch-minute boundary + ~200ms; log the instant at the owner submit and just before `triggerAutoRun`. Run via `testOnly` ≥3 times serially; record the red (`2 was not equal to 1`) with those instants. Evidence: `evidence/1.1-red-boundary.txt`.
- [x] 1.2 Control: same probe position, a similar-length sleep that does NOT cross a boundary (logged instants share a minute) → green ≥3 times. Evidence: `evidence/1.2-control.txt`.
- [x] 1.3 If 1.1 does not reproduce, stop and escalate (C2).

## 2. Seam

- [x] 2.1 Add `guardClock: Clock = SystemClock` as the last defaulted constructor param of `PipelineRunService`, documented as driving only the rate-window bucket; pass `now = guardClock.now()` at the `incrementRateIfUnderLimit` call in `executeRun`.
- [x] 2.2 Confirm no other call site needs to change (compiles) and that `PipelineSchedulerService.tick` does / does not call `cleanupOldWindows`; record the finding (design D2).

## 3. Test fix

- [x] 3.1 Owner-attribution case: build its run service with a fixed test clock pinned mid-window (design D2); keep the assertion, poll and config unchanged (C1). Update the case's comment to explain the pinned guard clock.
- [x] 3.2 Post-fix proof (design D3), all under the corrected D1 probe placement: boundary probe green ≥3 serial runs; Mutation A (`guardClock = SystemClock`) red under boundary positioning; Mutation B (attribution) red. Evidence: `evidence/3.2-*.txt`. Revert all probes.
- [x] 3.3 `testOnly` green for DatasetWriteAutoRunEndToEndSpec, PipelineRunGuardIntegrationSpec, PipelineRunGuardRepositorySpec, AutoRunGuardBurstProofSpec, AutoRunGuardNoRetryStormSpec, ApiRoutesPipelineRunGuardSpec, PipelineSchedulerServiceSpec. Evidence: `evidence/3.3-green.txt`.

## 4. Docs

- [x] 4.1 MISTAKES.md: sbt cross-worktree server-attach entry per design D5, verified on sbt 2.0.9; distinguish verified vs. reported.
- [x] 4.2 No change to CLAUDE.md env-var table (no new env var).

## Notes (executor)

- 2.2: `PipelineSchedulerService.pipelineRunGuardRepo` defaults to `null` and the spec's `newScheduler` does not pass one, so `tick()` never calls `cleanupOldWindows` in this spec (PipelineSchedulerService.scala ~82-83).
- 3.2 Mutation B was done as "skip the rate-limit check for AutoRun-triggered submits" (the behavioural equivalent of writer attribution with a fresh budget); a random-UUID principal was tried first and was a bad mutation (FK violation, no run row, stays green).
- sbt: `-z` filters must be single-word (`-z NON-OWNING`).
