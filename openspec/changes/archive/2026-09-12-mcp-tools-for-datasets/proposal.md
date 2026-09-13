## Why

The v0.8 `dataset` primitive (schema declaration, row append/replace/read, per-row edit/delete)
shipped fully on the backend (HEL-1073–1080, 1118, 1121, 1122, 1124), but the agent surface never
followed. `create_data_source` only creates a source from inline columns+rows with an *inferred*
schema — there is no MCP path to declare a schema, append, replace, read, or edit dataset rows.
An agent cannot build the "create a dataset, populate it, run a pipeline over it" flow the AC asks
for without dropping into the UI.

## What Changes

- **`create_data_source` already declares a schema, not just infers one** — its `columns`
  (name/type) become the dataset's `dataset_schema` at creation
  (`DataSourceService.createStatic`), and rows may be an empty array. Extend its input schema with
  optional per-column `required`/`default` (already accepted by the backend's `StaticColumnPayload`
  but not exposed by the tool today) so an agent can declare the full schema shape at creation —
  no new creation tool needed.
- Add `append_dataset_rows` / `replace_dataset_rows` MCP tools: `POST`/`PUT /api/data-sources/:id/rows`,
  each row a **positional array** matching the declared column order (same shape
  `create_data_source`'s `rows` already uses — never an object keyed by column name).
- Add `get_dataset_rows` MCP tool: paged `GET /api/data-sources/:id/rows` (id/seq/updatedAt/data per row).
- Add `get_dataset_schema` / `update_dataset_schema` MCP tools: `GET`/`PATCH /api/data-sources/:id/schema`.
- Add `update_dataset_row` / `delete_dataset_row` MCP tools: per-row `PATCH`/`DELETE` with the
  required `updatedAt` precondition surfaced as an input (stale-write conflicts returned verbatim,
  not swallowed).
- No backend or schema changes — every endpoint already exists and is exercised by backend tests.

## Capabilities

### New Capabilities

(none — this extends the existing MCP data-source-tools capability)

### Modified Capabilities

- `mcp-data-source-tools`: adds requirements for declared-schema dataset creation, row
  append/replace/read, per-row edit/delete, and schema read/update as new MCP tools.

## Impact

- `helio-mcp/src/tools/write.ts` (new tool registrations), `helio-mcp/src/tools/read.ts` (row/schema
  read tools), `helio-mcp/src/helioApi.ts` (new HTTP methods), `helio-mcp/src/types.ts` (response
  shapes), plus corresponding `*.test.ts` files. No backend, migration, or schema-contract changes.
