## MODIFIED Requirements

_Companion DataTypes are retired (HEL-903 decision 4/11); a source's schema now lives directly on `data_sources.inferred_schema`, written by `upsertInferredSchema` in place of the old `upsertSourceDataType`/second-upsert path. Scenario titles are preserved verbatim from the live spec even where they still say "DataType" (they describe the same test case) — only the body text below each is updated to the new mechanism._

### Requirement: Create a SQL data source
The backend SHALL expose `POST /api/sources` accepting `source_type: "sql"` with a `config` object
containing `dialect` (`"postgresql"` or `"mysql"`), `host`, `port`, `database`, `user`,
`password`, and `query`. On success it SHALL open a JDBC connection, execute the query, sample up
to 100 rows, infer schema via `SchemaInferenceEngine.fromJson`, insert a `DataSource`, and insert
the source's inferred schema. The response SHALL include `fetchError` if the connection or query fails.
Passwords SHALL be masked as `"***"` in all response objects.

#### Scenario: Successful creation registers DataType
- **WHEN** `POST /api/sources` is called with `source_type: "sql"` and a valid config pointing to a reachable database
- **THEN** the response is 201 with the created DataSource (password masked) and a linked inferred schema in the registry

#### Scenario: Creation succeeds even when connection fails
- **WHEN** `POST /api/sources` is called but the database is unreachable or credentials are wrong
- **THEN** the response is 201 with the DataSource and a non-null `fetchError`; no inferred schema is registered

#### Scenario: Missing required config field returns 400
- **WHEN** `POST /api/sources` is called with `source_type: "sql"` but `host` is absent
- **THEN** the response is 400 with a descriptive error

### Requirement: Infer SQL schema without persisting
The backend SHALL expose `POST /api/sources/infer` accepting `source_type: "sql"` with the same
config shape. It SHALL apply the DDL/DML check, open a JDBC connection, execute the query, sample
up to 100 rows, and return `InferredSchemaResponse`. No `DataSource` or inferred schema is written.

#### Scenario: Valid config returns inferred fields
- **WHEN** `POST /api/sources/infer` is called with a reachable SQL config
- **THEN** the response is 200 with `{"fields": [...]}` containing inferred column types

#### Scenario: Connection failure returns 502
- **WHEN** `POST /api/sources/infer` is called but the database is unreachable
- **THEN** the response is 502 with `{"error": "..."}` describing the failure

#### Scenario: DDL/DML in infer query returns 400
- **WHEN** `POST /api/sources/infer` is called with a query containing `DROP TABLE users`
- **THEN** the response is 400 before any JDBC connection is opened

### Requirement: Refresh a SQL data source
The backend SHALL expose `POST /api/sources/:id/refresh` which re-opens the JDBC connection,
re-executes the query, re-infers schema, and updates the source's inferred schema fields (incrementing
version). If no inferred schema exists yet, a new one SHALL be created.

#### Scenario: Successful refresh updates DataType
- **WHEN** `POST /api/sources/:id/refresh` is called for an existing SQL source
- **THEN** the response is 200 with the updated inferred schema; version is incremented by 1

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Connection failure on refresh returns 502
- **WHEN** `POST /api/sources/:id/refresh` is called but the database is unreachable
- **THEN** the response is 502; the existing inferred schema is unchanged
