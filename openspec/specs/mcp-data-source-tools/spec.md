# mcp-data-source-tools Specification

## Purpose
Let an agent connect a real CSV, REST API, or SQL data source through MCP alone — closing the
gap where only inline `static` sources were agent-creatable and CSV/REST/SQL required the UI.
## Requirements
### Requirement: create_csv_data_source MCP tool
The MCP server SHALL expose a `create_csv_data_source` tool that accepts a `name` and inline CSV
`content` (text), posts it to the backend's CSV upload endpoint as multipart form data, and
returns the created source's id. The backend auto-creates a companion DataType for the source but
does not return it inline from this endpoint (same shape as the existing `static` tool); the
agent can inspect it via `list_source_objects` and build a pipeline over the returned source id.

#### Scenario: Agent creates a CSV source from inline content
- **WHEN** an agent calls `create_csv_data_source` with `name` and CSV `content`
- **THEN** the tool posts a multipart request to `POST /api/data-sources` and returns the created
  source's id, without requiring any filesystem access from the MCP process

#### Scenario: Oversized content is rejected verbatim
- **WHEN** the CSV `content` exceeds the backend's configured maximum upload size
- **THEN** the tool returns the backend's 413 error message unchanged, not a generic failure

### Requirement: create_rest_data_source MCP tool
The MCP server SHALL expose a `create_rest_data_source` tool that accepts `name`, `url`, optional
`method`/`headers`/`auth` (none/bearer/api_key), posts to the backend's REST source endpoint, and
returns the created source, its auto-created companion DataType (if the initial fetch succeeded),
and any `fetchError`.

#### Scenario: Agent creates a REST source with bearer auth
- **WHEN** an agent calls `create_rest_data_source` with `url` and `auth: {type: "bearer", token}`
- **THEN** the tool returns the created source id, the companion DataType (if fetch succeeded),
  and the bearer token is never present in the tool's result

#### Scenario: Initial fetch fails
- **WHEN** the configured REST endpoint is unreachable or returns an error at creation time
- **THEN** the tool still returns the created source id with `dataType: null` and a `fetchError`
  message, so the agent can diagnose and retry rather than receiving an opaque failure

### Requirement: create_sql_data_source MCP tool
The MCP server SHALL expose a `create_sql_data_source` tool that accepts `name`, `dialect`,
`host`, `port`, `database`, `user`, `password`, and `query`, posts to the backend's SQL source
endpoint, and returns the created source, its auto-created companion DataType (if the initial
query succeeded), and any `fetchError`.

#### Scenario: Agent creates a SQL source
- **WHEN** an agent calls `create_sql_data_source` with connection details and a read-only `query`
- **THEN** the tool returns the created source id and companion DataType, and the `password` is
  never present in the tool's result

#### Scenario: Query contains a disallowed keyword
- **WHEN** `query` contains DDL/DML keywords (CREATE, DROP, ALTER, DELETE, INSERT, UPDATE,
  TRUNCATE)
- **THEN** the tool surfaces the backend's rejection verbatim; no source is created

### Requirement: Credentials never appear in tool results
None of the write tools introduced by this capability SHALL return raw credential values (SQL
passwords, REST bearer tokens, REST api-key values) in any success or error result.

#### Scenario: Redaction holds across success and error paths
- **WHEN** any of `create_csv_data_source`, `create_rest_data_source`, `create_sql_data_source`
  succeeds or fails
- **THEN** the tool's result contains no raw password, bearer token, or api-key value — success
  responses rely on the backend's existing redaction (`***`), and error messages never echo the
  submitted config

