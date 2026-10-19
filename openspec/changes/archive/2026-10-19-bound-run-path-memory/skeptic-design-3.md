## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: worktree HEAD 069afd36d5c69d245c0f3c779b9a4fc6d160b52b (= origin/main), with the untracked change dir
`openspec/changes/bound-run-path-memory/` (ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-run-memory-bounds/spec.md).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/run-path-memory-bounds/HEL-1660`.

### What I verified (with evidence)

**Owner rulings.** `.concertino/runs/HEL-1660/events.jsonl` has two `escalation.answered` events, both with
`answer_source=human`. ticket.md rulings 1-8 match them. I treat them as fixed.

**Round-2 change requests.**

| CR | Status | Evidence |
|---|---|---|
| 1. Terminal retention changes the draft | Resolved | D3/D3a gate terminal retention on the run-only `runRetention` flag, never on `retainOnly`; the draft never sets it. |
| 2. D7 `recoverWith` arm | Partly resolved | (a) The SOE arm is in the sync `try` only. (b) Boxing is stated. (c) The boxed-fatal decision is made and the spec wording is narrowed. The proof plan still mis-models where a boxed failure comes from, and it contradicts its own guard (CR 1 below). |
| 3. Worst post-walk peak | Mostly resolved | A just-under-budget shape now runs as both a real run and a dry run, with real `nodeSnapshotRepo` and `outputHistoryRepo`. The "text-light and text-heavy" part of the CR was dropped (CR 2 below). |
| 4. Upsertsource pinning | Resolved | D3a "keeps write-back frames charged", with a D6 shape, an engine spec and a named mutation. |
| Notes from round 2 | Addressed | The `:537` citation is fixed. The warn downgrade is scoped to Outputs absent from `retain`. A mutation is named per guard. The NonFatal side effect is stated. `SparkJobSubmitter` is in the proposal's Impact. |

**Round-1 CRs 1-5.** All still resolved: SOE has an owner ruling, AC6 is 50k x 6 per ruling 8, roots are pinned (D3a),
the measurement is end to end (D6), and `retain` is required (D3).

**Citations re-read against the tree.** All of these hold:
- `InProcessPipelineEngine.scala`: `:297` is `catch { case ex: Throwable => Future.failed(ex) }`, the only `Throwable`
  catch under `domain/engine`/`services/pipelines` (grep). `:298-303` is `recoverWith`. `:512-519` is `releaseConsumed`,
  `:528-531` is leaf-first on `maxLiveCells`, `:537` is the root fallback, `:604-609` is `trunkRows`.
- `InProcessExecutionBackend.scala:53-62`: `loaded`/`primaryRows` stay held until the `yield`; `executeTree` is called in a
  `flatMap`.
- `PipelineRunExecutor.scala:23-36`: the constructor has no `outputRepo`. `:285` is `jsRows`. `:447` is `applyWriteBacks`.
- `PipelineRunSucceededWrites.scala`: `:88` is the `nodeSnapshotRepo != null` gate, `:96-101` the StepKey/RootKey mapping,
  `:104` the intersect, `:110` `nodeJsRows`, `:218-222` the "never evaluated by the tree walk" `log.error`.
- `UpsertSourceStep.scala:34` records the whole input `rows`.
- `Dockerfile:46` is `MaxRAMPercentage=75.0`, with no exit-on-OOM flag yet.
- `CsvLimits.scala:17-19` is 50,000 rows / 300,000 cells.
- `ExpressionInterpreter.scala:270-271` is `checkLength(length, maxChars: Int)`.

**Walk mechanics that matter for D7.**
- `loop(steps)` evaluates the first node synchronously from `executeTree`.
- Every later node is evaluated inside `transformWith`'s success callback (`loop(rest)`, :546-560 region).
- So `evalOneStep`'s sync `try` runs for every node, the second node included.
- Whether a failure is "boxed" depends on how the step fails (it returns `Future.failed(Error)` or it throws). It does not
  depend on node position.

**Probe (new, reproduced twice):** `.concertino/scratch/HEL-1660/skeptic3/Second.java`, run against
`scala-library-2.13.15.jar`. It models the D7 sync `try` (SOE arm only, everything else escapes) evaluated inside a
`transformWith` callback, the way node 2 is evaluated.

```
node2 sync-throw OOM completed=false value=None
node2 returns Future.failed(OOM) completed=true value=Some(Failure(java.util.concurrent.ExecutionException: Boxed Exception))
node2 sync-throw SOE completed=true value=Some(Failure(java.lang.RuntimeException: step error: java.lang.StackOverflowError: soe))
node2 returns Future.failed(SOE) completed=true value=Some(Failure(java.util.concurrent.ExecutionException: Boxed Exception))
```

What this shows:
1. A step that **throws** OutOfMemoryError on a second node does not produce a boxed failure. The error escapes the
   callback (Scala 2.13 `handleFailure` rethrows a fatal error), and the walk's Future **never completes**.
2. A boxed failure arises only when a step **returns** a Future already failed with an `Error`.
3. A boxed StackOverflowError reaches `recoverWith` as `ExecutionException(cause = SOE)`. SOE is not `NonFatal`, so D7's
   guard ("an `ExecutionException` whose cause is not `NonFatal` … passes through unconverted") lets it through as a
   non-step error.

**Coverage.** Every AC (1-9) maps to a task. I found no placeholders. The scope matches the ticket.

### Verdict: REFUTE

### Change Requests

1. **D7's "Proof" bullet mis-models the boxed path, and its SOE expectation contradicts its own guard.**
   - Where: design.md D7 "Proof" and "Mutations", task 1.2 and task 2.7 ("green on sync + boxed paths").
   - **Problem (a): the second-node OOM spec hangs.** D7 says a step *throwing* OutOfMemoryError "on a second node
     (boxed)" gives a walk failure. Per the probe, a step that throws on node 2 escapes the `transformWith` callback, and
     the walk Future never completes. That spec would hang. Rounds 1 and 2 both flagged this non-completion.
   - **Fix (a):** state that the boxed case is a step whose `evaluate` *returns* `Future.failed(new OutOfMemoryError)`.
     Position does not matter. The mutation "drop the boxed-fatal guard → red" is only meaningful against that step.
   - Also state the real outcome of a fatal error *thrown* on any node after the first: the walk Future never completes.
     In prod, `-XX:+ExitOnOutOfMemoryError` exits first for OOM. For other fatal errors, it is whatever the dispatcher
     does. Round 2 asked for this sentence ("D7 should say so"), and it is still absent.
   - **Problem (b): the boxed SOE expectation fails against the guard as written.** D7 expects "a step throwing
     StackOverflowError gives a `StepExecutionException` naming it, on both paths". "Both paths" refers to the
     sync/boxed pair just named. But a boxed SOE has cause SOE, which is not `NonFatal`, so the guard passes it through
     unconverted. A competent implementer can read this two ways: change the guard, or change the spec. Either way they
     deviate from the design.
   - **Fix (b): pick one.**
     - Either the guard exempts an SOE cause, converting it with `StepExecutionException.from(step, cause)` so the
       message names the SOE (closest to ruling 8, "a StackOverflowError stays a step error"). Add the mutation
       "drop the SOE exemption → boxed-SOE spec red".
     - Or define SOE's two paths explicitly as "throws on the first node" and "throws on a later node" (both reach the
       sync arm). State that a boxed SOE is not converted, and note that after this change nothing in the engine boxes an
       SOE: the only `Throwable` catch, `:297`, goes away.

2. **Restore the "text-light and text-heavy" split for the just-under-budget shape (round-2 CR 3, partly dropped).**
   - Where: design.md D6 shape list, task 3.3.
   - `LiveCellTally` prices text by length. A text-heavy frame at the budget therefore has few cells.
   - The post-walk copies (`jsRows` at `PipelineRunExecutor.scala:285`, `nodeJsRows` at
     `PipelineRunSucceededWrites.scala:110`) allocate a `JsObject` entry per cell and wrap the existing Strings.
   - So a **text-light, many-cell** frame at the budget is the worst post-walk peak. A text-heavy one would under-measure
     it.
   - D6 lists one "succeeds-just-under-budget" shape with no text profile. `MaxLiveCells` is derived from the worst
     measured end-to-end peak, so the shape choice decides the number.
   - Fix: name both profiles (text-light, near-maximum cells; text-heavy, near-maximum text). Run each as a real run and a
     dry run, and take the maximum.

### Non-blocking notes

- D7 "Side effect, accepted": `LinkageError`, `InternalError` and similar errors on a node after the first now escape a
  Future callback. On a Pekko dispatcher with `jvm-exit-on-fatal-error = on` that exits the instance. On another executor
  the run never completes and its heartbeat keeps it live. This follows ruling 7, but the sentence should name the outcome
  ("exits the instance or hangs the run"), not just "no longer converted".
- D7's guard text "cause is not `NonFatal` and is not a `StepExecutionException`": the second clause is redundant, since a
  `StepExecutionException` is always `NonFatal`. Harmless, but simplify it so a reader does not look for a case it covers.
