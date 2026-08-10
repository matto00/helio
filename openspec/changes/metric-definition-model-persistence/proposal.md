## Why

Every data panel today re-derives its own aggregation (`MetricPanelConfig`'s ad-hoc
`aggregation: Option[JsObject]`). There is no reusable, named metric a panel or an
agent can reference. This lands the persistent metric-definition model — domain,
migration, repository, JSON — that the rest of the Semantic/Metric Layer epic
(HEL-418) builds on. No CRUD service/routes yet; this ticket is data-layer only.

## What Changes

- Add `MetricId` value class + `MetricDefinition`/`MetricFormat` case classes to
  `backend/src/main/scala/com/helio/domain/model.scala`.
- Add domain-boundary validation of `aggregation` against the allow-list
  (`sum|avg|min|max|count|countDistinct`), returning a descriptive `Left` on an
  unknown value.
- Add a Flyway migration creating the `metrics` table: owner-only RLS
  (`ENABLE` + `FORCE`), `owner_id UUID NOT NULL REFERENCES users(id)`,
  `data_type_id` FK `ON DELETE CASCADE`, indexes on both `owner_id` and
  `data_type_id`, `allowed_dimensions`/`format` stored as JSONB.
- Add `MetricRepository` (Slick) mirroring `PipelineRepository`/`DataTypeRepository`
  conventions: `insert`, `findByIdOwned`, `listByOwner`, `update`, `delete`, plus a
  privileged `findByIdInternal`/`withSystemContext` variant.
- Add spray-json formatters for `MetricFormat` and a `MetricResponse` wire DTO
  (+ `fromDomain`) for `MetricDefinition`, mirroring `AlertRuleProtocol.scala` —
  the codebase's established convention for exposing an ID/Instant-bearing
  domain entity, in `MetricProtocol.scala`.

## Capabilities

### New Capabilities
- `metric-definition-persistence`: the `MetricDefinition`/`MetricFormat` domain
  model, its Flyway-backed `metrics` table (owner-only RLS, FK cascade), and the
  `MetricRepository` CRUD surface.

### Modified Capabilities
(none — additive only, no existing requirement changes)

## Impact

- New: `backend/src/main/scala/com/helio/infrastructure/MetricRepository.scala`,
  a new `VNN__metrics.sql` Flyway migration (next available version).
- Modified: `backend/src/main/scala/com/helio/domain/model.scala`,
  `backend/src/main/scala/com/helio/api/protocols/JsonProtocols.scala` (or the
  relevant protocol trait file).
- No REST routes, no panel/service wiring — out of scope (418-B onward).
- No existing table/column/panel behavior changes.
