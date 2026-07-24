## 1. ### Backend — facade

- [x] 1.1 Add `SchemaInferenceEngine.inferSchemaFromRows(rows: Vector[JsValue]): InferredSchema` in
      `domain/SchemaInferenceEngine.scala` (delegates to `fromJson(JsArray(rows))`).
- [x] 1.2 Add `services/SchemaInferenceFacade.scala` with `def toDataFields(schema: InferredSchema,
      overrides: Map[String, FieldOverridePayload] = Map.empty): Vector[DataField]` — the shared
      `InferredField` → `DataField` projection.
- [x] 1.3 Extend `Connector[Config]`'s trait-level doc comment in `domain/Connector.scala` with a
      `'''Schema inference'''` block stating that `fetch`'s `Vector[JsValue]` output funnels directly
      into `SchemaInferenceEngine.inferSchemaFromRows` for correct inference — no connector-specific
      inference logic needed (same location/precedent as HEL-449's `'''ExecutionContext'''` block).

## 2. ### Backend — route connectors through the facade

- [x] 2.1 `SqlConnector.inferSchema(rows: Seq[Map[String, JsValue]])` delegates to
      `inferSchemaFromRows(toRows(rows))` instead of constructing `JsArray` inline.
- [x] 2.2 `RestApiConnector`'s trait `inferSchema(config)(implicit ec)` delegates to
      `inferSchemaFromRows(toRows(json))` instead of calling `SchemaInferenceEngine.fromJson(json)`
      directly.

## 3. ### Backend — route SourceService through the SPI + shared projection

- [x] 3.1 `SourceService.createSql` calls `SqlConnector.inferSchema(sqlConfig)` (SPI method) instead
      of `execute` + inline `inferSchema(rows)`; builds fields via `SchemaInferenceFacade`.
- [x] 3.2 `SourceService.createRest` calls `connector.inferSchema(restConfig)` (SPI method) instead
      of `fetch` + `SchemaInferenceEngine.fromJson`; builds fields via `SchemaInferenceFacade` with
      the request's field overrides.
- [x] 3.3 `SourceService.inferSql` calls `SqlConnector.inferSchema(sqlConfig)` instead of `execute` +
      inline `inferSchema(rows)`.
- [x] 3.4 `SourceService.inferRest` calls `connector.inferSchema(restConfig)` instead of `fetch` +
      `SchemaInferenceEngine.fromJson`.
- [x] 3.5 `SourceService.refreshSql` calls `SqlConnector.inferSchema(source.config)` instead of
      `execute` + inline `inferSchema(rows)`; builds fields via `SchemaInferenceFacade`.
- [x] 3.6 `SourceService.refreshRest` calls `connector.inferSchema(source.config)` instead of
      `fetch` + `SchemaInferenceEngine.fromJson`; builds fields via `SchemaInferenceFacade`.
- [x] 3.7 Confirm `previewSql`/`previewRest` are untouched (they need raw rows, not inferred schema).

## 4. ### Tests

- [x] 4.1 Run `SchemaInferenceRegressionSpec` unmodified — confirm it still passes (behavior-
      preservation guard).
- [x] 4.2 Add unit tests for `inferSchemaFromRows` proving equivalence to `fromJson(JsArray(rows))`.
- [x] 4.3 Add unit tests for the shared `InferredField` → `DataField` projection: no-override case,
      override case (displayName/dataType substitution, nullable untouched), and unknown-override
      field name (no-op).
- [x] 4.4 Add a test `Connector[Config]` implementation supplying arbitrary rows and assert
      `inferSchemaFromRows` produces the correct `InferredSchema` (field names/types/nullability).
- [x] 4.5 Add/extend `SourceService` tests covering `createSql`/`createRest`/`inferSql`/`inferRest`/
      `refreshSql`/`refreshRest` to confirm identical output (including the `fetchError` path) after
      routing through the SPI + facade.
