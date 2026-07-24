# schema-inference-facade Specification

## Purpose
The shared "rows in → InferredSchema out → DataField" path every `Connector[Config]` implementation
funnels through — a single `inferSchemaFromRows` facade plus an override-aware
`InferredField`→`DataField` projection — so new connectors get correct, consistent schema inference
without reimplementing it.
## Requirements
### Requirement: Shared rows-to-schema facade
The backend SHALL define `SchemaInferenceEngine.inferSchemaFromRows(rows: Vector[JsValue]):
InferredSchema` in `com.helio.domain`, producing output identical to
`SchemaInferenceEngine.fromJson(JsArray(rows))`.

#### Scenario: Facade wraps fromJson without altering output
- **WHEN** `inferSchemaFromRows(rows)` is called with any `Vector[JsValue]`
- **THEN** the returned `InferredSchema` equals `SchemaInferenceEngine.fromJson(JsArray(rows))`

### Requirement: Connectors' inferSchema routes through the shared facade
The `Connector[Config]` SPI's `inferSchema` implementations (`SqlConnector`, `RestApiConnector`) SHALL derive their result via `inferSchemaFromRows`, not a separate inline JsArray-construction step,
producing byte-for-byte identical output to their pre-change behavior for existing REST/SQL sources.

#### Scenario: SqlConnector routes through the facade unchanged
- **WHEN** `SqlConnector.inferSchema(config)` is called against a SQL source that previously
  produced a given `InferredSchema`
- **THEN** the result is unchanged, and is derived via `inferSchemaFromRows`

#### Scenario: RestApiConnector routes through the facade unchanged
- **WHEN** `RestApiConnector.inferSchema(config)` is called against a REST source that previously
  produced a given `InferredSchema` (whether the response is a JSON array, a single object, or a
  non-object scalar)
- **THEN** the result is unchanged, and is derived via `inferSchemaFromRows`

### Requirement: Shared InferredField-to-DataField projection
The backend SHALL define a single `InferredField` → `DataField` projection function, honoring an
optional per-field-name override (`FieldOverridePayload`, providing `displayName` and `dataType`
overrides) when supplied, and defaulting to the inferred `displayName`/`dataType` when no override
is present for a field. `SourceService`'s create/refresh paths SHALL call this single function
rather than each defining an inline mapping.

#### Scenario: Projection without overrides matches inferred values
- **WHEN** the projection is called with an `InferredSchema` and no overrides
- **THEN** each resulting `DataField` has the inferred `displayName`, `dataType` (as its string
  form), and `nullable` value, unchanged from the `InferredField`

#### Scenario: Projection applies a matching override
- **WHEN** the projection is called with an `InferredSchema` and an override present for a given
  field name
- **THEN** the resulting `DataField` for that field uses the override's `displayName` and
  `dataType`, with `nullable` left as inferred

#### Scenario: SourceService reuses the shared projection
- **WHEN** `SourceService.createSql`, `.createRest`, `.refreshSql`, or `.refreshRest` builds a
  `DataType`'s fields from an `InferredSchema`
- **THEN** it does so by calling the shared projection function, not an inline field-by-field map

### Requirement: New connectors document their inference contract
The `Connector[Config]` trait's doc comment in `domain/Connector.scala` SHALL state that any
implementation's `fetch` output (`Vector[JsValue]`, one row per element) funnels directly into
`SchemaInferenceEngine.inferSchemaFromRows` for correct schema inference, with no connector-specific
JSON-shape-specific inference logic needed.

#### Scenario: Trait doc comment names the inference contract
- **WHEN** `domain/Connector.scala`'s trait-level doc comment is read
- **THEN** it states that `Connector[Config].fetch`'s `Vector[JsValue]` output feeds
  `SchemaInferenceEngine.inferSchemaFromRows` to produce a correct `InferredSchema`, without
  connector-specific inference logic

#### Scenario: A test connector supplying arbitrary rows infers correctly
- **WHEN** a test `Connector[Config]` implementation supplies an arbitrary `Vector[JsValue]` of rows
  through `inferSchemaFromRows`
- **THEN** the resulting `InferredSchema` correctly reflects the field names, types, and
  nullability present across those rows

