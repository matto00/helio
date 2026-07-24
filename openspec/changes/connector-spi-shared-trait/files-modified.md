- `backend/src/main/scala/com/helio/domain/Connector.scala` — new file. Defines `ConnectorMetadata`
  and `trait Connector[Config]` (`metadata`, `testConnection`, `inferSchema`, `fetch`), all with a
  caller-supplied `implicit ec: ExecutionContext`; doc comment documents refresh = re-fetch by
  default (HEL-428 owns incremental).
- `backend/src/main/scala/com/helio/domain/SqlConnector.scala` — added `extends
  Connector[SqlSourceConfig]`, `metadata` val, and the three trait methods (`testConnection` is new
  open+close-only logic with a distinct "SQL connection failed" message; `inferSchema`/`fetch`
  forward the caller-supplied `ec` into the existing `execute`/`inferSchema(rows)`/`toRows`
  methods). No existing method signature or behavior changed.
- `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` — added `extends
  Connector[RestApiConfig]`, `metadata` val, and the three trait methods. Extracted a private
  `buildRequest` helper out of `doFetch` (identical logic, just factored out) so `testConnection`
  can reuse the same URI/query-param/auth/header pipeline without duplicating it; `testConnection`
  inspects only response status (never calls `parseJson`). `inferSchema`/`fetch` delegate to the
  existing `fetch`/`toRows` methods. No existing method signature or behavior changed.
- `backend/src/test/scala/com/helio/domain/ConnectorSpec.scala` — new file. `FixtureConnector`
  (`Connector[FixtureConfig]`) plus dispatch tests proving the trait contract (metadata,
  testConnection success/failure, inferSchema, fetch+maxRows truncation, and a compile-time check
  that no `refresh` method exists on the trait) independent of SQL/REST.
- `backend/src/test/scala/com/helio/domain/RestApiConnectorSpec.scala` — new file. Binds a real
  local Pekko HTTP test server (same pattern as `ContentSourceSupportSpec`/`DataSourceServiceSpec`)
  to test `RestApiConnector`-as-`Connector[RestApiConfig]`: metadata values, `testConnection`
  success on a non-JSON 200 body, `testConnection` failure on non-2xx and on unreachable host, and
  `fetch`/`inferSchema` parity with the existing `fetch`/`toRows`/`SchemaInferenceEngine.fromJson`
  methods.
- `backend/src/test/scala/com/helio/domain/SqlConnectorSpec.scala` — added `SqlConnector`-as-
  `Connector[SqlSourceConfig]` tests using `EmbeddedPostgres` (same pattern as
  `DataSourceServiceSpec`): metadata values, `testConnection` success against a reachable DB with
  an intentionally-invalid query (proves the query is never executed) and failure against an
  unreachable port, and `fetch`/`inferSchema` parity with `execute`/`toRows`/`inferSchema(rows)`.
