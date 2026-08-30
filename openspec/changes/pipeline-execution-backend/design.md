## Context

`PipelineRunService.executeRun` (the live path — every route wires here) calls
`InProcessPipelineEngine.loadRowsWithStats` then `.executeWithStepCounts` directly, inline in a
`flatMap` chain also carrying SSE publish calls, assertion/truncation sinks, and post-run
persistence (schema/rows/binary-refs/alerts). `previewStep` calls the same two engine methods for
a step-prefix preview. `SparkJobSubmitter` is a separate, unwired code path (HEL-202 dormant, no
route constructs or calls it — confirmed via `PipelineRunService.status(runId)` reading
`PipelineRunCache`, which only `SparkJobSubmitter` ever writes to) with its own submit-and-poll
shape: `submit()` returns a `runId` immediately and updates `PipelineRunCache` asynchronously as
the background Spark job progresses through queued → running → succeeded/failed.

The ticket asks for a `PipelineExecutionBackend` trait (submit → status → read result) that
`PipelineRunService` depends on, with the in-process engine as the sole wired implementation.

## Goals / Non-Goals

**Goals:**
- One trait both the in-process engine and `SparkJobSubmitter` can implement, without changing
  either one's actual runtime behavior.
- `PipelineRunService` depends on the trait, not `InProcessPipelineEngine`, at its two execution
  call sites.
- Zero change to `executeRun`/`previewStep`'s SSE, persistence, or error-handling logic — only the
  row-computation step moves behind the trait.

**Non-Goals:**
- Wiring `SparkJobSubmitter` (or any second impl) as an actual selectable backend — HEL-332
  (tiered dispatch) owns routing between backends.
- Changing `SparkJobSubmitter`'s async submit/poll model to match the in-process call shape, or
  vice versa — see Decision 2.
- Touching `InProcessPipelineEngine`'s tree-walk internals (HEL-905).

## Decisions

