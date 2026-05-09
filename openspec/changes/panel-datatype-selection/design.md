## Context

The panel creation modal (`PanelCreationModal.tsx`) currently has three steps: type-select →
template-select → name-entry. The `createPanel` thunk (`panelsSlice.ts`) sends `{ dashboardId,
title, type, typeConfig? }` to `POST /api/panels`. The backend `CreatePanelRequest` case class does
not include `dataTypeId`; `PanelRoutes` constructs the `Panel` domain object without setting `typeId`.

The `DataType` model exists (`frontend/src/types/models.ts`) and `dataTypesSlice` exposes
`fetchDataTypes`. The `Pipeline` model has an `outputDataTypeId?: string` field — this is the link
used to determine which DataTypes are "registry-produced". The `Panel` domain model already has a
`typeId: Option[DataTypeId]` field and the `panels` table has a `type_id` column, so no DB migration
is needed.

Data-bound types: metric, chart, text, table. Non-data-bound: markdown, image, divider.

## Goals / Non-Goals

**Goals:**
- Insert a DataType picker step in `PanelCreationModal` for data-bound types only
- Filter picker list to DataTypes that have at least one pipeline referencing them via `outputDataTypeId`
- Block Create submission until a DataType is selected (data-bound types)
- Pass `dataTypeId` through the Redux thunk to `POST /api/panels`
- Persist `dataTypeId` on the backend — set `typeId` on the `Panel` domain object during creation

**Non-Goals:**
- Changing PATCH-based binding flow (existing `panel-datatype-binding` spec)
- Creating a DataType from within the modal
- DB migration (column already exists)
- Validating that the `dataTypeId` refers to a pipeline-produced type on the backend (trust the
  frontend filter; backend only checks DataType existence)

## Decisions

**D1: Insert step between template-select and name-entry, not as a separate route.**
The modal already manages a `Step` union type. Adding `"datatype-select"` to the union and
inserting it in the step transition functions (handleTemplateSelect → datatype-select for data-bound
types, skip for non-data-bound) is minimal and consistent with the existing pattern. Alternative
(show DataType picker inline in name-entry step) was rejected — it conflates creation config with
structural binding choice.

**D2: Derive registry DataType IDs from the pipelines Redux slice, not a separate API call.**
`pipelinesSlice` already loads pipelines via `fetchPipelines`. The set of registry DataType IDs is
`new Set(pipelines.items.map(p => p.outputDataTypeId).filter(Boolean))`. The `dataTypesSlice` items
are filtered client-side against this set. No new endpoint needed; both slices are already loaded
when the dashboard view is active. If pipelines are not yet loaded, the component dispatches
`fetchPipelines` on mount (same pattern used in PipelinesPage).

**D3: Backend — extend `CreatePanelRequest` with optional `dataTypeId: Option[String]`, set
`panel.typeId` when present.**
`CreatePanelRequest` gains one new field (`dataTypeId`). The `jsonFormat4` call in
`JsonProtocols.scala` becomes `jsonFormat5`. `PanelRoutes` creates the `Panel` with
`typeId = request.dataTypeId.map(DataTypeId(_))`. Existence validation (does the DataType exist?)
is omitted for now — if the ID is invalid, the panel is created with a dangling `typeId`, which is
surfaced as a no-data state at render time (same behavior as an unresolved binding after PATCH).

**D4: `dataTypeId` is required in the thunk payload for data-bound types but optional in
`createPanel`'s argument type.**
`createPanel` thunk arg gains `dataTypeId?: string`. The service call passes it only when non-null.
This keeps the thunk compatible with non-data-bound types without overloading.

## Risks / Trade-offs

- **Stale pipeline list** → DataType filter may exclude newly created types if pipelines were not
  re-fetched. Mitigation: dispatch `fetchPipelines` on modal open if slice is empty.
- **Backend does not validate DataType existence on create** → A panel may be created with an invalid
  `typeId`. This is acceptable in v1; full validation can be added in a follow-up. The resolution
  logic in `PanelRoutes.resolveTypeBinding` already strips invalid `typeId` values at read time.

## Planner Notes

Self-approved: no new external dependencies, no breaking API changes (new optional field on create
request is backward-compatible), no new DB migrations, scope is fully contained in the ticket.
