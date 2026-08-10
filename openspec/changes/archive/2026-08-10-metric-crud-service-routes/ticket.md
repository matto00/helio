# HEL-493: Metric CRUD service + REST routes

## Description

418-A (HEL-446) lands the `MetricDefinition` domain model, `metrics` table, and `MetricRepository`. This ticket exposes metrics over REST so the frontend, the MCP surface (418-D), and the agent can manage them. It follows the thin-route + service split the codebase already uses (e.g. `PipelineService`/`PipelineRoutes`, `DataTypeService`/`DataTypeRoutes`), with inputs normalized by `RequestValidation`.

## Scope

* Service: `MetricService` (`backend/src/main/scala/com/helio/services/`) composing `MetricRepository` (from 418-A) and `DataTypeRepository`. On create/update it validates: `name` non-empty; the bound `dataTypeId` resolves to a caller-owned pipeline-output DataType (`sourceId == None`, the V41 rule — reuse the check pattern in `DashboardProposalService.preValidateBindings`); `measureField` and every `allowedDimensions` entry exist in that DataType's fields; `aggregation` in the allow-list. Returns `ServiceError` values consistent with the existing services.
* Routes: `MetricRoutes` (`backend/src/main/scala/com/helio/api/routes/`) — `GET /api/metrics`, `POST /api/metrics`, `GET /api/metrics/:id`, `PATCH /api/metrics/:id`, `DELETE /api/metrics/:id` — composed into `ApiRoutes.scala`. Request/response protocols in `backend/src/main/scala/com/helio/api/protocols/` + formatters in `JsonProtocols.scala`.
* Validation: extend `RequestValidation` with metric-shape normalization/validation helpers.
* Schemas: add `create-metric-request`, `update-metric-request`, and `metric` JSON Schemas under `schemas/`.
* No FQNs inlined in Scala.

## Acceptance criteria

- [ ] All five endpoints work end-to-end under the caller's RLS context; list is owner-scoped and paginated with the existing `PaginatedQueryResult` envelope.
- [ ] Create/update rejects (422/400) a metric whose `dataTypeId` is not a caller-owned pipeline-output DataType, whose `measureField`/`allowedDimensions` are not columns of that DataType, or whose `aggregation` is outside the allow-list — each with a descriptive message.
- [ ] `PATCH` supports partial updates (name/description/measureField/aggregation/allowedDimensions/format/deprecated) using the absent-vs-null patch convention already used by `MetricPanelConfig.Patch`.
- [ ] Route-level ScalaTests cover the happy path and each validation rejection.
- [ ] JSON Schemas added and validated against the wire; `sbt test` passes; no FQNs inlined.

## Out of scope

* Panel→metric binding (418-C), MCP tools (418-D), authoring UI (418-F), deprecation propagation/governance (418-G).

## Dependencies

* Blocked by 418-A (HEL-446) — **DONE**, merged via PR #314. Downstream: 418-D, 418-E, 418-F.
