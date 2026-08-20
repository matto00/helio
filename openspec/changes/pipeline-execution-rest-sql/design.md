## Context

`PipelineRunService.runPipeline` (lines 166-172) and `.previewStep` (lines 200-205) hardcode a
rejection for `RestSource`/`SqlSource` before `InProcessPipelineEngine.loadRows` is ever reached.
`loadRows` (InProcessPipelineEngine.scala:57-112) itself has no case for either kind. Both
connectors already implement the shared `Connector[Config]` SPI (`RestApiConnector.fetch`,
`SqlConnector.fetch`, each `(config, maxRows) => Future[Either[String, Vector[JsValue]]]`), already
reused by `CreateSourceEnvelope`/`SourceService` for schema inference and preview. `RestApiConnector`
requires an implicit `ActorSystem` and is constructed once in `Main.scala` (`val connector = new
RestApiConnector()`), then threaded through `ApiRoutes` into `SourceService`/`PipelineService`.
`SqlConnector` is a stateless `object` — no DI needed. `PipelineRunService` does not currently
receive a `RestApiConnector`.

## Goals / Non-Goals

**Goals:**
- A pipeline whose base source is a healthy, reachable `rest_api` or `sql` source can complete a
  real run (`POST /api/pipelines/:id/run`), a preview (`previewStep`), and proposal-apply, producing
  rows that populate the output DataType — the same contract `static`/`csv` already satisfy.
- HEL-755's fail-safe behavior for a genuinely unreachable/misconfigured source is preserved
  unchanged (it now fails via the ordinary run-failure/rollback path, not `recordUnrunnable`).
- Existing `static`/`csv`/`text`/`pdf`/`image` execution is behavior-preserving.

**Non-Goals:**
- Spark job submission for `rest_api`/`sql` — this wires the in-process path only.
- Unbounded/streaming row volume — the in-process engine holds the full row set in memory (same as
  every other source kind it already supports), so this change accepts the same bound.
- Any change to connector fetch/auth logic itself.

## Decisions

**D1 — Reuse `Connector[Config].fetch`, in-process only.** `InProcessPipelineEngine.loadRows` gets
two new cases that fetch via the connector, then convert each `JsValue` row to a `Row`
(`Map[String, Any]`) with a **new helper**, `PipelineRowJson.jsRowToRow`:
```scala
def jsRowToRow(v: JsValue): Row = v match {
  case JsObject(fields) => fields.map { case (k, fv) => k -> jsValueToAny(fv) }
  case other            => Map("value" -> jsValueToAny(other))
}
```
Corrected from an earlier draft of this design that called `jsValueToAny` directly on a whole row
and cast the result — `jsValueToAny` is a **per-scalar-field** converter (verified at
`PipelineRowJson.scala:53-59`; it never produces a `Map`) and that would throw a
`ClassCastException` on every row. `jsRowToRow` mirrors `parseStaticRows`'s own per-field mapping
loop (`PipelineRowJson.scala:83-87`, `colNames.zip(row).map { case (name, jsValue) => name ->
jsValueToAny(jsValue) }`) applied to a `JsObject`'s fields instead of a static row's zipped column
list — the `other` fallback exists because `RestApiConnector.toRows` can return non-object elements
for a REST endpoint whose JSON root is a bare scalar/array-of-scalars (`RestApiConnector.scala:60-64`,
`case other => Vector(other)`); `SqlConnector.toRows` always produces `JsObject` rows so that branch
is unreached on the SQL path. Each `loadRows` case becomes:
`case r: RestSource => ...connector.fetch(r.config, maxRunRows).flatMap { case Left(err) =>
Future.failed(new IllegalArgumentException(err)); case Right(jsRows) =>
Future.successful(jsRows.map(PipelineRowJson.jsRowToRow)) }` (SQL equivalent via `SqlConnector.fetch`,
no connector-null guard needed — stateless object). This mirrors every other `loadRows` case's
`Future.failed(new IllegalArgumentException(...))` convention on error, so `executeRun`'s existing
generic `Failure(ex)` handling (PipelineRunService.scala:388-415) needs no change — a connector
error becomes the same `"Pipeline execution failed"` / `422` outcome a CSV read failure already
produces. Alternative considered: extend `SparkJobSubmitter` instead — rejected as a much larger
lift over a small-run in-process path (D3), and the ticket's own scope note prefers the in-process
route for small/interactive runs.

