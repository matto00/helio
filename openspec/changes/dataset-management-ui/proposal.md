## Why

A dataset (dataset-kind data source) can only be created and have its schema declared/edited
today via direct API calls — there is no UI path. HEL-1079 requires a dataset to be creatable and
editable from Sources without a dashboard, and the declared-schema update API (HEL-1124) now
exists to build this on.

## What Changes

- Add a "Dataset" create flow to the Sources add-source UI: name the dataset, declare fields
  (name, canonical type, required, default), reorder and remove fields before creating.
- Add a schema-edit surface on an existing dataset source (from `/sources/:id`) that, per case,
  either predicts and blocks/confirms client-side before any request is sent (add-required-with-
  no-default, drop-with-data — both fully determined by the dataset's own row count), or submits
  and surfaces the server's decision inline without losing the in-progress edit (retype,
  tighten-to-required — both require the server's per-value/per-row check, so cannot be
  previewed before commit). Every rejection, predicted or server-surfaced, is shown before the
  user ever leaves the schema-edit flow to write a row.
- Route every create/edit action through the backend's declared-schema API (`POST
  /api/data-sources`, `PATCH /api/data-sources/:id/schema`) — no client-side schema assumption.
- Whole flow is keyboard-operable; every new control has a computed accessibility name.

## Capabilities

### New Capabilities
- `dataset-management-ui`: create-dataset and edit-schema UI flows in Sources, including the
  pre-commit preview/confirmation surface for schema edits on non-empty datasets.

### Modified Capabilities
(none — no backend/API requirement changes; `dataset-schema-api` already covers the contract this
UI consumes)

## Impact

- `frontend/src/features/sources/ui/AddSourceModal.tsx`, `SourceTypeToggle.tsx`,
  `useAddSourceAction.tsx` — extended with a dataset creation path.
- `frontend/src/features/sources/types/dataSource.ts` — `StaticColumn.type` widened from
  `StaticColumnType` (4 types) to `DatasetFieldType` (7 canonical types); no wire-shape change.
- New field-declaration editor component(s) reusing `useDatasetFieldEditor.ts` (HEL-1080).
- New schema-edit UI at `/sources/:id`, alongside the existing `DatasetRowGrid.tsx`.
- New Redux state/service calls for `POST /api/data-sources` (dataset kind) and `PATCH
  /api/data-sources/:id/schema`.
- New Playwright e2e coverage (create-with-fields, rejected/409 schema edit) alongside
  `e2e/hel1080-dataset-row-grid-live.spec.ts` and `e2e/focus-presence-guard.spec.ts`.

## Non-goals

- No new backend routes or schema changes (fully covered by HEL-1124).
- No dashboard-bound dataset editing (out of scope per ticket: "without a dashboard").
- No bulk row import/CSV upload changes (HEL-1080/1077 territory).
