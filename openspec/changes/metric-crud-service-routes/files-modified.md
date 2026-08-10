## Files modified

- `backend/src/main/scala/com/helio/infrastructure/MetricRepository.scala` — add `findAll(ownerId, page): Future[PagedResult[MetricDefinition]]` (DB-level count + drop/take, mirroring `DataTypeRepository.findAll`); update module scaladoc (CRUD service/routes now exist)
- `backend/src/main/scala/com/helio/api/protocols/MetricProtocol.scala` — add `CreateMetricRequest`/`UpdateMetricRequest` case classes + `createMetricRequestFormat` (macro-derived) + `updateMetricRequestFormat` (hand-rolled absent-vs-null `RootJsonFormat`, mirroring `MetricPanelConfig.Patch.decode`/`PanelProtocol.updatePanelRequestFormat`)
- `backend/src/main/scala/com/helio/api/protocols/PaginationProtocol.scala` — mix in `MetricProtocol`; add `pagedMetricsFormat: RootJsonFormat[PagedResult[MetricResponse]]`
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — add `MetricIdSegment` path matcher
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — doc-comment update noting `PaginationProtocol`'s new `MetricProtocol` dependency (no formatter changes; `MetricProtocol` was already mixed in from HEL-446)
- `backend/src/main/scala/com/helio/api/package.scala` — re-export `MetricResponse`/`CreateMetricRequest`/`UpdateMetricRequest` into `com.helio.api` (needed by `MetricRoutes`'s `import com.helio.api._`)
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — add `validateMetricName` (shared trim/non-empty check for create+update)
- `backend/src/main/scala/com/helio/services/MetricService.scala` (new) — business logic for `/api/metrics`: create/update validation (name non-empty, `dataTypeId` → caller-owned pipeline-output DataType, `measureField`/`allowedDimensions` membership, `aggregation` allow-list), owner-scoped read/delete
- `backend/src/main/scala/com/helio/api/routes/MetricRoutes.scala` (new) — thin HTTP shell for `GET/POST /api/metrics`, `GET/PATCH/DELETE /api/metrics/:id`, mirroring `DataTypeRoutes`/`AlertRuleRoutes`
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — nullable-optional `metricRepo` constructor param (mirrors `alertRuleRepo`/`pipelineScheduleRepo`); `metricServiceOpt`; mount `/api/metrics` routes
- `backend/src/main/scala/com/helio/app/Main.scala` — construct `MetricRepository` and pass it into `ApiRoutes`
- `schemas/metric.schema.json` (new) — `MetricResponse` wire schema
- `schemas/create-metric-request.schema.json` (new) — `CreateMetricRequest` wire schema
- `schemas/update-metric-request.schema.json` (new) — `UpdateMetricRequest` wire schema, documents whole-object `format` replace-or-clear (no deep merge)
- `backend/src/test/scala/com/helio/infrastructure/MetricRepositorySpec.scala` — extend with `findAll` pagination coverage (offset/limit paging, owner-scoping, empty-page total); widen `newMetric` helper to accept an explicit `createdAt` for deterministic ordering assertions
- `backend/src/test/scala/com/helio/api/routes/MetricRoutesSpec.scala` (new) — HTTP-layer coverage: happy path for all five endpoints + pagination envelope, each create/update validation rejection (dataTypeId ownership/shape, measureField/allowedDimensions membership, aggregation allow-list, empty name), PATCH absent-vs-null semantics (`description`/`format`), cross-user 404s
