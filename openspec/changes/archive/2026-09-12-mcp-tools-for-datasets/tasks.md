## 1. MCP Tools — helio-mcp

- [x] 1.1 `httpClient.ts`: extend `HelioHttpClient.delete<T>` to accept an optional `query`
      param (mirroring `get`'s signature), forwarding to `send<T>("DELETE", path, undefined, query)`.
- [x] 1.2 `helioApi.ts`: add `appendDatasetRows`, `replaceDatasetRows`, `getDatasetRows`,
      `getDatasetSchema`, `updateDatasetSchema`, `updateDatasetRow`, `deleteDatasetRow` methods
      calling the shipped `/api/data-sources/:id/{rows,rows/:rowId,schema}` endpoints.
      `getDatasetRows` takes `cursor`/`limit`; `deleteDatasetRow` passes `updatedAt` via the new
      `delete` query param (task 1.1), not the body.
- [x] 1.3 `types.ts`: add response/request shapes for the above — row list (`rows`, `nextCursor`,
      `total`), row write (`rows`, `updatedAt`), row patch (`row`, `sourceUpdatedAt`), dataset
      schema (`fields`), schema update request (`fields` with optional `previousName`,
      `confirmDrop`) and response (`fields`, `rowsMigrated`), matching
      `DataSourceProtocol.scala`'s wire shapes verbatim (positional row arrays, not keyed objects).
- [x] 1.4 `tools/write.ts`: extend `create_data_source`'s input schema with optional per-column
      `required`/`default`, forwarded unchanged; update its title/description to say `dataset`
      (not `static`) and note `rows: []` creates an empty dataset with only its declared schema.
      Register `append_dataset_rows`, `replace_dataset_rows`, `update_dataset_row`,
      `delete_dataset_row`, `update_dataset_schema` inline, following this file's existing
      `guarded(() => api.xxx(...))` convention (no new handlers file).
- [x] 1.5 `tools/read.ts`: register `get_dataset_rows`, `get_dataset_schema`, same inline
      convention as 1.4.
- [x] 1.6 Every new/extended tool description states: rows are positional arrays matching
      declared column order (not keyed objects, and the order is discoverable via
      `get_dataset_schema`); `update_dataset_schema` is a full replacement (an omitted field is
      dropped) requiring `confirmDrop` for a destructive edit, and `previousName` expresses a
      rename; row PATCH sends `updatedAt` in the body, row DELETE sends it as a query parameter;
      a precondition conflict is returned verbatim, never retried.

## 2. Tests

- [x] 2.1 Unit tests for each new `helioApi.ts` method (request shape incl. `deleteDatasetRow`'s
      query-string encoding of `updatedAt`, response parsing).
- [x] 2.2 Unit tests for each new/extended tool's handler (inline in `write.test.ts`/`read.test.ts`,
      matching 1.4/1.5's inline convention): happy path, schema-violating row rejected verbatim,
      stale `updatedAt` precondition rejected verbatim (not retried), `update_dataset_schema`
      rename-via-`previousName` and destructive-edit-without-`confirmDrop` rejection.
- [x] 2.3 End-to-end round trip (against a real running backend + Postgres, not a fixture):
      `create_data_source` (empty rows, declared schema with `required`) → `append_dataset_rows`
      → `get_dataset_rows` (assert `nextCursor` absent on the last page) → `update_dataset_row`
      → `get_dataset_schema` → `update_dataset_schema` → `create_pipeline` over the dataset
      source with an `outputs[]` entry → **`run_pipeline`** → `get_output_rows` reflects the
      appended/edited data — proving the full AC (create → populate → pipeline run → Output)
      with no UI involved.
