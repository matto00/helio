## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: 8ce3710b9c694753b864e2d86276a79492772d93

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/mcp-tools-datasets/HEL-1081`.
- Read the whole planning set again: ticket.md, proposal.md, design.md, tasks.md, specs/mcp-data-source-tools/spec.md.
- Fix 1 (paging): `DataSourceRoutes.scala` rows GET uses `parameters("cursor".optional, "limit".optional)`, and `RowListResponse(rows, nextCursor: Option[Long], total: Int)` in `DataSourceProtocol.scala` leaves `nextCursor` out entirely when there is no next page. The spec, tasks 1.2/1.3 and the 2.3 assertion all match. FIXED.
- Fix 2 (schema update): `UpdateDatasetSchemaRequest(fields, confirmDrop = false)` (line 338). `DatasetFieldDeclarationPayload(name, previousName?, type, required?, default: Option[Option[JsValue]])` (lines 328-334) gives the absent-vs-null default. The 409 body is `SchemaUpdateConflictResponse(rejectedFields, message)` (345) and the 200 body is `DatasetSchemaUpdateResponse(fields, rowsMigrated)` (350). The spec describes all of this correctly. FIXED.
- Fix 3 (E2E): tasks 2.3 now runs `run_pipeline` before `get_output_rows`. `run_pipeline` is at write.ts:354. The `get_output_rows` description (outputs.ts:147-153) says rows only exist after a run. FIXED.
- Fix 4 (DELETE transport): `httpClient.ts` `delete<T = void>(path)` takes no query argument today, while `get` does. The backend DELETE reads `parameter("updatedAt".optional)` and returns 400 when it is missing. Design Decision 5 and task 1.1 add a query argument the same way `get` has one. FIXED.
- Fix 5 (layout): write.ts registers `create_data_source` inline with `guarded(() => api.createDataSource(...))` (lines 58-78). Decision 6 and tasks 1.4/1.5 follow that pattern. FIXED.
- Fix 6 (create wording): write.ts:61-63 still says "static" today. Task 1.4 changes it to "dataset" and documents `rows: []`. `StaticColumnPayload` already accepts `required?`/`default?`. FIXED.
- Other cross-checks: PATCH rows takes `RowPatchRequest(updatedAt, data)` and returns `RowResponse(row{id,seq,updatedAt,data}, sourceUpdatedAt)`. Append and replace return `RowWriteResponse(rows{id,seq,updatedAt}, updatedAt)`. These match task 1.3 and the spec scenarios. The tasks cover every ticket AC, including the optional schema and per-row operations. No backend or contract change is needed, and none is planned. I found no placeholders or contradictions.

### Verdict: CONFIRM

### Non-blocking notes
- `nextCursor` is a JSON number (`Option[Long]`), not a string. The spec calls it "opaque", but the `get_dataset_rows` zod `cursor` input must accept a number, or number-or-string, and pass it back unchanged. Don't declare it `z.string()` only.
- `helio-mcp/src/tools/read.test.ts` does not exist yet (only `read.buildListConnectorsResult.test.ts`). Task 2.2 will create a new file, which is fine.
- For `update_dataset_schema`'s `default`, send the value unchanged. `JSON.stringify` drops a key whose value is `undefined` and keeps `null`, which gives the absent-vs-null behaviour the backend expects. A unit test for this is worth adding.
