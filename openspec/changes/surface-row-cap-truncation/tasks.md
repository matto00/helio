## 1. Connector SPI

- [x] 1.1 Add `final case class FetchOutcome(rows: Vector[JsValue], truncated: Boolean, availableRowCount: Option[Long])` to `backend/src/main/scala/com/helio/domain/connectors/ConnectorDriver.scala`, with a scaladoc stating that `truncated` and `availableRowCount` are independent and that `availableRowCount` is populated only when actually observed (never from a saturation heuristic).
- [x] 1.2 Change `ConnectorDriver.fetch` to return `Future[Either[String, FetchOutcome]]` (design D1). Update the trait scaladoc.
- [x] 1.3 `RestApiConnectorDriver.fetch` (line ~342): compute the full row vector once, then return `FetchOutcome(all.take(maxRows), truncated = all.size > maxRows, availableRowCount = Some(all.size.toLong))`. Strictly `>`, per design D2 — exactly `maxRows` rows is NOT truncated.
- [x] 1.4 `SqlConnectorDriver.fetch` (line ~149): call `execute(config, maxRows + 1)`, return `FetchOutcome(toRows(rows).take(maxRows), truncated = rows.size > maxRows, availableRowCount = None)` (design D3). Do NOT change `execute` itself — its `inferSchema` (100) and `previewSql` (10) callers must keep current behaviour.
- [x] 1.5 Update the **three test fixtures that implement `ConnectorDriver` and define `fetch`** — `RowSupplyingConnector` (`NewConnectorInferenceSpec.scala:25`, fetch `:37`), `FixtureConnector` (`ConnectorSpec.scala:19`, fetch `:36`), `EnvelopeFixtureConnector` (`CreateSourceEnvelopeSpec.scala:31`, fetch `:43`). These are implementations, not call sites — update them deliberately to return a correct `FetchOutcome`, do not patch them into compiling.
- [x] 1.6 Update the existing `fetch` **call sites** in backend tests to the new return type. Do not weaken any existing assertion while doing so.

## 2. Engine and run service

- [x] 2.1 Add `final case class SourceReadStats(truncated: Boolean, availableRowCount: Option[Long])` and `loadRowsWithStats(ds, dataSourceRepo): Future[(Seq[Row], SourceReadStats)]` to `InProcessPipelineEngine`, holding the existing per-kind dispatch. Redefine `loadRows` as `loadRowsWithStats(...).map(_._1)` so its signature and every existing caller (including the join right-source re-entry at line ~200) are unchanged (design D5).
- [x] 2.2 Uncapped kinds (static, CSV, text, PDF, image) return `SourceReadStats(false, None)`; the REST and SQL arms map their `FetchOutcome` into it.
- [x] 2.2a Add a `truncationSink` as a **new defaulted caller-supplied parameter on `executeWithStepCounts`** (`InProcessPipelineEngine.scala:87`), mirroring the existing `assertionSink: AssertionSink = new AssertionSink` exactly, including guarding its mutable state with `synchronized` as `AssertionSink` does.
- [x] 2.2b Route `makeContext`'s `loadSource` (line ~200) through `loadRowsWithStats` and append any truncated read to that sink (design D8). This single choke point covers `JoinStep.scala:57`, `UnionStep.scala:71` and `LookupStep.scala:88` — all three re-enter the same capped read.
- [x] 2.2c **Both** `PipelineRunService` sites must construct a sink, pass it, and merge it with the primary read's stats: the real-run site (`loadRows` at `:365`, `executeWithStepCounts` at `:367`, which already passes an `assertionSink`) **and the step-preview site (`:205`, which today passes no sink at all)**. A defaulted parameter the preview site forgets to pass yields a false `sourceTruncated: false` in preview — the exact failure this change exists to prevent, and required by the spec's step-preview clause. Verified by task 7.6c.
- [x] 2.3 Verify `maxRunRows` is still exactly `1000` and its docblock is unchanged apart from any added reference to the new reporting.
- [x] 2.4 Introduce `object InProcessPipelineEngine { val MaxRunRows: Int = 1000 }` and have the instance `private val maxRunRows` refer to it, so the value is still defined exactly once (design D9). An instance-only accessor is NOT sufficient: `CreateSourceEnvelope.build` has no engine reference and no way to obtain one, and would be pushed toward a hardcoded `1000` that design D4 and the capability spec both forbid.

