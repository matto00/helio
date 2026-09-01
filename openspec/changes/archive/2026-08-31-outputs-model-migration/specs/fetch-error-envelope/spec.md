## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Shared create-time envelope helper
The backend SHALL define a helper (`CreateSourceEnvelope.build`) in `com.helio.services`, generic
over any `ConnectorDriver[Config]` implementation, that given a connector instance, its config, an inserted
`DataSource`, and a `OutputRepository/PipelineStepRepository` produces a `Future[CreateSourceResponse]`: calling
`connector.inferSchema(config)` and, on `Left(err)`, returning `CreateSourceResponse(source, dataType
= None, fetchError = Some(err))`; on `Right(schema)`, projecting fields via
`SchemaInferenceFacade.toDataFields`, persisting a new `Output`, and returning
`CreateSourceResponse(source, dataType = Some(...), fetchError = None)`.

#### Scenario: Helper compiles against any Connector[Config] implementation
- **WHEN** the backend is compiled
- **THEN** `CreateSourceEnvelope.build` accepts any `ConnectorDriver[Config]` instance (not just
  `SqlConnectorDriver`/`RestApiConnectorDriver`) without a connector-specific overload

#### Scenario: Failure produces a diagnosable envelope, not an HTTP error
- **WHEN** `connector.inferSchema(config)` resolves to `Left(err)`
- **THEN** the helper returns a `CreateSourceResponse` with `dataType = None` and `fetchError =
  Some(err)`, and does not fail the enclosing `Future`

#### Scenario: Success produces a persisted DataType with no fetchError
- **WHEN** `connector.inferSchema(config)` resolves to `Right(schema)`
- **THEN** the helper persists a `Output` via `SchemaInferenceFacade.toDataFields(schema,
  overrides)` and returns a `CreateSourceResponse` with `dataType = Some(...)` and `fetchError = None`

### Requirement: A new connector gets the envelope by construction
Any `ConnectorDriver[Config]` implementation, including one with no create-path-specific code, SHALL
produce a correct `CreateSourceResponse` (success and failure cases) when driven through
`CreateSourceEnvelope.build` — demonstrated by a test-connector fixture.

#### Scenario: Test connector's failure case produces a valid envelope
- **GIVEN** a test `ConnectorDriver[Config]` fixture whose `inferSchema` returns `Left("fixture
  unreachable")`
- **WHEN** `CreateSourceEnvelope.build` is called with that connector and config
- **THEN** the result is `CreateSourceResponse(source, dataType = None, fetchError = Some("fixture
  unreachable"))`

#### Scenario: Test connector's success case produces a valid envelope
- **GIVEN** a test `ConnectorDriver[Config]` fixture whose `inferSchema` returns `Right(schema)` for some
  `InferredSchema`
- **WHEN** `CreateSourceEnvelope.build` is called with that connector and config
- **THEN** the result is `CreateSourceResponse(source, dataType = Some(...), fetchError = None)` with
  the persisted `Output`'s fields matching `SchemaInferenceFacade.toDataFields(schema)`
