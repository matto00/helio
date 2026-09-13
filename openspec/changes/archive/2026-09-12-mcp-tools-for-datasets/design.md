## Context

The backend `dataset` primitive (v0.8 Epic 1) is fully shipped: `POST /api/data-sources` already
declares `dataset_schema` from caller-supplied `columns` at creation time
(`DataSourceService.createStatic`, `backend/.../DataSourceService.scala:97`), and
`GET/PATCH /api/data-sources/:id/schema`, `GET/POST/PUT /api/data-sources/:id/rows`,
`PATCH/DELETE /api/data-sources/:id/rows/:rowId` all exist and are exercised by backend tests
(`backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:89-183`). Rows are
**positional arrays** (`Vector[JsValue]`, ordered to match declared columns) everywhere on this
surface — `RowWriteRequest.rows: Vector[Vector[JsValue]]`, `RowPatchRequest.data: Vector[JsValue]`
(`DataSourceProtocol.scala:254,275`) — never row objects keyed by column name.

`helio-mcp/src/tools/write.ts` has `create_data_source` (inline `columns`+`rows`, no
`required`/`default` exposed) and nothing else touching `/rows` or `/schema`. This change is
MCP-surface only: no backend, migration, or wire-schema changes.

## Goals / Non-Goals

**Goals:**
- Expose every already-shipped dataset REST endpoint as an MCP tool: creation with a fully
  declared schema, append, replace, read rows, schema get/update, per-row edit/delete.
- Preserve the backend's own semantics verbatim in tool descriptions (positional rows,
  full-replacement schema PATCH, `updatedAt` optimistic-concurrency precondition) so an agent
  doesn't have to infer them from trial and error.
- AC: an agent can create a dataset, populate it, and build a pipeline over it end to end with no UI.

**Non-Goals:**
- No new backend endpoint, migration, or schema change (everything needed already ships on main).
- No new `create_dataset` tool — `create_data_source` already covers creation (Decision 1).
- No changes to `mcp-pipeline-*`/`mcp-output-tools` — building a pipeline over the new dataset
  source and reading its Output already works via the existing `create_pipeline`
  (`tools/pipelines.ts`), `run_pipeline` (`tools/write.ts`), and `get_output_rows`
  (`tools/outputs.ts`) tools. Note `get_output_rows` returns nothing until the pipeline has
  actually run (`tools/outputs.ts:151-153`) — the end-to-end test (tasks.md 2.3) explicitly runs
  the pipeline, it does not just build it. This change only needs to prove that path end to end,
  not modify it.

## Decisions

**1. Reuse `create_data_source` for dataset creation; do not add `create_dataset`.**
The backend already builds `dataset_schema` from `columns` at creation
(`DataSourceService.createStatic` line ~130 constructs a `DatasetFieldDeclaration` per column
including `required`/`default`), and `rows` has no `.min(1)` on either the MCP tool's zod schema or
the backend request — an empty array is already legal. The only real gap is that the MCP tool's
input schema omits `required`/`default` per column. Extending it is strictly additive (new
optional fields) and keeps one creation path instead of two overlapping ones.

**2. Positional rows, always — never a keyed-object convenience shape.**
An earlier draft of this design proposed row objects keyed by column name for
`append_dataset_rows`/`replace_dataset_rows`. Rejected: the backend has no such shape anywhere on
this surface (`RowWriteRequest`/`RowPatchRequest` are strictly positional `Vector[JsValue]`), so a
keyed-object convenience layer would require translation code in helio-mcp with its own
column-order/missing-key edge cases, duplicating validation the backend already owns. Every new
tool's `rows`/`data` input is a JSON array of arrays, documented as "same column order as
`get_dataset_schema` returns."

**3. Row mutation tools take `updatedAt` as a required input, never auto-fetched.**
`update_dataset_row`/`delete_dataset_row` require the caller to supply the row's current
`updatedAt` (obtained from a prior `get_dataset_rows`/`append_dataset_rows` call), matching every
other precondition-guarded tool's convention in this codebase (none silently re-fetch to paper
over a stale value) — a precondition conflict must reach the agent as a conflict, not be retried
into a lost-update bug.

**4. Tool naming: `dataset` in the tool name, not `data_source`.**
`get_dataset_rows`/`get_dataset_schema`/etc., not `get_data_source_rows` — these operations are
only meaningful for `dataset`-kind sources (CSV/REST/SQL sources have no row-write surface), and
the ticket, the spec capability description, and the wire alias all already say "dataset."

**5. `delete_dataset_row` needs `HelioHttpClient.delete` to accept a query object.**
`delete<T = void>(path: string): Promise<T>` (`httpClient.ts:124`) has no query-param parameter
today, unlike `get`/`post`. The backend's `DELETE /api/data-sources/:id/rows/:rowId` reads
`updatedAt` from the query string, not the body. Extend `delete` to
`delete<T = void>(path: string, query?: Record<string, string | number | undefined>): Promise<T>`,
forwarding to `send<T>("DELETE", path, undefined, query)` exactly like `get`'s existing `query`
parameter — additive, no existing caller passes a second argument today so none is affected.

**6. New tool handler logic lives in `write.ts`/`read.ts` inline, matching those two files'
existing convention — not a new `datasetToolsHandlers.ts`.**
Some newer tool groups (`outputsHandlers.ts`, `pipelinesHandlers.ts`) split handler logic into a
sibling `*Handlers.ts` file; `write.ts`'s and `read.ts`'s own existing tools (`create_data_source`,
`create_csv_data_source`, `list_source_objects`, etc.) keep their logic inline in the
`registerTool(...)` callback via the shared `guarded()` helper. Since every new tool here is a thin
`guarded(() => api.xxx(...))` wrapper with no branching logic of its own (unlike, say,
`pipelineProposalHandlers.ts`'s multi-step validation), it follows `write.ts`/`read.ts`'s existing
inline convention rather than introducing a new handlers file for a capability that doesn't need
one. `create_pipeline` (`tools/pipelines.ts`), `run_pipeline` (`tools/write.ts`), and
`get_output_rows` (`tools/outputs.ts`) — used only by the end-to-end test, not modified by this
change — already exist; this change adds no new tool file, only new registrations in the existing
`write.ts`/`read.ts`.

## Risks / Trade-offs

- Extending `create_data_source`'s input schema is a backward-compatible addition (new optional
  fields); existing callers are unaffected.
- Positional rows are less self-describing than keyed objects for an LLM caller; mitigated by
  every new tool's description stating the column order explicitly and pointing at
  `get_dataset_schema` to look it up.
- `update_dataset_schema`'s full-replacement semantics (a field omitted from the new `fields` array
  is dropped, requiring `confirmDrop`) is a sharp edge; the tool description states this plainly
  rather than softening it.
