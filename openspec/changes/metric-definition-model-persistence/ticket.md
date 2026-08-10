# HEL-446: Metric definition model + persistence

## Description

Every data panel today re-derives its own aggregation. `MetricPanelConfig` (`backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala`) carries `dataTypeId` + `fieldMapping` + an ad-hoc `aggregation: Option[JsObject]`; chart/table panels each re-specify their measures independently. There is no reusable, named metric that a panel — or the agent — can reference, so the agent re-invents a measure per panel. This ticket lands the persistent metric-definition model that the rest of the Semantic/Metric Layer epic (HEL-418) builds on.

A metric binds to a pipeline-output DataType (the only panel-bindable kind, V41 — a DataType with `sourceId == None`) and names a measure over it: an aggregation function applied to a field, the dimensions it may be grouped by, and a display format.

## Scope

- Domain (`backend/src/main/scala/com/helio/domain/model.scala`): add a `MetricId(value: String) extends AnyVal` value class and a `MetricDefinition` case class following the existing value-class-ID + immutable-case-class conventions. Fields: `id: MetricId`, `ownerId: UserId`, `dataTypeId: DataTypeId`, `name: String`, `description: Option[String]`, `measureField: String`, `aggregation: String` (allow-list: `sum|avg|min|max|count|countDistinct`), `allowedDimensions: Vector[String]`, `format` (a small case class: `unit: Option[String]`, `decimals: Option[Int]`, `prefix: Option[String]`, `suffix: Option[String]`), `deprecated: Boolean = false`, `createdAt: Instant`, `updatedAt: Instant`.
- Persistence: Flyway migration (next available VNN, assigned at scheduling time — main is at V59; many lanes contend, so do NOT hardcode the number) creating a `metrics` table. Owner-only RLS following the V35/V54 pattern (`ENABLE` + `FORCE ROW LEVEL SECURITY`, single owner policy `USING (owner_id = current_setting('app.current_user_id')::uuid)`). `data_type_id` FK REFERENCES `data_types(id) ON DELETE CASCADE`. Index on `owner_id`. Store `allowed_dimensions` and `format` as JSONB.
- Repository: `MetricRepository` (Slick) alongside the existing repos in `backend/src/main/scala/com/helio/infrastructure/`, mirroring `PipelineRepository` conventions — `withUserContext` for owner-scoped reads/writes and a `findByIdInternal`/`withSystemContext` variant where a privileged lookup is warranted. Methods: `insert`, `findByIdOwned`, `listByOwner`, `update`, `delete`.
- JSON: spray-json formatters for `MetricDefinition` + `MetricFormat` in `JsonProtocols.scala`. Do NOT inline fully-qualified names anywhere (CONTRIBUTING.md iron rule).

## Acceptance criteria

- [ ] `metrics` table is created via a new Flyway migration with owner-only RLS (`ENABLE` + `FORCE`), the `data_type_id` FK, and the `owner_id` index.
- [ ] `MetricDefinition` round-trips through `MetricRepository` (insert / findByIdOwned / listByOwner / update / delete) under a user RLS context.
- [ ] `aggregation` is validated against the `sum|avg|min|max|count|countDistinct` allow-list at the domain boundary; an unknown value is rejected with a descriptive `Left`/error.
- [ ] A ScalaTest repository spec proves RLS isolation (owner A cannot read owner B's metric) and CASCADE delete when the bound DataType is deleted.
- [ ] Additive only: no existing table/column/panel behaviour changes; `sbt test` passes.
- [ ] No fully-qualified names inlined in Scala (imports at top).

## Out of scope

- CRUD service + REST routes (418-B), panel→metric binding (418-C), MCP surface (418-D), agent grounding (418-E), authoring UI (418-F), governance/deprecation propagation (418-G).

## Dependencies

- None — foundational. Downstream: 418-B/C/D/E/F/G.
