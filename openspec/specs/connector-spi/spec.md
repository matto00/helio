# connector-spi Specification

## Purpose
Shared `Connector[Config]` trait (test/inferSchema/fetch, plus capability metadata) that every v1.9
data connector implements, giving `SqlConnector`, `RestApiConnector`, and future connectors one
lifecycle contract to build on.
## Requirements
### Requirement: Shared Connector lifecycle trait
The backend SHALL define a trait `Connector[Config]` in `com.helio.domain` exposing a
`testConnection(config: Config)(implicit ec: ExecutionContext): Future[Either[String, Unit]]`, an
`inferSchema(config: Config)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]]`,
and a `fetch(config: Config, maxRows: Int)(implicit ec: ExecutionContext): Future[Either[String,
Vector[JsValue]]]` method. The trait SHALL be generic over the connector-specific config type rather
than requiring a common config supertype.

#### Scenario: Trait compiles and is generic over config type
- **WHEN** the backend is compiled
- **THEN** `Connector[Config]` is defined with `testConnection`, `inferSchema`, and `fetch` members
  parameterized by `Config`

#### Scenario: Trait methods accept a caller-supplied ExecutionContext
- **WHEN** `testConnection`, `inferSchema`, or `fetch` is called on any `Connector[Config]`
  implementation
- **THEN** the call requires an `implicit ExecutionContext` in scope at the call site — no
  implementation sources one internally (e.g. via `ExecutionContext.global`)

### Requirement: SqlConnector and RestApiConnector implement Connector
`SqlConnector` SHALL implement `Connector[SqlSourceConfig]` and `RestApiConnector` SHALL implement
`Connector[RestApiConfig]`, both reachable as `Connector[_]` instances, without modifying the
existing public methods (`execute`, `inferSchema(rows)`, `toRows`, `checkQuery`, `fetch`, `doFetch`)
or their behavior.

#### Scenario: SqlConnector is reachable as a Connector
- **WHEN** `SqlConnector` is referenced as `Connector[SqlSourceConfig]`
- **THEN** its `testConnection`, `inferSchema`, and `fetch` methods are callable through the trait
  interface

#### Scenario: RestApiConnector is reachable as a Connector
- **WHEN** a `RestApiConnector` instance is referenced as `Connector[RestApiConfig]`
- **THEN** its `testConnection`, `inferSchema`, and `fetch` methods are callable through the trait
  interface

#### Scenario: Existing SqlConnector/RestApiConnector behavior unchanged
- **WHEN** `SourceService` calls `SqlConnector.execute`, `SqlConnector.inferSchema(rows)`,
  `RestApiConnector.fetch(config)`, or `RestApiConnector.toRows(json)` as it did before this change
- **THEN** the return values, error strings, and side effects are identical to pre-change behavior

### Requirement: Connector capability metadata
Every `Connector[Config]` implementation SHALL expose a `metadata: ConnectorMetadata` value with
fields `kind: String`, `displayName: String`, `supportsIncremental: Boolean`, `authKind: String`, and
`requiredFields: Vector[ConnectorFieldDescriptor]` (each descriptor carrying `name: String`,
`label: String`, `secret: Boolean`, describing a required config field with no value), describing
static capabilities of the connector (not a specific config instance).

#### Scenario: SqlConnector exposes metadata
- **WHEN** `SqlConnector.metadata` is read
- **THEN** it returns a `ConnectorMetadata` with `kind == "sql"`, `supportsIncremental == false`, and
  `requiredFields` containing an entry named `password` with `secret == true`

#### Scenario: RestApiConnector exposes metadata
- **WHEN** `RestApiConnector.metadata` (the companion object's dependency-free `val`) or a
  `RestApiConnector` instance's `metadata` member (which delegates to it) is read
- **THEN** it returns a `ConnectorMetadata` with `kind == "rest_api"`, `supportsIncremental == false`,
  and `requiredFields` containing an entry named `url` with `secret == false`

### Requirement: testConnection is a cheap reachability check
`testConnection` SHALL NOT perform a full data fetch. For SQL, it SHALL open and close a JDBC
connection without executing the configured query. For REST, it SHALL issue the configured
request/auth/headers and inspect only the response status, without parsing the response body as
JSON.

#### Scenario: SQL testConnection does not execute the query
- **WHEN** `SqlConnector.testConnection` is called with a config whose `query` would fail to parse
  as valid SQL for the target dialect
- **THEN** the call succeeds as long as the connection itself can be opened (the query is never sent)

#### Scenario: REST testConnection succeeds on a non-JSON response
- **WHEN** `RestApiConnector.testConnection` is called against an endpoint that returns a 200 with a
  non-JSON body
- **THEN** the result is `Right(())` (no JSON parse attempted)

### Requirement: fetch returns normalized JsObject rows
`fetch(config, maxRows)` SHALL return a `Vector[JsValue]` where each element is the JsObject shape
already consumed by `SchemaInferenceEngine` and `SourceService` (one JsObject per row), bounded by
`maxRows`.

#### Scenario: SQL fetch row shape matches SourceService's existing row shape
- **WHEN** `SqlConnector.fetch(config, maxRows)` succeeds
- **THEN** the returned `Vector[JsValue]` elements are `JsObject`s equivalent to
  `SqlConnector.toRows(SqlConnector.execute(config, maxRows))`

#### Scenario: REST fetch row shape matches SourceService's existing row shape
- **WHEN** `RestApiConnector.fetch(config, maxRows)` succeeds
- **THEN** the returned `Vector[JsValue]` elements are equivalent to
  `RestApiConnector.toRows(RestApiConnector.fetch(config))`, truncated to `maxRows`

### Requirement: refresh has no distinct SPI method
The `Connector` trait SHALL document (not implement as a separate method) that the default refresh
semantics is a full re-fetch via `fetch`; incremental/streaming refresh is out of scope for this
trait and is deferred to a future extension.

#### Scenario: No refresh method on the trait
- **WHEN** the `Connector[Config]` trait's member list is inspected
- **THEN** it contains no `refresh` method — only `testConnection`, `inferSchema`, `fetch`, and
  `metadata`

