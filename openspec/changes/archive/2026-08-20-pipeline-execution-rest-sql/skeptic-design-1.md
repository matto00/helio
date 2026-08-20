## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/pipeline-run-execution/spec.md`, `specs/pipeline-proposal-apply/spec.md`) in full.
- Cross-checked design.md's ground-truth citations against the actual code:
  - `PipelineRunService.scala:151-183` (`runPipeline`) and `:188-233` (`previewStep`) — confirmed
    the `RestSource`/`SqlSource` rejection blocks exist as described (design.md's cited line ranges
    are close; actual `case _: RestSource | _: SqlSource =>` arms are at 168-172 and 201-205).
  - `InProcessPipelineEngine.scala:57-112` (`loadRows`) — confirmed no `RestSource`/`SqlSource` case
    exists today; matches design.md's description exactly.
  - `Connector.scala:102`, `RestApiConnector.scala:143-144`, `SqlConnector.scala:152-154` — confirmed
    both connectors expose `fetch(config, maxRows)(implicit ec): Future[Either[String, Vector[JsValue]]]`
    as design.md claims, and confirmed `fetch`'s docstring guarantee ("one `JsObject` per row").
  - `ApiRoutes.scala:33,181,189,203-207` — confirmed `connector: RestApiConnector` is already a field
    threaded into `sourceService`/`pipelineService`, and `PipelineRunService`'s one production
    construction site (203-207) is exactly where D3 says to thread it.
  - `PipelineRunService.scala:710` (`SparkUnsupportedKinds: Set[String] = Set(DataSourceKind.RestApi,
    DataSourceKind.Sql)`) and `PipelineProposalService.scala:337,345` (`createPipeline`'s guard +
    `recordUnrunnable`) — confirmed the D4 claim; grepped the whole backend, these are the only two
    reference sites.
  - `DataSourceService.scala:61` (`staticMaxRows = 500`) and `SqlConnector.scala:149-150`
    (`inferSchema`'s `maxRows = 100`) — confirmed D2's cited precedents are accurate.
  - `SourceService.scala:189-203` (`previewSql`) — confirmed D5's claim that it calls
    `SqlConnector.execute` without a `checkQuery` re-check.
  - Grepped every `new PipelineRunService(` construction site (`ApiRoutes.scala` + 8 test files) —
    matches D3's "8 existing test files" claim exactly.
- Read `PipelineRowJson.scala` in full (the `jsValueToAny`/`anyToJsValue`/`Row` type definitions) to
  check D1's conversion pseudocode against ground truth — this is where I found the blocking issue
  below (#1).
- Grepped the whole backend test suite for pre-existing assertions tied to the rejection/blocked
  behavior this change removes/changes (`grep -rln "Unsupported source type\|SparkUnsupportedKinds\|
  recordUnrunnable\|blockedReason" backend/src/test/scala`) and read the matching test bodies in full
  — this is where I found issues #2 and #3 below.

### Verdict: REFUTE

### Change Requests

1. **D1's row-conversion pseudocode is broken and will throw at runtime for every REST/SQL row —
   not an edge case, the general case.** `design.md` D1 (and `tasks.md` task 1.2/1.3) specify: on a
   successful fetch, `rows.map(PipelineRowJson.jsValueToAny(_).asInstanceOf[Row])`. But
   `PipelineRowJson.jsValueToAny(v: JsValue): Any` (`PipelineRowJson.scala:53-59`) is a *per-scalar-
   field* converter (`JsNull`→`null`, `JsBoolean`→`Boolean`, `JsNumber`→`Double`, `JsString`→`String`,
   and critically `case other => other.compactPrint` for anything else, including `JsObject`) — it
   never produces a `Map`. Both connectors' `fetch` return `Vector[JsValue]` where each element is a
   `JsObject` (one object per row, per `Connector.scala:101`'s docstring and `RestApiConnector.toRows`/
   `SqlConnector.toRows`'s implementations) — so `jsValueToAny(aJsObjectRow)` falls into the
   `case other => other.compactPrint` branch and returns a `String` (the compact JSON text), not a
   `Map[String, Any]`. `.asInstanceOf[Row]` (`Row = Map[String, Any]`, `PipelineRowJson.scala:16`) on
   a `String` is not a no-op cast under erasure — `Map` is a real runtime trait check — so this throws
   `ClassCastException: java.lang.String cannot be cast to scala.collection.Map` for every row, every
   time, for both `RestSource` and `SqlSource`. (Confirmed there is no existing precedent for
   `JsObject`→`Row` conversion anywhere in the codebase to fall back on — `parseStaticRows`'s columnar
   zip is a different shape, and `ComputeStep.scala:66`'s use of `jsValueToAny` is per-scalar-field,
   consistent with my reading of the intended contract.) **Required revision**: D1 needs a correct
   conversion — e.g. a new `PipelineRowJson` helper such as `def jsObjectToRow(obj: JsObject): Row =
   obj.fields.map { case (k, v) => k -> jsValueToAny(v) }`, then `rows.map { case o: JsObject =>
   jsObjectToRow(o) }` (with an explicit `case other => Future.failed(...)` for the (rare, but per
   `RestApiConnector.toRows`, possible) non-object top-level JSON shape). Update tasks.md 1.2/1.3
   accordingly. This is the ticket's core execution mechanism — as written it does not work at all,
   not even for the "happy path" scenarios the spec deltas require.

2. **Two existing tests in `PipelineApplyProposalRollbackSpec.scala` assert the exact old behavior
   this change's own spec delta requires to change, and neither design.md's Impact section nor
   tasks.md's test tasks (Section 4) name them.** `PipelineApplyProposalRollbackSpec.scala:29-57`
   (`"create the pipeline and report a blocked run for a healthy inline rest_api source
   (execution-unsupported kind)"`) and `:118-145` (`"report a blocked run without rollback for an
   existing-sourceId reference to a healthy pre-existing rest_api source"`) both construct a healthy,
   reachable `rest_api` source (`RestSuccessUrl`) and assert `resp.run.blocked shouldBe true` /
   `blockedReason.get should include("executed automatically yet")`. These are precisely the baseline
   spec's "Scenario: An execution-unsupported source kind does not roll back"
   (`openspec/specs/pipeline-proposal-apply/spec.md:89-95`) — the exact scenario the change's own
   `specs/pipeline-proposal-apply/spec.md` MODIFIED-requirements delta redefines (new required
   outcome: `201 Created`, `run` that is **not** `blocked`, output DataType populated with real rows).
   These two tests' entire premise — title and body — becomes false once this ticket ships; they are
   not something you can "add/update a test" around (tasks.md 4.4's phrasing) without naming them —
   they must be rewritten (new title, new assertions: `blocked shouldBe false`, populated
   `outputDataType`/rows, real `pipeline_runs` row with `status = "succeeded"`). design.md's `Impact`
   section lists `PipelineRunService.scala`/`InProcessPipelineEngine.scala`/`ApiRoutes.scala`/
   `PipelineProposalService.scala` but never mentions `PipelineApplyProposalRollbackSpec.scala` at all.
   **Required revision**: add `PipelineApplyProposalRollbackSpec.scala` to design.md's Impact section,
   and revise tasks.md 4.4 to explicitly name these two tests and describe what changes about each
   (not just "add/update a test").

3. **`PipelineRunRoutesSpec.scala:377-387` asserts the exact rejection message task 2.3 deletes, and
   is not named anywhere in design.md or tasks.md's test plan.** The existing test `"GET
   /pipelines/:id/steps/:stepId/preview returns 422 for rest_api source type"` seeds a bare `rest_api`
   data source (`seedDs("rest_api")`, config `"{}"`) and asserts `resp.message should include
   ("Unsupported source type")`. Task 2.3 deletes the code path producing that exact message. Whatever
   this test does after the change (its `makeRoutes` helper, `PipelineRunRoutesSpec.scala:180-200`,
   never constructs `PipelineRunService` with a `connector` argument, so it would default to `null` per
   D3, and its seeded config `"{}"` has no `url` field besides), it will not produce a message
   containing "Unsupported source type" — this test will fail post-change. Neither design.md's Impact
   section nor tasks.md's Section 4 (which only names `InProcessPipelineEngineSpec.scala` and
   `PipelineRunServiceSpec.scala`) accounts for this file. **Required revision**: add
   `PipelineRunRoutesSpec.scala` to design.md's Impact section and tasks.md Section 4, and specify what
   this test should become — either seed a real reachable REST target and assert success, or (if this
   route-level spec isn't wired for a real HTTP target) explicitly assert the new null-connector-guard
   failure message and adjust the test name to stop claiming "unsupported source type".

### Non-blocking notes

- The design's own null-connector guard message design ("a `null` connector attempting to execute one
  of these kinds fails fast with a `NullPointerException`-turned-`IllegalArgumentException` guard...
  giving a clear signal") is sound in principle and well-reasoned — once #3 above is resolved, the
  actual guard message just needs to be decided and reflected in whichever test exercises it.
- D2's `maxRunRows = 1000` bound and its precedent citations (`staticMaxRows = 500`,
  `SqlConnector.inferSchema`'s `maxRows = 100`) check out exactly against the code; no issue there.
- D6's stale-comment cleanup targets in `PipelineProposalService.scala` are accurately scoped and
  don't need revision.
