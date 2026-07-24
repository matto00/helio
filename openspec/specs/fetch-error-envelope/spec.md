# fetch-error-envelope Specification

## Purpose
Shared `CreateSourceEnvelope.build` helper, keyed off `Connector[Config].inferSchema`, that gives any
connector a diagnosable, retryable create-time `CreateSourceResponse` envelope by construction.
## Requirements
### Requirement: Shared create-time envelope helper
The backend SHALL define a helper (`CreateSourceEnvelope.build`) in `com.helio.services`, generic
over any `Connector[Config]` implementation, that given a connector instance, its config, an inserted
`DataSource`, and a `DataTypeRepository` produces a `Future[CreateSourceResponse]`: calling
`connector.inferSchema(config)` and, on `Left(err)`, returning `CreateSourceResponse(source, dataType
= None, fetchError = Some(err))`; on `Right(schema)`, projecting fields via
`SchemaInferenceFacade.toDataFields`, persisting a new `DataType`, and returning
`CreateSourceResponse(source, dataType = Some(...), fetchError = None)`.

#### Scenario: Helper compiles against any Connector[Config] implementation
- **WHEN** the backend is compiled
- **THEN** `CreateSourceEnvelope.build` accepts any `Connector[Config]` instance (not just
  `SqlConnector`/`RestApiConnector`) without a connector-specific overload

#### Scenario: Failure produces a diagnosable envelope, not an HTTP error
- **WHEN** `connector.inferSchema(config)` resolves to `Left(err)`
- **THEN** the helper returns a `CreateSourceResponse` with `dataType = None` and `fetchError =
  Some(err)`, and does not fail the enclosing `Future`

#### Scenario: Success produces a persisted DataType with no fetchError
- **WHEN** `connector.inferSchema(config)` resolves to `Right(schema)`
- **THEN** the helper persists a `DataType` via `SchemaInferenceFacade.toDataFields(schema,
  overrides)` and returns a `CreateSourceResponse` with `dataType = Some(...)` and `fetchError = None`

### Requirement: No raw exception text in fetchError
The helper SHALL forward the `err` string produced by `Connector[Config].inferSchema` unmodified —
it SHALL NOT re-wrap, re-prefix, or otherwise transform it. Curation of raw driver/parser/exception
text into a generic category message (HEL-311) happens inside each connector's `inferSchema`
implementation, which also logs the raw cause server-side; the helper trusts that boundary and never
re-derives or duplicates it.

#### Scenario: Curated message passes through unchanged
- **WHEN** a connector's `inferSchema` returns `Left("Request failed")` (a curated HEL-311 category
  message)
- **THEN** the resulting `CreateSourceResponse.fetchError` is exactly `Some("Request failed")` — no
  additional prefix, suffix, or wrapping text

### Requirement: createSql and createRest use the shared helper
`SourceService.createSql` and `SourceService.createRest` SHALL construct their `CreateSourceResponse`
via `CreateSourceEnvelope.build` rather than open-coding the `Left`/`Right` branch logic inline.

#### Scenario: createSql delegates to the helper
- **WHEN** `SourceService.createSql` is called and the SQL source is successfully inserted
- **THEN** the resulting `CreateSourceResponse` is produced by `CreateSourceEnvelope.build`, and is
  identical (field-for-field) to the response `createSql` produced before this change, for both the
  query-succeeds and query-fails cases

#### Scenario: createRest delegates to the helper
- **WHEN** `SourceService.createRest` is called and the REST source is successfully inserted
- **THEN** the resulting `CreateSourceResponse` is produced by `CreateSourceEnvelope.build` (passing
  the request's field overrides), and is identical (field-for-field) to the response `createRest`
  produced before this change, for both the fetch-succeeds and fetch-fails cases

### Requirement: Envelope contract documented on Connector
`Connector.scala`'s trait-level doc comment SHALL include a `'''Fetch-error envelope'''` block
documenting that any `Connector[Config]` implementation gets a create-time diagnosable envelope
(`CreateSourceResponse` with `dataType = None, fetchError = Some(err)` on failure) for free via
`CreateSourceEnvelope.build`, so future connector tickets reference this contract rather than
re-deriving it.

#### Scenario: Doc comment describes the envelope contract
- **WHEN** a developer reads `Connector.scala`'s trait-level doc comment
- **THEN** it includes a `'''Fetch-error envelope'''` block naming `CreateSourceEnvelope.build` and
  describing the failure/success shape, alongside the existing `'''ExecutionContext'''` and
  `'''Schema inference'''` blocks

### Requirement: A new connector gets the envelope by construction
Any `Connector[Config]` implementation, including one with no create-path-specific code, SHALL
produce a correct `CreateSourceResponse` (success and failure cases) when driven through
`CreateSourceEnvelope.build` — demonstrated by a test-connector fixture.

#### Scenario: Test connector's failure case produces a valid envelope
- **GIVEN** a test `Connector[Config]` fixture whose `inferSchema` returns `Left("fixture
  unreachable")`
- **WHEN** `CreateSourceEnvelope.build` is called with that connector and config
- **THEN** the result is `CreateSourceResponse(source, dataType = None, fetchError = Some("fixture
  unreachable"))`

#### Scenario: Test connector's success case produces a valid envelope
- **GIVEN** a test `Connector[Config]` fixture whose `inferSchema` returns `Right(schema)` for some
  `InferredSchema`
- **WHEN** `CreateSourceEnvelope.build` is called with that connector and config
- **THEN** the result is `CreateSourceResponse(source, dataType = Some(...), fetchError = None)` with
  the persisted `DataType`'s fields matching `SchemaInferenceFacade.toDataFields(schema)`