**D2 — Row bound: `maxRunRows = 1000`.** Neither connector's `fetch` streams — both materialize the
full result before returning (REST parses the whole response body; SQL's `Statement.setMaxRows`
bounds the JDBC fetch itself). A full, unbounded pipeline run mirrors `DataSourceService.staticMaxRows`
(500) and `SqlConnector.inferSchema`'s existing `maxRows = 100` sample — both already accept a fixed
cap rather than unbounded fetch. `1000` is chosen over reusing `staticMaxRows` (500) because a real
run (vs. a preview/inference sample) is the one place a REST/SQL pipeline actually produces its
panel-bindable data, so a slightly larger bound is warranted; it is not unbounded because the
in-process engine holds every row in memory for the rest of step execution (same constraint every
other in-process source kind already has). Defined as a `private val maxRunRows: Int = 1000` on
`InProcessPipelineEngine`, distinct from `previewStep`'s pre-existing 10-row preview cap (unchanged
— preview already truncates via `.take(10)` after `loadRows`/`executeWithStepCounts`, so `loadRows`
itself doesn't need a smaller preview-specific bound).

**D3 — Thread `RestApiConnector` through `PipelineRunService` → `InProcessPipelineEngine`, both with
a nullable default.** `PipelineRunService` gains a `connector: RestApiConnector = null` constructor
parameter — mirrors the file's own existing convention for `binaryRefRepo`/`alertEvaluationService`
(both `= null` today). `InProcessPipelineEngine` gains the same `connector: RestApiConnector = null`
parameter. `ApiRoutes.scala` passes its existing `connector` value (already constructed in
`Main.scala`, already threaded to `SourceService`/`PipelineService`) at `PipelineRunService`'s one
production construction site. This is a deliberately minimal-blast-radius choice: 8 existing test
files construct `PipelineRunService`/`InProcessPipelineEngine` directly and none need to change
unless their test specifically exercises `rest_api`/`sql` execution — a `null` connector attempting
to execute one of these kinds fails fast with a clear `IllegalArgumentException` guard
(`if (connector == null) throw ...`) inside the new `RestSource` `loadRows` case, rather than a
confusing `NullPointerException` from the connector call itself. `SqlConnector` needs no such
threading (stateless `object`, already imported directly by `PipelineProposalService`).

However, several EXISTING tests do exercise this exact path and assert the pre-change behavior, so
they are NOT blast-radius-free — all must be updated as part of this change (proposal.md Impact):
`PipelineApplyProposalRollbackSpec.scala` lines 29-57 and 118-145 (assert a `blocked` run for a
healthy `rest_api` source — this change makes that source execute for real instead — fix is
realizable with zero new fixture work: `PipelineApplyProposalSpecBase.scala:66-69` already builds a
`stubConnector`, keyed on `config.url`, and already threads it through the real `ApiRoutes`
constructor at `:135-141`; task 3.1 alone makes these two tests' `RestSuccessUrl` fetches succeed
end-to-end), and three tests in `PipelineRunRoutesSpec.scala` — lines 222-228 (`"POST
/pipelines/:id/run returns 422 for rest_api source type"`), 231-237 (same, `sql`), and 377-387 (the
preview equivalent) — all asserting the literal categorical-rejection outcome this change removes.
Unlike `PipelineApplyProposalRollbackSpec.scala`, `PipelineRunRoutesSpec.scala`'s `makeRoutes` helper
(lines 180-198) has NO `connector` parameter today and its `seedDs`/`seedDs("sql")` helpers seed a
degenerate `"{}"` config — this file needs real fixture additions, not just a flow-through connector
change; see D7.