## 3. Run-result wire shape and the notice

- [x] 3.1 Add `sourceTruncated: Boolean = false`, `sourceAvailableRowCount: Option[Long] = None`, `truncationNotice: Option[String] = None`, `truncatedReads: Vector[TruncatedReadResponse] = Vector.empty` to `RunResultResponse` (`PipelineProtocol.scala:95`) plus the new `TruncatedReadResponse(dataSourceName, rowsRead, availableRowCount)` and its format. **Declare `truncatedReadResponseFormat` ABOVE `runResultResponseFormat`** — implicit `val` formats in a spray-json protocol trait initialize in declaration order, so declaring it after line ~153 compiles but yields a `null` implicit at runtime. Bump `jsonFormat7` → `jsonFormat11` at line ~153. Keep `sourceRowCount`'s meaning unchanged. Scaladoc must state that `sourceTruncated` is run-wide while `sourceAvailableRowCount` is primary-source-only.
- [x] 3.1a Dedupe `truncatedReads` by data source when composing, so two steps reading the same truncated secondary source produce one entry and the notice names it once.
- [x] 3.2 Add a single composer (one function, one place) producing the notice strings verbatim as written in design D4 — known-total, unknown-total, and the multi-source branch that names each truncated source — interpolating the cap from task 2.4. Returns `None` when nothing was truncated.
- [x] 3.3 Populate the four new fields in `PipelineRunService` at the real-run site (line ~365/~425) and the step-preview site (line ~203-212), switching both to `loadRowsWithStats`.
- [x] 3.4 Confirm `PipelineProposalProtocol`'s embedded `run: RunResultResponse` still compiles and serialises (it reuses this format). This is also what makes the MCP `apply_pipeline_proposal`/`apply_proposal` responses carry the notice.
- [x] 3.5 Leave `PipelineRunService.scala:135` (`recordUnrunnable`) on the defaults — no source read occurred, so `sourceTruncated = false` is correct there. Add a one-line comment saying so.

## 4. MCP surface

- [x] 4.1 `helio-mcp/src/types.ts` (~line 334): add `sourceTruncated?`, `sourceAvailableRowCount?`, `truncationNotice?` to `RunResultResponse`.
- [x] 4.2 `helio-mcp/src/helioApi.ts`: add `truncated`, `availableRowCount`, `truncationNotice` to `RunOutcome` (~line 88) and map them in `runPipeline` (~line 561). `truncated` must default to `false`, never `undefined`, so a truncated run is never indistinguishable from a missing field.
- [x] 4.3 `helio-mcp/src/tools/write.ts`: update the `run_pipeline` tool description (~line 366-370) — it currently promises `{ status, rowCount, outputDataTypeId }`. It must describe the truncation fields and must not promise an unqualified complete row count.
- [x] 4.4 Add a test asserting the MCP `run_pipeline` result for a truncated run is **content-distinguishable** from a complete one: assert the actual notice text and the available count, not merely that a boolean key is present.

## 5. UI surface

- [x] 5.1 `frontend/src/features/pipelines/services/pipelineService.ts` (~line 141): add the three fields to `RunResult`.
- [x] 5.2 `frontend/src/features/pipelines/state/pipelinesSlice.ts`: add `runSourceTruncated`, `runSourceAvailableRowCount`, `runTruncationNotice` to state (~line 98), the thunk result type (~line 235) and the reducer (~line 488). Reset them alongside the existing run state.
- [x] 5.3 Render a truncation warning on the pipeline detail page, shown only when `runSourceTruncated` is true, rendering `runTruncationNotice` verbatim (design D7). Follow `DESIGN.md` tokens/spacing — there is no shared warning/banner primitive in `frontend/src/shared/ui/` (`Toast` is transient, `StatusChip` is a pill), so build a page-local warning region on `PipelineDetailPage` using the `--app-warning` / `--app-warning-surface` tokens per DESIGN.md rather than adding a new shared primitive. Note `runSourceRowCount` is currently a dead destructure at `PipelineDetailPage.tsx:70`; this gives it a render surface.
- [x] 5.4 Test that the banner renders the notice content after a truncated run and is absent after a complete one. Assert on the rendered text (the counts), not on the presence of a test id.

