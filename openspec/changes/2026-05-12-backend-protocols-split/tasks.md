# Tasks — backend-protocols-split

## 1. Scaffolding

- [x] 1.1 Create directory `backend/src/main/scala/com/helio/api/protocols/`
- [x] 1.2 Add `IdParsing.scala` with `PathMatcher1[T]` segments for all six ID wrappers (`DashboardId`, `PanelId`, `DataTypeId`, `DataSourceId`, `PipelineId`, `UserId`)

## 2. Per-domain protocol files

For each of the 8 domain traits, create the file with:

- (a) case classes for all request / response types in that domain
- (b) companion `object` blocks (e.g., `fromDomain`) co-located with the case class
- (c) a `trait XxxProtocol extends SprayJsonSupport with DefaultJsonProtocol` containing only that domain's `implicit val ...Format` definitions

- [x] 2.1 `ResourceProtocol.scala` — `ResourceMetaResponse`, `ErrorResponse`, `HealthResponse`
- [x] 2.2 `AuthProtocol.scala` — auth/user/google-oauth/preferences types
- [x] 2.3 `DashboardProtocol.scala` — dashboard request/response/snapshot/layout types
- [x] 2.4 `PanelProtocol.scala` — panel request/response, `PanelQuery`, chart-appearance, `PanelAppearancePayload`, batch types, custom `UpdatePanelRequest` formatter
- [x] 2.5 `DataTypeProtocol.scala` — datatype/field/computed-field/schema types
- [x] 2.6 `DataSourceProtocol.scala` — datasource + REST/SQL/CSV/static connector types
- [x] 2.7 `PipelineProtocol.scala` — pipeline summary/step/analyze/run-record/run-status/run-result types
- [x] 2.8 `PermissionProtocol.scala` — permission grant/response types

## 3. Aggregator collapse

- [x] 3.1 Reduce `JsonProtocols.scala` to a 60–80 line aggregator that mixes in every per-domain trait
- [x] 3.2 Document inter-trait dependency: `DashboardProtocol extends PanelProtocol` (snapshot uses `PanelAppearancePayload`) — add a one-line comment in the aggregator explaining the ordering constraint
- [x] 3.3 Verify zero `implicit val ...Format` definitions remain in `JsonProtocols.scala`

## 4. ID-wrapper boundary demonstration

- [x] 4.1 In `DashboardRoutes.scala`, replace every `path(Segment) { dashboardId =>` and `path(Segment / "subroute")` with `path(DashboardIdSegment) { dashboardId =>` (the binding becomes `DashboardId`)
- [x] 4.2 Remove now-redundant `DashboardId(...)` wraps inside the handler bodies and in any repository call site that was wrapping at the inner layer
- [x] 4.3 Same treatment for `PanelRoutes.scala` with `PanelIdSegment`
- [x] 4.4 Inventory remaining route files that still pass raw `String` IDs (note in evaluation report — handled in CS2)

## 5. Schema-drift checker

- [x] 5.1 Update `scripts/check-schema-drift.mjs` to read both `JsonProtocols.scala` (aggregator) and every `*.scala` under `api/protocols/`
- [x] 5.2 Add a duplicate-class-name guard that throws if the same `case class Name` appears in two files
- [x] 5.3 Verify `npm run check:schemas` passes against the new layout

## 6. Aggregator-regression test

- [x] 6.1 Add `backend/src/test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala`
- [x] 6.2 In one ScalaTest spec extending `JsonProtocols`, round-trip a representative instance of each top-level response type through `.toJson` and `.convertTo[T]`. Cover at minimum: `DashboardResponse`, `PanelResponse`, `DataSourceResponse`, `DataTypeResponse`, `PipelineSummaryResponse`, `RunResultResponse`, `RunStatusResponse`, `AuthResponse`, `PermissionResponse`, `DashboardSnapshotPayload`
- [x] 6.3 The spec asserts `roundTripped == original` for every type and that no `DeserializationException` is thrown

## 7. Verification gates

- [x] 7.1 `sbt test` passes (must remain 495 tests; new aggregator test adds 1, so 496 total). Actual: 506 tests pass.
- [x] 7.2 `npm run check:schemas` passes
- [x] 7.3 `npm run check:openspec` passes
- [x] 7.4 `npm run lint`, `npm run format:check` pass (touched files: schema script only on the frontend side)
- [x] 7.5 `npm test` (frontend Jest) passes — no frontend code touched, but pre-commit runs it
- [x] 7.6 No per-domain file exceeds 250 lines (use `wc -l` to verify) — max is PanelProtocol at 211 lines
- [x] 7.7 `JsonProtocols.scala` ≤ 80 lines — 34 lines

## 8. Smoke validation

- [x] 8.1 Start backend (`sbt run`) — backend reaches "Server started" without compile errors
- [x] 8.2 `curl http://localhost:8080/health` returns `{"status":"ok"}`
- [x] 8.3 Stop backend cleanly

## 9. Commit / PR

- [x] 9.1 Commit on branch `task/backend-protocols-split/HEL-236` with message:
  ```
  HEL-236 Split JsonProtocols into per-domain traits (CS1)
  ```
- [ ] 9.2 Push branch and open PR titled `HEL-236 CS1: backend protocols split` linked to the OpenSpec change (orchestrator handles push + PR)
- [ ] 9.3 PR description includes: before/after line counts, list of inter-trait dependencies surfaced, ID-wrapper inventory for CS2 (orchestrator handles)
