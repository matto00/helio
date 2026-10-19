## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: worktree HEAD 069afd36d5c69d245c0f3c779b9a4fc6d160b52b (= origin/main), untracked change dir
`openspec/changes/bound-run-path-memory/` (ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-run-memory-bounds/spec.md).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/run-path-memory-bounds/HEL-1660`.

### What I verified (with evidence)

**Owner rulings.** `.concertino/runs/HEL-1660/events.jsonl` has two `escalation.answered` events with `answer_source=human`:
- line 2: `wait-for-hel1630-merge, 100000, 25pct-with-frame-release, 1048576, fail-with-step-error, accept-fail-clean,
  nonfatal-plus-exit-on-oom`;
- line 11: `nonfatal-plus-stackoverflow-arm, accept-50kx6`.

ticket.md rulings 1-8 and the AC6 amendment match these answers. I treat them as fixed.

**Round-1 change requests.**

| Item | Status | Evidence |
|---|---|---|
| CR1 (SOE) | Owner ruled. The mechanism as written is wrong on the `recoverWith` path. | See CR 2 below. |
| CR2 (AC6 shape) | Resolved | Ruling 8 `accept-50kx6`; `CsvLimits` `maxRows=50000`, `maxCells=300000` confirmed. |
| CR3 (pinned frames) | Partly resolved | Roots are now covered (D3a, `pinRoots`). A second pinned frame is not covered (CR 4). |
| CR4 (end-to-end peak) | Partly resolved | Measurement moved to the service path. The worst post-walk shape is never measured (CR 3). |
| CR5 (required `retain`) | Resolved | D3: required, no default; `outputRepo` injection stated; `StepKey`/`RootKey` mapping matches `PipelineRunSucceededWrites.scala:96-101`. |
| N1, N2, N3, N5 | Addressed | Task 2.3, D2 (`ExpressionInterpreter.scala:271`), D2 wording, D3 (`SparkJobSubmitter`). |
| N4 | Addressed | See the non-blocking note on how the downgrade is scoped. |

**Citations against the tree (all hold unless noted).**
- `InProcessPipelineEngine.scala:297`: `catch { case ex: Throwable => Future.failed(ex) }`, then `recoverWith { case ex => ... }` at :298-303.
- `InProcessExecutionBackend.scala:53-62`: `loaded`/`primaryRows` are captured until the `yield`.
- `InProcessExecutionBackend.scala:61`: `executeTree` is called inside the for-comprehension, so inside a `flatMap` callback.
- The root-frame fallback is at `InProcessPipelineEngine.scala:537` (`rootFrames.head._2`), not :546 as D3a says.
  The citation drifted, but the substance holds.
- `PipelineRunExecutor.scala:23-36`: the constructor has no `outputRepo`.
- `PipelineRunExecutor.scala:285-287`: `jsRows` is the whole trunk frame.
- `PipelineRunSucceededWrites.scala:104`: the key intersect.
- `PipelineRunSucceededWrites.scala:108-112`: per-node `nodeJsRows`, sequenced one node at a time.
- `PipelineRunSucceededWrites.scala:217-222`: the "never evaluated by the tree walk" `log.error`.
- `Dockerfile:46`: `MaxRAMPercentage=75.0`, with no ExitOnOutOfMemoryError flag.
- `InProcessPipelineEngine.scala:907`: `csvRowsWithinLimits`.
- `ExpressionInterpreter.scala:270-271`: `checkLength(length: Long, maxChars: Int)`.
- `DraftPreviewService.scala:188-200`: `retainOnly = Some(Set(rowsStepId-or-root))` and `catch NonFatal`.
- `InProcessPipelineEngineDraftSeamSpec.scala:103-108` and `DraftPreviewHeapSpec.scala:83-92`: as task 2.3 says.
- `nodeOutcomes` readers outside the engine (grep): `InProcessExecutionBackend:62`, `PipelineRunSucceededWrites:104,109,217`,
  `PipelineRunPreview:288`, `PipelineRunBackfill:141`, `DraftPreviewService:201`. There is no reader the retain set misses.

**Probe: Scala 2.13.15 boxes every `Error` passed to `Future.failed`.**
- Probe: `.concertino/scratch/HEL-1660/skeptic2/Box.java`, against `scala-library-2.13.15.jar`, the build's `scalaVersion`.
- Output:
  ```
  SOE value: Some(Failure(java.util.concurrent.ExecutionException: Boxed Exception))
  OOM value: Some(Failure(java.util.concurrent.ExecutionException: Boxed Exception))
  class=java.util.concurrent.ExecutionException cause=java.lang.OutOfMemoryError: oom nonFatal=true
  ```
- So `evalOneStep`'s `recoverWith` never receives a raw `StackOverflowError` or `OutOfMemoryError`. It receives an
  `ExecutionException("Boxed Exception")`, which is `NonFatal`.
- Today's SOE step error is therefore `StepExecutionException.from(.., ExecutionException)`, which carries "step execution
  failed" (`InProcessPipelineEngine.scala:57`).

**Engine walk mechanics (`executeTree`, :382-611).**
- `releaseConsumed` (:512-519) keeps only `retainOnly ++` the parents and lane dependencies of the remaining steps.
- `next` selection (:528-531) is leaf-first whenever `maxLiveCells` is set.
- `trunkRows` (:604-609) falls back to the root frame, then `Seq.empty`, if the terminal was released.

**Upsertsource pins its input frame.**
- `UpsertSourceStep.scala:34` records `PendingWrite(id, config, rows)` into `ctx.writeBackSink`. `rows` is the step's whole
  input frame, and the step returns that same `rows`.
- `WriteBackSink` holds it until `PipelineRunExecutor.scala:447` `applyWriteBacks`, after the walk.

**Coverage.** Every AC (1-9) maps to a task, as in round 1, and AC6 now has a service-level task (3.4). I found no
placeholders.

### Verdict: REFUTE

### Change Requests

1. **D3's "always keep the trunk terminal whenever `retainOnly` is set" changes the draft preview (breaks C6/AC8).**
   - Where: design.md D3 bullet 2, task 2.4.
   - `DraftPreviewService.scala:200` passes `retainOnly = Some(Set(<requested step or root>))`. The draft never reads
     `TreeWalkResult.rows` (`.map(_.nodeOutcomes)`, :201).
   - Today the draft releases the trunk terminal as soon as it has no unevaluated dependent (`releaseConsumed`, :512-519).
   - Under leaf-first order the terminal is a leaf, so it is often evaluated early. Example: root → a → b (trunk), plus a
     tail a → a1 → a2. Once `a` lands, `b` runs before `a1`.
   - Pinning the terminal would keep its cells in the tally for the rest of the draft walk. That moves the draft's
     memory-limit trip points, so the draft is no longer byte-identical.
   - Fix: gate the terminal retention on a run-only signal, either an explicit flag or the same flag as `pinRoots`, never on
     `retainOnly`'s presence.
   - Add an engine spec that shows the draft's tally or retained set is unchanged for a shape like the one above. Mutating
     the gate to `retainOnly.isDefined` must turn that spec red.

2. **D7 describes an arm on the `recoverWith` path that can never match. It leaves the boxed-fatal case undecided.**
   - Where: design.md D7 bullet 1, spec requirement "Fatal errors are not converted into step errors".
   - D7 says the `try` and the `recoverWith` each convert "NonFatal and StackOverflowError" and that "every other throwable,
     OutOfMemoryError included, propagates". Per the probe above, every `Error` that reaches a `Future` through
     `Future.failed` or `Promise.failure` arrives boxed in a `NonFatal` `ExecutionException`.
   - A `case NonFatal(ex)` in `recoverWith` therefore still converts a boxed OOM into a step error. This affects any step
     whose returned Future was failed with an `Error`.
   - A `case e: StackOverflowError` arm in `recoverWith` is dead code. Its "mutation removes the arm" would survive, which
     breaks C2.
   - A fatal error thrown inside a step's own Future callback is rethrown on the executor thread, and that Future never
     completes. This is unchanged today and is covered in prod by `-XX:+ExitOnOutOfMemoryError`, but D7 should say so.
   - The revised D7 must:
     - (a) put the SOE arm in the synchronous `try` only (that is where the regex SOE arrives: `StringOpsStep`/`AssertStep`
       evaluate synchronously);
     - (b) state that `recoverWith` sees boxed `ExecutionException`s;
     - (c) decide explicitly what happens to an `ExecutionException` whose cause is a fatal error other than SOE. Unwrapping
       and propagating it is what ruling 7's wording implies. If the design chooses to leave it, the spec's "SHALL
       propagate" must be narrowed to synchronous throws.
   - Also state that the OOM spec calls `executeTree` directly, not `InProcessExecutionBackend.execute`. `execute` runs
     `executeTree` inside a `flatMap` callback (`InProcessExecutionBackend.scala:61`), so an un-caught OOM there would hang
     the test's Future instead of throwing.

3. **D6 never measures the worst post-walk peak, so "MaxLiveCells such that the end-to-end peak stays at or under 192 MB"
   cannot be established from the planned shapes.**
   - Where: design.md D6 shape list, task 3.3.
   - Almost every listed shape is built to fail at a limit, and a failing run never reaches `jsRows` or `nodeJsRows`.
   - The largest post-walk allocation comes from a run that succeeds just under `MaxLiveCells`. In that run:
     - the trunk terminal is a near-budget frame, which `jsRows` copies whole (`PipelineRunExecutor.scala:285`);
     - that same frame carries an Output, which `nodeJsRows` copies again (`PipelineRunSucceededWrites.scala:110`);
     - both copies are alive at once, on top of the retained frames.
   - AC6 (300k-cell frames) sits well below a 4M-cell budget, so it does not probe this.
   - Fix:
     - Add a "budget-edge success" shape: the terminal and an Output frame sized to just under the chosen `MaxLiveCells`,
       both text-light and text-heavy.
     - Run it as both a real run and a dry run (`jsRows` is built for both).
     - Require the heap spec to use a real `nodeSnapshotRepo` and `outputHistoryRepo`. With `nodeSnapshotRepo == null`,
       `materializedWrites` is skipped entirely (`PipelineRunSucceededWrites.scala:88`) and the snapshot serialization is
       never measured.

4. **An upsertsource step pins its input frame outside the tally. This is the same class of gap as round-1 CR3, and D3a
   does not cover it.**
   - `UpsertSourceStep.scala:34` stores the whole input `rows` in `ctx.writeBackSink` until `applyWriteBacks` runs after the
     walk (`PipelineRunExecutor.scala:447`).
   - Once the upsertsource node has no remaining dependent, `releaseConsumed` drops it and `tally.remove`s its rows, but the
     rows stay strongly reachable.
   - A run with k upsertsource steps can therefore under-count by up to k frames, each up to a node's full budget.
   - Fix: extend D3a's pinning. Either never tally-release a frame recorded in the write-back sink on the run path, or
     charge each `PendingWrite`'s rows into the tally when they are recorded.
   - Add an upsertsource-then-continue shape to D6 and an engine spec with a mutation, as was done for roots.

### Non-blocking notes

- D3a cites `executeTree`'s root fallback at `:546`. On 069afd36d it is `:537`. Fix the citation.
- N4 / D3: scope the `log.error` → `warn` downgrade to Outputs absent from the pre-execution `retain` set. An Output that was
  in `retain` but has no outcome is still a real bug and should stay at `error`. A blanket downgrade removes that signal.
- C2 binds `pinRoots`, trunk-terminal retention and the required `retain` too. Task 2.4 says "verify with engine specs".
  Name the mutation for each, because the D6 heap spec may run outside `testFull` (Planner Notes), which makes it a weak
  regression guard.
- `NonFatal` also excludes `InterruptedException`, `LinkageError` and `ControlThrowable`. Before the change these became step
  errors. Mention in D7 that they now propagate, or include them in the arm deliberately.
- proposal.md Impact still omits `SparkJobSubmitter`. D3 mentions it, so this is cosmetic.
