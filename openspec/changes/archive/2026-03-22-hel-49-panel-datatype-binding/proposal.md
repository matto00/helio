## Why

The TypeRegistry and REST/CSV connectors are in place, but panels have no way to consume that data. Wiring the panel detail modal's Data tab closes the loop: users can select a registered DataType, map its fields to display slots, and configure a refresh interval — turning static panels into live data views.

## What Changes

- `Panel` frontend model gains `typeId`, `fieldMapping`, and `refreshInterval` fields
- New `DataType` frontend model and `dataTypesSlice` Redux slice (fetch list from `GET /api/datatypes`)
- New `dataTypeService` for API calls
- `panelService` gains `updatePanelBinding` (patches `typeId`, `fieldMapping`, `refreshInterval`)
- `panelsSlice` gains `updatePanelBinding` thunk and updates the stored panel on success
- `PanelDetailModal` Data tab replaced: searchable DataType selector, field mapping per panel type, refresh interval selector, Save button, dirty-state warning
- Static field slot definitions per `PanelType` (`metric`, `chart`, `table`, `text`)
- `store.ts` adds `dataTypes` reducer

## Capabilities

### New Capabilities
- `panel-datatype-binding`: Binding a panel to a DataType, mapping fields to display slots, and configuring refresh interval via the panel detail modal Data tab

### Modified Capabilities
- `panel-type-field`: `Panel` response now includes `typeId`, `fieldMapping`, and `refreshInterval`; `PATCH /api/panels/:id` accepts these fields

## Impact

- Frontend: `models.ts`, `panelsSlice.ts`, `panelService.ts`, `PanelDetailModal.tsx`, `store.ts` — all modified
- Frontend: `dataTypesSlice.ts`, `dataTypeService.ts` — new files
- Backend: `typeId`, `fieldMapping`, `refreshInterval` already wired from HEL-46; no backend changes needed
- Tests: `PanelDetailModal.test.tsx`, `panelsSlice.test.ts` updated; `dataTypesSlice.test.ts` new
