## Context

See proposal.md (Why). Ground truth on main 609e62b6d:

- `PipelineRunSucceededWrites.writesChain` builds eager futures (`materializedWrites`, `binaryRefsUpsert`,
  `alertEvaluation`, `updateRun`, `updateMeta`, `assertionsInsert`, `baselineUpsert`); a fail-fast `for` sequences
  them into `chain`, which is wrapped by `deletedRecovery.recover(..., siblings = Seq(materializedWrites,
  binaryRefsUpsert, alertEvaluation, updateMeta, assertionsInsert, baselineUpsert))` (l.288-291).
- `PipelineRunDeletedRecovery.recover` (l.35-58): on any non-fatal chain failure it runs `settle(siblings)` FIRST
  (each sibling transformed to `Success(())`, then `Future.sequence`), then reads `won`, then
  `pipelineRepo.findByIdInternal`. Won + pipeline gone -> `Future.successful(None)` (success). This `settle` is D2.
- `materializedWrites` is the first step of the `for`, so a node guard trip (run row `Missing` after the delete
  cascade) fails `chain` while `binaryRefsUpsert` may still be in flight. `binaryRefsUpsert` calls
  `binaryRefRepo.overwriteForNode`, which `LateFinisherSpecBase.HookBinaryRepo` already wraps
  (`beforeBinaryWrite` hook read at call start, then a REAL `binary_refs` insert for `binaryTarget`).
- `publishTerminalAfter` publishes `succeeded` once the (recovered) chain succeeds.
- Therefore D2 IS observable: hold `binaryRefsUpsert` on a test promise across the chain failure; with `settle` the
  answer cannot complete while it is held; without it the answer completes after `won` (already true) and one
  existence read.

## Goals / Non-Goals

Goals: a test that fails when D2's wait is removed, deterministic in the unmodified code, orderings forced by
promises. Non-goals: see proposal.md.

## Decisions

**D1. Path under test.** The existing "delete landed after the Output list was read" ordering: `beforeNodeFold =
written.future.flatMap(_ => deletePipeline(fx))` (delete forced after the run's own terminal write, after the list,
before the first node write). The first node guard sees the run `Missing`, so `chain` fails with won = true and the
pipeline gone -> recovery to success. `nothingWritten(fx)` holds as in the existing test.

**D2. Seams (in `LateFinisherSpecBase`, HEL-1565 capture-at-call-start, all reset in `resetSeams`).**
- `binarySettled: Promise[Unit]`: `HookBinaryRepo.overwriteForNode` captures it at call start and completes it
  (`trySuccess`) in an `andThen` on its returned future, on success OR failure. Because `andThen`'s future completes
  only after its callback, the sibling (`binaryRefsUpsert`) completes strictly after `binarySettled`; so
  `binarySettled` completed before the answer is exactly "the sibling settled before the answer" in the unmodified
  code.
- `binaryEntered: Promise[Unit]`: completed at call start of `HookBinaryRepo.overwriteForNode`, so the test can show
  the sibling was really reached and held (non-vacuity).
- `nodeWriteFailed: Promise[Unit]`: `HookSnapshotRepo.overwriteRowsWith` captures it at call start and completes it
  when the node write fails (`recoverWith`/`transform` re-failing with the same error, never swallowing). This is the
  chain's failure point on this path (the fold is the `for`'s first step) and anchors the observation window.
- The hold itself: `beforeBinaryWrite = () => release.future` where `release` is a test-owned promise.
- A non-blocking submit helper (`submitAsync(fx, binary = true): Future[Either[ServiceError, _]]`, hooked snapshot
  repo + `HookBinaryRepo`, subscribed like `submitWith`); `submitWith` is refactored onto it so there is one wiring.

**D3. The test** (in `LateFinisherDeleteAfterWonSpec`, section for the won path):
1. Seed, set `binaryTarget = (fx.pid.value, fx.p.stepId.value)`, the D1 delete, `beforeBinaryWrite = () =>
   release.future`.
2. `val answer = submitAsync(fx)`.
3. Await (bounded) `binaryEntered` and `nodeWriteFailed`: both must complete (ordering prerequisite; failure here is a
   fixture failure, not a pass).
4. Absence check: `Await.ready(answer, W)` must time out, i.e. `answer.isCompleted shouldBe false` while the sibling
   is held. W is a detection window for the MUTANT only, started after the chain already failed; it never decides an
   ordering in the unmodified code (there the answer cannot complete while `release` is open, whatever W is). This is
   the same "absence needs a settle window" pattern as the base's `eventsOf`. Pick W in the low seconds (e.g. 3 s)
   and state in the test comment that the mutant answers within one existence read after the failure.
5. `release.success(())`; the real insert then hits the FK on the deleted pipeline (outcome ignored by D2).
6. Await answer -> `Right`; `binarySettled.isCompleted` was true when the answer completed (record it in the answer's
   own `onComplete`/`transform` callback via an `AtomicBoolean`, not after the fact); `awaitSucceeded(fx)`; exactly one
   `succeeded`; `nothingWritten(fx)`.
No `Thread.sleep` is added; every ordering is a promise the test or the seam completes.
Rejected alternatives: releasing the sibling on a `findByIdInternal` wrapper or on the answer itself (the unmodified
code reaches neither while the sibling is held, so the test would deadlock); asserting only call order inside
`findByIdInternal` (tests an implementation detail, not the ticket's "the answer does not arrive before the sibling
settles").

**D4. Red-first by mutation.** The test passes on unmodified code (it guards existing behaviour). Proof: temporarily
replace `settle(siblings).flatMap(_ =>` with `Future.unit.flatMap(_ =>` in `PipelineRunDeletedRecovery.recover`, run
the test, record the red (step 4 or step 6 assertion failing), revert with `git checkout --` on that file, and show
`git diff backend/src/main` empty. Also record a non-vacuity mutation on the seam: with `beforeBinaryWrite` not held
(`release` pre-completed), step 4's absence assertion must be the one that fails (shows the hold, not something else,
is what keeps the answer back). Record both in `evidence.md`.

**D5. Existing specs unchanged and green.** Run `LateFinisherRunSpec`, `LateFinisherDeleteAfterWonSpec`,
`LateFinisherSeamIsolationSpec` together, at least 5 consecutive times after the change, foreground, `nice -n 19`.
Extend `LateFinisherSeamIsolationSpec` only if a new seam's capture needs proving (one test per new captured field,
red when the capture is reverted), keeping HEL-1565's guarantee intact for the new state.

**D6. File budget.** If `LateFinisherSpecBase` or `LateFinisherDeleteAfterWonSpec` would exceed the repo's file
budget as enforced by the Scala code-quality check, move the new test to a sibling spec extending the base.

## Risks / Trade-offs

- [Mutant answers slower than W on a loaded machine -> the mutation run passes falsely] -> only affects the mutation
  proof's sensitivity, never the unmodified test's stability; the window is started after the chain failed; the
  evidence run records the mutant's red.
- [sbt 2 replays cached test output (HEL-1595)] -> every cited run shows this worktree's paths and executed counts.
- [A seam change alters existing tests' timing] -> `binarySettled`/`binaryEntered`/`nodeWriteFailed` only complete
  promises; the failed node write re-fails with its original error; D5 repeat runs.

## Planner Notes

- Self-approved: test-only, `skip_specs: true`.
- Self-approved: the lost-write (D1b) and non-recovering paths share the single `settle` call; one won-path test is
  what the ticket asks for and catches its mutation.
