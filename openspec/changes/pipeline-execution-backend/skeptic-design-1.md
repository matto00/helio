## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in the change dir.
- `PipelineRunService` engine call sites: `grep -n "engine\." services/pipelines/PipelineRunService.scala`
  → exactly two (`:266` previewStep, `:437` executeRun). Matches the design's claim.
- `PipelineRunService.scala:79`: `private val engine = new InProcessPipelineEngine(fileSystem, connector, csvUrlFetchSeam)`
  — the engine is CONSTRUCTED INSIDE the class from other constructor params plus the private
  `csvUrlFetchSeam` method (`:73`). It is not injected.
- Constructor param list `:32-64` — last param is `isBlocked`; appending is safe.
- `grep -rn "new PipelineRunService" backend/src/main/` → **one** site,
  `backend/src/main/scala/com/helio/api/ApiRoutes.scala:288` (positional through `system`).
  **Zero** hits in `backend/src/main/scala/com/helio/app/Main.scala`.
- `SparkJobSubmitter.submit(pipeline: Pipeline, dataSource: DataSource, steps: Seq[PipelineStep], cache: PipelineRunCache): Future[String]`
  — read in full. `dataSourceRepo`/`pipelineRepo` are constructor fields; the cache and the
  `Pipeline` are per-call. `cache.update(..., Succeeded, rows = Some(rows))` carries rows only.
- `SparkJobSubmitterSpec.scala:~38`: `new SparkJobSubmitter("local[*]", mockDsRepo, null)` —
  `pipelineRepo` is null, and `submit` calls `pipelineRepo.updateLastRunInternal(...)` **unguarded**.
- `PipelineRowJson.scala:16`: `type Row = Map[String, Any]` exists and is the engine's signature type.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` exists (task 2.2's suite name is real).

### Verdict: REFUTE

The scope is correct (genuinely behavior-preserving, no wire/route change, no scope creep — I
found none). But two of the three load-bearing decisions are **not implementable as written**
against the actual code, and one task names a file that does not contain the thing it says to edit.

### Change Requests

1. **Decision 3's default argument cannot compile.**
   `executionBackend: PipelineExecutionBackend = new InProcessExecutionBackend(engine)` references
   `engine`, an *instance* field (`PipelineRunService.scala:79`). Scala evaluates constructor
   default arguments in synthetic static `$lessinit$greater$default$N` methods where instance
   members are out of scope → `not found: value engine`. Nor can `engine` move to the caller: it is
   built from `fileSystem`/`connector`/`csvUrlFetchSeam`, and `csvUrlFetchSeam` closes over the
   service's own `system`/`resolveHost`/`isBlocked` params. Specify the actual mechanism, e.g. a
   `null`/`Option` default plus
   `private val backend = if (executionBackend == null) new InProcessExecutionBackend(engine) else executionBackend`
   (matching the file's existing nullable-default convention), and state that `engine` therefore
   stays a live field.

2. **Task 2.4 names the wrong file, and probably should not exist.**
   `PipelineRunService` is never constructed in `app/Main.scala`; the sole production site is
   `api/ApiRoutes.scala:288`. Also, if CR 1 is resolved with an internal default (as Decision 3
   intends), no call-site edit is needed at all — which contradicts `proposal.md`'s Impact bullet
   claiming a `Main.scala` wiring change. Delete task 2.4 (and the Main.scala impact bullet) or
   retarget it to `ApiRoutes.scala:288` with an explicit reason to pass the backend explicitly.
   Its verification ("`sbt run` boots, `/health` responds") is also the wrong signal for a
   compile-level wiring change.

3. **Decision 2 is unimplementable: `SparkJobSubmitter.execute` has no way to call `submit`.**
   `submit` requires `(pipeline: Pipeline, dataSource, steps, cache: PipelineRunCache)`. The trait's
   `execute(dataSource, steps, dataSourceRepo, assertionSink, truncationSink)` supplies **neither a
   `Pipeline` nor a `PipelineRunCache`**, so "call the existing `submit`, then poll
   `PipelineRunCache`" has no source for either. Resolve explicitly: take the cache (and, if needed,
   a synthetic/optional `Pipeline`) as a `SparkJobSubmitter` constructor field, or state that
   `execute` bypasses `submit` and calls `loadDataFrame`/`applyStep`/`collectRows` directly. Do not
   leave this to the implementer.

4. **`PipelineExecutionOutcome`'s non-row fields are undefined for the Spark impl.**
   The cache's terminal entry carries rows only; there is no Spark analogue for `stepCounts`,
   `sourceRowCount`, or `primaryStats: SourceReadStats`. The design must state what
   `SparkJobSubmitter.execute` returns for each (e.g. `Map.empty` / row count of the loaded
   DataFrame / `SourceReadStats(truncated = false, availableRowCount = None)`) rather than letting
   an implementer invent values — otherwise task 4.2's "assert the outcome shape" asserts whatever
   was invented.

5. **State that the Spark impl ignores `assertionSink`/`truncationSink`.** Both are in-process-engine
   constructs with no Spark meaning. A trait whose params one implementation silently drops needs
   that documented in the trait's contract now, not discovered at review.

6. **Task 4.2 as written will NPE.** `submit` calls `pipelineRepo.updateLastRunInternal` unguarded,
   and the existing `SparkJobSubmitterSpec` fixture passes `pipelineRepo = null`. The task must
   specify the stub `PipelineRepository` + `PipelineRunCache` the test provides and how the poll
   reaches a terminal status deterministically (it is an async `Future` on a separate EC).

### Non-blocking notes

- Decision 1's `PipelineExecutionOutcome.rows: Seq[Map[String, Any]]` should use the existing
  `PipelineRowJson.Row` alias (`PipelineRowJson.scala:16`), which is what the engine's own
  signatures use.
- `previewStep` (`:266`) currently relies on `executeWithStepCounts`'s **default** `assertionSink`.
  Routing it through a trait whose `assertionSink` is non-optional means the implementer must pass a
  fresh `new AssertionSink` there to stay behavior-identical — worth calling out in task 2.3 so it
  isn't accidentally shared with the run path's sink.
- Scope, ACs and refactor discipline otherwise check out: I found no behavior change, no wire
  change, and no work beyond the ticket's three bullets.
