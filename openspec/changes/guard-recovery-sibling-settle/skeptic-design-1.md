## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 609e62b6d917243355a179fa8a26318c04898c27 (planning artifacts are uncommitted in the change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/guard-recovery-sibling-settle/HEL-1594`.

### What I verified (with evidence)

- **D2 exists where the design says.** `backend/src/main/scala/com/helio/services/pipelines/PipelineRunDeletedRecovery.scala:35-58`:
  `chain.recoverWith { case NonFatal(original) => settle(siblings).flatMap(_ => won.transformWith { ... findByIdInternal ... }) }`,
  with `settle` at l.57-58 (each sibling transformed to `Success(())`, then `Future.sequence`). The D4 mutation target
  (`settle(siblings).flatMap(_ =>` changed to `Future.unit.flatMap(_ =>`) is exact.
- **Sibling list and eagerness.** `PipelineRunSucceededWrites.scala:277-291`: the `for` sequences `materializedWrites` first,
  then `binaryRefsUpsert`. `siblings = Seq(materializedWrites, binaryRefsUpsert, alertEvaluation, updateMeta, assertionsInsert, baselineUpsert)`.
  `binaryRefsUpsert` (l.185-191) is eager. It depends only on `trunkLastStepIdFut` (step list + `rootIdsOf`), and
  `trunkOfRoot` (`PipelineStepRepository.scala:1225-1237`) cannot throw on an empty step list, so `overwriteForNode` is
  reached even if the delete cascade lands first. `binaryEntered` is therefore reached deterministically.
- **The design picks a path where the hold is observable.** With `beforeNodeFold = written.future.flatMap(_ => deletePipeline(fx))`
  (same ordering as the existing test at `LateFinisherDeleteAfterWonSpec.scala:28-37`), the first node's
  `overwriteRowsWith` (history repo is wired, so it is the `...With` variant, l.145, which `HookSnapshotRepo` overrides)
  fails on the guard. `chain` fails while `binaryRefsUpsert` is still held on `release`. `won` (`updateRun`) is already
  complete, because the delete waited on `terminalWritten`, which `GatedRunRepo` completes in `andThen` after the write.
  - Unmodified code: `settle` cannot complete while `release` is open, so the answer cannot arrive. This holds for any W,
    which makes the green deterministic.
  - Mutant: the answer completes after one `findByIdInternal` (returns None, `isWon` is true, then `Future.successful(None)`),
    then `publishTerminalAfter` (`PipelineRunTerminalWrites.scala:34-42`) and the `.map(Right(_))`
    (`PipelineRunExecutor.scala:428`). Nothing else holds it back, so step 4 fails. The red is real, not vacuous.
- **The hold does not deadlock the delete.** `HookBinaryRepo.overwriteForNode` (`LateFinisherSpecBase.scala:119-125`)
  calls `beforeBinaryWrite()` before it opens any DB transaction. A held sibling therefore holds no row lock that the
  delete or the node guard would wait on. On release, the insert hits the FK of the deleted pipeline. That outcome is
  ignored by `settle`, and the answer stays success.
- **`beforeNodeFold` is consumed by the right call.** `alertEvaluationService` defaults to null in `PipelineRunService`
  (l.43) and the base's `service()` does not pass it. The only `outputRepo.listByPipelineInternal` call in the chain is
  therefore `materializedWrites`'s (l.88), and the one-shot hook fires there.
- **The `binarySettled` ordering argument is sound.** A seam that returns `f.andThen{ settled.trySuccess }` completes only
  after the callback runs. `binaryRefsUpsert` is a `flatMap` onto it, and `settle` waits on `binaryRefsUpsert`. So in
  unmodified code, `binarySettled` is complete before the answer, by construction. Recording that in the answer's own
  callback (an `AtomicBoolean`) is a sound observation.
- **Capture-at-call-start (HEL-1565) is respected.** The planned seams (`binaryEntered`, `binarySettled`, `nodeWriteFailed`)
  are bound at call start and reset in `resetSeams()` (C4, task 1.1). This matches the existing pattern
  (`GatedRunRepo` l.85-88, `HookSnapshotRepo` l.104-106).
- **The bounded absence window (D3 step 4) is acceptable.** No ordering in the unmodified code depends on W, so it decides
  no ordering. It only bounds the mutant's detection, and it opens after `nodeWriteFailed`, which completes before the
  chain's failure propagates. A negative claim ("has not arrived yet") cannot be made without some window or a call-order
  probe. The design names and justifies the rejected alternatives: releasing the sibling on `findByIdInternal` or on the
  answer would deadlock the unmodified code, and a call-order probe tests an implementation detail. The base already
  uses the same pattern (`eventsOf`, l.202-205). This fits "orderings forced with promises": every ordering is a promise,
  and W is a detection bound. The false-pass risk (a mutant slower than W) affects only the proof's sensitivity, and the
  recorded red covers it.
- **The non-vacuity mutation (D4, pre-completed `release`) is well chosen.** It shows that the hold, not something else,
  keeps the answer back.
- **Scope matches the ACs.** All five ticket ACs map to D2/D3/D4/C1/premise. No production change is planned (C2). The
  claim that D1b and the non-recovering path are uncovered is honest: they share the single `settle` call, so the one
  mutation the ticket asks for is caught.
- **File budget.** `scripts/check-scala-quality.mjs:70` sets a soft budget of 250 lines. The base is 220 lines and the
  spec 102 (`wc -l`). D6's fallback to a sibling spec covers any overflow.

### Verdict: CONFIRM

### Non-blocking notes

1. D3 step 4: `Await.ready(answer, W)` throws `TimeoutException` on timeout. Write the assertion as
   `an[TimeoutException] should be thrownBy Await.ready(answer, W)` (or `Try(...)` then `answer.isCompleted shouldBe false`),
   so that the mutant's red names the assertion and is not an unexpected exception.
2. Register the `AtomicBoolean` callback on `answer` immediately after `submitAsync`, before step 3. Complete `release` in
   a `finally` (or before every fallible assertion), so a failing run, including the mutation runs, does not leave a
   held sibling future dangling into the next test. Capture-at-call-start makes a leak harmless to state, but it still
   holds a pending chain.
3. Task 3.3 is conditional ("if any new seam capture needs proving"). For consistency with HEL-1565's spec, which has one
   test per captured field, adding isolation tests for `binarySettled` and `nodeWriteFailed` is the cheaper default
   than arguing the exemption. Either way, state the decision in evidence.md.
4. `nodeWriteFailed` must re-fail with the original throwable, not a wrapper. The recovery's narrowness logic matches on
   `RunNoLongerOpen`, so a wrapped error would change behaviour on the D1b path. The design already says this; the
   evaluator should check it in the diff.
