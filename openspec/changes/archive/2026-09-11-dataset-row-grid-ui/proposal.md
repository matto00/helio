## Why

HEL-1080's grid needs to view, edit, and delete a dataset source's rows, but the frontend has
no way to render typed columns/editors — the backend stores a declared per-field schema
(`dataset_schema` / `DatasetFieldDeclaration`) but no route exposes it (HEL-1122). Folding both
into one delivery avoids a UI that infers shape from row 0 (already documented as a trap in
MISTAKES.md) and keeps the schema-plus-grid contract landing together.

## What Changes

- New `GET /api/data-sources/:id/schema` route (dataset-kind sources only) returning the
  declared field list (`name`, `type`, `required`, `default`) from `dataset_schema`.
  Additive-only; existing `GET /api/data-sources/:id` (`StaticSourceResponse`) response shape is
  unchanged — no existing consumer (frontend, MCP) is broken.
- New `DatasetRowGrid` frontend feature: paged, editable grid over `GET .../rows`, using the
  existing `DataGrid` shared component rather than a new one.
- Inline cell edit (`PATCH .../rows/:rowId` with `updatedAt` precondition), row delete
  (`DELETE .../rows/:rowId`), add-row (`POST .../rows`, append mode).
- Redux slice (`createAsyncThunk`) for schema + paged rows + row mutations; presentational grid
  component; reusable selectors/hooks for stale-conflict and validation-error state.
- Stale-edit UX: a 409/precondition-failed response triggers a follow-up fetch of the row's
  current value, shown inline with a retry (re-applying only the user's edited cells) or discard
  action — never a silent overwrite or a generic toast.
- Field-level validation errors render on the offending cell, driven by the declared schema.

## Capabilities

### New Capabilities

- `dataset-schema-api`: `GET /api/data-sources/:id/schema` — declared field list for a
  dataset-kind source.
- `dataset-row-grid`: editable, paged, keyboard-navigable grid over a dataset source's rows
  (view/edit/delete/add), reusing `DataGrid`.

### Modified Capabilities

(none — `dataset-row-write-api` and `dataset-row-storage` are consumed, not changed)

## Impact

- Backend: `DataSourceProtocol.scala` (new response/format), `DataSourceRoutes.scala` (new
  route), `DataSourceService.scala` (schema accessor), `schemas/`, OpenAPI spec.
- `frontend/src/shared/ui/DataGrid.tsx`: new default-off `gridMode`/`activeCell`/
  `onActiveCellChange`/`rowId` props (design.md Decision 0) — additive, existing 5 consumers
  unaffected, verified by a per-consumer regression check.
- Frontend: new `DatasetRowGrid` component and `datasetRowsSlice` under
  `frontend/src/features/sources/`, mounted on the existing `/sources/:id` route
  (`SourceDetailPanel`), replacing that panel's read-only Preview grid for `dataset`-kind
  sources only (design.md Decision 7).
- No migration — reads existing `dataset_schema` column (HEL-1074/1076).

## Non-goals

- No bulk row import/export in this change (existing CSV upload path is unaffected).
- No schema *editing* UI (declaring/changing fields) — this exposes the existing declared
  schema read-only for grid rendering.
- No optimistic-locking UI framework beyond this grid's own stale-edit handling.
