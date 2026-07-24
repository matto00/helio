## 1. Backend: Connector trait + metadata

- [x] 1.1 Create `backend/src/main/scala/com/helio/domain/Connector.scala` with
      `ConnectorMetadata(kind, displayName, supportsIncremental, authKind)` and
      `trait Connector[Config]` (`metadata`, `testConnection`, `inferSchema`, `fetch`), with a doc
      comment stating refresh = re-fetch by default (HEL-428 owns incremental). `testConnection`,
      `inferSchema`, and `fetch` each declare `(implicit ec: ExecutionContext)` — no implementation
      may source an EC internally (e.g. `ExecutionContext.global`); see design.md Decision 6.

## 2. Backend: SqlConnector implementation

- [x] 2.1 Add `extends Connector[SqlSourceConfig]` to `SqlConnector` (object).
- [x] 2.2 Implement `metadata` (`kind = "sql"`, `displayName = "SQL Database"`,
      `supportsIncremental = false`, `authKind = "basic"`).
- [x] 2.3 Implement `testConnection(config)(implicit ec)` — open+close a JDBC connection via
      `connect`, no query execution; map failures to a distinct "SQL connection failed" message
      (log the cause, don't leak it); use the caller-supplied `ec`, never `ExecutionContext.global`.
- [x] 2.4 Implement `inferSchema(config)(implicit ec)` and `fetch(config, maxRows)(implicit ec)` by
      forwarding the caller-supplied `ec` straight into the existing `execute`/`inferSchema(rows)`/
      `toRows` methods — no duplicated logic, no independently-sourced EC.

## 3. Backend: RestApiConnector implementation

- [x] 3.1 Add `extends Connector[RestApiConfig]` to `RestApiConnector` (class).
- [x] 3.2 Implement `metadata` (`kind = "rest_api"`, `displayName = "REST API"`,
      `supportsIncremental = false`, `authKind = "configurable"`).
- [x] 3.3 Implement `testConnection(config)(implicit ec)` — reuse the auth/header/request pipeline,
      check only response status (skip `parseJson`); reuse existing error-message categories where
      the failure mode matches (`"Request failed"`), add a distinct one only where necessary; accept
      the trait's implicit `ec` parameter (shadowing the class's own private `ec` within the method).
- [x] 3.4 Implement `inferSchema(config)(implicit ec)` and `fetch(config, maxRows)(implicit ec)` by
      delegating to the existing `fetch`/`toRows` methods, truncating to `maxRows`.

## 4. Tests

- [x] 4.1 Add a fixture connector (e.g. `FixtureConnector` in the test tree) implementing
      `Connector[FixtureConfig]` and assert lifecycle dispatch (`testConnection`/`inferSchema`/`fetch`
      all reachable and return expected values) — proves the trait contract independent of SQL/REST.
- [x] 4.2 Add `SqlConnector`-as-`Connector` tests: `metadata` values, `testConnection` success/failure
      (mock/misconfigured DB), `fetch`/`inferSchema` parity with existing `execute`/`toRows`.
- [x] 4.3 Add `RestApiConnector`-as-`Connector` tests (using the existing `fetchOverride` seam):
      `metadata` values, `testConnection` success on non-JSON 200 body, `fetch` parity with `toRows`.
- [x] 4.4 Run full existing `SourceService`-covering suites (`DataSourceServiceSpec`,
      `DataSourceServiceRestartPersistenceSpec`, `DataSourceRoutesSpec`, `SqlConnectorSpec`,
      `SchemaInferenceRegressionSpec`) and confirm zero behavior change.
