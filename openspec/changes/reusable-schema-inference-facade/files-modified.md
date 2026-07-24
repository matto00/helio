- `backend/src/main/scala/com/helio/domain/SchemaInferenceEngine.scala` — added
  `inferSchemaFromRows(rows: Vector[JsValue]): InferredSchema`, the thin facade over
  `fromJson(JsArray(rows))` (task 1.1).
- `backend/src/main/scala/com/helio/domain/Connector.scala` — extended the `Connector[Config]`
  trait-level doc comment with a `'''Schema inference'''` block naming `inferSchemaFromRows` as the
  contract every new connector's `fetch` output funnels into (task 1.3).
- `backend/src/main/scala/com/helio/domain/SqlConnector.scala` — `inferSchema(rows)` now delegates to
  `SchemaInferenceEngine.inferSchemaFromRows(toRows(rows))` instead of constructing the `JsArray`
  inline (task 2.1).
- `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` — the trait `inferSchema(config)`
  now delegates to `SchemaInferenceEngine.inferSchemaFromRows(toRows(json))` instead of calling
  `fromJson(json)` directly on the raw response (task 2.2).
- `backend/src/main/scala/com/helio/services/SchemaInferenceFacade.scala` (new) — the single
  `InferredField` → `DataField` projection (`toDataFields`, override-aware) replacing the four inline
  copies previously spread across `SourceService` (task 1.2).
- `backend/src/main/scala/com/helio/services/SourceService.scala` — `createSql`, `createRest`,
  `inferSql`, `inferRest`, `refreshSql`, `refreshRest` now call the connectors' SPI `inferSchema`
  method (HEL-449) instead of hand-rolling `execute`/`fetch` + inline inference, and build `DataField`s
  via `SchemaInferenceFacade.toDataFields`. `previewSql`/`previewRest` are untouched (tasks 3.1–3.7).
- `backend/src/test/scala/com/helio/domain/SchemaInferenceEngineSpec.scala` — added a
  `inferSchemaFromRows` test section: equivalence to `fromJson(JsArray(rows))` across row-object,
  empty, non-object-element, and single-row-object inputs, plus an arbitrary-rows correctness case
  (task 4.2).
- `backend/src/test/scala/com/helio/domain/NewConnectorInferenceSpec.scala` (new) — a fresh
  `Connector[Config]` fixture (`RowSupplyingConnector`/`RowSupplyingConfig`) whose `inferSchema` does
  nothing but forward `fetch`'s rows into `inferSchemaFromRows`, proving the documented "supply rows,
  get inference" contract for a brand-new connector (task 4.4).
- `backend/src/test/scala/com/helio/services/SchemaInferenceFacadeSpec.scala` (new) — unit tests for
  `SchemaInferenceFacade.toDataFields`: no-override, matching-override (displayName/dataType
  substitution, nullable untouched), unknown-override-name no-op, empty-schema cases (task 4.3).
- `backend/src/test/scala/com/helio/services/SourceServiceSpec.scala` (new) — service-level coverage
  for `createSql`/`createRest`/`inferSql`/`inferRest`/`refresh` (SQL + REST), confirming identical
  output — including the `fetchError` early-return path and REST field-override handling — after
  routing through the SPI + facade (task 4.5).
- `openspec/changes/reusable-schema-inference-facade/tasks.md` — all 17 tasks checked off.

## Spinoff-ticket candidates (found during implementation, out of scope for this ticket)

- `DataTypeRepository.update` (`backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala`,
  ~line 121-122) unconditionally computes `newVersion = existing.version + 1` and ignores the
  `version` field on the `DataType` passed in. This makes `SourceService.upsertDataType`'s
  `bumpVersion` parameter inert for the "existing DataType" branch — `refreshRest`'s
  `bumpVersion = false` has no actual effect; the version always increments on every refresh
  regardless of source kind. Discovered while writing `SourceServiceSpec`'s refresh tests (had to
  correct a test expectation from "REST refresh doesn't bump version" to "REST refresh does bump
  version" to match observed behavior). Pre-existing, unrelated to this ticket's routing change —
  not fixed here per the "behavior-preserving only" scope.
- `DataSourceService`'s CSV create/refresh paths (lines ~157-165 and ~530-533, per the orchestrator's
  briefing) duplicate the same `InferredField` → `DataField` override-aware mapping pattern this
  ticket centralized for `SourceService`. Out of scope (CSV is not part of the v1.9 Connector SPI;
  named as a non-goal in design.md) — flagged again here for a future follow-up ticket to route
  through `SchemaInferenceFacade.toDataFields` as well.
