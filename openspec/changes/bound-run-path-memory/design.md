## Context

See proposal.md and ticket.md (rulings 1-8). HEL-1630 (069afd36d) left these on main, used only by the draft preview
(`DraftPreviewService.scala:188-200`): the `PipelineExecutionContext` fields `maxNodeRows`/`maxLiveCells`/`maxStringChars`/
`stringBudget`; `RowBudget`, `StringBudget`+`CellWeight`, `LiveCellTally`; `executeTree`'s `contextTransform`, `retainOnly`
and `draftViolation`/`memoryViolation` backstops. Setting `maxLiveCells` also selects leaf-first order. Every message
says "draft preview".

The only production caller of the engine for runs is `InProcessExecutionBackend.execute` (`domain/engine/
InProcessExecutionBackend.scala:61`), reached by `PipelineRunExecutor` (every trigger: manual, scheduled, hook, auto-run),
`PipelineRunPreview.previewAtNode` (saved preview) and `PipelineRunBackfill`. After the walk, runs read `nodeOutcomes` for
Output nodes (`PipelineRunSucceededWrites.scala:96-109`, `:208-217`), preview/backfill read their target node, and the
engine reads the trunk terminal (`executeTree`'s final `trunkRows`). The catch-all is `catch { case ex: Throwable => ...}`
at `InProcessPipelineEngine.scala:297`. Prod heap: 768 MB (Cloud Run 1 GiB x `MaxRAMPercentage=75`, `Dockerfile:46`).

## Goals / Non-Goals

**Goals:** apply rulings 2-8 to every run and the saved preview through the one backend entry; keep the draft preview's
behaviour and wording byte-identical; keep the run walk order and every under-limit run's output identical.

**Non-Goals:** global cross-run memory admission; tier-specific limits; HEL-1676 (regex); HEL-1677; the HEL-505 guard.

## Decisions

**D1. One `RunLimits` object, applied in `InProcessExecutionBackend.execute`.** `MaxNodeRows = 100000`,
`MaxStringChars = 1048576`, `MaxLiveCells` = the measured value (D6). `execute` passes a `contextTransform` that sets
`maxNodeRows`, `maxLiveCells`, `maxStringChars` and the run label, plus a `retainOnly` set (D3). Because every run trigger,
the saved preview and backfill go through this one method, no caller can forget the limits. Alternative, setting the
limits in each service caller: rejected, since three callers means three places to miss one.

**D2. Messages take a label carried on the context.** Add a `limitLabel` field to `PipelineExecutionContext`, defaulting
to the draft label, so every existing construction and the draft preview are unchanged. `RowBudget.exceeded`/`backstop`/
`flatMap`, `StringBudget.tooLong`/`exceeded` (and its constructor) and `MemoryLimitMessage` take the label; steps pass
`ctx.limitLabel` where they already pass `ctx.maxNodeRows`/`ctx.stringBudget`, including the expression interpreter's
`checkLength` path (`ExpressionInterpreter.scala:271`, which today threads only an `Int`). The label carries both casings
(sentence-start and mid-sentence), and `StringBudget.exceeded`'s "what this request has left" is reworded per label. The run wording is "pipeline run limit",
for example "join would produce more than 100,000 rows (pipeline run limit)", "Pipeline run memory limit reached: ...",
"Pipeline run text limit reached: ...". The draft strings stay byte-identical; HEL-1630's exact-message specs are the
guard. Alternative, rewriting the message at the engine boundary: rejected, since string surgery on another layer's text
is fragile.

**D3. Frame release for runs, with an explicit retain set.**
- `PipelineExecutionBackend.execute` and `InProcessExecutionBackend.execute` gain a **required** `retain: Set[NodeKey]`
  parameter, with no default. With an empty default, frame release would silently drop an Output's frame:
  `PipelineRunSucceededWrites.scala:104` skips misses, so the run would succeed with a stale snapshot. `SparkJobSubmitter`
  (never wired) takes the parameter too.
- Under the run-only `runRetention` flag (D3a), `executeTree` keeps the trunk terminal (or the lowest-root fallback,
  `:607`). The draft also sets `retainOnly` but never reads the terminal, so it is untouched (C6).
- `PipelineRunExecutor` passes the pipeline's Output node keys:
  - `StepKey` for step-bound Outputs, `RootKey` for root-bound ones, the same mapping as
    `PipelineRunSucceededWrites.scala:96-101`.
  - The keys are listed with `listByPipelineInternal` before execution, which means injecting `outputRepo` into
    `PipelineRunExecutor`. Its constructor has none today (`:23-36`).
- `PipelineRunPreview` and `PipelineRunBackfill` pass their target (`StepKey`, or the root).
- Accepted trade-off: an Output created mid-run is materialised on the next run. Alert evaluation then logs "never
  evaluated by the tree walk" (`PipelineRunSucceededWrites.scala:218-222`). That log is downgraded to `warn` ONLY for an
  Output that was not in the pre-run `retain` set; a real miss still logs as an error. The PR notes it.

**D3a. One run-only flag, `runRetention` (an `executeTree` parameter, default false, set only by the run backend).**
It does three things:
- **Retains the trunk terminal (D3).**
- **Keeps root frames charged.** A run's root frames stay reachable for the whole walk: `rootFrames` in `executeTree`
  (fallback at `:537`) and `loaded`/`primaryRows` in `InProcessExecutionBackend.execute` (`:53-62`). So the tally never
  removes a root's cells, even when `releaseConsumed` drops it from `nodeOutcomes`.
- **Keeps write-back frames charged.** An enabled `upsertsource` node stores its input frame in `writeBackSink`
  (`UpsertSourceStep.scala:34`) until `applyWriteBacks` runs after the walk (`PipelineRunExecutor.scala:447`). The node's
  cells therefore stay counted after release.

Each effect has its own engine spec and its own mutation (drop terminal retention / root pinning / write-back pinning →
spec red). The required `retain` also has a mutation: an empty set passed from `PipelineRunExecutor` must turn the
Output-snapshot spec red. The draft never sets `runRetention`, so its trip points are unchanged.

**D4. Runs keep their walk order.** The leaf-first choice becomes an explicit `executeTree` parameter (`leafFirst`,
default false) that `DraftPreviewService` sets, instead of being inferred from `maxLiveCells`. Runs keep
`structuralRank`, so side-effecting steps (upsertsource writes, assertions, AI calls) keep their order and the HEL-911/913
parity specs are untouched. Alternative, letting runs go leaf-first: rejected because it reorders side effects. The
budget is enforced either way: a shape that leaf-first would have fit fails cleanly instead.

**D5. A breach is an ordinary step failure.** Every limit raises a `StepConfigError` that the existing engine path wraps
in `StepExecutionException` (step id, kind, lane path), and runs never set `onNodeError`, so the walk fails. The run then
takes the existing failure path (`PipelineRunTerminalWrites.executeRunFailure`): status `failed`, `error_log` names the
step and limit, and no snapshot is written because the success path is never reached (rulings 5 and 6).

**D6. Budget sizing by measurement (ruling 3).**
- A run-path heap spec modelled on `DraftPreviewHeapSpec` runs each shape **end to end through the service run path**:
  `PipelineRunService` → `PipelineRunExecutor` → `PipelineRunSucceededWrites`.
- So the post-walk JSON copies are inside the measurement: `jsRows` (`PipelineRunExecutor.scala:285`) and the per-node
  `nodeJsRows` (`PipelineRunSucceededWrites.scala:110`).
- Each shape runs in a forked JVM with `-Xmx768m`, one shape at a time.
- Readings: `System.gc()` then the used heap before the run, sampled at the peak node and during the snapshot writes. The shapes are join fan-out, unpivot, splittext,
chunkbytokencount, extractheadings, doubling concat, a text-copying fan-out, pivot over long text, a fresh-string chain,
a 300,000-cell CSV root then a fan-out, an upsertsource of a large frame followed by more steps (D3a), two
**succeeds-just-under-budget** shapes with an Output on the trunk terminal: a text-light, many-cell variant, which is the
worst case for the per-cell JSON copies, and a text-heavy variant. Each runs as both a real run and a dry run, and the
worst post-walk peak is the max of the four (retained frames plus `jsRows` plus `nodeJsRows`), and the AC6 ordinary shape. The service-level
shapes use real `nodeSnapshotRepo` and `outputHistoryRepo`; with a null repo the snapshot writes are skipped
(`PipelineRunSucceededWrites.scala:88`), and the measurement would be hollow. AC6 is the widest CSV the run path accepts,
50,000 rows x 6 columns = 300,000 cells (`CsvLimits.scala:17-19`, enforced at `InProcessPipelineEngine.scala:907-913`),
with a 10-step compute chain and Outputs on a middle node and the terminal. `MaxLiveCells` is the largest round value at
which the worst measured **end-to-end** peak stays at or under 192 MB. The starting
estimate is 4,000,000 cells, scaled from HEL-1630's 1.8M = 74.5 MB peak. The value and its measurement are recorded in
this file. **If AC6's shape cannot run under the 192 MB budget, escalate. Do not raise the budget unilaterally.**

**D7. Fatal errors (ruling 7; ruling 8 `nonfatal-plus-stackoverflow-arm`).** There are two ways a step can fail:
- **Thrown** while the step runs. The synchronous `try` at `:297` sees it on any node.
- **Returned** as `Future.failed(e)`. Scala 2.13 boxes an `Error` there into a `NonFatal`
  `ExecutionException("Boxed Error")`, as skeptic probes `skeptic2/Box.java` and `skeptic3/Second.java` show.

Node position does not decide which path a failure takes.
- **`try` arms:**
  - `StackOverflowError` is converted directly via `StepExecutionException.from(step, rawSoe)`, so the message names a
    stack overflow.
  - `NonFatal(ex)` is handled as today.
  - Anything else, such as OutOfMemoryError, is not caught.
- **`recoverWith` guard:**
  - A boxed failure whose cause is `StackOverflowError` is unwrapped and converted, so the stack overflow becomes a step
    error on both paths.
  - Any other boxed fatal failure (an `ExecutionException` whose cause is not `NonFatal`) passes through unconverted, so
    the run fails on the generic failure path.
  - Everything else is converted as today.
- **An uncaught fatal error thrown on a later node never finishes the walk.** Every node after the first is evaluated
  inside a `transformWith` callback, so the error escapes the callback and the walk's Future never completes. On the
  first node it escapes `executeTree` synchronously.
  - In production `-XX:+ExitOnOutOfMemoryError` (added to `Dockerfile`) exits the JVM at the allocation itself.
  - For `LinkageError`/`InternalError` on a later node, Pekko's `jvm-exit-on-fatal-error` exits the instance, or the
    run hangs until the instance goes.
  - Today these become step errors. The change is accepted under ruling 7; none of them is an expected step outcome.
    `InterruptedException` and `ControlThrowable` are likewise no longer converted.
  - Cloud Run restarts the instance and the HEL-1511 reaper fails the orphaned run.
  - HEL-1676 owns the regex root cause.
- **Proof.** The specs call `executeTree` directly. No spec throws a fatal error on a later node, because it would hang.
  | Case | Expected outcome | Mutation that turns it red |
  | --- | --- | --- |
  | OOM thrown on the first node | escapes `executeTree` synchronously, not as a `StepExecutionException` | revert the `try` to `Throwable` |
  | OOM returned as `Future.failed` | the walk fails with a non-`StepExecutionException` | drop the boxed-fatal pass-through |
  | SOE thrown on any node | `StepExecutionException` naming the overflow | drop the `try` arm |
  | SOE returned as `Future.failed` | the same `StepExecutionException` | drop the guard's SOE exemption |

## Risks / Trade-offs

- [Budget is per run: concurrent runs can still sum past the heap] → non-goal; follow-up (global admission).
- [`LiveCellTally` counts each frame's cells even where immutable maps share structure, so chains are over-priced]
  → conservative by design; AC6's ordinary shape is the guard that legitimate pipelines still fit.
- [Saved pipelines over the limits start failing] → accepted by ruling 6; the error names the step and limit.
- [HEL-1677 touches the same files] → the second to merge resolves it.

## Planner Notes

- Self-approved: D2 label, D3 retain-before-run, D4 `leafFirst`, D3a `runRetention`; heap spec in `testFull` only if it
  fits the forked-group pattern, else opt-in and recorded. No migration or API change; rollback is a revert.

## Measured Budget (task 3.3, recorded by the executor)

`RunLimits.MaxLiveCells` = **3,000,000** cells (the planned starting estimate was 4,000,000). Measured end to end through the service run
path by `RunPathHeapSpec` (real `PipelineRunService`, CSV roots, real snapshot and history repositories, forked JVM `-Xmx768m`, one shape at a
time; `System.gc()` x2 then used heap, sampled at every node boundary, before every snapshot write, and by a background sampler every 150 ms so
the database write itself is covered; delta = max sample - before). Evidence is under `evidence/`.

| Budget the just-under text-light shape is sized for | real run MB | note |
| --- | --- | --- |
| 4,000,000 (the estimate) | 362.2 | red: `evidence/heap-sweep-xmx768m.log`, hooks only, before the terminal-copy change below |
| 2,400,000 | 148.6 | `evidence/heap-sweep4-dedupe-xmx768m.log` |
| 2,600,000 | 158.5 | `evidence/heap-sweep5-xmx768m.log` |
| 2,800,000 | 175.8 | same |
| 3,000,000 | 185.6 | same; final run `evidence/green-heap-xmx768m.log`: 185.5 |
| 3,200,000 | 195.7 | same: over 192 MB, so 3,000,000 is the largest round value that fits |

Final run at 3,000,000 (`evidence/green-heap-report-3000000.txt`): worst shape 185.5 MB (just-under text-light, real run). The AC6 shape
(50,000 x 6 CSV, 10-step compute chain, Outputs on a middle node, a tail and the terminal) peaks at 150.4 MB and its walk holds 2,400,000
cells (root 300,000 pinned + the retained middle Output 550,000 + parent 750,000 + child 800,000), so it fits the 3,000,000 budget and the
192 MB bound together. No escalation was needed for AC6.

**One change beyond the plan, found by the measurement.** The first sweep showed a 100,000-row run with an Output on its terminal
(`csv-root-then-fan-out`) at 204 MB regardless of the cell budget (about 1.4 M held cells), because the success path built the terminal
node's JSON rows twice: once as the run's `jsRows` and again as that Output's `nodeJsRows`. The cell budget cannot bound a cost it does not
price, and no budget fits both that shape and AC6, so `PipelineRunSucceededWrites` now reuses `jsRows` when the node being written IS the trunk
terminal (`outcome.rows eq resultRows`). The persisted rows are identical; the shape fell to 150 MB and the text-light worst case from 200 MB to
149 MB at 2,400,000 cells. This is a memory optimisation, not a bound, so it carries no mutation; AC6's service spec asserts the terminal
Output's snapshot row count.

### Cycle 2: re-sized with margin, heap spec made opt-in

The evaluator saw the same shapes swing by up to about 22 MB between runs, so 3,000,000 cells (6.5 MB of headroom) was not safe. Repeat table
(`evidence/heap-repeats-report.txt`; 3 runs each, forked `-Xmx768m`, one shape at a time, MB, real / dry):

| Shape | 2,600,000 cells | 2,800,000 cells |
| --- | --- | --- |
| just-under text-light, real | 158.5, 158.5, 158.5 | 175.7, 175.5, 175.6 |
| just-under text-light, dry | 115.6, 116.0, 115.7 | 129.5, 129.5, 129.7 |
| just-under text-heavy, real | 114.9, 115.5, 115.2 | 115.0, 115.5, 115.4 |
| just-under text-heavy, dry | 57.7, 57.7, 57.7 | 57.7, 57.7, 57.7 |
| AC6 (2.4M cells, budget-independent), real | 173.4, 149.8, 172.4 | same shape |
| AC6, dry | 83.5, 83.6, 83.5 | same shape |

The largest swing is 23.6 MB (AC6 real, bimodal 150/173). The rule: the worst budget-dependent shape must stay at or under 192 - 23.6 = 168.4 MB.
2,600,000 gives 158.5 MB (swing 0); 2,800,000 gives 175.7 MB, so **`MaxLiveCells` = 2,600,000**. AC6 holds 2,400,000 cells and still succeeds
(`PipelineRunLimitsServiceSpec`; its tail-Output case moved to a separate 2,000-row test, since a tail Output retained 500,000 more cells than
the ticket's AC6 shape). AC6's own peak (173.4 MB at worst) does not depend on the budget and stays under 192 MB.

`RunPathHeapSpec` is now opt-in (`HELIO_MEASURE=1`, run under `HELIO_TEST_JVM_XMX=768m`; `HELIO_RUN_HEAP_REPEATS` and `HELIO_RUN_HEAP_ONLY`
select repeats and shapes), so CI never asserts a heap number. `RunLimitsGuardSpec` is the deterministic guard in `testFull`: it pins the ruled
constants, requires `MaxLiveCells` at or under the measured ceiling (2,600,000), and runs the AC6 walk through `LiveCellTally` (fits; refused one
column wider). Mutations `guard-budget-below-ac6`, `guard-budget-above-ceiling` and `guard-row-cap` turn it red (`evidence/mutations.md`).
