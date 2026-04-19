## Context

Helio already ships `RestApiConnector` and CSV upload as data source connectors. Both follow the
pattern: accept a config, execute a fetch, infer schema via `SchemaInferenceEngine`, write a
`DataType`. The SQL connector reuses the same pipeline but substitutes JDBC for HTTP.

The PostgreSQL JDBC driver (`org.postgresql:postgresql:42.7.4`) is already in `build.sbt` as the
app's own database driver. The MySQL driver must be added as a new dependency.

## Goals / Non-Goals

**Goals:**
- Add `sql` to `SourceType` enum and accept a structured SQL config in `data_sources.config` JSONB
- Implement `SqlConnector` that opens a JDBC connection, executes a SELECT, maps ResultSet rows
  to `Seq[Map[String, JsValue]]`, and feeds them into `SchemaInferenceEngine.fromJson`
- Add four routes matching the REST connector pattern: create, infer, preview, refresh
- Reject DDL/DML at the route layer before any JDBC call
- Mask passwords (`***`) in all API responses; store plaintext in the JSONB config
- Frontend `AddSourceModal` SQL tab with test-connection flow

**Non-Goals:**
- Connection pool reuse (per-request JDBC only)
- Visual query builder
- Multiple queries per source
- Non-relational databases

## Decisions

**D1: Reuse `SchemaInferenceEngine.fromJson` for row inference.**
SQL rows are converted to `JsObject` (one per row) and wrapped in `JsArray`, then passed to
the existing JSON inference path. This avoids a new inference code path and handles type
widening automatically. Alternative: a dedicated `fromSql` function reading `ResultSetMetaData`
— rejected because runtime values carry more type information than JDBC metadata alone.

**D2: DDL/DML keyword check at the route layer via regex.**
A case-insensitive word-boundary regex (`\b(CREATE|DROP|ALTER|DELETE|INSERT|UPDATE|TRUNCATE)\b`)
is applied to the raw query string before any JDBC call. This is a best-effort guard; users
with legitimate identifiers containing those substrings can still be blocked. Accepted trade-off:
the ticket explicitly requires keyword rejection without specifying word-boundary semantics.

**D3: Password masking via a separate response config type.**
`SqlSourceConfig` (internal, has `password`) and `SqlSourceConfigResponse` (external, has
`password = "***"`) are distinct case classes. Spray JSON formatters are defined only for the
response variant. This follows the existing `credentials never returned` pattern from
`rest-api-connector` spec.

**D4: MySQL JDBC driver added to `build.sbt`.**
`mysql:mysql-connector-j:8.3.0` (or latest stable) is added alongside the existing PostgreSQL
driver. The dialect field in the config determines which JDBC URL prefix is used
(`jdbc:postgresql://` vs `jdbc:mysql://`).

**D5: Frontend SQL tab mirrors REST API tab structure.**
`AddSourceModal` already uses a tabbed layout. A new `SqlTab` component follows the same
`useState` + thunk pattern as `RestApiTab`. "Test connection" calls `POST /api/sources/infer`
with `source_type: "sql"`. Inline errors use `shared-inline-error` pattern.

## Risks / Trade-offs

[Blocking operations] JDBC `getConnection` / `executeQuery` are blocking. The `SqlConnector`
must wrap calls in `Future { blocking { ... } }` (Scala's `blocking` hint) to avoid starving
the Akka dispatcher. → Mitigation: use `scala.concurrent.blocking` annotation inside Future.

[Query timeout] A slow or stuck query blocks a thread indefinitely.
→ Mitigation: set `Statement.setQueryTimeout(30)` (30 s) before execution.

[Large result sets for preview] A `SELECT *` on a large table could return millions of rows.
→ Mitigation: use `Statement.setMaxRows(10)` for preview endpoint; for infer/create cap at 100
rows by reading only the first 100 from the ResultSet before closing it.

[MySQL SSL warnings] Default MySQL JDBC connections produce SSL warnings in logs.
→ Mitigation: append `?useSSL=false&allowPublicKeyRetrieval=true` to the JDBC URL for MySQL
unless the user explicitly configures SSL. Acceptable for an initial connector.

## Planner Notes

- Self-approved: adding MySQL JDBC driver is a minor new dependency, not a new external service.
- Self-approved: DDL keyword regex is a best-effort guard consistent with the ticket's intent.
- Self-approved: 100-row cap for infer/create (same as CSV) is a sensible default matching
  `SchemaInferenceEngine` sampling convention.