**D7 — `PipelineRunRoutesSpec.scala` fixture additions (resolves round-2 skeptic Change Requests
#1/#2).** Three concrete additions, all following patterns already established elsewhere in this
test suite (no new mechanism invented):
1. Add a `stubConnector`/`RestSuccessUrl`/`RestFailureUrl` trio as private vals near the top of the
   class, copied from `PipelineApplyProposalSpecBase.scala:63-69` verbatim (same shape: `new
   RestApiConnector(Some { config => if (config.url == RestFailureUrl) ... else Future.successful(Right(...)) })`).
2. Add `connector: RestApiConnector = stubConnector` to `makeRoutes`'s parameter list (line 180-189),
   threaded as `PipelineRunService`'s new trailing `connector` argument (D3).
3. Add a `seedDsWithConfig(sourceType: String, config: String): String` helper — `seedDs`'s existing
   body (lines 94-105) parameterized on `config` instead of hardcoding it internally — so a test can
   seed a `rest_api` source with `{"url": "$RestSuccessUrl"}`/`{"url": "$RestFailureUrl"}`, or a `sql`
   source with a config targeting either the file's own already-running `embeddedPostgres` instance
   (reachable — mirrors `SqlConnectorSpec.scala:29-38`'s `liveConfig`: `dialect=postgresql,
   host=localhost, port=embeddedPostgres.getPort, database=postgres, user=postgres,
   password=postgres, query="SELECT 1 AS one"`) or an unreachable `host=localhost, port=1` (mirrors
   `PipelineApplyProposalRollbackSpec.scala:93-99`'s existing "fails fast and deterministically"
   pattern) for the failure case. `PipelineRunRoutesSpec.scala` already constructs its own
   `embeddedPostgres` in `beforeAll` (line 57) — no new embedded-DB instance needed.

Each of the three flagged tests splits into a success case (real row-producing run, `200 OK`) and a
distinct unreachable-source case (renamed to accurately describe a connection/fetch failure, still
`422`) — see tasks.md Section 4 for the exact task breakdown.

**D4 — `SparkUnsupportedKinds` becomes `Set.empty[String]`, not deleted.** `PipelineRunService`
object member and `recordUnrunnable`/`PipelineProposalService`'s guard branch
(`createPipeline`'s `case Right(_) if PipelineRunService.SparkUnsupportedKinds.contains(...)`) stay
in place unmodified — they become unreachable for `rest_api`/`sql` today, but remain the documented
mechanism HEL-755 built for "a kind the engine categorically can't run," ready for a future kind
without new plumbing. Rejected alternative: delete `recordUnrunnable` and the guard entirely — would
discard working, already-reviewed machinery for no benefit, and would need to be rebuilt identically
if a future connector kind (e.g. a streaming source) needs the same treatment.

**D5 — No re-validation of `SqlSource.config.query`'s DDL/DML guardrail in `loadRows`.**
`SqlConnector.checkQuery` already runs once, at source-creation time
(`SourceService.createSql`/`PipelineProposalService`'s inline-sql path) — `SourceService.previewSql`
does not re-check it before calling `SqlConnector.execute`, and `loadRows` follows the same
established precedent rather than introducing a new, inconsistent check at read time.

**D6 — Stale-comment cleanup.** `PipelineProposalService.createPipeline`'s `Right(_)` case comment
("This case only ever reaches `submit` for a kind the engine CAN execute (`static`/`csv`)") and the
class-level doc comment listing `rest_api`/`sql` alongside the rollback exception are updated to
reflect that these two kinds now reach `submit` normally; `SparkUnsupportedKinds`'s own doc comment
is updated to describe the now-empty set as a forward-looking extension point.

## Risks / Trade-offs

- **[Risk]** A `rest_api`/`sql` source with a very large result set now loads entirely into memory
  during a run (same risk profile CSV/static already have) → **Mitigation**: D2's `maxRunRows = 1000`
  cap bounds this; a source that legitimately needs more belongs on a future Spark path (non-goal).
- **[Risk]** `PipelineProposalService`'s HEL-755 "blocked" UX for `rest_api`/`sql` disappears for
  healthy sources — an operator who previously saw "not executed automatically yet" now sees a real
  run outcome → **Mitigation**: this is the intended fix (the ticket's whole point); the fail-safe
  behavior for a genuinely broken source is unchanged, just reached via the ordinary run-failure path
  instead of `recordUnrunnable`.
- **[Trade-off]** In-process execution, not Spark — a `rest_api`/`sql` pipeline's run cost now scales
  with the synchronous HTTP/JDBC round-trip inside the Pekko request path rather than an
  async Spark job → accepted per the ticket's own suggested scope; `SqlConnector.execute` already
  wraps its blocking JDBC work in `scala.concurrent.blocking` (existing discipline, unchanged).

## Planner Notes

- Chose the in-process wiring (not a Spark extension) as the primary implementation per the ticket's
  own stated preference ("for small/interactive runs") and because it reuses fully-built,
  already-tested connector code with no new external dependency.
- Chose `maxRunRows = 1000` (D2) as a self-approved bound — no existing constant fit a "real run" (as
  opposed to a preview/inference sample) exactly; picked a value clearly larger than the 500/100
  precedents to reflect that this is the actual data-producing path, without going unbounded.
