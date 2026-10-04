## Why

HEL-1252 made `DELETE /api/data-sources/:id` refuse (409) on four reference kinds — pipeline root, join/lookup/union
secondary input, upsert existing-source target, and form-panel binding — but the Sources "Used by" column and both delete
warnings (sidebar, empty-schema affordance) still count pipeline roots only, computed client-side from the pipelines
slice. A source used only by a join, upsert or form panel shows "Unused", then refuses to delete. The UI contradicts the
server.

## What Changes

- New read endpoint `GET /api/data-sources/references`: for every data source the caller owns, the same
  visible-named / hidden-counted reference summary the 409 body carries, produced by HEL-1252's
  `DataSourceReferenceRepository.find` in one batched call (constant query count, no per-source N+1).
- Frontend loads that summary into the sources slice and derives "Used by", the sidebar delete warning and the
  empty-schema delete warning from it — one shared formatter, no client-side reference counting.
- The roots-only client derivations (`selectPipelineNamesBySourceId`, the two inline `roots.some(...)` counts) and the
  pipeline fetches that existed only to feed them are removed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `datasource-edit-delete`: the delete warning counts every reference kind the 409 guard enforces, from the server;
  adds the references read endpoint and the "Used by" requirement.

## Impact

- Backend: `DataSourceRoutes`, `DataSourceService`, `DataSourceRepository` (owned-id read), protocol + JSON Schema.
- Frontend: `sourcesSlice`, `dataSourceService`, `SourceListTable`, `SourcesPage`, `SidebarBody`,
  `EmptySchemaAffordance`, `pipelinesSlice` (selector removal).
- No migration. No change to the DELETE guard or the finder's semantics.

## Non-goals

- Changing which references block a delete (HEL-1252 owns that).
- helio-mcp tool changes; a pipeline-delete "Used by" equivalent; live push of reference changes between tabs.
