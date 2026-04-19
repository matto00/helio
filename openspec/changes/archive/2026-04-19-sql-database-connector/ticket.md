# HEL-60: SQL database connector

## Context

HEL-29 listed SQL databases as a target connector type alongside REST and CSV. Users should be able to point Helio at a PostgreSQL or MySQL database, write a SELECT query, and register the result as a DataType — following the same pattern as the existing REST API and CSV connectors.

## What changes

### Backend

* Add `sql` to the `SourceType` enum.
* Config shape (stored in `data_sources.config`):

  ```json
  { "dialect": "postgresql|mysql", "host": "...", "port": 5432, "database": "...", "user": "...", "password": "...", "query": "SELECT ..." }
  ```
* Implement `SqlConnector`: opens a JDBC connection per request (no pooling reuse), executes the query, returns rows as `Seq[Map[String, Any]]`.
* Add routes:
  * `POST /api/sources` with `source_type: sql` — connect, run query, infer schema, register DataType
  * `POST /api/sources/infer` with sql config — test connection and return inferred schema without persisting
  * `GET /api/sources/:id/preview` — re-run query, return up to 10 rows
  * `POST /api/sources/:id/refresh` — re-run query, update DataType
* **Security**:
  * Passwords are masked (`***`) in all API responses; stored as-is in config JSONB server-side
  * Reject queries containing DDL/DML keywords (`CREATE`, `DROP`, `ALTER`, `DELETE`, `INSERT`, `UPDATE`, `TRUNCATE`) at the route level with a 400 error
  * Use JDBC PreparedStatement for query execution (parameterized where applicable)

### Frontend

* In `AddSourceModal`, add a **SQL Database** tab.
* Fields: dialect selector (PostgreSQL / MySQL), host, port, database, username, password (masked input), query textarea.
* "Test connection" button calls `/api/sources/infer` and shows the inferred schema preview before saving.
* Connection errors surface as inline error messages in the modal.

## Out of scope

* Visual query builder
* Multiple queries per source
* Connection pool reuse across requests
* Non-relational databases (MongoDB, Redis, etc.)

## Acceptance criteria

- [ ] User can configure a PostgreSQL connection, enter a SELECT query, preview the result, and register it as a DataType
- [ ] MySQL connections work with the same flow
- [ ] Password field is masked in the UI and never returned in any API response
- [ ] Queries containing DDL/DML keywords (`CREATE`, `DROP`, `ALTER`, `DELETE`, `INSERT`, `UPDATE`, `TRUNCATE`) are rejected with a 400 error before execution
- [ ] `GET /api/sources/:id/preview` returns up to 10 rows from the query result
- [ ] Connection failures (wrong host, bad credentials, unreachable server) produce a clear error message in the modal — not a 500
