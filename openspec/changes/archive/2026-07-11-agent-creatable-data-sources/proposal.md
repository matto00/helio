## Why

MCP `create_data_source` only creates `static` sources; CSV/REST/SQL sources — the ones a real
integration needs — still require the UI. An agent embedded in a project can't complete the
source → pipeline → dashboard chain end-to-end without a manual step.

## What Changes

- Add three MCP tools: `create_csv_data_source`, `create_rest_data_source`,
  `create_sql_data_source`, each a thin wrapper over the backend's existing endpoints
  (`POST /api/data-sources` multipart for CSV, `POST /api/sources` for REST/SQL).
- `create_csv_data_source` accepts CSV text content (not a file path) and posts it as multipart
  form data — no filesystem access from the MCP process.
- REST/SQL tools return the backend's `CreateSourceResponse` shape (source + auto-created
  companion DataType + `fetchError`), mirroring `create_data_source`'s "return the id, point at
  building a pipeline" pattern.
- The backend already redacts REST auth tokens and SQL passwords in every `DataSourceResponse`
  (`DataSourceProtocol.redactRestPayload`/`redactSqlPayload`). Verify this redaction covers the
  `CreateSourceResponse.source` field these tools return, and that no error path echoes raw config.
- Update `create_data_source`'s description (currently: CSV/REST/SQL are "out of this tool's
  scope") to point agents at the new tools.
- No backend changes: CSV-by-URL is out of scope — no such backend endpoint exists, only
  multipart upload.

## Capabilities

### New Capabilities

- `mcp-data-source-tools`: MCP tool contract for creating CSV/REST/SQL data sources — inputs,
  return shape, and the credential-redaction guarantee.

### Modified Capabilities

(none — `create_data_source`'s scope note is a tool description string, not spec-level behavior)

## Impact

- `helio-mcp/src/tools/write.ts` — new tool registrations.
- `helio-mcp/src/helioApi.ts` — new API wrapper methods (`createCsvDataSource`,
  `createRestDataSource`, `createSqlDataSource`).
- `helio-mcp/src/httpClient.ts` — add multipart POST support.
- `helio-mcp/src/types.ts` — new request/response types mirroring `CreateSourceResponse`.
- No backend or schema changes — existing endpoints only.

## Non-goals

- CSV-by-URL (backend has no such endpoint).
- An `infer_source_schema` MCP tool (existing `list_source_objects` already surfaces shape
  post-creation).
- Refresh/preview tools beyond what `list_source_objects` already covers.
