## Why

`DELETE /api/data-sources/:id` only refuses when the source is a pipeline's SOLE root (HEL-987). When the source is
one of several roots it succeeds and, via `pipeline_roots` -> `outputs` -> `panels` ON DELETE CASCADE, silently
drops the root, its steps, Outputs, alerts and every panel placed on those Outputs. The owner ruled (2026-10-03)
for `any-reference`: block whenever any pipeline roots on the source.

## What Changes

- **BREAKING**: `DELETE /api/data-sources/:id` returns 409 whenever ANY pipeline has the source as a root
  (multi-root deletes that returned 204 now 409). Same conflict body as HEL-987, plus an additive `pipelines`
  array of `{id,name}` for the pipelines the caller can see; pipelines the caller cannot see are never named.
- The guard runs before any file deletion, covering REST, MCP `delete_data_source`, patch-set apply/undo.
- Frontend: the delete thunk preserves the 409 and the UI shows the reason with links to the pipeline editor.
- helio-mcp: `delete_data_source` description and error text describe the 409 and the remove-root-first path.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `datasource-edit-delete`: the 409 scope widens from sole-root to any-reference; new `pipelines` field; frontend
  conflict rendering.

## Impact

`DataSourceRepository`, `DataSourceService.delete`, `DataSourceDeleteError`/protocol, `DataSourceRoutes`;
`sourcesSlice`/`SidebarBody`/`EmptySchemaAffordance`; `helio-mcp` write tool; backend, frontend and mcp tests.

## Non-goals

- Secondary join/lookup/union inputs, upsert targets and form-panel bindings that name a source in JSON config
  (no FK, no cascade, no silent panel loss; a different class). Filed as a follow-up.
- `teardown_resources` invisible-pipeline gap; V99/V100 trigger changes (HEL-974); a force-delete flag.
