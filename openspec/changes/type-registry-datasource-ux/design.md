## Context

The SourcesPage has two sections: DataSourceList and TypeRegistryBrowser. Both render blank space when empty or nothing is selected.
DataType delete exists on the backend (`DELETE /api/types/:id` with 409 on bound panels) but has no frontend affordance.
DataSource delete exists end-to-end. DataSource PATCH does not exist on the backend; `DataSourceRepository.update` accepts a full `DataSource` record but the route is missing.
TypeRegistryBrowser toggles the detail panel on re-click (deselect); it should always show the panel once a type is clicked.
TypeDetailPanel already handles field editing via `PATCH /api/types/:id` but does not expose name editing or a delete action.

## Goals / Non-Goals

**Goals:**
- Proper empty states with CTAs in both list components
- Immediate (non-toggle) DataType selection → detail panel
- Delete DataType from TypeRegistryBrowser with bound-panel warning (409 from backend)
- Edit DataType name from TypeDetailPanel
- Rename DataSource (PATCH /api/data-sources/:id) with new backend route
- Delete DataSource already works; add inline edit (rename) affordance to DataSourceList

**Non-Goals:**
- Editing DataSource config (URL, columns, SQL connection) beyond name rename
- Bulk operations

## Decisions

**Backend PATCH /api/data-sources/:id — name-only rename**
The `DataSourceRepository.update` already accepts the full domain object. A new route segment in `DataSourceRoutes` handles `PATCH /api/data-sources/:id`, accepting `{ "name": "<new>" }`. ACL-guards with `dataSourceResolver` pattern, same as delete.

**Frontend deleteDataType thunk — 409 handling**
`deleteDataType` in `dataTypesSlice` calls `DELETE /api/types/:id`. A 409 response is surfaced as a human-readable error in the component ("One or more panels use this type — unbind them first before deleting."). The thunk returns `rejectWithValue` with the server error message, so the component can render it.

**Selection model change — always-open detail panel**
Remove the toggle behavior in `TypeRegistryBrowser` (`prev === dt.id ? null : dt.id`). Selection is set on click and cleared only via the close button on `TypeDetailPanel`. This makes the click-to-preview immediate as required.

**Empty states — inline component pattern**
Each empty state is an inline section with a text blurb and a CTA button. `DataSourceList` CTA triggers the "Add source" modal (callback prop). `TypeRegistryBrowser` CTA text points user to add a source ("Add a data source to create types automatically"). No external illustration assets needed — icons from the existing CSS theme.

**DataSource rename — inline edit on list item**
`DataSourceList` gains a pencil/Edit button. Clicking it replaces the source name text with an input; pressing Enter or clicking Save dispatches `updateSource`. This avoids a modal for a name-only edit, consistent with how dashboard rename works.

## Risks / Trade-offs

- 409 on DataType delete is a backend enforcement; frontend must gracefully display this error. → Show the server error string in a dismissible alert.
- Rename DataSource updates the associated DataType's name? No — the DataType name is independent after creation. Keeping them decoupled avoids cascading surprises. → Documented as expected behavior.

## Planner Notes

Self-approved. No new external dependencies. Backend change is additive (new route only). Existing `JsonProtocols` already has a pattern for partial-update request types (`UpdateDataTypeRequest`); will add `UpdateDataSourceRequest` with optional `name` field following the same pattern.
