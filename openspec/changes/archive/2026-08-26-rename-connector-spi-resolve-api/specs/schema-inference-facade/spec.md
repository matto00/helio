## MODIFIED Requirements

### Requirement: Connectors' inferSchema routes through the shared facade
The `ConnectorDriver[Config]` SPI's `inferSchema` implementations (`SqlConnectorDriver`, `RestApiConnectorDriver`) SHALL derive their result via `inferSchemaFromRows`, not a separate inline JsArray-construction step,
producing byte-for-byte identical output to their pre-change behavior for existing REST/SQL sources.

#### Scenario: SqlConnector routes through the facade unchanged
- **WHEN** `SqlConnectorDriver.inferSchema(config)` is called against a SQL source that previously
  produced a given `InferredSchema`
- **THEN** the result is unchanged, and is derived via `inferSchemaFromRows`

#### Scenario: RestApiConnector routes through the facade unchanged
- **WHEN** `RestApiConnectorDriver.inferSchema(config)` is called against a REST source that previously
  produced a given `InferredSchema` (whether the response is a JSON array, a single object, or a
  non-object scalar)
- **THEN** the result is unchanged, and is derived via `inferSchemaFromRows`

### Requirement: New connectors document their inference contract
The `ConnectorDriver[Config]` trait's doc comment in `domain/ConnectorDriver.scala` SHALL state that any
implementation's `fetch` output (`Vector[JsValue]`, one row per element) funnels directly into
`SchemaInferenceEngine.inferSchemaFromRows` for correct schema inference, with no connector-specific
JSON-shape-specific inference logic needed.

#### Scenario: Trait doc comment names the inference contract
- **WHEN** `domain/ConnectorDriver.scala`'s trait-level doc comment is read
- **THEN** it states that `ConnectorDriver[Config].fetch`'s `Vector[JsValue]` output feeds
  `SchemaInferenceEngine.inferSchemaFromRows` to produce a correct `InferredSchema`, without
  connector-specific inference logic

#### Scenario: A test connector supplying arbitrary rows infers correctly
- **WHEN** a test `ConnectorDriver[Config]` implementation supplies an arbitrary `Vector[JsValue]` of rows
  through `inferSchemaFromRows`
- **THEN** the resulting `InferredSchema` correctly reflects the field names, types, and
  nullability present across those rows

