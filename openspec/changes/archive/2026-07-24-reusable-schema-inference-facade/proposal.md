## Why

Schema inference is centralized in `SchemaInferenceEngine.fromJson(JsArray)`, but each connector
open-codes its own "rows → JsArray → InferredSchema → DataField" conversion, and `SourceService`
duplicates the `InferredField` → `DataField` projection (with field-override handling) across its
create/infer/refresh paths. HEL-449 (Connector SPI) added a trait-level `inferSchema(config)` on
every connector but explicitly deferred wiring `SourceService` through it. This ticket closes that
gap with one documented, tested "rows in → typed fields out" path so future connectors (Sheets,
warehouse, object-storage parsers) get correct inference for free instead of re-deriving it.

## What Changes

- Add `SchemaInferenceEngine.inferSchemaFromRows(rows: Vector[JsValue]): InferredSchema` — a thin
  facade wrapping `fromJson(JsArray(rows))`, matching the row shape `Connector.fetch` already returns.
- Add a single `InferredField` → `DataField` projection (service layer, honoring
  `FieldOverridePayload` overrides where supplied) replacing the three duplicated inline mappings in
  `SourceService`.
- Route `SqlConnector.inferSchema`/`RestApiConnector.inferSchema` (the HEL-449 SPI methods) through
  `inferSchemaFromRows`, and route `SourceService.createSql/createRest/inferSql/inferRest/
  refreshSql/refreshRest` through the SPI's `Connector.inferSchema(config)` trait method instead of
  hand-rolling execute/fetch + inference per connector kind.
- Document the "rows → InferredSchema → DataField" path so a new connector only needs to supply
  `Vector[JsValue]` rows (via `Connector.fetch`) to get correct inference.
- No change to inferred output for existing REST/SQL sources — behavior-preserving only.

## Capabilities

### New Capabilities

- `schema-inference-facade`: the shared rows→InferredSchema facade and InferredField→DataField
  projection every connector funnels through, and the documented contract new connectors follow.

### Modified Capabilities

_(none — `connector-spi`'s existing requirements already specify `inferSchema`'s external
behavior; this change is an internal implementation swap that must not alter it, so no requirement
text changes.)_

## Non-goals

- Changing inference heuristics (type promotion, nullability, timestamp detection).
- Wiring the CSV/Static paths in `DataSourceService` through this facade (separate service, not
  part of the v1.9 Connector SPI; flagged as a follow-up candidate, not fixed here).
- Any of the sibling tickets' scope (HEL-468 error envelope, HEL-460 secrets, HEL-480
  connection-test endpoint, HEL-484 registry).

## Impact

- `backend/src/main/scala/com/helio/domain/SchemaInferenceEngine.scala` (new method)
- `backend/src/main/scala/com/helio/domain/SqlConnector.scala`,
  `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` (inferSchema delegates to facade)
- `backend/src/main/scala/com/helio/services/SourceService.scala` (routes through SPI + shared
  projection; no wire-format change)
- New `backend/src/main/scala/com/helio/services/SchemaInferenceFacade.scala` (shared projection)
- New backend tests proving a test `Connector[Config]` supplying arbitrary rows infers correctly
