# sql-database-connector Specification

## Purpose
PostgreSQL and MySQL connector that executes a stored query via JDBC, infers schema, and registers a DataType. Covers create, preview, refresh, DDL/DML rejection, password masking, and the frontend SQL tab in AddSourceModal.
## Requirements
### Requirement: Create a SQL data source
The backend SHALL expose `POST /api/sources` accepting `source_type: "sql"` with a `config` object
containing `dialect` (`"postgresql"` or `"mysql"`), `host`, `port`, `database`, `user`,
`password`, and `query`. On success it SHALL open a JDBC connection, execute the query, sample up
to 100 rows, infer schema via `SchemaInferenceEngine.fromJson`, insert a `DataSource`, and insert
a linked `DataType`. The response SHALL include `fetchError` if the connection or query fails.
Passwords SHALL be masked as `"***"` in all response objects.

#### Scenario: Successful creation registers DataType
- **WHEN** `POST /api/sources` is called with `source_type: "sql"` and a valid config pointing to a reachable database
- **THEN** the response is 201 with the created DataSource (password masked) and a linked DataType in the registry

#### Scenario: Creation succeeds even when connection fails
- **WHEN** `POST /api/sources` is called but the database is unreachable or credentials are wrong
- **THEN** the response is 201 with the DataSource and a non-null `fetchError`; no DataType is registered

#### Scenario: Missing required config field returns 400
- **WHEN** `POST /api/sources` is called with `source_type: "sql"` but `host` is absent
- **THEN** the response is 400 with a descriptive error

### Requirement: DDL/DML keyword rejection
The backend SHALL reject any SQL query containing DDL or DML keywords
(`CREATE`, `DROP`, `ALTER`, `DELETE`, `INSERT`, `UPDATE`, `TRUNCATE`) with a 400 error before
opening a JDBC connection. The check SHALL be case-insensitive and SHALL match whole words.

#### Scenario: SELECT query is accepted
- **WHEN** the query is `SELECT id, name FROM users`
- **THEN** the request proceeds without a 400 error

#### Scenario: DELETE query is rejected
- **WHEN** the query contains the word `DELETE`
- **THEN** the response is 400 with an error explaining that DDL/DML is not permitted

#### Scenario: CREATE keyword in query is rejected
- **WHEN** the query contains `CREATE TABLE foo`
- **THEN** the response is 400 before any database connection is opened

#### Scenario: Keyword embedded in identifier is not rejected
- **WHEN** the query is `SELECT updated_at FROM events` (keyword `UPDATE` is a substring)
- **THEN** the request is not rejected by the DDL/DML check

### Requirement: Infer SQL schema without persisting
The backend SHALL expose `POST /api/sources/infer` accepting `source_type: "sql"` with the same
config shape. It SHALL apply the DDL/DML check, open a JDBC connection, execute the query, sample
up to 100 rows, and return `InferredSchemaResponse`. No `DataSource` or `DataType` is written.

#### Scenario: Valid config returns inferred fields
- **WHEN** `POST /api/sources/infer` is called with a reachable SQL config
- **THEN** the response is 200 with `{"fields": [...]}` containing inferred column types

#### Scenario: Connection failure returns 502
- **WHEN** `POST /api/sources/infer` is called but the database is unreachable
- **THEN** the response is 502 with `{"error": "..."}` describing the failure

#### Scenario: DDL/DML in infer query returns 400
- **WHEN** `POST /api/sources/infer` is called with a query containing `DROP TABLE users`
- **THEN** the response is 400 before any JDBC connection is opened

### Requirement: Preview a SQL data source
The backend SHALL expose `GET /api/sources/:id/preview` which looks up the `DataSource`, opens a
JDBC connection, executes the stored query, and returns at most 10 rows as a JSON array under
`{"rows": [...]}`. No records are created or modified. The JDBC statement SHALL use
`setMaxRows(10)`.

#### Scenario: Preview returns up to 10 rows
- **WHEN** `GET /api/sources/:id/preview` is called for a SQL source whose query returns more than 10 rows
- **THEN** the response is 200 with a `rows` array containing exactly 10 elements

#### Scenario: Preview on non-existent source returns 404
- **WHEN** `GET /api/sources/:id/preview` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Connection failure on preview returns 502
- **WHEN** `GET /api/sources/:id/preview` is called but the database is unreachable
- **THEN** the response is 502 with a descriptive error

### Requirement: Refresh a SQL data source
The backend SHALL expose `POST /api/sources/:id/refresh` which re-opens the JDBC connection,
re-executes the query, re-infers schema, and updates the linked `DataType` fields (incrementing
version). If no DataType exists yet, a new one SHALL be created.

#### Scenario: Successful refresh updates DataType
- **WHEN** `POST /api/sources/:id/refresh` is called for an existing SQL source
- **THEN** the response is 200 with the updated DataType; version is incremented by 1

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Connection failure on refresh returns 502
- **WHEN** `POST /api/sources/:id/refresh` is called but the database is unreachable
- **THEN** the response is 502; the existing DataType is unchanged

### Requirement: Password is never returned in API responses
All API responses involving a SQL DataSource SHALL replace the `password` field in the config
with `"***"`. The plaintext password is stored as-is in the `data_sources.config` JSONB column.

#### Scenario: Create response masks password
- **WHEN** `POST /api/sources` succeeds with a SQL config
- **THEN** the response `config.password` is `"***"`, not the original value

#### Scenario: Infer response does not expose password
- **WHEN** `POST /api/sources/infer` is called
- **THEN** the response body contains no plaintext password

### Requirement: Frontend SQL Database tab
`AddSourceModal` SHALL include a **SQL Database** tab with fields: dialect selector
(`PostgreSQL` / `MySQL`), host (text), port (number, defaults 5432/3306 by dialect), database
(text), username (text), password (masked `<input type="password">`), and query (`<textarea>`).
A "Test connection" button SHALL call `POST /api/sources/infer` with `source_type: "sql"` and
display the inferred schema preview. Connection errors SHALL surface as inline error messages.
On save, the modal SHALL call `POST /api/sources` with `source_type: "sql"`.

#### Scenario: Test connection shows schema preview
- **WHEN** the user fills in all SQL fields and clicks "Test connection"
- **THEN** the inferred fields are displayed in the modal before the user saves

#### Scenario: Connection error shown inline
- **WHEN** "Test connection" is clicked but the backend returns a 502
- **THEN** an inline error message is displayed in the modal; no toast or navigation occurs

#### Scenario: Port defaults by dialect
- **WHEN** the user selects PostgreSQL dialect
- **THEN** the port field defaults to 5432
- **WHEN** the user selects MySQL dialect
- **THEN** the port field defaults to 3306

#### Scenario: Password field is masked
- **WHEN** the SQL tab is displayed
- **THEN** the password input is rendered as `type="password"` so the value is not visible

