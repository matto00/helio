## 1. Backend: engine wiring

- [x] 1.1 Add `connector: RestApiConnector = null` constructor param to `InProcessPipelineEngine`
      (design.md D3).
- [x] 1.2 Add `PipelineRowJson.jsRowToRow(v: JsValue): Row` helper: `JsObject(fields) =>
      fields.map { case (k, fv) => k -> jsValueToAny(fv) }`, else `Map("value" -> jsValueToAny(v))`
      (design.md D1 — do NOT call `jsValueToAny` directly on a whole row, it is a per-field scalar
      converter and will throw `ClassCastException`).
- [x] 1.3 Add `loadRows` case for `RestSource`: guard `connector == null` with a clear
      `IllegalArgumentException`, else call `connector.fetch(config, maxRunRows)`; on `Right(jsRows)`,
      `jsRows.map(PipelineRowJson.jsRowToRow)`; on `Left(err)`,
      `Future.failed(new IllegalArgumentException(err))` — matching every other `loadRows` case's
      error convention.
- [x] 1.4 Add `loadRows` case for `SqlSource`: call `SqlConnector.fetch(config, maxRunRows)`
      directly (stateless object, no DI, no null guard needed); same `Right`/`Left` handling as 1.3.
- [x] 1.5 Add `private val maxRunRows: Int = 1000` to `InProcessPipelineEngine` (design.md D2).

## 2. Backend: PipelineRunService wiring

- [x] 2.1 Add `connector: RestApiConnector = null` constructor param to `PipelineRunService`;
      construct `InProcessPipelineEngine` with it (`new InProcessPipelineEngine(fileSystem, connector)`).
- [x] 2.2 Remove the `RestSource`/`SqlSource` rejection block in `runPipeline` (currently lines
      166-172) — let the `case _ =>` branch handle every source kind uniformly.
- [x] 2.3 Remove the `RestSource`/`SqlSource` rejection block in `previewStep` (currently lines
      200-205) — same uniform handling.
- [x] 2.4 Change `PipelineRunService.SparkUnsupportedKinds` to `Set.empty[String]`; update its doc
      comment to describe it as a forward-looking extension point (design.md D4).

## 3. Backend: wiring + stale comments

- [x] 3.1 `ApiRoutes.scala`: pass the existing `connector` value into `PipelineRunService`'s
      constructor at its one production call site.
- [x] 3.2 `PipelineProposalService.scala`: update the `createPipeline` `Right(_)` case comment and
      the class-level doc comment that describe `rest_api`/`sql` as reaching `recordUnrunnable` —
      both kinds now reach `submit` normally (design.md D6). No behavioral code change expected here.

## 4. Tests

- [x] 4.1 `InProcessPipelineEngineSpec.scala`: add cases for `loadRows` with a `RestSource` (success,
      connector fetch failure, `connector == null` guard) and a `SqlSource` (success, connector
      failure).
- [x] 4.2 `PipelineRunServiceSpec.scala`: add a full-run test for a `rest_api` base source
      (succeeds, populates output DataType) and a `sql` base source (succeeds); add a run-failure
      test for an unreachable `rest_api`/`sql` source (422, `last_run_status = "failed"`, no
      categorical-rejection message).
- [x] 4.3 `PipelineRunServiceSpec.scala` (or a preview-focused spec): add a `previewStep` test for a
      `rest_api`/`sql` base source succeeding, confirming the prior "unsupported source type for
      preview" rejection no longer fires.
- [x] 4.4 `PipelineProposalService`-covering spec: add/update a test asserting a healthy inline
      `rest_api`/`sql` proposal-apply now returns a non-blocked `run` with a populated output
      DataType (not `recordUnrunnable`'s blocked outcome); add a test confirming a run-time fetch
      failure (not a schema-inference-time failure) still triggers full rollback per the modified
      `pipeline-proposal-apply` spec.
- [x] 4.5 `PipelineApplyProposalRollbackSpec.scala`: update the two existing tests at lines 29-57
      ("create the pipeline and report a blocked run for a healthy inline rest_api source
      (execution-unsupported kind)") and 118-145 ("report a blocked run without rollback for an
      existing-sourceId reference to a healthy pre-existing rest_api source") — both must now assert
      a non-blocked, populated run (`resp.run.blocked shouldBe false`, output DataType populated,
      `latestPipelineRun` status `"succeeded"`), not the old blocked-run outcome. Rename both test
      descriptions to match. Leave the schema-fetch-failure and connection-failure tests in the same
      file (lines 59-116) unchanged — those still exercise a genuinely broken source and still
      report a failed run.
- [x] 4.6 `PipelineRunRoutesSpec.scala` fixture additions (design.md D7): add
      `RestSuccessUrl`/`RestFailureUrl`/`stubConnector` private vals (copied from
      `PipelineApplyProposalSpecBase.scala:63-69`); add `connector: RestApiConnector =
      stubConnector` to `makeRoutes`, threaded into `PipelineRunService`'s new trailing `connector`
      arg; add a `seedDsWithConfig(sourceType: String, config: String): String` helper
      parameterizing the existing `seedDs`'s config instead of hardcoding `"{}"`.
- [x] 4.7 `PipelineRunRoutesSpec.scala`: split the test at lines 222-228 ("POST /pipelines/:id/run
      returns 422 for rest_api source type") into (a) a new test seeding
      `{"url": "$RestSuccessUrl"}` asserting `200 OK` with populated rows, and (b) the existing test
      renamed to "...returns 422 when the rest_api source is unreachable", reseeded with
      `{"url": "$RestFailureUrl"}`.
- [x] 4.8 `PipelineRunRoutesSpec.scala`: split the test at lines 231-237 ("POST /pipelines/:id/run
      returns 422 for sql source type") into (a) a new test seeding a live config against the file's
      own `embeddedPostgres` instance (mirrors `SqlConnectorSpec.scala:29-38`'s `liveConfig`:
      `dialect=postgresql, host=localhost, port=embeddedPostgres.getPort, database=postgres,
      user=postgres, password=postgres, query="SELECT 1 AS one"`) asserting `200 OK` with populated
      rows, and (b) the existing test renamed to "...returns 422 when the sql connection fails",
      reseeded with an unreachable `host=localhost, port=1` (mirrors
      `PipelineApplyProposalRollbackSpec.scala:93-99`'s existing pattern).
- [x] 4.9 `PipelineRunRoutesSpec.scala`: update the preview test at lines 377-387 ("GET
      /pipelines/:id/steps/:stepId/preview returns 422 for rest_api source type") to reseed with
      `{"url": "$RestSuccessUrl"}` and assert `200 OK` with preview rows, not 422.
- [x] 4.10 Run `sbt test` for the full backend suite; confirm no regression in existing
      `static`/`csv`/`text`/`pdf`/`image` execution tests.