**Decision 1 — trait shape is a single `Future`-returning `execute`, not three separate
submit/status/read calls, and it takes `pipeline: Pipeline` alongside `dataSource`/`steps`.**
`executeRun` and `previewStep` both consume the engine's two calls as one
synchronous-from-the-caller's-perspective `Future` chain today; a real three-call submit/poll API
would force `PipelineRunService` to poll, which is a behavioral change the ticket explicitly rules
out ("no behavioral diff"). A `scala.concurrent.Future` already *is* an async
submit-then-read-result value (its `flatMap` composes exactly like the ticket's "submit run →
status → read result" without inventing a synchronous poll loop). `pipeline` is included because
`SparkJobSubmitter.submit` requires it (round-1 skeptic finding #3) and both `PipelineRunService`
call sites already have it in scope (`executeRun`'s `pipeline` param; `previewStep`'s `pipeline`
from `pipelineRepo.findByIdShared`) — passing it costs nothing at either call site.

```scala
/** `assertionSink`/`truncationSink` are in-process-engine-specific output parameters
 *  (HEL-509/HEL-861). An implementation with no equivalent concept (e.g. `SparkJobSubmitter`,
 *  which supports neither `assert` steps nor truncation tracking) MUST leave them untouched —
 *  never populate or clear them — silently ignoring both. */
trait PipelineExecutionBackend {
  def execute(
    pipeline: Pipeline,
    dataSource: DataSource,
    steps: Vector[PipelineStep],
    dataSourceRepo: DataSourceRepository,
    assertionSink: AssertionSink,
    truncationSink: TruncationSink
  )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome]
}

final case class PipelineExecutionOutcome(
  rows: Seq[PipelineRowJson.Row],      // reuse the existing `Row = Map[String, Any]` alias (round-1 non-blocking note)
  stepCounts: Map[String, Long],       // exact type `executeWithStepCounts` already returns
  sourceRowCount: Long,
  primaryStats: SourceReadStats
)
```

Alternative considered: a literal submit(handle)/status(handle)/result(handle) three-method trait
mirroring `SparkJobSubmitter`'s cache-poll shape. Rejected — forcing the in-process path onto a
poll model it doesn't need today would be new behavior (a fabricated "queued"/"running" interval),
not a refactor.

**Decision 2 — `SparkJobSubmitter` gets a *second*, additive `execute` method implementing the
trait, bypassing `submit`/`PipelineRunCache` entirely and calling `loadDataFrame`/`applyStep`/
`collectRows` directly.** Round-1 review found `execute`'s signature supplies no
`PipelineRunCache` (submit's fourth parameter) and that reusing `submit`'s async
insert-run/background-Future/cache-polling machinery would require either fabricating a transient
cache no caller ever reads, or awaiting `submit`'s own background `Future` from outside — needless
complexity for a path with zero production callers. Instead, `execute` is a direct synchronous
composition, mirroring `submit`'s own body but returning the outcome instead of writing it to a
cache:

```scala
def execute(pipeline, dataSource, steps, dataSourceRepo, assertionSink, truncationSink)(implicit ec) =
  Future {
    val df       = loadDataFrame(dataSource)
    val resultDf = steps.foldLeft(df)((cur, step) => applyStep(cur, step))
    val rows     = collectRows(resultDf)
    PipelineExecutionOutcome(
      rows            = rows,
      stepCounts      = Map.empty,                          // Spark path tracks no per-step counts (documented gap)
      sourceRowCount  = df.count(),                          // best-effort; not the post-step row count
      primaryStats    = SourceReadStats(truncated = false, availableRowCount = None) // Spark applies no run cap
    )
  }(sparkEc)
```
This performs no `pipelineRunRepo`/`pipelineRepo` writes and does not touch `cache` — it does not
reproduce `submit`'s side-effecting persistence (that remains `submit`'s job, unchanged, for its
own dormant callers). `assertionSink`/`truncationSink` are accepted per the trait contract and
silently ignored (Decision 1's scaladoc). This keeps `submit` byte-for-byte unchanged (satisfying
"no behavior change to `SparkJobSubmitter`'s own execution logic" from proposal.md) while still
proving the trait admits a second, independently-callable implementation.

**Decision 3 — `PipelineRunService` gets a new constructor parameter
`executionBackend: PipelineExecutionBackend = null`, resolved to a private field.** A default
value of `new InProcessExecutionBackend(engine)` cannot compile (round-1 finding #1: `engine` is
an instance field, out of scope in a synthesized static default-argument method). Instead, mirror
the file's own established `= null` + resolve-in-body convention (already used for `binaryRefRepo`,
`connector`, `auditService`, `system`):

```scala
executionBackend: PipelineExecutionBackend = null
...
private val backend: PipelineExecutionBackend =
  if (executionBackend != null) executionBackend else new InProcessExecutionBackend(engine)
```
`engine` remains a live private field, still constructed exactly as today, and `backend` is what
`executeRun`/`previewStep` call. No call site (`ApiRoutes.scala:288` — the sole production
constructor call, per round-1 finding #2; there is no `PipelineRunService` construction in
`Main.scala`) needs to change, since the new parameter is optional and appended last, after
`isBlocked`. `executeRun` replaces its `engine.loadRowsWithStats(...).flatMap { ...
engine.executeWithStepCounts(...) }` chain with one `backend.execute(pipeline, ...)` call returning
the same `(rows, stepCounts, sourceCount, primaryStats)` tuple shape; `previewStep` likewise, using
a **fresh `new AssertionSink`** at that call site (round-1 non-blocking note: `previewStep`
currently relies on `executeWithStepCounts`'s own defaulted sink, which the trait's non-optional
parameter no longer provides for free — passing a fresh, discarded sink preserves that behavior
exactly, without accidentally sharing state with the run path's sink).

*(Correction to proposal.md's Impact section: the "`Main.scala` — wiring" bullet is removed; there
is no `Main.scala` call site to change. `InProcessExecutionBackend` is wired via the internal
default above, not an explicit constructor argument.)*

## Risks / Trade-offs

- [Risk] A second impl (`SparkJobSubmitter.execute`) is written but never exercised by any test
  today → [Mitigation] add one direct unit test against `SparkJobSubmitter.execute` (submit a
  trivial static-source pipeline, assert the outcome shape — see tasks.md 4.2 for the exact fixture
  requirements) so the "admits a second impl" claim is evidenced, not just asserted.
- [Risk] Silently changing `PipelineRunService`'s field list could break a fixture that constructs
  it positionally → [Mitigation] the new parameter is appended last (after `isBlocked`) with a
  `null` default, preserving every existing positional and named call site.
- [Risk] `SparkJobSubmitter.execute`'s `sourceRowCount`/`stepCounts`/`primaryStats` are
  approximations (pre-step row count instead of post-step, `Map.empty`, and an always-`false`
  truncation flag respectively) rather than faithful equivalents → [Mitigation] this is acceptable
  because `execute` has zero production callers (Decision 2) and exists solely to demonstrate the
  trait admits a second implementation; the approximations are documented here and in the trait
  scaladoc so a future caller (HEL-331/HEL-332) knows to revisit them before relying on the values,
  not just the row contents.

## Migration Plan

Single PR, no data migration, no wire change. Rollback is a plain revert — the trait and
`InProcessExecutionBackend` are additive; removing them restores today's direct `engine` calls.

## Planner Notes

Self-approved: trait signature (Decision 1) and `SparkJobSubmitter` treatment (Decision 2) are
implementation-detail technical choices within the ticket's explicit scope ("submit run → status →
read result" trait, in-process engine as sole default, Spark path admits it as a second impl) —
not a new external dependency, breaking change, or scope expansion, so no escalation raised.
