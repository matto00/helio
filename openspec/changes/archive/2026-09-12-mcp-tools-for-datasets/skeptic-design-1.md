## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 8ce3710b9c694753b864e2d86276a79492772d93 (branch feature/mcp-tools-datasets/HEL-1081).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/mcp-tools-datasets/HEL-1081`.
- **Positional rows: TRUE.** `DataSourceProtocol.scala:254` `RowWriteRequest(rows: Vector[Vector[JsValue]])`, `:275` `RowPatchRequest(updatedAt: String, data: Vector[JsValue])`.
- **create_data_source declares schema: TRUE.** `DataSourceService.scala:126-131` builds `DatasetFieldDeclaration(name, type, required.getOrElse(false), default)`; `StaticColumnPayload` (`DataSourceProtocol.scala:243-248`) accepts optional `required`/`default`; `StaticDataSourceRequest.rows` has no min. The MCP side drops them: `write.ts:73` zod has only name/type, `helioApi.ts:457` maps `{name, type}` only. So the gap is real and correctly located.
- **Schema PATCH full replacement: TRUE**, but the wire shape differs from the spec (see CR 2).
- **Row PATCH/DELETE updatedAt precondition: TRUE**, but DELETE carries it as a query parameter, not a body (`DataSourceRoutes.scala`, rows/:rowId delete, `parameter("updatedAt".optional)`).
- **GET rows paging: cursor-based, not offset.** Route reads `parameters("cursor".optional, "limit".optional)`; response `RowListResponse(rows, nextCursor: Option[Long], total)` (`DataSourceProtocol.scala:297`).
- **E2E pipeline path:** `get_output_rows` (`tools/outputs.ts:147-153`) says "Rows exist only after the Output's pipeline has run successfully at least once." `run_pipeline` exists at `tools/write.ts:354`. `create_pipeline` lives in `tools/pipelines.ts:62`.
- **HTTP client:** `httpClient.ts:124` `delete<T>(path: string)` takes no query argument (unlike `get`, `:97`).

### Verdict: REFUTE

The backend claims the orchestrator asked me to check are true. But the spec and tasks misstate two wire contracts. As written, the planned tools would send requests the backend rejects or ignores. The end-to-end AC trace is also missing a step it needs.

### Change Requests
1. **get_dataset_rows paging is wrong.** In spec.md, "Requirement: get_dataset_rows MCP tool" says optional `limit`/`offset`, but the backend takes `cursor`/`limit` and returns `nextCursor` + `total`. Change the requirement, scenario, and tasks 1.1/1.2 to use `cursor` (non-negative integer seq) + `limit`. Say that `nextCursor`/`total` are returned, and that a missing `nextCursor` means the end of the rows. Add a test that passes `cursor` through and pages until `nextCursor` is absent.
2. **update_dataset_schema input shape is wrong.** The spec says the tool accepts "the new `columns` declaration". The backend is `UpdateDatasetSchemaRequest(fields: Vector[DatasetFieldDeclarationPayload], confirmDrop: Boolean = false)`, where each field is `{name, previousName?, type, required?, default?}`, and `default` uses the absent-vs-explicit-null idiom (`DataSourceProtocol.scala:328-338`). Revise the spec and tasks 1.2/1.3 to: (a) name the input `fields`; (b) expose `previousName` for renames (a rename without it is a drop plus an add); (c) expose `confirmDrop` as an explicit input; (d) keep an explicit JSON `null` default separate from an absent one when forwarding (never collapse the two). Also say that the 409 `SchemaUpdateConflictResponse {rejectedFields, message}` comes back verbatim, and that the 200 response is `DatasetSchemaUpdateResponse {fields, rowsMigrated}`.
3. **The end-to-end trace (task 2.3) skips `run_pipeline`.** `get_output_rows` returns no rows until the pipeline has run. Insert `run_pipeline` (`tools/write.ts:354`) between `create_pipeline` and `get_output_rows`. Also fix design.md's Non-Goals sentence, which implies create_pipeline plus get_output_rows alone "already works". Otherwise the AC-closing proof is ambiguous, and an implementer following it literally hits an empty Output.
4. **delete_dataset_row transport isn't specified.** The backend wants `updatedAt` as a query parameter, and `HttpClient.delete(path)` (`httpClient.ts:124`) takes no query. Task 1.1 must say how it gets there: extend `delete` with an optional query map, or URL-encode it into the path. The `updatedAt` value is an ISO instant containing `:` and `+`, so encoding needs a test. The spec requirement should also say "query parameter".
5. **Inaccurate Impact/file claims.** proposal.md Impact says pipeline/output tools don't change, which is fine. But any e2e harness or registration must touch `tools/pipelines.ts`/`tools/outputs.ts`, not just `write.ts`/`read.ts`, and the test layout in this package splits handlers out (`*Handlers.ts` + `*Handlers.test.ts`, see `outputs.ts:7-12`). Task 2.2 says "unit tests for each tool's handler", but `write.ts` handlers are inline closures. State whether the new tools follow the handlers-split pattern (recommended, so 2.2 is testable) or are tested through registration.
6. **create_data_source description/title still say `static`** (`write.ts:61-63`). Task 1.5 edits this description anyway, so the task should also correct it to `dataset` and state that `rows: []` creates an empty dataset. Otherwise the tool text contradicts the spec's "one dataset-creation path" requirement.

### Non-blocking notes
- The append/replace response `RowWriteResponse {rows:[{id,seq,updatedAt}], updatedAt}` has no `data`. The spec scenario ("returns ids/seq") is consistent with that. The per-row `updatedAt` it returns is usable for a later update/delete, as Decision 3 says.
- `update_dataset_row` returns `RowResponse {row:{id,seq,updatedAt,data}, sourceUpdatedAt}`, so the scenario's "returns its new updatedAt" should read `row.updatedAt`.
- The spec's `limit` bound should follow the backend's own limit handling in `listRows`, not an invented `.max(500)`.
