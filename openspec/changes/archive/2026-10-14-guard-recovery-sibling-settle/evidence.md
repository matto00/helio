# Evidence — HEL-1594

All runs: `cd <this worktree>/backend && nice -n 19 sbt "testOnly ..."`, foreground. sbt output shows this worktree's paths
(`.../worktrees/task/guard-recovery-sibling-settle/HEL-1594/backend/`) and executed counts, so no replayed cache (HEL-1595).

## Green (unmodified production)
`testOnly LateFinisherRunSpec LateFinisherDeleteAfterWonSpec LateFinisherSeamIsolationSpec`:
`Tests: succeeded 24, failed 0` — the new test "not answer before that sibling settles, then answer success with exactly one succeeded" passes.
Five consecutive repeats: runs 1-5 each `[info] Tests: succeeded 24, failed 0, canceled 0, ignored 0, pending 0`.

## Red: D2 wait removed (task 3.1)
Temporary edit in `PipelineRunDeletedRecovery.recover`: `settle(siblings).flatMap(_ =>` -> `Future.unit.flatMap(_ =>`.
`testOnly LateFinisherDeleteAfterWonSpec`:
```
[info] - should not answer before that sibling settles, then answer success with exactly one succeeded *** FAILED ***
[info]   Expected exception java.util.concurrent.TimeoutException to be thrown, but no exception was thrown (LateFinisherDeleteAfterWonSpec.scala:94)
[info] Tests: succeeded 6, failed 1, canceled 0, ignored 0, pending 0
```
Reverted with `git checkout --`; `git diff backend/src/main` is empty (C2).

## Non-vacuity (task 3.2)
Temporary `release.success(())` before `submitAsync` (sibling not held), production unmodified:
```
[info] - should not answer before that sibling settles ... *** FAILED ***
[info]   Expected exception java.util.concurrent.TimeoutException to be thrown, but no exception was thrown (LateFinisherDeleteAfterWonSpec.scala:95)
[info] Tests: succeeded 6, failed 1
```
So the hold is what keeps the answer back. Test file restored from backup afterwards.

## Seam isolation, C5 (task 3.3)
Two tests added to `LateFinisherSeamIsolationSpec`. Each capture reverted in `LateFinisherSpecBase` in turn:
- `nodeWriteFailed` (use field instead of captured local): RED, `false was not equal to true (LateFinisherSeamIsolationSpec.scala:120)`, `Tests: succeeded 6, failed 1`.
- `binarySettled` reverted: RED, `false was not equal to true (LateFinisherSeamIsolationSpec.scala:137)`, `Tests: succeeded 6, failed 1`.
- `binaryEntered` reverted: stays GREEN (7/7). Decision: this field is completed synchronously at call start, before any
  possible test boundary, so reading it live vs captured is behaviourally identical; the capture is for convention
  only and cannot be proven by reversion. The test still asserts it is completed at call start and not leaked.

## Skeptic notes applied
1. `an[TimeoutException] should be thrownBy Await.ready(answer, 3.seconds)` plus `answer.isCompleted shouldBe false`.
2. Answer callback (AtomicBoolean of `binarySettled.isCompleted`) registered right after `submitAsync`; `release` completed in a `finally`.
3. Isolation tests for each new captured field (see above).
4. `nodeWriteFailed` uses `.andThen { case Failure(_) => ... }`, which preserves the original failure unchanged.

## Gates
`npm run check:scala-quality`: `clean (250 soft warning(s))` exit 0 (touched files: base 234, DeleteAfterWon 138, SeamIsolation 142 lines, all under the 250 soft budget).
No `Thread.sleep` added (existing `eventsOf`/`awaitSucceeded` reused).

## Cycle 2 (evaluation-1.md change request 1)
Verified the finding against the code: `Await` on `answer` can release the test thread before a separate `answer.onComplete`
callback has set the flag. Fix: `val observed = answer.andThen { case _ => settledWhenAnswered.set(settled.isCompleted) }`,
and the post-release assertions await `observed`; the step-4 absence check stays on `answer`. Comments added (flag is a weak
detector; `binaryEntered` post-reset assertion cannot fail by construction).
- Green, 3 specs together, run 6 consecutive times (this worktree's `HEL-1594/backend` paths in every log):
  each `[info] Tests: succeeded 24, failed 0, canceled 0, ignored 0, pending 0`.
- Red, `settle(siblings)` temporarily replaced by `Future.unit` (reverted via `git checkout --`; `git diff backend/src/main` empty):
  `*** FAILED *** Expected exception java.util.concurrent.TimeoutException to be thrown, but no exception was thrown (LateFinisherDeleteAfterWonSpec.scala:97)`, still the step-4 assertion.
