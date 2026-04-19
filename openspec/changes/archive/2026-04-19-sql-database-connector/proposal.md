## Why

Helio already supports REST API and CSV connectors; SQL databases (PostgreSQL, MySQL) are the
next planned connector type from HEL-29. Users need to query their relational databases directly
and register the result set as a DataType without manual export/import steps.

## What Changes

- Add `sql` as a new value in the `SourceType` enum (backend + schema)
- Implement `SqlConnector` that opens a JDBC connection per request, executes a SELECT query,
  and returns rows as `Seq[Map[String, Any]]`
- Add four new routes: `POST /api/sources` (sql), `POST /api/sources/infer`,
  `GET /api/sources/:id/preview`, `POST /api/sources/:id/refresh`
- Enforce DDL/DML keyword rejection (CREATE, DROP, ALTER, DELETE, INSERT, UPDATE, TRUNCATE) at
  the route layer before query execution
- Mask passwords (`***`) in all API responses; store plaintext in JSONB config server-side
- Add **SQL Database** tab to `AddSourceModal` with dialect selector, connection fields,
  query textarea, "Test connection" flow, and inline error display

## Capabilities

### New Capabilities

- `sql-database-connector`: Full SQL connector — JDBC execution, schema inference, preview,
  refresh, DDL/DML rejection, password masking, frontend form + test-connection flow

### Modified Capabilities

- `data-source-persistence`: New `sql` source type must be accepted by the persistence layer's
  type enum and config storage

## Impact

- **Backend**: new `SqlConnector.scala`, JDBC dependencies (PostgreSQL + MySQL drivers) added to
  `build.sbt`, new route handlers in `ApiRoutes.scala` / `SourceRoutes.scala`,
  `JsonProtocols.scala` extended for SQL config type
- **Frontend**: `AddSourceModal` gains a SQL tab; new form fields and test-connection button;
  Redux thunks for infer + create SQL source
- **Schemas**: new JSON Schema for `SqlSourceConfig`; OpenAPI spec additions for the four routes
- **Non-goals**: connection pool reuse, visual query builder, multiple queries per source,
  non-relational databases

## Non-goals

- Visual query builder
- Multiple queries per source
- Connection pool reuse across requests
- Non-relational databases (MongoDB, Redis, etc.)
