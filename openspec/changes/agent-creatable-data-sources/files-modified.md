- `helio-mcp/src/httpClient.ts` — added `postMultipart` (FormData/Blob body, no manual
  Content-Type) and refactored the shared request/response handling (401/error/204 handling,
  network-failure wrapping) into a private `dispatch` used by both `send` (JSON) and
  `postMultipart`.
- `helio-mcp/src/types.ts` — added `RestAuthInput` (discriminated union mirroring the backend's
  `RestApiAuthPayload`: none/bearer/api_key) and `CreateSourceResult` (mirrors the backend's
  `CreateSourceResponse`; `dataType`/`fetchError` are always present, normalized from the wire's
  omitted-when-`None` Options).
- `helio-mcp/src/helioApi.ts` — added `createCsvDataSource` (multipart POST to
  `/api/data-sources`), `createRestDataSource` and `createSqlDataSource` (JSON POST to
  `/api/sources` with `type: "rest_api"`/`"sql"`, normalizing the raw wire response's optional
  `dataType`/`fetchError` to explicit `null` when absent).
- `helio-mcp/src/tools/write.ts` — registered `create_csv_data_source`, `create_rest_data_source`,
  `create_sql_data_source` MCP tools (zod schemas per tasks.md); updated `create_data_source`'s
  description to point at the three new tools instead of calling CSV/REST/SQL "out of this tool's
  scope".
- `helio-mcp/README.md` — added the three new tools to the write/composition tool table, with a
  note on CSV's non-inline companion DataType, the REST/SQL `fetchError` contract, and the
  credential-redaction guarantee.
