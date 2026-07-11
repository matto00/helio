## 1. MCP Server: HTTP client + types

- [x] 1.1 Add `postMultipart` to `helio-mcp/src/httpClient.ts` (FormData/Blob, no Content-Type
      header set manually — let fetch set the multipart boundary)
- [x] 1.2 Add `CreateSourceResponse`-mirroring types to `helio-mcp/src/types.ts`
      (`CreateSourceResult`, `RestAuthInput`, redacted config shapes already covered by
      `DataSourceResponse`)

## 2. MCP Server: helioApi wrappers

- [x] 2.1 Add `createCsvDataSource({name, content}): Promise<DataSourceResponse>` to
      `helio-mcp/src/helioApi.ts`, posting multipart to `/api/data-sources`
- [x] 2.2 Add `createRestDataSource(input): Promise<CreateSourceResult>` posting JSON to
      `/api/sources` with `type: "rest_api"`
- [x] 2.3 Add `createSqlDataSource(input): Promise<CreateSourceResult>` posting JSON to
      `/api/sources` with `type: "sql"`

## 3. MCP Server: tool registration

- [x] 3.1 Register `create_csv_data_source` in `helio-mcp/src/tools/write.ts` (zod schema:
      `name`, `content`)
- [x] 3.2 Register `create_rest_data_source` (zod schema: `name`, `url`, `method?`, `headers?`,
      `auth?` discriminated union none/bearer/api_key)
- [x] 3.3 Register `create_sql_data_source` (zod schema: `name`, `dialect`, `host`, `port`,
      `database`, `user`, `password`, `query`)
- [x] 3.4 Update `create_data_source`'s description to point at the three new tools instead of
      saying CSV/REST/SQL are "out of this tool's scope"

## 4. Verification

- [x] 4.1 Manually exercise all three new tools against a locally running backend (or via
      `helio-mcp/scripts/verify.ts` if it supports ad hoc tool calls): create each source kind,
      confirm REST/SQL responses include the companion DataType (CSV's does not — verify
      `list_source_objects` shows its shape instead)
- [x] 4.2 Confirm no raw password/token/api-key value appears in any tool result (success or
      error path) for all three tools
- [x] 4.3 Run `npm run build` (or equivalent typecheck) in `helio-mcp/` and fix any type errors
- [x] 4.4 Update `helio-mcp/README.md` tool inventory to list the three new tools
