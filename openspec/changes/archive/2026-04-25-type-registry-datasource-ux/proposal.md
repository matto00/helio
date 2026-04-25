## Why

The Data Sources / Type Registry page shipped functionally but with rough UX edges: blank areas when nothing is selected, no visual affordance to delete or edit DataTypes from the UI, no way to rename or edit a DataSource after creation, and a toggle-to-reveal detail panel instead of immediate preview.

## What Changes

- Replace blank empty states in `DataSourceList` and `TypeRegistryBrowser` with illustrated empty states that include a CTA
- Make clicking a DataType immediately open the detail panel (remove toggle-to-collapse on re-click; selection persists until explicitly closed)
- Add delete action to `TypeRegistryBrowser` (frontend only — backend `DELETE /api/types/:id` already exists and returns 409 if bound)
- Add edit action to `TypeRegistryBrowser` to update the DataType name (PATCH already exists on backend)
- Add backend `PATCH /api/data-sources/:id` endpoint to rename a DataSource
- Add edit (rename) and delete actions to `DataSourceList` with confirmation for delete and a bound-panel warning for DataType deletes

## Capabilities

### New Capabilities
- `datasource-ux-empty-states`: Proper empty state UI with CTA for the Data Sources and Type Registry sections
- `datasource-edit-delete`: Edit (rename) and delete actions for DataSources and DataTypes in the frontend, including confirmation flows and bound-panel warnings

### Modified Capabilities
- `frontend-data-sources-page`: Empty state improvements, immediate DataType selection, and edit/delete affordances added
- `datatype-crud-api`: No new backend endpoints needed for DataTypes (PATCH + DELETE exist); DataSource PATCH added

## Impact

- Backend: new `PATCH /api/data-sources/:id` route (name rename only)
- Frontend slices: `deleteDataType` thunk added to `dataTypesSlice`; `updateSource` (rename) thunk added to `sourcesSlice`
- Frontend components: `DataSourceList`, `TypeRegistryBrowser`, `TypeDetailPanel` updated

## Non-goals

- Editing DataSource config fields (URL, CSV columns) beyond renaming — that is a more complex schema-migration concern
- Pagination or filtering of the DataType/DataSource lists
