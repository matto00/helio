## 1. Backend: Repository

- [x] 1.1 Add `MetricRepository.findAll(user, page): Future[PagedResult[MetricDefinition]]` (DB-level count + drop/take, mirroring `DataTypeRepository.findAll`)

## 2. Backend: Wire protocols

- [x] 2.1 Add `CreateMetricRequest` case class + formatter to `MetricProtocol.scala`
- [x] 2.2 Add `UpdateMetricRequest` (absent-vs-null `Patch`, `MetricPanelConfig.Patch.decode`-style: `name`/`measureField`/`aggregation`/`allowedDimensions`/`deprecated` as `Option[X]`, `description`/`format` as `Option[Option[X]]`) + custom `RootJsonFormat` to `MetricProtocol.scala`
- [x] 2.3 Add `PagedResult[MetricResponse]` implicit format to `PaginationProtocol.scala`
- [x] 2.4 Add `MetricIdSegment` to `IdParsing.scala`
- [x] 2.5 Wire new formats into `JsonProtocols.scala`

## 3. Backend: Service

- [x] 3.1 Add `MetricService` (`backend/src/main/scala/com/helio/services/`) composing `MetricRepository` + `DataTypeRepository`
- [x] 3.2 Implement `findAll(user, page)`, `findById(id, user)` (404 on not-found/not-owned)
- [x] 3.3 Implement `create(req, user)`: trim/validate `name`; resolve `dataTypeId` via `dataTypeRepo.findByIdOwned`, reject `None` or `sourceId.isDefined` with `ServiceError.UnprocessableEntity`; validate `measureField`/`allowedDimensions` against `dt.fields.map(_.name).toSet`; validate `aggregation` against `MetricAggregation.values`
- [x] 3.4 Implement `update(id, patch, user)`: load existing (404 if missing/not-owned), merge patch fields, re-run the same validation as create against the merged result
- [x] 3.5 Implement `delete(id, user)`: 404 if missing/not-owned, else delete
- [x] 3.6 Add metric normalization/validation helpers to `RequestValidation` (name trim/non-empty check reused by create+update)

## 4. Backend: Routes

- [x] 4.1 Add `MetricRoutes` (`GET/POST /api/metrics`, `GET/PATCH/DELETE /api/metrics/:id`), mirroring `DataTypeRoutes`/`AlertRuleRoutes` thin-shell shape, using `ServiceResponse.run`/`runNoContent`
- [x] 4.2 Wire `MetricService` + `MetricRoutes` into `ApiRoutes.scala`

## 5. Schemas

- [x] 5.1 Add `schemas/metric.schema.json`
- [x] 5.2 Add `schemas/create-metric-request.schema.json`
- [x] 5.3 Add `schemas/update-metric-request.schema.json` (document the whole-object `format` replace-or-clear semantics; no deep merge)

## 6. Tests

- [x] 6.1 `MetricRoutesSpec`: happy path for all five endpoints (list/create/get/patch/delete), including pagination envelope shape
- [x] 6.2 `MetricRoutesSpec`: reject create/update with non-owned or non-pipeline-output `dataTypeId` (422)
- [x] 6.3 `MetricRoutesSpec`: reject create/update with `measureField`/`allowedDimensions` not in the DataType's fields (422)
- [x] 6.4 `MetricRoutesSpec`: reject create/update with `aggregation` outside the allow-list (422)
- [x] 6.5 `MetricRoutesSpec`: reject create with empty `name` (400)
- [x] 6.6 `MetricRoutesSpec`: PATCH absent-vs-null semantics (`description`/`format` clear-on-null, unchanged-on-absent)
- [x] 6.7 `MetricRoutesSpec`: 404 for get/patch/delete on another owner's metric
- [x] 6.8 `MetricRepositorySpec`: extend with `findAll` pagination coverage (offset/limit, total count, owner-scoping)
- [x] 6.9 `sbt test` passes