## 6. Source creation advisory

- [x] 6.1 Add `rowCapNotice: Option[String] = None` to `CreateSourceResponse` (`DataSourceProtocol.scala:178`) and bump its format `jsonFormat3` → `jsonFormat4` (`DataSourceProtocol.scala:465`).
- [x] 6.2 Add a defaulted `observedRowCount: Option[Long] = None` to `InferredSchema` (`model.scala:628`). It has 11 construction sites and no spray-json format of its own (the wire type is the separate `InferredSchemaResponse`), so the defaulted field is additive.
- [x] 6.3 `RestApiConnectorDriver.inferSchema` (~line 334) populates `observedRowCount` from the row vector it already materializes and currently discards. Note it does not construct the `InferredSchema` itself — it delegates to `SchemaInferenceEngine.inferSchemaFromRows` — so this is a `.copy(observedRowCount = Some(size))` on the returned schema, not a restructuring of the facade call. `SqlConnectorDriver.inferSchema` leaves it `None` (it samples at most 100 rows and cannot know the total).
- [x] 6.4 `CreateSourceEnvelope.build` composes `rowCapNotice` generically from `observedRowCount` when it exceeds `InProcessPipelineEngine.MaxRunRows` (read that symbol directly — see task 2.4; never a literal `1000`). **No second fetch** — if the implementation finds itself issuing another request, the design is being violated. Leave `SourceService` free of any connector-specific branch for this.

## 7. Verification

- [x] 7.1 Backend test: REST source of 3303 rows → run result has `sourceTruncated: true`, `sourceAvailableRowCount: 3303`, `sourceRowCount: 1000`, and a notice naming both 1000 and 3303. Assert the numbers appear in the notice text.
- [x] 7.2 Backend test: source of exactly 1000 rows → `sourceTruncated: false` (the no-false-positives case). This test must fail if `>` is changed to `>=`.
- [x] 7.3 Backend test: SQL source with more rows than the cap → `truncated: true`, `availableRowCount: None`, exactly `maxRows` rows returned, and a notice that states the total is not known and names no total.
- [x] 7.4 Backend test: an uncapped kind (static or CSV) → `sourceTruncated: false`.
- [x] 7.5 Assert `maxRunRows == 1000` explicitly so a future change to the bound is caught.
- [x] 7.6c Backend test: the **step-preview** path over a truncated secondary source → `sourceTruncated: true`. This is a separate test from 7.6b on purpose: the preview site takes a different code path that today passes no sink, and 7.6b would stay green while preview shipped a false `false`.
- [x] 7.6a Backend test: REST source create whose inference observes more rows than the cap → `rowCapNotice` present and naming both the observed count and the cap; a REST create under the cap → absent; a SQL create → absent. Assert the notice text content, not key presence.
- [x] 7.6b Backend test: a `union` (or `join`/`lookup`) step over a secondary source larger than the cap, with a primary source UNDER the cap → `sourceTruncated: true` and a `truncatedReads` entry naming that secondary source. This test must fail if the accumulator from task 2.2a is dropped.
- [x] 7.6 Run the full gates: `sbt test`, `npm test`, `npm run lint`, `npm run typecheck`, plus `helio-mcp` typecheck. Note `helio-mcp` has no `test` script of its own, but the root `jest.config.cjs` already collects `helio-mcp/src/**/*.test.ts` — do not add a redundant runner.
- [x] 7.7 Capture red-on-revert evidence against the FINAL committed tests: revert the production change only (keep the tests), re-run, and record the failures. If any test changes afterwards, recapture — stale evidence does not count.
- [x] 7.8 Write `files-modified.md` with exactly one full path per `^-` bullet, in a single backtick-quoted path per bullet.
