## Why

HEL-446 (418-A) landed the `MetricDefinition` model, `metrics` table, and `MetricRepository`, but
nothing can create, list, or edit a metric yet. The rest of the Semantic/Metric Layer epic
(panel binding 418-C, MCP tools 418-D, agent grounding 418-E, authoring UI 418-F) all depend on a
REST surface existing first.

## What Changes

- Add `MetricService` (`backend/src/main/scala/com/helio/services/`): create/update validation
  (name non-empty; `dataTypeId` resolves to a caller-owned pipeline-output DataType, i.e.
  `sourceId == None`; `measureField` + every `allowedDimensions` entry are columns of that
  DataType; `aggregation` in `MetricAggregation.values`), plus owner-scoped read/delete.
- Extend `MetricRepository` (418-A) with a paginated `findAll(user, page): Future[PagedResult[MetricDefinition]]`
  query (DB-level count + slice, mirroring `DataTypeRepository.findAll`) — `listByOwner` did not
  page and the ticket requires the existing `PaginatedQueryResult` envelope.
- Add `MetricRoutes` (`GET/POST /api/metrics`, `GET/PATCH/DELETE /api/metrics/:id`), composed into
  `ApiRoutes.scala`, following the `DataTypeRoutes`/`AlertRuleRoutes` thin-shell shape.
- Add `CreateMetricRequest`/`UpdateMetricRequest`/`MetricResponse` wire types in
  `backend/src/main/scala/com/helio/api/protocols/`, formatters in `JsonProtocols.scala`. `PATCH`
  uses an absent-vs-null `Patch` decoded from raw `JsObject`, mirroring
  `MetricPanelConfig.Patch.decode`, for `description`/`format` (nullable) — `name`,
  `measureField`, `aggregation`, `allowedDimensions`, `deprecated` are plain `Option[X]` (absent =
  unchanged; present = replace; not independently nullable).
- Extend `RequestValidation` with metric normalization/validation helpers (trim `name`, validate
  `aggregation`).
- Add `create-metric-request`, `update-metric-request`, and `metric` JSON Schemas under `schemas/`.
- No FQNs inlined in Scala.

## Capabilities

### New Capabilities

- `metric-crud-api`: `MetricService` + `MetricRoutes` — the five REST endpoints, their validation
  rules, and the pagination/patch wire contract.

### Modified Capabilities

(none — `metric-definition-persistence` (HEL-446) gains a new repository method but no requirement
changes to its existing behavior; the new pagination method is new capability surface, not a
change to a documented requirement.)

## Impact

- New: `MetricService.scala`, `MetricRoutes.scala`, `MetricRequestProtocol.scala` (or similar),
  three schema files.
- Modified: `MetricRepository.scala` (+`findAll`), `RequestValidation.scala`, `JsonProtocols.scala`,
  `ApiRoutes.scala`, `IdParsing.scala` (+`MetricIdSegment`).
- No migration, no frontend change (authoring UI is 418-F, out of scope here).
